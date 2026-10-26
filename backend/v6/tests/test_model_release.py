import copy,json,pathlib,sqlite3,unittest,threading,os,subprocess,sys
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import test_training_pipeline as fixtures
from pipeline_io import read,write_status
import trusted_trainer,model_validation
try:import model_release as release
except ImportError:release=None
class ModelRelease(unittest.TestCase):
 def setUp(self):
  self.assertIsNotNone(release,'C3 isolated publisher is absent');fixtures.TrainingPipeline.setUp(self)
  # Grow only the already-held-out sessions. The optimizer still gets the same
  # small training partition; the original per-group 150 quality floor is real.
  from test_trusted import env,raw
  bundle=read(self.path);extra=[]
  for group in ['validation','holdout']:
   for i in range(149):
    sample=copy.deepcopy(bundle['partitions'][group][0]['sample']);sample['m']['transactionId']='extra-'+str(i);sample['m']['actionOutcome']['transactionId']='extra-'+str(i);extra.append(sample)
  self.inbox.receive(raw(env(extra)));self.path=self.base/'release-dataset.json';trusted_trainer.export_dataset(self.inbox,self.path,seed='c1')
  reference=self.base/'reference';trusted_trainer.train(self.path,self.inbox,self.client,reference,seed=17,epochs=1)
  model_validation.validate(reference,self.inbox,self.client)
  self.candidate=self.base/'candidate';trusted_trainer.train(self.path,self.inbox,self.client,self.candidate,seed=17,epochs=1)
  model_validation.validate(self.candidate,self.inbox,self.client,baseline=reference)
  self.storeRoot=self.base/'release';self.key=release.initialize(self.storeRoot,test_only=True)
  self.store=release.ReleaseStore(self.storeRoot,self.key,self.inbox,self.client)
  self.cid=read(self.candidate/'manifest.json')['candidateId']
 def activate(self,directory=None,op='activate-one'):
  cid=self.store.stage(directory or self.candidate)['candidateId'];return self.store.activate(cid,self.store.status()['revision'],op)
 def next_candidate(self):
  other=self.base/'other';trusted_trainer.train(self.path,self.inbox,self.client,other,seed=17,epochs=1);model_validation.validate(other,self.inbox,self.client,baseline=self.candidate);return other
 def test_unverified_or_production_store_is_rejected(self):
  with self.assertRaisesRegex(ValueError,'E_TEST_ONLY'):release.initialize(self.base/'production',test_only=False)
  (self.candidate/'verified.json').unlink()
  with self.assertRaisesRegex(ValueError,'E_VALIDATION_BINDING'):self.store.stage(self.candidate)
  self.assertIsNone(self.store.status()['current'])
 def test_stage_activate_retry_and_restart_keep_full_identity(self):
  result=self.activate();self.assertEqual(result['current'],self.cid);self.assertEqual(result,self.store.activate(self.cid,0,'activate-one'))
  restarted=release.ReleaseStore(self.storeRoot,self.key,self.inbox,self.client);self.assertEqual(restarted.resolve()['candidateId'],self.cid)
  self.assertFalse(restarted.resolve()['productionEligible']);self.assertTrue((self.storeRoot/'versions'/self.cid/'verified.json').exists())
 def test_upload_credential_or_wrong_local_capability_has_no_publish_permission(self):
  bad=release.ReleaseStore(self.storeRoot,'sa1.not-a-release-key',self.inbox,self.client)
  with self.assertRaisesRegex(ValueError,'E_RELEASE_AUTH'):bad.stage(self.candidate)
  self.assertIsNone(self.store.status()['current'])
 def test_same_id_parameter_replace_during_switch_preserves_current_and_previous(self):
  self.activate();other=self.next_candidate();cid=self.store.stage(other)['candidateId'];before=self.store.status()
  p=self.storeRoot/'versions'/cid/'model.json';original=p.read_bytes()
  for boundary in ['before-switch','before-commit']:
   def event(phase):
    if phase==boundary:
     s=read(p);s['W1'][0]+=.1;write_status(p,s)
   self.store.on_event=event
   try:
    with self.assertRaisesRegex(ValueError,'E_CANDIDATE_CHANGED'):self.store.activate(cid,before['revision'],'attack')
    self.assertEqual(self.store.status(),before)
   finally:p.write_bytes(original)
 def test_validation_report_replace_or_files_missing_cannot_activate(self):
  cid=self.store.stage(self.candidate)['candidateId'];p=self.storeRoot/'versions'/cid/'validation.json';p.write_text('{}')
  with self.assertRaisesRegex(ValueError,'E_CANDIDATE_CHANGED'):self.store.activate(cid,0,'bad')
  self.assertIsNone(self.store.status()['current'])
 def test_write_failure_keeps_current_and_rollback_evidence(self):
  self.activate();other=self.next_candidate();cid=self.store.stage(other)['candidateId'];before=self.store.status()
  def event(phase):
   if phase=='before-commit':raise OSError('synthetic disk failure')
  self.store.on_event=event
  with self.assertRaises(OSError):self.store.activate(cid,before['revision'],'failed')
  self.assertEqual(self.store.status(),before);self.assertEqual(self.store.resolve()['candidateId'],self.cid)
 def test_successful_commit_response_loss_is_idempotent(self):
  cid=self.store.stage(self.candidate)['candidateId']
  def event(phase):
   if phase=='committed':raise ConnectionError('response lost')
  self.store.on_event=event
  with self.assertRaises(ConnectionError):self.store.activate(cid,0,'lost')
  self.store.on_event=None;self.assertEqual(self.store.activate(cid,0,'lost')['current'],cid);self.assertEqual(self.store.status()['revision'],1)
 def test_concurrent_publication_uses_compare_and_swap(self):
  first=self.store.stage(self.candidate)['candidateId'];other=self.next_candidate();second=self.store.stage(other)['candidateId'];barrier=threading.Barrier(2)
  def run(cid):
   s=release.ReleaseStore(self.storeRoot,self.key,self.inbox,self.client);barrier.wait()
   try:return s.activate(cid,0,'op-'+cid)
   except ValueError as e:return str(e)
  with ThreadPoolExecutor(2) as pool:results=list(pool.map(run,[first,second]))
  self.assertEqual(sum(isinstance(r,dict) for r in results),1);self.assertIn('E_PUBLISH_CONFLICT',results);self.assertEqual(self.store.status()['revision'],1)
 def test_corrupt_current_rolls_back_and_restart_keeps_previous(self):
  self.activate();other=self.next_candidate();next_id=self.activate(other,'two')['current']
  p=self.storeRoot/'versions'/next_id/'model.json';p.write_text('{corrupt')
  result=self.store.resolve();self.assertEqual(result['candidateId'],self.cid);self.assertTrue(result['fallback'])
  self.assertEqual(release.ReleaseStore(self.storeRoot,self.key,self.inbox,self.client).status()['current'],self.cid);self.assertTrue(p.exists())
 def test_both_versions_corrupt_return_public_default_without_deleting_files(self):
  self.activate();other=self.next_candidate();second=self.activate(other,'two')['current']
  for cid in [self.cid,second]:(self.storeRoot/'versions'/cid/'model.json').write_text('{}')
  result=self.store.resolve();self.assertEqual(result['status'],'public-default-required');self.assertIsNone(result['snapshot']);self.assertTrue((self.storeRoot/'versions'/self.cid/'manifest.json').exists())
 def test_rollback_failure_keeps_working_current(self):
  self.activate();other=self.next_candidate();second=self.activate(other,'two')['current'];before=self.store.status()
  def event(phase):
   if phase=='before-commit':raise OSError('rollback failure')
  self.store.on_event=event
  with self.assertRaises(OSError):self.store.rollback(before['revision'],'rollback')
  self.assertEqual(self.store.status(),before);self.assertEqual(self.store.resolve()['candidateId'],second)
 def test_shadow_disable_and_exception_never_changes_active_pointer(self):
  self.activate();other=self.next_candidate();second=self.store.stage(other)['candidateId'];before=self.store.status()
  shadow=release.ShadowSession(self.store,second,'isolated-match')
  result=shadow.predict([1]*134);self.assertFalse(result['changesSelection']);self.assertEqual(result['sessionId'],'isolated-match');self.assertIn('disagrees',result)
  shadow.enabled=False;self.assertEqual(shadow.predict([1]*134)['status'],'disabled');self.assertEqual(self.store.status(),before)
  shadow.enabled=True;shadow.candidate['W1']=[];self.assertEqual(shadow.predict([1]*134)['status'],'candidate-error');self.assertEqual(self.store.status(),before)
 def test_dataset_revision_after_stage_blocks_activation(self):
  from test_trusted import row,env,raw
  cid=self.store.stage(self.candidate)['candidateId'];self.inbox.receive(raw(env([row('late')])))
  with self.assertRaisesRegex(ValueError,'E_MANIFEST_CHANGED'):self.store.activate(cid,0,'stale')
  self.assertIsNone(self.store.status()['current'])
 def test_first_client_inference_failure_preserves_pointer(self):
  cid=self.store.stage(self.candidate)['candidateId']
  with patch.object(release,'worker',side_effect=ValueError('E_CLIENT_WORKER')):
   with self.assertRaisesRegex(ValueError,'E_CLIENT_WORKER'):self.store.activate(cid,0,'load-error')
  self.assertIsNone(self.store.status()['current'])
 def test_first_real_input_failure_rolls_back_without_retraining(self):
  self.activate();other=self.next_candidate();second=self.activate(other,'second')['current']
  real_predict=release.predict;failed=False
  def fail_candidate(snapshot,f,residual=False):
   nonlocal failed
   if f==[1]*134 and not failed:failed=True;raise ValueError('synthetic first inference failure')
   return real_predict(snapshot,f,residual)
  with patch.object(release,'predict',side_effect=fail_candidate):
   result=self.store.predict([1]*134);self.assertEqual(result['candidateId'],self.cid);self.assertTrue(result['fallback'])
  self.assertEqual(self.store.status()['current'],self.cid)
 def test_process_crash_before_pointer_commit_recovers_and_staging_resumes(self):
  code='''import os,pathlib,sys
from trusted_ingest import DurableInbox
from model_release import ReleaseStore
root=pathlib.Path(sys.argv[1]);store=ReleaseStore(root,(root/'operator.key').read_text(),DurableInbox(sys.argv[2]),pathlib.Path(sys.argv[3]),on_event=lambda phase:os._exit(76) if phase==sys.argv[5] else None)
cid=store.stage(pathlib.Path(sys.argv[4]))['candidateId'];store.activate(cid,0,'crashed')
'''
  env={**os.environ,'PYTHONPATH':os.pathsep.join([str(release.pathlib.Path(release.__file__).parent),str(fixtures.ROOT/'server')])}
  for phase in ['staged-files','before-commit']:
   child=subprocess.run([sys.executable,'-c',code,str(self.storeRoot),str(self.inbox.base),str(self.client),str(self.candidate),phase],env=env,capture_output=True)
   self.assertEqual(child.returncode,76,child.stderr);self.assertIsNone(self.store.status()['current'])
  self.assertEqual(self.activate()['current'],self.cid)
 def test_rollback_response_loss_retries_original_operation_without_switching_again(self):
  self.activate();other=self.next_candidate();self.activate(other,'second');before=self.store.status()
  def lost(phase):
   if phase=='committed':raise ConnectionError('rollback response lost')
  self.store.on_event=lost
  with self.assertRaises(ConnectionError):self.store.rollback(before['revision'],'same-rollback')
  after=self.store.status();self.store.on_event=None
  self.assertEqual(self.store.rollback(before['revision'],'same-rollback')['current'],self.cid)
  self.assertEqual(self.store.status(),after)
 def test_technical_verification_without_quality_cannot_be_staged(self):
  output=self.base/'no-comparator';trusted_trainer.train(self.path,self.inbox,self.client,output,seed=18,epochs=1);model_validation.validate(output,self.inbox,self.client)
  with self.assertRaisesRegex(ValueError,'E_QUALITY_REJECTED'):self.store.stage(output)
  self.assertIsNone(self.store.status()['current'])
if __name__=='__main__':unittest.main(verbosity=2)
