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

/* ---------- 主流程 ---------- */
export const applyOfficialBundle = async ctx => {
    const { bridge, storageOps, bundle, decoded, dims, probe, runtimeEpoch, onStep } = ctx || {};
    const step = m => { try { if (onStep) onStep(m); } catch (e) {} };
    const errors = [];

    if (!bridge || !decoded || !bundle) return { ok: false, rolledBack: false, errors: ['缺少必要参数'], digest: null, size: 0 };

    /* 1) 备份原有模型（内存快照 + 持久化纯权重备份） */
    let backup = null;
    try { backup = bridge.snapshotModel(); } catch (e) { backup = null; }
    if (!backup) return { ok: false, rolledBack: false, errors: ['无法获取当前模型快照，已中止（未做任何改动）'], digest: null, size: 0 };
    const backupParams = snapshotToParams(backup);
    const backupMeta = (bridge.getMeta && bridge.getMeta()) || null;
    if (backupParams && storageOps && storageOps.writeBackup) {
        try { storageOps.writeBackup({ savedAt: Date.now(), params: backupParams, meta: backupMeta }); } catch (e) { step('备份落盘失败：' + ((e && e.message) || e)); }
    }
    step('已备份原有模型');

    /* 回滚：errors = 未能确认回滚；notes = 已回滚但需如实告知的限制（不算失败） */
    const rollback = () => {
        const errors = [], notes = [];
        try {
            if (bridge.restoreModel(backup) === false) errors.push('restoreModel 拒绝还原备份');
        } catch (e) { errors.push('还原备份抛出异常：' + ((e && e.message) || e)); }
        try { bridge.saveWeights(); } catch (e) {}
        if (backupParams && storageOps && storageOps.readArchive) {
            const raw = storageOps.readArchive();
            if (!raw) {
                notes.push('设备无可用持久化存储：回滚仅在内存中生效，重启后会以运行时默认模型加载');
            } else {
                const ar = verifyArchive(raw, backupParams, dims, runtimeEpoch);
                if (ar.length) errors.push('回滚后存档校验未通过：' + ar.join('；'));
            }
        }
        /* 还原后再次核对在线内存，确保不是随机参数 */
        try {
            const live = bridge.snapshotModel();
            const lp = live && snapshotToParams(live);
            if (!lp || !paramsEqual(lp, backupParams, dims)) errors.push('回滚后在线权重与备份不一致');
        } catch (e) { errors.push('回滚后在线权重无法核对'); }
        step(errors.length ? ('回滚未完全确认：' + errors.join('；')) : '已回滚到原有模型');
        return { errors, notes };
    };

    /* 2) 写入待生效模型（官方权重 + 优化器状态清零） */
    let applied = null;
    try { applied = buildAppliedSnapshot(decoded, dims, bundle, backup.META || {}); } catch (e) { applied = null; }
    if (!applied) {
        errors.push('组装待生效模型失败');
        return { ok: false, rolledBack: false, errors, digest: null, size: 0 };
    }
    let wrote = false;
    try { wrote = bridge.restoreModel(applied) !== false; } catch (e) { wrote = false; }
    if (!wrote) {
        errors.push('写入新权重被模型拒绝（结构不兼容）');
        return { ok: false, rolledBack: false, errors, digest: null, size: 0 };
    }
    step('新权重已写入在线模型');

    /* 3) 落盘（返回值不可信，仅作提示） */
    try { bridge.saveWeights(); } catch (e) {}

    /* 4) 读回校验：确认持久化结果，而不是相信 saveWeights() 的返回 */
    if (!storageOps || typeof storageOps.readArchive !== 'function') {
        errors.push('缺少存档读回能力，无法确认持久化结果');
    } else {
        const ar = verifyArchive(storageOps.readArchive(), bundle.params, dims, runtimeEpoch);
        for (let i = 0; i < ar.length; i++) errors.push(ar[i]);
    }
    step(errors.length ? '读回校验未通过' : '读回校验通过（存档与权重包一致）');

    /* 5) 在线内存核对 */
    try {
        const live = bridge.snapshotModel();
        const lp = live && snapshotToParams(live);
        if (!lp || !paramsEqual(lp, bundle.params, dims)) errors.push('在线权重与前向所用权重不一致');
    } catch (e) { errors.push('在线权重无法核对'); }

    /* 6) 前向自检：NaN/Infinity 与（可选）探针标签 */
    if (!errors.length) {
        const fe = forwardCheck(bridge, dims, probe);
        for (let i = 0; i < fe.length; i++) errors.push(fe[i]);
        step(fe.length ? '前向自检未通过' : '前向自检通过');
    }

    if (errors.length) {
        const rb = rollback();
        return { ok: false, rolledBack: rb.errors.length === 0, errors: errors.concat(rb.errors, rb.notes), digest: null, size: 0 };
    }

    step('官方权重已安全应用');
    return { ok: true, rolledBack: false, errors: [], digest: paramsDigest(bundle.params, dims), size: Number(bundle.size) || 0 };
};
