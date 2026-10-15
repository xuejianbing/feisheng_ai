/*
 * ============================================
 * // 作者：飞升原创
 * 交流群：1080487560
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 无名AI · 模型权重在线更新（宿主编排层） =================
 * 职责：把「扩展整包更新」与「模型权重更新」彻底分开。
 *  - 本模块只更新模型参数数据，绝不下载/解压/覆盖扩展文件；
 *  - 判新旧一律比较模型权重版本（releaseSeq），不再拿扩展版本与服务器扩展版本混判；
 *  - 扩展版本只用于「兼容性」判断（新权重要求的扩展区间）。
 *
 * 分层：本文件是宿主接入层（网络 / 存储 / 弹窗），纯数据契约与版本口径在 weightBundle.js。
 * 存储隔离：只新增各 *_v1 键，绝不触碰活跃权重存档 djsc_weights_v3、
 *  A/B 状态机 djsc_model_state、训练样本 djsc_ai_db、专项模型 djsc_mode_models_v1、
 *  校准固化 djsc_weight_persist_v1。
 */
import { styledDialog } from './updateUi.js?v=41a';
import { VERSION } from '../config/version.js?v=41a';
import { safeGet, safeSet, safeRemove } from '../../score/foundation/storage/storage.js?v=41a';
import {
    MODEL_PROTOCOL, MODEL_ID, MODEL_MANIFEST_URL, BUILTIN_RELEASE_SEQ,
    normalizeReleaseSeq, isNewerRelease, satisfiesExtensionRange,
} from './weightBundle.js?v=41a';

/* ---------- 存储键 ---------- */
const CHECK_TS_KEY = 'djsc_update_check_ts';        /* ★ 沿用旧键：保留 6 小时节流连续性 */
const OFFICIAL_KEY = 'djsc_official_weights_v1';    /* 官方权重记录（独立于活跃权重存档） */
const PENDING_KEY = 'djsc_model_update_pending_v1'; /* 延迟应用：待生效的官方权重包 */
const BACKUP_KEY = 'djsc_weights_backup_v1';        /* 应用官方权重前的活跃权重备份 */

const CHECK_INTERVAL_MS = 6 * 3600 * 1000;
const FETCH_TIMEOUT_MS = 12000;
const RETRY_BACKOFF_MS = 800;

const _swallow = e => { try { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } catch (e2) {} };
const _log = (msg, warn) => { try { const t = '[无名AI·模型权重] ' + msg; if (warn) console.warn(t); else console.log(t); } catch (e) {} };

/* ---------- 存储读写（统一走中央存储抽象，异常绝不抛出） ---------- */
const readJSON = key => { try { const raw = safeGet(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };
const writeJSON = (key, val) => { try { return safeSet(key, JSON.stringify(val)) === true; } catch (e) { return false; } };
const removeKey = key => { try { return safeRemove(key) === true; } catch (e) { return false; } };

/* ---------- 本地模型权重版本（唯一判据：releaseSeq） ---------- */
const asOfficialRecord = obj => {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.modelId !== MODEL_ID || typeof obj.modelVersion !== 'string') return null;
    if (!Number.isFinite(Number(obj.releaseSeq))) return null;
    return obj;
};

export const readOfficialRecord = () => asOfficialRecord(readJSON(OFFICIAL_KEY));

/* 当前生效的模型权重版本：有官方记录则以官方为准，否则是开箱内置默认权重 */
export const localModelRelease = () => {
    const rec = readOfficialRecord();
    if (rec) return { releaseSeq: normalizeReleaseSeq(rec.releaseSeq), modelVersion: rec.modelVersion, source: 'official' };
    return { releaseSeq: BUILTIN_RELEASE_SEQ, modelVersion: 'builtin-default', source: 'builtin' };
};

export const readPending = () => readJSON(PENDING_KEY);
export const hasBackup = () => !!readJSON(BACKUP_KEY);

export const modelUpdateStatus = () => ({
    extensionVersion: VERSION,
    local: localModelRelease(),
    official: readOfficialRecord(),
    hasPending: !!readPending(),
    hasBackup: hasBackup(),
    lastCheckTs: parseInt(safeGet(CHECK_TS_KEY) || '0', 10) || 0,
    intervalHours: Math.round(CHECK_INTERVAL_MS / 3600000),
});

/* ---------- 网络：超时 + 有限次重试 ---------- */
const fetchJson = async (url, opt) => {
    opt = opt || {};
    const timeoutMs = opt.timeoutMs || FETCH_TIMEOUT_MS;
    const retries = Number.isFinite(opt.retries) ? opt.retries : 0;
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS * attempt));
        try {
            if (typeof fetch !== 'function') throw new Error('当前环境不支持网络请求');
            const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
            const timer = ctl ? setTimeout(() => { try { ctl.abort(); } catch (e) {} }, timeoutMs) : null;
            let res;
            try { res = await fetch(url, ctl ? { signal: ctl.signal } : undefined); }
            finally { if (timer) clearTimeout(timer); }
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return await res.json();
        } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('请求失败');
};

const _touchCheckTs = () => { try { safeSet(CHECK_TS_KEY, String(Date.now())); } catch (e) { _swallow(e); } };

/* ---------- 结果反馈：失败绝不伪装成更新成功 ---------- */
const _rangeText = range => {
    if (!range) return '不限';
    const min = range.min != null ? ('≥' + range.min) : '';
    const max = (range.max != null && range.max !== '') ? ('≤' + range.max) : '';
    return (min + (min && max ? ' 且 ' : '') + max) || '不限';
};

