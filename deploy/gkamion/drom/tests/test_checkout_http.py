"""All network writes in this suite go to an ephemeral loopback HTTP server."""
import copy, json, sys, tempfile, threading, unittest, subprocess, os
from pathlib import Path
from email.parser import BytesParser
from email.policy import default
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlsplit, parse_qs
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from drom_tools import DromTools
from drom_transport import DromTransport
from test_checkout_v2 import Orders
from test_drom_tools import msg

class HTTP(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def send(self,body,status=200):
        data=json.dumps(body).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(data)
    def do_GET(self):
        s=self.server.fixture;u=urlsplit(self.path);q=parse_qs(u.query);p=u.path
        if p=='/v1/conversations/10':return self.send({'data':{'contactId':'20','contactInboxes':[{'channel':'drom'}]}})
        if p=='/v1/conversations/10/messages':return self.send({'data':s.messages})
        if p=='/v1/contacts/id:20/custom-fields':return self.send({'data':[{'name':'gkamion_customer_id','value':'27'},{'name':'gkamion_verified','value':'email'}]})
        if p=='/customers/27.json':return self.send({'customer':{'id':27,'email':'buyer@example.test'}})
        if p=='/users/api_token':return self.send({'token':'local-only-fixture'})
        if p=='/price_search/search':return self.send({'data':s.prices(q['oem'][0],q['make_name'][0])})
        if p=='/orders.json':
            assert q['search[customer_id_eq]']==['27']
            return self.send({'orders':[{**s.full[x['id']]} for x in s.existing('27',q['search[comment_cont]'][0])]})
        if p.startswith('/baskets/'):
            bid=p.rsplit('/',1)[1].split('.')[0];return self.send({'basket':s.baskets[bid]})
        if p.startswith('/orders/'):
            oid=p.rsplit('/',1)[1].split('.')[0]
            if not s.visible:return self.send({},404)
            return self.send({'order':s.order(oid)})
        return self.send({},404)
    def do_POST(self):
        s=self.server.fixture
        raw=self.rfile.read(int(self.headers['Content-Length']))
        mime=BytesParser(policy=default).parsebytes(('Content-Type: '+self.headers['Content-Type']+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
        form={x.get_param('name',header='content-disposition'):x.get_payload(decode=True).decode('utf-8') for x in mime.iter_parts()}
        self.server.paths.append(self.path)
        if self.path=='/baskets':
            row={k[13:-1]:v for k,v in form.items() if k.startswith('price_result[')}
            return self.send({'basket':{'id':s.add(form['customer_id'],row)}})
        if self.path=='/orders':
            try:oid=s.create_order(form)
            except TimeoutError:
                self.connection.close();return
            return self.send({'order':{'id':oid}} if oid else {'ok':True})
        return self.send({},405)

class Network(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.fixture=Orders()
        self.http=ThreadingHTTPServer(('127.0.0.1',0),HTTP);self.http.fixture=self.fixture;self.http.paths=[]
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
        self.base='http://127.0.0.1:'+str(self.http.server_port)
        self.t=self.transport();self.f=DromTools(self.t,Path(self.tmp.name));self.c=self.f.context('10','20')
    def transport(self,write=True):
        return DromTransport({'GKAMION_USERNAME':'fixture','GKAMION_PASSWORD':'fixture','CHATBOTX_API_KEY':'fixture'},cbx=self.base,admin=self.base,prices=self.base,write_enabled=write)
    def tearDown(self):
        self.t.http.close();self.http.shutdown();self.http.server_close();self.tmp.cleanup()
    def base_basket(self):self.f.add(self.f.quote(self.c['context_ref'],0)['offer_ref'])
    def test_actual_multipart_create_and_readback(self):
        self.base_basket();r=self.f.checkout_create(self.c['context_ref'],True)
        self.assertEqual(r['status'],'created_verified');self.assertEqual(self.http.paths,['/baskets','/orders'])
        self.assertEqual(self.fixture.posts[0]['put_to_work'],'0');self.assertNotIn('order[order_status_type_id]',self.fixture.posts[0])
    def test_http_unknown_then_visibility(self):
        self.base_basket();self.fixture.mode='timeout';self.fixture.visible=False
        self.assertEqual(self.f.checkout_create(self.c['context_ref'],True)['status'],'outcome_unknown')
        self.assertEqual(self.f.checkout_reconcile(self.c['context_ref'])['status'],'outcome_unknown')
        self.assertEqual(self.http.paths.count('/orders'),1)
        self.fixture.visible=True
        self.assertEqual(self.f.checkout_reconcile(self.c['context_ref'])['status'],'created_verified')
    def test_http_extras_own_price_qty(self):
        self.base_basket();self.fixture.messages.append(msg(3,'Добавьте ещё фильтр',deal=None))
        e=self.f.extra_quote(self.c['context_ref'],'3','W712','MANN',3)
        p=self.f.plan_quote(self.c['context_ref'],[e['offer_ref']],[])
        out=msg(4,p['proposal_text'],deal=None);out.update(senderType='bot',messageType='outgoing')
        self.fixture.messages.extend([out,msg(5,p['acceptance_text'],deal=None)])
        self.f.add(e['offer_ref'],True)
        self.assertEqual(self.f.checkout_create(self.c['context_ref'],True)['status'],'created_verified')
        self.assertEqual(len(self.fixture.full['901']['order_items']),2)
        extra=self.fixture.full['901']['order_items'][1]
        self.assertEqual((extra['oem'],str(extra['cost']),str(extra['qnt'])),('W712','350','3'))
    def test_default_transport_cannot_write(self):
        t=self.transport(False)
        try:
            with self.assertRaisesRegex(ValueError,'release_blocked'):t.create_order({})
        finally:t.http.close()
        self.assertEqual(self.http.paths,[])
    def test_two_os_processes_share_durable_guard(self):
        self.base_basket()
        program='''import sys,json
from pathlib import Path
from drom_tools import DromTools
from drom_transport import DromTransport
base,cache,ref=sys.argv[1:]
t=DromTransport({'GKAMION_USERNAME':'fixture','GKAMION_PASSWORD':'fixture','CHATBOTX_API_KEY':'fixture'},cbx=base,admin=base,prices=base,write_enabled=True)
f=DromTools(t,Path(cache));print(json.dumps(f.checkout_create(ref,True)))
'''
        env=dict(os.environ);env['PYTHONPATH']=str(Path(__file__).resolve().parents[1]/'src')+os.pathsep+env.get('PYTHONPATH','')
        procs=[subprocess.Popen([sys.executable,'-c',program,self.base,self.tmp.name,self.c['context_ref']],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for _ in range(2)]
        for p in procs:
            stdout,stderr=p.communicate(timeout=20);self.assertEqual(p.returncode,0,stderr);self.assertEqual(json.loads(stdout)['status'],'created_verified')
        self.assertEqual(self.http.paths.count('/orders'),1)
