/*
 * ============================================
 * // 作者：飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= Behavior Regression · 回合一致性（指令 04） =================
 * 唯一权威 turnStrategicState：先贴乐/兵 → 后过河/顺手拆同一目标时自我抵消降权。
 * penalty 永远是 soft opportunity cost；provenance 只活本回合，不跨回合污染。
 */
import { ok, eq, getHost, loadScore, finish } from './_harness.mjs';

const tss = await loadScore('decision/state/turnStrategicState.js');

function mkP(name, rel, opts) {
    opts = opts || {};
    return {
        name: name, rel: rel, alive: true,
        hp: opts.hp == null ? 4 : opts.hp, maxHp: 4,
        _h: opts.h == null ? 2 : opts.h, _j: opts.j || [],
        countCards: function (a) { return a === 'h' ? this._h : 0; },
        getCards: function (a) { return a === 'j' ? this._j : []; },
    };
}
const C = function (id) { return { name: id }; };
const rctx = { relationOf: function (mi, t) { return t.rel; } };
const me = mkP('me', 1, { h: 3 });

/* ---- 导出齐全 ---- */
['getJudgeCardNames', 'hasDelayedControl', 'delayedControlIdsIn',
 'evaluateDestroyPenalty', 'selfCreatedDestructionPenalty',
 'recordControlState', 'recordSelfCreatedControl', 'getControlRecords', 'clearTurnState'].forEach(function (fn) {
    eq(typeof tss[fn], 'function', '导出 ' + fn);
});

/* ---- Judge-zone 读取同族 ---- */
eq(tss.hasDelayedControl(mkP('e', -1, { j: [C('lebu')] })), true, '判定区乐 → hasDelayedControl');
eq(tss.hasDelayedControl(mkP('e', -1, { j: [C('shandian')] })), true, '判定区闪电 → 同族');
eq(tss.hasDelayedControl(mkP('e', -1, { j: [] })), false, '无判定牌 → false');

/* ---- 自我抵消惩罚方向（敌我感知） ---- */
ok(tss.selfCreatedDestructionPenalty(me, mkP('eLebu', -1, { j: [C('lebu')] }), rctx) > 0, '敌方判定区乐 → 降权（拆掉=损失）');
ok(tss.selfCreatedDestructionPenalty(me, mkP('allyLebu', 1, { j: [C('lebu')] }), rctx) < 0, '队友判定区乐 → 负惩罚（鼓励解除）');
eq(tss.selfCreatedDestructionPenalty(me, mkP('eNo', -1, { j: [] }), rctx), 0, '无判定区延时 → penalty=0');

/* ---- provenance 生命周期 ---- */
tss.clearTurnState();
const eP = mkP('eP', -1, { j: [C('lebu')] });
tss.recordControlState(me, eP, 'lebu');
eq(tss.getControlRecords().length, 1, 'recordControlState 写入 provenance');
{
    const dp = tss.evaluateDestroyPenalty(me, eP, rctx);
    eq(dp.selfCreated, true, '已记录的敌方乐标记 selfCreated');
    ok(dp.penalty > 0, '已记录且仍生效 → 惩罚生效');
}
/* 牌离开判定区 → penalty=0 */
eP._j.length = 0;
eq(tss.selfCreatedDestructionPenalty(me, eP, rctx), 0, '控制牌离开判定区 → penalty=0');
eP._j.push(C('lebu'));
/* 目标死亡 → penalty=0 */
eP.alive = false;
eq(tss.selfCreatedDestructionPenalty(me, eP, rctx), 0, '目标阵亡 → penalty=0');
eP.alive = true;

/* ---- recordSelfCreatedControl：仅乐/兵命中时记录 ---- */
tss.clearTurnState();
const eR = mkP('eR', -1, { j: [] });
getHost().game.players = [me, eR];
tss.recordSelfCreatedControl(me, { rule: 'guohe', strat: 'useCardAfter', target: 'eR' }, eR);
eq(tss.getControlRecords().length, 0, '非乐/兵动作 → 不记录 provenance');
tss.recordSelfCreatedControl(me, { rule: 'lebu', strat: 'useCardAfter', target: 'eR' }, eR);
eq(tss.getControlRecords().length, 1, '使用乐命中目标 → 记录 provenance');
tss.clearTurnState();

finish('turn_consistency');