const _report = (result, manual) => {
    const latest = result.latest || null;
    _log('检查 ' + result.state + ' | 本地权重 ' + result.local.modelVersion + ' | 远程 ' + (latest ? latest.modelVersion : '—') + (result.message ? (' | ' + result.message) : ''), result.state === 'unreachable');
    /* 自动检查保持安静：只有「最新 / 不可用 / 协议未启用」不打扰用户 */
    if (!manual) {
        if (result.state === 'latest' || result.state === 'unreachable' || result.state === 'unsupported') return;
    }
    switch (result.state) {
        case 'latest':
            styledDialog({
                title: '模型权重已是最新',
                message: '当前模型权重：' + result.local.modelVersion + '\n服务器最新：' + (latest ? latest.modelVersion : '未知'),
            });
            break;
        case 'unreachable':
            styledDialog({
                title: '检查失败',
                message: '模型权重服务器暂时不可用。\n原因：' + (result.message || '未知') + '\n\n可稍后重试；此期间扩展与现有模型均照常使用。',
            });
            break;
        case 'unsupported':
            styledDialog({
                title: '暂无模型权重更新',
                message: '服务器尚未提供独立的模型权重更新（协议未启用）。\n\n扩展程序本身的更新请按原有整包方式获取。',
            });
            break;
        case 'invalid':
            styledDialog({
                title: '模型权重元数据异常',
                message: '服务器返回的权重元数据不完整或异常：\n' + (result.message || '未知') + '\n\n已忽略本次结果，现有模型不受影响。',
            });
            break;
        case 'needsExtensionUpdate':
            styledDialog({
                title: '需要更新扩展程序',
                message: '发现新模型权重：' + (latest ? latest.modelVersion : '?')
                    + '\n\n该模型要求扩展版本 ' + _rangeText(latest && latest.requiresExtension) + '，当前扩展为 ' + VERSION + '，不兼容。'
                    + '\n\n请领取最新完整安装包升级扩展程序；在线权重不会强行替换不兼容的模型。',
            });
            break;
        case 'available':
            /* ★ 阶段二：检查与状态区分已就绪；下载安装通道在后续步骤接入此处 */
            styledDialog({
                title: '发现新模型权重',
                message: '当前模型权重：' + result.local.modelVersion
                    + '\n最新模型权重：' + (latest ? latest.modelVersion : '?')
                    + (latest && latest.publishedAt ? ('\n发布时间：' + latest.publishedAt) : '')
                    + (latest && latest.notes ? ('\n\n更新说明：\n' + latest.notes) : '')
                    + '\n\n下载与安全安装通道尚未接入本版本，请稍后重试或等待扩展更新。',
            });
            break;
        default:
            _log('未知状态：' + result.state, true);
    }
};

/* ---------- 检查更新（模型权重版本，不是扩展版本） ---------- */
export const checkModelUpdate = async opt => {
    opt = opt || {};
    const manual = !!opt.manual;
    const local = localModelRelease();
    _touchCheckTs();

    let manifest = null;
    try {
        manifest = await fetchJson(MODEL_MANIFEST_URL, { retries: manual ? 1 : 0 });
    } catch (e) {
        const result = { state: 'unreachable', local, message: String((e && e.message) || e) };
        _report(result, manual);
        return result;
    }

    /* 协议未启用 / 清单结构不符 → 安全降级：不报错、不提供更新、扩展照常使用 */
    if (!manifest || typeof manifest !== 'object' || manifest.protocol !== MODEL_PROTOCOL
        || manifest.modelId !== MODEL_ID || !manifest.latest || typeof manifest.latest !== 'object') {
        const result = { state: 'unsupported', local, message: '协议未启用或清单格式不符' };
        _report(result, manual);
        return result;
    }

    const latest = manifest.latest;
    if (typeof latest.modelVersion !== 'string' || !Number.isFinite(Number(latest.releaseSeq))
        || typeof latest.url !== 'string' || !latest.url) {
        const result = { state: 'invalid', local, latest, message: '缺少 modelVersion / releaseSeq / url' };
        _report(result, manual);
        return result;
    }

    /* 兼容性：新权重要求的扩展区间，与「新旧」无关 */
    if (!satisfiesExtensionRange(VERSION, latest.requiresExtension)) {
        const result = { state: 'needsExtensionUpdate', local, latest };
        _report(result, true);
        return result;
    }

    if (isNewerRelease(latest.releaseSeq, local.releaseSeq)) {
        const result = { state: 'available', local, latest };
        _report(result, true);
        return result;
    }

    const result = { state: 'latest', local, latest };
    _report(result, manual);
    return result;
};

/* ---------- 装配：检查入口 + 启动自动检查（6 小时节流） ---------- */
export const installModelUpdate = () => {
    try {
        window.__DJSC = window.__DJSC || {};
        /* ★ 保留历史入口：控制台 __DJSC.updateCheck() 继续可用，用途改为模型权重检查 */
        window.__DJSC.updateCheck = function () { return checkModelUpdate({ manual: true }); };
        window.__DJSC.modelUpdate = {
            check: function () { return checkModelUpdate({ manual: true }); },
            status: modelUpdateStatus,
            localRelease: localModelRelease,
            officialRecord: readOfficialRecord,
            hasBackup: hasBackup,
            readPending: readPending,
        };
        /* 启动自动检查：失败也记时，防止每次启动轰炸服务器 */
        const ts = parseInt(safeGet(CHECK_TS_KEY) || '0', 10) || 0;
        if (Date.now() - ts > CHECK_INTERVAL_MS) checkModelUpdate({ manual: false }).catch(_swallow);
    } catch (e) {
        _log('装配失败：' + ((e && e.message) || e), true);
    }
};

export { MODEL_ID, MODEL_MANIFEST_URL };
