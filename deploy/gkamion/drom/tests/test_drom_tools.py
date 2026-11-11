import sys, tempfile, unittest, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'src'))
from drom_tools import resolve_context, select_offer, DromTools

DEAL = {'dealId':'31186531','buyerName':'Тестовый Покупатель','phone':'+79990000001','email':'', 'deliveryMethod':'TK «СДЭК»', 'pickupAddress':'Тестовый адрес', 'items':[{'title':'Радиатор Reach 1411295132','price':5238,'qty':2}]}
def msg(i, text='', deal=DEAL, listing=None):
    return {'id':str(i),'conversationId':'10','senderType':'contact','messageType':'incoming','createdAt':f'2026-11-08T00:00:{i:02d}Z','text':text,'contentAttributes':{'dromContext':{'dialogId':'99','deal':deal,'listing':listing}}}
def offer(cost=5000, **kw):
    return dict(oem='1411295132',make_name='Reach',detail_name='Радиатор',cost=cost,min_delivery_day=1,max_delivery_day=3,qnt=4,min_qnt=1,price_id=10,hash_key='abc',guid_id='guid-abc',price_request_id='req',sys_info='info',**kw)
class Pure(unittest.TestCase):
    def test_null_preserves_deal(self):
        c=resolve_context([msg(1),msg(2,'buyer@example.test',deal=None)])
        self.assertEqual(c['deal']['dealId'],'31186531'); self.assertEqual(c['email'],'buyer@example.test')
        self.assertEqual(c['items'][0]['article'],'1411295132'); self.assertEqual(c['items'][0]['brand'],'Reach')
        self.assertEqual(c['delivery_type_id'],4)
    def test_cancel_blocks(self):
        self.assertTrue(resolve_context([msg(1),msg(2,'Отмените заказ, нашел альтернативу',deal=None)])['cancelled'])
    def test_pause_blocks(self):
        for text in ['Пока не оформляйте, закажу позже', 'Отложите заказ до завтра', 'Пока только спрашиваю цену']:
            self.assertTrue(resolve_context([msg(1),msg(2,text,deal=None)])['paused'],text)
    def test_quantity_is_not_rounded(self):
        with self.assertRaises(ValueError):resolve_context([msg(1,deal={**DEAL,'items':[{**DEAL['items'][0],'qty':2.5}]})])
    def test_new_deal_does_not_inherit_old_cancel(self):
        d={**DEAL,'dealId':'222'}
        self.assertFalse(resolve_context([msg(1,'Отмените заказ'),msg(2,'',deal=d)])['cancelled'])
    def test_bot_text_is_not_contact(self):
        m=msg(2,'Отмените заказ',deal=None);m['senderType']='bot'
        self.assertFalse(resolve_context([msg(1),m])['cancelled'])
    def test_different_listing_drops_deal(self):
        c=resolve_context([msg(1),msg(2,deal=None,listing={'url':'https://baza.drom.ru/g2.html','title':'Фильтр MANN W712','price':300})])
        self.assertIsNone(c['deal']); self.assertEqual(c['kind'],'listing')
    def test_equal_keeps_drom_price(self):
        r=select_offer([offer()],{'article':'1411295132','brand':'Reach','price':5238,'qty':2})
        self.assertEqual(r['mode'],'drom_price');self.assertEqual(r['price_row']['cost'],'5238');self.assertEqual(r['price_row']['qnt'],2)
    def test_higher_requires_confirmation(self):
        self.assertEqual(select_offer([offer(6000)],{'article':'1411295132','brand':'Reach','price':5238,'qty':2})['mode'],'await_price_confirm')
    def test_rejects_other_article(self):
        x=offer();x['oem']='WRONG';self.assertEqual(select_offer([x],{'article':'1411295132','brand':'Reach','price':5238,'qty':2})['mode'],'no_offer')
    def test_rejects_other_brand(self):
        x=offer();x['make_name']='Other';self.assertEqual(select_offer([x],{'article':'1411295132','brand':'Reach','price':5238,'qty':2})['mode'],'no_offer')
    def test_rejects_minimum_or_stock(self):
        for k,v in [('min_qnt',3),('qnt',1),('min_delivery_day',-1),('max_delivery_day',6),('cost','NaN')]:
            x=offer();x[k]=v
            self.assertEqual(select_offer([x],{'article':'1411295132','brand':'Reach','price':5238,'qty':2})['mode'],'no_offer',k)
    def test_chooses_cheapest_eligible(self):
        a=offer(4000);b=offer(5000)
        self.assertEqual(select_offer([b,a],{'article':'1411295132','brand':'Reach','price':5238,'qty':2})['supplier_cost'],'4000')

