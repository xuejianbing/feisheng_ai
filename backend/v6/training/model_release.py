"""Explicitly isolated local release store. No HTTP route and no production mode.
Immutable version evidence precedes a FULL/WAL SQLite pointer transaction.
The local operation capability is unrelated to source-upload Bearer credentials.
"""
import base64,hashlib,hmac,json,os,pathlib,re,secrets,sqlite3,time,math
from contextlib import contextmanager
from pipeline_io import read,write_new,write_status,encoded,content_hash,file_hash
from model_contract import check_snapshot,predict
from model_validation import check_verified
from trusted_trainer import worker
FILES=('model.json','manifest.json','dataset.json','validation.json','verified.json')

def isolated_flow_qualified(proof):
 return (proof.get('isolatedFlowPassed') is True and proof.get('technicalVerified') is True and proof.get('qualityPassed') is False and proof.get('releaseScope')=='isolated-test' and proof.get('purpose')=='synthetic-flow-only' and proof.get('productionEligible') is False)
def initialize(root,test_only=False):
 if test_only is not True:raise ValueError('E_TEST_ONLY')
 root=pathlib.Path(root).resolve();root.mkdir(mode=0o700,parents=True,exist_ok=False);(root/'versions').mkdir()
 key=secrets.token_urlsafe(32)
 fd=os.open(root/'operator.key',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,'w') as f:f.write(key);f.flush();os.fsync(f.fileno())
 write_new(root/'store.json',dict(schema='isolated-model-release-v1',scope='isolated-test',productionEligible=False,keySHA256=hashlib.sha256(key.encode()).hexdigest()))
 c=sqlite3.connect(root/'release.sqlite')
 try:
  c.execute('PRAGMA journal_mode=WAL');c.execute('PRAGMA synchronous=FULL')
  c.executescript('''CREATE TABLE pointer(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,current TEXT,previous TEXT);
  INSERT INTO pointer VALUES(1,0,NULL,NULL);
  CREATE TABLE versions(id TEXT PRIMARY KEY,binding TEXT NOT NULL,payload BLOB NOT NULL,state TEXT NOT NULL);
  CREATE TABLE operations(id TEXT PRIMARY KEY,request TEXT NOT NULL,response TEXT NOT NULL);''')
 finally:c.close()
 return key
