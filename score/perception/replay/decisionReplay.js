/*
 * ============================================
 * // الناشر: في شينغ الأصلي
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 决策回放 =================
 * 记录每次决策的完整链路：
 *   状态 → 候选 → 规则 → 模型 → 认知 → 冲突 → 总线 → 护栏 → 最终 → 结果
 * 存储：localStorage，最多 20 局 / 每局最多 50 条
 */
import { log } from '../../foundation/diag/logger.js';
import { safeGet as _lsGet, safeSet as _lsSet, safeRemove as _lsRemove } from '../../foundation/storage/storage.js';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */
// Autore: Feisheng Originale | Licenza: GPL-3.0

const STORE_KEY = 'djsc_replay_v1';
const MAX_GAMES = 20;
const MAX_PER_GAME = 50;

let STORE = { v: 1, games: [] };
let _loaded = false;
let _currentBuffer = [];
let _currentMeta = null;

function _load() {
    try {
        if (_loaded) return;
        const raw = _lsGet(STORE_KEY);
        if (raw) {
            const obj = JSON.parse(raw);
            if (obj && obj.v === 1 && Array.isArray(obj.games)) STORE = obj;
        }
        _loaded = true;
    } catch (e) { _loaded = true; }
}
function _save() {
    try {
        while (STORE.games.length > MAX_GAMES) STORE.games.shift();
        _lsSet(STORE_KEY, JSON.stringify(STORE));
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export function replayStartGame(meta) {
    try {
        _load();
        _currentBuffer = [];
        _pendingOutcomes = [];
        if (_outcomeTimer) { clearTimeout(_outcomeTimer); _outcomeTimer = null; }
        _currentMeta = Object.assign({
            ts: Date.now(), mode: 'unknown', playerCount: 0,
            meKey: '?', myIdentity: null,
        }, meta || {});
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export function replayRecord(entry) {
    try {
        if (!entry) return;
        const compact = {
            ts: Date.now(),
            round: entry.round || 0,
            player: entry.player || '?',
            state: entry.state ? {
                hp: entry.state.hp, maxHp: entry.state.maxHp,
                hand: entry.state.hand, equip: entry.state.equip,
                alive: entry.state.alive, enemies: entry.state.enemies, allies: entry.state.allies,
            } : null,
            candidates: (entry.candidates || []).slice(0, 6).map(function (c) {
                return {
                    type: c.type, id: c.id, target: c.target || null,
                    score: Math.round((c.score || 0) * 10) / 10,
                    reason: (c.reason || '').slice(0, 60),
                    policy: c.policy ? {
                        eligible: c.policy.eligible !== false,
                        veto: c.policy.veto === true,
                        vetoReason: (c.policy.vetoReason || '').slice(0, 80),
                        priorityTier: c.policy.priorityTier || 'normal',
                        priorityValue: Number(c.policy.priorityValue || 0),
                        priorityReason: (c.policy.priorityReason || '').slice(0, 80),
                    } : null,
                };
            }),
            rule: entry.rule ? {
                type: entry.rule.type, id: entry.rule.id,
                score: Math.round((entry.rule.score || 0) * 10) / 10,
                target: entry.rule.target || null,
                reason: (entry.rule.reason || '').slice(0, 180),
                policy: entry.rule.policy || null,
            } : null,
            model: entry.model ? {
                label: entry.model.label,
                confidence: Math.round((entry.model.confidence || 0) * 100) / 100,
            } : null,
            meta: entry.meta ? {
                familiarity: Math.round((entry.meta.familiarity || 0) * 100) / 100,
                modulator: Math.round((entry.meta.modulator || 0) * 100) / 100,
                level: entry.meta.level,
            } : null,
            intervention: entry.intervention || null,
            conflict: entry.conflict ? {
                detected: !!entry.conflict.detected,
                ruleLabel: entry.conflict.ruleLabel,
                modelLabel: entry.conflict.modelLabel,
            } : null,
            bus: entry.bus ? {
                winner: entry.bus.winner,
                reason: (entry.bus.reason || '').slice(0, 60),
            } : null,
            guard: entry.guard ? {
                blocked: !!entry.guard.blocked,
                rule: entry.guard.rule || null,
                reason: (entry.guard.reason || '').slice(0, 60),
            } : null,
            final: entry.final ? {
                type: entry.final.type, id: entry.final.id,
                score: Math.round((entry.final.score || 0) * 10) / 10,
                target: entry.final.target || null,
                reason: (entry.final.reason || '').slice(0, 180),
                policy: entry.final.policy || null,
            } : null,
            outcome: null,
        };
        _currentBuffer.push(compact);
        while (_currentBuffer.length > MAX_PER_GAME) _currentBuffer.shift();

        /* ★ 节流：把"记录 outcome"合并成单个定时器批量处理，不再每个决策都 setTimeout */
        if (entry.me) {
            _pendingOutcomes.push({ compact: compact, me: entry.me, entry: entry });
            if (_outcomeTimer) clearTimeout(_outcomeTimer);
            _outcomeTimer = setTimeout(_flushOutcomes, 1500);
        }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 收集待回填 outcome 的条目，统一在 1.5s 后一批回填（最多每 1.5s 跑一次） */
let _pendingOutcomes = [];
let _outcomeTimer = null;
function _flushOutcomes() {
    _outcomeTimer = null;
    if (!_pendingOutcomes.length) return;
    const batch = _pendingOutcomes;
    _pendingOutcomes = [];
    try {
        for (let k = 0; k < batch.length; k++) {
            const item = batch[k];
            const me = item.me;
            item.compact.outcome = {
                meHp: me ? (me.hp || 0) : 0,
                meHand: me && me.countCards ? me.countCards('h') : 0,
                scoreDelta: _scoreDelta(item.entry),
            };
        }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

function _scoreDelta(entry) {
    try {
        const rd = window.__DJSC && window.__DJSC.getRound ? window.__DJSC.getRound() : {};
        return rd[entry.player] || 0;
    } catch (e) { return 0; }
}

export function replaySettleGame(outcome) {
    try {
        _load();
        if (!_currentBuffer.length) return;
        const record = {
            meta: Object.assign({}, _currentMeta || {}, {
                endTs: Date.now(),
                decisions: _currentBuffer.length,
                verdict: (outcome && outcome.verdict) || 'unknown',
                myScore: (outcome && outcome.myScore) || 0,
            }),
            decisions: _currentBuffer.slice(),
        };
        STORE.games.push(record);
        _save();
        log.info('replay', '本局决策已归档：' + _currentBuffer.length + ' 条');
        _currentBuffer = [];
        _currentMeta = null;
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export function replayListGames() {
    _load();
    return STORE.games.slice().reverse().map(function (g, i) {
        return {
            idx: STORE.games.length - 1 - i,
            ts: g.meta.ts,
            endTs: g.meta.endTs,
            mode: g.meta.mode,
            me: g.meta.meKey,
            identity: g.meta.myIdentity,
            decisions: g.meta.decisions,
            verdict: g.meta.verdict,
            myScore: g.meta.myScore,
        };
    });
}

export function replayGetGame(idx) {
    _load();
    return STORE.games[idx] || null;
}

export function replayGetCurrentBuffer() {
    return _currentBuffer.slice();
}

export function replayStats() {
    _load();
    let totalDecisions = 0;
    let byIntervention = { model: 0, blend: 0, rule: 0, skip: 0, none: 0 };
    let blocked = 0, conflicts = 0, busArbitrations = 0;
    STORE.games.forEach(function (g) {
        g.decisions.forEach(function (d) {
            totalDecisions++;
            if (d.intervention) byIntervention[d.intervention] = (byIntervention[d.intervention] || 0) + 1;
            else byIntervention.none++;
            if (d.guard && d.guard.blocked) blocked++;
            if (d.conflict && d.conflict.detected) conflicts++;
            if (d.bus) busArbitrations++;
        });
    });
    /* ★ 本局进行中的决策也计入统计（否则游戏中打开面板恒 0，看起来像没接数据） */
    const currentCount = _currentBuffer.length;
    let curByInt = { model: 0, blend: 0, rule: 0, skip: 0, none: 0 };
    let curBlocked = 0, curConflicts = 0, curBus = 0;
    _currentBuffer.forEach(function (d) {
        if (d.intervention) curByInt[d.intervention] = (curByInt[d.intervention] || 0) + 1;
        else curByInt.none++;
        if (d.guard && d.guard.blocked) curBlocked++;
        if (d.conflict && d.conflict.detected) curConflicts++;
        if (d.bus) curBus++;
    });
    return {
        games: STORE.games.length,
        decisions: totalDecisions,
        byIntervention: byIntervention,
        blocked: blocked,
        conflicts: conflicts,
        busArbitrations: busArbitrations,
        /* ★ 本局实时统计（面板在游戏中也有数据） */
        currentDecisions: currentCount,
        currentByIntervention: curByInt,
        currentBlocked: curBlocked,
        currentConflicts: curConflicts,
        currentBus: curBus,
    };
}

export function replayReset() {
    _load();
    STORE = { v: 1, games: [] };
    _currentBuffer = [];
    _currentMeta = null;
    _pendingOutcomes = [];
    if (_outcomeTimer) { clearTimeout(_outcomeTimer); _outcomeTimer = null; }
    try { _lsRemove(STORE_KEY); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    log.info('replay', '决策回放已清空');
}

export function replayExportJson() {
    _load();
    return JSON.stringify(STORE, null, 2);
}

if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.replay = {
        start: replayStartGame,
        record: replayRecord,
        settle: replaySettleGame,
        listGames: replayListGames,
        getGame: replayGetGame,
        current: replayGetCurrentBuffer,
        stats: replayStats,
        reset: replayReset,
        export: replayExportJson,
    };
}
_load();
