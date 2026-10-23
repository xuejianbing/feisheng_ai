/* 借刀的实际响应：只在已确认的持刀者/被杀者窗口比较出杀与交武器。 */
import {lib,game,get,ui,ai,_status} from '../../foundation/adapt/host.js?v=41a';
import {cfg} from '../../foundation/config/util.js?v=41a';
import {dispositionOf} from '../relations/relations.js?v=41a';
import {identityHostEffect} from '../../perception/observer/identityDiagnostics.js?v=41a';
import {cooperativeTrickIntent,cooperativeTrickEpoch} from '../state/cooperativeTrickIntent.js?v=41a';
import {beginChoiceAudit} from '../../perception/journal/choiceAudit.js?v=41a';

import {responseMaterialOptions} from './responseMaterials.js?v=41a';
import {jiedaoPolicyEnabled} from '../cards/jiedaoEvaluator.js?v=41a';
import {jiedaoTransferValue} from '../cards/jiedaoBranches.js?v=41a';
let evaluating=false;
const clamp=n=>Math.max(-24,Math.min(24,n));
function parentOf(e){return e?.parent||e?.getParent?.();}
export function resolveJiedaoResponse(holder,event=_status.event){
 try{
  const seen=new Set();let e=event,choice=null;
  while(e&&seen.size<24&&!seen.has(e)){
   seen.add(e);
   if(e.finished)return null;
   // A later Sha/duel response must not inherit an outer borrowed-sword choice.
   if(['useCard','respond','chooseToRespond','juedou'].includes(e.name))return null;
   if(e.name==='chooseToUse'){
    if(choice||e.player!==holder)return null;
    choice=e;
   }
   if(e.name==='jiedao'){
    if(e.target!==holder||!e.player||e.player===holder)return null;
    const victim=choice?.sourcex||e.addedTarget;
    if(!victim||victim===holder||e.addedTarget&&victim!==e.addedTarget)return null;
    if(choice?.respondTo&&(choice.respondTo[0]!==e.player||get.name(choice.respondTo[1])!=='jiedao'))return null;
    if(holder.isIn?.()===false||victim.isIn?.()===false||holder.alive===false||victim.alive===false)return null;
    return {source:e.player,holder,victim,card:e.card,root:e,event:choice||event};
   }
   e=parentOf(e);
  }
 }catch(_){}
 return null;
}
function weaponsOf(p){
 return (p.getCards('e')||[]).filter(c=>get.subtypes(c)?.includes('equip1'));
}
function legalSha(holder,card,ctx,skill=null){
 if(get.name(card,holder)!=='sha')return false;
 if(lib.filter.cardEnabled&&!lib.filter.cardEnabled(card,holder))return false;
 if(lib.filter.cardEnabled2&&!lib.filter.cardEnabled2(card,holder))return false;
 if(lib.filter.targetEnabled&&!lib.filter.targetEnabled(card,holder,ctx.victim))return false;
 if(lib.filter.targetInRange&&!lib.filter.targetInRange(card,holder,ctx.victim))return false;
 // No cardUsable: native borrowed Sha explicitly uses addCount=false.
 if(ctx.event.name==='chooseToUse'){
  if((!skill||ctx.event.skill!==skill)&&typeof ctx.event.filterCard==='function'&&!ctx.event.filterCard(card,holder,ctx.event))return false;
  if(typeof ctx.event.filterTarget==='function'&&!ctx.event.filterTarget(card,holder,ctx.victim))return false;
 }
 return true;
}
export function evaluateJiedaoResponse(holder,event=_status.event,material=null){
 const unresolved=reason=>({resolved:false,reason});
 if(evaluating)return unresolved('reentrant-effect');
 evaluating=true;
 try{
  if(!jiedaoPolicyEnabled())return unresolved('cooperation-policy-out-of-scope');
  if(cfg('responseAI',true)===false)return unresolved('response-off');
  const ctx=resolveJiedaoResponse(holder,event);
  if(!ctx)return unresolved('ambiguous-jiedao-window');
  const weapons=weaponsOf(holder);
  if(!weapons.length)return unresolved('no-weapon-transfer');
  const transferValue=jiedaoTransferValue(ctx.source,holder,holder,dispositionOf);
  if(transferValue===null)return unresolved('unknown-weapon-value');
  if(!material&&ctx.event.name==='chooseToUse'&&ui.selected?.cards?.length===1)material=ui.selected.cards[0];
  const options=responseMaterialOptions(holder,'sha',{event:ctx.event,use:true,target:ctx.victim,material});
  let best=null;
  for(const option of options){
   const c=option.card;
   if(!legalSha(holder,c,ctx,option.skill))continue;
   const effect=identityHostEffect(ctx.victim,c,holder,holder);
   const parts=option.cards;
   let cost=0;
   for(const part of parts){const value=get.value(part,holder);if(!Number.isFinite(value))return unresolved('unknown-sha-cost');cost+=Math.max(0,value)/4;}
   if(!Number.isFinite(effect))return unresolved('unknown-sha-effect');
   let shaValue=clamp(effect-cost);
   // Preserve the old ally-survival protection without rejecting positive self-damage effects.
   const allyLethalRisk=dispositionOf(holder,ctx.victim)>0&&ctx.victim.hp+(ctx.victim.hujia||0)<=1&&effect<0;
   if(allyLethalRisk)shaValue=Math.min(shaValue,transferValue-1);
   if(!best||shaValue>best.shaValue)best={shaValue,material:c,skill:option.skill,allyLethalRisk};
  }
  // No physical Sha does not prove that a conversion skill cannot supply one.
  if(!best)return unresolved('no-supported-legal-sha');
  const cooperation=cooperativeTrickIntent(holder,{originalSpellId:'jiedao',source:ctx.source,target:holder,
   effectScope:'target',card:ctx.card,responseEvent:event});
  const delta=best.shaValue-transferValue;
  return {resolved:true,action:delta>0?'sha':'transfer',shaValue:best.shaValue,transferValue,delta,
   source:ctx.source,victim:ctx.victim,material:best.material,playerIntentRespected:!!cooperation,
   effectBasis:'response-branch-estimate',reason:best.allyLethalRisk?'avoid-harmful-lethal-to-ally':delta>0?'sha-better-than-transfer':'transfer-no-worse-than-sha'};
 }catch(_){return unresolved('jiedao-evaluation-failed');}finally{evaluating=false;}
}

