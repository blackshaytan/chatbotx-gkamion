import json,os,sys,tempfile,unittest,hashlib
from pathlib import Path
from mcp import ClientSession,StdioServerParameters
from mcp.client.stdio import stdio_client

class MCPRelease(unittest.IsolatedAsyncioTestCase):
    async def test_exact_catalog_and_blocked_writes_without_transport(self):
        root=Path(__file__).resolve().parents[1]/'src'
        with tempfile.TemporaryDirectory() as state:
            params=StdioServerParameters(command=sys.executable,args=[str(root/'server.py')],env={
                'PYTHONPATH':os.environ.get('PYTHONPATH',''),'DROM_STATE_DIR':state,
                'DROM_WRITE_RELEASE_SHA256':'not-a-reviewed-generation'})
            async with stdio_client(params) as (reader,writer):
                async with ClientSession(reader,writer) as client:
                    await client.initialize();catalog=await client.list_tools()
                    self.assertEqual({t.name for t in catalog.tools},{'drom_context','drom_price','drom_extra_price','drom_selection','drom_basket','drom_checkout','drom_checkout_status','drom_checkout_form'})
                    for name,args in [('drom_basket',{'offer_ref':'invalid','confirmed':True}),('drom_checkout',{'context_ref':'invalid','confirm':True}),('drom_checkout_form',{'context_ref':'invalid'})]:
                        result=await client.call_tool(name,args)
                        self.assertIn('release_blocked',json.loads(result.content[0].text)['error'])
            records=[json.loads(p.read_text()) for p in (Path(state)/'loaded').glob('*.json')]
            expected=hashlib.sha256(b''.join((root/n).read_bytes() for n in ['drom_tools.py','drom_checkout.py','drom_transport.py','server.py','run.sh'])).hexdigest()
            self.assertEqual(len(records),1);self.assertEqual(records[0]['generation'],expected)
            self.assertEqual(records[0]['release_mode'],'read-only-release-blocked')
