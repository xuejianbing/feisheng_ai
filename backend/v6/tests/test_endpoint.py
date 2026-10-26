import copy,json,os,pathlib,sqlite3,subprocess,sys,tempfile,unittest
from test_trusted import row,env,raw,ROOT
from source_auth import SourceAuthority,AuthError
from trusted_ingest import DurableInbox
A='https://endpoint-a.example/';B='https://endpoint-b.example/'
class Endpoint(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=pathlib.Path(self.tmp.name)
  self.a=SourceAuthority(self.base/'authority.sqlite',create=True,expected_endpoint=A);self.key=self.a.issue('client','wuming-ai',A)
  self.b=SourceAuthority(self.a.path,expected_endpoint=B)
  self.e=env([row()],instance='client');self.e['source'].update(principalId=self.key['principalId'],realmId=self.key['realmId'])
 def accept(self,authority,key=None):
  c=key or self.key;e=copy.deepcopy(self.e);e['source'].update(instanceId=c['clientInstanceId'],principalId=c['principalId'],realmId=c['realmId'])
  with authority.authorize('Bearer '+c['token'],e) as proof:return proof.record()
 def test_same_store_rejects_other_endpoint_without_mutation(self):
  self.accept(self.a);before=self.a.path.read_bytes()
  with self.assertRaises(AuthError) as error:self.accept(self.b)
  self.assertEqual(error.exception.code,'E_SOURCE_ENDPOINT_MISMATCH');self.assertEqual(error.exception.status,403)
  with self.a.connect() as c:self.assertEqual(c.execute('SELECT count(*) FROM credentials').fetchone()[0],1)
 def test_equivalent_host_scheme_port_and_root(self):
  alias=SourceAuthority(self.a.path,expected_endpoint='HTTPS://ENDPOINT-A.EXAMPLE:443')
  self.accept(alias)
  legacy=self.a.issue('client','wuming-ai',A)
  with self.a.connect() as c:c.execute('UPDATE credentials SET endpoint=? WHERE id=?',('HTTPS://ENDPOINT-A.EXAMPLE:443',legacy['credentialId']))
  self.accept(alias,legacy)
  with self.a.connect() as c:self.assertEqual(c.execute('SELECT endpoint FROM credentials WHERE id=?',(legacy['credentialId'],)).fetchone()[0],'HTTPS://ENDPOINT-A.EXAMPLE:443')
 def test_paths_are_not_collapsed_or_case_folded(self):
  for path in ['/ingest','/ingest/','/Ingest','/other']:
   key=self.a.issue('client','wuming-ai','https://endpoint-a.example'+path)
   with self.assertRaises(AuthError):self.accept(self.a,key)
   self.accept(SourceAuthority(self.a.path,expected_endpoint='https://endpoint-a.example'+path),key)
 def test_missing_config_never_authenticates_or_recovers(self):
  service=SourceAuthority(self.a.path)
  with self.assertRaises(AuthError) as error:self.accept(service)
  self.assertEqual(error.exception.code,'E_SOURCE_ENDPOINT_CONFIG')
  proof=self.accept(self.a)
  with self.assertRaises(AuthError):
   with service.prepared_guard(proof):pass
 def test_bad_configuration_and_issue_formats(self):
  bad=['',' ','not-a-url','ftp://endpoint-a.example/','http://endpoint-a.example/','https://user:pass@endpoint-a.example/','https://endpoint-a.example/?x=1','https://endpoint-a.example/#fragment','https://endpoint-a.example:0/','https://endpoint-a.example:99999/','https://endpoint-a.example/../x','https://endpoint-a.example/%2e%2e/x','https://endpoint-a.example/%0d%0a','https://endpoint-a.example\\@evil.example/','https://endpoint-a.example/%zz','https://end\npoint-a.example/']
  for value in bad:
   with self.subTest(endpoint=value):
    with self.assertRaises(AuthError):SourceAuthority(self.a.path,expected_endpoint=value)
    with self.assertRaises(AuthError):self.a.issue('client','wuming-ai',value)
 def test_http_is_explicit_loopback_only(self):
  for value in ['http://127.0.0.1:18889/','http://localhost:18889/','http://[::1]:18889/']:
   with self.assertRaises(AuthError):SourceAuthority(self.a.path,expected_endpoint=value)
   local=SourceAuthority(self.a.path,expected_endpoint=value,allow_loopback_http=True);key=local.issue('client','wuming-ai',value);self.accept(local,key)
  with self.assertRaises(AuthError):SourceAuthority(self.a.path,expected_endpoint='http://192.168.1.1/',allow_loopback_http=True)
 def test_rotate_retains_endpoint_and_revokes_old(self):
  oldproof=self.accept(self.a);new=self.a.rotate(self.key['credentialId']);self.assertEqual(new['endpoint'],A);self.assertEqual(new['principalId'],self.key['principalId']);proof=self.accept(self.a,new)
  with self.assertRaises(AuthError):self.accept(self.a)
  with self.assertRaises(AuthError):self.accept(self.b,new)
  with self.a.prepared_guard(oldproof) as accepted:self.assertFalse(accepted)
  with self.a.prepared_guard(proof) as accepted:self.assertTrue(accepted)
  with self.b.prepared_guard(proof) as accepted:self.assertFalse(accepted)
  with self.a.connect() as c:c.execute('UPDATE credentials SET expires=0 WHERE id=?',(new['credentialId'],))
  with self.a.prepared_guard(proof) as accepted:self.assertFalse(accepted)
 def test_cli_validates_and_preserves_endpoint(self):
  cli=ROOT/'server/source_auth.py';out=self.base/'private-key.json'
  def run(*args):return subprocess.run([sys.executable,str(cli),'--db',str(self.a.path),*args],capture_output=True,text=True)
  result=run('issue','--client-instance','client','--endpoint','HTTPS://ENDPOINT-A.EXAMPLE:443','--output',str(out));self.assertEqual(result.returncode,0,result.stderr)
  key=json.loads(out.read_text());self.assertEqual(key['endpoint'],A);self.assertNotIn(key['token'],result.stdout)
  rotated=self.base/'private-rotated.json';result=run('rotate','--credential-id',key['credentialId'],'--output',str(rotated));self.assertEqual(result.returncode,0,result.stderr)
  new=json.loads(rotated.read_text());self.assertEqual(new['endpoint'],A);self.assertEqual(new['principalId'],key['principalId']);self.accept(self.a,new)
  bad=run('issue','--client-instance','client','--endpoint','http://outside.example/','--output',str(self.base/'invalid.json'));self.assertNotEqual(bad.returncode,0);self.assertIn('E_SOURCE_ENDPOINT_INVALID',bad.stderr)
 def test_prepared_cross_service_stays_pending_raw_then_recovers_on_a(self):
  db=DurableInbox(self.base/'inbox');db._checkpoint=lambda stage:(_ for _ in ()).throw(SystemExit(71)) if stage=='prepared' else None
  with self.assertRaises(SystemExit):
   with self.a.authorize('Bearer '+self.key['token'],self.e) as proof:db.receive(raw(self.e),authorization=proof)
  recovered=DurableInbox(self.base/'inbox',authorization_guard=self.b.prepared_guard)
  self.assertEqual(recovered.view()['counts']['preparedRequests'],1);self.assertEqual(recovered.view()['counts']['eligibleRecords'],0)
  files=list((self.base/'inbox/requests').glob('*/*.json'));self.assertEqual(len(files),1);self.assertEqual(files[0].read_bytes(),raw(self.e))
  renewed=self.a.rotate(self.key['credentialId']);restored=DurableInbox(self.base/'inbox',authorization_guard=self.a.prepared_guard)
  with self.a.authorize('Bearer '+renewed['token'],self.e) as proof:restored.receive(raw(self.e),authorization=proof)
  self.assertEqual(restored.view()['counts']['eligibleRecords'],1)
if __name__=='__main__':unittest.main(verbosity=2)
