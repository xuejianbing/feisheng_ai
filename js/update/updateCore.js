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

/* ---------------- 事务锁（P1-1） ----------------
 * 同一时刻只允许一个"修改主模型"的更新事务（下载安装 / 待生效应用 / 恢复备份）。
 * 纯状态、无副作用，便于 Node 侧直接验证。 */
export const createTransactionLock = () => {
    let locked = false;
    return {
        acquire() { if (locked) return false; locked = true; return true; },
        release() { locked = false; },
        isLocked() { return locked; },
    };
};

/* ---------------- 应用闸门（P1-2） ----------------
 * 更新开始前与真正替换前都必须过这道闸门。
 * 保守策略：无法确认模型状态 / 训练状态时一律不放过（不能默认允许覆盖）。
 * 说明：专项模型（modeModelStore）使用独立存储与独立模型实例，不修改共享主模型，
 *       故不在此阻塞；本地训练器（localTrainer）会原地改写共享主模型，必须阻塞。 */
export const evaluateApplyGate = opt => {
    const { modelState, modelStateKnown, isTraining, trainerKnown, hasCandidate,
        inGame, inGameKnown, hasActiveEvent, over } = opt || {};
    if (modelStateKnown === false) return { ok: false, reason: '无法确认模型状态，已保守跳过' };
    if (modelState != null && modelState !== 'stable') return { ok: false, reason: '模型状态为 ' + modelState + '（训练或 A/B 试用进行中）' };
    if (trainerKnown === false) return { ok: false, reason: '无法确认本地训练状态，已保守跳过' };
    if (isTraining === true) return { ok: false, reason: '本地训练正在进行中' };
    if (hasCandidate === true) return { ok: false, reason: '存在未完成的 A/B 候选模型' };
    if (over === true) return { ok: true };
    if (inGameKnown === true) return inGame ? { ok: false, reason: '对局进行中' } : { ok: true };
    if (hasActiveEvent) return { ok: false, reason: '对局进行中' };
    return { ok: true };
};

/* ---------------- 官方权重记录（P1-4） ----------------
 * 权重与版本元数据视为同一事务：记录写入后必须读回核对，
 * 失败时不得报告完整成功。 */
export const buildOfficialRecord = opt => {
    const { modelId, bundle, digest, size, contract, appliedAt } = opt || {};
    return {
        version: OFFICIAL_RECORD_VERSION,
        modelId,
        modelVersion: bundle.modelVersion,
        releaseSeq: normalizeReleaseSeq(bundle.releaseSeq),
        schemaVersion: bundle.schemaVersion,
        dataEpoch: contract.dataEpoch,
        sha256: String(digest || bundle.sha256 || '').toLowerCase(),
        size: Number(size) || Number(bundle.size) || 0,
        appliedAt: Number(appliedAt) || Date.now(),
        source: 'official-online',
    };
};

export const verifyOfficialRecord = (got, want) => {
    const errors = [];
    if (!got || typeof got !== 'object') return ['官方权重记录读回为空'];
    if (got.modelId !== want.modelId) errors.push('记录 modelId 不符');
    if (String(got.modelVersion) !== String(want.modelVersion)) errors.push('记录 modelVersion 不符');
    if (normalizeReleaseSeq(got.releaseSeq) !== normalizeReleaseSeq(want.releaseSeq)) errors.push('记录 releaseSeq 不符');
    if (String(got.sha256 || '').toLowerCase() !== String(want.sha256 || '').toLowerCase()) errors.push('记录 sha256 不符');
    if (Number(got.size) !== Number(want.size)) errors.push('记录 size 不符');
    if (Number(got.schemaVersion) !== Number(want.schemaVersion)) errors.push('记录 schemaVersion 不符');
    return errors;
};

/* ---------------- 官方记录形状校验（供 asOfficialRecord 复用） ---------------- */
export const isOfficialRecordShape = (obj, modelId) => {
    if (!obj || typeof obj !== 'object') return false;
    if (obj.modelId !== modelId || typeof obj.modelVersion !== 'string') return false;
    if (!Number.isFinite(Number(obj.releaseSeq))) return false;
    return true;
};

