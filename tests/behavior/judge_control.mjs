/*
 * ============================================
 * // 作者：飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= Behavior Regression · 判定控制（Stage D：动作语义） =================
 * judgeBrain 判定区贴/拆决策 + relations「动作语义唯一源」：
 *   - 乐/兵贴敌人、闪电自用（无改判/血不安全不放）；
 *   - 「过河拆桥」「顺手牵羊」= dismantle（拆队友负面判定区 = 帮队友，正收益）；
 *   - judgeTarget 不再依赖无生产者的 drawDependency 死条件。
 */
import { ok, eq, getHost, loadScore, finish } from './_harness.mjs';

const jb = await loadScore('decision/basic/judgeBrain.js');
const rel = await loadScore('decision/relations/relations.js');

/* ---- 注入敌我关系：经 get.attitude（dispositionOf 同源基线） ---- */
const host = getHost();
host.get.attitude = function (me, t) { return t && t.rel ? t.rel : 0; };

/* ===== 判定分类 ===== */
eq(jb.classifyJudge('lebu'), '乐', 'lebu → 乐');
eq(jb.classifyJudge('bingliang'), '兵', 'bingliang → 兵');
eq(jb.classifyJudge('shandian'), '闪电', 'shandian → 闪电');

/* ===== 硬否决 ===== */
eq(jb.vetoJudge('lebu', { me: {}, target: { isAlly: true } }).veto, true, '乐贴队友 → 否决');
eq(jb.vetoJudge('lebu', { me: {}, target: { isAlly: false } }).veto, false, '乐贴敌人 → 放行');
eq(jb.vetoJudge('shandian', { me: { hp: 4 }, target: {}, hasRejudge: false }).veto, true, '闪电无改判 → 否决');
eq(jb.vetoJudge('shandian', { me: { hp: 3 }, target: {}, hasRejudge: true }).veto, false, '闪电有改判且血安全 → 放行');

/* ===== 目标选择（兵不再依赖 drawDependency 死条件） ===== */
{
    const targets = [
        { isAlly: true, threat: 99, handCount: 8 },
        { isAlly: false, threat: 1, handCount: 5, nextToAct: true },
        { isAlly: false, threat: 3, handCount: 0 },
    ];
    eq(jb.judgeTarget('lebu', { targets: targets }).index, 1, '乐目标：选非队友且条件最佳');
    eq(jb.judgeTarget('bingliang', { targets: targets }).index, 2, '兵目标：只看 threat（不读 drawDependency）');
    eq(jb.judgeTarget('shandian', { targets: targets }).index, 2, '闪电目标：按 threat+hp 评分');
}

/* ===== 动作语义唯一源（inferPurpose） ===== */
eq(rel.inferPurpose({ id: 'guohe' }), 'dismantle', '过河拆桥 → dismantle');
eq(rel.inferPurpose({ id: 'shunshou' }), 'dismantle', '顺手牵羊 → dismantle');
eq(rel.inferPurpose({ id: 'tiesuo' }), 'state', '铁索连环 → state');
eq(rel.inferPurpose({ id: 'lebu' }), 'control', '乐 → control');
eq(rel.inferPurpose({ id: 'shandian' }), 'generic', '闪电 → generic（自用，非 control）');
eq(rel.inferPurpose({ id: 'tao' }), 'heal', '桃 → heal');

/* ===== 拆除：状态转换效用（Stage D 核心反例） ===== */
const me = { name: 'me', rel: 1 };
const allyJudge = { name: 'allyJudge', rel: 1, getCards: function (z) { return z === 'j' ? [{ name: 'lebu' }] : []; } };
const allyClean = { name: 'allyClean', rel: 1, getCards: function () { return []; } };
const enemyLow = { name: 'enemyLow', rel: -1, hp: 1, getCards: function () { return []; } };

ok(rel.actionValue(me, { id: 'guohe', target: allyJudge, base: 0 }) > 0, '过河拆队友乐 → 正收益（帮队友解除负面状态）');
ok(rel.actionValue(me, { id: 'shunshou', target: allyJudge, base: 0 }) > 0, '顺手队友乐 → 正收益');
eq(rel.actionValue(me, { id: 'guohe', target: allyClean, base: 0 }), -8, '拆队友好牌 → 强罚');
ok(rel.actionValue(me, { id: 'guohe', target: enemyLow, base: 0 }) >= 0, '拆敌人 → 非负（含残血收割加成）');

/* 方向评分同口径 */
eq(rel.directionScore(me, { id: 'guohe' }, allyJudge), 1, 'directionScore 拆队友负面判定 → +1');
eq(rel.directionScore(me, { id: 'guohe' }, allyClean), -3, 'directionScore 拆队友好牌 → -3');

/* ===== 铁索 state：交回 tiesuoEvaluator，不再 relation-only 强罚 ===== */
eq(rel.actionValue(me, { id: 'tiesuo', target: { name: 'allyX', rel: 1 }, base: 5 }), 5, '铁索对队友 → 中性 base');
eq(rel.directionScore(me, { id: 'tiesuo' }, { name: 'allyX', rel: 1 }), 0, '铁索方向评分 → 0');

finish('judge_control');