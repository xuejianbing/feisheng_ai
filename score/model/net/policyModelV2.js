/*
 * policyModelV2.js - 17 类槽位策略模型（client_policy_model_v2）适配层
 *
 * 优先级定位：hard_force / soft_boost 都未命中时的"模型兜底"。
 * 现实指标（已验证）：demo 按局切分 Top-1 65.4% / Top-5 97.5%；
 *   真实对局域外 Top-1 约 31%（域漂移）。因此默认 mode='shadow'：
 *   只记录模型判断与引擎最终选择的一致性，不改候选分；
 *   连续 3 天真实域外影子数据追平/超越线上 base 后，才允许 cfg 切 'active'。
 *
 * 性能：7.14MB 模型用动态 import 懒加载（扩展启动时不解析/编译，不卡游戏主线程）；
 *   首次决策时才在后台加载；单次预测实测约 0.6~0.7ms。
 */
import { safeGet, setJSONQuotaSafe } from '../../foundation/storage/storage.js?v=41a';

const WEAPON_IDS = ['zhuge', 'guanshi', 'zhangba', 'guding', 'cixiong', 'qinggang',
    'qinglong', 'hanbing', 'qilin', 'zhuque', 'fangtian', 'muniu'];
const CARD14 = ['sha', 'tiesuo', 'tao', 'guohe', 'shunshou', 'wuzhong', 'jiu',
    'juedou', 'nanman', 'lebu', 'huogong', 'bingliang', 'wanjian', 'wugu'];
const PENDING_KEY = 'djsc_shadow_v2_pending';
const PENDING_CAP = 1500;        /* 本地影子队列上限，超出丢最旧 */
const DRAIN_MAX = 500;           /* 单批上报上限 */

let _model = null;
let _loadPromise = null;
let _loadStarted = false;
let _loadMs = null;

/* ===== 懒加载：动态 import，避免扩展启动时解析 7.14MB 阻塞主线程 ===== */
export function startLoading() {
    if (_loadStarted) return _loadPromise;
    _loadStarted = true;
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    _loadPromise = import('./client_policy_model_v2.js?v=41a')
        .then(function () {
            try {
                _model = (typeof window !== 'undefined' && window.CLIENT_POLICY_MODEL_V2)
                    || (typeof globalThis !== 'undefined' && globalThis.CLIENT_POLICY_MODEL_V2)
                    || null;
                _loadMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
            } catch (e) { _model = null; }
            return _model;
        })
        .catch(function () { _model = null; return null; });
    return _loadPromise;
}
/* 扩展启动后空闲时自动后台加载（requestIdleCallback 兜底 setTimeout） */
try {
    if (typeof window !== 'undefined') {
        const ric = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1500); };
        ric(function () { startLoading(); }, { timeout: 8000 });
    }
} catch (e) { /* 忽略 */ }

function _modelReady() {
    if (!_model) {
        try {
            _model = (typeof window !== 'undefined' && window.CLIENT_POLICY_MODEL_V2)
                || (typeof globalThis !== 'undefined' && globalThis.CLIENT_POLICY_MODEL_V2)
                || null;
        } catch (e) { _model = null; }
    }
    return _model;
}

function _slotOfCandidate(a) {
    try {
        if (!a) return 'other';
        if (a.type === 'equip') {
            const id = a.id || (a.card && a.card.name) || '';
            return WEAPON_IDS.includes(id) ? 'equip:weapon' : 'equip:nonweapon';
        }
        if (a.type === 'card' && CARD14.includes(a.id)) return 'card:' + a.id;
        return 'other';
    } catch (e) { return 'other'; }
}

/* 引擎特征 → 114 维模型输入（f0-f31 + f48-f129）
 * 维度口径：仓库 features.js 现为 134 维，其中 f[130..133] 是 fix7 追加的目标身份 one-hot，
 * f0-f129 语义与 130 维完全一致，故按 shadowCore.js 既有口径取前 130 维；
 * 长度判定放宽为 >=130（不用 !==130，否则 134 维下整条影子链路恒不产出记录）。*/