/* ---------------- 导出工具兼容性判定（P1-5） ----------------
 * 工作台导出权重前的硬校验（纯逻辑，供 tools/export-weights.mjs 与测试共用同一实现）：
 *  - 结构版本不一致 → 拒绝（本工具不提供结构迁移，禁止改元数据冒充新模型）；
 *  - 数据纪元低于目标 → 默认拒绝；仅显式允许迁移且提供依据时才放行；
 *  - 内置默认权重（isFromDefault）是当前结构版本的基线模型 → 按可验证基线放行。
 * 返回 { ok, epochMigration|null, reason }。 */
export const evaluateExportCompatibility = opt => {
    const { inputV, inputDv, schemaVersion, dataEpoch, isFromDefault, allowEpochMigration, migrationNote } = opt || {};
    if (inputV !== undefined && inputV !== null && Number(inputV) !== Number(schemaVersion)) {
        return {
            ok: false, epochMigration: null,
            reason: '输入结构版本 v' + inputV + ' 与目标结构版本 v' + schemaVersion + ' 不一致：本工具不提供结构迁移，'
                + '禁止仅改元数据冒充新模型；请用与目标结构一致的权重（--from-default 或当前工作台同结构导出）',
        };
    }
    if (inputDv !== undefined && inputDv !== null && Number(inputDv) < Number(dataEpoch)) {
        if (isFromDefault) {
            return {
                ok: true,
                epochMigration: { from: Number(inputDv), to: Number(dataEpoch), reason: '内置默认权重为当前结构版本的基线模型（参数对当前结构有效），仅 dataEpoch 元数据陈旧' },
                reason: '',
            };
        }
        if (allowEpochMigration) {
            if (!migrationNote || migrationNote === true || !String(migrationNote).trim()) {
                return { ok: false, epochMigration: null, reason: '--allow-epoch-migration 必须同时提供 --migration-note <说明>（记录迁移依据，便于审计）' };
            }
            return { ok: true, epochMigration: { from: Number(inputDv), to: Number(dataEpoch), reason: String(migrationNote) }, reason: '' };
        }
        return {
            ok: false, epochMigration: null,
            reason: '输入数据纪元 dv=' + inputDv + ' < 目标纪元 ' + dataEpoch + '：客户端 loadWeights 会拒载 dv 过旧的存档，'
                + '这类包发布出去不会生效；如确认参数对当前结构有效，请显式加 --allow-epoch-migration 并附 --migration-note <依据>',
        };
    }
    return { ok: true, epochMigration: null, reason: '' };
};

/* ---------------- 存档完整性分类（P2-1） ----------------
 * 摘要不同 ≠ 用户训练：必须结合"存档结构有效性 + 来源记录 + 训练证据"判断。
 * 返回 { state, reason, digest }；state 取值：
 *   none 无官方记录 | unknown 契约不可用 | ok 一致
 *   broken   存档结构无效/缺失/回退默认（损坏或丢失，可重新获取修复）
 *   superseded 结构有效但确为本地训练成果（正常，非异常）
 *   mismatch 结构有效但无法判定是训练还是外部改写（保守，绝不自动覆盖） */
export const classifyIntegrityArchive = opt => {
    const { raw, contract, officialRec, hasTrainingEvidence, defaultDigest } = opt || {};
    if (!officialRec) return { state: 'none' };
    if (!contract) return { state: 'unknown', reason: '运行时契约不可用' };
    if (!raw) return { state: 'broken', reason: '官方权重记录存在，但权重存档缺失（运行时已回退内置默认模型）' };
    let obj = null;
    try { obj = JSON.parse(raw); } catch (e) { return { state: 'broken', reason: '权重存档无法解析（可能已损坏）' }; }
    if (!obj || typeof obj !== 'object') return { state: 'broken', reason: '权重存档为空' };
    if (obj.v !== contract.schemaVersion) return { state: 'broken', reason: '权重存档网络结构版本不符' };
    if (Number(obj.dv || 0) < contract.dataEpoch) return { state: 'broken', reason: '权重存档数据纪元 ' + obj.dv + ' 过旧（会被拒载）' };
    const spec = paramSpec(contract.dims);
    const params = {};
    for (let i = 0; i < spec.length; i++) {
        const s = spec[i];
        const bytes = decodeBase64(obj[s.key]);
        const need = s.kind === 'int16' ? s.len * 2 : s.len;
        if (!bytes || bytes.byteLength !== need) return { state: 'broken', reason: '存档参数 ' + s.key + ' 缺失或长度不符' };
        const typed = bytesToTyped(bytes, s);
        if (!typed) return { state: 'broken', reason: '存档参数 ' + s.key + ' 类型不符' };
        for (let k = 0; k < typed.length; k++) {
            if (!Number.isFinite(typed[k])) return { state: 'broken', reason: '存档参数 ' + s.key + ' 含非法数值（疑似损坏）' };
        }
        params[s.key] = obj[s.key];
    }
    const digest = paramsDigest(params, contract.dims);
    if (!digest) return { state: 'broken', reason: '存档参数无法计算摘要' };
    const officialDigest = String(officialRec.sha256 || '').toLowerCase();
    if (digest !== officialDigest) {
        /* 与内置默认一致 → 官方权重已丢失/未生效（属损坏，可重新获取） */
        if (defaultDigest && digest === String(defaultDigest).toLowerCase()) {
            return { state: 'broken', reason: '当前权重已回退为内置默认模型（官方权重丢失或未生效）', digest };
        }
        if (hasTrainingEvidence) {
            return { state: 'superseded', reason: '当前生效模型已不是该官方权重（本地训练成果已生效）', digest };
        }
        return {
            state: 'mismatch', digest,
            reason: '权重存档结构有效，但内容与官方记录不一致：可能是你的本地训练成果，也可能是存档被外部改写或损坏（无法自动判定）',
        };
    }
    return { state: 'ok', digest };
};

