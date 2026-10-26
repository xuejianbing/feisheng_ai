// Diagnostic ledger only. No scoring consumer currently applies autoFeature, so
// even a qualified observed action cannot prove an autoFeature treatment effect.
import {qualifyTrainingSample,logicalTransaction} from '../train/trainingDataset.js?v=41a';
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
export function createAutoFeatureEvidence({configuration,limit=2000}) {
 const entries=new Map();let missingIdentity=0,duplicates=0,evicted=0;
 const categories=['confirmed','awaitingObservation','missingIdentity','configurationMismatch','duplicateRevisions','conflicting','historicalUnverifiable'];
 function binding(s){const m=s?.m;return m&&{sessionId:m.sessionId,actorId:m.actorId,transactionId:m.transactionId,type:m.action||m.type,id:m.id,target:m.target??null};}
 function matches(a,b){return a&&b&&Object.keys(a).every(k=>same(a[k],b[k]));}
 function classify(entry,s){
  if(entry.state==='conflicting')return;
  const q=qualifyTrainingSample(s);
  if(q.state==='pending'){
   if(entry.reward!==undefined){duplicates++;return;} // Superseded waiting revision.
   entry.state='awaitingObservation';return;
  }
  if(!q.eligible){entry.state='conflicting';entry.reason=q.code;return;}
  const reward=JSON.stringify([s.m.observedReward,s.m.creditAllocation??null]);
  if(entry.reward!==undefined&&entry.reward!==reward){entry.state='conflicting';entry.reason='reward-revision-conflict';return;}
  if(entry.reward===reward)duplicates++;
  entry.reward=reward;
  entry.state='configurationMismatch';entry.reason='autoFeature-not-applied-by-scoring';
 }
 function record(context,tx,s){
  const key=logicalTransaction(s),b=binding(s);
  if(!context||!key||!tx?.id||!tx.trainingSessionId||!tx.trainingActorId){missingIdentity++;return false;}
  const expected={sessionId:tx.trainingSessionId,actorId:tx.trainingActorId,transactionId:tx.id,type:tx.actual?.type,id:tx.actual?.id,target:tx.actual?.target??null};
  if(entries.has(key)){const e=entries.get(key);duplicates++;if(!matches(e.binding,b))e.state='conflicting';return false;}
  const entry={binding:b,configuration:configuration(),context:{...context},state:'awaitingObservation'};
  entries.set(key,entry);
  if(tx.state!=='committed'||!matches(expected,b)){entry.state='conflicting';entry.reason='execution-binding-mismatch';}
  else classify(entry,s);
  if(entries.size>limit){entries.delete(entries.keys().next().value);evicted++;}
  return entry.state!=='conflicting';
 }
 function observe(feedback,s){
  const key=logicalTransaction(s),entry=entries.get(key);
  if(!entry){missingIdentity++;return false;}
  if(!matches(entry.binding,binding(s))||!matches(entry.binding,feedback)){
   entry.state='conflicting';entry.reason='observation-binding-mismatch';return false;
  }
  if(entry.configuration!==configuration()){entry.state='configurationMismatch';entry.reason='configuration-changed';return false;}
  if(feedback.status==='observed'&&(!Number.isFinite(feedback.reward)||feedback.reward!==s.m?.observedReward)){
   entry.state='conflicting';entry.reason='observation-reward-mismatch';return false;
  }
  classify(entry,s);return false; // Adjustment remains closed without treatment evidence.
 }
 function stats(){
  const c=Object.fromEntries(categories.map(k=>[k,0])),current=configuration();
  for(const e of entries.values()){
   if(e.state!=='conflicting'&&e.configuration!==current)c.configurationMismatch++;
   else c[e.state]++;
  }
  c.missingIdentity=missingIdentity;c.duplicateRevisions=duplicates;
  return {...c,uniqueTransactions:entries.size,evictedTransactions:evicted,scope:'retained-runtime-transactions; duplicate/missing counters are deliveries'};
 }
 return {record,observe,stats,reset(){entries.clear();missingIdentity=duplicates=evicted=0;}};
}
