"""Fixed-origin HTTP transport. API/DB writes are restricted to basket add and protected order creation."""
from __future__ import annotations
import json
import logging
import re
from pathlib import Path
import httpx
from drom_tools import ident, resolve_context
from drom_checkout import marker_present

class DromTransport:
    def __init__(self, env=None, cbx='https://chatbotx.gkamion.ru/api', admin=None, prices='https://admin.gkamion.ru/backend/v3/admin/3.0.1', write_enabled=False):
        if env is None:
            env={}
            for line in Path('/opt/data/.env').read_text().splitlines():
                if '=' in line and not line.lstrip().startswith('#'):
                    k,v=line.split('=',1);env[k.strip()]=v.strip().strip('\"\x27')
        self.write_enabled=write_enabled is True
        self.env=env;self.cbx=cbx.rstrip('/');self.admin=(admin or env['GKAMION_BASE_URL']).rstrip('/');self.pb=prices.rstrip('/')
        # httpx INFO logs include the catalog token in the URL query.
        logging.getLogger('httpx').setLevel(logging.WARNING)
        logging.getLogger('httpcore').setLevel(logging.WARNING)
        self.http=httpx.Client();self.auth=(env['GKAMION_USERNAME'],env['GKAMION_PASSWORD'])
    def get(self,url,**kw):
        r=self.http.get(url,timeout=45,**kw)
        if not r.is_success:raise ValueError(f'read failed HTTP {r.status_code}')
        return r.json(parse_float=str)
    def cbx_get(self,path,params=None):
        return self.get(self.cbx+path,params=params,headers={'Authorization':'Bearer '+self.env['CHATBOTX_API_KEY']})
    def context(self,conversation_id,contact_id):
        conversation_id=ident(conversation_id);contact_id=ident(contact_id)
        conv=self.cbx_get('/v1/conversations/'+conversation_id).get('data') or {}
        if str(conv.get('contactId'))!=contact_id:raise ValueError('conversation/contact ownership mismatch')
        if not any(x.get('channel')=='drom' for x in conv.get('contactInboxes',[])):raise ValueError('not a DROM conversation')
        messages=[];cursor=None;seen=set();cursors=set()
        for _ in range(100):
            params={'perPage':50}
            if cursor:params['cursor']=cursor
            data=self.cbx_get('/v1/conversations/'+conversation_id+'/messages',params=params)
            rows=data.get('data')
            if not isinstance(rows,list):raise ValueError('message schema mismatch')
            if any(str(m.get('conversationId'))!=conversation_id for m in rows):raise ValueError('foreign conversation messages')
            messages.extend(m for m in rows if str(m['id']) not in seen);seen.update(str(m['id']) for m in rows)
            nxt=data.get('nextCursor')
            if not nxt:break
            if nxt in cursors:raise ValueError('message pagination stalled')
            cursors.add(nxt)
            cursor=nxt
        else:raise ValueError('history incomplete: refuse incomplete DROM context')
        fields=self.cbx_get('/v1/contacts/id:'+contact_id+'/custom-fields').get('data') or []
        fields={x['name']:x.get('value') for x in fields}
        binding={'customer_id':fields.get('gkamion_customer_id'),'verified':fields.get('gkamion_verified')}
        if binding['customer_id'] and binding['verified'] in ['phone','email']:
            cid=ident(binding['customer_id']);d=self.get(self.admin+'/customers/'+cid+'.json',auth=self.auth)
            customer=d.get('customer') or d.get('data') or d
            if str(customer.get('id'))!=cid:raise ValueError('customer identity mismatch')
            facts=resolve_context(messages)
            if binding['verified']=='email':
                evidence=facts.get('identity_email') or ''
                if not evidence or evidence.casefold()!=str(customer.get('email') or '').casefold():binding['verified']='';binding['evidence_error']='email mismatch'
            else:
                def clean(value):
                    digits=re.sub(r'\D','',str(value or ''))
                    return digits[1:] if len(digits)==11 and digits[0] in '78' else digits
                if not facts.get('phone') or clean(facts['phone'])!=clean(customer.get('phone') or customer.get('phone_number')):binding['verified']='';binding['evidence_error']='phone mismatch'
            binding['email']=customer.get('email') or ''
        return messages,binding
    def prices(self,article,brand):
        data=self.get(self.admin+'/users/api_token',auth=self.auth)
        token=data.get('token')
        if not token:raise ValueError('catalog authentication failed')
        data=self.get(self.pb+'/price_search/search',params={'oem':article,'make_name':brand,'with_cross':'false','disable_two_step_request':'true','app_token':token})
        if not isinstance(data,dict) or not isinstance(data.get('data'),list):raise ValueError('catalog response incomplete')
        return data['data']
    def add(self,customer_id,row):
        if not self.write_enabled:raise ValueError('release_blocked: transport writes disabled')
        # This is the n8n buildCreateBasketForm contract. Do not fresh-search and
        # replace an already chosen source with a cheaper/different offer.
        required=['oem','make_name','detail_name','cost','min_delivery_day','max_delivery_day','price_id','hash_key','guid_id','price_request_id','sys_info']
        if any(row.get(k) is None or row.get(k)=='' for k in required):raise ValueError('offer missing checkout metadata')
        form={'customer_id':ident(customer_id),'qnt':str(row['qnt'])}
        for k in required+['qnt','min_qnt','first_cost']:
            v=row.get(k)
            if v is not None:form[f'price_result[{k}]']=json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else str(v)
        r=self.http.post(self.admin+'/baskets',auth=self.auth,files={k:(None,v) for k,v in form.items()},timeout=30)
        if not r.is_success:raise ValueError(f'basket add failed HTTP {r.status_code}: do not retry blindly')
        bid=(r.json(parse_float=str).get('basket') or {}).get('id')
        if not bid:raise ValueError('basket add returned no id: outcome unknown')
        return ident(bid)
    def basket(self,basket_id):
        d=self.get(self.admin+'/baskets/'+ident(basket_id)+'.json',auth=self.auth)
        return d.get('basket') or d.get('data') or d
    def existing(self,customer_id,marker):
        found=[]
        for page in range(1,101):
            d=self.get(self.admin+'/orders.json',auth=self.auth,params={'search[customer_id_eq]':ident(customer_id),'search[comment_cont]':marker,'per_page':100,'page':page})
            rows=d.get('orders')
            if not isinstance(rows,list):raise ValueError('cannot verify existing orders')
            for row in rows:
                # Order list may omit a comment: read only this customer's row.
                if str(row.get('customer_id') or (row.get('customer') or {}).get('id'))!=str(customer_id):raise ValueError('order filter mismatch')
                if 'comment' not in row:
                    detail=self.get(self.admin+'/orders/'+ident(row['id'])+'.json',auth=self.auth);row=detail.get('order') or detail
                    if str(row.get('customer_id') or (row.get('customer') or {}).get('id'))!=str(customer_id):raise ValueError('order owner mismatch')
                if marker_present(row.get('comment'),marker):found.append({'id':row['id']})
            if len(rows)<100:return found
        raise ValueError('existing order search incomplete: no checkout')

    def create_order(self, form):
        """Only called by protected checkout after its durable reservation.

        No redirects/retries; no arbitrary endpoint or externally supplied form.
        """
        if not self.write_enabled:
            raise ValueError('release_blocked: transport writes disabled')
        allowed={'order[customer_id]','order[delivery_type_id]','order[delivery_point_id]','order[comment]','put_to_work'}
        if any(k not in allowed and not re.fullmatch(r'baskets\[[0-9]+\]\[check\]',k) for k in form):
            raise ValueError('protected order form scope violation')
        if form.get('put_to_work')!='0' or not any(k.startswith('baskets[') for k in form):
            raise ValueError('protected order form invalid')
        response=self.http.post(self.admin+'/orders',auth=self.auth,
                                files={k:(None,str(v)) for k,v in form.items()},timeout=30)
        if not response.is_success:
            raise ValueError(f'order POST HTTP {response.status_code}: outcome requires reconciliation')
        body=response.json(parse_float=str)
        value=(body.get('order') or (body.get('data') or {}).get('order') or {}).get('id') or body.get('id')
        return ident(value) if value is not None else None

    def order(self, order_id):
        body=self.get(self.admin+'/orders/'+ident(order_id)+'.json',auth=self.auth)
        return body.get('order') or body.get('data') or body
