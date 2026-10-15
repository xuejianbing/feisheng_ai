/*
 * ============================================
 * // 作者：飞升原创
 * 交流群：1080487560
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 无名AI · 权重更新核心（纯逻辑 / 无宿主依赖） =================
 * 本文件只做纯逻辑（记录构造、事务判定、完整性分类、网络收口），
 * 不碰 DOM、不碰 window、不引用任何宿主模块——
 * 以便 Node 侧自动化测试直接复用**与生产完全相同的实现**，
 * 而不是用理想化假对象掩盖宿主接口差异。
 *
 * 分层：
 *   weightBundle.js  纯数据契约（版本/维度/编解码/摘要/校验）
 *   updateCore.js    纯决策逻辑（备份记录/待生效记录/事务闸门/完整性/网络收口）  ← 本文件
 *   applyWeights.js  安全应用与回滚编排（注入 bridge / storageOps）
 *   modelUpdate.js   宿主接入层（网络 / 存储 / 弹窗 / 对局状态）
 */

import { paramSpec, decodeBase64, bytesToTyped, paramsDigest, normalizeReleaseSeq } from './weightBundle.js?v=41a';

/* 记录格式版本：备份记录 / 待生效记录各自独立演进，缺省视为 v1（旧数据） */
export const BACKUP_RECORD_VERSION = 2;
export const PENDING_RECORD_VERSION = 2;
export const OFFICIAL_RECORD_VERSION = 2;

/* 备份记录种类：明确区分「可跨重启恢复的模型备份」与「完整运行时快照」。
 *  - model-params-backup：只含模型参数与元数据，**不含 AdamW 动量 / 时间步**；
 *  - runtime-snapshot：完整运行时快照（内存中），不落盘、不跨重启。 */
export const BACKUP_KIND_PARAMS = 'model-params-backup';

/* ---------------- 备份记录（P0-1 / P0-2） ----------------
 * 备份必须自描述：结构版本、数据纪元、维度、参数摘要、体积，
 * 以便写入后读回校验、恢复前验证兼容性，而不是仅凭"有 params 就当真"。 */
export const buildBackupRecord = opt => {
    const { params, meta, dims, schemaVersion, dataEpoch, savedAt } = opt || {};
    const digest = paramsDigest(params, dims);
    const spec = paramSpec(dims);
    let size = 0;
    for (let i = 0; i < spec.length; i++) size += (spec[i].kind === 'int16' ? spec[i].len * 2 : spec[i].len);
    return {
        version: BACKUP_RECORD_VERSION,
        kind: BACKUP_KIND_PARAMS,
        savedAt: Number(savedAt) || Date.now(),
        schemaVersion: Number.isFinite(Number(schemaVersion)) ? Number(schemaVersion) : null,
        dataEpoch: Number.isFinite(Number(dataEpoch)) ? Number(dataEpoch) : null,
        dims: Array.isArray(dims) ? dims.slice() : null,
        digest,
        size,
        params: params || null,
        meta: meta || null,
        /* 明确如实告知恢复范围：这不是完整训练状态备份 */
        hasOptimizerState: false,
        note: '仅含模型参数与元数据，不含 AdamW 动量与时间步；属可跨重启恢复的模型备份，不是完整运行时快照',
    };
};

/* 两个版本字段是否"可比且不同"（任一侧缺失/非法则视为不可比，不做判定） */
const _versionMismatch = (a, b) => {
    const na = Number(a), nb = Number(b);
    if (a == null || b == null || !Number.isFinite(na) || !Number.isFinite(nb)) return false;
    return na !== nb;
};

