import copy,importlib.util,json,os,pathlib,sqlite3,subprocess,sys,tempfile,threading,time,unittest
from test_trusted import ROOT,row,env,raw,pending,terminal
try:from source_auth import SourceAuthority,AuthError
except ImportError:SourceAuthority=None
from trusted_ingest import DurableInbox
class Auth(unittest.TestCase):
 def setUp(self):
  self.assertIsNotNone(SourceAuthority,'controlled source authority missing')
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=pathlib.Path(self.tmp.name)
  self.authority=SourceAuthority(self.base/'authority.sqlite',create=True,expected_endpoint='https://data.feiqiaoai.uno/');self.a=self.authority.issue('client-A','wuming-ai','https://data.feiqiaoai.uno/')
  self.b=self.authority.issue('client-B','wuming-ai','https://data.feiqiaoai.uno/');self.db=DurableInbox(self.base/'inbox')
 def envelope(self,rows,client='client-A'):return env(rows,instance=client)
 def send(self,e,credential):
  e=copy.deepcopy(e);e['source'].setdefault('principalId',credential['principalId']);e['source'].setdefault('realmId',credential['realmId'])
  with self.authority.authorize('Bearer '+credential['token'],e) as proof:return self.db.receive(raw(e),authorization=proof)
 def test_no_claim_without_authorization(self):
  self.db.receive(raw(self.envelope([row()])));self.assertEqual(self.db.view()['counts']['eligibleRecords'],0)
  self.assertEqual(self.db.view()['reasons']['E_SOURCE_AUTH_MISSING'],1)
 def test_a_b_isolation_forgery_and_same_instance(self):
  self.send(self.envelope([row()]),self.a);bad=row();bad['f'][0]=999
  with self.assertRaises(AuthError):self.send(self.envelope([bad]),self.b)
  self.send(self.envelope([row()],client='client-B'),self.b);self.assertEqual(self.db.view()['counts']['eligibleRecords'],2)
  same=self.authority.issue('client-A','wuming-ai','https://data.feiqiaoai.uno/')
  forged=self.envelope([bad]);forged['source'].update(principalId=self.a['principalId'],realmId=self.a['realmId'])
  with self.assertRaises(AuthError):self.send(forged,same)
  self.send(self.envelope([bad]),same);self.assertEqual(self.db.view()['counts']['eligibleRecords'],3)
 def test_rotate_revoke_expire_and_replay(self):
  body=self.envelope([row()]);self.send(body,self.a)
  new=self.authority.rotate(self.a['credentialId']);self.assertEqual(new['principalId'],self.a['principalId'])
  with self.assertRaises(AuthError):self.send(body,self.a)
  self.assertTrue(self.send(body,new)['duplicate_request']);self.authority.revoke(new['credentialId'])
  with self.assertRaises(AuthError):self.send(body,new)
  expired=self.authority.issue('expired','wuming-ai','https://data.feiqiaoai.uno/',ttl=-1)
  with self.assertRaises(AuthError):self.send(self.envelope([row()],client='expired'),expired)
  self.assertEqual(self.db.view()['counts']['eligibleRecords'],1)
 def test_revocation_linearization(self):
  finished=threading.Event();started=threading.Event()
  def revoke():started.set();self.authority.revoke(self.a['credentialId']);finished.set()
  e=self.envelope([row()]);e['source'].update(principalId=self.a['principalId'],realmId=self.a['realmId'])
  with self.authority.authorize('Bearer '+self.a['token'],e) as proof:
   worker=threading.Thread(target=revoke);worker.start();started.wait();self.assertFalse(finished.wait(.1));self.db.receive(raw(e),authorization=proof)
  worker.join(5);self.assertTrue(finished.is_set())
  with self.assertRaises(AuthError):self.send(self.envelope([terminal(row())]),self.a)
 def test_proof_and_raw_prepare_atomic(self):
  # Genuine DB trigger aborts insertion into new authorization sidecar.
  with self.db.connect() as c:c.execute("CREATE TRIGGER fail_auth BEFORE INSERT ON request_authorizations BEGIN SELECT RAISE(ABORT,'fail'); END")
  with self.assertRaises(Exception):self.send(self.envelope([row()]),self.a)
  with self.db.connect() as c:self.assertEqual(c.execute('select count(*) from requests').fetchone()[0],0)
  with self.db.connect() as c:c.execute('DROP TRIGGER fail_auth')
  self.send(self.envelope([row()]),self.a);self.assertEqual(self.db.view()['counts']['eligibleRecords'],1)
 def test_wait_observed_terminal_conflict_and_restart(self):
  for s in [pending(row()),row(),terminal(row())]:self.send(self.envelope([s]),self.a)
  for _ in range(10):self.send(self.envelope([terminal(row())]),self.a)
  self.db=DurableInbox(self.base/'inbox');self.assertEqual(self.db.view()['counts']['eligibleRecords'],1)
  bad=row();bad['m']['rewardStatus']='pending';self.send(self.envelope([bad]),self.a)
  self.assertEqual(self.db.view()['counts']['conflictTransactions'],1)
 def test_no_implicit_registration_or_database_creation(self):
  with self.assertRaises(AuthError):SourceAuthority(self.base/'missing.sqlite')
  self.assertFalse((self.base/'missing.sqlite').exists())
  with self.authority.connect() as c:
   saved=' '.join(str(x) for r in c.execute('SELECT * FROM credentials') for x in r)
   self.assertNotIn(self.a['token'],saved)
 def test_crash_prepared_rechecks_revocation_before_finalization(self):
  for revoke in (False,True):
   with self.subTest(revoked=revoke):
    credential=self.authority.issue('crash','wuming-ai','https://data.feiqiaoai.uno/');path=self.base/('credential-'+str(revoke)+'.json');path.write_text(json.dumps(credential))
    dest=self.base/('crash-'+str(revoke))
    code="import json,os,sys;from source_auth import SourceAuthority;from trusted_ingest import DurableInbox; c=json.load(open(sys.argv[2])); e={'v':3,'source':{'schema':'ingest-source-v1','domain':c['domain'],'instanceId':c['clientInstanceId'],'principalId':c['principalId'],'realmId':c['realmId']},'samples':json.load(open(sys.argv[4]))};a=SourceAuthority(sys.argv[1],expected_endpoint='https://data.feiqiaoai.uno/');d=DurableInbox(sys.argv[3]);d._checkpoint=lambda s:os._exit(73) if s=='prepared' else None\nwith a.authorize('Bearer '+c['token'],e) as proof:d.receive(json.dumps(e).encode(),authorization=proof)"
    rows=self.base/'synthetic-rows.json';rows.write_text(json.dumps([row()]))
    result=subprocess.run([sys.executable,'-c',code,str(self.authority.path),str(path),str(dest),str(rows)],env={**os.environ,'PYTHONPATH':str(ROOT/'server')},capture_output=True)
    self.assertEqual(result.returncode,73,result.stderr.decode())
    if revoke:self.authority.revoke(credential['credentialId'])
    restored=DurableInbox(dest,authorization_guard=self.authority.prepared_guard);view=restored.view()
    self.assertEqual(view['counts']['eligibleRecords'],0 if revoke else 1)
    self.assertEqual(len(list((dest/'requests').glob('*/*.json'))),1)
    if revoke:
     self.assertEqual(view['counts']['preparedRequests'],1)
     with restored.connect() as db:saved_raw=db.execute('SELECT raw FROM requests').fetchone()[0]
     renewed=self.authority.rotate(credential['credentialId'])
     with self.authority.authorize('Bearer '+renewed['token'],json.loads(saved_raw)) as proof:restored.receive(saved_raw,authorization=proof)
     self.assertEqual(restored.view()['counts']['eligibleRecords'],1)
    else:self.assertEqual(view['counts']['rawSampleRecords'],1)
 def test_cli_no_public_registration_and_no_secret_stdout(self):
  cli=ROOT/'server/source_auth.py';database=self.base/'operator.sqlite';output=self.base/'operator-private.json'
  def run(*args):return subprocess.run([sys.executable,str(cli),'--db',str(database),*args],capture_output=True,text=True)
  self.assertEqual(run('init').returncode,0)
  result=run('issue','--client-instance','operator-client','--endpoint','https://data.feiqiaoai.uno/','--output',str(output));self.assertEqual(result.returncode,0,result.stderr)
  c=json.loads(output.read_text());self.assertNotIn(c['token'],result.stdout)
  result=run('rotate','--credential-id',c['credentialId'],'--output',str(output));self.assertNotEqual(result.returncode,0)
  e=env([row()],instance=c['clientInstanceId']);e['source'].update(principalId=c['principalId'],realmId=c['realmId'])
  store=SourceAuthority(database,expected_endpoint='https://data.feiqiaoai.uno/')
  with store.authorize('Bearer '+c['token'],e):pass
  self.assertEqual(run('revoke','--credential-id',c['credentialId']).returncode,0)
  with self.assertRaises(AuthError):
   with store.authorize('Bearer '+c['token'],e):pass
if __name__=='__main__':unittest.main(verbosity=2)
