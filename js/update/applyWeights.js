/*
 * ============================================
 * // 作者：飞升原创
 * 交流群：1080487560
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 无名AI · 官方权重安全应用（纯编排层） =================
 * 流程（任一环节失败都必须恢复旧模型）：
 *   读取现有状态 → 备份原有模型 → 写入待生效模型 → 落盘 → 读回校验 → 前向自检 → 记录版本
 *
 * 设计要点：
 *  - 只通过注入的 bridge / storageOps 与宿主交互，因此可在 Node 侧用假对象
 *    对「快照 / 持久化 / 版本判断 / 回滚」做自动化测试；
 *  - 写入模型时**显式清零 AdamW 动量与时间步**：官方权重是成品，
 *    沿用与新权重不匹配的动量会污染后续本地训练；
 *  - 绝不信任 saveWeights() 的返回值，必须读回存档逐项核对；
 *  - 任何失败都 restoreModel(备份) 并再次落盘，绝不留下半成品或随机参数。
 */
import { encodeBase64, decodeBase64, paramSpec, paramsDigest } from './weightBundle.js?v=41a';
import {
    buildBackupRecord, verifyBackupRecord, BACKUP_KIND_PARAMS,
    generateTxId, buildTxJournal, classifyInterruptedTx, verifyStagingForTx, planTxRecovery, digestOfArchive,
    decodeBackupParams, backupRecordToBundleLike, restoreOfficialRecord, combineRollbackStatus,
} from './updateCore.js?v=41a';

/* 在线快照键 → 权重包参数键（对应 weights.js __snapshotModel 的契约） */
export const SNAP_TO_PARAM = {
    W1: 'w1', B1: 'b1', W2: 'w2', B2: 'b2', W3: 'w3', B3: 'b3',
    W4: 'w4', B4: 'b4', W_proj1: 'pr1', W_proj2: 'pr2',
};
/* 参数键 → 在线快照键（写入待生效模型时用） */
const PARAM_TO_SNAP = {
    w1: 'W1', b1: 'B1', w2: 'W2', b2: 'B2', w3: 'W3', b3: 'B3',
    w4: 'W4', b4: 'B4', pr1: 'W_proj1', pr2: 'W_proj2',
};
/* AdamW 优化器状态键 → 形状来源（对应 weights.js __restoreModel 的动量契约） */
const OPTIMIZER_MAP = [
    ['mW1', 'W1'], ['mB1', 'B1'], ['mW2', 'W2'], ['mB2', 'B2'], ['mW3', 'W3'], ['mB3', 'B3'],
    ['mW4', 'W4'], ['mB4', 'B4'], ['mW_proj1', 'W_proj1'], ['mW_proj2', 'W_proj2'],
    ['vW1', 'W1'], ['vB1', 'B1'], ['vW2', 'W2'], ['vB2', 'B2'], ['vW3', 'W3'], ['vB3', 'B3'],
    ['vW4', 'W4'], ['vB4', 'B4'], ['vW_proj1', 'W_proj1'], ['vW_proj2', 'W_proj2'],
];

const _toBytes = arr => {
    if (!arr || typeof arr.length !== 'number') return null;
    try { return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); } catch (e) { return null; }
};

/* 在线快照 → 参数 base64 集合（float32 隔离态不参与，返回 null 表示"不可判定"） */
export const snapshotToParams = snap => {
    if (!snap || snap.parameterFormat === 'float32-v1') return null;
    const out = {};
    for (const k in SNAP_TO_PARAM) {
        const bytes = _toBytes(snap[k]);
        if (!bytes) return null;
        out[SNAP_TO_PARAM[k]] = encodeBase64(bytes);
    }
    return out;
};

export const paramsEqual = (a, b, dims) => {
    if (!a || !b) return false;
    const ha = paramsDigest(a, dims), hb = paramsDigest(b, dims);
    return !!ha && ha === hb;
};

/* ★ 用户本地训练成果判定：
 *   绝不能用 META.trained 判断（内置默认权重本身就 trained=181832），
 *   只能用"当前生效权重与内置默认 / 上次官方权重的内容比较"来判断。
 *   officialDigest：上次官方权重的 sha256（来自官方记录，无需再存一份权重）。 */
export const detectUserModel = ({ activeParams, defaultParams, officialDigest, dims }) => {
    const ha = activeParams ? paramsDigest(activeParams, dims) : null;
    const hd = defaultParams ? paramsDigest(defaultParams, dims) : null;
    const ho = officialDigest ? String(officialDigest).toLowerCase() : null;
    if (!ha || !hd) return { known: false, isUserModel: false, sameAsDefault: false, sameAsOfficial: false };
    const sameAsDefault = ha === hd;
    const sameAsOfficial = !!ho && ha === ho;
    return { known: true, isUserModel: !sameAsDefault && !sameAsOfficial, sameAsDefault, sameAsOfficial };
};

