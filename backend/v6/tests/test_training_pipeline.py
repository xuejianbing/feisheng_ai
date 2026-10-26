"""Synthetic authenticated inbox, real client optimizer, no player storage."""
import copy,json,os,pathlib,sys,tempfile,unittest
from unittest.mock import patch
from test_trusted import ROOT,row,env,raw,pending,terminal
from auth_fixture import FixtureInbox
sys.path.insert(0,str(ROOT/'training'))
try:import trusted_trainer as trainer
except ImportError:trainer=None
def trainer_synthetic_inbox(test):
 from synthetic_isolation import SyntheticInbox
 inbox=SyntheticInbox();test.addCleanup(inbox.close);return inbox

class TrainingPipeline(unittest.TestCase):
 def setUp(self):
  self.assertIsNotNone(trainer,'C1 trusted trainer adapter is absent')
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=pathlib.Path(self.tmp.name)
  self.client=pathlib.Path(os.environ.get('CLIENT_ROOT',os.getcwd()));self.inbox=trainer_synthetic_inbox(self)
  self.rows=[]
  for i in range(32):
   s=row('action','session-'+str(i));s['f']=[(j+i)%9-4 for j in range(134)]
   s['m']['modeContext']=dict(group='doudizhu-classic',submode='normal',role='farmer',ruleKey='test-rule')
   self.rows.append(s)
  self.inbox.receive(raw(env(self.rows)));self.path=self.base/'dataset.json'
  trainer.export_dataset(self.inbox,self.path,seed='c1')
 def train(self,name='candidate',**config):return trainer.train(self.path,self.inbox,self.client,self.base/name,seed=17,epochs=1,**config)
 def test_only_live_trusted_view_not_raw_or_forged_bundle(self):
  bad=self.base/'raw.json';bad.write_text(json.dumps(self.rows))
  with self.assertRaisesRegex(ValueError,'E_MANIFEST'):trainer.load_dataset(bad,self.inbox)
  bundle=json.loads(self.path.read_text());bundle['partitions']['training'][0]['sample']['f'][0]=99;bad.write_text(json.dumps(bundle))
  with self.assertRaisesRegex(ValueError,'E_MANIFEST'):trainer.load_dataset(bad,self.inbox)
 def test_changed_inbox_invalidates_dataset_even_rejected_row(self):
  extra=row('new');extra['f']=extra['f'][:12];self.inbox.receive(raw(env([extra])))
  with self.assertRaisesRegex(ValueError,'E_MANIFEST_CHANGED'):trainer.load_dataset(self.path,self.inbox)
 def test_namespaced_whole_sessions_and_no_duplicate_training(self):
  self.inbox.receive(raw(env([pending(self.rows[0]),terminal(self.rows[0])])));self.inbox.receive(raw(env([self.rows[0]],instance='other')))
  fresh=self.base/'revisions.json';trainer.export_dataset(self.inbox,fresh,seed='c1');b=trainer.load_dataset(fresh,self.inbox)
  self.assertEqual(sum(map(len,b['partitions'].values())),33)
  sets=[set(b['manifest']['splits']['sessions'][k]) for k in ['training','validation','holdout']]
  self.assertTrue(all(not sets[i]&sets[j] for i in range(3) for j in range(i)))
 def test_130_missing_features_retained_and_142_rejected(self):
  self.inbox.receive(raw(env([row('legacy',dim=130),row('experimental',dim=142)])))
  p=self.base/'dims.json';trainer.export_dataset(self.inbox,p);b=trainer.load_dataset(p,self.inbox)
  samples=[r['sample'] for rows in b['partitions'].values() for r in rows]
  legacy=next(s for s in samples if s['m']['transactionId']=='legacy')
  self.assertEqual(len(legacy['f']),134);self.assertTrue(legacy['_dimAdapted']);self.assertEqual(legacy['f'][130:],[0,0,0,0])
  self.assertFalse(any(s['m']['transactionId']=='experimental' for s in samples))
 def test_fixed_seed_real_training_is_reproducible_and_only_train_partition(self):
  before=self.path.read_bytes();a=self.train('a');b=self.train('b')
  self.assertEqual(a['modelSHA256'],b['modelSHA256']);self.assertEqual(before,self.path.read_bytes())
  self.assertEqual(a['actualTrainedRows'],len(json.loads(before)['partitions']['training']))
  self.assertEqual(a['partitionsReadByOptimizer'],['training']);self.assertFalse(a['productionEligible'])
  self.assertEqual(a['state'],'trained');self.assertNotEqual(a['candidateId'],b['candidateId'])
 def test_existing_output_and_bad_config_never_overwrite(self):
  target=self.base/'existing';target.mkdir();(target/'keep').write_text('stable')
  with self.assertRaises((FileExistsError,ValueError)):trainer.train(self.path,self.inbox,self.client,target,seed=17)
  self.assertEqual((target/'keep').read_text(),'stable')
  with self.assertRaisesRegex(ValueError,'E_TRAIN_CONFIG'):self.train(epochs_override=0)
 def test_input_change_during_training_leaves_failed_candidate_only(self):
  real_worker=trainer.worker
  def changed(*args,**kwargs):
   result=real_worker(*args,**kwargs);self.inbox.receive(raw(env([row('late')])));return result
  with patch.object(trainer,'worker',side_effect=changed):
   with self.assertRaisesRegex(ValueError,'E_MANIFEST_CHANGED'):self.train()
  status=json.loads((self.base/'candidate/status.json').read_text());self.assertEqual(status['state'],'rejected');self.assertFalse((self.base/'candidate/manifest.json').exists())
 def test_client_contract_change_is_rejected_before_optimizer(self):
  with self.assertRaisesRegex(ValueError,'E_CLIENT_CONTRACT'):trainer.train(self.path,self.inbox,self.base/'missing-client',self.base/'no',seed=17)
if __name__=='__main__':unittest.main(verbosity=2)
