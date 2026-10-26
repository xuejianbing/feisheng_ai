// Qualification and immutable dataset projection; upload receipts are not evidence.
import {trainingLabelOf} from './labelPolicy.js?v=41a';
import {championSampleEligibility} from '../../decision/strategy/championStrategy.js?v=41a';
import {adaptToCurrentDim} from '../features/dimensionAdapter.js?v=41a';
import {sha256Hex,_stableStringify} from './cloudSampleState.js?v=41a';
export const DATASET_RULES='training-lineage-v1';
const canonical=_stableStringify;
const hash=v=>sha256Hex(canonical(v));
const id=v=>typeof v==='string'&&v.trim().length>0;
export function logicalTransaction(sample){const m=sample?.m;return m&&[m.sessionId,m.actorId,m.transactionId].every(id)?canonical([m.sessionId,m.actorId,m.transactionId]):null;}
const immutable=s=>({f:Array.from(s.f),sessionId:s.m.sessionId,actorId:s.m.actorId,transactionId:s.m.transactionId,
 player:s.m.player,action:s.m.action||s.m.type,id:s.m.id,target:s.m.target??null,modeContext:s.m.modeContext});
const result=s=>({reward:s.r??s.reward,value:s.value_target,observedReward:s.m.observedReward,credit:s.m.creditAllocation||null});
const business=s=>canonical({f:Array.from(s.f),r:s.r??s.reward,value:s.value_target,m:s.m,
 legacy:s._dimAdapted===true,originalDim:s._originalDim,missing:s._missingFeatureIndices});