/* 组装"待生效快照"：换入官方权重 + 清零优化器状态 + 写入新 META */
export const buildAppliedSnapshot = (decoded, dims, bundle, baseMeta) => {
    const snap = {
        META: {
            version: (baseMeta && baseMeta.version) || 0,
            trained: Number(bundle.trained) || 0,
            accuracy: Number(bundle.accuracy) || 0,
            ready: true,
        },
    };
    const spec = paramSpec(dims);
    for (let i = 0; i < spec.length; i++) snap[PARAM_TO_SNAP[spec[i].key]] = decoded[spec[i].key];
    for (let i = 0; i < OPTIMIZER_MAP.length; i++) {
        const w = snap[OPTIMIZER_MAP[i][1]];
        if (w) snap[OPTIMIZER_MAP[i][0]] = new Float32Array(w.length);   /* 动量/二阶矩清零 */
    }
    snap.adamT = 0;
    return snap;
};

/* 读回存档逐项核对：返回 errors 数组（空数组 = 完全一致） */
const verifyArchive = (raw, expectedParams, dims, expectedEpoch) => {
    const errors = [];
    if (!raw) return ['无法读回权重存档（设备可能没有可用的持久化存储）'];
    let obj = null;
    try { obj = JSON.parse(raw); } catch (e) { return ['读回的权重存档无法解析：' + ((e && e.message) || e)]; }
    if (!obj || typeof obj !== 'object') return ['读回的权重存档为空'];
    const de = Number(obj.dv || 0);
    if (Number.isFinite(expectedEpoch) && de < expectedEpoch) errors.push('存档数据纪元 ' + de + ' 低于运行时 ' + expectedEpoch + '（重启后会被拒载）');
    const spec = paramSpec(dims);
    for (let i = 0; i < spec.length; i++) {
        const s = spec[i];
        const got = decodeBase64(obj[s.key]);
        const want = decodeBase64(expectedParams[s.key]);
        const need = s.kind === 'int16' ? s.len * 2 : s.len;
        if (!got) { errors.push('存档缺少参数 ' + s.key); continue; }
        if (got.byteLength !== need) { errors.push('存档参数 ' + s.key + ' 字节数 ' + got.byteLength + ' ≠ ' + need); continue; }
        if (!want || want.byteLength !== got.byteLength) { errors.push('期望参数 ' + s.key + ' 不可比'); continue; }
        for (let k = 0; k < got.byteLength; k++) {
            if (got[k] !== want[k]) { errors.push('存档参数 ' + s.key + ' 第 ' + k + ' 字节不一致'); break; }
        }
    }
    return errors;
};

/* 确定性小输入：用于无探针时的前向有限性自检 */
const deterministicInput = n => {
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = ((i % 13) - 6);
    return f;
};

/* 前向自检：返回 errors 数组 */
const forwardCheck = (bridge, dims, probe) => {
    const errors = [];
    if (typeof bridge.forward !== 'function') return errors;   /* 无前向能力时跳过（不算失败） */
    let out = null;
    try { out = bridge.forward(probe && probe.input ? Float32Array.from(probe.input) : deterministicInput(dims[0])); } catch (e) { return ['前向自检抛出异常：' + ((e && e.message) || e)]; }
    if (!out || typeof out.length !== 'number' || out.length !== dims[3]) return ['前向自检输出结构异常'];
    for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) { errors.push('前向输出第 ' + i + ' 项为 NaN/Infinity'); break; }
    }
    if (probe && Number.isInteger(probe.expectTop)) {
        let best = 0;
        for (let i = 1; i < out.length; i++) if (out[i] > out[best]) best = i;
        if (best !== probe.expectTop) errors.push('前向自检标签不符：得到 ' + best + '，期望 ' + probe.expectTop);
    }
    return errors;
};

/* ---------- 备份落盘 + 读回校验（P0-1 / P2-1） ----------
 * 绝不相信 writeBackup() 的返回值，也绝不在失败后继续：
 * 写入返回 false / 抛异常 / 读回失败 / 内容损坏 / 摘要不一致 → 一律判定失败。
 * ★ P2-1：安装事务先写"暂存备份"，只有整体成功后才轮换到长期恢复点 BACKUP_KEY，
 *   从而绝不在安装未成功时提前销毁用户原有的恢复点。 */
const writeBackupVerified = (storageOps, writeKey, readKey, record, dims) => {
    const writeFn = storageOps && storageOps[writeKey];
    const readFn = storageOps && storageOps[readKey];
    if (typeof writeFn !== 'function') return { ok: false, errors: ['缺少备份写入能力，无法在更新前保存原有模型'] };
    let wrote = false;
    try { wrote = storageOps[writeKey](record) !== false; } catch (e) { return { ok: false, errors: ['备份写入抛出异常：' + ((e && e.message) || e)] }; }
    if (!wrote) return { ok: false, errors: ['备份写入失败（存储不可用或配额不足）'] };
    if (typeof readFn !== 'function') return { ok: false, errors: ['缺少备份读回能力，无法确认备份已持久化'] };
    let back = null;
    try { back = storageOps[readKey](); } catch (e) { return { ok: false, errors: ['备份读回抛出异常：' + ((e && e.message) || e)] }; }
    if (!back) return { ok: false, errors: ['备份读回失败（写入后无法读回）'] };
    const errs = verifyBackupRecord(back, record, dims);
    if (errs.length) return { ok: false, errors: errs };
    return { ok: true };
};

/* ---------- 运行时状态比对（P1-2） ----------
 * 写入失败后，判断是否已经发生"部分修改"：参数、优化器状态、时间步、元数据
 * 任一与写入前快照不同，就必须回滚，不能声称"旧模型未受影响"。 */
