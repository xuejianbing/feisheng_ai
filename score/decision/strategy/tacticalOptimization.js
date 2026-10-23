import {identityHostEffect,identityHostDamageEffect,identityHostAttitude} from '../../perception/observer/identityDiagnostics.js?v=41a';
/* Experimental AI-only policies. Configuration is captured once per game. */
import {lib, game, get, ui, _status} from '../../foundation/adapt/host.js?v=41a';
import {cfg} from '../../foundation/config/util.js?v=41a';
import {dispositionOf} from '../relations/relations.js?v=41a';
import {effectiveJudgeName} from './judgeName.js?v=41a';
import {captureDelayedSettings, delayedOptimizationEnabled, installDelayedBridges, stripForDelayedPlan} from './delayedOptimization.js?v=41a';
import {beginChoiceAudit} from '../../perception/journal/choiceAudit.js?v=41a';
import {resetCooperativeTrickIntents} from '../state/cooperativeTrickIntent.js?v=41a';
import {relayArmorPlan} from '../modes/versus/seatTacticsRuntime.js?v=41a';
import {readVersusMode} from '../../foundation/runtime/versusContext.js?v=41a';
import {configureFriendlyStrip,friendlyStripPlan,selectableStrip} from './friendlyStripPlan.js?v=41a';
let active = {enabled:false, fire:false, guding:false, diagnostic:false};
export function captureTacticalSettings(){
 resetCooperativeTrickIntents();
 captureDelayedSettings();
 active={enabled:!!cfg('tacticalOptimization',true),fire:!!cfg('tacticalFire',true),tiesuo:!!cfg('tacticalTiesuo',true),wuxie:!!cfg('tacticalWuxie',true),guding:!!cfg('tacticalGuding',true),wine:!!cfg('tacticalWine',true),strip:!!cfg('tacticalStrip',true),rescue:!!cfg('tacticalJudgeRescue',true),crossbow:!!cfg('tacticalCrossbow',true),diagnostic:!!cfg('tacticalDiagnostics',false)};
 configureFriendlyStrip(active);
}
export function tacticalEnabled(kind){return active.enabled && active[kind];}
export function tacticalSettingsSnapshot(){return {...active,delay:delayedOptimizationEnabled()};}
function trace(kind,value){if(active.diagnostic)console.info('[无名AI·打法优化]',kind,value);}
function handOf(p){return p.getCards('h')||[];}
function canPay(p,target,card,suit){
 const own=handOf(p).filter(c=>c!==card && !(card?.cards||[]).includes(c) && get.value(c,p)<6.2+Math.min(4,p.hp) && (!lib.filter.cardDiscardable || lib.filter.cardDiscardable(c,p,'huogong')));
 // Only our own hand or the suit actually revealed by Fire Attack is used.
 if(suit)return own.some(c=>get.suit(c,p)===suit && (!lib.filter.cardDiscardable || lib.filter.cardDiscardable(c,p,'huogong')));
 if(target===p)return own.length>0;
 return own.length>0;
}
export function fireUtility(source,target,viewer,card,suit){
 if(!tacticalEnabled('fire')||!source||!target)return null;
 try{
  if(source===viewer&&!canPay(source,target,card,suit))return 0;
  // Native damageEffect already includes elemental chain propagation and skill effects.
  const value=identityHostDamageEffect(target,source,viewer,'fire');
  return Number.isFinite(value)?value:null;
 }catch(_){return null;}
}
export function fireDiscardScore(p,target,card,suit){
 const benefit=fireUtility(p,target,p,null,suit);if(benefit===null)return null;
 if(benefit<=0)return -1;
 const score=6.2+Math.min(4,p.hp)-get.value(card,p);trace('火攻弃牌',{benefit,score});return score;
}
export function weaponOrder(p,card,original){
 if(!tacticalEnabled('guding')||!p||!card||typeof original!=='number')return original;
 try{
  const name=get.name(card,p);if(!['guding','jiu'].includes(name))return original;
  if(!lib.filter.cardEnabled(card,p)||!lib.filter.cardUsable(card,p))return original;
  const hand=handOf(p),blade=p.getEquip(1);
  const attacks=hand.filter(c=>get.name(c,p)==='sha' && lib.filter.cardEnabled(c,p)&&lib.filter.cardUsable(c,p));
  if(!attacks.length)return original;
  // Conservative: do not replace another weapon. Do not speculate about future range.
  if(name==='guding'&&blade)return original;
  if(name==='jiu'&&(!blade||get.name(blade,p)!=='guding'))return original;
  const target=game.players.find(t=>t!==p&&identityHostAttitude(p,t)<0&&t.countCards('h')===0&&attacks.some(c=>p.canUse(c,t)&&identityHostEffect(t,c,p,p)>0));
  if(!target)return original;
  // Wine is only promoted if it can help secure a low-HP target; avoid wasting it on overkill.
  if(name==='jiu'&&(target.hp<=2||target.hp>3||p.hasSkillTag('jiuSustain')))return original;
  const result=Math.max(original,name==='guding'?15:14);trace('古锭刀顺序',{card:name,order:result});return result;
 }catch(_){return original;}
}