export function toModelFeatures(feat) {
    const m = _modelReady();
    if (!m || !Array.isArray(feat)) return null;
    const keep = m.meta.featureKeep;
    var maxIdx = -1;
    for (var i = 0; i < keep.length; i++) { if (keep[i] > maxIdx) maxIdx = keep[i]; }
    if (feat.length <= maxIdx) return null;   /* 特征维度不足，索引会越界 */
    return keep.map(function (i) { return Number(feat[i]) || 0; });
}

export function predictClasses(feat) {
    const m = _modelReady();
    if (!m || !Array.isArray(feat)) return null;
    try {
        const x = toModelFeatures(feat);
        const proba = m.predictProba(x);
        return m.classes.map(function (c, i) { return { action: c, p: proba[i] }; })
            .sort(function (a, b) { return b.p - a.p; });
    } catch (e) { return null; }
}

/* ===== 影子比对队列（真实动作 vs 模型预测 vs 置信度）===== */
let _pending = null;
let _flushTimer = null;
function _loadPending() {
    if (_pending !== null) return _pending;
    try {
        const v = safeGet(PENDING_KEY, []);
        _pending = Array.isArray(v) ? v : [];
    } catch (e) { _pending = []; }
    return _pending;
}
function _persist() {
    try {
        if (_flushTimer) clearTimeout(_flushTimer);
        _flushTimer = setTimeout(function () {
            try {
                setJSONQuotaSafe(PENDING_KEY, (_pending || []).slice(-PENDING_CAP),
                    function (v) { return Array.isArray(v) ? v.slice(-800) : v; });
            } catch (e) { /* 配额不足不影响游戏 */ }
        }, 5000);
    } catch (e) { /* 忽略 */ }
}
function _hourKey() {
    try {
        const d = new Date();
        const p = function (n) { return n < 10 ? '0' + n : '' + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours());
    } catch (e) { return ''; }
}
function _addRecord(rec) {
    const q = _loadPending();
    q.push(rec);
    if (q.length > PENDING_CAP) q.splice(0, q.length - PENDING_CAP);
    _persist();
}
/* 上报通道调用：取出待传记录（不立即删，发送成功后 confirmDrain 再删） */
export function drainShadowV2(max) {
    const q = _loadPending();
    return q.slice(0, max || DRAIN_MAX);
}
export function confirmDrainShadowV2(n) {
    try {
        const q = _loadPending();
        if (n > 0) q.splice(0, Math.min(n, q.length));
        _persist();
    } catch (e) { /* 忽略 */ }
}

/* 影子评估：不改分；记录模型 top1/top3/置信度 与引擎最终选择 */
const _shadow = { calls: 0, top1Agree: 0, equipTop1: 0, skipped: 0, last: null };
export function shadowEvaluate(acts, winner, featOf, meta) {
    try {
        const m = _modelReady();
        if (!m) { _shadow.skipped++; return null; }   /* 模型未加载完，跳过本次 */
        if (!Array.isArray(acts) || !acts.length) return null;
        const src = (function () {
            const withFeat = acts.find(function (a) { return a && a._feat && a._feat.length >= 130; });
            if (withFeat) return withFeat._feat;
            if (typeof featOf === 'function') { try { return featOf(acts[0]); } catch (e) { return null; } }
            return null;
        })();
        if (!src || src.length < 130) return null;   /* 兼容 130/134 维，f0-f129 语义一致 */
        const top = predictClasses(src);
        if (!top) return null;
        _shadow.calls++;
        const winnerSlot = _slotOfCandidate(winner);
        const agree = top[0].action === winnerSlot;
        if (agree) _shadow.top1Agree++;
        if (top[0].action.indexOf('equip:') === 0) _shadow.equipTop1++;
        const rec = {
            hour: _hourKey(),
            mode: (meta && meta.mode) || '',
            sessionId: (meta && meta.sessionId) || '',
            modelTop: top[0].action,
            modelTopP: Number(top[0].p.toFixed(4)),
            top3: top.slice(0, 3).map(function (t) { return [t.action, Number(t.p.toFixed(4))]; }),
            engineWinner: winnerSlot,
            agree: agree,
            forcedByRule: (winner && winner.forcedByRule) || null,
        };
        _shadow.last = rec;
        _addRecord(rec);
        return { top: top, winnerSlot: winnerSlot, agree: agree, loadMs: _loadMs };
    } catch (e) { return null; }
}

