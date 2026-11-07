import copy,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import test_drom_tools as fixtures
from test_drom_tools import msg, DEAL, offer
from drom_tools import resolve_context,select_offer
class Safety(unittest.TestCase):
    setUp=fixtures.Flow.setUp
    tearDown=fixtures.Flow.tearDown
    quote=fixtures.Flow.quote
    def test_mixed_negation_blocks(self):
        self.assertTrue(resolve_context([msg(1),msg(3,'Не отменяйте доставку, отмените заказ',deal=None)])['cancelled'])
    def test_question_fails_closed_without_cancellation(self):
        c=resolve_context([msg(1),msg(3,'Как отменить заказ?',deal=None)])
        self.assertFalse(c['cancelled']);self.assertTrue(c['paused'])
    def test_generic_yes_does_not_authorize(self):
        self.t.prices=lambda a,b:[offer(6000)];q=self.quote();self.t.messages.append(msg(3,'да',deal=None))
        with self.assertRaisesRegex(ValueError,'confirm'):self.f.add(q['offer_ref'],True)
    def test_binding_changed_blocks(self):
        q=self.quote();old=self.t.context;self.t.context=lambda a,b:(old(a,b)[0],{'customer_id':'28','verified':'email'})
        with self.assertRaisesRegex(ValueError,'binding'):self.f.add(q['offer_ref'])
    def test_supplier_changes_block(self):
        q=self.quote();self.t.prices=lambda a,b:[offer(5100)]
        with self.assertRaisesRegex(ValueError,'offer'):self.f.add(q['offer_ref'])
        self.assertEqual(self.t.adds,[])
    def test_extra_request_blocks(self):
        q=self.quote();self.t.messages.append(msg(3,'Добавьте ещё фильтр, какой посоветуете?',deal=None))
        with self.assertRaisesRegex(ValueError,'selection'):self.f.add(q['offer_ref'])
    def test_checkout_never_issues_unprotected_form(self):
        q=self.quote();self.f.add(q['offer_ref'])
        with self.assertRaisesRegex(ValueError,'idempotency'):self.f.checkout(self.c['context_ref'])
    def test_empty_deal_not_ready(self):
        self.t.messages=[msg(1,'buyer@example.test',deal={**DEAL,'items':[]})];c=self.f.context('10','20')
        with self.assertRaisesRegex(ValueError,'empty'):self.f.checkout(c['context_ref'])
    def test_delivery_change_does_not_duplicate(self):
        q=self.quote();self.f.add(q['offer_ref']);self.t.messages.append(msg(3,deal={**DEAL,'pickupAddress':'Иной адрес'}))
        c=self.f.context('10','20');q=self.f.quote(c['context_ref'],0);self.f.add(q['offer_ref']);self.assertEqual(len(self.t.adds),1)
    def test_money_exact(self):
        r=select_offer([offer('5000.01')],{'article':'1411295132','brand':'Reach','price':'5238.01','qty':2})
        self.assertEqual(str(r['sell_price']),'5238.01')
        self.assertIsInstance(r['sell_price'],str)
    def test_quantity_literals(self):
        for qty in [True,False,0,-1,'2.5',2.5,'02','garbage']:
            with self.assertRaises(ValueError,msg=str(qty)):
                resolve_context([msg(1,deal={**DEAL,'items':[{**DEAL['items'][0],'qty':qty}]})])
    def test_supplier_readback_mismatch(self):
        q=self.quote();orig=self.t.basket
        self.t.basket=lambda bid:{**orig(bid),'price_result':{**orig(bid)['price_result'],'hash_key':'wrong'}}
        with self.assertRaisesRegex(ValueError,'supplier'):self.f.add(q['offer_ref'])
        with self.assertRaisesRegex(ValueError,'supplier'):self.f.add(q['offer_ref'])
        self.assertEqual(len(self.t.adds),1)
    def test_post_unknown_is_not_retried(self):
        q=self.quote();calls=[]
        def unknown(cid,row):calls.append(1);raise TimeoutError('synthetic')
        self.t.add=unknown
        with self.assertRaises(TimeoutError):self.f.add(q['offer_ref'])
        with self.assertRaisesRegex(ValueError,'unknown'):self.f.add(q['offer_ref'])
        self.assertEqual(len(calls),1)
    def test_proposal_must_be_shown(self):
        self.t.prices=lambda a,b:[offer(6000)];q=self.quote()
        self.t.messages.append(msg(3,q['acceptance_text'],deal=None))
        with self.assertRaisesRegex(ValueError,'confirm'):self.f.add(q['offer_ref'],True)
    def test_exact_proposal_and_acceptance(self):
        self.t.prices=lambda a,b:[offer(6000)];q=self.quote()
        outgoing=msg(3,q['proposal_text'],deal=None);outgoing.update(senderType='bot',messageType='outgoing')
        self.t.messages.extend([outgoing,msg(4,q['acceptance_text'],deal=None)])
        self.assertEqual(self.f.add(q['offer_ref'],True)['status'],'added')
    def test_partial_same_deal_update(self):
        c=resolve_context([msg(3,deal={'dealId':DEAL['dealId'],'city':'Москва'}),msg(1)])
        self.assertEqual(c['items'][0]['qty'],2)
    def test_repeated_listing_keeps_deal(self):
        item={**DEAL['items'][0],'url':'https://baza.drom.ru/one.html'}
        c=resolve_context([msg(1,deal={**DEAL,'items':[item]}),msg(2,deal=None,listing=item)])
        self.assertEqual(c['kind'],'deal')
    def test_revision_change_blocks_readd(self):
        q=self.quote();self.f.add(q['offer_ref'])
        self.t.messages.append(msg(3,deal={**DEAL,'items':[{**DEAL['items'][0],'qty':3}]}))
        c=self.f.context('10','20');q=self.f.quote(c['context_ref'],0)
        with self.assertRaisesRegex(ValueError,'revision'):self.f.add(q['offer_ref'])
        self.assertEqual(len(self.t.adds),1)
    def test_durable_pending_blocks_other_engine(self):
        from drom_tools import DromTools
        q=self.quote();calls=[]
        def unknown(cid,row):calls.append(1);raise TimeoutError('synthetic')
        self.t.add=unknown
        with self.assertRaises(TimeoutError):self.f.add(q['offer_ref'])
        restarted=DromTools(self.t,self.f.cache)
        with self.assertRaisesRegex(ValueError,'unknown'):restarted.add(q['offer_ref'])
        self.assertEqual(len(calls),1)
