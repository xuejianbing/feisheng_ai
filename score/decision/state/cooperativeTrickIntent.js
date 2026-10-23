/* 绑定实际宿主用牌事件的意图凭据，不存储手牌/推测后续出牌。 */
import {game,get,_status} from '../../foundation/adapt/host.js?v=41a';
import {dispositionOf} from '../relations/relations.js?v=41a';
import {canSupplyTrickResponse,knownTrickDamage} from '../response/responseMaterials.js?v=41a';
import {cooperationPolicyEnabled} from '../strategy/cooperationPolicy.js?v=41a';
import {playChoiceWindow} from '../execution/decisionWindow.js?v=41a';
let roots=new WeakMap(),cards=new WeakMap(),epoch=0;
export function cooperativeTrickEpoch(){return epoch;}
export function resetCooperativeTrickIntents(){epoch++;roots=new WeakMap();cards=new WeakMap();}
export function humanControlsTrick(source){
 try{
  if(!source||source.isAuto||source.isMad?.())return false;
  if(source===game.me)return typeof source.isMine==='function'?source.isMine():!_status.auto&&!game.notMe;
  return source.isOnline2?.()===true;
 }catch(_){return false;}
}
function directPhase(window,source){
 const seen=new Set();let event=window;
 while(event&&seen.size<16&&!seen.has(event)){
  seen.add(event);
  if(event.name==='phaseUse')return event.player===source;
  if(event.name!=='chooseToUse'||event.type!=='phase'||event.player!==source||event.forced===true)return false;
  event=event.parent||event.getParent?.();
 }
 return false;
}
export function observeCooperativeTrickUse(root,source,choiceEvent){
 try{
  if(!cooperationPolicyEnabled())return null;
  if(!root||typeof root!=='object'||root.name!=='useCard'||root.player!==source||!source||!root.card||typeof root.card!=='object')return null;
  const id=get.name(root.card,source);
  if(!['huogong','tiesuo','guohe','shunshou','jiedao','juedou','nanman','wanjian'].includes(id))return null;
  const window=choiceEvent?.name==='chooseToUse'&&choiceEvent.player===source?playChoiceWindow(choiceEvent,source):null;
  const human=humanControlsTrick(source);
  // 除正式出牌选择外，强制用牌/技能结算等不获得玩家主动配合权限。
  const manual=!!human&&!!window&&directPhase(window,source)&&root.forced!==true;
  const record={root,source,card:root.card,id,manual,targets:new Set(root.targets||[]),active:true,epoch};
  roots.set(root,record);cards.set(root.card,record);
  return record;
 }catch(_){return null;}
}
export function finishCooperativeTrickUse(root){
 const record=root&&roots.get(root);
 if(record){record.active=false;if(cards.get(record.card)===record)cards.delete(record.card);roots.delete(root);}
}
function recordFor(ctx){
 const byCard=ctx?.card&&cards.get(ctx.card);
 // 宿主可能包装/复制虚拟牌；只有实际祖先事件相同才能补回关联，不按牌名猜。
 const seen=new Set();let event=ctx?.responseEvent||_status.event;
 while(event&&seen.size<32&&!seen.has(event)){
  seen.add(event);
  if(event.name==='useCard'&&get.name(event.card,event.player)===ctx?.originalSpellId){
   // 明确的原操作祖先优先；同牌复用时不能拿新操作凭据解释旧响应。
   return event.player===ctx.source?roots.get(event)||null:null;
  }
  try{event=event.parent||event.getParent?.();}catch(_){return null;}
 }
 return byCard||null;
}
// Unknown is deliberately distinct from a witnessed non-manual action.
export function trickUseEvidence(ctx){
 try{
  const record=recordFor(ctx);
  if(!record?.active||record.epoch!==epoch||record.root.finished||record.root.player!==ctx.source||
   record.source!==ctx.source||record.id!==ctx.originalSpellId)return {state:'unknown'};
  const targets=ctx.effectScope==='all'?ctx.targets:ctx.target?[ctx.target]:[];
  if(!targets?.length||targets.some(t=>!record.targets.has(t)))return {state:'unknown'};
  return {state:record.manual?'manual':'nonmanual',record};
 }catch(_){return {state:'unknown'};}
}
export function cooperativeTrickIntent(viewer,ctx,relationOf=dispositionOf){
 try{
  if(!cooperationPolicyEnabled())return null;
  const evidence=trickUseEvidence(ctx);
  if(evidence.state!=='manual')return null;
  const record=evidence.record;
  const targets=ctx.effectScope==='all'?ctx.targets:ctx.target?[ctx.target]:[];
  if(viewer===record.source||relationOf(viewer,record.source)<=0)return null;
  // 只使用响应者视角的关系；不能借用人类行动者的私有身份推断友方。
  if(['huogong','guohe','shunshou','juedou'].includes(record.id)&&(targets.length!==1||targets[0]!==viewer&&targets[0]!==record.source&&relationOf(viewer,targets[0])<=0))return null;
  if(['nanman','wanjian'].includes(record.id)){
   // Intent cannot authorize cancelling protection for other targets or a lethal current hit.
   if(ctx.effectScope!=='target'||ctx.target!==viewer||targets.length!==1)return null;
   const hit=Math.max(knownTrickDamage(viewer,ctx),Number(record.root.baseDamage)||1);
   if(!(viewer.hp+(viewer.hujia||0)>hit)||!canSupplyTrickResponse(viewer,record.id==='nanman'?'sha':'shan',ctx))return null;
  }
  const kinds={juedou:'manual-friendly-duel',nanman:'manual-defendable-aoe',wanjian:'manual-defendable-aoe',tiesuo:'manual-link-plan',huogong:'manual-friendly-fire',guohe:'manual-friendly-removal',shunshou:'manual-friendly-transfer',jiedao:'manual-borrow-plan'};
  return {kind:kinds[record.id],provenance:'observed-host-use',respect:true};
 }catch(_){return null;}
}
