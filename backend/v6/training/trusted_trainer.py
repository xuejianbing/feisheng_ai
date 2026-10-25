"""Offline technical adapter. No production training/release or HTTP entry point."""
import argparse,datetime,json,os,pathlib,subprocess,sys,tempfile,uuid
from pipeline_io import read,write_new,write_status,content_hash,file_hash,encoded
SERVER=pathlib.Path(__file__).resolve().parents[1]/'server';sys.path.insert(0,str(SERVER))
from trusted_dataset import build_dataset,verify_dataset,CLIENT_CONTRACT_HASHES
from training_contract import canonical

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def export_dataset(inbox,output,seed='20261023'):
 from synthetic_isolation import require_synthetic_inbox
 require_synthetic_inbox(inbox)
 bundle=build_dataset(inbox.view(),seed=str(seed));write_new(output,bundle)
 from synthetic_isolation import _remember_export
 _remember_export(inbox,output);return bundle['manifest']
def load_dataset(path,inbox):
 try:
  bundle=read(path)
  if not verify_dataset(bundle):raise ValueError('E_MANIFEST_INVALID')
 except (KeyError,TypeError,ValueError):raise ValueError('E_MANIFEST_INVALID') from None
 rebuilt=build_dataset(inbox.view(),seed=bundle['manifest']['splits']['seed'],generated_at=bundle['manifest']['generatedAt'])
 if canonical(bundle)!=canonical(rebuilt):raise ValueError('E_MANIFEST_CHANGED')
 return bundle
def client_contract(client):
 client=pathlib.Path(client)
 paths=set(CLIENT_CONTRACT_HASHES)|{'score/model/weights/weights.js','score/model/weights/modeModelStore.js','score/model/features/features.js'}
 try:hashes={p:file_hash(client/p) for p in sorted(paths)}
 except OSError:raise ValueError('E_CLIENT_CONTRACT') from None
 if any(hashes[p]!=expected for p,expected in CLIENT_CONTRACT_HASHES.items()):raise ValueError('E_CLIENT_CONTRACT')
 return hashes
def worker(client,request,*,isolation=None):
 if request.get('operation')=='train':
  from synthetic_isolation import require_synthetic_inbox
  require_synthetic_inbox(isolation)
  from synthetic_isolation import _check_row
  for sample in request.get('rows',[]):_check_row(sample)
 with tempfile.TemporaryDirectory(prefix='wuming-offline-model-') as directory:
  base=pathlib.Path(directory);write_new(base/'request.json',{'clientRoot':str(pathlib.Path(client).resolve()),**request})
  result=subprocess.run(['node',str(pathlib.Path(__file__).with_name('client_worker.mjs')),str(base/'request.json'),str(base/'response.json')],capture_output=True,timeout=180)
  if result.returncode:raise ValueError('E_CLIENT_WORKER: '+result.stderr.decode('utf-8','replace')[-1500:])
  return read(base/'response.json')
