/*
 * ============================================
 * // 作者：飞升原创
 * 交流群：1080487560
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 无名AI · 策略模型 v3 热更消费端（纯数据，不执行远端脚本） =================
 * 通道：8787（data.feiqiaoai.uno）/update/model/manifest.json + /update/model/policy_v3.json
 *   —— 由 server_sharded.py 的 /update/ 受限静态服务托管（仅 .zip/.json，防穿越）。
 *
 * 契约（djsc-policy-model-update-v1）：
 *   manifest = { protocol, modelId:'slot17_student_v3',
 *                latest:{ modelVersion, releaseSeq, url, sha256, size, requiresExtension:{min,max?},
 *                         schema:'slot17_student_v3', classes:17, featureDim:114, hidden:32 } }
 *   payload  = { meta: CLIENT_POLICY_V3_META }（base64 权重 + 归一化参数，纯数据）
 *
 * 行为：
 *   - 启动后空闲时检查一次；releaseSeq 单调递增才下载；
 *   - 下载后校验 size + sha256 + meta 形状，通过才写入本地缓存；
 *   - 任何失败静默保留内置权重（不报错、不打扰、不影响对局）；
 *   - 是否生效由 policyModelV3.js 下次加载时读取缓存决定（不在本模块改运行时模型）。
 *   - 开关：cfg('policyModelHotUpdate', true)
 */
import { cfg } from '../../score/foundation/config/util.js?v=41a';
import { safeGet, setJSONQuotaSafe } from '../../score/foundation/storage/storage.js?v=41a';
import { sha256Hex } from './weightBundle.js?v=41a';
import { VERSION as EXT_VERSION } from '../../js/config/version.js?v=41a';

export const POLICY_PROTOCOL = 'djsc-policy-model-update-v1';
export const POLICY_MODEL_ID = 'slot17_student_v3';
export const POLICY_MANIFEST_URL = 'https://data.feiqiaoai.uno/update/model/policy_manifest.json';
export const POLICY_STORE_KEY = 'djsc_policy_model_v3';

const SHA_RE = /^[0-9a-f]{64}$/;

/* ---------------- 纯逻辑：版本比较 / 清单判定（可单测，无宿主依赖） ---------------- */
export function parseVerTuple(v) {
    const parts = String(v == null ? '' : v).trim().split('.').slice(0, 4).map(x => {
        const n = parseInt(x, 10);
        return Number.isFinite(n) ? n : 0;
    });
    while (parts.length < 4) parts.push(0);
    return parts;
}
export function compareVer(a, b) {
    const x = parseVerTuple(a), y = parseVerTuple(b);
    for (let i = 0; i < 4; i++) {
        if (x[i] > y[i]) return 1;
        if (x[i] < y[i]) return -1;
    }
    return 0;
}
export function satisfiesRange(version, range) {
    const r = range || {};
    if (r.min != null && compareVer(version, r.min) < 0) return false;
    if (r.max != null && r.max !== '' && compareVer(version, r.max) > 0) return false;
    return true;
}
export function normalizeSeq(v) {
    const n = Number(v);
    return (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) ? n : 0;
}

/* 清单 → 状态：unsupported / invalid / needsExtensionUpdate / available / latest */
export function classifyPolicyManifest(manifest, localSeq, extensionVersion) {
    const latest = manifest && typeof manifest === 'object' ? manifest.latest : null;
    if (!manifest || typeof manifest !== 'object' || manifest.protocol !== POLICY_PROTOCOL
        || manifest.modelId !== POLICY_MODEL_ID || !latest || typeof latest !== 'object') {
        return { state: 'unsupported', latest: null, message: '协议未启用或清单格式不符' };
    }
    if (typeof latest.modelVersion !== 'string' || !latest.modelVersion
        || !Number.isFinite(Number(latest.releaseSeq))
        || typeof latest.url !== 'string' || !latest.url
        || typeof latest.sha256 !== 'string' || !SHA_RE.test(String(latest.sha256).toLowerCase())
        || !Number.isFinite(Number(latest.size)) || Number(latest.size) <= 0) {
        return { state: 'invalid', latest, message: '缺 modelVersion/releaseSeq/url/sha256/size' };
    }
    if (latest.requiresExtension && !satisfiesRange(extensionVersion, latest.requiresExtension)) {
        return { state: 'needsExtensionUpdate', latest, message: '需先升级扩展' };
    }
    if (normalizeSeq(latest.releaseSeq) > normalizeSeq(localSeq)) {
        return { state: 'available', latest, message: '有新模型' };
    }
    return { state: 'latest', latest, message: '已是最新' };
}