let evaluatingStrip=false;
function availableSlashes(p,trick){
 // Only the actor's own hand is inspected. A converted trick may consume a Sha.
 return handOf(p).filter(c=>c!==trick&&!(trick?.cards||[]).includes(c)&&get.name(c,p)==='sha'&&lib.filter.cardEnabled(c,p)&&lib.filter.cardUsable(c,p));
}
function profitableEquipLoss(p,t,c){
 if(!c||get.value(c,t)<=0||t.hasSkillTag?.('noe')||t.hasSkillTag?.('loseEquip'))return false;
 return !(get.name(c,t)==='baiyin'&&t.hp<t.maxHp);
}
function attackDistanceWithoutMount(p,t,mount){
 // inRange applies skill distance mods before public equipment distances.
 if(!p.getVCards||!t.getVCards)return get.distance(p,t,'attack')-get.info(mount).distance.globalTo;
 let distance=get.distance(p,t,'raw');
 for(const [type,owner] of [['globalFrom',p],['globalTo',t],['attackFrom',p],['attackTo',t]])distance=game.checkMod(p,t,distance,type,owner);
 const available=c=>!c.cards?.some(part=>ui?.selected?.cards?.includes(part));
 for(const c of p.getVCards('e',available))distance+=get.info(c)?.distance?.globalFrom||0;
 for(const c of t.getVCards('e',available)){
  if(c===mount||c.cards?.includes(mount))continue;
  const d=get.info(c)?.distance;
  distance+=(d?.globalTo||0)+(d?.attackTo||0);
 }
 return distance;
}
function reachesAfterMount(p,t,slash,mount){
 // Match native Sha's inRange rule without detaching real equipment.
 if(!p.canUse(slash,t,false)||p.hasSkill?.('undist')||t.hasSkill?.('undist'))return false;
 const info=get.info(slash),range=info?.range||{attack:1};
 if(info?.outrange)return false;
 const mod=game.checkMod(slash,p,t,'unchanged','targetInRange',p);
 if(typeof mod==='boolean')return mod;
 const reduction=get.info(mount)?.distance?.globalTo;
 const attackRange=p.getAttackRange();
 if(typeof range==='function'){
  // Only use Sha's range path; unrelated custom card range functions are left alone.
  if(range!==lib.card.sha?.range||get.name(slash,p)!=='sha'||!(reduction>0)||attackRange<1)return false;
  for(const [type,owner] of [['inRange',p],['inRangeOf',t]]){
   const override=game.checkMod(p,t,'unchanged',type,owner);
   if(override!=='unchanged')return !!override;
  }
  return attackDistanceWithoutMount(p,t,mount)<=attackRange;
 }
 if(typeof range!=='object'||Object.keys(range).some(k=>k!=='attack')||!Number.isFinite(range.attack))return false;
 return reduction>0&&attackRange>0&&get.distance(p,t)-reduction+(typeof mod==='number'?mod:0)-attackRange<range.attack;
}
function nativeStripPositive(p,t,card){
 evaluatingStrip=true;
 try{return identityHostEffect(t,card,p,p)>0;}finally{evaluatingStrip=false;}
}
function immediateLethal(p,slashes){
 // 尚未得到宿主死亡确认；2v2不能因一血空手就跳过拆防/队友救援。
 if(readVersusMode().is2v2)return false;
 return game.players.some(t=>t!==p&&dispositionOf(p,t)<0&&t.hp<=1&&t.countCards('h')===0&&slashes.some(c=>p.canUse(c,t)&&identityHostEffect(t,c,p,p)>0));
}
export function stripPlan(p,card,t,resolution=false){
 if(!active.enabled||evaluatingStrip||!p||!t||p===t)return null;
 try{
  const name=get.name(card,p);
  if(!['guohe','shunshou'].includes(name))return null;
  if(!resolution&&(!lib.filter.cardEnabled(card,p)||!lib.filter.cardUsable(card,p)||!p.canUse(card,t)))return null;
  const relation=dispositionOf(p,t);
  if(relation===0)return null;
  const slashes=availableSlashes(p,card);
  if(relation>0){
   // Ordering still leaves an immediately available low-risk kill to native AI.
   if(!resolution&&immediateLethal(p,slashes))return null;
   return friendlyStripPlan(p,card,t);
  }
  const delayedStrip=stripForDelayedPlan(p,card,t,resolution);
  if(!active.strip&&!delayedStrip)return null;
  if(!resolution&&!nativeStripPositive(p,t,card))return null;
  if(delayedStrip)return delayedStrip;
  // 接力防具选择沿用同一 effect/按钮运输；不叠加第二份拆防具收益。
  const relay=active.strip?relayArmorPlan(p,card,t):null;
  if(!slashes.length)return relay;
  const useful=slashes.filter(c=>p.canUse(c,t,false)&&identityHostEffect(t,c,p,p)>0);
  if(!useful.length)return relay;
  const reachable=useful.some(c=>p.canUse(c,t));
  const mount=t.getEquip(3);
  if(mount&&selectableStrip(p,t,mount,name)&&profitableEquipLoss(p,t,mount)&&
   (reachable||useful.some(c=>reachesAfterMount(p,t,c,mount))))return {kind:'mount',card:mount,score:reachable?7:9};
  if(!reachable)return relay;
  const armor=t.getEquip(2);
  const ignoresArmor=t.hasSkillTag?.('unequip2')||useful.every(c=>p.hasSkillTag?.('unequip',false,{name:get.name(c,p),target:t,card:c})||p.hasSkillTag?.('unequip_ai',false,{name:get.name(c,p),target:t,card:c}));
  if(armor&&!ignoresArmor&&selectableStrip(p,t,armor,name)&&profitableEquipLoss(p,t,armor))return {kind:'armor',card:armor,score:6};
  const handCount=t.countCards('h');
  const canSelectHand=name==='shunshou'?t.countGainableCards?.(p,'h'):t.countDiscardableCards?.(p,'h');
  if(handCount===1&&canSelectHand!==0)return {kind:'hand',position:'h',score:4};
  return relay;
 }catch(_){}
 return null;
}
export function installStripButtonBridges(){
 for(const name of ['guohe','shunshou']){
  const info=lib.card[name];if(!info?.ai||typeof info.ai.button!=='function'||info.ai.button.__djscStripBridge)continue;
  const original=info.ai.button;
  const wrapped=function(button,...args){
   let audit=null;
   const scored=(score,planKind=null)=>{audit?.record('candidate-scored',{cardId:name,planKind,aiScore:Number.isFinite(score)?score:null,executionState:'suggested',selectionConfirmed:false});return score;};
   try{
    const event=get.event(),p=event.player,t=event.target;
    audit=beginChoiceAudit(tacticalEnabled('diagnostic'),p,event,'strip-selection');
    const plan=stripPlan(p,{name},t,true),c=button.link;
    if(plan&&selectableStrip(p,t,c,name)){
     const position=get.position(c);
     if(plan.kind==='rescue'){
      if(position==='j'&&['lebu','bingliang'].includes(effectiveJudgeName(c)))return scored(c===plan.card?30:29,plan.kind);
      return scored(-20,plan.kind);
     }
     if(c===plan.card||(plan.position==='h'&&position==='h')){trace('拆顺选牌',{kind:plan.kind});return scored(30,plan.kind);}
     return scored(-1,plan.kind);
    }
   }catch(_){}
   return scored(original.call(this,button,...args));
  };
  wrapped.__djscStripBridge=true;
  info.ai.button=wrapped;
 }
}

