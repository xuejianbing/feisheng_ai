/*
 * ruleGate.js - 组合规则前置门（hard_force / soft_boost）
 *
 * 决策优先级（拍板版）：
 *   1. hard_force：规则命中且对应候选合法 → 直接强制该动作，跳过模型/规划器；
 *      但安全层（safety/aiOverride/rescue）仍有最终否决权。
 *   2. soft_boost：4 条低门控概率规则不覆盖模型，由现有 comboChain.js 的
 *      chainBonus 软加分实现（strip_sha / jue_lengtai / tiesuo_fire 已有）。
 *   3. 模型兜底：client_policy_model_v2（17 类），先 shadow 记录、默认不改分。
 *
 * 规则数据来自 comboRulesData.js（由 combo_rules.json 生成），本文件不写死规则。
 */
import { game, _status } from '../../foundation/adapt/host.js?v=41a';
import { cfg } from '../../foundation/config/util.js?v=41a';
import { isPlayerLinked } from '../state/playerState.js?v=41a';
import { isEnemyOf } from '../relations/relations.js?v=41a';
import { COMBO_RULES, HARD_FORCE_RULES } from './comboRulesData.js?v=41a';

const SHA_FAMILY = ['sha', 'huosha', 'leisha'];

/* ===== 本回合已用牌追踪（按玩家+回合号自动过期）===== */
const _turnUsed = new Map();   /* key(playerKey) -> {turn:Number, ids:[id,...]} */
function _playerKey(p) {
    try { return p && (p.playerid != null ? String(p.playerid) : String(p.name1 || p.name)); }
    catch (e) { return null; }
}
function _turnNo() {
    try { return Number(_status.phaseNumber || 0); } catch (e) { return 0; }
}
function _entry(p) {
    const k = _playerKey(p);
    if (!k) return null;
    let e = _turnUsed.get(k);
    const t = _turnNo();
    if (!e || e.turn !== t) { e = { turn: t, ids: [] }; _turnUsed.set(k, e); }
    return e;
}
/* 引擎提交出牌决策后调用，记录本回合已用牌 id */
export function recordUsed(p, id) {
    try {
        if (!p || !id) return 0;
        const e = _entry(p);
        if (!e.ids.includes(id)) e.ids.push(id);
        return e.ids.length;
    } catch (err) { return 0; }
}
export function usedThisTurn(p) {
    try { const e = _entry(p); return e ? e.ids.slice() : []; }
    catch (err) { return []; }
}
export function resetTurnState() { _turnUsed.clear(); }

/* ===== 局面读取 ===== */
function _handNames(me) {
    const out = {};
    try {
        const hand = me.getCards ? me.getCards('h') : [];
        hand.forEach(function (c) {
            const n = c && (c.name || c.cardname || '');
            if (n) out[n] = (out[n] || 0) + 1;
        });
    } catch (e) { /* 忽略 */ }
    return out;
}
function _shaCount(me) {
    try {
        if (me.countCards) return SHA_FAMILY.reduce(function (s, n) {
            return s + (n === 'sha' ? me.countCards('hs', 'sha') : 0);
        }, 0);
    } catch (e) { return 0; }
    return 0;
}
function _aliveEnemies(me) {
    const out = [];
    try {
        for (const p of (game.players || [])) {
            if (!p || p === me || p.alive === false) continue;
            if (isEnemyOf(me, p)) out.push(p);
        }
    } catch (e) { /* 忽略 */ }
    return out;
}

/* ===== token 判定 ===== */
export function evalToken(token, ctx) {
    const { me, hand, used } = ctx;
    try {
        const m = /^(\w+)_used$/.exec(token);
        if (m) return used.includes(m[1]);
        switch (token) {
            case 'sha_in_hand':
                return SHA_FAMILY.some(function (n) { return (hand[n] || 0) > 0; });
            case 'huogong_in_hand':
                return (hand['huogong'] || 0) > 0;
            case 'sha_count_ge_2':
                return _shaCount(me) >= 2;
            case 'enemy_hp_le_2':
                return _aliveEnemies(me).some(function (p) { return (p.hp || 0) <= 2; });
            case 'enemy_linked':
                return _aliveEnemies(me).some(function (p) { return isPlayerLinked(p); });
            case 'zhuge_equipped':
                return !!(me.getEquip && me.getEquip('zhuge'));
            default:
                return false;
        }
    } catch (e) { return false; }
}

