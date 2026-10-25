import copy,importlib.util,json,os,pathlib,sys,tempfile,threading,unittest,urllib.request,urllib.error
from unittest.mock import patch
from test_trusted import ROOT,row,env,raw,pending,terminal
from source_auth import SourceAuthority,AuthError
from ingest_access import client_ip,proxy_networks
class SourceHTTP(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=pathlib.Path(self.tmp.name)
  self.authority=SourceAuthority(self.base/'source.sqlite',create=True,expected_endpoint='https://data.feiqiaoai.uno/');self.a=self.authority.issue('A','wuming-ai','https://data.feiqiaoai.uno/');self.b=self.authority.issue('B','wuming-ai','https://data.feiqiaoai.uno/')
  with patch.dict(os.environ,{'INGEST_BASE_DIR':str(self.base),'INGEST_AUTH_DB':str(self.authority.path),'INGEST_TRUSTED_PROXIES':'','INGEST_PUBLIC_ENDPOINT':'https://data.feiqiaoai.uno/'}):
   spec=importlib.util.spec_from_file_location('auth_http',ROOT/'server/server_sharded.py');self.server=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.server);self.server._authority=self.authority
  self.http=self.server.ThreadingHTTPServer(('127.0.0.1',0),self.server.IngestHandler);self.worker=threading.Thread(target=self.http.serve_forever,daemon=True);self.worker.start();self.addCleanup(self.close);self.url='http://127.0.0.1:'+str(self.http.server_port)
 def close(self):self.http.shutdown();self.http.server_close();self.worker.join()
 def body(self,rows,credential=None):
  c=credential or self.a;e=env(rows,instance=c['clientInstanceId']);e['source'].update(principalId=c['principalId'],realmId=c['realmId']);return e
 def post(self,body,credential=None,path='/',headers=None):
  h={'Content-Type':'text/plain',**(headers or {})}
  if credential:h['Authorization']='Bearer '+credential['token']
  try:
   with urllib.request.urlopen(urllib.request.Request(self.url+path,data=raw(body),headers=h),timeout=15) as r:return r.status,json.load(r),dict(r.headers)
  except urllib.error.HTTPError as e:return e.code,json.load(e),dict(e.headers)
 def test_authenticated_revisions_and_forgeries(self):
  for s in [pending(row()),row(),terminal(row())]:self.assertEqual(self.post(self.body([s]),self.a)[0],200)
  self.assertEqual(self.server.trusted_inbox().view()['counts']['eligibleRecords'],1)
  bad=row();bad['f'][0]=999
  for credential in [None,self.b]:self.assertIn(self.post(self.body([bad]),credential)[0],(401,403))
  self.assertEqual(self.server.trusted_inbox().view()['counts']['eligibleRecords'],1)
  self.assertEqual(self.post(self.body([row()],self.b),self.b)[0],200)
  self.assertEqual(self.server.trusted_inbox().view()['counts']['eligibleRecords'],2)
 def test_ten_replays_and_revoked_replay(self):
  body=self.body([row()]);receipts=[]
  for _ in range(10):receipts.append(self.post(body,self.a))
  self.assertTrue(all(r[0]==200 for r in receipts));self.assertTrue(all(r[1]['duplicate_request'] for r in receipts[1:]));self.assertEqual(self.server.trusted_inbox().view()['counts']['rawRequests'],1)
  self.authority.revoke(self.a['credentialId']);self.assertEqual(self.post(body,self.a)[0],401)
  self.assertEqual(self.server.trusted_inbox().view()['counts']['eligibleRecords'],1)
 def test_routes_legacy_and_snapshot(self):
  self.assertEqual(self.post({'samples':[row()]},path='/not-upload')[0],404)
  status,r,_=self.post({'v':2,'samples':[row()]},path='/ingest');self.assertEqual(status,200);self.assertEqual(r['receipt']['sourceTrust']['status'],'archive-only')
  self.assertEqual(self.server.trusted_inbox().view()['counts']['eligibleRecords'],0)
  status,r,_=self.post({'v':2,'storage':{'synthetic':'snapshot'}});self.assertEqual(status,200);self.assertTrue(r['receipt']['attachmentsArchived'])
  self.assertEqual(self.post({'v':99,'samples':[]})[0],400)
 def test_direct_headers_cannot_bypass_rate(self):
  self.server.BLACKLIST.add('127.0.0.1')  # Old misleading "blacklist" must not grant 999999 uploads.
  for i in range(12):self.assertEqual(self.post({'samples':[]},headers={'CF-Connecting-IP':'10.0.0.'+str(i),'X-Forwarded-For':'11.0.0.'+str(i)})[0],200)
  status,_,headers=self.post({'samples':[]},headers={'CF-Connecting-IP':'8.8.8.8'});self.assertEqual(status,429);self.assertGreater(int(headers['Retry-After']),0)
 def test_capabilities_closed_and_proxy_policy(self):
  with urllib.request.urlopen(self.url) as r:caps=json.load(r)
  self.assertEqual(caps['sourceAuthentication']['realmId'],self.authority.realm);self.assertTrue(caps['legacyArchiveAllowed']);self.assertFalse(caps['unauthenticatedTrainingAllowed'])
  with patch.object(self.server,'AUTH_DB_PATH',None):self.assertEqual(self.post(self.body([row()]),self.a)[0],503)
  self.assertEqual(client_ip('127.0.0.1',{'CF-Connecting-IP':'1.2.3.4'}),'127.0.0.1')
  self.assertEqual(client_ip('127.0.0.1',{'CF-Connecting-IP':'1.2.3.4'},proxy_networks('127.0.0.1/32')),'1.2.3.4')
  with self.assertRaises(AuthError):client_ip('127.0.0.1',{'X-Forwarded-For':'1.2.3.4,5.6.7.8'},proxy_networks('127.0.0.1/32'))
if __name__=='__main__':unittest.main(verbosity=2)
