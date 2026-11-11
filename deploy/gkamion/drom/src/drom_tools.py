"""DROM rules ported from the mounted n8n drom-order-flow, no model arithmetic.

No send operation. Protected checkout owns the sole allowed order POST;
legacy form issuance remains disabled. Every mutation re-reads the current conversation.
"""
from __future__ import annotations
import copy
import fcntl
import hashlib
import html
import json
import os
import re
import time
import uuid
from contextlib import contextmanager
from decimal import Decimal, InvalidOperation
from pathlib import Path

EMAIL = re.compile(r'[A-Za-z0-9.!#$%&\x27*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
CANCEL = re.compile(r'отмен(?:ите|яй|яйте|ить|яем|яю)|не\s+(?:надо|нужен|нужна|заказывайте|оформляйте)|наш[её]л[аи]?\s+альтернатив|отказываюсь', re.I)
PAUSE = re.compile(r'отлож|закажу\s+позже|пока\s+(?:не\s+оформ|только\s+спрашива|без\s+заказ)|не\s+оформля|не\s+соглас|передум|стоп|не\s+бер', re.I)
ACCEPT = re.compile(r'^(?:да|давай|хорошо|ок|окей|согласен|согласна|оформляйте|оформляем|бер[её]м)[\s!.,)]*$',re.I)

def ident(value):
    s=str(value)
    if not re.fullmatch(r'[0-9]{1,24}',s): raise ValueError('invalid numeric identifier')
    return s

def money(value):
    try: x=Decimal(str(value))
    except (InvalidOperation,ValueError): raise ValueError('invalid number')
    if not x.is_finite() or x <= 0: raise ValueError('invalid number')
    return x

def norm(value): return re.sub(r'[^A-ZА-Я0-9]', '',str(value or '').upper())

def enrich_item(item):
    out=copy.deepcopy(item)
    title=html.unescape(str(out.get('title') or '')).strip()
    out['title']=title
    # DROM renderer supplies Brand Article at the end; never infer by car model.
    words=title.split()
    if not out.get('article') and words and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.\-/]{1,39}',words[-1]) and any(c.isdigit() for c in words[-1]):
        out['article']=words[-1]
        if not out.get('brand') and len(words)>1 and re.fullmatch(r'[A-Za-z][A-Za-z0-9.\-]{1,39}',words[-2]):out['brand']=words[-2]
    raw_qty=out.get('qty',1)
    if isinstance(raw_qty,bool) or not re.fullmatch(r'[1-9][0-9]*',str(raw_qty)):raise ValueError('invalid quantity')
    out['qty']=int(raw_qty)
    return out

def fingerprint(c):
    data={k:c.get(k) for k in ['kind','dialog_id','deal','listing','items']}
    return hashlib.sha256(json.dumps(data,ensure_ascii=False,sort_keys=True).encode()).hexdigest()

