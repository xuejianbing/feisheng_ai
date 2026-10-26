"""Process-owned synthetic sources. Never open a caller-supplied database.

This is an accidental-input boundary, not a sandbox against arbitrary Python
code/local administrators. Real production services still need separate OS ACLs.
"""
import copy,hashlib,json,pathlib,re,tempfile,weakref
from source_auth import SourceAuthority
from trusted_ingest import DurableInbox,decode,source_of
_OWNED=weakref.WeakKeyDictionary()
_EXPORTED=weakref.WeakKeyDictionary()

def sample(tx='tx',session='s',dim=134,variant=None):
 if not all(isinstance(x,str) and re.fullmatch(r'[A-Za-z0-9_-]{1,64}',x) for x in [tx,session]) or dim not in [12,130,134,142] or variant is not None and (type(variant)!=int or not 0<=variant<32):raise ValueError('E_SYNTHETIC_DATA')
 return dict(f=[1]*dim if variant is None else [(j+variant)%9-4 for j in range(dim)],r=36,value_target=.25,ts=100,m=dict(sessionId=session,actorId='actor',transactionId=tx,player='hero',action='card',id='sha',target='enemy',rewardSchema='action-outcome-v1',executionState='committed',rewardStatus='observed',observedReward=3,actionOutcome=dict(transactionId=tx,actorId='actor',status='observed',reward=3,normalization=12,attribution='host-event-window',deltas=[dict(playerId='actor',camp=1,hp=1,hand=0,equip=0,judging=0,alive=0,linked=0,turned=0,wine=0)])))

def envelope(rows,instance='client'):
 return dict(v=3,source=dict(schema='ingest-source-v1',domain='wuming-ai',instanceId=instance),samples=rows,panelStats={'real':1},shadowV5=[{'decisionId':'x'}],config={'test':True})

def _check_row(s):
 try:
  lineage=['_dimAdapted','_originalDim','_missingFeatureIndices']
  if any(k in s for k in lineage):
   if s.get('_dimAdapted') is not True or type(s.get('_originalDim'))!=int or s['_originalDim']!=130 or s.get('_missingFeatureIndices')!=[130,131,132,133] or len(s['f'])!=134 or s['f'][130:]!=[0]*4:raise ValueError('E_SYNTHETIC_DATA')
   original=copy.deepcopy(s)
   for k in lineage:original.pop(k)
   original['f']=original['f'][:130]
   return _check_row(original)
  m=s['m'];features=s['f'];variants=[None]+list(range(32))
  for variant in variants:
   expected=sample(m['transactionId'],m['sessionId'],len(features),variant)
   if 'modeContext' in m:expected['m']['modeContext']=dict(group='doudizhu-classic',submode='normal',role='farmer',ruleKey='test-rule')
   if m.get('rewardStatus')=='pending':
    expected['m']['rewardStatus']='pending';expected['m'].pop('observedReward');expected['m'].pop('actionOutcome')
   if m.get('gameOutcome')=='win':expected['m'].update(gameOutcome='win',outcomeTarget=1)
   if s==expected:return
 except (KeyError,TypeError):pass
 raise ValueError('E_SYNTHETIC_DATA')

def _identity(path):
 path=pathlib.Path(path)
 if path.is_symlink():raise ValueError('E_ISOLATION_SOURCE')
 st=path.stat();return (str(path.resolve()),st.st_dev,st.st_ino)

def require_synthetic_inbox(inbox):
 if type(inbox) is not SyntheticInbox:raise ValueError('E_ISOLATION_SOURCE')
 owned=_OWNED.get(inbox)
 if not owned:raise ValueError('E_ISOLATION_SOURCE')
 try:
  if owned!=(_identity(inbox.root),_identity(inbox.path),_identity(inbox.fixture_authority.path)):raise ValueError('E_ISOLATION_SOURCE')
 except (OSError,AttributeError):raise ValueError('E_ISOLATION_SOURCE') from None
 return inbox

def _remember_export(inbox,path):
 require_synthetic_inbox(inbox);_EXPORTED.setdefault(inbox,{})[str(pathlib.Path(path).absolute())]=_identity(path)

def require_exported_dataset(inbox,path):
 require_synthetic_inbox(inbox)
 try:
  if _EXPORTED.get(inbox,{}).get(str(pathlib.Path(path).absolute()))!=_identity(path):raise ValueError('E_ISOLATION_SOURCE')
 except OSError:raise ValueError('E_ISOLATION_SOURCE') from None

class SyntheticInbox(DurableInbox):
 def __init__(self):
  self._temporary=tempfile.TemporaryDirectory(prefix='wuming-synthetic-only-')
  self.root=pathlib.Path(self._temporary.name);base=self.root/'inbox'
  self.fixture_authority=SourceAuthority(self.root/'authority.sqlite',create=True,expected_endpoint='https://synthetic.invalid/')
  with self.fixture_authority.connect() as c:c.execute("UPDATE metadata SET value='synthetic-test-realm' WHERE key='realm'")
  self.fixture_authority.realm='synthetic-test-realm';self._credentials={}
  super().__init__(base,authorization_guard=self.fixture_authority.prepared_guard)
  _OWNED[self]=(_identity(self.root),_identity(self.path),_identity(self.fixture_authority.path))
 def receive(self,body,authorization=None):
  require_synthetic_inbox(self)
  e,_=decode(body)
  if authorization is not None or not isinstance(e,dict) or not isinstance(e.get('samples'),list):raise ValueError('E_SYNTHETIC_DATA')
  instance=e.get('source',{}).get('instanceId')
  if instance not in ['client','other'] or e!=envelope(e['samples'],instance):raise ValueError('E_SYNTHETIC_DATA')
  for s in e['samples']:_check_row(s)
  source=source_of(e);key=tuple(source)
  if key not in self._credentials:
   c=self.fixture_authority.issue(source[1],source[0],'https://synthetic.invalid/')
   principal=hashlib.sha256(json.dumps(source).encode()).hexdigest()[:32]
   with self.fixture_authority.connect() as db:db.execute('UPDATE credentials SET principal=? WHERE id=?',(principal,c['credentialId']))
   c['principalId']=principal
   self._credentials[key]=c
  credential=self._credentials[key];verified=copy.deepcopy(e);verified['source'].update(principalId=credential['principalId'],realmId=credential['realmId'])
  with self.fixture_authority.authorize('Bearer '+credential['token'],verified) as proof:return super().receive(body,authorization=proof)
 def seed(self):
  rows=[sample('action','session-'+str(i),variant=i) for i in range(32)]
  for s in rows:s['m']['modeContext']=dict(group='doudizhu-classic',submode='normal',role='farmer',ruleKey='test-rule')
  self.receive(json.dumps(envelope(rows)).encode())
 def close(self):
  _OWNED.pop(self,None);_EXPORTED.pop(self,None);self._temporary.cleanup()