/* meta 形状校验：weights 必须是 base64、维度自洽 */
export function validatePolicyMeta(meta) {
    const errs = [];
    if (!meta || typeof meta !== 'object') return { ok: false, errors: ['meta 缺失'] };
    if (meta.schema !== 'slot17_student_v3') errs.push('schema 不符');
    if (!Array.isArray(meta.classes) || meta.classes.length !== 17) errs.push('classes 应为 17');
    if (meta.numClasses !== 17) errs.push('numClasses 应为 17');
    if (!Number.isInteger(meta.featureDim) || meta.featureDim <= 0) errs.push('featureDim 非法');
    if (!Array.isArray(meta.featureKeep) || meta.featureKeep.length !== meta.featureDim) errs.push('featureKeep 长度不符');
    if (!Array.isArray(meta.normMin) || meta.normMin.length !== meta.featureDim) errs.push('normMin 长度不符');
    if (!Array.isArray(meta.normRange) || meta.normRange.length !== meta.featureDim) errs.push('normRange 长度不符');
    if (!Number.isInteger(meta.hidden) || meta.hidden <= 0) errs.push('hidden 非法');
    ['w1', 'b1', 'w2', 'b2'].forEach(k => {
        if (typeof meta[k] !== 'string' || meta[k].length < 8) errs.push(k + ' 缺失');
    });
    return { ok: errs.length === 0, errors: errs };
}

/* ---------------- 本地缓存 ---------------- */
export function loadCachedPolicyMeta() {
    try {
        const raw = safeGet(POLICY_STORE_KEY, null);
        const rec = raw ? JSON.parse(raw) : null;
        if (!rec || !rec.meta) return null;
        const v = validatePolicyMeta(rec.meta);
        return v.ok ? rec.meta : null;
    } catch (e) { return null; }
}
export function loadCachedPolicyRecord() {
    try {
        const raw = safeGet(POLICY_STORE_KEY, null);
        const rec = raw ? JSON.parse(raw) : null;
        if (!rec || !rec.meta) return null;
        return { seq: normalizeSeq(rec.seq), version: rec.version || '', sha: rec.sha || '', at: rec.at || 0 };
    } catch (e) { return null; }
}
function savePolicyRecord(meta, latest) {
    try {
        setJSONQuotaSafe(POLICY_STORE_KEY, {
            meta: meta,
            seq: normalizeSeq(latest.releaseSeq),
            version: latest.modelVersion,
            sha: String(latest.sha256).toLowerCase(),
            at: Date.now(),
        }, function (v) { return v; });
    } catch (e) { /* 配额不足不影响游戏，下轮重试 */ }
}

/* ---------------- 网络（超时 + 静默失败） ---------------- */
let _generation=0, _disposed=false, _installed=false, _scheduled=null, _idle=false, _owned=null;
const _controllers=new Set(), _fetchTimers=new Set();
function timedFetch(url, ms, owned) {
    if (typeof fetch !== 'function') return Promise.reject(new Error('fetch 不可用'));
    const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
    if(ctl){_controllers.add(ctl);owned.add(ctl);}
    const timer = ctl ? setTimeout(function () { try { ctl.abort(); } catch (e) {} }, ms || 12000) : null;
    if(timer)_fetchTimers.add(timer);
    return fetch(url, ctl ? { cache: 'no-store', signal: ctl.signal } : { cache: 'no-store' })
        .then(function (r) { if (timer) {clearTimeout(timer);_fetchTimers.delete(timer);} if (!r.ok) throw new Error('HTTP ' + r.status); return r; },
              function (e) { if (timer) {clearTimeout(timer);_fetchTimers.delete(timer);} throw e; });
}

let _last = { at: 0, ok: false, detail: '', state: '', seq: 0 };
export function policyModelUpdateStatus() {
    const rec = loadCachedPolicyRecord();
    return {
        ok: _last.ok,
        state: _last.state,
        detail: _last.detail,
        at: _last.at,
        localSeq: rec ? rec.seq : 0,
        localVersion: rec ? rec.version : '',
        cached: !!loadCachedPolicyMeta(),
        enabled: !!cfg('policyModelHotUpdate', true),
    };
}

