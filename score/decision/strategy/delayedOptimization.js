/* One policy for delayed control: public state only, no real-deck inspection. */
import {lib, game, get} from '../../foundation/adapt/host.js?v=5e5';
import {cfg} from '../../foundation/config/util.js?v=5e5';
import {dispositionOf} from '../relations/relations.js?v=5e5';
import {effectiveJudgeName} from './judgeName.js?v=5e5';

let delayedActive=false,delayedDiagnostics=false;
export function captureDelayedSettings(){
 delayedActive=!!cfg('tacticalOptimization',true)&&!!cfg('tacticalDelay',true);
 delayedDiagnostics=!!cfg('tacticalDiagnostics',false);
}
export function delayedOptimizationEnabled(){return delayedActive;}
function hasPublicSkill(p,ids){return ids.some(id=>p.hasSkill?.(id));}
function normalTurnDistance(p,t){
 const n=game.players.length;
 return n?((game.players.indexOf(t)-game.players.indexOf(p)+n)%n||n):1;
}
export function delayPlan(p,card,t,ignoreRange=false){
 if(!delayedActive||!p||!t||p===t)return null;
 try{
  const name=get.name(card,p);
  if(!['lebu','bingliang'].includes(name)||dispositionOf(p,t)>=0)return null;
  if(!lib.filter.cardEnabled(card,p)||!lib.filter.cardUsable(card,p)||!p.canUse(card,t,ignoreRange?false:undefined))return null;
  if(t.hasSkillTag?.('nojudge')||(t.getCards('j')||[]).some(c=>effectiveJudgeName(c)===name))return null;
  if(name==='bingliang'&&t.hasJudge?.('caomu'))return null;
  const hand=Math.max(0,t.countCards('h'));
  const skills=t.getSkills?.()||[];
  const activePlay=skills.some(id=>{
   const enable=lib.skill[id]?.enable;
   return enable==='phaseUse'||Array.isArray(enable)&&enable.includes('phaseUse');
  });
  // Neutral 3/4 failure prior. Skill adjustments are estimates, never known suits.
  let probability=0.75;
  if(hand>0&&hasPublicSkill(t,['guicai','reguicai','guidao','reguidao']))probability*=0.6;
  if(hasPublicSkill(t,['guanxing','reguanxing','xinfu_yizhi']))probability*=0.7;
  if(hand>0&&hasPublicSkill(t,['qiaobian','reqiaobian']))probability*=0.6;
  if(name==='lebu'&&hasPublicSkill(t,['hongyan','rehongyan']))probability*=2/3;
  let loss;
  if(name==='lebu'){
   // Even an empty hand normally receives cards before its play phase.
   loss=1.7+Math.min(8,hand+2)*0.35+(activePlay?0.8:0);
  }else{
   loss=1.8+2.2/(hand+1);
   // These are draw-phase skills: skipping that phase also removes their supply.
   if(hasPublicSkill(t,['yingzi','reyingzi','haoshi','shelie','tuxi','retuxi']))loss+=0.8;
   // End-phase supply remains available despite Bingliang.
   if(hasPublicSkill(t,['biyue','rebiyue']))loss*=0.75;
  }
  const timing=1+0.35/normalTurnDistance(p,t);
  const utility=Math.round(loss*probability*timing*100)/100;
  return {kind:name,utility,priority:Math.min(90,Math.round(40+utility*10)),reason:name==='lebu'?'限制出牌阶段':'限制摸牌补给'};
 }catch(_){return null;}
}
let checkingDelayedKill=false;
function immediateDelayedKill(p){
 if(checkingDelayedKill)return false;
 checkingDelayedKill=true;
 try{
  const slashes=(p.getCards('h')||[]).filter(c=>get.name(c,p)==='sha'&&lib.filter.cardEnabled(c,p)&&lib.filter.cardUsable(c,p));
  return game.players.some(t=>t!==p&&dispositionOf(p,t)<0&&t.hp<=1&&t.countCards('h')===0&&slashes.some(c=>p.canUse(c,t)&&get.effect(t,c,p,p)>0));
 }finally{checkingDelayedKill=false;}
}
export function delayCardOrder(p,card,original){
 if(!delayedActive)return original;
 try{
  if(immediateDelayedKill(p))return Math.min(original,2);
  const plans=game.players.map(t=>delayPlan(p,card,t)).filter(Boolean);
  if(!plans.length)return 0;
  const utility=Math.max(...plans.map(plan=>plan.utility));
  const order=Math.min(9.5,5+utility);
  if(delayedDiagnostics)console.info('[无名AI·打法优化] 贴兵贴乐',{card:get.name(card,p),utility,order});
  return order;
 }catch(_){return original;}
}
export function stripForDelayedPlan(p,strip,t,resolution=false){
 if(!delayedActive||!p||!t)return null;
 try{
  const stripName=get.name(strip,p);
  if(!['guohe','shunshou'].includes(stripName)||dispositionOf(p,t)>=0)return null;
  if(!resolution&&(!lib.filter.cardEnabled(strip,p)||!lib.filter.cardUsable(strip,p)||!p.canUse(strip,t)||immediateDelayedKill(p)))return null;
  const mount=t.getEquip(3),reduction=mount&&get.info(mount)?.distance?.globalTo;
  const selectable=stripName==='shunshou'?lib.filter.canBeGained:lib.filter.canBeDiscarded;
  if(!(reduction>0)||!selectable(mount,p,t)||get.value(mount,t)<=0||t.hasSkillTag?.('noe')||t.hasSkillTag?.('loseEquip'))return null;
  if(p.hasSkill?.('undist')||t.hasSkill?.('undist'))return null;
  for(const c of p.getCards('h')||[]){
   if(c===strip||strip.cards?.includes(c)||get.name(c,p)!=='bingliang'||p.canUse(c,t))continue;
   const plan=delayPlan(p,c,t,true),info=get.info(c);
   if(!plan||info?.outrange||!info?.range||typeof info.range!=='object'||Object.keys(info.range).some(k=>k!=='global'))continue;
   const mod=game.checkMod(c,p,t,'unchanged','targetInRange',p);
   if(typeof mod==='boolean')continue;
   const distance=Math.max(1,get.distance(p,t,'unchecked')-reduction)+(typeof mod==='number'?mod:0);
   if(distance<=info.range.global)return {kind:'mountForBing',card:mount,score:Math.min(9,5+plan.utility)};
  }
 }catch(_){}
 return null;
}
export function installDelayedBridges(){
 for(const name of ['lebu','bingliang']){
  const meta=lib.card[name]?.ai;
  if(!meta?.result||meta.result.target?.__djscDelayedBridge)continue;
  const target=meta.result.target,source=meta.result.player;
  const targetUse=meta.result.target_use?.__djscDelayedBridge?target:meta.result.target_use??target;
  const sourceUse=meta.result.player_use?.__djscDelayedBridge?source:meta.result.player_use??source;
  const nativeOrder=meta.order?.__djscDelayedBridge?(meta.basic?.order??meta.order.__djscDelayedOriginal):meta.order??meta.basic?.order??1;
  const wrapped=function(p,t,card,...args){
   if(delayedActive)return -(delayPlan(p,card||{name},t)?.utility||0);
   return typeof target==='function'?target.call(this,p,t,card,...args):target;
  };
  wrapped.__djscDelayedBridge=true;
  meta.result.target=wrapped;
  meta.result.player=function(...args){return delayedActive?0:typeof source==='function'?source.apply(this,args):source??0;};
  meta.result.target_use=function(p,t,card,...args){
   if(delayedActive)return -(delayPlan(p,card||{name},t)?.utility||0);
   return typeof targetUse==='function'?targetUse.call(this,p,t,card,...args):targetUse;
  };
  meta.result.player_use=function(...args){return delayedActive?0:typeof sourceUse==='function'?sourceUse.apply(this,args):sourceUse??0;};
  for(const key of ['player','target_use','player_use'])meta.result[key].__djscDelayedBridge=true;
  meta.order=function(card,p){
   if(delayedActive)return delayCardOrder(p,card||{name},1);
   return typeof nativeOrder==='function'?nativeOrder.call(this,card,p):nativeOrder;
  };
  meta.order.__djscDelayedBridge=true;
  meta.order.__djscDelayedOriginal=nativeOrder;
  if(delayedActive)delete lib.card[name].__djsc_override;
 }
}