def train(dataset_path,inbox,client,output,seed,epochs=5,learning_rate=.0005,batch_size=32,use_residual=False,**unsupported):
 from synthetic_isolation import require_synthetic_inbox
 require_synthetic_inbox(inbox)
 if unsupported or type(seed)!=int or not 0<=seed<=0xffffffff or type(epochs)!=int or not 1<=epochs<=5 or type(batch_size)!=int or not 1<=batch_size<=32 or type(use_residual)!=bool or type(learning_rate) not in (int,float) or not 0<learning_rate<=.002:raise ValueError('E_TRAIN_CONFIG')
 from synthetic_isolation import require_exported_dataset
 require_exported_dataset(inbox,dataset_path)
 hashes=client_contract(client);bundle=load_dataset(dataset_path,inbox);dataset_bytes=pathlib.Path(dataset_path).read_bytes()
 rows=bundle['partitions']['training']
 if not rows:raise ValueError('E_EMPTY_TRAIN')
 directory=pathlib.Path(output).resolve();directory.mkdir(exist_ok=False)
 cid='candidate-'+uuid.uuid4().hex;started=now();write_new(directory/'status.json',dict(candidateId=cid,state='draft',startedAt=started,purpose='synthetic-flow-only',productionEligible=False))
 try:
  config=dict(seed=seed,epochs=epochs,learningRate=learning_rate,batchSize=batch_size,useResidual=use_residual)
  result=worker(client,dict(operation='train',rows=[r['sample'] for r in rows],config=config),isolation=inbox)
  if pathlib.Path(dataset_path).read_bytes()!=dataset_bytes or client_contract(client)!=hashes:raise ValueError('E_MANIFEST_CHANGED')
  load_dataset(dataset_path,inbox)
  snapshot=result['snapshot'];write_new(directory/'model.json',snapshot)
  # Persist the exact qualified dataset evidence separately; the optimizer never receives holdout.
  write_new(directory/'dataset.json',bundle)
  code={p.name:file_hash(p) for p in pathlib.Path(__file__).parent.glob('*') if p.suffix in ('.py','.mjs')}
  manifest=dict(schema='offline-model-manifest-v1',candidateId=cid,modelType='shared-actor-critic-offline-v1',modelSchema=result['contract'],parameterFormat='float32-v1',networkProfile=dict(useResidual=use_residual),modelSHA256=file_hash(directory/'model.json'),trainingDatasetHash=bundle['manifest']['contentHash'],datasetFileSHA256=file_hash(directory/'dataset.json'),datasetManifest=bundle['manifest'],clientCodeHashes=hashes,trainingCodeHashes=code,trainingConfig=config,initialization='seeded-lcg-float-v1 (fresh; no historical pretrained weights)',labelDefinition=bundle['manifest']['labelDefinition'],actualTrainedRows=result['actualTrainedRows'],partitionsReadByOptimizer=result['partitionsReadByOptimizer'],partitionCounts={k:len(v) for k,v in bundle['partitions'].items()},validationReportSHA256=None,baselineModel=None,state='trained',purpose='synthetic-flow-only',productionEligible=False,generatedAt=now(),externalTrainingAttested=False)
  write_new(directory/'manifest.json',manifest);write_status(directory/'status.json',dict(candidateId=cid,state='trained',startedAt=started,finishedAt=now(),productionEligible=False));return manifest
 except BaseException as error:
  write_status(directory/'status.json',dict(candidateId=cid,state='rejected',startedAt=started,finishedAt=now(),reason=str(error),productionEligible=False));raise

def main():
 parser=argparse.ArgumentParser(description='Offline test-only training. Never point at production data.')
 parser.add_argument('--inbox');parser.add_argument('--auth-db');parser.add_argument('--public-endpoint');parser.add_argument('--dataset',required=True);parser.add_argument('--export-only',action='store_true');parser.add_argument('--client');parser.add_argument('--output');parser.add_argument('--seed',type=int,required=True);parser.add_argument('--test-only',action='store_true',required=True)
 parser.add_argument('--epochs',type=int,default=5);parser.add_argument('--learning-rate',type=float,default=.0005);parser.add_argument('--batch-size',type=int,default=32);parser.add_argument('--use-residual',action='store_true')
 args=parser.parse_args()
 if args.inbox or args.auth_db or args.public_endpoint:parser.error('E_ISOLATION_SOURCE: external databases/endpoints are forbidden; only newly generated synthetic input is supported')
 from synthetic_isolation import SyntheticInbox
 inbox=SyntheticInbox()
 try:
  inbox.seed();result=export_dataset(inbox,args.dataset,args.seed)
  if not args.export_only:
   if not args.client or not args.output:parser.error('--client and --output required for training')
   result=train(args.dataset,inbox,args.client,args.output,args.seed,epochs=args.epochs,learning_rate=args.learning_rate,batch_size=args.batch_size,use_residual=args.use_residual)
 finally:inbox.close()
 print(json.dumps(result,ensure_ascii=False,allow_nan=False))
if __name__=='__main__':main()
