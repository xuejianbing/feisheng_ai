/*
 * ============================================
 * // 作者：飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= Behavior Regression · 桃救援（指令 01） =================
 * 唯一权威 evaluateTaoRescue：修复「敌方濒死误出桃」。
 * 不变量：self→allow、ally→allow、neutral→block、enemy→block、invalid→block；
 *         relation 解析失败 → 非 self 一律 fail-closed (block)，self 仍 allow。
 * 「濒死」只提升紧急度，绝不反转关系方向。
 */
import { ok, eq, loadScore, finish } from './_harness.mjs';

const rp = await loadScore('decision/safety/rescuePolicy.js');

const me = { name: 'me', hp: 1 };
const target = { name: 't', hp: 0 };

function ev(player, tgt, ctx) {
    try { return rp.evaluateTaoRescue(player, tgt, ctx) || {}; }
    catch (e) { return { allow: false, reason: 'threw:' + e.message }; }
}

/* ---- 关系矩阵 ---- */
const self = ev(me, me, {});
eq(self.allow, true, '自救 allow（target===player 特判）');
eq(self.relation, 'self', '自救 relation=self');
eq(self.score, 8, '自救 score=+8');

const ally = ev(me, target, { disposition: 1 });
eq(ally.allow, true, '友方濒死 allow');
eq(ally.relation, 'ally', '友方 relation=ally');
eq(ally.score, 5, '友方 score=+5');

const enemy = ev(me, target, { disposition: -1 });
eq(enemy.allow, false, '敌方濒死 block');
eq(enemy.relation, 'enemy', '敌方 relation=enemy');
eq(enemy.score, -8, '敌方 score=-8');

const neutral = ev(me, target, { disposition: 0 });
eq(neutral.allow, false, '中性濒死 block');
eq(neutral.relation, 'neutral', '中性 relation=neutral');
eq(neutral.score, -3, '中性 score=-3');

/* ---- invalid / missing target ---- */
const inv = ev(me, null, {});
eq(inv.allow, false, 'target 缺失 → block');
eq(inv.score, -8, 'invalid score=-8');
ok(String(inv.reason || '').indexOf('invalid') >= 0, 'invalid reason 含 invalid');

/* ---- relation API 失败 → 非 self fail-closed ---- */
const throwRel = { dispositionOf: function () { throw new Error('boom'); } };
const failCtx = { relations: throwRel, attitude: function () { return null; } };
eq(ev(me, target, failCtx).allow, false, 'relation 失败 → 非 self block（fail-closed）');
eq(ev(me, me, failCtx).allow, true, 'relation 失败时 self 仍 allow');

/* ---- attitude fallback ---- */
eq(ev(me, target, { attitude: function () { return -5; } }).allow, false, 'attitude<0 回退 → block');
eq(ev(me, target, { attitude: function () { return 3; } }).allow, true, 'attitude>0 回退 → allow');

/* ---- 濒死不反转关系方向（残敌仍是敌，不因 hp=0 变友） ---- */
eq(ev(me, { name: 'dying_enemy', hp: 0 }, { disposition: -1 }).allow, false, '濒死敌人仍 block（数量/紧急度不反转方向）');
eq(ev(me, { name: 'dying_ally', hp: 0 }, { disposition: 1 }).allow, true, '濒死队友仍 allow');

/* ---- 数量不改变方向 ---- */
eq(ev(me, target, { disposition: -1, taoCount: 1 }).allow, false, '1 桃敌方仍 block');
eq(ev(me, target, { disposition: -1, taoCount: 3 }).allow, false, '多桃敌方仍 block');

finish('tao_rescue');