const _typedEqual = (a, b) => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
};
export const runtimeStateDiff = (live, snapshot, dims) => {
    const diffs = [];
    if (!live || !snapshot) return ['运行时快照不可读'];
    const lp = snapshotToParams(live), sp = snapshotToParams(snapshot);
    if (!lp || !sp) diffs.push('在线参数不可读');
    else if (!paramsEqual(lp, sp, dims)) diffs.push('模型参数已被改写');
    for (let i = 0; i < OPTIMIZER_MAP.length; i++) {
        const k = OPTIMIZER_MAP[i][0];
        if (!_typedEqual(live[k], snapshot[k])) { diffs.push('优化器状态 ' + k + ' 已被改写'); break; }
    }
    if (live.adamT !== snapshot.adamT) diffs.push('AdamW 时间步已被改写');
    const lm = live.META || {}, sm = snapshot.META || {};
    if (lm.trained !== sm.trained || lm.accuracy !== sm.accuracy || !!lm.ready !== !!sm.ready) diffs.push('模型元数据已被改写');
    return diffs;
};

/* ---------- 主流程 ----------
 * mode = 'install'（默认）：暂存备份 → 应用权重 → 提交官方记录 → 轮换长期备份 → 清理事务；
 * mode = 'restore'        ：恢复历史备份 → 清除官方记录 → 清理事务；**绝不写入/覆盖任何备份**。
 *
 * ★ P0-1 事务一致性：
 *   - 每次安装/恢复都携带唯一 `txId`；暂存备份记录该 txId；
 *   - 回滚只使用**本次事务**创建并校验过的内存快照 / 暂存备份，
 *     绝不直接读取可能属于历史事务的长期备份（BACKUP_KEY）；
 *   - "提交官方记录"与"轮换长期备份"都是**必要提交步骤**，任一失败即回滚且不报完整成功；
 *   - 单键事务日志记录阶段，供崩溃后重启识别与恢复。
 * ★ P0-2 重新授权安全：
 *   - 最终授权复核若发现模型已变化，必须**重新建立事务基线**（重取快照 + 重写并校验暂存备份），
 *     绝不复用已过期的旧快照/旧备份；重复变化超过上限则中止，不做无限重试。 */
const MAX_REBASE = 2;

const _journalWrite = (storageOps, journal) => {
    try { return !!(storageOps && typeof storageOps.writeTx === 'function' && storageOps.writeTx(journal) !== false); } catch (e) { return false; }
};
const _journalRead = storageOps => {
    try { return (storageOps && typeof storageOps.readTx === 'function') ? storageOps.readTx() : null; } catch (e) { return null; }
};
const _journalClear = storageOps => {
    try { if (storageOps && typeof storageOps.removeTx === 'function') storageOps.removeTx(); } catch (e) {}
};
/* ★ P0-2：写事务日志必须"写入 + 读回核验"才算成功——
 * 单键写入也可能失败/被吞，读回的阶段与事务标识必须与写入内容一致；
 * 读回抛异常、返回空、内容不符 → 一律视为失败（保守，不进入权重替换）。 */
const _journalWriteVerified = (storageOps, journal) => {
    if (!_journalWrite(storageOps, journal)) return false;
    const back = _journalRead(storageOps);
    if (!back || typeof back !== 'object') return false;
    return String(back.txId || '') === String(journal.txId || '') && String(back.phase || '') === String(journal.phase || '');
};
/* 删除事务日志同样要读回核验消失（删除失败/读回异常/读回仍有值 → 一律未清理）。
 * ★ P2 补丁：读回必须"成功执行且确认为空"才算清理成功——
 *   读取抛异常绝不允许被当作"键已不存在"（与官方记录删除核验同一原则），
 *   失败时由调用方保留暂存备份等数据，留待下次启动安全处理。 */
const _journalRemoveVerified = storageOps => {
    try {
        if (!storageOps || typeof storageOps.removeTx !== 'function' || typeof storageOps.readTx !== 'function') return false;
        if (storageOps.removeTx() === false) return false;
    } catch (e) { return false; }
    try {
        const back = storageOps.readTx();
        return back === null || back === undefined;
    } catch (e) { return false; }
};

