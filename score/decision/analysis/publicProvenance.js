import { observeNaturalCompletion } from './naturalCompletion.js?v=41a';
/* 公开牌实例的跨事件来源证据；不计算因果收益、不生成训练标签。 */
export function createPublicProvenanceTracker({players,key,onResult,limit=128}) {
 let generation=0,serial=0,uses=new WeakMap(),phases=new WeakMap(),resolved=new WeakMap(),attached=new WeakSet(),completedUses=new WeakSet(),cardIds=new WeakMap();
 const sources=new Map();
 const cards=(p,zone)=>p?.getCards?.(zone)||[];
 const token=card=>{if(!cardIds.has(card))cardIds.set(card,'public-card-'+(++serial));return cardIds.get(card);};
 function ancestor(root,filter) {
  const seen=new Set();while(root&&!seen.has(root)&&seen.size<128){if(filter(root))return root;seen.add(root);root=root.parent||(typeof root.getParent==='function'?root.getParent():null);}return null;
 }
 const assets=p=>({hp:Number(p.hp)||0,hand:Number(p.countCards?.('h'))||0,skips:[...(p.skipList||[])]});
 function emit(source,stage,detail,consumer=null) {
  const ids=[source.transactionId];
  if(consumer?.trainingActorId===source.actorId && consumer.trainingSessionId===source.sessionId && consumer.id!==source.transactionId)ids.push(consumer.id);
  onResult({schema:'action-provenance-v1',kind:source.zone==='j'?'delayed-card':'equipment-followup',
   evidenceId:source.sessionId+':public-evidence-'+(++serial),transactionIds:ids,actorId:source.actorId,
   sessionId:source.sessionId,preparationId:source.transactionId,consumerId:consumer?.id||null,
   cardInstanceId:source.cardInstanceId,cardName:source.name,stage,status:'observed-evidence',
   causalStatus:'unverified',trainingEligible:false,groupReward:null,...detail});
 }
 function trackUse(root,tx) {
  if(!root||root.name!=='useCard'||tx?.state!=='committed'||!tx.trainingSessionId)return false;
  uses.set(root,{...tx,trainingActorId:key(root.player)});return true;
 }
 function attachPlacement(root,zone) {
  if(!root||attached.has(root))return false;
  const use=ancestor(root,e=>uses.has(e)),tx=use&&uses.get(use),stamp=generation;
  const physical=[...(root.cards||[])].filter(c=>c&&typeof c==='object');
  if(!physical.length)return false;
  attached.add(root);
  return observeNaturalCompletion(root,error=>{
   if(stamp!==generation||error||!root.finished||!root.player)return;
   for(const card of physical)if(cards(root.player,zone).includes(card)) {
    if(tx) {
     const source={transactionId:tx.id,actorId:tx.trainingActorId,sessionId:tx.trainingSessionId,
      cardInstanceId:token(card),name:use.card?.name||root.card?.name,zone,owner:root.player};
     if(!source.name)continue;sources.set(card,source);emit(source,'placed',{ownerId:key(root.player)});
     if(sources.size>limit)sources.delete(sources.keys().next().value);
    }else{
     // 转移只能沿已经开始的该牌判定阶段确认，不把弃掉后再次使用猜成转移。
     const phase=ancestor(root,e=>phases.has(e)),source=phase&&phases.get(phase).get(card);
     if(source&&zone==='j'&&phase.card===card){source.owner=root.player;sources.set(card,source);emit(source,'transferred',{ownerId:key(root.player)});}
     else sources.delete(card);
    }
   }
  });
 }
 function beginPhase(phase) {
  if(phase?.name!=='phaseJudge'||!phase.player)return false;
  const found=new Map();for(const card of cards(phase.player,'j')){const s=sources.get(card);if(s?.zone==='j'&&s.owner===phase.player)found.set(card,s);}
  phases.set(phase,found);resolved.set(phase,new Set());return true;
 }
 function attachPhase(root) {
  if(!root||root.name!=='phaseJudge'||attached.has(root))return false;attached.add(root);const stamp=generation;
  return observeNaturalCompletion(root,error=>{
   if(stamp!==generation||error||!root.finished)return;
   for(const [card,source]of phases.get(root)||[]) {
    if(!resolved.get(root)?.has(card))emit(source,'phase-ended-without-confirmed-effect',{ownerId:key(root.player),resolutionStatus:'unresolved'});
    if(sources.get(card)===source&&![...(players()||[])].some(p=>cards(p,'j').includes(card)))sources.delete(card);
   }
   phases.delete(root);resolved.delete(root);
  });
 }
 function attachJudge(root) {
  const phase=ancestor(root?.parent,e=>phases.has(e)),source=phase&&phases.get(phase).get(root.card);
  if(!source||phase.card!==root.card||root.player!==phase.player||attached.has(root))return false;
  attached.add(root);const stamp=generation,owner=key(root.player);
  return observeNaturalCompletion(root,error=>{
   if(stamp!==generation||error||!root.finished)return;
   const result=root.result||{};
   emit(source,'judged',{ownerId:owner,judgement:{bool:typeof result.bool==='boolean'?result.bool:null,
    value:Number.isFinite(result.judge)?result.judge:null,
    card:result.card?{name:result.card.name,suit:result.card.suit,number:result.card.number}:null}});
  });
 }
 function attachEffect(root,parent) {
  const phase=ancestor(parent,e=>phases.has(e)),physical=phase?.card,source=physical&&phases.get(phase)?.get(physical);
  if(!source||attached.has(root)||![source.name,source.name+'Cancel'].includes(root?.name))return false;
  const owner=phase.player,before=assets(owner),stamp=generation,canceled=root.name===source.name+'Cancel';attached.add(root);
  return observeNaturalCompletion(root,error=>{
   if(stamp!==generation||error||!root.finished||root.player!==owner)return;
   const after=assets(owner);
   resolved.get(phase)?.add(physical);
   emit(source,canceled?'canceled':'effect-completed',{ownerId:key(owner),effect:{hpDelta:after.hp-before.hp,handDelta:after.hand-before.hand,
    addedSkips:after.skips.filter(s=>!before.skips.includes(s))}});
   if(![...(players()||[])].some(p=>cards(p,'j').includes(physical)))sources.delete(physical);
  });
 }
 function beforeUse(actor) {
  const equipment=cards(actor,'e').map(card=>({card,source:sources.get(card)})).filter(x=>x.source?.zone==='e'&&x.source.owner===actor);
  return {actor,equipment,generation};
 }
 function attachLoss(root) {
  if(!root||attached.has(root)||!Array.isArray(root.cards))return false;
  const affected=root.cards.filter(c=>sources.has(c)),stamp=generation;
  if(!affected.length)return false;attached.add(root);
  return observeNaturalCompletion(root,error=>{
   if(stamp!==generation||error||!root.finished)return;
   for(const card of affected){const source=sources.get(card);if(!source)continue;
    const phase=ancestor(root,e=>phases.has(e));
    if(source.zone==='j'&&phase?.card===card&&phases.get(phase).get(card)===source)continue;
    if(!cards(source.owner,source.zone).includes(card)){emit(source,'removed',{ownerId:key(source.owner)});sources.delete(card);}
   }
  });
 }
 function completeUse(snapshot,root,tx,outcome) {
  if(!snapshot||snapshot.generation!==generation||root?.finished!==true||root.player!==snapshot.actor||tx?.state!=='committed'||completedUses.has(root))return false;
  completedUses.add(root);
  for(const {card,source}of snapshot.equipment) {
   if(tx.id===source.transactionId||tx.trainingSessionId!==source.sessionId)continue;
   emit(source,'equipped-during-action',{ownerId:key(snapshot.actor),action:root.card?.name,
    stillEquipped:cards(snapshot.actor,'e').includes(card),actionObservation:outcome?{status:outcome.status,deltas:outcome.deltas||[]}:null},tx);
  }
  return true;
 }
 return {trackUse,attachPlacement,attachPhase,beginPhase,attachJudge,attachEffect,attachLoss,beforeUse,completeUse,
  reset(){generation++;sources.clear();uses=new WeakMap();phases=new WeakMap();resolved=new WeakMap();attached=new WeakSet();completedUses=new WeakSet();cardIds=new WeakMap();},};
}
