import { lib, game, get, _status } from '../../foundation/adapt/host.js?v=41a';
import {responseWindow} from './responseWindow.js?v=41a';
import { cfg } from '../../foundation/config/util.js?v=41a';
import { tacticalEnabled, tacticalSettingsSnapshot, fireUtility } from '../strategy/tacticalOptimization.js?v=41a';
import { dispositionOf } from '../relations/relations.js?v=41a';
import {beginChoiceAudit} from '../../perception/journal/choiceAudit.js?v=41a';
import {playerKey} from '../../foundation/adapt/playerIdentity.js?v=41a';
import {benefitTrickEffect} from './benefitTrickEffect.js?v=41a';
import {delayedStateImpact} from '../strategy/delayedOptimization.js?v=41a';
import {canSupplyTrickResponse} from './responseMaterials.js?v=41a';
import {getCurrentLinkedSet,scoreTiesuoAction} from '../cards/tiesuoEvaluator.js?v=41a';

export const WUXIE_OPTIMIZED_REQUEST = '__djscWuxieOptimized';
const supported = new Set(['wanjian','nanman','juedou','huogong','tiesuo','lebu','bingliang','shandian','guohe','shunshou','wuzhong','taoyuan','wugu']);
const clamp = (value, cap = 12) => Math.max(-cap, Math.min(cap, value));
function relation(player, target, context) {
 if (target === player) return 1;
 return typeof context.relationOf === 'function' ? context.relationOf(player, target) : dispositionOf(player, target);
}
function count(target) { return Math.max(0, Number(target?.countCards?.('h')) || 0); }
function skill(target, names) { return names.some(name => target?.hasSkill?.(name)); }
function canRespond(player,id,ctx){return canSupplyTrickResponse(player,id,ctx);}
function damageValue(player, target, ctx, context) {
 const rel = relation(player, target, context);
 if (!rel) return 0;
 let native = null;
 if (ctx.originalSpellId === 'huogong') native = fireUtility(ctx.source, target, player, ctx.card);
 if (!Number.isFinite(native)) {
  try { native = get.damageEffect(target, ctx.source, player, ctx.originalSpellId === 'huogong' ? 'fire' : ctx.card?.nature); }
  catch (_) { native = null; }
 }
 let value = Number.isFinite(native) ? clamp(native * 3) : -rel * 3;
 if (value === 0) return 0;
 const harmful = value * rel < 0;
 if (harmful && Number(target.hp) + (Number(target.hujia) || 0) <= 1) value += Math.sign(value) * 6;
 if (target === player && harmful) {
  const response = ctx.originalSpellId === 'wanjian' ? 'shan' : ctx.originalSpellId === 'nanman' ? 'sha' : null;
  if (response && canRespond(player, response, ctx)) return -0.8;
  if (ctx.originalSpellId === 'juedou' && ctx.source && count(ctx.source) === 0 &&
   !ctx.source.hasSkillTag?.('respondSha') && canRespond(player, 'sha', ctx)) return -0.8;
 }
 return clamp(value);
}

/* null means unsupported/ambiguous: leave the choice to the native AI. */
export function tiesuoWuxieEffect(player,ctx,context={}){
 if(!tacticalEnabled('tiesuo'))return null;
 const targets=ctx.effectScope==='all'?[...new Set(ctx.targets||[])]:ctx.target?[ctx.target]:[];
 const players=game.players||[];
 if(!targets.length||targets.some(t=>!players.includes(t)))return null;
 const delta=scoreTiesuoAction(player,{beforeLinked:getCurrentLinkedSet(players),targets},{...context,
  classicDoudizhu:get.mode?.()==='doudizhu'&&['normal','kaihei','huanle'].includes(_status.mode)});
 return {value:clamp(delta*3,24),scope:ctx.effectScope||'target'};
}
export function refinedWuxieEffect(player, ctx, context = {}) {
 const id = ctx.originalSpellId;
 if (!supported.has(id)) return null;
 if(['taoyuan','wuzhong','wugu'].includes(id))return benefitTrickEffect(player,ctx,(a,b)=>relation(a,b,context));
 if(id==='tiesuo')return tiesuoWuxieEffect(player,ctx,context);
 if (id === 'guohe' || id === 'shunshou') return { legacy: true };
 const targets = ctx.effectScope === 'all' ? [...new Set(ctx.targets || [])] :
  ctx.target ? [ctx.target] : id === 'wuzhong' && ctx.source ? [ctx.source] : [];
 if (!targets.length) return null;
 let value = 0;
 for (const target of targets) {
  const rel = relation(player, target, context);
  if (!rel) continue;
  if (['wanjian','nanman','juedou','huogong'].includes(id)) {
   value += damageValue(player, target, ctx, context);
  } else if (['lebu','bingliang'].includes(id)) {
   const plan=delayedStateImpact(ctx.source,target,id);if(!plan)return null;
   value-=rel*plan.utility*3;
  } else if(id==='shandian'){
   let effect;try{effect=get.effect(target,ctx.card||{name:id},ctx.source,player);}catch(_){return null;}
   if(!Number.isFinite(effect))return null;value+=effect*3;
  }
 }
 return { value: Math.round(clamp(value, 24) * 1000) / 1000, scope: ctx.effectScope || 'target' };
}