/* 读回备份与期望备份逐项核对：返回 errors（空 = 一致） */
export const verifyBackupRecord = (got, want, dims) => {
    const errors = [];
    if (!got || typeof got !== 'object') return ['读回的备份为空'];
    if (!want || typeof want !== 'object') return ['期望备份缺失'];
    if (!got.params || typeof got.params !== 'object') return ['读回的备份缺少参数'];
    if (_versionMismatch(got.schemaVersion, want.schemaVersion)) {
        errors.push('备份结构版本 ' + got.schemaVersion + ' ≠ ' + want.schemaVersion);
    }
    const spec = paramSpec(dims);
    for (let i = 0; i < spec.length; i++) {
        const s = spec[i];
        const a = decodeBase64(got.params[s.key]);
        const b = decodeBase64(want.params[s.key]);
        const need = s.kind === 'int16' ? s.len * 2 : s.len;
        if (!a) { errors.push('备份缺少参数 ' + s.key); continue; }
        if (a.byteLength !== need) { errors.push('备份参数 ' + s.key + ' 字节数 ' + a.byteLength + ' ≠ ' + need); continue; }
        if (!b || b.byteLength !== a.byteLength) { errors.push('期望备份参数 ' + s.key + ' 不可比'); continue; }
        for (let k = 0; k < a.byteLength; k++) {
            if (a[k] !== b[k]) { errors.push('备份参数 ' + s.key + ' 第 ' + k + ' 字节不一致'); break; }
        }
    }
    if (!errors.length) {
        const hg = paramsDigest(got.params, dims), hw = paramsDigest(want.params, dims);
        if (!hg || hg !== hw) errors.push('备份摘要不一致');
        else if (got.digest && String(got.digest).toLowerCase() !== hg) errors.push('读回备份记录摘要字段与内容不符');
        else if (want.digest && String(want.digest).toLowerCase() !== hg) errors.push('期望备份摘要字段与内容不符');
    }
    return errors;
};

/* 恢复前验证备份的完整性、结构与版本兼容性：返回 errors（空 = 可用） */
export const verifyRestoreSource = (rec, dims, schemaVersion) => {
    const errors = [];
    if (!rec || typeof rec !== 'object') return ['没有可用的备份'];
    if (!rec.params || typeof rec.params !== 'object') return ['备份缺少参数'];
    if (rec.kind && rec.kind !== BACKUP_KIND_PARAMS) errors.push('备份种类不符：' + rec.kind);
    if (rec.dims && Array.isArray(rec.dims) && dims && rec.dims.join(',') !== dims.join(',')) {
        errors.push('备份网络维度 ' + rec.dims.join(',') + ' ≠ 运行时 ' + (dims || []).join(','));
    }
    if (_versionMismatch(rec.schemaVersion, schemaVersion)) {
        errors.push('备份结构版本 v' + rec.schemaVersion + ' 与运行时 v' + schemaVersion + ' 不兼容');
    }
    const spec = paramSpec(dims);
    for (let i = 0; i < spec.length; i++) {
        const s = spec[i];
        const b = decodeBase64(rec.params[s.key]);
        const need = s.kind === 'int16' ? s.len * 2 : s.len;
        if (!b || b.byteLength !== need) { errors.push('备份参数 ' + s.key + ' 缺失或长度不符'); continue; }
        const typed = bytesToTyped(b, s);
        if (!typed) { errors.push('备份参数 ' + s.key + ' 类型不符'); continue; }
        for (let k = 0; k < typed.length; k++) {
            if (!Number.isFinite(typed[k])) { errors.push('备份参数 ' + s.key + ' 含非法数值'); break; }
        }
    }
    if (!errors.length && rec.digest) {
        const h = paramsDigest(rec.params, dims);
        if (!h || h !== String(rec.digest).toLowerCase()) errors.push('备份内容与记录摘要不一致（备份可能已损坏）');
    }
    return errors;
};

/* ---------------- 待生效记录（P0-3） ----------------
 * 记录授权时的基线模型摘要：实际生效前必须重新核对当前模型是否已变化，
 * 防止"下载期间/等待期间用户又训练出新模型"被静默覆盖。 */