def resolve_context(messages):
    c={'kind':'unknown','dialog_id':'','deal':None,'listing':None,'items':[], 'email':'','identity_email':'','cancelled':False,'paused':False,'latest_text':'','latest_message_id':'','selection_pending':False}
    incoming=sorted((m for m in messages if m.get('senderType')=='contact' and m.get('messageType')=='incoming' and not m.get('deletedAt')),key=lambda m:(m.get('createdAt',''),int(m.get('id') or 0)))
    for m in incoming:
        dc=(m.get('contentAttributes') or {}).get('dromContext') or {}
        if not isinstance(dc,dict):continue
        d=dc.get('deal');l=dc.get('listing')
        if d and isinstance(d,dict) and d.get('dealId'):
            if str((c.get('deal') or {}).get('dealId'))!=str(d['dealId']):
                c.update(deal=copy.deepcopy(d),listing=None,cancelled=False,paused=False,email='',identity_email='',selection_pending=False)
            else:c['deal'].update({k:v for k,v in d.items() if v is not None and v!=''})
            if d.get('email'):c['identity_email']=str(d['email']).strip()
            c['kind']='deal'
        elif isinstance(l,dict) and l.get('url'):
            old=(c.get('listing') or {}).get('url')
            if c.get('deal') and any(x.get('url') == l['url'] for x in c['deal'].get('items',[])):
                pass
            elif old != l['url']:
                c.update(deal=None,listing=copy.deepcopy(l),kind='listing',cancelled=False,paused=False,email='',identity_email='',selection_pending=False)
            elif c.get('listing'):c['listing'].update({k:v for k,v in l.items() if v is not None and v!=''})
        elif isinstance(l,dict) and not c.get('listing'):
            # Title-only deal header is not a new product listing.
            if not c['deal']:c['listing']=copy.deepcopy(l)
        if dc.get('dialogId'):c['dialog_id']=str(dc['dialogId'])
        text=str(m.get('text') or '')
        found=EMAIL.search(text)
        if found:
            c['email']=found.group(0)
            if EMAIL.fullmatch(text.strip()):c['identity_email']=text.strip()
            elif found.group(0).casefold()!=c['identity_email'].casefold():c['identity_email']=''
        if opens_choice(text, c.get('deal')):c['selection_pending']=True
        if PAUSE.search(text):c['paused']=True
        elif re.fullmatch(r'(?:оформляем|оформляйте|бер[её]м)[\s!.,)]*',text.strip(),re.I):c['paused']=False
        # Evaluate each clause; a negated delivery clause must not mask cancellation.
        for clause in re.split(r'[,;.!]',text):
            if not CANCEL.search(clause):continue
            if re.search(r'не\s+отмен',clause,re.I):continue
            if re.search(r'отмен(?:ите|яйте)\s+(?:только\s+)?дополнительн',clause,re.I):
                c['selection_pending']=True
                continue
            if PAUSE.search(clause) or '?' in clause or re.search(r'как\s+отмен',clause,re.I):c['paused']=True
            elif re.search(r'отмен(?:ите|яйте|яем|яю)\s+(?:весь\s+)?заказ|наш[её]л[аи]?\s+альтернатив|отказываюсь',clause,re.I):c['cancelled']=True
            else:c['paused']=True
        c['latest_text']=text;c['latest_message_id']=str(m.get('id') or '')
    deal=c.get('deal') or {}
    c['email']=c['email'] or str(deal.get('email') or '')
    c['buyer_name']=str(deal.get('buyerName') or '')
    c['phone']=str(deal.get('phone') or '')
    c['items']=[enrich_item(x) for x in (deal.get('items') or ([c['listing']] if c['listing'] and c['listing'].get('price') else []))]
    method=str(deal.get('deliveryMethod') or '').lower().replace('ё','е')
    c['delivery_type_id']=4 if re.search('сдэк|сдек|cdek',method) else 1 if 'самовывоз' in method else 3 if re.search('тк|tk|транспорт|пэк|энерг|делов',method) else None
    c['delivery_address']=str(deal.get('pickupAddress') or '')
    c['unsupported_delivery']=bool(re.search('озон|ozon|яндекс|yandex',method))
    c['fingerprint']=fingerprint(c)
    return c

def select_offer(rows,item) -> dict:
    qty=int(item['qty']); cap=money(item['price']);eligible=[]
    for original in rows:
        row=copy.deepcopy(original)
        if norm(row.get('oem'))!=norm(item.get('article')) or norm(row.get('make_name'))!=norm(item.get('brand')):continue
        try:
            cost=money(row.get('cost')); lo=Decimal(str(row.get('min_delivery_day')));hi=Decimal(str(row.get('max_delivery_day')))
            stock=Decimal(str(row.get('qnt')));minimum=Decimal(str(row.get('min_qnt') or 1))
            if not all(x.is_finite() for x in [lo,hi,stock,minimum]):continue
            if not (0<=lo<=hi<=5 and minimum<=qty<=stock):continue
            if minimum<1:continue
            if any(not str(row.get(k) or '').strip() for k in ['price_id','hash_key','guid_id','price_request_id','sys_info']):continue
        except (ValueError,InvalidOperation,TypeError):continue
        eligible.append((cost,row))
    if not eligible:return {'mode':'no_offer','client_hint':'Подходящего предложения на нужное количество со сроком 0-5 дней нет. Не утверждай, что попытка добавления в корзину уже была.'}
    cost,row=min(eligible,key=lambda pair:pair[0])
    sell=cap if cost<=cap else cost
    row['cost']=format(sell,'f');row['qnt']=qty
    return {'mode':'drom_price' if cost<=cap else 'await_price_confirm','supplier_cost':format(cost,'f'),'sell_price':format(sell,'f'),'quantity':qty,'price_row':row,
            'client_hint':('Клиенту только цена ДРОМ. Не предлагай ниже, не показывай меню вариантов или остаток поставщика. После проверки контактов продолжай корзину и оформление.' if cost<=cap else 'Цена выше ДРОМ: сообщи новую цену и срок, дождись отдельного согласия. До согласия корзину не добавлять.')}