/* Exact material valuation only for own visible, statically known selections. */
export function wuxieMaterialCost(player, item) {
 try {
  const own = [...player.getCards('h'), ...player.getCards('e')];
  const value = cards => Math.max(0, (cards.reduce((sum, c) => sum + Math.max(0, Number(get.value(c, player)) || 0), 0) - 3) * 0.65);
  if (typeof item === 'object' && item) {
   if (Array.isArray(item.cards) && item.cards.length && item.cards.every(c => own.includes(c))) return value(item.cards);
   if (!own.includes(item)) return null;
   return item.name === 'wuxie' ? 0 : value([item]);
  }
  const info = typeof item === 'string' ? lib.skill?.[item] : null;
  if (!info || typeof info.viewAs === 'function') return null;
  const name = typeof info.viewAs === 'string' ? info.viewAs : info.viewAs?.name;
  if (name !== 'wuxie') return null;
  if (info.selectCard === 0) return 0;
  if (info.selectCard != null && info.selectCard !== 1 || typeof info.filterCard !== 'function' ||
   /selected\s*[.[]/.test(String(info.filterCard))) return null;
  const pool = player.getCards(info.position || 'h').filter(card => own.includes(card));
  const cards = pool.filter(card => info.filterCard(card, player, _status.event));
  return cards.length ? Math.min(...cards.map(c => value([c]))) : null;
 } catch (_) { return null; }
}

/* Narrow response bridge: no hard-override or UI-extension dependency. */
export function installWuxieOptimization(evaluate) {
 const proto = lib.element?.Player?.prototype, original = proto?.chooseToUse;
 if (typeof original !== 'function' || typeof evaluate !== 'function') return () => {};
 let active = true;
 function prepare(player, request) {
   const audit=request?.type==='wuxie'?beginChoiceAudit(tacticalEnabled('diagnostic'),player,request,'response',_status.event):null;
   if (!active || !tacticalEnabled('wuxie') || cfg('responseAI', true) === false || request?.type !== 'wuxie' ||
    player === game.me && !_status.auto || player.isOnline2?.() || request[WUXIE_OPTIMIZED_REQUEST]) {
    audit?.record('not-run',{reason:!active?'bridge-inactive':!tacticalEnabled('wuxie')?'optimization-off':cfg('responseAI',true)===false?'response-off':request[WUXIE_OPTIMIZED_REQUEST]?'already-prepared':'human-controlled'});
    return;
   }
   const lifetime=responseWindow(player,request);
   if(lifetime.reason())return;
   const decision = evaluate(player, request, { hostRequest: request });
   const facts=d=>({originalSpellId:d?.originalSpellId||null,sourceId:playerKey(d?.source),targetId:playerKey(d?.target),
    use:d?.use??null,score:d?.score??null,effectValue:d?.effectValue??null,resourceCost:d?.resourceCost??null,
    hostState:d?.hostState??null,playerIntentRespected:!!d?.playerIntentRespected,cooperativeIntent:d?.cooperativeIntent||null,
    effectBasis:d?.effectBasis||'unknown',reason:d?.reason||'unknown',executionState:'suggested'});
   audit?.record(decision?.resolved?'evaluated':'unresolved',{...facts(decision),
    settings:{tactical:tacticalSettingsSnapshot(),responseAI:cfg('responseAI',true)}});
   if (!decision?.resolved) return;
   if (tacticalEnabled('diagnostic')) {
    try { console.info('[无名AI·无懈优化]', { card: decision.originalSpellId, target: decision.target?.playerid, use: decision.use, score: decision.score, cost: decision.resourceCost }); } catch (_) {}
   }
   const native = typeof request.ai1 === 'function' ? request.ai1 : null;
   request.ai1 = function (item) {
    const unavailable=!active?'bridge-inactive':!tacticalEnabled('wuxie')?'optimization-off':cfg('responseAI',true)===false?'response-off':lifetime.reason();
    if(unavailable){
     const score=native?native.apply(this,arguments):0;
     audit?.record('native-fallback',{aiScore:Number.isFinite(score)?score:null,reason:unavailable,executionState:'suggested'});
     return score;
    }
    let current;
    try {
     const materialCost = wuxieMaterialCost(player, item);
     if (materialCost !== null) {const event=lifetime.event();current = evaluate(player,event,{hostRequest:event,materialCost});}
    } catch (_) {}
    if (!current?.resolved) {
     const score=native ? native.apply(this, arguments) : 0;
     audit?.record('native-fallback',{aiScore:Number.isFinite(score)?score:null,reason:'material-or-context-unresolved',executionState:'suggested'});
     return score;
    }
    const score=current.use ? 1 + Math.max(0, current.score) : 0;
    audit?.record('material-scored',{...facts(current),aiScore:score});
    return score;
   };
   request[WUXIE_OPTIMIZED_REQUEST] = true;
   return lifetime;
 }
 const owned = function (...args) {
  let lifetime;
  try { lifetime=prepare(this,args[0]); } catch (_) {}
  try{const event=original.apply(this,args);lifetime?.bind(event);return event;}
  catch(error){lifetime?.invalidate('host-choice-failed');throw error;}
 };
 proto.chooseToUse = owned;
 return () => { active = false; if (proto.chooseToUse === owned) proto.chooseToUse = original; };
}