export function extraCardOrder(p,card,original){
 if(!active.enabled || !p || !card || typeof original!=='number')return original;
 try{
  if(!lib.filter.cardEnabled(card,p)||!lib.filter.cardUsable(card,p))return original;
  const name=get.name(card,p),hand=handOf(p),weapon=p.getEquip(1);
  const slashes=hand.filter(c=>get.name(c,p)==='sha'&&lib.filter.cardEnabled(c,p));
  const enemies=game.players.filter(t=>t!==p&&identityHostAttitude(p,t)<0);
  const attackable=t=>slashes.some(c=>lib.filter.cardUsable(c,p)&&p.canUse(c,t)&&identityHostEffect(t,c,p,p)>0);
  if(active.wine&&name==='jiu'&&!p.hasSkillTag('jiuSustain')){
   // Only promote an immediately useful strike against a publicly empty hand.
   const base=weapon&&get.name(weapon,p)==='guding'?2:1;
   if(enemies.some(t=>t.countCards('h')===0&&t.hp===base+1&&attackable(t))){trace('酒杀时机',{order:14});return Math.max(original,14);}
  }
  if(['guohe','shunshou'].includes(name)){
   // 队友接力只是机会，不使用“自己已有后续杀”的 order=13 强顺序。
   const plan=game.players.map(t=>stripPlan(p,card,t)).filter(plan=>plan&&plan.kind!=='relay-armor').sort((a,b)=>b.score-a.score)[0];
   if(plan){trace('拆顺顺序',{kind:plan.kind,order:13});return Math.max(original,13);}
  }
  if(active.crossbow&&name==='zhuge'&&!weapon&&slashes.length>=2){
   // canUse's third argument false would ignore range, not the Sha count.
   if(enemies.some(t=>slashes.filter(c=>p.canUse(c,t)&&identityHostEffect(t,c,p,p)>0).length>=2)){
    trace('连弩先于多杀',{order:15});return Math.max(original,15);
   }
  }
 }catch(_){}
 return original;
}