/* active 模式：模型 top1 槽位候选小幅软加分（封顶 ±0.5，与 classicRuntime 同口径）。
 * 默认不启用；需 cfg('policyModelV2Mode')==='active' 且连续 3 天影子达标。 */
export function applyPolicyModel(acts, featOf) {
    try {
        const m = _modelReady();
        if (!m || !Array.isArray(acts) || acts.length < 2) return { status: 'skip' };
        const target = acts.find(function (a) { return a && a._feat && a._feat.length >= 130; });
        if (!target) return { status: 'no-features' };
        const top = predictClasses(target._feat || (featOf && featOf(target)));
        if (!top || top[0].p < (m.meta.threshold || 0.3)) return { status: 'low-confidence' };
        const topClass = top[0].action;
        acts.forEach(function (a) {
            if (!a || a.type === 'end') return;
            const same = _slotOfCandidate(a) === topClass;
            const delta = same ? Math.min(0.5, top[0].p * 0.5) : -0.1;
            if (same && typeof a.score === 'number') a.score += delta;
            a.policyModelV2 = { topClass: topClass, topP: top[0].p, delta: delta };
        });
        return { status: 'active', topClass: topClass, topP: top[0].p };
    } catch (e) { return { status: 'error', reason: String(e) }; }
}

export function policyModelStats() {
    const m = _modelReady();
    return {
        ok: !!m,
        loaded: !!m,
        loadingStarted: _loadStarted,
        loadMs: _loadMs,
        classes: m ? m.classes.length : 0,
        mode: 'shadow-default',
        pending: _loadPending().length,
        shadow: { calls: _shadow.calls, top1Agree: _shadow.top1Agree,
            agreeRate: _shadow.calls ? Number((_shadow.top1Agree / _shadow.calls).toFixed(4)) : null,
            equipTop1: _shadow.equipTop1, skipped: _shadow.skipped, last: _shadow.last },
    };
}

export function selfTest() {
    try {
        const m = _modelReady();
        if (!m) {
            /* 懒加载未完成不算致命：返回 warning 状态（面板可见正在加载） */
            return { ok: _loadStarted === true, msg: _loadStarted ? '模型懒加载中（尚未就绪）' : '模型未开始加载',
                data: { loaded: false, loadStarted: _loadStarted, pending: _loadPending().length } };
        }
        const st = m.selfTest();
        const errs = [];
        if (m.classes.length !== 17) errs.push('类别应为 17，实际 ' + m.classes.length);
        if (!st.ok) errs.push('模型 selfTest 失败');
        if (typeof drainShadowV2 !== 'function') errs.push('drain 接口缺失');
        return { ok: errs.length === 0 && st.ok,
            msg: errs.length ? errs.join(';') : 'policyModelV2 自检通过（loadMs=' + Math.round(_loadMs || 0) + 'ms）',
            data: { classes: m.classes, modelSelfTest: st.data, loadMs: _loadMs,
                shadow: _shadow, pending: _loadPending().length } };
    } catch (e) { return { ok: false, msg: 'policyModelV2 自检异常: ' + e, data: null }; }
}

try {
    if (typeof window !== 'undefined') {
        window.__DJSC = window.__DJSC || {};
        window.__DJSC.policyModelV2 = {
            startLoading: startLoading,
            predict: predictClasses, shadow: shadowEvaluate, apply: applyPolicyModel,
            drain: drainShadowV2, confirmDrain: confirmDrainShadowV2,
            stats: policyModelStats, selfTest: selfTest,
        };
    }
} catch (e) { /* 挂载失败不影响主流程 */ }

export default { startLoading: startLoading, predictClasses: predictClasses,
    shadowEvaluate: shadowEvaluate, applyPolicyModel: applyPolicyModel,
    drainShadowV2: drainShadowV2, confirmDrainShadowV2: confirmDrainShadowV2,
    stats: policyModelStats, selfTest: selfTest };
