/*
 * ============================================
 * // 作者：飞升原创
 * 交流群：1080487560
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 无名AI · 策略模型 v3（蒸馏学生）适配层 =================
 * 权重：score/model/net/client_policy_model_v3.js（MLP 114→32→17，51KB，UMD 挂 self.CLIENT_POLICY_V3）
 * 生成：tools/training/P0_Distill_Student_Export.py（v4.1.4.0 资产，schema=slot17_student_v3）
 *
 * 定位：与 policyModelV2 同口径的「17 类槽位策略模型」，作为 hard_force / soft_boost 未命中时的模型兜底。
 *   默认 mode='shadow'：只记录模型判断与引擎最终选择的一致性（写入 djsc_shadow_v3_pending），
 *   不改候选分；cfg('policyModelV3Mode')==='active' 且影子连续达标后才允许软加分。
 *
 * 与 v2 的差异：
 *   1) v3 权重只有 51KB（v2 为 7.14MB），懒加载更快；
 *   2) v3 模型输入是「原始 130 维特征」，featureKeep/normMin/normRange 由模型内部处理
 *      （f0-f129，避开 f32-f47 动作泄露段），本适配层只做长度校验与切片；
 *   3) 影子记录带 schema 标识，上报走 cloudIngest 的 shadowPolicy 字段。
 *
 * 维度口径：仓库 features.js 现为 134 维（f130-f133 目标身份 one-hot），v3 只吃 f0-f129，
 *   因此 130/134/142 维特征均可用（统一取前 130 维），<130 维拒绝。
 */
import { cfg } from '../../foundation/config/util.js?v=41a';
import { safeGet, setJSONQuotaSafe } from '../../foundation/storage/storage.js?v=41a';
import { loadCachedPolicyMeta } from '../../../js/update/policyModelUpdate.js?v=41a';

/* ===== 纯数据模型重建（热更缓存 → 模型对象；不执行任何远端脚本）=====
 * 与 client_policy_model_v3.js 的 UMD 工厂同构：base64→LE float64，relu 隐层 + softmax。
 * 单测用它做「内置 vs 缓存」预测一致性对拍。 */
export function buildModelFromMeta(meta) {
    if (!meta || !Array.isArray(meta.classes)) return null;
    const m = meta;
    function b64ToF64(b64) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        const clean = String(b64).replace(/[^A-Za-z0-9+/]/g, '');
        const n = Math.floor(clean.length * 3 / 4);
        const bytes = new Uint8Array(n);
        let p = 0;
        for (let i = 0; i < clean.length; i += 4) {
            const c0 = chars.indexOf(clean[i]);
            const c1 = chars.indexOf(clean[i + 1]);
            const c2 = chars.indexOf(clean[i + 2]);
            const c3 = chars.indexOf(clean[i + 3]);
            if (i + 1 < clean.length) bytes[p++] = ((c0 << 2) | (c1 >> 4)) & 255;
            if (i + 2 < clean.length) bytes[p++] = (((c1 & 15) << 4) | (c2 >> 2)) & 255;
            if (i + 3 < clean.length) bytes[p++] = (((c2 & 3) << 6) | c3) & 255;
        }
        const dv = new DataView(bytes.buffer);
        const out = new Float64Array(Math.floor(n / 8));
        for (let k = 0; k < out.length; k++) out[k] = dv.getFloat64(k * 8, true);
        return out;
    }
    const W1 = b64ToF64(m.w1), B1 = b64ToF64(m.b1), W2 = b64ToF64(m.w2), B2 = b64ToF64(m.b2);
    function pick114(features130) {
        const keep = m.featureKeep;
        const x = new Array(m.featureDim);
        for (let i = 0; i < m.featureDim; i++) {
            x[i] = (features130[keep[i]] - m.normMin[i]) / m.normRange[i];
        }
        return x;
    }
    function forward114(x114) {
        const h = new Array(m.hidden);
        for (let j = 0; j < m.hidden; j++) {
            let s = B1[j];
            const off = j * m.featureDim;
            for (let i = 0; i < m.featureDim; i++) s += W1[off + i] * x114[i];
            h[j] = s > 0 ? s : 0;
        }
        const out = new Array(m.numClasses);
        for (let k = 0; k < m.numClasses; k++) {
            let s2 = B2[k];
            const off2 = k * m.hidden;
            for (let j2 = 0; j2 < m.hidden; j2++) s2 += W2[off2 + j2] * h[j2];
            out[k] = s2;
        }
        return out;
    }
    function softmax(logits) {
        let max = logits[0];
        for (let i = 1; i < logits.length; i++) if (logits[i] > max) max = logits[i];
        let sum = 0;
        const exps = new Array(logits.length);
        for (let j = 0; j < logits.length; j++) { exps[j] = Math.exp(logits[j] - max); sum += exps[j]; }
        const probs = new Array(logits.length);
        for (let k = 0; k < logits.length; k++) probs[k] = exps[k] / sum;
        return probs;
    }
    return {
        meta: m,
        classes: m.classes,
        featureDim: m.featureDim,
        featureKeep: m.featureKeep,
        threshold: m.threshold,
        schema: m.schema,
        format: m.format,
        predictProba: function (features130) { return softmax(forward114(pick114(features130))); },
        topK: function (features130, k) {
            const probs = this.predictProba(features130);
            const arr = [];
            for (let i = 0; i < probs.length; i++) arr.push({ action: m.classes[i], probability: probs[i] });
            arr.sort(function (a, b) { return b.probability - a.probability; });
            return arr.slice(0, k || 3);
        },
        selfTest: function () {
            const zero = new Array(130).fill(0);
            const probs = this.predictProba(zero);
            let sum = 0;
            for (let j = 0; j < probs.length; j++) sum += probs[j];
            return {
                ok: Math.abs(sum - 1) < 1e-9 && m.classes.length === m.numClasses &&
                    W1.length === m.featureDim * m.hidden && W2.length === m.hidden * m.numClasses,
                msg: 'policy model v3 (built from data) selfTest',
                data: { top3: this.topK(zero, 3), sum: sum },
            };
        },
    };
}