class TransportFaults(unittest.TestCase):
    def setUp(self):
        from drom_transport import DromTransport
        self.t=DromTransport({'GKAMION_USERNAME':'local','GKAMION_PASSWORD':'local','CHATBOTX_API_KEY':'local'},cbx='http://127.0.0.1',admin='http://127.0.0.1')
    def tearDown(self):self.t.http.close()
    def test_exact_marker_and_owner_filter(self):
        calls=[]
        def get(url,**kw):
            calls.append(kw['params'])
            return {'orders':[{'id':1,'customer_id':27,'comment':'DROM deal:1234'},{'id':2,'customer_id':27,'comment':'Заказ DROM deal:123 | test'},{'id':3,'customer_id':27,'comment':'otherDROM deal:123'}]}
        self.t.get=get
        self.assertEqual(self.t.existing('27','DROM deal:123'),[{'id':2}])
        self.assertEqual(calls[0]['search[customer_id_eq]'],'27');self.assertEqual(calls[0]['search[comment_cont]'],'DROM deal:123')
    def test_foreign_order_fails_closed(self):
        self.t.get=lambda *a,**k:{'orders':[{'id':1,'customer_id':28,'comment':'DROM deal:123'}]}
        with self.assertRaisesRegex(ValueError,'filter'):self.t.existing('27','DROM deal:123')
    def test_cursor_cycle(self):
        cursors=iter(['a','b','a']);calls=[]
        def cbx(path,params=None):
            calls.append(path)
            if path.endswith('/10'):return {'data':{'contactId':'20','contactInboxes':[{'channel':'drom'}]}}
            return {'data':[msg(1)],'nextCursor':next(cursors)}
        self.t.cbx_get=cbx
        with self.assertRaisesRegex(ValueError,'pagination'):self.t.context('10','20')
        self.assertEqual(len(calls),4)
    def test_foreign_message(self):
        self.t.cbx_get=lambda path,params=None:({'data':{'contactId':'20','contactInboxes':[{'channel':'drom'}]}} if path.endswith('/10') else {'data':[{**msg(1),'conversationId':'999'}]})
        with self.assertRaisesRegex(ValueError,'foreign'):self.t.context('10','20')
    def test_incomplete_history(self):
        i=iter(range(100))
        self.t.cbx_get=lambda path,params=None:({'data':{'contactId':'20','contactInboxes':[{'channel':'drom'}]}} if path.endswith('/10') else {'data':[msg(1)],'nextCursor':str(next(i))})
        with self.assertRaisesRegex(ValueError,'incomplete'):self.t.context('10','20')
class ReleaseBoundary(unittest.TestCase):
    def test_live_server_write_tools_are_blocked(self):
        import server
        self.assertEqual(server.drom_basket('any',True)['error'],'release_blocked')
        self.assertIn('release_blocked',server.drom_checkout_form('any')['error'])
class FinalRegression(unittest.TestCase):
    def test_explicit_null_quantity_is_invalid(self):
        with self.assertRaisesRegex(ValueError,'quantity'):
            resolve_context([msg(1,deal={**DEAL,'items':[{**DEAL['items'][0],'qty':None}]})])
