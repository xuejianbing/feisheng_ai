import copy,json,math,pathlib,unittest
from unittest.mock import patch
import test_training_pipeline as fixtures
from test_trusted import row,env,raw
from pipeline_io import read,write_status
try:import model_validation as validator
except ImportError:validator=None
class ModelValidation(unittest.TestCase):
 def setUp(self):
  self.assertIsNotNone(validator,'C2 independent validator is absent');fixtures.TrainingPipeline.setUp(self)
  import trusted_trainer
  self.trainer=trusted_trainer;self.candidate=self.base/'candidate';self.manifest=trusted_trainer.train(self.path,self.inbox,self.client,self.candidate,seed=17,epochs=1)
 def test_python_node_fixed_inputs_match_with_both_residual_profiles(self):
  for residual in [False,True]:
   model=read(self.candidate/'model.json');inputs=[[0]*134,[i%7-3 for i in range(134)],[127 if i%2 else -128 for i in range(134)]]
   result=self.trainer.worker(self.client,dict(operation='infer',snapshot=model,networkProfile=dict(useResidual=residual),inputs=inputs))
   for f,p in zip(inputs,result['predictions']):
    q=validator.predict(model,f,residual)
    self.assertLess(max(abs(a-b) for a,b in zip(p['logits'],q['logits'])),1e-5);self.assertAlmostEqual(p['value'],q['value'],places=6)
 def test_independent_forward_hand_computed_bias_case(self):
  model=read(self.candidate/'model.json')
  for k in validator.PARAMETER_LENGTHS:model[k]=[0]*validator.PARAMETER_LENGTHS[k]
  model['B3']=[1,2,3,4,5,6];model['B4']=[.5]
  result=validator.predict(model,[1]*134,True)
  self.assertEqual(result['logits'],[1,2,3,4,5,6]);self.assertAlmostEqual(result['value'],math.tanh(.5),places=12)
 def test_each_parameter_and_architecture_change_invalidates_manifest(self):
  before=(self.candidate/'model.json').read_bytes();manifest=(self.candidate/'manifest.json').read_bytes()
  for key in validator.PARAMETER_LENGTHS:
   value=json.loads(before);value[key][0]+=.01;write_status(self.candidate/'model.json',value)
   with self.assertRaisesRegex(ValueError,'E_CANDIDATE_CHANGED'):validator.check_candidate(self.candidate)
  (self.candidate/'model.json').write_bytes(before)
  bad=json.loads(manifest);bad['networkProfile']['useResidual']='yes';write_status(self.candidate/'manifest.json',bad)
  with self.assertRaisesRegex(ValueError,'E_MODEL_CONTRACT'):validator.check_candidate(self.candidate)
 def test_corrupt_moments_and_unknown_arrays_rejected(self):
  value=read(self.candidate/'model.json')
  for key,contents in [('W1',[1]),('vB4',[-1]),('mB4',[1e100])]:
   bad=copy.deepcopy(value);bad[key]=contents
   with self.assertRaisesRegex(ValueError,'E_MODEL_SHAPE'):validator.check_snapshot(bad)
 def test_validation_binds_candidate_data_code_and_report_without_production_claim(self):
  result=validator.validate(self.candidate,self.inbox,self.client)
  self.assertEqual(result['state'],'verified');self.assertFalse(result['productionEligible']);self.assertEqual(result['releaseScope'],'isolated-test')
  checked=validator.check_verified(self.candidate,self.inbox,self.client);self.assertEqual(checked['candidateId'],self.manifest['candidateId'])
  original=(self.candidate/'validation.json').read_bytes();bad=json.loads(original);bad['candidateId']='other';write_status(self.candidate/'validation.json',bad)
  with self.assertRaisesRegex(ValueError,'E_VALIDATION_BINDING'):validator.check_verified(self.candidate,self.inbox,self.client)
 def test_dataset_change_after_validation_rejects_old_evidence(self):
  validator.validate(self.candidate,self.inbox,self.client);self.inbox.receive(raw(env([row('late')])))
  with self.assertRaisesRegex(ValueError,'E_MANIFEST_CHANGED'):validator.check_verified(self.candidate,self.inbox,self.client)
 def test_other_candidate_cannot_reuse_validation_and_verified_manifest(self):
  validator.validate(self.candidate,self.inbox,self.client);other=self.base/'other';self.trainer.train(self.path,self.inbox,self.client,other,seed=17,epochs=1)
  for name in ['validation.json','verified.json']:(other/name).write_bytes((self.candidate/name).read_bytes())
  with self.assertRaisesRegex(ValueError,'E_VALIDATION_BINDING'):validator.check_verified(other,self.inbox,self.client)
 def test_missing_holdout_or_unknown_baseline_never_claims_quality(self):
  result=validator.validate(self.candidate,self.inbox,self.client)
  report=read(self.candidate/'validation.json');self.assertEqual(report['quality']['status'],'not-assessed');self.assertFalse(report['productionEligible'])
  self.assertEqual(report['baseline'],None);self.assertEqual(report['pretrainedExposure'],'unknown');self.assertGreater(report['holdout']['count'],0)
 def test_existing_classic_comparison_preserves_group_size_and_regression_rules(self):
  c=dict(count=150,missing=0,accuracy=.8,valueMSE=.1,groups={'normal/farmer':dict(count=150,accuracy=.8,valueMSE=.1)})
  self.assertTrue(validator.compare_classic(c,c)['ok'])
  bad=copy.deepcopy(c);bad['groups']['normal/farmer']['count']=149;self.assertFalse(validator.compare_classic(bad,bad)['ok'])
  bad=copy.deepcopy(c);bad['valueMSE']=.11;self.assertFalse(validator.compare_classic(bad,c)['ok'])
 def test_transient_same_id_model_replacement_cannot_borrow_original_validation(self):
  path=self.candidate/'model.json';original=path.read_bytes();bad=json.loads(original);bad['B3'][0]=1
  check=validator.check_candidate;infer=validator.worker;calls=0
  def swap_after_check(directory):
   nonlocal calls
   m=check(directory);calls+=1
   if calls==1:write_status(path,bad)
   return m
  def infer_then_restore(*args,**kwargs):
   try:return infer(*args,**kwargs)
   finally:path.write_bytes(original)
  try:
   with patch.object(validator,'check_candidate',side_effect=swap_after_check),patch.object(validator,'worker',side_effect=infer_then_restore):
    with self.assertRaisesRegex(ValueError,'E_CANDIDATE_CHANGED'):validator.validate(self.candidate,self.inbox,self.client)
  finally:path.write_bytes(original)
 def test_single_training_session_cannot_default_missing_holdout_to_success(self):
  from auth_fixture import FixtureInbox
  b=read(self.path);sample=b['partitions']['training'][0]['sample'];one=fixtures.trainer_synthetic_inbox(self)
  one.receive(raw(env([sample])));dataset=self.base/'one.json';self.trainer.export_dataset(one,dataset,seed='c1');output=self.base/'single'
  self.trainer.train(dataset,one,self.client,output,seed=19,epochs=1)
  with self.assertRaisesRegex(ValueError,'E_VALIDATION_MISSING'):validator.validate(output,one,self.client)
 def test_client_shadow_export_preserves_manifest_and_cannot_claim_activation_quality(self):
  validator.validate(self.candidate,self.inbox,self.client);output=self.base/'client-shadow.json'
  record=validator.export_client_shadow(self.candidate,output,self.inbox,self.client)
  self.assertEqual(record['schema'],'classic-candidate-v1');self.assertEqual(record['snapshot'],read(self.candidate/'model.json'))
  self.assertEqual(record['report']['serverModelManifest']['candidateId'],self.manifest['candidateId'])
  self.assertFalse(record['report']['quality']['ok']);self.assertFalse(record['report']['productionEligible']);self.assertNotIn('datasetManifest',record['report'])
  write_status(self.candidate/'model.json',{})
  with self.assertRaises(ValueError):validator.export_client_shadow(self.candidate,self.base/'bad.json',self.inbox,self.client)
 def test_changed_network_profile_cannot_claim_the_original_training_configuration(self):
  m=read(self.candidate/'manifest.json');m['networkProfile']['useResidual']=not m['trainingConfig']['useResidual'];write_status(self.candidate/'manifest.json',m)
  with self.assertRaisesRegex(ValueError,'E_MODEL_CONTRACT'):validator.check_candidate(self.candidate)
if __name__=='__main__':unittest.main(verbosity=2)