/* ===== 规则 → 候选匹配 ===== */
function _actionMatches(action, a) {
    if (!a || a.type !== 'card') return false;
    const [kind, id] = String(action).split(':');
    if (kind !== 'card') return false;
    if (id === 'sha') return SHA_FAMILY.includes(a.id);
    return a.id === id;
}

/* ===== 强制门：返回 {rule, candidate} 或 null ===== */
export function hardForce(me, eligibleActs, ctx) {
    try {
        if (cfg('ruleGateHardForce', true) === false) return null;
        if (!me || !Array.isArray(eligibleActs) || !eligibleActs.length) return null;
        const hand = _handNames(me);
        const used = usedThisTurn(me);
        const c = Object.assign({ me: me, hand: hand, used: used }, ctx || {});
        const rules = HARD_FORCE_RULES.slice().sort(function (x, y) {
            return (y.priority || 0) - (x.priority || 0);
        });
        for (const r of rules) {
            const ok = (r.condition || []).every(function (t) { return evalToken(t, c); });
            if (!ok) continue;
            const cand = eligibleActs.find(function (a) {
                return _actionMatches(r.action, a) && (!a.target || a.targetList);
            });
            if (cand) {
                cand.forcedByRule = r.id;
                cand.ruleConfidence = r.confidence;
                return { rule: r, candidate: cand };
            }
        }
        return null;
    } catch (e) {
        try { if (window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } catch (_) {}
        return null;
    }
}

/* ===== 软加分层覆盖核对（实际加分由 comboChain.js 完成）===== */
export function softCoverage() {
    return COMBO_RULES.rules
        .filter(function (r) { return r.layer === 'soft_boost'; })
        .map(function (r) {
            return { id: r.id, client_chain: r.client_chain || null,
                client_bonus: r.client_bonus || null, confidence: r.confidence };
        });
}

/* ===== 统计/自检 ===== */
const stats = { hardForceHits: 0, lastHit: null, lastTurn: null };
export function noteHardForceHit(ruleId) {
    stats.hardForceHits++; stats.lastHit = ruleId; stats.lastTurn = _turnNo();
}
export function ruleGateStats() {
    return {
        ok: true,
        hard_force_rules: HARD_FORCE_RULES.map(function (r) { return r.id; }),
        soft_boost_rules: softCoverage(),
        usedCurrentTurn: usedThisTurn(_status.currentPhase || (game.me || null)),
        hits: stats,
    };
}
export function selfTest() {
    try {
        const errs = [];
        if (HARD_FORCE_RULES.length !== 2) errs.push('hard_force 必须 2 条，实际 ' + HARD_FORCE_RULES.length);
        if (COMBO_RULES.rules.length !== 6) errs.push('规则总数必须 6，实际 ' + COMBO_RULES.rules.length);
        const ids = HARD_FORCE_RULES.map(function (r) { return r.id; });
        if (!ids.includes('CR_jiu_sha') || !ids.includes('CR_zhuge_burst')) errs.push('hard_force 缺规则');
        const tok = {
            me: { getCards: function () { return []; }, countCards: function () { return 0; } },
            hand: {}, used: [],
        };
        if (evalToken('sha_in_hand', tok) !== false) errs.push('token 空态判定异常');
        if (typeof hardForce !== 'function') errs.push('hardForce 非函数');
        return { ok: errs.length === 0, msg: errs.length ? errs.join(';') : 'ruleGate 自检通过',
            data: { hard: ids, soft: softCoverage().map(function (r) { return r.id; }) } };
    } catch (e) {
        return { ok: false, msg: 'ruleGate 自检异常: ' + e, data: null };
    }
}

try {
    if (typeof window !== 'undefined') {
        window.__DJSC = window.__DJSC || {};
        window.__DJSC.ruleGate = {
            hardForce: hardForce,
            recordUsed: recordUsed,
            usedThisTurn: usedThisTurn,
            reset: resetTurnState,
            coverage: softCoverage,
            stats: ruleGateStats,
            selfTest: selfTest,
        };
    }
} catch (e) { /* 挂载失败不影响主流程 */ }

export default { hardForce: hardForce, recordUsed: recordUsed,
    usedThisTurn: usedThisTurn, resetTurnState: resetTurnState,
    softCoverage: softCoverage, stats: ruleGateStats, selfTest: selfTest };
