"""Independent held-out evaluation; synthetic technical proof is never production approval."""
import math,pathlib,time,json,hashlib
from pipeline_io import read,write_new,write_status,file_hash,content_hash,encoded
from model_contract import PARAMETER_LENGTHS,check_snapshot,predict
from trusted_trainer import load_dataset,client_contract,worker,now
from trusted_dataset import verify_dataset
from training_contract import qualify

def check_candidate(directory):
 directory=pathlib.Path(directory)
 try:
  m=read(directory/'manifest.json');s=read(directory/'model.json');b=read(directory/'dataset.json')
  if m.get('schema')!='offline-model-manifest-v1' or not m.get('candidateId') or m.get('state')!='trained' or m.get('purpose')!='synthetic-flow-only' or m.get('productionEligible') is not False or m.get('parameterFormat')!='float32-v1' or m.get('networkProfile')!={'useResidual':m.get('networkProfile',{}).get('useResidual')} or type(m['networkProfile']['useResidual'])!=bool:raise ValueError('E_MODEL_CONTRACT')
  schema=m['modelSchema']
  if schema['version']!=7 or schema['featureDim']!=134 or schema['dims']!=[134,128,64,6] or schema['architecture']!=dict(activation='gelu',norm='layernorm',residual=True,critic=True) or schema['dtype']!=dict(weights='int8',biases='int16',moments='float32'):raise ValueError('E_MODEL_CONTRACT')
  config=m['trainingConfig']
  if type(config.get('useResidual'))!=bool or config['useResidual']!=m['networkProfile']['useResidual'] or type(config.get('seed'))!=int or not 0<=config['seed']<=0xffffffff or type(config.get('epochs'))!=int or not 1<=config['epochs']<=5 or type(config.get('batchSize'))!=int or not 1<=config['batchSize']<=32 or type(config.get('learningRate')) not in (float,int) or not 0<config['learningRate']<=.002:raise ValueError('E_MODEL_CONTRACT')
  if m['modelSHA256']!=file_hash(directory/'model.json'):raise ValueError('E_CANDIDATE_CHANGED')
  check_snapshot(s)
  if not verify_dataset(b) or m['datasetFileSHA256']!=file_hash(directory/'dataset.json') or m['trainingDatasetHash']!=b['manifest']['contentHash'] or encoded(m['datasetManifest'])!=encoded(b['manifest']) or m['partitionCounts']!={k:len(v) for k,v in b['partitions'].items()}:raise ValueError('E_MANIFEST_CHANGED')
  if m['actualTrainedRows']!=len(b['partitions']['training'])*m['trainingConfig']['epochs'] or m['partitionsReadByOptimizer']!=['training']:raise ValueError('E_TRAIN_EVIDENCE')
  if s['META']['trained']!=m['actualTrainedRows'] or s['adamT']!=math.ceil(len(b['partitions']['training'])/config['batchSize'])*config['epochs']:raise ValueError('E_TRAIN_EVIDENCE')
  code={p.name:file_hash(p) for p in pathlib.Path(__file__).parent.glob('*') if p.suffix in ('.py','.mjs')}
  if m['trainingCodeHashes']!=code:raise ValueError('E_TRAIN_CODE_CHANGED')
  return m
 except (OSError,KeyError,TypeError):raise ValueError('E_MODEL_MANIFEST_REQUIRED') from None
def label(sample):
 if not qualify(sample)['eligible']:raise ValueError('E_TRAIN_LABEL')
 score=sample['r']
 return 0 if score>=80 else 1 if score>=30 else 2 if score>=0 else 3 if score>=-30 else 4 if score>=-80 else 5
def metrics(model,rows,residual):
 if not rows:return dict(count=0,missing=0,accuracy=None,valueMSE=None,crossEntropy=None,calibrationECE=None,groups={},inferenceMs=None)
 start=time.perf_counter();correct=0;error=0;ce=0;groups={};bins=[[] for _ in range(10)]
 for entry in rows:
  sample=entry['sample'];p=predict(model,sample['f'],residual);y=label(sample);k=max(range(6),key=lambda i:p['logits'][i]);hit=int(k==y)
  values=[v/8 for v in p['logits']];maximum=max(values);exp=[math.exp(v-maximum) for v in values];probs=[v/sum(exp) for v in exp]
  square=(p['value']-sample['value_target'])**2;loss=math.log(sum(exp))+maximum-values[y]
  correct+=hit;error+=square;ce+=loss;confidence=max(probs);bins[min(9,int(confidence*10))].append((confidence,hit))
  c=sample['m'].get('modeContext',{});key=c.get('submode','unknown')+'/'+c.get('role','unknown');group=groups.setdefault(key,dict(count=0,correct=0,valueError=0))
  group['count']+=1;group['correct']+=hit;group['valueError']+=square
 for g in groups.values():g.update(accuracy=g['correct']/g['count'],valueMSE=g['valueError']/g['count'])
 n=len(rows);ece=sum(abs(sum(c-h for c,h in items)) for items in bins)/n
 return dict(count=n,missing=0,accuracy=correct/n,valueMSE=error/n,crossEntropy=ce/n,calibrationECE=ece,groups=groups,inferenceMs=(time.perf_counter()-start)*1000)