class FakeTransport:
    def __init__(self): self.messages=[msg(1),msg(2,'buyer@example.test',deal=None)];self.adds=[];self.baskets={};self.orders=[]
    def context(self,cid,contact):
        if (cid,contact)!=('10','20'):raise ValueError('ownership')
        return self.messages, {'customer_id':'27','verified':'email'}
    def prices(self,article,brand):return [offer()]
    def add(self,cid,row):
        self.adds.append((cid,row));self.baskets['77']={'id':77,'customer_id':27,'oem':row['oem'],'make_name':row['make_name'],'cost':row['cost'],'qnt':row['qnt'],'price_result':dict(row)};return '77'
    def basket(self,bid):return self.baskets[bid]
    def existing(self,cid,marker):return self.orders

class Flow(unittest.TestCase):
    def setUp(self): self.tmp=tempfile.TemporaryDirectory(); self.t=FakeTransport();self.f=DromTools(self.t,Path(self.tmp.name));self.c=self.f.context('10','20')
    def tearDown(self):self.tmp.cleanup()
    def quote(self):return self.f.quote(self.c['context_ref'],0)
    def test_context_does_not_write_remote(self): self.assertEqual(self.t.adds,[])
    def test_quote_is_cached_for_add(self):
        q=self.quote();b=self.f.add(q['offer_ref']);self.assertEqual(b['basket_id'],'77');self.assertEqual(self.t.adds[0][1]['qnt'],2)
    def test_add_idempotent(self):
        q=self.quote();self.f.add(q['offer_ref']);self.f.add(q['offer_ref']);self.assertEqual(len(self.t.adds),1)
    def test_cancel_between_quote_and_add_blocks(self):
        q=self.quote();self.t.messages.append(msg(3,'Отмените заказ',deal=None))
        with self.assertRaisesRegex(ValueError,'cancel'):self.f.add(q['offer_ref'])
        self.assertEqual(self.t.adds,[])
    def test_changed_deal_blocks_stale_offer(self):
        q=self.quote();self.t.messages.append(msg(3,deal={**DEAL,'dealId':'999'}))
        with self.assertRaisesRegex(ValueError,'changed'):self.f.add(q['offer_ref'])
    def test_higher_needs_explicit_confirm(self):
        self.t.prices=lambda a,b:[offer(6000)];q=self.quote()
        with self.assertRaisesRegex(ValueError,'confirm'):self.f.add(q['offer_ref'])
    def test_listing_needs_purchase_confirm(self):
        self.t.messages=[msg(1,deal=None,listing={'url':'https://baza.drom.ru/g1.html','title':'Радиатор Reach 1411295132','price':5238})];c=self.f.context('10','20');q=self.f.quote(c['context_ref'],0)
        with self.assertRaisesRegex(ValueError,'confirm'):self.f.add(q['offer_ref'])
    def test_verified_binding_required_for_add(self):
        q=self.quote();old=self.t.context;self.t.context=lambda a,b:(old(a,b)[0],{'customer_id':'27','verified':''})
        with self.assertRaisesRegex(ValueError,'verified'):self.f.add(q['offer_ref'])
    def test_checkout_form_has_drom_and_delivery(self):
        q=self.quote();self.f.add(q['offer_ref'])
        with self.assertRaisesRegex(ValueError,'idempotency'):self.f.checkout(self.c['context_ref'])
    def test_existing_order_blocks_duplicate(self):
        q=self.quote();self.f.add(q['offer_ref']);self.t.orders=[{'id':987}]
        r=self.f.checkout(self.c['context_ref']);self.assertEqual(r['status'],'already_created');self.assertNotIn('form',r)
    def test_unknown_ref_fails(self):
        with self.assertRaises(ValueError):self.f.add('../etc/passwd')

if __name__=='__main__':unittest.main(verbosity=2)
