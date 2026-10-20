/* 手动出牌示范：独立执行凭据，不借用 AI 建议；顺序证据不等于连招因果标签。 */
import {FEATURE_DIM} from '../features/features.js?v=41a';
export function directPlayPhase(event, actor, recast=false) {
 const seen=new Set();let phase=null,choice=false;
 while(event&&!seen.has(event)&&seen.size<128){
  seen.add(event);
  if(['useCard','respond','recast'].includes(event.name)||event.name==='useSkill'&&!(recast&&event.skill==='_recasting'))return null;
  if(event.name==='chooseToUse'&&event.player===actor&&event.type==='phase')choice=true;
  if(event.name==='phaseUse'){phase=event;break;}
  event=event.parent||(typeof event.getParent==='function'?event.getParent():null);
 }
 return choice&&phase&&phase.player===actor?phase:null;
}
function phaseOf(event){const seen=new Set();while(event&&!seen.has(event)&&seen.size<128){if(event.name==='phaseUse')return event;seen.add(event);event=event.parent||(typeof event.getParent==='function'?event.getParent():null);}return null;}
const targetsOf=values=>values.map(v=>String(v)).sort();
export function createPlayerDemonstrationCollector({key,features,observer,record,feedback,archive=()=>{}}){
 let generation=0,serial=0,sequences=new WeakMap(),committedRoots=new WeakSet(),consumedTickets=new WeakSet();
 const emit=(...args)=>{try{archive(...args);}catch(_){}};
 function prepare({actor,event,context,manual,action}){
  if(!manual||!context?.captured||!context.enabled||!context.collect||!context.playerDemonstrations||context.group!=='doudizhu-classic'||!['farmer','landlord'].includes(context.role))return null;
  const phase=directPlayPhase(event,actor,!!action?.recast);if(!phase||!action?.id||!['card','equip'].includes(action.type))return null;
  try{
   const f=Array.from(features(actor,action));if(f.length!==FEATURE_DIM||!f.every(Number.isFinite))return null;
   const snapshot=observer.before(actor,event,true);if(!snapshot)return null;
   return {actor,phase,action:{...action,target:action.target||null},f,snapshot,context,generation};
  }catch(_){return null;}
 }
 function commit(ticket,root){
  if(!ticket||consumedTickets.has(ticket)||ticket.generation!==generation||!root||committedRoots.has(root)||root.player!==ticket.actor||phaseOf(root)!==ticket.phase)return null;
  const {actor,action,context}=ticket;
  if(action.recast?root.name!=='recast'||root.cards?.length!==1:root.name!=='useCard')return null;
  const card=action.recast?root.cards[0]:root.card;
  if(card?.name!==action.id||JSON.stringify(targetsOf((root.targets||[]).map(key)))!==JSON.stringify(targetsOf(Array.isArray(action.target)?action.target:action.target?[action.target]:[])))return null;
  committedRoots.add(root);consumedTickets.add(ticket);
  let sequence=sequences.get(actor);
  if(!sequence||sequence.phase!==ticket.phase||sequence.sessionId!==context.sessionId||sequence.index>=48){sequence={phase:ticket.phase,sessionId:context.sessionId,id:'demo_'+Date.now().toString(36)+'_'+(++serial),index:0,previous:null};sequences.set(actor,sequence);}
  const transactionId=sequence.id+'_'+(++sequence.index),demonstration={schema:'player-demonstration-v1',sequenceId:sequence.id,step:sequence.index,previousTransactionId:sequence.previous,nature:action.nature||null,recast:!!action.recast};
  const storedAction={type:action.type,id:action.id,target:action.target,nature:action.nature||null,recast:!!action.recast};
  const tx={id:transactionId,state:'committed',expected:{type:action.type,id:action.id,recast:!!action.recast},actual:{...action},trainingActorId:key(actor),trainingActionType:action.type,trainingSessionId:context.sessionId};
  const sample=record(actor,action,ticket.f,{transactionId,actorId:key(actor),target:action.target,source:'player-demonstration',demonstration});
  if(!sample){sequences.delete(actor);return null;}
  sequence.previous=transactionId;
  let result=null;
  const complete=observer.observe(ticket.snapshot,root,tx,outcome=>{
   if(ticket.generation!==generation)return;
   result=outcome;feedback({...outcome,type:action.type,sessionId:context.sessionId});
   emit('playerDemonstrationOutcome',{...outcome,demonstration,source:'player-demonstration'},tx);
  });
  emit('playerDemonstration',{action:storedAction,demonstration,source:'player-demonstration',trainingEligible:false,note:'顺序证据；训练资格由实际收益单独校验'},tx);
  return {tx,complete:typeof complete==='function'?complete:null,result:()=>result};
 }
 return {prepare,commit,interrupt(actor){sequences.delete(actor);},reset(){generation++;sequences=new WeakMap();committedRoots=new WeakSet();consumedTickets=new WeakSet();}};
}
export function playerDemonstrationSummary(samples,qualified){
 const groups=new Map(),seen=new Set();let observed=0,pending=0,unresolved=0,total=0;
 for(const s of samples||[]){const m=s?.m,d=m?.demonstration;if(m?.source!=='player-demonstration'||d?.schema!=='player-demonstration-v1'||!d.sequenceId||!Number.isInteger(d.step)||d.step<1||!m.sessionId||!m.actorId||!m.transactionId)continue;
  const key=JSON.stringify([m.sessionId,m.actorId,m.transactionId]);if(seen.has(key))continue;seen.add(key);total++;
  if(qualified.has(key))observed++;else if(m.rewardStatus==='pending')pending++;else unresolved++;
  const groupKey=JSON.stringify([m.sessionId,m.actorId,d.sequenceId]);if(!groups.has(groupKey))groups.set(groupKey,[]);groups.get(groupKey).push({id:m.id,transactionId:m.transactionId,step:d.step,previous:d.previousTransactionId,recast:!!d.recast,nature:d.nature,qualified:qualified.has(key)});
 }
 const rows=[...groups.values()].map(steps=>{steps.sort((a,b)=>a.step-b.step);const continuous=steps.every((s,i)=>i===0?s.step===1&&!s.previous:s.step===steps[i-1].step+1&&s.previous===steps[i-1].transactionId);return {steps,continuous,verified:continuous&&steps.every(s=>s.qualified)};}).filter(r=>r.steps.length>=2);
 return {total,observed,pending,unresolved,sequences:rows.length,verifiedSequences:rows.filter(r=>r.verified).length,recent:rows.slice(-5)};
}