const WEAPON_IDS = ['zhuge', 'guanshi', 'zhangba', 'guding', 'cixiong', 'qinggang',
    'qinglong', 'hanbing', 'qilin', 'zhuque', 'fangtian', 'muniu'];
const CARD14 = ['sha', 'tiesuo', 'tao', 'guohe', 'shunshou', 'wuzhong', 'jiu',
    'juedou', 'nanman', 'lebu', 'huogong', 'bingliang', 'wanjian', 'wugu'];
const PENDING_KEY = 'djsc_shadow_v3_pending';
const PENDING_CAP = 1500;        /* 本地影子队列上限，超出丢最旧 */
const DRAIN_MAX = 500;           /* 单批上报上限 */
const MODEL_SCHEMA = 'slot17_student_v3';

let _model = null;
let _loadPromise = null;
let _loadStarted = false;
let _loadMs = null;
let _source = '';   /* 'cache'（热更缓存）| 'builtin'（随包内置） */

/* ===== 懒加载：先看热更缓存（纯数据重建），否则加载随包内置权重 ===== */
export function startLoading() {
    if (_loadStarted) return _loadPromise;
    _loadStarted = true;
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    _loadPromise = Promise.resolve().then(function () {
        /* 1) 热更缓存优先（policyModelUpdate.js 校验通过后写入） */
        try {
            const cached = loadCachedPolicyMeta();
            if (cached) {
                const built = buildModelFromMeta(cached);
                if (built && built.selfTest && built.selfTest().ok) {
                    _model = built; _source = 'cache';
                    if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.bootMark) window.__DJSC.bootMark('v3:loaded', { source: 'cache' });
                    _loadMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
                    return _model;
                }
            }
        } catch (eCache) { /* 缓存损坏 → 回退内置 */ }
        /* 2) 内置权重（UMD） */
        return import('./client_policy_model_v3.js?v=41a')
            .then(function (ns) {
                try {
                    _model = (typeof window !== 'undefined' && window.CLIENT_POLICY_V3)
                        || (typeof globalThis !== 'undefined' && globalThis.CLIENT_POLICY_V3)
                        || (ns && (ns.CLIENT_POLICY_V3 || (ns.default && ns.default.classes ? ns.default : null)))
                        || null;
                    _source = 'builtin';
                    if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.bootMark) window.__DJSC.bootMark('v3:loaded', { source: 'builtin' });
                    _loadMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
                } catch (e) { _model = null; }
                return _model;
            })
            .catch(function () { _model = null; return null; });
    });
    return _loadPromise;
}
/* 扩展启动后空闲时自动后台加载（requestIdleCallback 兜底 setTimeout） */
try {
    if (typeof window !== 'undefined') {
        const ric = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1500); };
        ric(function () { if (cfg('policyModelV3Mode', 'shadow') !== 'off' && (cfg('policyModelV3Mode', 'shadow') === 'active' || cfg('policyModelV3Shadow', true) !== false)) startLoading(); }, { timeout: 8000 });
    }
} catch (e) { /* 忽略 */ }

