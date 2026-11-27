import json,sys,unittest,copy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
import test_checkout_v2 as fixture
from test_drom_tools import msg,offer,DEAL
class Review(unittest.TestCase):
    setUp=fixture.Checkout.setUp
    tearDown=fixture.Checkout.tearDown
    base=fixture.Checkout.base
    def test_withdrawn_consent(self):
        self.t.prices=lambda a,b:[offer(6000)];q=self.f.quote(self.c['context_ref'],0)
        shown=msg(3,q['proposal_text'],deal=None);shown.update(senderType='bot',messageType='outgoing')
        self.t.messages.extend([shown,msg(4,q['acceptance_text'],deal=None),msg(5,'С этой ценой больше не согласен',deal=None)])
        with self.assertRaises(ValueError):self.f.add(q['offer_ref'],True)
        self.assertEqual(self.t.adds,[])
    def test_cancel_during_supplier_read(self):
        q=self.f.quote(self.c['context_ref'],0);orig=self.t.prices
        def changed(a,b):
            self.t.messages.append(msg(3,'Отмените заказ',deal=None));return orig(a,b)
        self.t.prices=changed
        with self.assertRaisesRegex(ValueError,'cancel'):self.f.add(q['offer_ref'])
        self.assertEqual(self.t.adds,[])
    def test_approved_plan_rejects_different_native_terms(self):
        q=self.f.quote(self.c['context_ref'],0)
        self.t.messages.append(msg(3,'Добавьте ещё фильтр',deal=None))
        p=self.f.plan_quote(self.c['context_ref'],[],['3'],[q['offer_ref']])
        shown=msg(4,p['proposal_text'],deal=None);shown.update(senderType='bot',messageType='outgoing')
        self.t.messages.extend([shown,msg(5,p['acceptance_text'],deal=None)])
        self.t.prices=lambda a,b:[{**offer(),'max_delivery_day':5}]
        alternate=self.f.quote(self.c['context_ref'],0)
        with self.assertRaisesRegex(ValueError,'plan|composition'):self.f.add(alternate['offer_ref'])
        self.assertEqual(self.t.adds,[])
    def test_changed_order_hash_or_guid_blocks_verification(self):
        self.base();original=self.t.order
        for field in ['hash_key','guid_id']:
            def mismatch(oid):
                order=original(oid);order['order_items'][0][field]='other';return order
            self.t.order=mismatch
            result=self.f.checkout_create(self.c['context_ref'],True)
            self.assertEqual(result['status'],'readback_mismatch',field)
        self.assertEqual(len(self.t.posts),1)
    def test_email_cannot_cross_deals_or_choose_old_page(self):
        from drom_transport import DromTransport
        from drom_tools import resolve_context
        old=msg(1,deal={**DEAL,'dealId':'111'})
        email=msg(2,'buyer@example.test',deal=None)
        new=msg(3,deal={**DEAL,'dealId':'222'})
        self.assertEqual(resolve_context([new,email,old])['identity_email'],'')
        messages=[msg(5,'new@example.test',deal=None),new,msg(4,'buyer@example.test',deal=None),old,email]
        t=DromTransport({'GKAMION_USERNAME':'local','GKAMION_PASSWORD':'local','CHATBOTX_API_KEY':'local'},admin='http://127.0.0.1')
        def cbx(path,params=None):
            if path.endswith('/10'):return {'data':{'contactId':'20','contactInboxes':[{'channel':'drom'}]}}
            if path.endswith('/messages'):return {'data':messages}
            return {'data':[{'name':'gkamion_customer_id','value':'27'},{'name':'gkamion_verified','value':'email'}]}
        t.cbx_get=cbx;t.get=lambda *a,**kw:{'customer':{'id':27,'email':'buyer@example.test'}}
        try:
            _,binding=t.context('10','20');self.assertEqual(binding['verified'],'')
        finally:t.http.close()
    def test_new_choice_after_approval_blocks(self):
        self.base();self.t.messages.append(msg(3,'Добавьте ещё фильтр',deal=None))
        e=self.f.extra_quote(self.c['context_ref'],'3','W712','MANN',3)
        plan=self.f.plan_quote(self.c['context_ref'],[e['offer_ref']],[])
        out=msg(4,plan['proposal_text'],deal=None);out.update(senderType='bot',messageType='outgoing')
        self.t.messages.extend([out,msg(5,plan['acceptance_text'],deal=None),msg(6,'Добавьте другую деталь',deal=None)])
        with self.assertRaisesRegex(ValueError,'selection'):self.f.add(e['offer_ref'],True)
        self.assertEqual(len(self.t.adds),1)
    def test_cancel_only_extra_via_new_complete_plan(self):
        self.base();self.t.messages.append(msg(3,'Добавьте ещё фильтр',deal=None))
        e=self.f.extra_quote(self.c['context_ref'],'3','W712','MANN',3)
        plan=self.f.plan_quote(self.c['context_ref'],[e['offer_ref']],[])
        out=msg(4,plan['proposal_text'],deal=None);out.update(senderType='bot',messageType='outgoing')
        self.t.messages.extend([out,msg(5,plan['acceptance_text'],deal=None)])
        self.f.add(e['offer_ref'],True)
        self.t.messages.append(msg(6,'Уберите только дополнительный фильтр',deal=None))
        plan=self.f.plan_quote(self.c['context_ref'],[],['3','6'])
        out=msg(7,plan['proposal_text'],deal=None);out.update(senderType='bot',messageType='outgoing')
        self.t.messages.extend([out,msg(8,plan['acceptance_text'],deal=None)])
        self.assertEqual(self.f.checkout_create(self.c['context_ref'],True)['status'],'created_verified')
        self.assertEqual(len(self.t.full['901']['order_items']),1)
    def test_extra_and_higher_native_from_initial_open_request(self):
        orig=self.t.prices
        self.t.prices=lambda a,b: [offer(6000)] if a=='1411295132' else orig(a,b)
        self.t.messages.append(msg(3,'Добавьте ещё фильтр',deal=None))
        native=self.f.quote(self.c['context_ref'],0)
        extra=self.f.extra_quote(self.c['context_ref'],'3','W712','MANN',3)
        plan=self.f.plan_quote(self.c['context_ref'],[extra['offer_ref']],[],[native['offer_ref']])
        self.assertIn('6000 руб./шт.',plan['proposal_text']);self.assertIn('350 руб./шт.',plan['proposal_text'])
        out=msg(4,plan['proposal_text'],deal=None);out.update(senderType='bot',messageType='outgoing')
        self.t.messages.extend([out,msg(5,plan['acceptance_text'],deal=None)])
        self.f.add(native['offer_ref'],True);self.f.add(extra['offer_ref'],True)
        self.assertEqual(self.f.checkout_create(self.c['context_ref'],True)['status'],'created_verified')
    def test_withdrawal_after_basket_before_order(self):
        self.t.prices=lambda a,b:[offer(6000)];q=self.f.quote(self.c['context_ref'],0)
        shown=msg(3,q['proposal_text'],deal=None);shown.update(senderType='bot',messageType='outgoing')
        self.t.messages.extend([shown,msg(4,q['acceptance_text'],deal=None)])
        self.f.add(q['offer_ref'],True)
        self.t.messages.append(msg(5,'Согласие на цену отзываю',deal=None))
        with self.assertRaisesRegex(ValueError,'consent|confirm'):self.f.checkout_create(self.c['context_ref'],True)
        self.assertEqual(self.t.posts,[])
    def test_conflicting_structured_delivery_address_blocks(self):
        self.base();original=self.t.order
        self.t.order=lambda oid:{**original(oid),'delivery_address':'Другой адрес'}
        self.assertEqual(self.f.checkout_create(self.c['context_ref'],True)['status'],'readback_mismatch')
    def test_cancel_explicit_extra_does_not_cancel_native_deal(self):
        from drom_tools import resolve_context
        text='Отмените только дополнительную позицию'
        self.base();self.t.messages.append(msg(3,text,deal=None))
        facts=resolve_context(self.t.messages)
        self.assertFalse(facts['cancelled']);self.assertFalse(facts['paused']);self.assertTrue(facts['selection_pending'])
        plan=self.f.plan_quote(self.c['context_ref'],[],['3'])
        shown=msg(4,plan['proposal_text'],deal=None);shown.update(senderType='bot',messageType='outgoing')
        self.t.messages.extend([shown,msg(5,plan['acceptance_text'],deal=None)])
        self.assertEqual(self.f.checkout_create(self.c['context_ref'],True)['status'],'created_verified')
    def test_conflicting_address_object_fields_fail_closed(self):
        self.base();original=self.t.order
        for address in [{'full':self.c['delivery_address'],'address':'Другой адрес'}, {'full':self.c['delivery_address'],'street':'Противоречивая улица'}]:
            self.t.order=lambda oid:{**original(oid),'delivery_address':address}
            self.assertEqual(self.f.checkout_create(self.c['context_ref'],True)['status'],'readback_mismatch')
        self.assertEqual(len(self.t.posts),1)
    def test_extra_consent_withdrawn_during_supplier_read(self):
        self.base();self.t.messages.append(msg(3,'Замените фильтр',deal=None))
        extra=self.f.extra_quote(self.c['context_ref'],'3','W712','MANN',3)
        plan=self.f.plan_quote(self.c['context_ref'],[extra['offer_ref']],[])
        shown=msg(4,plan['proposal_text'],deal=None);shown.update(senderType='bot',messageType='outgoing')
        self.t.messages.extend([shown,msg(5,plan['acceptance_text'],deal=None)])
        prices=self.t.prices
        def changed(a,b):
            self.t.messages.append(msg(6,'Согласие на состав отзываю',deal=None));return prices(a,b)
        self.t.prices=changed
        with self.assertRaisesRegex(ValueError,'selection|conversation|plan'):self.f.add(extra['offer_ref'],True)
        self.assertEqual(len(self.t.adds),1)