def compare_classic(candidate,baseline):
 reasons=[]
 if not candidate or not baseline or candidate.get('missing') or baseline.get('missing') or not baseline.get('count') or candidate.get('count')!=baseline.get('count') or not baseline.get('groups'):return dict(ok=False,reasons=['E_METRICS_MISSING'])
 def compare(c,b):
  if not all(type(v) in (int,float) and math.isfinite(v) for v in [c.get('accuracy'),c.get('valueMSE'),b.get('accuracy'),b.get('valueMSE')]):reasons.append('E_METRICS_NONFINITE');return
  if c['accuracy']+1e-9<b['accuracy']:reasons.append('E_ACCURACY_REGRESSION')
  if c['valueMSE']>b['valueMSE']+1e-9:reasons.append('E_VALUE_REGRESSION')
 compare(candidate,baseline)
 for key,b in baseline['groups'].items():
  c=candidate.get('groups',{}).get(key)
  if not c or c['count']!=b['count'] or b['count']<150:reasons.append('E_GROUP_COUNT');continue
  compare(c,b)
 return dict(ok=not reasons,reasons=reasons,rule='existing-classic-no-regression-group-150-v1')
def initial_quality_gate():
 # No trusted independent evaluation/approval provider is configured in this
 # synthetic-only adapter. Neither accuracy literals nor JSON attestations can
 # bootstrap production approval. A real first model needs an external review.
 return dict(ok=False,productionEligible=False,code='E_INDEPENDENT_QUALITY_REQUIRED',
  required=['independent-evaluation-provenance','predeclared-reviewed-quality-policy','authorized-stable-baseline-registration'])

def verified_manifest(m,manifest_hash,report_hash,report):
 baseline=report.get('baseline');quality=report['quality']
 return {**m,'state':'verified','modelManifestSHA256':manifest_hash,'validationReportSHA256':report_hash,'releaseScope':'isolated-test','verificationKind':'independent-forward-and-heldout-metrics; synthetic-not-production',
  'technicalVerified':True,'independentQualityQualified':False,'authorizedStableBaseline':False,
  'qualityPassed':False,
  'isolatedFlowPassed':report.get('technicalComparison',{}).get('status')=='passed-synthetic-flow' and baseline is not None and baseline.get('qualification')=='technical-synthetic-only',
  'comparisonBaseline':{k:baseline[k] for k in ['candidateId','modelSHA256','networkProfile']} if baseline else None}
def snapshot_for(directory,manifest):
 body=(pathlib.Path(directory)/'model.json').read_bytes()
 if hashlib.sha256(body).hexdigest()!=manifest['modelSHA256']:raise ValueError('E_CANDIDATE_CHANGED')
 return check_snapshot(json.loads(body))