export const buildPendingRecord = opt => {
    const { latest, bundle, baseModelDigest, userAuthorized, reason, savedAt, contract } = opt || {};
    return {
        version: PENDING_RECORD_VERSION,
        latest: latest || null,
        bundle: bundle || null,
        savedAt: Number(savedAt) || Date.now(),
        reason: reason || '',
        /* 授权基线：创建待生效任务时当前生效模型的参数摘要（可能为 null = 不可判定） */
        baseModelDigest: baseModelDigest ? String(baseModelDigest).toLowerCase() : null,
        /* 目标权重摘要与版本（用于"已安装/被取代"判定） */
        targetDigest: String((bundle && bundle.sha256) || '').toLowerCase() || null,
        modelVersion: (bundle && bundle.modelVersion) || null,
        releaseSeq: normalizeReleaseSeq(bundle && bundle.releaseSeq),
        schemaVersion: bundle ? bundle.schemaVersion : null,
        dataEpoch: bundle ? bundle.dataEpoch : null,
        /* 用户是否在创建时明确同意"覆盖其当时的模型" */
        userAuthorized: userAuthorized === true,
        contractDataEpoch: contract ? Number(contract.dataEpoch) : null,
    };
};

/* 待生效任务判定（纯函数）：返回 { action, reason }
 *   action: 'apply' 可以安全应用 | 'wait' 时机未到（对局/训练中）
 *          'reprompt' 当前模型与授权基线不一致 → 必须重新征得用户同意
 *          'drop' 该任务已失效（结构/纪元不兼容、已安装、被更新版本取代、已生效） */
export const evaluatePending = opt => {
    const { pending, contract, currentDigest, officialRec, gate } = opt || {};
    if (!pending || typeof pending !== 'object' || !pending.bundle) return { action: 'drop', reason: '待生效记录无效' };
    if (pending.version != null && Number(pending.version) < PENDING_RECORD_VERSION) {
        /* v1 旧记录没有授权基线摘要 → 无法确认是否覆盖了新训练成果，保守丢弃并提示重新下载 */
        return { action: 'drop', reason: '待生效记录为旧格式（缺少授权基线），已安全丢弃，请重新下载安装' };
    }
    if (!contract) return { action: 'wait', reason: '运行时契约不可用' };
    const b = pending.bundle;
    if (b.schemaVersion != null && Number(b.schemaVersion) !== Number(contract.schemaVersion)) {
        return { action: 'drop', reason: '待生效权重结构版本与运行时不符' };
    }
    if (Array.isArray(b.dims) && Array.isArray(contract.dims) && b.dims.join(',') !== contract.dims.join(',')) {
        return { action: 'drop', reason: '待生效权重网络维度与运行时不符' };
    }
    if (b.dataEpoch != null && Number(b.dataEpoch) < Number(contract.dataEpoch)) {
        return { action: 'drop', reason: '待生效权重数据纪元过旧（会被拒载）' };
    }
    /* 已被更新版本取代 / 该版本已安装 → 安全跳过，避免回退到旧权重 */
    const officialSeq = officialRec ? normalizeReleaseSeq(officialRec.releaseSeq) : -1;
    if (officialSeq >= 0 && officialSeq >= normalizeReleaseSeq(pending.releaseSeq)) {
        return { action: 'drop', reason: '该权重版本已安装或被更新版本取代' };
    }
    if (currentDigest && pending.targetDigest && String(currentDigest).toLowerCase() === pending.targetDigest) {
        return { action: 'drop', reason: '该权重已生效' };
    }
    if (gate && gate.ok === false) return { action: 'wait', reason: gate.reason || '当前不可应用' };
    /* 关键：当前模型与授权基线不一致 → 不得静默覆盖，必须重新征得同意 */
    if (!pending.baseModelDigest) return { action: 'reprompt', reason: '无法确认授权时的模型基线' };
    if (!currentDigest) return { action: 'reprompt', reason: '无法读取当前模型以核对基线' };
    if (String(currentDigest).toLowerCase() !== pending.baseModelDigest) {
        return { action: 'reprompt', reason: '等待期间当前模型已发生变化（可能是新的本地训练成果）' };
    }
    return { action: 'apply' };
};