export function qualifyTrainingSample(raw,{modeGroup=null}={}){
 const fail=(state,code)=>({eligible:false,state,code,sample:null});
 if(!raw||typeof raw!=='object')return fail('rejected','E_SAMPLE');
 const adapted=adaptToCurrentDim(raw);
 if(adapted.error)return fail('rejected','E_DIMENSION');
 const s={...adapted.sample,f:Array.from(adapted.sample.f)},m=s.m;
 if(modeGroup&&m?.modeContext?.group!==modeGroup)return fail('rejected','E_DATASET_SCOPE');
 if(modeGroup){const c=m.modeContext;if(c.schema!=='mode-context-v1'||c.captured!==true||c.mode!=='doudizhu'||!['normal','kaihei','huanle'].includes(c.submode)||c.collect!==true||!['landlord','farmer'].includes(c.role)||!c.ruleKey||c.ruleVersion!==1)return fail('quarantine','E_MODE_CONTEXT');}
 if(!logicalTransaction(s))return fail(s.f.length===134&&(adapted.adapted||s._dimAdapted)?'legacy':'quarantine','E_IDENTITY');
 if(m.rewardSchema!=='action-outcome-v1')return fail('quarantine','E_REWARD_SCHEMA');
 if(s.trainingEligible===false||m.trainingEligible===false)return fail('rejected','E_NOT_ELIGIBLE');
 if(m.executionState!=='committed')return fail('rejected','E_NOT_EXECUTED');
 const terminal=['win','lose'].includes(m.gameOutcome);
 if(m.gameOutcome==='win'&&m.outcomeTarget!==1||m.gameOutcome==='lose'&&m.outcomeTarget!==-1||
  !terminal&&(m.outcomeTarget!=null||![undefined,null,'unknown'].includes(m.gameOutcome)))return fail('quarantine','E_TERMINAL_LABEL');
 const o=m.actionOutcome;
 if(o&&((o.transactionId!==undefined&&o.transactionId!==m.transactionId)||(o.actorId!==undefined&&o.actorId!==m.actorId)||
  (o.sessionId!==undefined&&o.sessionId!==m.sessionId)||(o.id!==undefined&&o.id!==m.id)||
  (o.type!==undefined&&o.type!==(m.action||m.type))||(o.target!==undefined&&canonical(o.target??null)!==canonical(m.target??null))))return fail('quarantine','E_EVIDENCE_IDENTITY');
 if(['pending','partial','unresolved'].includes(m.rewardStatus)){
  // Terminal game labels are independent; completed action reward evidence is not.
  if(o?.status==='observed'||(o?.status!==undefined&&!['pending','partial','unresolved'].includes(o.status))||
   m.observedReward!=null||o?.reward!=null||m.creditAllocation!=null||s.fbAsync===true)return fail('quarantine','E_REWARD_STATE_CONFLICT');
  return fail('pending','E_REWARD_'+m.rewardStatus.toUpperCase());
 }
 if(m.rewardStatus!=='observed')return fail('quarantine','E_REWARD_STATUS');
 if(o&&((o.status!==undefined&&o.status!=='observed')||(o.reward!==undefined&&o.reward!==m.observedReward)))return fail('quarantine','E_EVIDENCE_IDENTITY');
 if(trainingLabelOf(s)===null)return fail('quarantine','E_LABEL');
 const reason=championSampleEligibility(s);
 if(reason)return fail('quarantine','E_EVIDENCE_'+reason.toUpperCase().replaceAll('-','_'));
 return {eligible:true,state:adapted.adapted||s._dimAdapted?'legacy':'trainable',code:adapted.adapted||s._dimAdapted?'L_FEATURES_130':'OK',sample:s,
  terminalConfirmed:['win','lose'].includes(m.gameOutcome),identity:logicalTransaction(s)};
}
export function collectTrainingDataset(input,options={}){
 if(!Array.isArray(input))throw Error('E_DATASET_INPUT');
 const groups=new Map(),decisions=[],counts={raw:0,duplicates:0,superseded:0,conflicts:0,accepted:0,legacy:0,legacyUnqualified:0,pending:0,quarantine:0,rejected:0},reasons={};
 const reason=code=>{reasons[code]=(reasons[code]||0)+1;};
 for(const raw of input||[]){counts.raw++;const q=qualifyTrainingSample(raw,options),key=logicalTransaction(raw);
  const decision={...q,index:decisions.length};decisions.push(decision);if(!q.eligible){counts[q.state==='legacy'?'legacyUnqualified':q.state]++;reason(q.code);}
  if(key){if(!groups.has(key))groups.set(key,[]);groups.get(key).push({raw,q,decision});}
 }
 const accepted=[];
 for(const [key,rows] of [...groups].sort(([a],[b])=>a<b?-1:a>b?1:0)){
  const valid=rows.filter(r=>r.q.eligible),bad=rows.some(r=>!r.q.eligible&&r.q.state!=='pending');
  if(!valid.length)continue;
  // Equality needs canonical content, not a cryptographic digest on every panel read.
  const features=new Set(rows.map(r=>{const a=adaptToCurrentDim(r.raw);return a.error?'invalid':canonical(immutable({...a.sample,f:Array.from(a.sample.f)}));}));
  const rewards=new Set(valid.map(r=>canonical(result(r.q.sample))));
  const terminals=new Set(rows.map(r=>r.raw.m.gameOutcome).filter(v=>['win','lose'].includes(v)));
  if(bad||features.size!==1||rewards.size!==1||terminals.size>1){counts.conflicts++;reason('E_TRANSACTION_CONFLICT');for(const r of rows)Object.assign(r.decision,{eligible:false,state:'quarantine',code:'E_TRANSACTION_CONFLICT',sample:null});continue;}
  const ordered=valid.slice().sort((a,b)=>Number(b.q.terminalConfirmed)-Number(a.q.terminalConfirmed)||(canonical(a.q.sample)<canonical(b.q.sample)?-1:canonical(a.q.sample)>canonical(b.q.sample)?1:0));
  const chosen=ordered[0].q.sample;
  const versions=new Set(valid.map(r=>canonical({immutable:immutable(r.q.sample),result:result(r.q.sample),terminal:[r.q.sample.m.gameOutcome??null,r.q.sample.m.outcomeTarget??null]})));
  counts.duplicates+=valid.length-versions.size;counts.superseded+=rows.length-valid.length+versions.size-1;
  const selected=ordered[0],selectedVersion=canonical({immutable:immutable(chosen),result:result(chosen),terminal:[chosen.m.gameOutcome??null,chosen.m.outcomeTarget??null]});
  for(const r of rows){if(r===selected)continue;
   const same=r.q.eligible&&canonical({immutable:immutable(r.q.sample),result:result(r.q.sample),terminal:[r.q.sample.m.gameOutcome??null,r.q.sample.m.outcomeTarget??null]})===selectedVersion;
   Object.assign(r.decision,{eligible:false,state:'excluded',code:same?'D_DUPLICATE_REVISION':'D_SUPERSEDED_REVISION',sample:null});
  }
  counts.accepted++;if(ordered[0].q.state==='legacy')counts.legacy++;
  accepted.push(JSON.parse(JSON.stringify(chosen)));
 }
 counts.dispositions={};for(const d of decisions)counts.dispositions[d.code]=(counts.dispositions[d.code]||0)+1;
 return {samples:accepted,counts,reasons,uniqueLogicalTransactions:groups.size,decisions};
}
// Fixed session hash buckets: adding/removing actions never reassigns a session.
export function splitTrainingSessions(rows,{seed='20261023',validationRatio=.1,holdoutRatio=.1}={}){
 if(![validationRatio,holdoutRatio].every(v=>Number.isFinite(v)&&v>=0)||validationRatio+holdoutRatio>1)throw Error('E_SPLIT_RULES');
 const buckets={training:[],validation:[],holdout:[]},sessions={training:new Set(),validation:new Set(),holdout:new Set()},assigned=new Map();
 for(const row of rows){const sid=row.m?.sessionId;if(!id(sid))throw Error('E_SPLIT_SESSION');
  if(!assigned.has(sid)){const value=parseInt(hash([String(seed),sid]).slice(0,8),16)/4294967296;
   assigned.set(sid,value<holdoutRatio?'holdout':value<holdoutRatio+validationRatio?'validation':'training');}
  const name=assigned.get(sid);buckets[name].push(row);sessions[name].add(sid);
 }
 return {...buckets,metadata:{schema:'session-hash-three-way-v1',seed:String(seed),validationRatio,holdoutRatio,
  sessions:Object.fromEntries(Object.entries(sessions).map(([k,v])=>[k,[...v].sort()]))}};
}
export function buildDatasetManifest(raw,{generatedAt,source='client-local',split={},classicPartition=null,modeGroup=null}={}){
 if(typeof generatedAt!=='string'||!Number.isFinite(Date.parse(generatedAt)))throw Error('E_GENERATION_TIME');
 const dataset=collectTrainingDataset(raw,{modeGroup}),partition=classicPartition||splitTrainingSessions(dataset.samples,split);
 if(classicPartition){
  const training=new Set(partition.training.map(s=>s.m.sessionId)),validation=new Set(partition.validation.map(s=>s.m.sessionId));
  if([...training].some(s=>validation.has(s)))throw Error('E_SPLIT_LEAKAGE');
  const selected=new Set(dataset.samples.map(logicalTransaction)),ids=[...partition.training,...partition.validation].map(logicalTransaction);
  const held=partition.metadata?.holdoutSessions;
  if(ids.length!==selected.size||new Set(ids).size!==selected.size||ids.some(i=>!selected.has(i))||
   !Array.isArray(held)||held.length!==validation.size||new Set(held).size!==held.length||held.some(s=>!validation.has(s)))throw Error('E_SPLIT_DATASET');
  const content=new Map(dataset.samples.map(s=>[logicalTransaction(s),business(s)]));
  if([...partition.training,...partition.validation].some(s=>business(s)!==content.get(logicalTransaction(s))))throw Error('E_SPLIT_CONTENT');
 }
 const revisions=dataset.samples.map(s=>({logicalId:logicalTransaction(s),contentHash:hash({immutable:immutable(s),result:result(s),terminal:[s.m.gameOutcome??null,s.m.outcomeTarget??null],legacy:s._dimAdapted===true})}));
 const inputHash=hash((raw||[]).map(s=>hash(s?{f:s.f&&(Array.isArray(s.f)||ArrayBuffer.isView(s.f))?Array.from(s.f):s.f,r:s.r??s.reward,value:s.value_target,m:s.m||s.meta}:null)).sort());
 const core={schema:'training-dataset-manifest-v1',rules:DATASET_RULES,source,modeGroup,inputHash,clientSchema:'action-outcome-v1',modelDim:134,pretrainedExposure:'unknown',labelDefinition:'labelPolicy/action-outcome-v1; reward*12 actor; reward/12 critic; terminal separate',
  counts:dataset.counts,reasons:dataset.reasons,uniqueLogicalTransactions:dataset.uniqueLogicalTransactions,
  sessionCounts:classicPartition?{training:new Set(partition.training.map(s=>s.m.sessionId)).size,validation:new Set(partition.validation.map(s=>s.m.sessionId)).size,holdout:partition.metadata.holdoutSessions.length}:
   Object.fromEntries(Object.entries(partition.metadata.sessions).map(([k,v])=>[k,v.length])),
  splits:classicPartition?{schema:'classic-validation-is-holdout-v1',...classicPartition.metadata,
   trainingSessionIds:[...new Set(classicPartition.training.map(s=>s.m.sessionId))].sort(),
   validationSessionIds:[...new Set(classicPartition.validation.map(s=>s.m.sessionId))].sort(),validationIsHoldout:true}:partition.metadata,revisions};
 const contentHash=hash(core);
 return {dataset,partition,manifest:{...core,generatedAt,hashAlgorithm:'SHA-256/canonical-json',datasetVersion:'sha256:'+contentHash,contentHash}};
}
