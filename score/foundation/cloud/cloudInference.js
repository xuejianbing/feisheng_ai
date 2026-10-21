/*
 * cloudInference.js — 云端推理通道（v3 混合引擎客户端）
 * ----------------------------------------------------------------------------
 * 作用：在本地 AI 决策（bestAction，同步）的基础上，接入云端 v3「硬规则前置 + LGBM 兜底」
 *       推理服务 POST {BASE}/api/v1/predict。
 *
 * 同步决策 / 异步网络的矛盾处理：
 *   - 无名杀的 bestAction 是纯同步函数，无法在决策点 await fetch。
 *   - 故采用「决策点 fire-and-forget 预取 + 按局面 stateKey 缓存 + 后续同步决策消费」：
 *       primeCloudDecision(stateKey, features, legalActions)：异步发起，不阻塞、不抛错。
 *       consumeCloudAction(stateKey, legalActions)：同步读取缓存；命中且动作合法才接管，
 *         未命中 / 超时 / legacy_fallback / 弃权 / 动作不在合法集合 → 一律返回 null，本地决策照常。
 *   - 同一出牌窗口内 bestAction 会被多次调用（filterUse/filterTarget 等），首次预取、后续接管；
 *     天然 fail-open，任何云端故障都不会卡死或改变本地可用性。
 *
 * 接口契约（与 Cloud_Inference_Server_v3.py 对齐）：
 *   请求：POST {BASE}/api/v1/predict
 *         Header  Authorization: Bearer noname_ai_2026_secret_key
 *                 Content-Type: application/json
 *         Body    { "features": [142 维 int 数组], "legal_actions": ["type:id", ...] }
 *   响应：200 { execute_action_id, source: hard_rule|model|engine_fallback|legacy_fallback,
 *               confidence, critic, abstain }
 *         400 维度非法（150 实验体）；130/134 旧客户端返回 200 + source=legacy_fallback。
 *
 * 所有阈值/开关/端点均为软指标（cfg 可覆盖），不硬编码死值。
 * 提供 stats / health / selfTest，接入自检面板（reg.bind('cloudInference', ...)）。
 */

import { cfg } from '../config/util.js?v=41a';
import { log } from '../diag/logger.js?v=41a';

/* ---------------- 软指标默认值（均可被 cfg 覆盖） ---------------- */
const DEFAULT_BASE_URL = 'http://192.168.8.252:8000'; /* 后端局域网地址；公网需另开隧道，可用 cfg('cloudInferenceUrl') 覆盖 */
const PREDICT_PATH = '/api/v1/predict';
const AUTH_TOKEN = 'noname_ai_2026_secret_key';
const DEFAULT_TIMEOUT_MS = 1200;   /* 单次请求超时：必须远小于玩家可感知卡顿；超时即回退本地 */
const DEFAULT_TTL_MS = 4000;       /* 云端建议缓存有效期：仅同一局面（stateKey）且合法集合一致时可用 */
const DEFAULT_MAX_LEGAL = 64;      /* legal_actions 上报上限，防止超大请求体 */
const CACHE_LIMIT = 64;            /* 缓存局面上限，防止 Map 无限增长 */

/* stateKey -> { at, actionId, source, confidence, critic, legalSig } */
let _cache = new Map();
/* stateKey -> true，进行中的请求，防止同一局面重复发请求 */
let _inflight = new Map();

const stats = {
    enabled: true,
    requests: 0,        /* 发起的云端请求数 */
    ok: 0,              /* 收到并采纳进缓存的有效响应数 */
    hardRule: 0,        /* 其中 source=hard_rule */
    model: 0,           /* 其中 source=model */
    consumed: 0,        /* 实际被同步决策接管的次数 */
    miss: 0,            /* 消费时未命中（正常，回退本地） */
    legacy: 0,          /* 服务端要求升级（legacy_fallback） */
    abstain: 0,         /* 引擎弃权（engine_fallback / abstain） */
    timeout: 0,
    rejected: 0,        /* HTTP 400 等被拒 */
    error: 0,
    notLegal: 0,        /* 服务端返回动作不在合法集合（二次防御） */
    lastError: null,
    lastConsumeAt: 0,
};

function _cfgNum(key, fallback) {
    try { const v = Number(cfg(key, fallback)); return Number.isFinite(v) && v > 0 ? v : fallback; }
    catch (e) { return fallback; }
}
function _enabled() { try { return cfg('cloudInference', true) !== false; } catch (e) { return true; } }
function _baseUrl() { try { return String(cfg('cloudInferenceUrl', DEFAULT_BASE_URL) || DEFAULT_BASE_URL).replace(/\/+$/, ''); } catch (e) { return DEFAULT_BASE_URL; } }
function _timeoutMs() { return _cfgNum('cloudInferenceTimeoutMs', DEFAULT_TIMEOUT_MS); }
function _ttlMs() { return _cfgNum('cloudInferenceTtlMs', DEFAULT_TTL_MS); }
function _maxLegal() { return _cfgNum('cloudInferenceMaxLegal', DEFAULT_MAX_LEGAL); }