/* Score the actual returned choice after native .set(sourcex/respondTo) completes. */
export function installJiedaoResponseBridge(){
 const proto=lib.element?.Player?.prototype,original=proto?.chooseToUse;
 if(typeof original!=='function')return ()=>{};
 let active=true;
 const controlled=p=>p===game.me&&!_status.auto||p.isOnline2?.();
 const wrapped=function(...args){
  const p=this,parent=_status.event,result=original.apply(this,args);
  if(!active||!jiedaoPolicyEnabled()||controlled(p)||!result||typeof result!=='object'||!resolveJiedaoResponse(p,parent))return result;
  const native1=result.ai1,native2=result.ai2,epoch=cooperativeTrickEpoch();
  const window=()=>{
   if(result.name!=='chooseToUse'||result.player!==p)return null;
   return (result.parent||result.getParent?.())?result:{...result,parent};
  };
  const evaluate=item=>{
   if(!active||epoch!==cooperativeTrickEpoch()||controlled(p)||cfg('responseAI',true)===false)return null;
   const e=window();if(!e)return null;const decision=evaluateJiedaoResponse(p,e,item);
   beginChoiceAudit(!!cfg('tacticalDiagnostics',false),p,result,'jiedao-response',parent)?.record(decision.resolved?'evaluated':'unresolved',{
    action:decision.action||null,shaValue:decision.shaValue??null,transferValue:decision.transferValue??null,
    reason:decision.reason,playerIntentRespected:!!decision.playerIntentRespected,executionState:'suggested'});
   return decision.resolved?decision:null;
  };
  // .set('ai1'/'ai2') performed by the host afterwards remains authoritative.
  result.ai1=function(item,...rest){const d=evaluate(item);return d?(d.action==='sha'?Math.min(8,Math.max(.1,d.delta)):-1):typeof native1==='function'?native1.call(this,item,...rest):get.order?.(item,p);};
  result.ai2=function(target,...rest){const d=evaluate();return d&&target===d.victim?(d.action==='sha'?Math.min(8,Math.max(.1,d.delta)):-1):typeof native2==='function'?native2.call(this,target,...rest):identityHostEffect(target,{name:'sha'},p,p);};
  return result;
 };
 proto.chooseToUse=wrapped;
 // Native chooseCard switches from event.ai1 to skill.check after selecting a
 // viewAs skill. Rejoin that material stage without changing the skill or filters.
 const basic=ai?.basic,nativeChooseCard=basic?.chooseCard;
 const chooseMaterial=typeof nativeChooseCard==='function'?function(check,...args){
  const event=_status.event,p=event?.player;
  if(!active||!jiedaoPolicyEnabled()||!p||controlled(p)||!event.skill||!resolveJiedaoResponse(p,event))return nativeChooseCard.call(this,check,...args);
  const score=function(item,...rest){
   const d=active&&!controlled(p)?evaluateJiedaoResponse(p,event,item):null;
   return d?.resolved?(d.action==='sha'?Math.min(8,Math.max(.1,d.delta)):-1):typeof check==='function'?check.call(this,item,...rest):0;
  };
  return nativeChooseCard.call(this,score,...args);
 }:null;
 if(chooseMaterial)basic.chooseCard=chooseMaterial;
 return ()=>{
  active=false;
  if(proto.chooseToUse===wrapped)proto.chooseToUse=original;
  if(chooseMaterial&&basic.chooseCard===chooseMaterial)basic.chooseCard=nativeChooseCard;
 };
}