function _modelReady() {
    if (!_model) {
        try {
            _model = (typeof window !== 'undefined' && window.CLIENT_POLICY_V3)
                || (typeof globalThis !== 'undefined' && globalThis.CLIENT_POLICY_V3)
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

/* 引擎特征 → v3 模型输入（原始 130 维；v3 内部自行取 114 维并归一化） */
export function toModelFeatures(feat) {
    if (!Array.isArray(feat) && !(feat && typeof feat.length === 'number')) return null;
    if (feat.length < 130) return null;   /* v3 featureKeep 最大索引 129 */
    const out = new Array(130);
    for (let i = 0; i < 130; i++) out[i] = Number(feat[i]) || 0;
    return out;
}

export function predictClasses(feat) {
    if (cfg('policyModelV3Mode', 'shadow') === 'off') return null;
    const m = _modelReady();
    if (!m) startLoading();
    if (!m || typeof m.predictProba !== 'function') return null;
    try {
        const x = toModelFeatures(feat);
        if (!x) return null;
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
function _decisionId() {
    try { return 'p3-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
    catch (e) { return 'p3-' + Math.random().toString(36).slice(2); }
}
function _addRecord(rec) {
    const q = _loadPending();
    q.push(rec);
    if (q.length > PENDING_CAP) q.splice(0, q.length - PENDING_CAP);
    _persist();
}
/* 上报通道调用：取出待传记录（不立即删，发送成功后 confirmDrainShadowV3 再删） */
export function drainShadowV3(max) {
    const q = _loadPending();
    return q.slice(0, max || DRAIN_MAX);
}
export function confirmDrainShadowV3(n) {
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
        if (cfg('policyModelV3Mode', 'shadow') === 'off' || cfg('policyModelV3Shadow', true) === false) return null;
        const m = _modelReady();
        if (!m) startLoading();
        if (!m) { _shadow.skipped++; return null; }   /* 模型未加载完，跳过本次 */
        if (!Array.isArray(acts) || !acts.length) return null;
        const src = (function () {
            const withFeat = acts.find(function (a) { return a && a._feat && a._feat.length >= 130; });
            if (withFeat) return withFeat._feat;
            if (typeof featOf === 'function') { try { return featOf(acts[0]); } catch (e) { return null; } }
            return null;
        })();
        if (!src || src.length < 130) return null;   /* 兼容 130/134/142 维，v3 只吃 f0-f129 */
        const top = predictClasses(src);
        if (!top) return null;
        _shadow.calls++;
        const winnerSlot = _slotOfCandidate(winner);
        const agree = top[0].action === winnerSlot;
        if (agree) _shadow.top1Agree++;
        if (top[0].action.indexOf('equip:') === 0) _shadow.equipTop1++;
        const rec = {
            decisionId: _decisionId(),
            ts: Date.now(),
            hour: _hourKey(),
            schema: MODEL_SCHEMA,
            mode: (meta && meta.mode) || '',
            sessionId: (meta && meta.sessionId) || '',
            round: (meta && meta.round) || 0,
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
 * 默认不启用；需 cfg('policyModelV3Mode')==='active' 且影子连续达标。 */
export function applyPolicyModel(acts, featOf) {
    try {
        if (cfg('policyModelV3Mode', 'shadow') === 'off') return { status: 'skip' };
        const m = _modelReady();
        if (!m) startLoading();
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
            a.policyModelV3 = { topClass: topClass, topP: top[0].p, delta: delta };
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
        source: _source,
        schema: MODEL_SCHEMA,
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
            return { ok: _loadStarted === true, msg: _loadStarted ? 'v3 模型懒加载中（尚未就绪）' : 'v3 模型未开始加载',
                data: { loaded: false, loadStarted: _loadStarted, pending: _loadPending().length } };
        }
        const st = typeof m.selfTest === 'function' ? m.selfTest() : { ok: true };
        const errs = [];
        if (!Array.isArray(m.classes) || m.classes.length !== 17) errs.push('类别应为 17，实际 ' + (m.classes && m.classes.length));
        if (!st.ok) errs.push('模型 selfTest 失败');
        return { ok: errs.length === 0 && st.ok,
            msg: errs.length ? errs.join(';') : 'policyModelV3 自检通过（loadMs=' + Math.round(_loadMs || 0) + 'ms）',
            data: { classes: m.classes, modelSelfTest: st.data, loadMs: _loadMs,
                shadow: _shadow, pending: _loadPending().length } };
    } catch (e) { return { ok: false, msg: 'policyModelV3 自检异常: ' + e, data: null }; }
}

try {
    if (typeof window !== 'undefined') {
        window.__DJSC = window.__DJSC || {};
        window.__DJSC.policyModelV3 = {
            startLoading: startLoading,
            predict: predictClasses, shadow: shadowEvaluate, apply: applyPolicyModel,
            drain: drainShadowV3, confirmDrain: confirmDrainShadowV3,
            stats: policyModelStats, selfTest: selfTest,
        };
    }
} catch (e) { /* 挂载失败不影响主流程 */ }

export default { startLoading: startLoading, predictClasses: predictClasses,
    shadowEvaluate: shadowEvaluate, applyPolicyModel: applyPolicyModel,
    drainShadowV3: drainShadowV3, confirmDrainShadowV3: confirmDrainShadowV3,
    stats: policyModelStats, selfTest: selfTest };
