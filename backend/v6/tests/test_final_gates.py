"""Source isolation and reference qualification; all inputs are synthetic."""
import copy,json,pathlib,subprocess,sys,tempfile,unittest
import test_training_pipeline as fixtures
from auth_fixture import FixtureInbox
from test_trusted import row,env,raw
import trusted_trainer as trainer,model_validation as validator
from pipeline_io import read

class IsolationGates(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=pathlib.Path(self.tmp.name)
 def test_arbitrary_authenticated_inbox_cannot_train_or_export(self):
  inbox=FixtureInbox(self.base/'production-like');inbox.receive(raw(env([row()])))
  with self.assertRaisesRegex(ValueError,'E_ISOLATION_SOURCE'):trainer.train(self.base/'not-read',inbox,self.base/'missing-client',self.base/'candidate',17)
  with self.assertRaisesRegex(ValueError,'E_ISOLATION_SOURCE'):trainer.export_dataset(inbox,self.base/'export.json')
  self.assertFalse((self.base/'candidate').exists());self.assertFalse((self.base/'export.json').exists())
 def test_cli_rejects_production_paths_without_opening_them(self):
  sentinel=self.base/'production.sqlite';sentinel.write_bytes(b'production-sentinel-not-a-test-database')
  p=subprocess.run([sys.executable,str(pathlib.Path(trainer.__file__)),'--inbox',str(sentinel),'--auth-db',str(sentinel),'--public-endpoint','https://production.invalid/','--dataset',str(self.base/'data'),'--seed','17','--test-only','--export-only'],capture_output=True)
  self.assertNotEqual(p.returncode,0);self.assertIn(b'E_ISOLATION_SOURCE',p.stderr);self.assertEqual(sentinel.read_bytes(),b'production-sentinel-not-a-test-database');self.assertFalse((self.base/'data').exists())
 def test_only_new_process_owned_synthetic_inbox_is_accepted(self):
  from synthetic_isolation import SyntheticInbox,require_synthetic_inbox
  inbox=SyntheticInbox();self.addCleanup(inbox.close);require_synthetic_inbox(inbox)
  inbox.receive(raw(env([row()])));self.assertEqual(inbox.view()['counts']['eligibleRecords'],1)
  impostor=FixtureInbox(self.base/'copy');impostor.synthetic=True;impostor.test_only=True
  with self.assertRaisesRegex(ValueError,'E_ISOLATION_SOURCE'):require_synthetic_inbox(impostor)
 def test_real_values_and_unknown_player_metadata_are_not_synthetic(self):
  from synthetic_isolation import SyntheticInbox
  inbox=SyntheticInbox();self.addCleanup(inbox.close)
  for mutation in ['features','identity','extra']:
   s=row()
   if mutation=='features':s['f']=[42]*134
   elif mutation=='identity':s['m']['player']='actual-player'
   else:s['m']['synthetic']=True
   with self.assertRaisesRegex(ValueError,'E_SYNTHETIC_DATA'):inbox.receive(raw(env([s])))
  self.assertEqual(inbox.view()['counts']['eligibleRecords'],0)
 def test_replacing_owned_database_invalidates_capability(self):
  from synthetic_isolation import SyntheticInbox,require_synthetic_inbox
  inbox=SyntheticInbox();self.addCleanup(inbox.close);path=pathlib.Path(inbox.path)
  path.rename(path.with_suffix('.saved'));path.write_bytes(b'replaced')
  with self.assertRaisesRegex(ValueError,'E_ISOLATION_SOURCE'):require_synthetic_inbox(inbox)
 def test_owned_capability_does_not_allow_external_dataset_or_raw_worker_data(self):
  from synthetic_isolation import SyntheticInbox
  inbox=SyntheticInbox();self.addCleanup(inbox.close);sentinel=self.base/'production.sqlite';sentinel.write_bytes(b'do-not-read')
  with self.assertRaisesRegex(ValueError,'E_ISOLATION_SOURCE'):trainer.train(sentinel,inbox,self.base/'client',self.base/'candidate',17)
  self.assertEqual(sentinel.read_bytes(),b'do-not-read')
  real=row();real['f']=[42]*134
  with self.assertRaisesRegex(ValueError,'E_SYNTHETIC_DATA'):trainer.worker(self.base/'client',dict(operation='train',rows=[real]),isolation=inbox)
 def test_cli_generates_new_synthetic_source_without_input_database(self):
  target=self.base/'synthetic.json'
  p=subprocess.run([sys.executable,str(pathlib.Path(trainer.__file__)),'--dataset',str(target),'--seed','17','--test-only','--export-only'],capture_output=True)
  self.assertEqual(p.returncode,0,p.stderr);self.assertTrue(target.exists());self.assertEqual(sum(len(rows) for rows in read(target)['partitions'].values()),32)
 def test_exact_130_normalization_remains_trainable_but_forged_lineage_does_not(self):
  from synthetic_isolation import SyntheticInbox
  from training_contract import qualify
  import os
  inbox=SyntheticInbox();self.addCleanup(inbox.close);original=row('legacy',dim=130)
  inbox.receive(raw(env([original])));path=self.base/'legacy.json';trainer.export_dataset(inbox,path,seed='c1')
  bundle=trainer.load_dataset(path,inbox);sample=next(r['sample'] for rows in bundle['partitions'].values() for r in rows)
  self.assertEqual(sample['f'][:130],original['f']);self.assertEqual(sample['f'][130:],[0]*4);self.assertEqual(sample['_missingFeatureIndices'],[130,131,132,133]);self.assertTrue(qualify(sample)['eligible'])
  request=dict(operation='train',rows=[sample],config=dict(seed=17,epochs=1,batchSize=32,learningRate=.0005,useResidual=False))
  result=trainer.worker(os.environ['CLIENT_ROOT'],request,isolation=inbox);self.assertEqual(result['actualTrainedRows'],1)
  for field,value in [('_originalDim',134),('_missingFeatureIndices',[130]),('f',sample['f'][:130]+[1]*4)]:
   bad=copy.deepcopy(sample);bad[field]=value
   with self.assertRaisesRegex(ValueError,'E_SYNTHETIC_DATA'):trainer.worker(os.environ['CLIENT_ROOT'],{**request,'rows':[bad]},isolation=inbox)

class ReferenceGates(unittest.TestCase):
 def setUp(self):
  fixtures.TrainingPipeline.setUp(self)
  self.candidate=self.base/'candidate';trainer.train(self.path,self.inbox,self.client,self.candidate,17,epochs=1)
  self.reference=self.base/'reference';trainer.train(self.path,self.inbox,self.client,self.reference,17,epochs=1)
 def test_structural_manifest_alone_never_qualifies_reference(self):
  validator.check_candidate(self.reference)
  with self.assertRaisesRegex(ValueError,'E_REFERENCE_NOT_VERIFIED'):validator.validate(self.candidate,self.inbox,self.client,baseline=self.reference)
  self.assertFalse((self.candidate/'verified.json').exists())
 def test_technical_reference_and_identical_bad_predictions_do_not_grant_quality(self):
  validator.validate(self.reference,self.inbox,self.client)
  proof=validator.validate(self.candidate,self.inbox,self.client,baseline=self.reference)
  self.assertFalse(proof['qualityPassed']);self.assertFalse(proof['productionEligible'])
  report=read(self.candidate/'validation.json')
  self.assertEqual(report['quality']['status'],'insufficient-qualification')
  self.assertEqual(report['baseline']['qualification'],'technical-synthetic-only')
  self.assertIn('technicalComparison',report);self.assertFalse(validator.initial_quality_gate()['ok'])
  self.assertFalse(validator.initial_quality_gate()['productionEligible'])
 def test_corrupt_reference_validation_cannot_be_reused(self):
  validator.validate(self.reference,self.inbox,self.client);(self.reference/'validation.json').write_text('{}')
  with self.assertRaisesRegex(ValueError,'E_REFERENCE_NOT_VERIFIED'):validator.validate(self.candidate,self.inbox,self.client,baseline=self.reference)

if __name__=='__main__':unittest.main(verbosity=2)