/* ---------------- 动作对象 <-> 云端 action_id 映射 ----------------
 * 候选动作 a 的结构：{ type: 'card'|'skill'|'equip'|'end', id: 'sha'|'tao'|... }
 * 云端 action_id 约定为 "type:id"（如 card:sha、skill:xxx、end:end）。 */
export function actionIdOf(a) {
    if (!a || !a.type) return null;
    return a.type + ':' + (a.id == null ? '' : a.id);
}

/* 从候选动作数组提取去重、限量的合法 action_id 列表 */
export function legalActionIdsOf(acts) {
    const seen = new Set();
    const out = [];
    const limit = _maxLegal();
    for (const a of acts || []) {
        const id = actionIdOf(a);
        if (id && !seen.has(id)) { seen.add(id); out.push(id); if (out.length >= limit) break; }
    }
    return out;
}

function _legalSig(legal) { return (legal || []).slice().sort().join('|'); }

function _trimCache() {
    if (_cache.size <= CACHE_LIMIT) return;
    const sorted = Array.from(_cache.keys());
    while (_cache.size > CACHE_LIMIT) _cache.delete(sorted.shift());
}

/* ---------------- 异步预取（不阻塞决策，失败只记统计） ---------------- */
export function primeCloudDecision(stateKey, features, legalActions) {
    try {
        if (!_enabled()) return { primed: false, reason: 'disabled' };
        if (!stateKey || !features || !features.length) return { primed: false, reason: 'bad-input' };
        const legal = Array.isArray(legalActions) ? legalActions.slice() : legalActionIdsOf(legalActions);
        if (!legal.length) return { primed: false, reason: 'no-legal' };

        const sig = _legalSig(legal);
        const cached = _cache.get(stateKey);
        if (cached && cached.legalSig === sig && Date.now() - cached.at < _ttlMs()) {
            return { primed: false, reason: 'cached' };
        }
        if (_inflight.has(stateKey)) return { primed: false, reason: 'inflight' };

        _inflight.set(stateKey, true);
        stats.requests++;

        const ctrl = new AbortController();
        const timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, _timeoutMs());

        fetch(_baseUrl() + PREDICT_PATH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AUTH_TOKEN },
            body: JSON.stringify({ features: Array.from(features), legal_actions: legal }),
            signal: ctrl.signal,
        }).then(function (res) {
            clearTimeout(timer);
            if (res.status === 400) { stats.rejected++; stats.lastError = 'http400'; return null; }
            if (!res.ok) { stats.lastError = 'http' + res.status; return null; }
            return res.json().catch(function () { stats.lastError = 'bad-json'; return null; });
        }).then(function (data) {
            if (!data) return;
            const src = data.source || 'model';
            /* 旧客户端提示升级 / 引擎弃权：这两类响应 execute_action_id 本就为 null，须先于空值判断 */
            if (src === 'legacy_fallback') { stats.legacy++; return; }
            if (src === 'engine_fallback' || data.abstain) { stats.abstain++; return; }
            const aid = data.execute_action_id;
            if (!aid) { stats.lastError = 'empty-action'; return; }
            /* 客户端二次防御：服务端返回的动作必须在本次合法集合内 */
            if (legal.indexOf(aid) < 0) { stats.notLegal++; stats.lastError = 'action-not-legal:' + aid; return; }
            _cache.set(stateKey, {
                at: Date.now(),
                actionId: aid,
                source: src,
                confidence: Number(data.confidence) || 0,
                critic: (data.critic == null ? null : Number(data.critic)),
                legalSig: sig,
            });
            _trimCache();
            stats.ok++;
            if (src === 'hard_rule') stats.hardRule++; else stats.model++;
        }).catch(function (err) {
            clearTimeout(timer);
            if (err && err.name === 'AbortError') { stats.timeout++; stats.lastError = 'timeout'; }
            else { stats.error++; stats.lastError = String(err); }
        }).finally(function () {
            try { _inflight.delete(stateKey); } catch (e) {}
        });

        return { primed: true };
    } catch (e) {
        stats.error++; stats.lastError = String(e);
        try { _inflight.delete(stateKey); } catch (_) {}
        return { primed: false, reason: 'exception' };
    }
}

