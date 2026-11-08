"""Protected DROM checkout and explicit extra-item selection.

The scope journal is never deleted or retried after a possibly submitted POST.
All writers must share the same persistent cache directory and flock domain.
"""
import copy
import hashlib
import html
import json
import re
import time
import uuid
from decimal import Decimal

CHOICE = re.compile(r'добав|ещ[её]|друг(?:ую|ой|ая)|выб(?:ор|рать)|посовет|вместо|убер|исключ(?!ительно)|замен|помен|отмен(?:ите|яйте)\s+(?:только\s+)?дополнительн', re.I)
ARTICLE_TOKEN = re.compile(r'[A-Za-z0-9][A-Za-z0-9./-]{4,}')
OFFER_ID = re.compile(r'(?:предложение|состав)\s+[0-9a-fA-F]{8,}', re.I)


def item_article_key(item):
    if not isinstance(item, dict):
        return ''
    raw = item.get('article')
    if not raw:
        words = html.unescape(str(item.get('title') or '')).split()
        if words and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.\-/]{1,39}', words[-1]) and any(ch.isdigit() for ch in words[-1]):
            raw = words[-1]
    return re.sub(r'\s+', '', str(raw or '')).upper().strip('.,;:')


def opens_choice(text, deal):
    """Cue words or an article that is not already on this deal.

    Digit-only OEM numbers count: live n8n skips them, and that dropped real
    extras. The deal's own article, phone, deal id and price do not reopen a
    choice. Offer ids we append are not articles.
    """
    raw = str(text or '')
    if CHOICE.search(raw):
        return True
    from drom_tools import EMAIL
    rest = OFFER_ID.sub(' ', EMAIL.sub(' ', raw))
    items = (deal or {}).get('items') or []
    known = {item_article_key(item) for item in items}
    known.discard('')
    if not known:
        return False
    ignored = set()
    deal_id = re.sub(r'\D', '', str((deal or {}).get('dealId') or ''))
    if len(deal_id) >= 5:
        ignored.add(deal_id)
    phone = re.sub(r'\D', '', str((deal or {}).get('phone') or ''))
    if phone:
        ignored.add(phone)
        if len(phone) >= 10:
            ignored.add(phone[-10:])
    for item in items:
        price = re.sub(r'\D', '', str(item.get('price') or ''))
        if len(price) >= 5:
            ignored.add(price)

    def foreign(segment):
        if len(segment) < 5 or len(segment) == 17 or segment in known or not re.search(r'\d', segment):
            return False
        digits = re.sub(r'\D', '', segment)
        if digits and (digits in ignored or (len(digits) >= 10 and digits[-10:] in ignored)):
            return False
        return True

    for token in ARTICLE_TOKEN.findall(rest):
        key = re.sub(r'\s+', '', token).upper().strip('.,;:')
        if not key or key in known:
            continue
        segments = [part for part in re.split(r'[-/]', key) if part] or [key]
        if any(foreign(part) for part in segments):
            return True
    return False


def ordered(messages):
    return sorted((m for m in messages if not m.get('deletedAt')),
                  key=lambda m: (m.get('createdAt', ''), int(m.get('id') or 0)))


def incoming(m):
    return m.get('senderType') == 'contact' and m.get('messageType') == 'incoming'


def marker_present(comment, marker):
    return bool(re.search(r'(?<![\w:])' + re.escape(marker) + r'(?=$|\s|[|;\]])', str(comment or '')))