def validate(directory,inbox,client,baseline=None):
 directory=pathlib.Path(directory);m=check_candidate(directory);before=file_hash(directory/'manifest.json');b=load_dataset(directory/'dataset.json',inbox)
 if baseline:
  try:old_proof=check_verified(baseline,inbox,client)
  except (OSError,ValueError):raise ValueError('E_REFERENCE_NOT_VERIFIED') from None
  if old_proof.get('technicalVerified') is not True:raise ValueError('E_REFERENCE_NOT_VERIFIED')
 if client_contract(client)!=m['clientCodeHashes']:raise ValueError('E_CLIENT_CONTRACT')
 if not b['partitions']['validation'] or not b['partitions']['holdout']:raise ValueError('E_VALIDATION_MISSING')
 s=snapshot_for(directory,m);res=m['networkProfile']['useResidual']
 validation=metrics(s,b['partitions']['validation'],res);holdout=metrics(s,b['partitions']['holdout'],res)
 inputs=[r['sample']['f'] for k in ['validation','holdout'] for r in b['partitions'][k]]
 js=worker(client,dict(operation='infer',snapshot=s,networkProfile=m['networkProfile'],inputs=inputs))
 differences=[]
 for f,p in zip(inputs,js['predictions']):
  q=predict(s,f,res);differences.extend(abs(a-z) for a,z in zip(p['logits']+[p['value']],q['logits']+[q['value']]))
 if len(js['predictions'])!=len(inputs) or max(differences,default=math.inf)>1e-5:raise ValueError('E_PREDICTION_MISMATCH')
 baseline_result=None;technical_comparison=dict(status='not-assessed');quality=dict(status='not-assessed',reason='No independently approved stable comparator; synthetic data never certifies production quality',initialGate=initial_quality_gate())
 if baseline:
  old=check_candidate(baseline);old_manifest_hash=file_hash(pathlib.Path(baseline)/'manifest.json');old_model=snapshot_for(baseline,old)
  baseline_result=dict(candidateId=old['candidateId'],modelSHA256=old['modelSHA256'],networkProfile=old['networkProfile'],verificationSHA256=file_hash(pathlib.Path(baseline)/'verified.json'),qualification='technical-synthetic-only',validation=metrics(old_model,b['partitions']['validation'],old['networkProfile']['useResidual']),holdout=metrics(old_model,b['partitions']['holdout'],old['networkProfile']['useResidual']))
  technical_comparison=dict(validation=compare_classic(validation,baseline_result['validation']),holdout=compare_classic(holdout,baseline_result['holdout']),productionEligible=False,purpose='synthetic-flow-only')
  technical_comparison['status']='passed-synthetic-flow' if technical_comparison['validation']['ok'] and technical_comparison['holdout']['ok'] else 'rejected'
  quality=dict(status='insufficient-qualification',code='E_QUALITY_BASELINE_REQUIRED',productionEligible=False,initialGate=initial_quality_gate(),reason='Technical synthetic comparator is not an independently assessed authorized stable baseline')
 report=dict(schema='offline-independent-validation-v1',candidateId=m['candidateId'],modelSHA256=m['modelSHA256'],modelManifestSHA256=before,datasetHash=m['trainingDatasetHash'],clientCodeHashes=m['clientCodeHashes'],validation=validation,holdout=holdout,baseline=baseline_result,quality=quality,technicalComparison=technical_comparison,pythonClientMaxAbsDifference=max(differences),predictionTolerance=1e-5,toleranceReason='float32 intermediate buffers and platform math rounding; no quantization conversion',clientInferenceMs=js['elapsedMs'],parameterBytes=js['parameterBytes'],pretrainedExposure='unknown',externalTrainingAttested=False,productionEligible=False,generatedAt=now())
 load_dataset(directory/'dataset.json',inbox)
 if check_candidate(directory)!=m or file_hash(directory/'manifest.json')!=before or client_contract(client)!=m['clientCodeHashes']:raise ValueError('E_CANDIDATE_CHANGED')
 if baseline and (check_candidate(baseline)!=old or check_verified(baseline,inbox,client)!=old_proof or file_hash(pathlib.Path(baseline)/'manifest.json')!=old_manifest_hash):raise ValueError('E_CANDIDATE_CHANGED')
 write_new(directory/'validation.json',report);proof=verified_manifest(m,before,file_hash(directory/'validation.json'),report);write_new(directory/'verified.json',proof)
 write_status(directory/'status.json',dict(candidateId=m['candidateId'],state='verified',releaseScope='isolated-test',productionEligible=False));return proof
def check_verified(directory,inbox,client):
 directory=pathlib.Path(directory);m=check_candidate(directory)
 try:
  proof=read(directory/'verified.json');report=read(directory/'validation.json')
  expected=verified_manifest(m,file_hash(directory/'manifest.json'),file_hash(directory/'validation.json'),report)
  if encoded(proof)!=encoded(expected) or report['candidateId']!=m['candidateId'] or report['modelSHA256']!=m['modelSHA256'] or report['modelManifestSHA256']!=expected['modelManifestSHA256'] or report['datasetHash']!=m['trainingDatasetHash'] or report['productionEligible'] is not False:raise ValueError('E_VALIDATION_BINDING')
  # Force finite report JSON, including every group and performance field.
  encoded(report)
 except (OSError,KeyError,TypeError):raise ValueError('E_VALIDATION_BINDING') from None
 load_dataset(directory/'dataset.json',inbox)
 if client_contract(client)!=m['clientCodeHashes']:raise ValueError('E_CLIENT_CONTRACT')
 return proof
def export_client_shadow(directory,output,inbox,client):
 """Actual strict client snapshot format; does not forge classic activation proof."""
 directory=pathlib.Path(directory);proof=check_verified(directory,inbox,client)
 bundle=read(directory/'dataset.json');samples=[r['sample'] for rows in bundle['partitions'].values() for r in rows]
 if not samples or any(s['m'].get('modeContext',{}).get('group')!='doudizhu-classic' or not s['m']['modeContext'].get('ruleKey') for s in samples):raise ValueError('E_MODEL_SCOPE')
 record=dict(schema='classic-candidate-v1',featureDim=134,modelVersion=7,id=proof['candidateId'],createdAt=0,snapshot=snapshot_for(directory,proof),networkProfile=proof['networkProfile'],ruleKeys=sorted({s['m']['modeContext']['ruleKey'] for s in samples}),report=dict(serverModelManifest=proof,serverModelManifestSHA256=file_hash(directory/'verified.json'),serverModelSHA256=proof['modelSHA256'],quality=dict(ok=False,regressions=['Synthetic server shadow export; NOT a client classic activation proof']),productionEligible=False,realGameAcceptance=False))
 if check_verified(directory,inbox,client)!=proof:raise ValueError('E_CANDIDATE_CHANGED')
 write_new(output,record);return record