export const applyOfficialBundle = async ctx => {
    const { bridge, storageOps, bundle, decoded, dims, probe, runtimeEpoch, schemaVersion, onStep,
        mode = 'install', preserveUserModel = false, confirmBeforeWrite = null,
        commitRecord = null, revertRecord = null, txId = null, prevOfficialRecord } = ctx || {};
    const isRestore = mode === 'restore';
    const step = m => { try { if (onStep) onStep(m); } catch (e) {} };
    const errors = [];
    const tx = txId ? String(txId) : generateTxId();
    /* ★ P0-1：安装前的官方记录快照是可信恢复信息的一部分（null = 已知"安装前无记录"；
     *   调用方未提供该键 → 日志缺省该字段，崩溃恢复将保守拒绝"回滚+恢复记录"）。 */
    const prevRecordInfo = (ctx && Object.prototype.hasOwnProperty.call(ctx, 'prevOfficialRecord'))
        ? (prevOfficialRecord && typeof prevOfficialRecord === 'object' ? Object.assign({}, prevOfficialRecord) : null)
        : undefined;

    /* 如实反馈的状态位，绝不谎报 */
    let backupWritten = false, backupRotated = false, partialWrite = false, journalWritten = false;
    let journalDegraded = false, cleanupPending = false;
    const fail = (list, failedAt, extra) => Object.assign({
        ok: false, rolledBack: false, errors: Array.isArray(list) ? list : [list],
        digest: null, size: 0, mode: isRestore ? 'restore' : 'install', txId: tx,
        backupWritten, backupRotated, partialWrite, journalWritten,
        journalDegraded, cleanupPending,
        rollbackStatus: 'none', failedAt: failedAt || 'precheck',
    }, extra || {});

    if (!bridge || !decoded || !bundle) return fail('缺少必要参数');

    /* 暂存备份与事务日志属于**安装事务**；恢复模式绝不触碰它们
     * （恢复既可能是独立操作，也可能是安装事务崩溃后的恢复动作）。 */
    const discardStaging = () => {
        if (isRestore) return;
        try { if (storageOps && typeof storageOps.removeStagingBackup === 'function') storageOps.removeStagingBackup(); } catch (e) {}
    };
    /* ★ P0-2：清理顺序必须是「先删日志（读回核验）、再删暂存备份」——
     *   日志里可能仍标记着非终态阶段；若先删暂存而日志残留，下次启动会把
     *   "完整事务的清理残留"误判为需要回滚。日志删除失败时保留暂存，
     *   使下次启动仍能沿 settle 路径（补轮换/清理）安全收尾。 */
    const cleanupTx = () => {
        if (isRestore) return;
        if (!_journalRemoveVerified(storageOps)) { cleanupPending = true; return; }
        discardStaging();
    };
    /* 中止后清理：回滚不完整时保留事务数据（仍有恢复价值）并标记需人工处理。
     * 人工标记日志沿用事务信息（含 install 前的官方记录快照），不丢失恢复依据。 */
    const cleanupAfterAbort = rbOk => {
        if (rbOk) { cleanupTx(); return; }
        cleanupPending = true;
        try {
            const mark = buildTxJournal({
                txId: tx, phase: 'weights-written', needsManual: true,
                baseDigest, targetDigest, schemaVersion, dataEpoch: runtimeEpoch,
                startedAt: Date.now(), prevRecord: prevRecordInfo,
                reason: '上次事务回滚未完成，已保留暂存备份与事务日志供恢复',
            });
            _journalWrite(storageOps, mark);
        } catch (e) {}
    };
    const safeRevertRecord = async () => {
        if (typeof revertRecord !== 'function') return [];
        try {
            const r = await revertRecord();
            return (r && r.ok === false) ? (r.errors || ['版本记录回滚未确认']) : [];
        } catch (e) { return ['版本记录回滚抛出异常：' + ((e && e.message) || e)]; }
    };

    /* ===== 建立事务基线（快照 + 暂存备份 + 最终授权复核），支持重新授权后重建 ===== */
    let snapshot = null, snapshotParams = null, snapshotMeta = null, stagingRecord = null, applied = null;
    let rebaseCount = 0;
    for (;;) {
        try { snapshot = bridge.snapshotModel(); } catch (e) { snapshot = null; }
        if (!snapshot) return fail('无法获取当前模型快照，已中止（未做任何改动）');
        snapshotParams = snapshotToParams(snapshot);
        snapshotMeta = (bridge.getMeta && bridge.getMeta()) || null;

        if (!isRestore) {
            if (!snapshotParams) return fail('当前模型为隔离态（float32-v1），无法导出参数用于在线备份，已中止（未做任何改动）');
            stagingRecord = buildBackupRecord({
                params: snapshotParams, meta: snapshotMeta, dims,
                schemaVersion, dataEpoch: runtimeEpoch, savedAt: Date.now(), txId: tx,
            });
            const wb = writeBackupVerified(storageOps, 'writeStagingBackup', 'readStagingBackup', stagingRecord, dims);
            if (!wb.ok) {
                const prefix = preserveUserModel
                    ? '检测到本地训练成果，但无法安全备份，已中止（未做任何改动，你的模型保持生效）：'
                    : '更新前无法安全备份原有模型，已中止（未做任何改动）：';
                _journalClear(storageOps);
                return fail(prefix + wb.errors.join('；'), 'backup');
            }
            backupWritten = true;
        }

        try { applied = buildAppliedSnapshot(decoded, dims, bundle, snapshot.META || {}); } catch (e) { applied = null; }
        if (!applied) { cleanupTx(); return fail('组装待生效模型失败'); }

        if (typeof confirmBeforeWrite === 'function') {
            const baseDigest = snapshotParams ? paramsDigest(snapshotParams, dims) : null;
            let g = null;
            try { g = await confirmBeforeWrite({ txId: tx, snapshotDigest: baseDigest }); } catch (e) { g = null; }
            const ok = (g === true) || (g && g.ok === true);
            if (!ok) { cleanupTx(); return fail('最终状态复核未通过（对局或训练进行中，或模型已变化），已中止（未做任何改动）', 'gate'); }
            if (g && g.rebaseline === true) {
                /* ★ P0-2：授权期间模型已变化 → 丢弃旧基线，重新取快照 + 重写并校验暂存备份 */
                if (++rebaseCount > MAX_REBASE) {
                    cleanupTx();
                    return fail('授权确认期间模型反复变化，已中止（未做任何改动），请稍后重试', 'gate');
                }
                discardStaging();
                continue;
            }
        }
        break;
    }

    /* 事务日志：基线已就绪（暂存备份已写入并读回校验）；恢复模式不写日志。
     * ★ P0-2：prepared 日志必须**写入并读回核验成功**，才能进入权重替换阶段；
     *   写失败/抛异常/读回失败/内容不符 → 拒绝继续（模型未被任何操作触碰）。 */
    const baseDigest = snapshotParams ? paramsDigest(snapshotParams, dims) : null;
    const targetDigest = String(bundle.sha256 || '').toLowerCase();
    const journalFor = phase => buildTxJournal({
        txId: tx, phase, baseDigest, targetDigest,
        modelVersion: bundle.modelVersion, releaseSeq: bundle.releaseSeq,
        schemaVersion, dataEpoch: runtimeEpoch, startedAt: Date.now(), prevRecord: prevRecordInfo,
    });
    if (!isRestore) {
        journalWritten = _journalWriteVerified(storageOps, journalFor('prepared'));
        if (!journalWritten) {
            _journalRemoveVerified(storageOps);   /* 清掉可能残留的半写日志（模型未动，无恢复价值） */
            discardStaging();
            step('事务恢复日志写入失败，已中止');
            return fail('事务恢复日志写入失败或读回核验未通过（存储不可用/配额不足），无法保证崩溃恢复能力，已中止（未做任何改动）', 'journal');
        }
    }

    /* 回滚：errors = 未能确认回滚；notes = 已回滚但需如实告知的限制（不算失败）
     * ★ 只使用本次事务的内存快照，绝不读取长期备份。 */
    const rollback = () => {
        const rErrors = [], notes = [];
        try {
            if (bridge.restoreModel(snapshot) === false) rErrors.push('restoreModel 拒绝还原快照');
        } catch (e) { rErrors.push('还原快照抛出异常：' + ((e && e.message) || e)); }
        try { bridge.saveWeights(); } catch (e) {}
        if (snapshotParams && storageOps && storageOps.readArchive) {
            const raw = storageOps.readArchive();
            if (!raw) {
                notes.push('设备无可用持久化存储：回滚仅在内存中生效，重启后会以运行时默认模型加载');
            } else {
                const ar = verifyArchive(raw, snapshotParams, dims, runtimeEpoch);
                if (ar.length) rErrors.push('回滚后存档校验未通过：' + ar.join('；'));
            }
        }
        /* 还原后再次核对在线内存 + 优化器状态 + 元数据，确保不是"只恢复了参数" */
        try {
            const live = bridge.snapshotModel();
            const diffs = runtimeStateDiff(live, snapshot, dims);
            if (diffs.length) rErrors.push('回滚后运行时状态与快照不一致：' + diffs.join('、'));
        } catch (e) { rErrors.push('回滚后运行时状态无法核对'); }
        step(rErrors.length ? ('回滚未完全确认：' + rErrors.join('；')) : '已回滚到原有模型');
        return { errors: rErrors, notes };
    };

    /* ★ P1-2：完整回滚 = 模型状态恢复成功 **且** 官方记录恢复成功。
     *   任何一项失败都不得返回 complete；rolledBack / rollbackStatus / rollbackErrors
     *   三者始终由同一判定合成（用户弹窗一律引用 rollbackStatus）。 */
    const rollbackVerdict = (rb, recErrors) => {
        const modelOk = !rb || rb.errors.length === 0;
        const recErrs = recErrors || [];
        return {
            ok: modelOk && recErrs.length === 0,
            status: combineRollbackStatus(modelOk, recErrs.length === 0),
            errors: ((rb && rb.errors) || []).concat(recErrs),
        };
    };
    /* 回滚后清理：仅"完整回滚"（模型 + 记录）才允许清除事务数据 */
    const finishAbort = (rb, recErrors, failedAt, list, partial) => {
        const v = rollbackVerdict(rb, recErrors);
        cleanupAfterAbort(v.ok);
        return fail(list, failedAt, {
            partialWrite: !!partial, rolledBack: v.ok, rollbackStatus: v.status,
            rollbackErrors: v.errors, notes: rb ? rb.notes : undefined,
        });
    };

    /* 4) 写入（可能部分修改后失败/抛异常 → 必须检测并回滚） */
    let wrote = false, writeThrew = null;
    try { wrote = bridge.restoreModel(applied) !== false; } catch (e) { writeThrew = e; wrote = false; }
    if (!wrote) {
        let diffs = null;
        try { diffs = runtimeStateDiff(bridge.snapshotModel(), snapshot, dims); } catch (e) { diffs = null; }
        if (diffs === null) {
            /* 无法确认是否发生部分修改 → 必须回滚并如实报告风险 */
            const rb = rollback();
            return finishAbort(rb, null, 'write',
                ['写入新权重失败且无法确认是否已部分修改（' + ((writeThrew && writeThrew.message) || '结构不兼容') + '）',
                    '已尝试回滚：' + (rb.errors.length ? rb.errors.join('；') : '完成')],
                true);
        }
        if (!diffs.length) {
            /* 确认未发生任何修改 → 无需回滚，如实说明 */
            cleanupTx();
            return fail('写入新权重被模型拒绝（结构不兼容），已确认运行时状态未发生任何变化', 'write');
        }
        /* 已发生部分修改 → 立即回滚 */
        const rb = rollback();
        return finishAbort(rb, null, 'write',
            ['写入新权重失败（' + ((writeThrew && writeThrew.message) || '返回 false') + '）且已发生部分修改：' + diffs.join('、'),
                rb.errors.length ? ('回滚未完全确认：' + rb.errors.join('；')) : '已回滚到原有模型'],
            true);
    }
    step('新权重已写入在线模型');
    if (!isRestore) {
        /* ★ P0-2：阶段推进失败时——模型内存已被改写（尚未落盘），
         *   没有可靠恢复信息 → 不允许继续，立即安全回滚并中止。 */
        if (!_journalWriteVerified(storageOps, journalFor('weights-written'))) {
            const rb = rollback();
            return finishAbort(rb, null, 'journal',
                ['事务恢复日志推进失败（weights-written），已在无可靠恢复信息的情况下安全回滚并中止']
                    .concat(rb.errors.length ? ['回滚未完全确认：' + rb.errors.join('；')] : ['已回滚到原有模型']),
                false);
        }
    }

    /* 5) 落盘（返回值不可信，仅作提示） */
    try { bridge.saveWeights(); } catch (e) {}

    /* 6) 读回校验：确认持久化结果，而不是相信 saveWeights() 的返回 */
    if (!storageOps || typeof storageOps.readArchive !== 'function') {
        errors.push('缺少存档读回能力，无法确认持久化结果');
    } else {
        const ar = verifyArchive(storageOps.readArchive(), bundle.params, dims, runtimeEpoch);
        for (let i = 0; i < ar.length; i++) errors.push(ar[i]);
    }
    step(errors.length ? '读回校验未通过' : '读回校验通过（存档与权重包一致）');

    /* 7) 在线内存核对 */
    try {
        const live = bridge.snapshotModel();
        const lp = live && snapshotToParams(live);
        if (!lp || !paramsEqual(lp, bundle.params, dims)) errors.push('在线权重与前向所用权重不一致');
    } catch (e) { errors.push('在线权重无法核对'); }

    /* 8) 前向自检：NaN/Infinity 与（可选）探针标签 */
    if (!errors.length) {
        const fe = forwardCheck(bridge, dims, probe);
        for (let i = 0; i < fe.length; i++) errors.push(fe[i]);
        step(fe.length ? '前向自检未通过' : '前向自检通过');
    }

    if (errors.length) {
        const rb = rollback();
        return finishAbort(rb, null, 'verify', errors.concat(rb.errors, rb.notes), false);
    }

    /* 9) 提交步骤一：官方版本记录（安装=写入并核验；恢复=清除并核验） */
    if (typeof commitRecord === 'function') {
        let cr = null;
        try { cr = await commitRecord({ txId: tx, digest: paramsDigest(bundle.params, dims), size: Number(bundle.size) || 0 }); }
        catch (e) { cr = { ok: false, errors: ['版本记录提交抛出异常：' + ((e && e.message) || e)] }; }
        if (!cr || cr.ok !== true) {
            const rb = rollback();
            const rv = await safeRevertRecord();
            return finishAbort(rb, rv, 'record',
                ['版本记录提交失败：' + (((cr && cr.errors) || ['未知原因']).join('；'))]
                    .concat(rb.errors.length ? ['回滚未完全确认：' + rb.errors.join('；')] : ['已回滚到更新前的模型'])
                    .concat(rv),
                false);
        }
        if (!isRestore) {
            /* ★ P0-2：阶段日志推进失败时按"当前实际状态"决策：
             *   权重与官方记录都已写入并**读回核验**（两两一致），日志标记只是落后；
             *   崩溃恢复是状态驱动的（会从实际权重/记录内容判定继续提交），
             *   因此这里允许继续完成提交，但必须如实标记 journalDegraded。 */
            if (!_journalWriteVerified(storageOps, journalFor('record-committed'))) {
                journalDegraded = true;
                step('提示：事务日志标记落后（record-committed 写入失败），权重与记录均已提交，继续完成提交');
            }
        }
        step('版本记录已提交并核验');
    }

    /* 10) 提交步骤二：长期备份轮换（失败 = 提交失败 → 恢复本次更新前的模型，原长期备份不变） */
    if (!isRestore) {
        const rot = writeBackupVerified(storageOps, 'writeBackup', 'readBackup', stagingRecord, dims);
        if (!rot.ok) {
            const rb = rollback();
            const rv = await safeRevertRecord();
            return finishAbort(rb, rv, 'backup-rotate',
                ['长期备份轮换失败：' + rot.errors.join('；'),
                    '已优先恢复本次更新前的模型；原长期备份保持不变']
                    .concat(rb.errors.length ? ['回滚未完全确认：' + rb.errors.join('；')] : [])
                    .concat(rv),
                false);
        }
        backupRotated = true;
        if (!_journalWriteVerified(storageOps, journalFor('backup-rotated'))) {
            /* 轮换已读回核验成功；日志落后不影响状态驱动恢复（record-committed 已持久化），
             * 清理顺序会先删日志、删除失败则保留暂存备份供下次启动安全收尾。 */
            journalDegraded = true;
            step('提示：事务日志标记落后（backup-rotated 写入失败），长期备份已轮换，继续完成收尾');
        }
        step('已轮换长期备份为更新前的模型');
    }

    /* 11) 权重、官方记录、可用恢复点全部核验通过 → 才清理临时事务数据 */
    cleanupTx();
    if (cleanupPending) step('提示：事务数据清理未完成（提交已全部完成），将在下次启动时补清理');
    step(isRestore ? '已安全恢复历史备份' : '官方权重已安全应用');
    return {
        ok: true, rolledBack: false, errors: [], digest: paramsDigest(bundle.params, dims),
        size: Number(bundle.size) || 0, mode: isRestore ? 'restore' : 'install', txId: tx,
        backupWritten, backupRotated, journalWritten, partialWrite: false, rollbackStatus: 'none', failedAt: null,
        journalDegraded, cleanupPending,
    };
};

