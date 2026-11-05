/*
 * ============================================
 * // 作者：飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= Behavior Regression · 借刀杀人（pair-action） =================
 * Stage F：借刀收敛为 weaponHolder + victim 的 pair 动作（jiedaoEvaluator 唯一权威）。
 * jiedaoTiming 委托 evaluator：借敌刀杀敌 / 借友刀杀敌为正，无合法 pair 不用。
 */
import { ok, eq, getHost, loadScore, finish } from './_harness.mjs';

const jd = await loadScore('decision/timing/jiedaoTiming.js');
const je = await loadScore('decision/cards/jiedaoEvaluator.js');

/* ---- 注入敌我关系 / 装备子类型 / 玩家表 ---- */
const host = getHost();
host.get.attitude = function (me, t) { return t && t.rel ? t.rel : 0; };
host.get.subtypes = function (c) { return (c && c.subtypes) || []; };

const weapon = function (name) { return { name: name, subtypes: ['equip1'] }; };
const me = { name: 'me', rel: 1 };
const enemyTarget = { name: 'enemyTarget', rel: -1, alive: true, getCards: function (z) { return z === 'e' ? [weapon('qinglong')] : []; } };
const enemyOther = { name: 'enemyOther', rel: -1, alive: true, getCards: function () { return []; } };
const allyTarget = { name: 'allyTarget', rel: 1, alive: true, getCards: function (z) { return z === 'e' ? [weapon('zhuge')] : []; } };
const noWeapon = { name: 'noWeapon', rel: -1, alive: true, getCards: function () { return []; } };

host.game.players = [me, enemyTarget, enemyOther, allyTarget];

/* ---- 借刀时机 ---- */
eq(jd.jiedaoTiming(me, enemyTarget).use, true, '借敌人的刀打另一个敌人 → use');
eq(jd.jiedaoTiming(me, allyTarget).use, true, '借队友的刀打敌人 → use');
eq(jd.jiedaoTiming(me, noWeapon).use, false, '无武器 → 不用');
eq(jd.jiedaoTiming(me, { name: 'n', rel: 0, getCards: function () { return []; } }).use, false, '中性目标 → 不用');
eq(jd.jiedaoTiming(me, null).use, false, '目标缺失 → 不用');

/* ---- 借刀评分加成 ---- */
eq(jd.jiedaoBonus(me, { id: 'jiedao', target: enemyTarget }), 1.4, '指定持刀者且有效 → 1.4');
eq(jd.jiedaoBonus(me, { id: 'jiedao', target: noWeapon }), 1.4, '无武器 target 回退全局 pair（全场有持刀者）→ 1.4');
eq(jd.jiedaoBonus(me, { id: 'sha' }), 1.0, '非借刀 → 1.0');

/* ---- pair-action 唯一权威：weaponHolder + victim ---- */
eq(je.hasWeapon(enemyTarget), true, '有武器角色 → hasWeapon true');
eq(je.hasWeapon(enemyOther), false, '无武器角色 → hasWeapon false');

/* 借敌刀杀敌 → 正；借友刀杀敌 → 正 */
const pEE = je.evaluateJiedaoPair(me, enemyTarget, enemyOther);
eq(pEE.use, true, '借敌刀杀敌 → use（pair 合法）');
ok(pEE.score > 0, '借敌刀杀敌 → 正收益');

const pAE = je.evaluateJiedaoPair(me, allyTarget, enemyTarget);
eq(pAE.use, true, '借友刀杀敌 → use（pair 合法）');
ok(pAE.score > 0, '借友刀杀敌 → 正收益');

/* 持刀者无武器 / 被刀对象是队友 → 恒非法（负无穷，绝不选） */
eq(je.evaluateJiedaoPair(me, noWeapon, enemyOther).score, -Infinity, '持刀者无武器 → -Infinity');
eq(je.evaluateJiedaoPair(me, enemyTarget, allyTarget).score, -Infinity, '被刀对象是队友 → -Infinity');
eq(je.evaluateJiedaoPair(me, enemyTarget, enemyTarget).score, -Infinity, 'holder===victim → -Infinity');

/* 枚举与最优 pair */
const pairs = je.enumerateJiedaoPairs(me);
ok(pairs.length >= 2, '枚举出至少 2 个合法 pair（借敌刀/借友刀打敌）');
const bp = je.bestJiedaoPair(me);
eq(bp.use, true, '存在合法 pair → bestJiedaoPair.use true');
ok(bp.score >= pairs[0].score - 1e-9, 'bestJiedaoPair 取最高分 pair');

/* 全场无持刀者 → 借刀无合法 pair → 不借（0.6） */
host.game.players = [me, enemyOther, noWeapon];
eq(je.bestJiedaoPair(me).use, false, '全场无持刀者 → bestJiedaoPair.use false');
eq(jd.jiedaoBonus(me, { id: 'jiedao', target: noWeapon }), 0.6, '全场无持刀者 → 借刀加成 0.6');

finish('jiedao');