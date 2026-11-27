import sys, unittest, threading, json, tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
from drom_transport import DromTransport
from drom_tools import DromTools
from test_drom_tools import msg,offer

class Handler(BaseHTTPRequestHandler):
    calls=[];posted=b''
    def log_message(self,*a):pass
    def send(self,obj):
        b=json.dumps(obj).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b)
    def do_GET(self):
        Handler.calls.append(self.path);u=urlsplit(self.path);p=u.path
        if p=='/v1/conversations/10':return self.send({'data':{'contactId':'20','contactInboxes':[{'channel':'drom'}]}})
        if p=='/v1/conversations/10/messages':
            if 'cursor' in parse_qs(u.query):return self.send({'data':[msg(1)],'nextCursor':None})
            return self.send({'data':[msg(2,'buyer@example.test',deal=None)],'nextCursor':'older'})
        if p=='/v1/contacts/id:20/custom-fields':return self.send({'data':[{'name':'gkamion_customer_id','value':'27'},{'name':'gkamion_verified','value':'email'}]})
        if p=='/customers/27.json':return self.send({'customer':{'id':27,'email':'buyer@example.test'}})
        if p=='/users/api_token':return self.send({'token':'local-fixture-token'})
        if p=='/price_search/search':return self.send({'data':[offer()]})
        if p=='/baskets/77.json':return self.send({'basket':{'id':77,'customer_id':27,'qnt':2,'price_result':{**offer(),'cost':5238}}})
        if p=='/orders.json':return self.send({'orders':[]})
        self.send_response(404);self.end_headers()
    def do_POST(self):
        Handler.posted=self.rfile.read(int(self.headers['Content-Length']));self.send({'basket':{'id':77}})
class TransportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http=ThreadingHTTPServer(('127.0.0.1',0),Handler);cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start();cls.base='http://127.0.0.1:'+str(cls.http.server_port)
    @classmethod
    def tearDownClass(cls):cls.http.shutdown();cls.http.server_close()
    def setUp(self):
        Handler.calls=[];Handler.posted=b'';self.tmp=tempfile.TemporaryDirectory()
        env={'GKAMION_USERNAME':'local','GKAMION_PASSWORD':'local','CHATBOTX_API_KEY':'local'}
        self.t=DromTransport(env,cbx=self.base,admin=self.base,prices=self.base,write_enabled=True);self.f=DromTools(self.t,Path(self.tmp.name))
    def tearDown(self):self.tmp.cleanup()
    def test_paginated_context_restores_deal_and_email(self):
        c=self.f.context('10','20');self.assertEqual(c['deal']['dealId'],'31186531');self.assertEqual(c['email'],'buyer@example.test');self.assertTrue(any('cursor=older' in s for s in Handler.calls))
    def test_full_network_basket_and_checkout_without_real_writes(self):
        c=self.f.context('10','20');q=self.f.quote(c['context_ref'],0);b=self.f.add(q['offer_ref'])
        with self.assertRaisesRegex(ValueError,'idempotency'):self.f.checkout(c['context_ref'])
        self.assertEqual(b['basket_id'],'77');self.assertIn(b'name="qnt"\r\n\r\n2',Handler.posted);self.assertIn(b'name="price_result[cost]"\r\n\r\n5238',Handler.posted);self.assertIn(b'price_request_id',Handler.posted);self.assertIn(b'sys_info',Handler.posted)
    def test_wrong_contact_rejected_before_messages(self):
        with self.assertRaises(ValueError):self.f.context('10','999')
        self.assertFalse(any('/messages' in s for s in Handler.calls))
    def test_prices_never_request_cross(self):
        self.t.prices('1411295132','Reach');self.assertTrue(any('with_cross=false' in s for s in Handler.calls))
if __name__=='__main__':unittest.main(verbosity=2)