/* ---------- 崩溃 / 重启后的未完成事务恢复（P0-1） ----------
 * ★ 恢复决策不再只依据日志阶段（提交与日志推进不是原子操作）：
 *   先收集"实际状态"——持久化模型摘要、运行时模型摘要、官方记录实际内容、
 *   长期恢复点摘要、本事务暂存备份（txId + 基线摘要）——再交给 planTxRecovery
 *   做确定性判定；执行完成后读回核验（模型/记录/事务日志）。
 * 绝不删除仍具恢复价值的数据；无法自动恢复时标记 needsManual 并阻止继续安装。
 * 依赖注入（storageOps / getBridge / contract / 记录读写），可在 Node 侧直接测试生产实现。 */
export const recoverInterruptedTransaction = async ctx => {
    const { storageOps, getBridge, contract, onStep,
        readRecord = null, writeRecord = null, removeRecord = null, verifyRecord = null } = ctx || {};
    const step = m => { try { if (onStep) onStep(m); } catch (e) {} };
    const clearTxVerified = () => _journalRemoveVerified(storageOps);
    const clearStaging = () => { try { if (storageOps && typeof storageOps.removeStagingBackup === 'function') storageOps.removeStagingBackup(); } catch (e) {} };
    const markManual = reason => {
        try {
            if (storageOps && typeof storageOps.writeTx === 'function') {
                storageOps.writeTx(Object.assign({}, journal, { needsManual: true, reason: '恢复未完成：' + reason }));
            }
        } catch (e) {}
    };

    /* ★ 严格读取事务日志：读取失败 / 内容损坏 / 结构无效（{}、null、[]、缺 txId）/ 缺少读取能力
     *   → 绝不当作"没有未完成事务"，进入安全阻塞状态并**保留原始日志**不改写
     *   （存储恢复后仍可正常恢复；人工介入时现场完整可查）。 */
    let journal = null, journalReadError = null;
    try {
        if (storageOps && typeof storageOps.readTx === 'function') journal = storageOps.readTx();
        else journalReadError = new Error('存储缺少事务日志读取能力');
    } catch (e) { journalReadError = e; }
    if (journalReadError) {
        const reason = '事务日志不可用（' + ((journalReadError && journalReadError.message) || journalReadError) + '），无法确认是否存在未完成事务';
        step('检测到事务日志不可读，已保留全部数据并暂停自动安装：' + reason);
        return { action: 'manual', ok: false, manual: true, reason };
    }
    const plan0 = classifyInterruptedTx(journal);
    if (plan0.action === 'none') return plan0;
    if (plan0.action === 'manual') {
        step('检测到无法自动恢复的未完成事务，已保留恢复数据并暂停自动安装：' + plan0.reason);
        return plan0;
    }
    if (!contract) return { action: 'manual', ok: false, manual: true, reason: '运行时契约不可用，无法安全恢复未完成事务' };

    const failManual = (actionName, reason) => {
        markManual(reason);
        step('未完成事务恢复受限，已保留数据并暂停自动安装：' + reason);
        return { action: actionName || 'manual', ok: false, manual: true, reason };
    };
    /* 仅"事务数据清理"未完成：提交/恢复本身已成功——不得标记 needsManual（会永久阻塞），
     * 保留日志与原阶段，下次启动沿同一判定安全重试（幂等收尾）。 */
    const cleanupPendingResult = (actionName, reason) => {
        step('事务数据清理未完成（将在下次启动重试）：' + reason);
        return { action: actionName, ok: false, reason: '事务数据清理未完成（将在下次启动重试）' };
    };

    /* ===== 收集实际状态（绝不只看日志阶段） ===== */
    const dims = contract.dims;
    const persistedDigest = (() => {
        try {
            const raw = (storageOps && typeof storageOps.readArchive === 'function') ? storageOps.readArchive() : null;
            return digestOfArchive(raw, dims);
        } catch (e) { return null; }
    })();
    let bridge = null;
    if (typeof getBridge === 'function') { try { bridge = await getBridge(); } catch (e) { bridge = null; } }
    let liveDigest = null;
    if (bridge) {
        try {
            const p = snapshotToParams(bridge.snapshotModel());
            liveDigest = p ? paramsDigest(p, dims) : null;
        } catch (e) { liveDigest = null; }
    }
    let officialState = 'unavailable';
    if (typeof readRecord === 'function') {
        try {
            const rec = readRecord();
            if (!rec) officialState = 'absent';
            else officialState = (String(rec.sha256 || '').toLowerCase() === String(journal.targetDigest || '').toLowerCase()) ? 'target' : 'other';
        } catch (e) { officialState = 'unreadable'; }
    }
    let staging = null;
    try { staging = (storageOps && typeof storageOps.readStagingBackup === 'function') ? storageOps.readStagingBackup() : null; } catch (e) { staging = null; }
    const stagingErrs = staging ? verifyStagingForTx(staging, journal, dims) : [];
    const stagingOk = !!staging && stagingErrs.length === 0;
    let backupDigest = null;
    try {
        const b = (storageOps && typeof storageOps.readBackup === 'function') ? storageOps.readBackup() : null;
        if (b && b.params) backupDigest = paramsDigest(b.params, dims);
    } catch (e) { backupDigest = null; }

    const decision = planTxRecovery(journal, { persistedDigest, liveDigest, officialState, backupDigest, stagingOk });
    step('未完成事务判定：' + decision.action + '（' + decision.reason + '）');

    if (decision.action === 'manual') return failManual('manual', decision.reason);

    if (decision.action === 'cleanup') {
        if (!clearTxVerified()) return cleanupPendingResult('cleanup', decision.reason);
        clearStaging();
        step('已清理未完成事务的临时数据（' + decision.reason + '）');
        return { action: 'cleanup', ok: true };
    }

    if (decision.action === 'finish-rotation') {
        const rot = writeBackupVerified(storageOps, 'writeBackup', 'readBackup', staging, dims);
        if (!rot.ok) return failManual('finish-rotation', '补做长期备份轮换失败：' + rot.errors.join('；'));
        /* 完成后读回核验：官方记录必须仍指向目标权重 */
        let recNow = null;
        try { recNow = readRecord(); } catch (e) { return failManual('finish-rotation', '官方记录复核读取抛出异常'); }
        if (!recNow || String(recNow.sha256 || '').toLowerCase() !== String(journal.targetDigest || '').toLowerCase()) {
            return failManual('finish-rotation', '官方记录复核未通过（sha256 不符或缺失）');
        }
        if (!clearTxVerified()) return cleanupPendingResult('finish-rotation', decision.reason);
        clearStaging();
        step('已补做长期备份轮换并清理事务数据（权重与官方记录已提交）');
        return { action: 'finish-rotation', ok: true };
    }

    if (decision.action === 'restore') {
        if (!bridge) return failManual('manual', '模型模块未就绪，无法安全恢复未完成事务');
        if (!stagingOk) return failManual('manual', '暂存备份与事务日志不匹配：' + (stagingErrs.join('；') || '缺少暂存备份'));
        const decoded = decodeBackupParams(staging, dims);
        if (!decoded) return failManual('manual', '暂存备份参数无法解码');
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle: backupRecordToBundleLike(staging), decoded, dims,
            probe: null, runtimeEpoch: contract.dataEpoch, schemaVersion: contract.schemaVersion, mode: 'restore', txId: journal.txId,
        });
        if (!r.ok) return failManual('restore', '按事务日志回滚失败：' + (r.errors || []).join('；'));
        /* 回滚 A 必须同时恢复 A 对应的旧官方记录（日志快照为可信来源） */
        const recFix = restoreOfficialRecord({
            prevRec: journal.prevRecord,
            writeRecord, readRecord, removeRecord, verify: verifyRecord || (() => []),
        });
        if (!recFix.ok) return failManual('restore', '模型已回滚但官方记录恢复失败：' + recFix.errors.join('；'));
        /* 恢复完成后读回核验模型摘要 */
        try {
            const p2 = snapshotToParams(bridge.snapshotModel());
            const h2 = p2 ? paramsDigest(p2, dims) : null;
            if (!h2 || h2 !== String(journal.baseDigest || '').toLowerCase()) {
                return failManual('restore', '恢复后模型摘要复核未通过');
            }
        } catch (e) { return failManual('restore', '恢复后模型摘要无法复核'); }
        if (!clearTxVerified()) return cleanupPendingResult('restore', decision.reason);
        clearStaging();
        step('已按事务日志回滚未完成的安装事务（模型与官方记录均已恢复到更新前）');
        return { action: 'restore', ok: true };
    }

    if (decision.action === 'fix-record') {
        const recFix = restoreOfficialRecord({
            prevRec: journal.prevRecord,
            writeRecord, readRecord, removeRecord, verify: verifyRecord || (() => []),
        });
        if (!recFix.ok) return failManual('fix-record', '官方记录恢复到安装前状态失败：' + recFix.errors.join('；'));
        if (!clearTxVerified()) return cleanupPendingResult('fix-record', decision.reason);
        clearStaging();
        step('已把官方记录恢复到安装前状态并清理事务数据');
        return { action: 'fix-record', ok: true };
    }

    return failManual('manual', '未知恢复动作：' + decision.action);
};