class ReleaseStore:
 def __init__(self,root,operator_key,inbox,client,on_event=None):
  self.root=pathlib.Path(root).resolve();self.key=operator_key;self.inbox=inbox;self.client=client;self.on_event=on_event
  try:self.marker=read(self.root/'store.json')
  except (OSError,ValueError):raise ValueError('E_RELEASE_STORE') from None
  if self.marker.get('schema')!='isolated-model-release-v1' or self.marker.get('scope')!='isolated-test' or self.marker.get('productionEligible') is not False:raise ValueError('E_TEST_ONLY')
  if not (self.root/'release.sqlite').is_file():raise ValueError('E_RELEASE_STORE')
 def _authorize(self):
  if not isinstance(self.key,str) or not hmac.compare_digest(hashlib.sha256(self.key.encode()).hexdigest(),self.marker['keySHA256']):raise ValueError('E_RELEASE_AUTH')
 def _event(self,phase):
  if self.on_event:self.on_event(phase)
 @contextmanager
 def connect(self):
  c=sqlite3.connect((self.root/'release.sqlite').as_uri()+'?mode=rw',uri=True,timeout=30)
  try:
   c.execute('PRAGMA journal_mode=WAL');c.execute('PRAGMA synchronous=FULL')
   with c:yield c
  finally:c.close()
 def status(self):
  with self.connect() as c:revision,current,previous=c.execute('SELECT revision,current,previous FROM pointer WHERE id=1').fetchone()
  return dict(revision=revision,current=current,previous=previous)
 def _id(self,cid):
  if not isinstance(cid,str) or not re.fullmatch(r'candidate-[0-9a-f]{32}',cid):raise ValueError('E_CANDIDATE_ID')
  return cid
 def _version(self,c,cid):
  self._id(cid);row=c.execute('SELECT binding,payload FROM versions WHERE id=?',(cid,)).fetchone()
  if not row:raise ValueError('E_CANDIDATE_MISSING')
  payload=json.loads(row[1]);directory=self.root/'versions'/cid
  if directory.is_symlink() or content_hash(payload)!=row[0]:raise ValueError('E_CANDIDATE_CHANGED')
  try:
   for name in FILES:
    if (directory/name).is_symlink() or base64.b64decode(payload[name])!=(directory/name).read_bytes():raise ValueError('E_CANDIDATE_CHANGED')
   # Infer from the captured durable payload, never a second mutable file read.
   snapshot=json.loads(base64.b64decode(payload['model.json']));check_snapshot(snapshot)
   manifest=json.loads(base64.b64decode(payload['manifest.json']))
   if manifest['candidateId']!=cid or manifest['modelSHA256']!=hashlib.sha256(base64.b64decode(payload['model.json'])).hexdigest():raise ValueError('E_CANDIDATE_CHANGED')
   predict(snapshot,[0]*134,manifest['networkProfile']['useResidual'])
   return dict(candidateId=cid,snapshot=snapshot,networkProfile=manifest['networkProfile'],productionEligible=False,modelSHA256=manifest['modelSHA256'])
  except (OSError,KeyError,TypeError):raise ValueError('E_CANDIDATE_CHANGED') from None
 def stage(self,source):
  self._authorize();source=pathlib.Path(source).resolve();proof=check_verified(source,self.inbox,self.client);cid=self._id(proof['candidateId'])
  # This store has no production mode. Synthetic flow permission is separate
  # from independent quality approval, which this adapter cannot grant.
  if not isolated_flow_qualified(proof):raise ValueError('E_QUALITY_REJECTED')
  payload={name:base64.b64encode((source/name).read_bytes()).decode('ascii') for name in FILES};binding=content_hash(payload)
  if check_verified(source,self.inbox,self.client)!=proof or any(base64.b64decode(payload[name])!=(source/name).read_bytes() for name in FILES):raise ValueError('E_CANDIDATE_CHANGED')
  destination=self.root/'versions'/cid
  if destination.is_symlink():raise ValueError('E_CANDIDATE_CHANGED')
  destination.mkdir(exist_ok=True)
  # Resume an interrupted file preparation only if every existing byte matches.
  for name in FILES:
   p=destination/name;body=base64.b64decode(payload[name])
   if p.exists():
    if p.is_symlink() or p.read_bytes()!=body:raise ValueError('E_CANDIDATE_CHANGED')
   else:
    with p.open('xb') as f:f.write(body);f.flush();os.fsync(f.fileno())
  self._event('staged-files')
  with self.connect() as c:
   c.execute('BEGIN IMMEDIATE');prior=c.execute('SELECT binding FROM versions WHERE id=?',(cid,)).fetchone()
   if prior and prior[0]!=binding:raise ValueError('E_CANDIDATE_CHANGED')
   c.execute("INSERT OR IGNORE INTO versions VALUES(?,?,?,'staged')",(cid,binding,encoded(payload)))
   self._version(c,cid)
  self._event('stage-committed');return dict(candidateId=cid,binding=binding,state='staged',productionEligible=False)
 def _switch(self,cid,expected_revision,operation_id,kind):
  self._authorize()
  if kind!='rollback':self._id(cid)
  if type(expected_revision)!=int or expected_revision<0 or not isinstance(operation_id,str) or not 0<len(operation_id)<=128:raise ValueError('E_RELEASE_REQUEST')
  # Rollback is a pointer operation: resolve its target only for a NEW request.
  request=content_hash(dict(candidateId=None if kind=='rollback' else cid,revision=expected_revision,kind=kind))
  with self.connect() as c:
   c.execute('BEGIN IMMEDIATE');prior=c.execute('SELECT request,response FROM operations WHERE id=?',(operation_id,)).fetchone()
   if prior:
    if prior[0]!=request:raise ValueError('E_OPERATION_CONFLICT')
    return json.loads(prior[1])
   revision,current,previous=c.execute('SELECT revision,current,previous FROM pointer WHERE id=1').fetchone()
   if revision!=expected_revision:raise ValueError('E_PUBLISH_CONFLICT')
   if kind=='rollback':
    if cid is not None and cid!=previous:raise ValueError('E_ROLLBACK_CHANGED')
    cid=previous
    if not cid:raise ValueError('E_PREVIOUS_MISSING')
   value=self._version(c,cid);directory=self.root/'versions'/cid
   if kind=='activate':
    proof=check_verified(directory,self.inbox,self.client)
    if not isolated_flow_qualified(proof):raise ValueError('E_QUALITY_REJECTED')
    if current and current!=cid:
     stable=self._version(c,current);baseline=proof.get('comparisonBaseline')
     if not baseline or baseline['modelSHA256']!=stable['modelSHA256'] or baseline['networkProfile']!=stable['networkProfile']:raise ValueError('E_BASELINE_CHANGED')
   # A failed actual-client first inference must happen BEFORE pointer commit.
   worker(self.client,dict(operation='infer',snapshot=value['snapshot'],networkProfile=value['networkProfile'],inputs=[[0]*134]))
   self._event('before-switch')
   self._version(c,cid)
   if kind=='activate':check_verified(directory,self.inbox,self.client)
   new_previous=current if current!=cid else previous
   if current and current!=cid:c.execute('UPDATE versions SET state=? WHERE id=?',('rolled-back' if kind=='rollback' else 'retired',current))
   c.execute("UPDATE versions SET state='active' WHERE id=?",(cid,))
   c.execute('UPDATE pointer SET revision=?,current=?,previous=? WHERE id=1',(revision+1,cid,new_previous))
   result=dict(revision=revision+1,current=cid,previous=new_previous,scope='isolated-test',productionEligible=False)
   c.execute('INSERT INTO operations VALUES(?,?,?)',(operation_id,request,json.dumps(result,sort_keys=True)))
   self._event('before-commit')
   self._version(c,cid)
   if kind=='activate':check_verified(directory,self.inbox,self.client)
  self._event('committed');return result
 def activate(self,cid,expected_revision,operation_id):return self._switch(cid,expected_revision,operation_id,'activate')
 def rollback(self,expected_revision,operation_id):
  return self._switch(None,expected_revision,operation_id,'rollback')
 def resolve(self):
  self._authorize()
  try:state=self.status()
  except sqlite3.Error:return dict(status='public-default-required',snapshot=None,candidateId=None,productionEligible=False,reason='E_RELEASE_STORE')
  for key in ['current','previous']:
   cid=state[key]
   if not cid:continue
   try:
    with self.connect() as c:value=self._version(c,cid)
   except (ValueError,OSError,sqlite3.Error):continue
   if key=='previous':
    try:self._switch(cid,state['revision'],'auto-rollback-'+str(state['revision']),'rollback');persisted=True
    except (ValueError,OSError,sqlite3.Error):persisted=False
    return {**value,'status':'fallback','fallback':True,'rollbackPersisted':persisted}
   return {**value,'status':'active','fallback':False}
  return dict(status='public-default-required',snapshot=None,candidateId=None,productionEligible=False,reason='E_NO_TRUSTED_VERSION')
 def predict(self,features):
  if len(features)!=134 or any(type(v) not in (int,float) or not math.isfinite(v) for v in features):raise ValueError('E_INPUT_SHAPE')
  active=self.resolve()
  if active['snapshot'] is None:return {**active,'prediction':None}
  try:return dict(candidateId=active['candidateId'],prediction=predict(active['snapshot'],features,active['networkProfile']['useResidual']),fallback=active['fallback'],productionEligible=False)
  except (ValueError,IndexError,KeyError,TypeError,OverflowError):
   state=self.status();prior=state['previous']
   if prior:
    try:
     with self.connect() as c:previous=self._version(c,prior)
     prediction=predict(previous['snapshot'],features,previous['networkProfile']['useResidual'])
     try:self.rollback(state['revision'],'inference-rollback-'+str(state['revision']));persisted=True
     except (ValueError,OSError,sqlite3.Error):persisted=False
     return dict(candidateId=prior,prediction=prediction,fallback=True,rollbackPersisted=persisted,productionEligible=False)
    except (ValueError,OSError,sqlite3.Error,IndexError,OverflowError):pass
   return dict(status='public-default-required',candidateId=None,prediction=None,reason='E_INFERENCE',productionEligible=False)