class CheckoutMixin:
    def item_revision(self,item):
        from drom_tools import norm,money
        return [norm(item['article']),norm(item['brand']),str(item['qty']),format(money(item['price']),'f')]

    def scope_key(self, c):
        from drom_tools import ident
        if c['kind'] != 'deal':
            raise ValueError('native deal required: no automatic listing checkout')
        scope = ['drom', ident(c['dialog_id']), ident(c['deal']['dealId'])]
        return hashlib.sha256(json.dumps(scope).encode()).hexdigest()

    def attempt_path(self, c):
        return self.cache / ('checkout-' + self.scope_key(c) + '.json')

    def plan_path(self, c):
        return self.cache / ('plan-' + self.scope_key(c) + '.json')

    def pending_requests(self, c, messages):
        # Resolve the currently attached deal only. Old conversations/deals must
        # not contribute requests or consent to this purchase.
        from drom_tools import resolve_context
        result = []
        prefix = []
        for m in ordered(messages):
            prefix.append(m)
            if not incoming(m):
                continue
            facts = resolve_context(prefix)
            if facts['kind'] == 'deal' and facts['dialog_id'] == c['dialog_id'] and str(facts['deal']['dealId']) == str(c['deal']['dealId']):
                if opens_choice(str(m.get('text') or ''), facts.get('deal')):
                    result.append(str(m['id']))
            else:
                result = []
        return result

    def accepted_plan(self, c, messages):
        p = self.plan_path(c)
        if not p.exists():
            return None
        plan = json.loads(p.read_text())
        if plan['fingerprint'] != c['fingerprint'] or plan['binding'] != c['binding']:
            return None
        if plan['requests'] != self.pending_requests(c, messages):
            return None
        shown = False
        accepted = False
        after_quote = False
        for m in ordered(messages):
            if str(m.get('id')) == plan['quote_message_id']:
                after_quote = True
                continue
            if not after_quote:
                continue
            text = str(m.get('text') or '').strip()
            if m.get('messageType') == 'outgoing' and m.get('senderType') in ['user', 'bot'] and text == plan['proposal_text']:
                shown = True
                continue
            if incoming(m):
                # Any subsequent contact message invalidates that approval until
                # a new complete proposal is shown. No guessed negation scope.
                accepted = shown and text == plan['acceptance_text']
                shown = False
        return plan if accepted else None

    def selection_authorized(self, c, messages):
        if not self.pending_requests(c, messages):
            return True
        return self.accepted_plan(c, messages) is not None

    def extra_quote(self, context_ref, request_message_id, article, brand, quantity):
        from drom_tools import enrich_item, ident, select_offer
        with self.locked():
            c = self.load(context_ref)
            self.current(c)
            self.verified(c)
            if self.attempt_path(c).exists():
                raise ValueError('checkout attempt exists: extras frozen')
            messages, _ = self.t.context(c['conversation_id'], c['contact_id'])
            request_message_id = ident(request_message_id)
            if request_message_id not in self.pending_requests(c, messages):
                raise ValueError('extra must reference an open request of this deal')
            if not isinstance(article, str) or not isinstance(brand, str) or not re.fullmatch(r'[A-Za-zА-Яа-я0-9.\-/ ]{1,80}', article + brand):
                raise ValueError('invalid article/brand')
            item = enrich_item({'article': article, 'brand': brand, 'qty': quantity, 'price': '0.01'})
            r = select_offer(self.t.prices(article, brand), item)
            if r['mode'] == 'no_offer':
                return r
            # Extras use their own selected offer's sale price and literal qty.
            # Never inherit the native deal's DROM reference price or quantity.
            item['price'] = r['supplier_cost']
            r['sell_price'] = r['supplier_cost']
            r['price_row']['cost'] = r['sell_price']
            r.update(mode='extra', item=item, request_message_id=request_message_id,
                     context_ref=context_ref, offer_ref='o_' + uuid.uuid4().hex,
                     created_at=time.time(), status='quoted')
            self.save(r['offer_ref'], r)
            return r

    def plan_quote(self, context_ref, extra_offer_refs, dropped_request_ids, native_offer_refs=None):
        from drom_tools import ident
        with self.locked():
            c = self.load(context_ref)
            fresh = self.current(c)
            self.verified(fresh)
            if fresh['binding'] != c['binding']:
                raise ValueError('verified binding changed')
            if fresh['paused']:
                raise ValueError('paused: no selection proposal')
            if self.attempt_path(c).exists():
                raise ValueError('checkout attempt exists: composition frozen')
            if not isinstance(extra_offer_refs, list) or not isinstance(dropped_request_ids, list):
                raise ValueError('selection lists required')
            if len(extra_offer_refs) > 20 or len(set(extra_offer_refs)) != len(extra_offer_refs):
                raise ValueError('invalid extra selection')
            messages, _ = self.t.context(c['conversation_id'], c['contact_id'])
            requests = self.pending_requests(c, messages)
            dropped = [ident(x) for x in dropped_request_ids]
            if len(set(dropped)) != len(dropped):
                raise ValueError('duplicate dropped request')
            extras = []
            mapped = set()
            for ref in extra_offer_refs:
                r = self.load(ref)
                other = self.load(r['context_ref'])
                if r.get('mode') != 'extra' or self.scope_key(other) != self.scope_key(c) or other['conversation_id'] != c['conversation_id'] or other['contact_id'] != c['contact_id'] or other['binding'] != c['binding'] or other['fingerprint'] != c['fingerprint']:
                    raise ValueError('foreign or stale extra offer')
                if time.time() - r['created_at'] > 900:
                    raise ValueError('extra offer expired')
                mapped.add(r['request_message_id'])
                self.fresh_offer(r, c)
                extras.append(r)
            if mapped & set(dropped) or mapped | set(dropped) != set(requests):
                raise ValueError('selection: every open request must be included or explicitly dropped')
            # Same part may not be represented twice under two offer refs or
            # split between native deal and extra. Ask to resolve quantity.
            from drom_tools import norm
            keys = [(norm(x.get('brand')), norm(x.get('article'))) for x in c['items']]
            keys += [(norm(r['item']['brand']), norm(r['item']['article'])) for r in extras]
            if len(set(keys)) != len(keys):
                raise ValueError('ambiguous duplicate part: clarify total quantity')
            native = {}
            for ref in native_offer_refs or []:
                quote = self.load(ref)
                original = self.load(quote['context_ref'])
                if quote.get('mode') not in ['drom_price','await_price_confirm'] or original['fingerprint'] != c['fingerprint'] or original['binding'] != c['binding'] or original['conversation_id'] != c['conversation_id'] or original['contact_id'] != c['contact_id']:
                    raise ValueError('foreign or stale native offer')
                index = quote['item_index']
                if index in native or time.time()-quote['created_at'] > 900:
                    raise ValueError('duplicate or expired native offer')
                self.fresh_offer(quote,c)
                native[index] = quote
            native_rows={}
            lines = ['Состав заказа:']
            for index,item in enumerate(c['items']):
                if index in native:
                    row = native[index]['price_row']
                else:
                    record_path = self.cache / ('basket-'+self.basket_key(c,item)+'.json')
                    if not record_path.exists():
                        raise ValueError('native offer refs required before base basket is added')
                    record=json.loads(record_path.read_text())
                    if record.get('item_revision') != self.item_revision(item):
                        raise ValueError('native basket revision changed')
                    row=record['row']
                native_rows[str(index)]=copy.deepcopy(row)
                lines.append(f"Исходная позиция: {item['brand']} {item['article']}, {item['qty']} шт., {row['cost']} руб./шт., срок {row['min_delivery_day']}-{row['max_delivery_day']} дней.")
            for r in extras:
                x = r['item']; row = r['price_row']
                lines.append(f"Дополнительно: {x['brand']} {x['article']}, {x['qty']} шт., {r['sell_price']} руб./шт., срок {row['min_delivery_day']}-{row['max_delivery_day']} дней.")
            by_id = {str(m['id']): m for m in messages}
            for request in dropped:
                lines.append('Без добавления по запросу: ' + str(by_id[request].get('text') or '').strip())
            plan = dict(plan_ref='p_' + uuid.uuid4().hex, fingerprint=c['fingerprint'], binding=c['binding'],
                        requests=requests, native_rows=native_rows, extras=extra_offer_refs, dropped=dropped, native_offers=[x['offer_ref'] for x in native.values()],
                        quote_message_id=fresh['latest_message_id'])
            # A unique proposal token prevents a reply to a previously displayed
            # same-price alternative from authorizing a new retained offer.
            public_code = plan['plan_ref'][2:14]
            plan['proposal_text'] = '\n'.join(lines) + f'\nПодтвердите состав {public_code}.'
            plan['acceptance_text'] = f'Подтверждаю состав {public_code}'
            self.persist(self.plan_path(c), plan)
            return plan

    def extra_basket_key(self, c, r):
        from drom_tools import norm
        part = norm(r['item']['brand']) + '|' + norm(r['item']['article'])
        return hashlib.sha256((self.scope_key(c) + '|extra|' + part).encode()).hexdigest()

    def add_extra(self, r, c):
        fresh = self.current(c, mutation=True)
        cid = self.verified(fresh)
        messages, _ = self.t.context(c['conversation_id'], c['contact_id'])
        plan = self.accepted_plan(c, messages)
        if not plan or r['offer_ref'] not in plan['extras']:
            raise ValueError('selection: extra not in accepted complete composition')
        key = self.extra_basket_key(c, r)
        path = self.cache / ('basket-' + key + '.json')
        if path.exists():
            record = json.loads(path.read_text())
            if record['row'] != r['price_row']:
                raise ValueError('extra revision changed: reconcile existing basket')
            if not record.get('basket_id'):
                raise ValueError('extra add outcome unknown: no retry')
            self.check_basket(record['basket_id'], cid, record['row'])
            return {'status': 'already_added', 'basket_id': record['basket_id']}
        if self.attempt_path(c).exists():
            raise ValueError('checkout attempt exists: no new basket writes')
        if time.time() - r['created_at'] > 900:
            raise ValueError('extra offer expired')
        self.fresh_offer(r, c)
        final=self.current(c, mutation=True)
        if final['latest_message_id']!=fresh['latest_message_id']:
            raise ValueError('conversation changed during extra basket preflight')
        messages,binding=self.t.context(c['conversation_id'],c['contact_id'])
        current_plan=self.accepted_plan(c,messages)
        if binding!=fresh['binding'] or not current_plan or current_plan['plan_ref']!=plan['plan_ref'] or r['offer_ref'] not in current_plan['extras']:
            raise ValueError('selection plan no longer current before extra POST')
        self.persist(path, {'status': 'adding', 'row': r['price_row'], 'offer_ref': r['offer_ref']})
        from drom_tools import ident
        bid = ident(self.t.add(cid, r['price_row']))
        self.persist(path, {'status': 'added', 'row': r['price_row'], 'basket_id': bid, 'offer_ref': r['offer_ref']})
        self.check_basket(bid, cid, r['price_row'])
        return {'status': 'added', 'basket_id': bid, 'cost': r['sell_price'], 'quantity': r['quantity']}

    def checkout_snapshot(self, c, fresh):
        from drom_tools import ident
        cid = self.verified(fresh)
        if not c['items']:
            raise ValueError('empty deal')
        if c.get('unsupported_delivery') or not c.get('delivery_type_id'):
            raise ValueError('delivery confirmation required')
        if c['delivery_type_id'] != 1 and not c.get('delivery_address'):
            raise ValueError('delivery address required')
        messages,_=self.t.context(c['conversation_id'],c['contact_id'])
        plan=self.accepted_plan(c,messages)
        items = []
        for index,item in enumerate(c['items']):
            path = self.cache / ('basket-' + self.basket_key(c, item) + '.json')
            if not path.exists():
                raise ValueError('not all deal items are in basket')
            record = json.loads(path.read_text())
            row = record['row']
            if record.get('item_revision') != self.item_revision(item):
                raise ValueError('native basket revision changed')
            # Bind each basket to the current native item revision as well as
            # checking remote owner, supplier, price and quantity.
            from drom_tools import norm, money
            if norm(row['oem']) != norm(item['article']) or norm(row['make_name']) != norm(item['brand']) or Decimal(str(row['qnt'])) != Decimal(item['qty']):
                raise ValueError('native basket revision changed')
            # A higher native price must have been explicitly approved at add.
            if money(row['cost']) < money(item['price']):
                raise ValueError('native sale price below DROM')
            if not record.get('basket_id'):
                raise ValueError('basket outcome unknown')
            if not record.get('offer_ref'):raise ValueError('native offer provenance missing')
            retained=self.load(record['offer_ref'])
            retained['item_index']=index
            if retained['mode']=='await_price_confirm' and not (self.proposal_accepted(c,retained) or bool(plan and plan['native_rows'].get(str(index))==row)):
                raise ValueError('price consent no longer current: no checkout')
            self.fresh_offer(retained,c)
            self.check_basket(record['basket_id'], cid, row)
            items.append({'basket_id': ident(record['basket_id']), 'row': row})
        messages, _ = self.t.context(c['conversation_id'], c['contact_id'])
        plan = self.accepted_plan(c, messages)
        if self.pending_requests(c, messages) and not plan:
            raise ValueError('selection: complete composition not accepted')
        if plan:
            for index,record in enumerate(items):
                if record['row']!=plan['native_rows'].get(str(index)):
                    raise ValueError('native basket differs from accepted composition plan')
        for ref in plan['extras'] if plan else []:
            r = self.load(ref)
            path = self.cache / ('basket-' + self.extra_basket_key(c, r) + '.json')
            if not path.exists():
                raise ValueError('selected extra missing from basket')
            record = json.loads(path.read_text())
            if record['row'] != r['price_row'] or not record.get('basket_id'):
                raise ValueError('extra basket revision/outcome mismatch')
            self.fresh_offer(r,c)
            self.check_basket(record['basket_id'], cid, record['row'])
            items.append({'basket_id': ident(record['basket_id']), 'row': record['row']})
        ids = [x['basket_id'] for x in items]
        if len(set(ids)) != len(ids):
            raise ValueError('duplicate basket identity')
        return {'customer_id': cid, 'items': items, 'delivery_type_id': str(c['delivery_type_id']),
                'delivery_point_id': '1' if c['delivery_type_id'] == 1 else None,
                'address': c['delivery_address'], 'fingerprint': c['fingerprint'],
                'binding': c['binding'], 'plan_ref': plan['plan_ref'] if plan else None,
                'latest_message_id': fresh['latest_message_id']}

    def order_offer_id(self,row,key):
        value=row.get(key) or (row.get('price_result') or {}).get(key)
        if value is None or value=='':raise ValueError('order offer identity missing: readback mismatch')
        return str(value)

    def verify_order(self, order, state):
        from drom_tools import ident, money, norm
        expected = state['expected']
        if ident(order.get('id')) != ident(state['order_id']):
            raise ValueError('order id mismatch')
        if str(order.get('customer_id')) != expected['customer_id']:
            raise ValueError('order owner mismatch')
        if order.get('comment') != state['form']['order[comment]']:
            raise ValueError('order marker/address mismatch')
        if expected['delivery_type_id']!='1':
            for field in ['delivery_address','order_address','delivery_address_full']:
                value=order.get(field)
                if isinstance(value,dict):
                    if not any(value.values()):continue
                    full_keys={'full','full_address','address'}
                    metadata={'id','order_id','created_at','updated_at'}
                    full_values=[v for k,v in value.items() if k in full_keys and v]
                    if not full_values or any(not isinstance(v,str) or v.strip()!=expected['address'].strip() for v in full_values):
                        raise ValueError('structured delivery address mismatch')
                    # Native input supplies one full PVZ string, not parsed
                    # city/street/house components. Never guess whether other
                    # populated structured fields are consistent with it.
                    if any(v for k,v in value.items() if k not in full_keys|metadata):
                        raise ValueError('structured delivery components mismatch: cannot verify')
                    continue
                if value and str(value).strip()!=expected['address'].strip():
                    raise ValueError('structured delivery address mismatch')
        if str(order.get('delivery_type_id')) != expected['delivery_type_id']:
            raise ValueError('order delivery mismatch')
        if expected['delivery_point_id'] and str(order.get('delivery_point_id')) != expected['delivery_point_id']:
            raise ValueError('order pickup mismatch')
        rows = order.get('order_items')
        if not isinstance(rows, list) or len(rows) != len(expected['items']):
            raise ValueError('order composition mismatch')
        def signature(row):
            qty = Decimal(str(row.get('qnt')))
            if not qty.is_finite() or qty < 1 or qty != qty.to_integral_value():
                raise ValueError('order quantity invalid')
            return (norm(row.get('oem')), norm(row.get('make_name')), money(row.get('cost')), qty,
                    str(row.get('price_id')), str(row.get('min_delivery_day')), str(row.get('max_delivery_day')),
                    self.order_offer_id(row,'guid_id'),self.order_offer_id(row,'hash_key'))
        if sorted(signature(r) for r in rows) != sorted(signature(x['row']) for x in expected['items']):
            raise ValueError('order item price/quantity/supplier/days mismatch')
        if order.get('sum') is not None:
            total = sum(money(x['row']['cost']) * Decimal(str(x['row']['qnt'])) for x in expected['items'])
            if Decimal(str(order['sum'])) != total:
                raise ValueError('order total mismatch')

    def reconcile_attempt(self, c, state):
        if state.get('status') == 'already_exists':
            return {'status': 'already_exists', 'orders': state.get('orders') or [],
                    'attempt_id': state.get('attempt_id'),
                    'client_hint': 'Новый заказ не создавать; требуется сверка существующего заказа.'}
        path = self.attempt_path(c)
        cid = state['expected']['customer_id']
        try:
            candidates = self.t.existing(cid, state['deal_marker'])
            ids = {str(x['id']) for x in candidates}
            if state.get('order_id'):
                ids.add(str(state['order_id']))
            if not ids:
                state['status'] = 'outcome_unknown'
            elif len(ids) != 1:
                state['status'] = 'readback_mismatch'
                state['error'] = 'multiple orders for this deal: no retry'
            else:
                oid = next(iter(ids))
                order = self.t.order(oid)
                state['order_id'] = oid
                self.verify_order(order, state)
                state['status'] = 'created_verified'
                state.pop('error', None)
        except Exception as exc:
            # Failed reads and schema mismatches never authorize a second POST.
            state['status'] = 'readback_mismatch' if isinstance(exc, ValueError) and 'mismatch' in str(exc) else 'outcome_unknown'
            state['error'] = type(exc).__name__
        state['checked_at'] = time.time()
        self.persist(path, state)
        result = {'status': state['status'], 'attempt_id': state['attempt_id'],
                  'client_hint': 'Не повторять createOrder. Успех допустим только при created_verified.'}
        if state['status'] == 'created_verified':
            result['order_id'] = state['order_id']
            result['delivery_address_record']='native_order_comment'
            result['client_hint']='Создание сверено. Адрес ПВЗ сохранён в нативном комментарии заказа; не утверждай отправку или изменение структурированного адреса.'
        return result

    def checkout_reconcile(self, context_ref):
        # Explicit read-only reconciliation is allowed after cancellation/pause;
        # identity and ownership must still be freshly verified before disclosure.
        from drom_tools import resolve_context
        with self.locked():
            c = self.load(context_ref)
            messages, binding = self.t.context(c['conversation_id'], c['contact_id'])
            fresh = resolve_context(messages); fresh['binding'] = binding
            self.verified(fresh)
            path = self.attempt_path(c)
            if not path.exists():
                return {'status': 'no_attempt'}
            state = json.loads(path.read_text())
            if binding != state['expected']['binding'] or self.scope_key(fresh) != self.scope_key(c):
                raise ValueError('verified binding/deal changed: no reconciliation disclosure')
            return self.reconcile_attempt(c, state)

    def checkout_create(self, context_ref, confirm=False):
        from drom_tools import ident
        if confirm is not True:
            raise ValueError('confirm=true required for protected createOrder')
        with self.locked():
            c = self.load(context_ref)
            fresh = self.current(c, mutation=True)
            cid = self.verified(fresh)
            path = self.attempt_path(c)
            if path.exists():
                state = json.loads(path.read_text())
                if fresh['binding'] != state['expected']['binding']:
                    raise ValueError('verified binding changed: checkout frozen')
                return self.reconcile_attempt(c, state)
            deal_marker = 'DROM deal:' + ident(c['deal']['dealId'])
            existing = self.t.existing(cid, deal_marker)
            if existing:
                # Pre-existing legacy records cannot be adopted by guessing their
                # lines or source. Journal the block before returning: a later
                # empty search must not become a second POST.
                state = {'version': 1, 'status': 'already_exists', 'attempt_id': uuid.uuid4().hex,
                         'deal_marker': deal_marker, 'orders': existing,
                         'expected': {'customer_id': cid, 'binding': fresh['binding']},
                         'created_at': time.time()}
                self.persist(path, state)
                return {'status': 'already_exists', 'orders': existing, 'client_hint': 'Новый заказ не создавать; требуется сверка существующего заказа.'}
            expected = self.checkout_snapshot(c, fresh)
            attempt_id = uuid.uuid4().hex
            if any(ch in expected['address'] for ch in '[]\r\n'):raise ValueError('ambiguous delivery address delimiters')
            comment = f"{deal_marker} | DROM dialog:{ident(c['dialog_id'])} | DROM attempt:{attempt_id} | [Адрес доставки / ПВЗ: {expected['address']}]"
            if len(comment) > 500:
                raise ValueError('delivery comment too long: clarify address, no truncation')
            form = {'order[customer_id]': cid, 'order[delivery_type_id]': expected['delivery_type_id'],
                    'put_to_work': '0', 'order[comment]': comment}
            if expected['delivery_point_id']:
                form['order[delivery_point_id]'] = expected['delivery_point_id']
            for item in expected['items']:
                form[f"baskets[{item['basket_id']}][check]"] = '1'
            final = self.current(c, mutation=True)
            if final['binding'] != expected['binding'] or final['latest_message_id'] != expected['latest_message_id']:
                raise ValueError('conversation changed during checkout preflight')
            state = {'version': 1, 'status': 'submitting', 'attempt_id': attempt_id,
                     'deal_marker': deal_marker, 'expected': expected, 'form': form, 'created_at': time.time()}
            # Durable reservation MUST precede POST; no result or error clears it.
            self.persist(path, state)
            try:
                oid = self.t.create_order(copy.deepcopy(form))
                if oid:
                    state['order_id'] = ident(oid)
                state['status'] = 'submitted'
            except Exception as exc:
                state['status'] = 'outcome_unknown'
                state['error'] = type(exc).__name__
            self.persist(path, state)
            return self.reconcile_attempt(c, state)