/* 检查并（如有新版本）下载缓存；force=true 忽略节流 */
export function checkPolicyModelUpdate(force) {
    const generation=_generation, owned=new Set();
    const valid=()=>!_disposed&&generation===_generation;
    const verify=()=>{if(!valid())throw Error('更新任务已卸载');};
    if(!valid())return Promise.resolve({...policyModelUpdateStatus(),cancelled:true});
    const enabled = !!cfg('policyModelHotUpdate', true);
    if (!enabled) { _last = { at: Date.now(), ok: false, detail: '热更开关关闭', state: 'disabled', seq: 0 }; return Promise.resolve(policyModelUpdateStatus()); }
    const rec = loadCachedPolicyRecord();
    const localSeq = rec ? rec.seq : 0;
    return timedFetch(POLICY_MANIFEST_URL, 12000, owned)
        .then(function (r) { return r.json(); })
        .then(function (manifest) {
            verify();
            const cls = classifyPolicyManifest(manifest, localSeq, EXT_VERSION);
            if (cls.state !== 'available') {
                _last = { at: Date.now(), ok: true, detail: cls.message, state: cls.state, seq: localSeq };
                return policyModelUpdateStatus();
            }
            const latest = cls.latest;
            const absUrl = new URL(latest.url, POLICY_MANIFEST_URL).toString();
            return timedFetch(absUrl, 20000, owned).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
                verify();
                const bytes = new Uint8Array(buf);
                /* size 校验（放宽：允许 manifest 未填 size 时跳过） */
                if (Number.isFinite(Number(latest.size)) && Number(latest.size) > 0 && bytes.length !== Number(latest.size)) {
                    throw new Error('模型体积不符：manifest ' + latest.size + ' ≠ 实际 ' + bytes.length);
                }
                /* sha256 校验（必须有，且必须匹配） */
                const want = String(latest.sha256).toLowerCase();
                const got = sha256Hex(bytes);
                if (want !== got) throw new Error('SHA-256 不匹配（内容与清单不一致）');
                let payload = null;
                try { payload = JSON.parse(new TextDecoder('utf-8').decode(bytes)); } catch (eJ) { throw new Error('模型 JSON 解析失败'); }
                const meta = payload && payload.meta;
                const v = validatePolicyMeta(meta);
                if (!v.ok) throw new Error('模型字段非法：' + v.errors.slice(0, 3).join(';'));
                verify();
                savePolicyRecord(meta, latest);
                _last = { at: Date.now(), ok: true, detail: '已缓存 ' + latest.modelVersion + ' (seq ' + latest.releaseSeq + ')，下次加载生效', state: 'downloaded', seq: normalizeSeq(latest.releaseSeq) };
                return policyModelUpdateStatus();
            });
        })
        .catch(function (e) {
            if(!valid())return {...policyModelUpdateStatus(),cancelled:true};
            _last = { at: Date.now(), ok: false, detail: String(e && e.message || e), state: 'error', seq: localSeq };
            try { console.log('[无名AI·模型热更] 检查失败（保留内置权重）：' + _last.detail); } catch (eL) {}
            return policyModelUpdateStatus();
        }).finally(()=>{for(const ctl of owned)_controllers.delete(ctl);});
}

/* 启动入口：空闲时检查一次（失败静默） */
export function installPolicyModelUpdate() {
    try {
        if (typeof window === 'undefined' || _installed) return;
        _installed=true;_disposed=false;const generation=++_generation;
        window.__DJSC = window.__DJSC || {};
        window.__DJSC.policyModelUpdate = {
            check: function () { return checkPolicyModelUpdate(true); },
            status: policyModelUpdateStatus,
            cached: loadCachedPolicyMeta,
        };
        _owned=window.__DJSC.policyModelUpdate;
        _idle=typeof window.requestIdleCallback==='function';
        const ric = window.requestIdleCallback || function (fn) { return setTimeout(fn, 4000); };
        _scheduled=ric(function () { _scheduled=null;if(!_disposed&&generation===_generation)checkPolicyModelUpdate(false); }, { timeout: 12000 });
    } catch (e) { /* 忽略 */ }
}

export function uninstallPolicyModelUpdate(){
 _disposed=true;_installed=false;_generation++;
 if(_scheduled!==null){if(_idle&&typeof window?.cancelIdleCallback==='function')window.cancelIdleCallback(_scheduled);else clearTimeout(_scheduled);}_scheduled=null;
 for(const ctl of _controllers)try{ctl.abort();}catch(_){} _controllers.clear();
 if(typeof window!=='undefined'&&window.__DJSC?.policyModelUpdate===_owned)delete window.__DJSC.policyModelUpdate;
 for(const timer of _fetchTimers)clearTimeout(timer);_fetchTimers.clear();
 _owned=null;
}