/* ---------------- 同步消费（命中且合法才接管，否则 null=回退本地） ---------------- */
export function consumeCloudAction(stateKey, legalActions) {
    try {
        if (!_enabled() || !stateKey) return null;
        const legal = Array.isArray(legalActions) ? legalActions.slice() : legalActionIdsOf(legalActions);
        const c = _cache.get(stateKey);
        if (!c) { stats.miss++; return null; }
        if (Date.now() - c.at > _ttlMs()) { _cache.delete(stateKey); stats.miss++; return null; }
        if (c.legalSig !== _legalSig(legal)) { stats.miss++; return null; }
        if (legal.indexOf(c.actionId) < 0) { stats.notLegal++; return null; }
        stats.consumed++;
        stats.lastConsumeAt = Date.now();
        return {
            actionId: c.actionId,
            source: c.source,
            confidence: c.confidence,
            critic: c.critic,
        };
    } catch (e) {
        return null;
    }
}

/* ---------------- 自检 / 统计 / 复位 ---------------- */
export function cloudInferenceStats() {
    return {
        ok: true,
        enabled: _enabled(),
        baseUrl: _baseUrl(),
        cacheSize: _cache.size,
        inflight: _inflight.size,
        lastError: stats.lastError,
        counters: {
            requests: stats.requests, ok: stats.ok, hardRule: stats.hardRule, model: stats.model,
            consumed: stats.consumed, miss: stats.miss, legacy: stats.legacy, abstain: stats.abstain,
            timeout: stats.timeout, rejected: stats.rejected, error: stats.error, notLegal: stats.notLegal,
            lastConsumeAt: stats.lastConsumeAt,
        },
    };
}

/* 通道 fail-open：云端不可用不影响本地决策，故 health 恒为 ready，仅暴露故障计数 */
export function cloudInferenceHealth() {
    const s = cloudInferenceStats();
    return {
        ok: true,
        status: s.enabled ? 'ready' : 'disabled',
        msg: s.enabled ? ('云端推理通道待命，端点 ' + s.baseUrl + '，未命中自动回退本地') : '云端推理已通过 cfg 关闭',
        data: s,
    };
}

export function cloudInferenceSelfTest() {
    try {
        /* 纯逻辑自检：动作映射 + 合法集合签名 + 缓存命中/过期/非法 三条路径，不发真实网络 */
        const id = actionIdOf({ type: 'card', id: 'sha' });
        const mapOk = id === 'card:sha';
        const legals = legalActionIdsOf([{ type: 'card', id: 'sha' }, { type: 'card', id: 'sha' }, { type: 'end', id: 'end' }]);
        const legalOk = legals.length === 2 && legals[0] === 'card:sha' && legals[1] === 'end:end';
        const sk = '__selftest__' + Date.now();
        _cache.set(sk, { at: Date.now(), actionId: 'card:sha', source: 'hard_rule', confidence: 0.98, critic: 0, legalSig: _legalSig(['card:sha']) });
        const hit = consumeCloudAction(sk, ['card:sha']);
        const hitOk = !!(hit && hit.actionId === 'card:sha' && hit.source === 'hard_rule');
        const illegal = consumeCloudAction(sk, ['card:tao']);
        const illegalOk = illegal === null;
        _cache.delete(sk);
        const ok = mapOk && legalOk && hitOk && illegalOk;
        return {
            ok: ok,
            status: ok ? 'pass' : 'fail',
            msg: ok ? 'cloudInference 动作映射/合法校验/缓存消费 自检通过' : 'cloudInference 自检失败',
            data: { mapOk: mapOk, legalOk: legalOk, hitOk: hitOk, illegalOk: illegalOk },
        };
    } catch (e) {
        return { ok: false, status: 'fail', msg: 'cloudInference 自检异常: ' + String(e) };
    }
}

export function resetCloudInference() {
    _cache.clear();
    _inflight.clear();
    stats.requests = 0; stats.ok = 0; stats.hardRule = 0; stats.model = 0; stats.consumed = 0;
    stats.miss = 0; stats.legacy = 0; stats.abstain = 0; stats.timeout = 0; stats.rejected = 0;
    stats.error = 0; stats.notLegal = 0; stats.lastError = null; stats.lastConsumeAt = 0;
    return { ok: true, msg: 'cloudInference 缓存与统计已复位' };
}

/* 命令入口（供面板 / __DJSC.cloudInference.cmd 调用） */
export const cloudInferenceCmd = {
    stats: cloudInferenceStats,
    health: cloudInferenceHealth,
    selfTest: cloudInferenceSelfTest,
    reset: resetCloudInference,
    prime: primeCloudDecision,
    consume: consumeCloudAction,
    actionIdOf: actionIdOf,
    legalActionIdsOf: legalActionIdsOf,
    help: function () {
        return 'cloudInference: stats / health / selfTest / reset / prime(stateKey,features,legal) / consume(stateKey,legal)。'
            + '同步决策异步预取云端，未命中或故障自动回退本地；cfg(cloudInference,false) 可关闭。';
    },
};