class ShadowSession:
 """Pinned read-only predictions; never attached to formal candidate sorting."""
 def __init__(self,store,candidate_id,session_id):
  if not isinstance(session_id,str) or not session_id:raise ValueError('E_SESSION_ID')
  self.stable=store.resolve();self.session_id=session_id;self.enabled=True
  if self.stable['snapshot'] is None:raise ValueError('E_SHADOW_BASELINE')
  with store.connect() as c:value=store._version(c,candidate_id)
  self.candidate=value['snapshot'];self.profile=value['networkProfile'];self.cid=candidate_id
 def predict(self,features):
  base=dict(sessionId=self.session_id,candidateId=self.cid,stableId=self.stable['candidateId'],changesSelection=False)
  start=time.perf_counter();stable=predict(self.stable['snapshot'],features,self.stable['networkProfile']['useResidual']);base['stableMs']=(time.perf_counter()-start)*1000
  if not self.enabled:return {**base,'status':'disabled','stable':stable}
  try:
   start=time.perf_counter();candidate=predict(self.candidate,features,self.profile['useResidual'])
   return {**base,'status':'shadow','stable':stable,'candidate':candidate,'candidateMs':(time.perf_counter()-start)*1000,'disagrees':max(range(6),key=lambda i:candidate['logits'][i])!=max(range(6),key=lambda i:stable['logits'][i])}
  except (ValueError,IndexError,KeyError,TypeError,OverflowError):return {**base,'status':'candidate-error','stable':stable}