export function installTacticalOptimization(){
 const id='_djsc_tacticalOptimization';
 lib.skill[id]={charlotte:true,silent:true,forced:true,popup:false,priority:-100,trigger:{global:'gameStart'},filter:(e,p)=>p===game.me,
  // Async event content preserves module helpers; StepCompiler rebuilds normal functions.
  content:async()=>{captureTacticalSettings();installStripButtonBridges();installDelayedBridges();},
  mod:{aiOrder:(p,c,n)=>{
   const value=extraCardOrder(p,c,weaponOrder(p,c,n));
   try{if(tacticalEnabled('diagnostic'))beginChoiceAudit(true,p,_status.event,'card-order')?.record('order-scored',{
    cardId:get.name(c,p),before:Number.isFinite(n)?n:null,after:Number.isFinite(value)?value:null,executionState:'suggested'});}catch(_){}
   return value;
  }},
  ai:{effect:{player(card,p,target){
   if(['guohe','shunshou'].includes(get.name(card,p))){
    const plan=stripPlan(p,card,target);
    if(plan)return [1,plan.score/5,1,0];
    return;
   }
   if(get.name(card,p)!=='huogong')return;
   const u=fireUtility(p,target,p,card);if(u===null)return;
   if(u<=0){trace('火攻否决',{utility:u});return 'zeroplayertarget';}
   // Positive self attack must retain the host's chain calculation, rather than double-count it.
  }}}
 };
 game.addGlobalSkill(id);
 installStripButtonBridges();
 installDelayedBridges();
 const info=lib.card.huogong;if(!info||info.__djsc_tacticalContent)return;
 info.__djsc_tacticalContent=info.content;
 info.content=async function(event,trigger,player){
  if(tacticalEnabled('fire') && event.target===player && !player.isOnline2?.() && (player!==game.me || _status.auto) && !event.chooseToShow && !event.filterShow && !event.showPosition){
   event.chooseToShow=async(e,p,t)=>{
    const cards=handOf(p).filter(c=>get.value(c,p)<6.2+Math.min(4,p.hp)&&(!lib.filter.cardDiscardable||lib.filter.cardDiscardable(c,p,'huogong')));
    const card=cards.sort((a,b)=>get.value(a,p)-get.value(b,p))[0];
    const result=card?{bool:true,cards:[card]}:{bool:true,cards:handOf(p).slice(0,1)};
    beginChoiceAudit(tacticalEnabled('diagnostic'),p,e,'fire-selection')?.record('show-selected',{selection:'show',bool:result.bool,cardCount:result.cards.length,executionState:'selection-returned'});
    return result;
   };
  }
  if(tacticalEnabled('fire')&&!event.chooseToDiscard){
   event.chooseToDiscard=async(e,p,t)=>{
    const suit=get.suit(e.cards2[0]);
    const audit=beginChoiceAudit(tacticalEnabled('diagnostic'),p,e,'fire-selection');
    const result=await p.chooseToDiscard(e.discardPosition??'h',e.filterDiscard??{suit}).set('ai',c=>{
     const score=fireDiscardScore(p,t,c,suit)??-1;
     audit?.record('discard-scored',{aiScore:score,executionState:'suggested'});
     return score;
    }).set('prompt',false).forResult();
    audit?.record('discard-returned',{bool:result?.bool??null,cardCount:result?.cards?.length??null,executionState:'selection-returned'});
    return result;
   };
  }
  return await info.__djsc_tacticalContent.call(this,event,trigger,player);
 };
}
