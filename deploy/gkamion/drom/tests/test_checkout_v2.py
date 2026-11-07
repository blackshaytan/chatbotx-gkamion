import json, sys, tempfile, threading, unittest, copy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
from drom_tools import DromTools
from test_drom_tools import FakeTransport, msg, offer, DEAL

class Orders(FakeTransport):
    def __init__(self):
        super().__init__();self.posts=[];self.full={};self.mode='ok';self.visible=True
    def add(self,cid,row):
        bid=str(77+len(self.adds));self.adds.append((cid,copy.deepcopy(row)))
        self.baskets[bid]={'id':bid,'customer_id':cid,'price_result':copy.deepcopy(row)};return bid
    def prices(self,article,brand):
        if article=='W712':return [{**offer(350),'oem':'W712','make_name':'MANN','price_id':11,'hash_key':'filter','guid_id':'filter-guid','qnt':20}]
        return [offer()]
    def create_order(self,form):
        self.posts.append(copy.deepcopy(form));oid='901'
        lines=[copy.deepcopy(self.baskets[k[8:-8]]['price_result']) for k in form if k.startswith('baskets[')]
        self.full[oid]={'id':oid,'customer_id':form['order[customer_id]'],'delivery_type_id':form['order[delivery_type_id]'],'comment':form['order[comment]'],'order_items':lines}
        if self.mode=='timeout':raise TimeoutError('synthetic timeout after commit')
        if self.mode=='empty':return None
        return oid
    def existing(self,cid,marker):return [{'id':k} for k,v in self.full.items() if marker in v['comment']] if self.visible else []
    def order(self,oid):
        if not self.visible:raise ValueError('not yet visible')
        return copy.deepcopy(self.full[oid])

class Checkout(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.t=Orders();self.f=DromTools(self.t,Path(self.tmp.name));self.c=self.f.context('10','20')
    def tearDown(self):self.tmp.cleanup()
    def base(self):
        q=self.f.quote(self.c['context_ref'],0);self.f.add(q['offer_ref'])
    def test_create_once_and_verify(self):
        self.base();r=self.f.checkout_create(self.c['context_ref'],True)
        self.assertEqual(r['status'],'created_verified');self.assertEqual(r['order_id'],'901')
        self.assertEqual(self.f.checkout_create(self.c['context_ref'],True)['status'],'created_verified');self.assertEqual(len(self.t.posts),1)
    def test_concurrent_instances(self):
        self.base();results=[]
        def run():results.append(DromTools(self.t,self.f.cache).checkout_create(self.c['context_ref'],True))
        ts=[threading.Thread(target=run) for _ in range(4)]
        for t in ts:t.start()
        for t in ts:t.join()
        self.assertEqual(len(results),4);self.assertEqual(len(self.t.posts),1)
    def test_unknown_never_reposts_even_after_restart(self):
        self.base();self.t.mode='timeout';self.t.visible=False
        self.assertEqual(self.f.checkout_create(self.c['context_ref'],True)['status'],'outcome_unknown')
        f=DromTools(self.t,self.f.cache)
        self.assertEqual(f.checkout_create(self.c['context_ref'],True)['status'],'outcome_unknown');self.assertEqual(len(self.t.posts),1)
        self.t.visible=True;self.assertEqual(f.checkout_create(self.c['context_ref'],True)['status'],'created_verified');self.assertEqual(len(self.t.posts),1)
    def test_missing_response_id_reconciles(self):
        self.base();self.t.mode='empty';self.assertEqual(self.f.checkout_create(self.c['context_ref'],True)['status'],'created_verified')
    def test_readback_mismatch_is_durable(self):
        self.base();orig=self.t.order
        self.t.order=lambda oid:{**orig(oid),'order_items':[{**orig(oid)['order_items'][0],'cost':'1'}]}
        self.assertEqual(self.f.checkout_create(self.c['context_ref'],True)['status'],'readback_mismatch')
        self.assertEqual(self.f.checkout_create(self.c['context_ref'],True)['status'],'readback_mismatch');self.assertEqual(len(self.t.posts),1)
    def test_confirm_required(self):
        self.base()
        with self.assertRaisesRegex(ValueError,'confirm'):self.f.checkout_create(self.c['context_ref'])
        self.assertEqual(self.t.posts,[])
    def test_cancel_before_checkout(self):
        self.base();self.t.messages.append(msg(3,'Отмените заказ',deal=None))
        with self.assertRaisesRegex(ValueError,'cancel'):self.f.checkout_create(self.c['context_ref'],True)
        self.assertEqual(self.t.posts,[])
    def test_extras_end_to_end(self):
        self.base();self.t.messages.append(msg(3,'Добавьте ещё фильтр',deal=None))
        extra=self.f.extra_quote(self.c['context_ref'],'3','W712','MANN',3)
        plan=self.f.plan_quote(self.c['context_ref'],[extra['offer_ref']],[])
        out=msg(4,plan['proposal_text'],deal=None);out.update(senderType='bot',messageType='outgoing')
        self.t.messages.extend([out,msg(5,plan['acceptance_text'],deal=None)])
        self.f.add(extra['offer_ref'],True)
        r=self.f.checkout_create(self.c['context_ref'],True)
        self.assertEqual(r['status'],'created_verified');lines=self.t.full['901']['order_items']
        self.assertEqual([(x['oem'],x['qnt'],str(x['cost'])) for x in lines],[('1411295132',2,'5238'),('W712',3,'350')])
    def test_open_choice_blocks(self):
        self.base();self.t.messages.append(msg(3,'Добавьте ещё фильтр, какой выбрать?',deal=None))
        with self.assertRaisesRegex(ValueError,'selection'):self.f.checkout_create(self.c['context_ref'],True)
        self.assertEqual(self.t.posts,[])
    def test_unapproved_or_incomplete_plan_blocks(self):
        self.base();self.t.messages.append(msg(3,'Добавьте ещё фильтр',deal=None))
        e=self.f.extra_quote(self.c['context_ref'],'3','W712','MANN',3)
        p=self.f.plan_quote(self.c['context_ref'],[e['offer_ref']],[])
        self.t.messages.append(msg(4,'да',deal=None))
        with self.assertRaisesRegex(ValueError,'selection'):self.f.add(e['offer_ref'],True)
    def test_explicitly_dropped_extra_preserves_deal(self):
        self.base();self.t.messages.append(msg(3,'Добавьте ещё фильтр',deal=None))
        plan=self.f.plan_quote(self.c['context_ref'],[],['3'])
        self.assertIn('Без добавления',plan['proposal_text'])
        out=msg(4,plan['proposal_text'],deal=None);out.update(senderType='bot',messageType='outgoing')
        self.t.messages.extend([out,msg(5,plan['acceptance_text'],deal=None)])
        self.assertEqual(self.f.checkout_create(self.c['context_ref'],True)['status'],'created_verified');self.assertEqual(len(self.t.full['901']['order_items']),1)