/* ---------------- 下载体积上限（P2-3） ----------------
 * 由网络维度派生：参数原始字节 × base64 膨胀(4/3) × 余量 + 元数据开销，
 * 并对未来更大模型留出充裕空间（不会把合法模型误拒）。 */
export const computeMaxBundleBytes = dims => {
    const spec = paramSpec(dims);
    let total = 0;
    for (let i = 0; i < spec.length; i++) total += (spec[i].kind === 'int16' ? spec[i].len * 2 : spec[i].len);
    return Math.max(512 * 1024, Math.ceil(total * 4 / 3) * 24 + 64 * 1024);
};
/* 清单体积上限（清单只含元数据，远小于权重包） */
export const MAX_MANIFEST_BYTES = 256 * 1024;

/* ---------------- 网络收口（P2-2 / P2-3） ----------------
 * 超时必须覆盖"完整下载过程"（含响应正文读取），而非仅到拿到响应为止；
 * 同时做体积预检（Content-Length 与实际正文长度），防止异常大响应撑爆内存。
 * fetch / AbortController / sleep 全部注入，便于在 Node 侧用假对象覆盖超时、
 * 正文中断、体积异常等故障路径。 */
export const fetchTextWithLimits = async opt => {
    const { url, fetchImpl, AbortControllerImpl, timeoutMs, retries, maxBytes, sleep, backoffMs } = opt || {};
    if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持网络请求');
    const total = Number.isFinite(retries) ? retries : 0;
    let lastErr = null;
    for (let attempt = 0; attempt <= total; attempt++) {
        if (attempt > 0 && typeof sleep === 'function') await sleep((Number(backoffMs) || 800) * attempt);
        const ctl = (typeof AbortControllerImpl === 'function') ? new AbortControllerImpl() : null;
        let timedOut = false;
        const timer = ctl ? setTimeout(() => { timedOut = true; try { ctl.abort(); } catch (e) {} }, Number(timeoutMs) || 12000) : null;
        try {
            const res = await fetchImpl(url, ctl ? { signal: ctl.signal } : undefined);
            if (res && res.ok === false) throw new Error('HTTP ' + res.status);
            if (res && res.headers && typeof res.headers.get === 'function') {
                const cl = Number(res.headers.get('content-length'));
                if (Number.isFinite(cl) && cl > Number(maxBytes)) throw new Error('响应体积超限（Content-Length ' + cl + ' > ' + maxBytes + '）');
            }
            if (!res || typeof res.text !== 'function') throw new Error('响应不可读');
            const text = await res.text();   /* ← 正文读取同样处于超时保护内 */
            if (typeof text !== 'string') throw new Error('响应正文读取失败');
            if (Number.isFinite(Number(maxBytes)) && text.length > Number(maxBytes)) throw new Error('响应体积超限（' + text.length + ' > ' + maxBytes + '）');
            return text;
        } catch (e) {
            lastErr = timedOut ? new Error('请求超时（' + timeoutMs + 'ms，含正文读取）') : e;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }
    throw lastErr || new Error('请求失败');
};
