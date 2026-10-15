import { lib, game, get, _status } from '../../foundation/adapt/host.js?v=41a';
import { cfg } from '../../foundation/config/util.js?v=41a';
import { tacticalEnabled, fireUtility } from '../strategy/tacticalOptimization.js?v=41a';
import { dispositionOf } from '../relations/relations.js?v=41a';

export const WUXIE_OPTIMIZED_REQUEST = '__djscWuxieOptimized';
const supported = new Set(['wanjian','nanman','juedou','huogong','lebu','bingliang','shandian','guohe','shunshou','wuzhong','taoyuan','wugu']);
const clamp = (value, cap = 12) => Math.max(-cap, Math.min(cap, value));
function relation(player, target, context) {
 if (target === player) return 1;
 return typeof context.relationOf === 'function' ? context.relationOf(player, target) : dispositionOf(player, target);
}
function count(target) { return Math.max(0, Number(target?.countCards?.('h')) || 0); }
function skill(target, names) { return names.some(name => target?.hasSkill?.(name)); }
function canRespond(player, id, ctx) {
 try {
  const trigger = ctx.responseEvent;
  const parent = trigger?.getParent?.() || trigger?.parent;
  for (const event of [trigger, parent]) {
   const hit = event?.directHit;
   if (hit === true || hit?.includes?.(player) || hit?.has?.(player)) return false;
  }
  if (ctx.source?.hasSkillTag?.('directHit_ai', true, { target: player, card: ctx.card })) return false;
  const requirement = id === 'shan' ? 'shanRequired' : 'shaRequired';
  const required = Math.max(1, Number(trigger?.[requirement]) || 1,
   Number(parent?.customArgs?.[player.playerid]?.[requirement]) || 1);
  return player.getCards('h').filter(card => get.name(card, player) === id &&
   typeof lib.filter.cardRespondable === 'function' && lib.filter.cardRespondable(card, player)).length >= required;
 } catch (_) { return false; }
}
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
export function refinedWuxieEffect(player, ctx, context = {}) {
 const id = ctx.originalSpellId;
 if (!supported.has(id)) return null;
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
  } else if (['lebu','bingliang','shandian'].includes(id)) {
   const h = count(target);
   let magnitude = id === 'lebu' ? 2.6 + Math.min(8, h + 2) * 0.35 :
    id === 'bingliang' ? 3 + 2 / (h + 1) : 5;
   if (skill(target, ['guicai','guidao','huanshi','zhenyi'])) magnitude *= 0.7;
   if (h > 0 && skill(target, ['qiaobian','olqiaobian'])) magnitude *= 0.45;
   value -= rel * magnitude * (id === 'shandian' ? 0.4 : 0.75);
  } else if (id === 'taoyuan') {
   if (target.hp < target.maxHp) value += rel * (target.hp <= 1 ? 4.2 : 2);
  } else if (id === 'wuzhong') {
   value += rel * (1.8 + (count(target) <= 1 ? 1.8 : 0) + (target.hp <= 1 ? 0.8 : 0));
  } else if (id === 'wugu') {
   value += rel * (count(target) <= 1 || target.hp <= 1 ? 2.5 : 1.3);
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
   if (!active || !tacticalEnabled('wuxie') || cfg('responseAI', true) === false || request?.type !== 'wuxie' ||
    player === game.me && !_status.auto || player.isOnline2?.() || request[WUXIE_OPTIMIZED_REQUEST]) return;
   const decision = evaluate(player, request, { hostRequest: request });
   if (!decision?.resolved) return;
   if (tacticalEnabled('diagnostic')) {
    try { console.info('[无名AI·无懈优化]', { card: decision.originalSpellId, target: decision.target?.playerid, use: decision.use, score: decision.score, cost: decision.resourceCost }); } catch (_) {}
   }
   const native = typeof request.ai1 === 'function' ? request.ai1 : null;
   request.ai1 = function (item) {
    let current;
    try {
     const materialCost = wuxieMaterialCost(player, item);
     if (materialCost !== null) current = evaluate(player, request, { hostRequest: request, materialCost });
    } catch (_) {}
    if (!current?.resolved) return native ? native.apply(this, arguments) : 0;
    return current.use ? 1 + Math.max(0, current.score) : 0;
   };
   request[WUXIE_OPTIMIZED_REQUEST] = true;
 }
 const owned = function (...args) {
  try { prepare(this, args[0]); } catch (_) {}
  return original.apply(this, args);
 };
 proto.chooseToUse = owned;
 return () => { active = false; if (proto.chooseToUse === owned) proto.chooseToUse = original; };
}