from drom_checkout import CheckoutMixin, opens_choice

class DromTools(CheckoutMixin):
    def __init__(self,transport,cache):
        self.t=transport;self.cache=Path(cache);self.cache.mkdir(parents=True,exist_ok=True,mode=0o700)
    @contextmanager
    def locked(self):
        with (self.cache/'.lock').open('a') as f:
            fcntl.flock(f,fcntl.LOCK_EX)
            try:yield
            finally:fcntl.flock(f,fcntl.LOCK_UN)
    def persist(self,path,data):
        tmp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.new')
        fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f:
            json.dump(data,f,ensure_ascii=False);f.flush();os.fsync(f.fileno())
        os.replace(tmp,path)
        directory=os.open(self.cache,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(directory)
        finally:os.close(directory)
    def save(self,ref,data):
        self.persist(self.cache/(ref+'.json'),data)
    def load(self,ref):
        if not re.fullmatch(r'[co]_[a-f0-9]{32}',ref or ''):raise ValueError('invalid ref')
        try:return json.loads((self.cache/(ref+'.json')).read_text())
        except FileNotFoundError:raise ValueError('unknown ref')
    def context(self,conversation_id,contact_id):
        conversation_id=ident(conversation_id);contact_id=ident(contact_id)
        messages,binding=self.t.context(conversation_id,contact_id)
        c=resolve_context(messages)
        if c['kind']=='unknown':raise ValueError('no verified DROM card or deal')
        ref='c_'+uuid.uuid4().hex
        c.update(context_ref=ref,conversation_id=conversation_id,contact_id=contact_id,binding=binding,created_at=time.time())
        self.save(ref,c)
        c['client_hint']='ДРОМ: данные сделки уже заданы, их не переспрашивай. Отмена блокирует новое оформление. Email спроси только если отсутствует. Ник карточки не ФИО. Карточка без сделки не подтверждает покупку.'
        return c
    def current(self,c,mutation=False):
        messages,binding=self.t.context(c['conversation_id'],c['contact_id']);fresh=resolve_context(messages)
        if fresh['cancelled']:raise ValueError('cancelled: новое оформление запрещено')
        if mutation and fresh['selection_pending'] and not self.selection_authorized({**c,'binding':binding},messages):raise ValueError('selection pending: требуется подтверждённый полный состав')
        if mutation and fresh['paused']:raise ValueError('paused: клиент отложил оформление')
        if fresh['fingerprint']!=c['fingerprint']:raise ValueError('context changed: повтори чтение контекста')
        if mutation and binding!=c['binding']:raise ValueError('verified binding changed: повтори проверку личности')
        fresh['binding']=binding
        return fresh
    def quote(self,context_ref,item_index):
        c=self.load(context_ref);fresh=self.current(c)
        if isinstance(item_index,bool) or not isinstance(item_index,int) or not 0<=item_index<len(c['items']):raise ValueError('invalid item index')
        item=c['items'][item_index]
        if not item.get('article') or not item.get('brand'):raise ValueError('article/brand missing: уточни данные карточки, не угадывай')
        r=select_offer(self.t.prices(item['article'],item['brand']),item)
        if r['mode']=='no_offer':return r
        ref='o_'+uuid.uuid4().hex
        r['proposal_text']=f"Предложение: {item['brand']} {item['article']}, {item['qty']} шт., {r['sell_price']} руб./шт., срок {r['price_row']['min_delivery_day']}-{r['price_row']['max_delivery_day']} дней."
        r['proposal_text']+=f" Предложение {ref[2:14]}."
        r['acceptance_text']=f"Подтверждаю покупку: {item['brand']} {item['article']}, {item['qty']} шт., {r['sell_price']} руб./шт., предложение {ref[2:14]}."
        r.update(offer_ref=ref,context_ref=context_ref,item_index=item_index,created_at=time.time(),quote_message_id=fresh['latest_message_id'],status='quoted')
        self.save(ref,r)
        return r
    def verified(self,fresh):
        b=fresh['binding']
        if not b.get('customer_id') or b.get('verified') not in ['phone','email']:raise ValueError('verified customer binding required')
        if not fresh.get('email') and not b.get('email'):raise ValueError('missing email')
        return ident(b['customer_id'])
    def proposal_accepted(self,c,r):
        messages,_=self.t.context(c['conversation_id'],c['contact_id'])
        ordered=sorted((m for m in messages if not m.get('deletedAt')),key=lambda m:(m.get('createdAt',''),int(m.get('id') or 0)))
        quoted=False;shown=False;accepted=False
        for m in ordered:
            if str(m.get('id'))==r['quote_message_id']:quoted=True;continue
            if not quoted:continue
            text=str(m.get('text') or '').strip()
            if m.get('messageType')=='outgoing' and m.get('senderType') in ['bot','user'] and text==r['proposal_text']:shown=True;continue
            if m.get('messageType')=='incoming' and m.get('senderType')=='contact':
                accepted=shown and text==r['acceptance_text']
                shown=False
        return accepted
    def basket_key(self,c,item):
        identity=str(item.get('url') or (norm(item.get('brand'))+'|'+norm(item.get('article'))))
        identities=[str(x.get('url') or (norm(x.get('brand'))+'|'+norm(x.get('article')))) for x in c['items']]
        if identities.count(identity)!=1:raise ValueError('ambiguous item identity: reconcile basket')
        scope=f"{c['conversation_id']}|{c['dialog_id']}|{(c.get('deal') or {}).get('dealId') or (c.get('listing') or {}).get('url')}|{identity}"
        return hashlib.sha256(scope.encode()).hexdigest()
    def fresh_offer(self,r,c):
        row=r['price_row'];keys=['price_id','guid_id','hash_key','oem','make_name']
        matches=[x for x in self.t.prices(row['oem'],row['make_name']) if all(str(x.get(k))==str(row.get(k)) for k in keys)]
        if len(matches)!=1:raise ValueError('offer withdrawn or ambiguous: repeat quote')
        chosen=select_offer(matches,r['item'] if r.get('mode')=='extra' else c['items'][r['item_index']])
        if chosen.get('mode')=='no_offer' or chosen.get('supplier_cost')!=r['supplier_cost'] or any(str(chosen['price_row'].get(k))!=str(row.get(k)) for k in ['min_delivery_day','max_delivery_day','min_qnt']):raise ValueError('offer changed: repeat quote and consent')
    def check_basket(self,bid,cid,row):
        b=self.t.basket(bid);p=b.get('price_result') or {};merged={**p,**{k:v for k,v in b.items() if v is not None}}
        if str(b.get('customer_id'))!=str(cid):raise ValueError('basket owner mismatch')
        if any(norm(merged.get(k))!=norm(row.get(k)) for k in ['oem','make_name']):raise ValueError('basket item mismatch')
        if money(merged.get('cost'))!=money(row['cost']) or Decimal(str(merged.get('qnt')))!=Decimal(str(row['qnt'])):raise ValueError('basket price/quantity mismatch')
        for k in ['price_id','guid_id','hash_key','min_delivery_day','max_delivery_day']:
            if str(merged.get(k))!=str(row.get(k)):raise ValueError('basket supplier/delivery mismatch')
        return b
    def add(self,offer_ref,confirmed=False):
        with self.locked():
            r=self.load(offer_ref);c=self.load(r['context_ref'])
            if r.get('mode')=='extra':return self.add_extra(r,c)
            fresh=self.current(c,mutation=True)
            needs=r['mode']=='await_price_confirm' or c['kind']=='listing'
            messages,_=self.t.context(c['conversation_id'],c['contact_id'])
            plan=self.accepted_plan(c,messages) if c['kind']=='deal' else None
            consent=self.proposal_accepted(c,r) or bool(plan and offer_ref in plan.get('native_offers',[]))
            if needs and not (confirmed is True and consent):
                raise ValueError('confirm: нужно отдельное согласие клиента после предложения')
            if plan and plan['native_rows'].get(str(r['item_index']))!=r['price_row']:
                raise ValueError('accepted composition plan has different native offer')
            if not needs and fresh['latest_message_id']!=r['quote_message_id'] and not plan:
                raise ValueError('confirm: conversation changed since quote')
            cid=self.verified(fresh)
            if r.get('basket_id'):
                self.check_basket(r['basket_id'],cid,r['price_row']);return {'status':'already_added','basket_id':r['basket_id']}
            if time.time()-r['created_at']>900:raise ValueError('offer expired: repeat quote')
            self.fresh_offer(r,c)
            if self.attempt_path(c).exists():raise ValueError('checkout attempt exists: no new basket writes')
            # One persisted basket record per conversation/deal/item, even after requote.
            key=self.basket_key(c,c['items'][r['item_index']])
            marker=self.cache/('basket-'+key+'.json')
            if marker.exists():
                old=json.loads(marker.read_text())
                if old.get('row')!=r['price_row']:raise ValueError('item revision changed: reconcile existing basket before any write')
                if old.get('basket_id'):
                    self.check_basket(old['basket_id'],cid,old['row']);r['basket_id']=old['basket_id'];self.save(offer_ref,r)
                    return {'status':'already_added','basket_id':old['basket_id']}
                raise ValueError('previous add outcome unknown: verify remotely before retry')
            final=self.current(c,mutation=True)
            if final['latest_message_id']!=fresh['latest_message_id']:raise ValueError('conversation changed during basket preflight')
            self.persist(marker,{'status':'adding','row':r['price_row'],'item_revision':self.item_revision(c['items'][r['item_index']]),'offer_ref':offer_ref})
            bid=ident(self.t.add(cid,r['price_row']))
            r['basket_id']=bid;r['status']='added';self.save(offer_ref,r)
            self.persist(marker,{'status':'added','basket_id':bid,'row':r['price_row'],'item_revision':self.item_revision(c['items'][r['item_index']]),'offer_ref':offer_ref})
            self.check_basket(bid,cid,r['price_row'])
            return {'status':'added','basket_id':bid,'cost':r['sell_price'],'quantity':r['quantity']}
    def checkout(self,context_ref):
        with self.locked():
            c=self.load(context_ref);fresh=self.current(c,mutation=True);cid=self.verified(fresh)
            if not c['items']:raise ValueError('empty deal: no checkout')
            if c['kind']!='deal':raise ValueError('listing: согласуй контакты, доставку и оформление обычным сценарием; автоматического заказа нет')
            if c.get('unsupported_delivery') or not c.get('delivery_type_id'):raise ValueError('delivery confirmation required')
            marker='DROM deal:'+str(c['deal']['dealId'])
            existing=self.t.existing(cid,marker)
            if existing:return {'status':'already_created','orders':existing,'client_hint':'Не создавай повторный заказ. Прочитай существующий заказ и проверь принадлежность.'}
            form={'order[customer_id]':cid,'order[delivery_type_id]':str(c['delivery_type_id']),'put_to_work':'0','order[comment]':f"Заказ {marker} | {c['deal'].get('orderUrl','')} | {c.get('delivery_address','')}"}
            if c['delivery_type_id']==1:form['order[delivery_point_id]']='1'
            if c.get('delivery_address'):form['order[delivery_address]']=c['delivery_address']
            for idx in range(len(c['items'])):
                k=self.basket_key(c,c['items'][idx]);p=self.cache/('basket-'+k+'.json')
                if not p.exists():raise ValueError('not all deal items are in basket')
                b=json.loads(p.read_text());bid=b.get('basket_id')
                if not bid:raise ValueError('basket outcome unknown')
                self.check_basket(bid,cid,b['row']);form[f'baskets[{bid}][check]']='1'
            raise ValueError('idempotency integration unavailable: createOrder запрещён; форма не выдаётся, требуется защищённый путь создания с durable guard и readback')
