/*
 * ============================================
 * // 作者：飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= Behavior Regression · 铁索连环（指令 02） =================
 * 唯一权威 tiesuoEvaluator：全局横置集合 toggle 的状态转换优化，
 * 而非「一张能选两个敌人的普通锦囊」。纯模拟、绝不修改真实 Player。
 */
import { ok, eq, loadScore, finish } from './_harness.mjs';

const ps = await loadScore('decision/state/playerState.js');
const ev = await loadScore('decision/cards/tiesuoEvaluator.js');

/* ---- 横置读取唯一入口 ---- */
eq(ps.isPlayerLinked({ isLinked: function () { return true; } }), true, 'isLinked()===true → true');
eq(ps.isPlayerLinked({ isLinked: function () { return false; } }), false, 'isLinked()===false → false');
eq(ps.isPlayerLinked({}), false, '无 isLinked → false');
eq(ps.isPlayerLinked({ isLinked: true }), true, 'legacy 布尔字段 → true');

function mkP(name, linked) { return { name: name, hp: 4, maxHp: 4, isLinked: function () { return !!linked; } }; }
const me = mkP('me', false);
const A = mkP('A', true);
const E1 = mkP('E1', true);
const E2 = mkP('E2', false);
const all = [me, A, E1, E2];

/* ---- 纯模拟器 ---- */
const S = ev.getCurrentLinkedSet(all);
eq(S.size, 2, '当前横置集合 size=2');
eq(S.has(A) && S.has(E1), true, '集合含 A、E1');
const a1 = ev.toggleLinkedSet(S, [E2]);
eq(a1.has(E2), true, '单目标未横置 → 横置');
eq(a1.size, 3, 'toggle 后 size=3');
const a2 = ev.toggleLinkedSet(S, [A]);
eq(a2.has(A), false, '单目标已横置 → 解除');
eq(S.size, 2, '模拟不修改输入 beforeSet');
eq(A.isLinked(), true, '模拟不修改真实 Player（A 仍横置）');

/* ---- 动作枚举 ---- */
const cands = [A, E1, E2];
const acts = ev.generateTiesuoActions(me, { name: 'tiesuo' }, cands, { canRecast: true });
eq(acts.filter(function (x) { return x.type === 'recast'; }).length, 1, '可重铸 → 恰含 1 个 RECAST');
eq(acts.filter(function (x) { return x.type === 'use' && x.targets.length === 1; }).length, 3, '3 个单目标');
eq(acts.filter(function (x) { return x.type === 'use' && x.targets.length === 2; }).length, 3, '3 个双目标');
eq(acts.length, 7, '总候选 = 1 + 3 + 3');
eq(ev.generateTiesuoActions(me, { name: 'tiesuo' }, cands, { canRecast: false }).length, 6, '不可重铸 → 无 RECAST');

/* ---- 状态 utility（关系注入 +1 ally / -1 enemy / 0 neutral） ---- */
function P(name, rel, hp) {
    return { name: name, rel: rel, hp: hp == null ? 4 : hp, maxHp: 4, isLinked: function () { return false; } };
}
const ctx = { relationOf: function (mi, t) { return t.rel; } };
const meU = P('me', 1);
const E = P('E', -1), E_low = P('E_low', -1, 1);
const AU = P('A', 1), N = P('N', 0);

const uNone = ev.evaluateLinkedState(meU, null, new Set(), ctx);
eq(uNone, 0, '空横置集合 U=0');
const uE = ev.evaluateLinkedState(meU, null, new Set([E]), ctx);
ok(uE > uNone, 'enemy linked > enemy unlinked');
const uA = ev.evaluateLinkedState(meU, null, new Set([AU]), ctx);
ok(uA < 0 && uA < uNone, 'ally linked < ally unlinked');
ok(ev.evaluateLinkedState(meU, null, new Set([E_low]), ctx) > uE, 'enemy low HP linked 增益更高');
ok(Math.abs(ev.evaluateLinkedState(meU, null, new Set([N]), ctx)) < Math.abs(uE), 'neutral 不被当成明确 enemy');

/* ---- 动作 delta ---- */
const E1d = P('E1d', -1), E2d = P('E2d', -1), A1d = P('A1d', 1);
function mk(targets, before) {
    return { type: 'use', targets: targets, beforeLinked: before, afterLinked: ev.toggleLinkedSet(before, targets) };
}
const before = new Set([E1d]);
ok(ev.scoreTiesuoAction(meU, mk([E2d], before), ctx) > 0, '链新敌人 → 正');
const dRe = ev.scoreTiesuoAction(meU, mk([E1d], before), ctx);
ok(dRe < 0, '已 linked 敌人再次被选 → 解链（降分）');
ok(ev.scoreTiesuoAction(meU, mk([A1d], new Set([A1d])), ctx) > 0, '解除 linked 队友 → 正');

/* ---- 重铸门槛 + 主入口 ---- */
ok(ev.estimateTiesuoRecastValue(meU, {}) > 0, 'recast 基准为正');
eq(ev.estimateTiesuoRecastValue(meU, { recastValue: 3 }), 3, 'recastValue 可覆写');
eq(ev.tiesuoUseThreshold(1.2, {}), 2.5, '默认 use threshold = 1.2 + 1.3');
eq(ev.tiesuoUtilityToEngineRaw(1.2), 3, 'recast utility 1.2 → engine raw 3');
eq(ev.tiesuoUtilityToEngineRaw(4), 10, '双目标 utility 4 → engine raw 10');

/* 普通单敌 ΔU=2，不足 2.5 门槛 → 重铸 */
const singleNormal = P('E_single', -1);
const resSingle = ev.evaluateTiesuoActions(meU, { name: 'tiesuo' }, {
    candidates: [singleNormal],
    players: [singleNormal],
    relationOf: function (mi, t) { return t.rel; },
});
eq(resSingle.bestAction.type, 'recast', '普通单敌 → 收益不足门槛，重铸');

/* 两个普通敌人总 ΔU=4，超过门槛 → 双目标 use */
const res = ev.evaluateTiesuoActions(meU, { name: 'tiesuo' }, {
    candidates: [P('E_a', -1), P('E_b', -1), P('A_a', 1)],
    players: all,
    relationOf: function (mi, t) { return t.rel; },
});
eq(res.bestAction.type, 'use', '双敌人局面 → 超过门槛，选 use');
eq(res.bestAction.targets.length, 2, '双敌人局面 → 优先双目标');

finish('tiesuo');