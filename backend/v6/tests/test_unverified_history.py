import hashlib,json,os,pathlib,subprocess,sys,tempfile,unittest
from test_trusted import ROOT,row,env,raw
from trusted_ingest import DurableInbox
import trusted_dataset
class History(unittest.TestCase):
 def test_self_claimed_historical_mapping_does_not_grant_trust(self):
  with tempfile.TemporaryDirectory() as directory:
   base=pathlib.Path(directory);src=base/'raw';src.mkdir();p=src/'hour.json';p.write_bytes(raw([{'samples':[row()]}]));before=p.read_bytes()
   report=trusted_dataset.migrate(src,base/'dry-run',source={'schema':'ingest-source-v1','domain':'claimed','instanceId':'unverified'})
   self.assertEqual(report['view']['counts']['eligibleRecords'],0);self.assertEqual(p.read_bytes(),before)
 def test_existing_v2_rows_stay_raw_and_lose_no_bytes(self):
  baseline=pathlib.Path(os.environ.get('BACKEND_V2_ROOT',str(ROOT.parent/'baseline-v2')))/'server'
  # The delivered v3 package can be audited with the separately retained v2 base.
  self.assertTrue(baseline.is_dir(),'retain/extract the verified v2 base beside work for the comparison probe')
  with tempfile.TemporaryDirectory() as directory:
   base=pathlib.Path(directory);body=base/'synthetic.json';body.write_bytes(raw(env([row()])));dest=base/'inbox'
   code="import sys;from trusted_ingest import DurableInbox;d=DurableInbox(sys.argv[1]);d.receive(open(sys.argv[2],'rb').read());assert d.view()['counts']['eligibleRecords']==1"
   p=subprocess.run([sys.executable,'-c',code,str(dest),str(body)],env={**os.environ,'PYTHONPATH':str(baseline)},capture_output=True)
   self.assertEqual(p.returncode,0,p.stderr.decode());files={str(p.relative_to(dest)):p.read_bytes() for p in (dest/'requests').glob('*/*.json')}
   view=DurableInbox(dest).view();self.assertEqual(view['counts']['eligibleRecords'],0);self.assertEqual(view['counts']['rawSampleRecords'],1)
   self.assertEqual(files,{str(p.relative_to(dest)):p.read_bytes() for p in (dest/'requests').glob('*/*.json')})
if __name__=='__main__':unittest.main(verbosity=2)
