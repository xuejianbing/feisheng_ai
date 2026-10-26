import json,os,pathlib,subprocess,unittest
import test_source_http as fixture
from test_trusted import ROOT
class ClientNetwork(unittest.TestCase):
 setUp=fixture.SourceHTTP.setUp
 close=fixture.SourceHTTP.close
 def command(self,*args):
  client=pathlib.Path(os.environ.get('CLIENT_ROOT',os.getcwd()))
  p=subprocess.run(['node',str(client/'tools/source-auth-client-integration.mjs'),*map(str,args)],cwd=client,capture_output=True,text=True,encoding='utf-8')
  self.assertEqual(p.returncode,0,p.stderr[-6000:]);return p
 def prepare(self):
  client=pathlib.Path(os.environ.get('CLIENT_ROOT',os.getcwd()));state=self.base/'client-state.json'
  self.command('prepare',client/'tools/fixtures/source-auth-host-lineage.json',state)
  saved=json.loads(state.read_text());credential=self.authority.issue(saved['instanceId'],'wuming-ai','https://data.feiqiaoai.uno/');key=self.base/'private-test-credential.json';key.write_text(json.dumps(credential));return state,key,credential
 def test_real_host_chain_client_restart_and_response_loss(self):
  state,key,c=self.prepare();evidence=self.base/'public-evidence.json';self.command('upload',self.url,state,key,evidence,'loss')
  data=json.loads(evidence.read_text());self.assertFalse(data['pendingRetained']);self.assertFalse(data['tokenInStatus']);self.assertEqual(data['postedHashes'][0],data['postedHashes'][1])
  view=self.server.trusted_inbox().view();self.assertEqual(view['counts']['eligibleRecords'],1);self.assertEqual(view['counts']['uniqueLogicalTransactions'],1);self.assertGreaterEqual(view['counts']['duplicateRequests'],1)
  self.assertIn(view['samples'][0]['sample']['m']['gameOutcome'],('win','lose'))
  out=os.environ.get('SOURCE_AUTH_EVIDENCE_DIR')
  if out:
   pathlib.Path(out).mkdir(exist_ok=True);(pathlib.Path(out)/'REAL-CLIENT-HTTP.json').write_text(json.dumps({'client':data,'backendCounts':view['counts'],'backendReasons':view['reasons']},indent=2))
 def test_rejection_rotation_resume_unchanged_pending(self):
  state,key,c=self.prepare();bad={**c,'token':c['token'][:-1]+('x' if c['token'][-1]!='x' else 'y')};key.write_text(json.dumps(bad));evidence=self.base/'failure.json'
  self.command('upload',self.url,state,key,evidence,'rejected');saved=json.loads(state.read_text());old_pending=saved['disk']
  self.assertTrue(json.loads(evidence.read_text())['pendingRetained']);self.assertEqual(self.server.trusted_inbox().view()['counts']['rawRequests'],0)
  rotated=self.authority.rotate(c['credentialId']);key.write_text(json.dumps(rotated));self.command('upload',self.url,state,key,self.base/'resumed.json','resume')
  self.assertEqual(self.server.trusted_inbox().view()['counts']['eligibleRecords'],1)
if __name__=='__main__':unittest.main(verbosity=2)
