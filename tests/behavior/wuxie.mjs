/*
 * ============================================
 * // 作者：飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= Behavior Regression · 无懈可击（指令 03） =================
 * 唯一权威 wuxieEvaluator：ΔU 阈值决策 + 反无懈 parity + fail-open。
 * 拆队友负面判定区 = 帮队友（不无懈）；拆关键装备 = 保护（无懈）。
 */
import { ok, eq, loadScore, finish } from './_harness.mjs';

const fx = await loadScore('decision/response/wuxieEvaluator.js');

function mkP(name, rel, opts) {
    opts = opts || {};
    return {
        name: name, rel: rel,
        hp: opts.hp == null ? 4 : opts.hp, maxHp: 4,
        _h: opts.h == null ? 0 : opts.h,
        _e: opts.e || [], _j: opts.j || [],
        countCards: function (a) { return a === 'h' ? this._h : 0; },
        getCards: function (a) { return a === 'e' ? this._e : (a === 'j' ? this._j : []); },
    };
}
const relOf = function (mi, t) { return t.rel; };
const me = mkP('me', 1, { h: 3 });
const ally = mkP('ally', 1, { h: 2 });
const enemy = mkP('enemy', -1, { h: 2 });
const C = function (id) { return { name: id }; };

/* ---- context resolver ---- */
function trickEvent(cardName, src, tgt, parent) {
    return { name: cardName, _trigger: { card: { name: cardName }, player: src, target: tgt }, getParent: function () { return parent || null; } };
}
function respondEvent(parent) {
    return { name: 'chooseToRespond', _trigger: {}, card: null, getParent: function () { return parent || null; } };
}
{
    const ctx = fx.resolveWuxieContext(me, respondEvent(trickEvent('lebu', enemy, ally)), {});
    eq(ctx.resolved, true, 'lebu 场景可解析');
    eq(ctx.originalSpellId, 'lebu', '解析出原始锦囊 lebu');
    eq(ctx.target, ally, '解析出受害目标 ally');
    eq(ctx.chainDepth, 0, '无无懈链 depth=0');
}
{
    const lebuEv = trickEvent('lebu', enemy, ally);
    const w1 = trickEvent('wuxie', me, null, lebuEv);
    const w2 = trickEvent('wuxie', enemy, null, w1);
    const ctx = fx.resolveWuxieContext(me, respondEvent(w2), {});
    eq(ctx.originalSpellId, 'lebu', '反无懈链仍追到原始锦囊');
    eq(ctx.chainDepth, 2, '反无懈链 depth=2');
}
eq(fx.resolveWuxieContext(me, respondEvent(null), {}).resolved, false, '无法解析 → fail-open');

/* ---- relation-aware trick effect ---- */
const ectx = { relationOf: relOf };
function eff(player, id, tgt, src) {
    return fx.evaluateTrickEffect(player, { originalSpellId: id, target: tgt, source: src }, ectx);
}
ok(eff(me, 'lebu', me) < -5, '自己中乐 → 强负');
ok(eff(me, 'lebu', ally) < -4, '队友中乐 → 强负');
ok(eff(me, 'lebu', enemy) > 0, '敌人中乐 → 正（不无懈）');
ok(eff(me, 'guohe', mkP('judgeAlly', 1, { h: 0, j: [C('lebu')] })) > 0, '拆队友判定区乐 → 帮队友，不无懈');
ok(eff(me, 'shunshou', mkP('eqAlly', 1, { h: 0, e: [C('bagua')] })) < -3, '顺手关键装备 → 保护价值');

/* ---- 资源成本（soft，永不 veto） ---- */
const c1 = fx.estimateWuxieResourceCost(me, { wuxieCount: 1 });
const c2 = fx.estimateWuxieResourceCost(me, { wuxieCount: 2 });
ok(c2 < c1, '2 张无懈成本 < 最后 1 张');
ok(Number.isFinite(c1) && c1 > 0, '资源成本始终有限正数');

/* ---- evaluateWuxie 验收矩阵 ---- */
function dec(player, ctx) {
    return fx.evaluateWuxie(player, null, Object.assign({ relationOf: relOf, wuxieCount: 2 }, ctx || {}));
}
eq(dec(me, { originalSpellId: 'lebu', source: enemy, target: ally }).use, true, 'R1 敌人乐队友 → use');
eq(dec(me, { originalSpellId: 'lebu', source: enemy, target: ally, wuxieCount: 1 }).use, true, 'R12 最后一张无懈 + 队友乐 → 仍 use');
eq(dec(me, { originalSpellId: 'shunshou', source: enemy, target: mkP('lowAlly', 1, { h: 1 }), wuxieCount: 1 }).use, false, 'R3 顺手普通低价值队友 → hold');
eq(dec(me, { originalSpellId: 'shunshou', source: enemy, target: mkP('eqAlly', 1, { h: 0, e: [C('bagua')] }) }).use, true, 'R4 顺手关键装备 → use');
eq(dec(me, { originalSpellId: 'guohe', source: enemy, target: mkP('jAlly', 1, { h: 0, j: [C('lebu')] }) }).use, false, 'R6 拆判定区乐 → hold');
eq(dec(me, { originalSpellId: 'lebu', source: enemy, target: me, wuxieCount: 1 }).use, true, 'R8 自己中乐 → use');
eq(dec(me, { originalSpellId: 'lebu', source: enemy, target: mkP('enemy2', -1, { h: 2 }) }).use, false, 'R9 敌人对敌人乐 → hold');

/* ---- 反无懈 parity ---- */
{
    const base = { originalSpellId: 'lebu', source: enemy, target: ally, relationOf: relOf, wuxieCount: 2 };
    const p0 = fx.evaluateWuxie(me, null, Object.assign({}, base, { chainDepth: 0 }));
    const p1 = fx.evaluateWuxie(me, null, Object.assign({}, base, { chainDepth: 1 }));
    eq(p0.finalStateIfPass, 'resolve', 'depth0 → 原锦囊生效');
    eq(p1.finalStateIfPass, 'negate', 'depth1 → 原锦囊失效');
    eq(p0.use, true, 'depth0 有害锦囊 → use');
    eq(p1.use, false, 'depth1 原锦囊已被无懈 → hold');
}

/* ---- fail-open ---- */
eq(fx.evaluateWuxie(me, respondEvent(null), {}).use, null, '无法解析 → use=null');
eq(fx.shouldUseWuxie(me, respondEvent(null), {}), null, 'shouldUseWuxie → null');

finish('wuxie');