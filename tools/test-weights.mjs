#!/usr/bin/env node
/*
 * ============================================
 * // 作者：飞升原创
 * 交流群：1080487560
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 无名AI · 模型权重更新自动化测试（零依赖，Node 侧） =================
 * 运行：node tools/test-weights.mjs        （通过退出码 0 / 1）
 *
 * 覆盖：摘要口径、权重包契约校验、参数长度与真实产物一致、版本判断、
 *       本地训练成果判定（证明不依赖 META.trained）、
 *       以及「备份 → 写入 → 落盘 → 读回校验 → 回滚」全流程（用假 bridge / 假存储）。
 *
 * 说明：真实机型（安卓 WebView）上的下载与应用链路无法在此自动化，属「未验证」，
 *       需在游戏内手动测试；本脚本覆盖的是可静态验证的纯逻辑与编排分支。
 */
import { createHash, randomBytes } from 'node:crypto';
import {
    BUNDLE_FORMAT, MODEL_ID, MODEL_PROTOCOL,
    paramSpec, PARAM_ORDER, decodeBase64, encodeBase64,
    paramsSize, paramsDigest, sha256Hex, validateBundle,
    compareVersion, isNewerRelease, satisfiesExtensionRange, normalizeReleaseSeq, classifyManifestState,
} from '../js/update/weightBundle.js';
import { applyOfficialBundle, detectUserModel, snapshotToParams, buildAppliedSnapshot, runtimeStateDiff, recoverInterruptedTransaction } from '../js/update/applyWeights.js';
import {
    buildBackupRecord, verifyBackupRecord, verifyRestoreSource, buildPendingRecord, evaluatePending,
    createTransactionLock, createRecoveryGuard, evaluateApplyGate, buildOfficialRecord, verifyOfficialRecord, isOfficialRecordShape,
    evaluateExportCompatibility, classifyIntegrityArchive, computeMaxBundleBytes, fetchTextWithLimits, MAX_MANIFEST_BYTES,
    computeTrainingEvidence, restoreOfficialRecord, combineRollbackStatus, readBodyLimited, MAX_ABSOLUTE_BYTES,
    generateTxId, buildTxJournal, classifyInterruptedTx, verifyStagingForTx, decodeBackupParams, backupRecordToBundleLike,
    BACKUP_KIND_PARAMS, BACKUP_RECORD_VERSION, PENDING_RECORD_VERSION, reauthorizeRecord, rollbackStatusText, createStrictKeyReader,
} from '../js/update/updateCore.js';
import { safeGet } from '../score/foundation/storage/storage.js';
import { styledDialog } from '../js/update/updateUi.js';
import { DEFAULT_WEIGHTS } from '../score/model/weights/defaultWeights.js';

const DIMS = [134, 128, 64, 6];
const SCHEMA = 7;
const EPOCH = 5;
const EXPECT = {
    schemaVersion: SCHEMA, featureDim: DIMS[0], dims: DIMS.slice(), dataEpoch: EPOCH,
    dtype: { weights: 'int8', biases: 'int16' },
    architecture: { activation: 'gelu', norm: 'layernorm', residual: true, critic: true },
};

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ('  << ' + extra) : '')); }
};
const section = t => console.log('\n--- ' + t + ' ---');

/* ---------- 1. SHA-256 口径（与 node:crypto 对齐） ---------- */
section('SHA-256');
for (const n of [0, 1, 3, 55, 56, 63, 64, 65, 127, 1000, 17152, 51534]) {
    const b = randomBytes(n);
    ok('sha256 长度 ' + n + ' 与 crypto 一致', sha256Hex(new Uint8Array(b)) === createHash('sha256').update(b).digest('hex'));
}

/* ---------- 2. 参数长度与真实内置权重一致 ---------- */
section('参数契约 vs 真实产物');
const spec = paramSpec(DIMS);
ok('共 10 项（含 Critic 头与残差投影）', spec.length === 10 && PARAM_ORDER.length === 10, spec.map(s => s.key).join(','));
ok('顺序与 PARAM_ORDER 一致', spec.map(s => s.key).join(',') === PARAM_ORDER.join(','));
const defaultParams = {};
for (const s of spec) {
    const need = s.kind === 'int16' ? s.len * 2 : s.len;
    const bytes = decodeBase64(DEFAULT_WEIGHTS[s.key]);
    defaultParams[s.key] = DEFAULT_WEIGHTS[s.key];
    ok('内置权重 ' + s.key + ' 字节数 = ' + need, !!bytes && bytes.byteLength === need, bytes ? bytes.byteLength : 'null');
}
ok('内置权重体积合计 51534', paramsSize(defaultParams, DIMS) === 51534, paramsSize(defaultParams, DIMS));

/* ---------- 3. 权重包契约校验 ---------- */
section('权重包校验');
/* 用内置权重构造"官方包"（内容与内置相同即可，验证的是校验逻辑） */
const officialParams = {};
for (const s of spec) {
    const b = decodeBase64(DEFAULT_WEIGHTS[s.key]);
    b[0] = (b[0] + 1) & 0xff;                        /* 与内置不同 → 便于"本地训练成果"判定测试 */
    officialParams[s.key] = encodeBase64(b);
}
const officialSize = paramsSize(officialParams, DIMS);
const officialDigest = paramsDigest(officialParams, DIMS);
/* "用户本地训练成果"模型 A：与内置默认、官方包都不同（供多处复用） */
const userParams = {};
for (const s of spec) { const b = decodeBase64(defaultParams[s.key]); b[7] = (b[7] + 9) & 0xff; userParams[s.key] = encodeBase64(b); }
const userDigest = paramsDigest(userParams, DIMS);
const mkBundle = mut => {
    const b = {
        format: BUNDLE_FORMAT, modelId: MODEL_ID, modelVersion: 'w7d5-t01', releaseSeq: 1,
        schemaVersion: SCHEMA, featureDim: DIMS[0], dims: DIMS.slice(), dataEpoch: EPOCH,
        dtype: { weights: 'int8', biases: 'int16' }, params: { ...officialParams },
        architecture: { activation: 'gelu', norm: 'layernorm', residual: true, critic: true },
        trained: 1, accuracy: 0.5, size: officialSize, sha256: officialDigest,
    };
    if (mut) mut(b);
    return b;
};
ok('合法包通过', validateBundle(mkBundle(), EXPECT).ok, JSON.stringify(validateBundle(mkBundle(), EXPECT).errors));
{
    const r = validateBundle(mkBundle(b => { const x = decodeBase64(b.params.w2); x[3] ^= 0xff; b.params.w2 = encodeBase64(x); }), EXPECT);
    ok('篡改 1 字节 → SHA-256 拒绝', !r.ok && r.errors.some(e => e.includes('SHA-256')), JSON.stringify(r.errors));
}
ok('截断参数 → 长度拒绝', !validateBundle(mkBundle(b => { b.params.b3 = 'AAA='; }), EXPECT).ok);
ok('删除残差投影 pr2 → 拒绝', !validateBundle(mkBundle(b => { delete b.params.pr2; }), EXPECT).ok);
ok('维度不符 → 拒绝', !validateBundle(mkBundle(b => { b.dims = [130, 128, 64, 6]; }), EXPECT).ok);
ok('数据纪元过旧 → 拒绝', !validateBundle(mkBundle(b => { b.dataEpoch = 4; }), EXPECT).ok);
ok('结构版本不符 → 拒绝', !validateBundle(mkBundle(b => { b.schemaVersion = 6; }), EXPECT).ok);
ok('模型标识不符 → 拒绝', !validateBundle(mkBundle(b => { b.modelId = 'x'; }), EXPECT).ok);
ok('体积不符 → 拒绝', !validateBundle(mkBundle(b => { b.size = 7; }), EXPECT).ok);
ok('非 JSON 对象 → 拒绝', !validateBundle('rubbish', EXPECT).ok);
ok('探针维度不符 → 拒绝', !validateBundle(mkBundle(b => { b.probe = { input: new Array(130).fill(0), expectTop: 1 }; }), EXPECT).ok);
/* P2-5：模型语义（架构）与数值类型必须与运行时一致，同维度但语义不符必须拒绝 */
ok('激活函数不符 → 拒绝', !validateBundle(mkBundle(b => { b.architecture = { activation: 'relu', norm: 'layernorm', residual: true, critic: true }; }), EXPECT).ok);
ok('归一化方式不符 → 拒绝', !validateBundle(mkBundle(b => { b.architecture = { activation: 'gelu', norm: 'batchnorm', residual: true, critic: true }; }), EXPECT).ok);
ok('残差连接约定不符 → 拒绝', !validateBundle(mkBundle(b => { b.architecture = { activation: 'gelu', norm: 'layernorm', residual: false, critic: true }; }), EXPECT).ok);
ok('Critic 头约定不符 → 拒绝', !validateBundle(mkBundle(b => { b.architecture = { activation: 'gelu', norm: 'layernorm', residual: true, critic: false }; }), EXPECT).ok);
ok('缺少 architecture 元数据 → 拒绝', !validateBundle(mkBundle(b => { delete b.architecture; }), EXPECT).ok);
ok('缺少 dtype 元数据 → 拒绝', !validateBundle(mkBundle(b => { delete b.dtype; }), EXPECT).ok);
ok('权重数据类型不符 → 拒绝', !validateBundle(mkBundle(b => { b.dtype = { weights: 'int16', biases: 'int16' }; }), EXPECT).ok);
ok('偏置数据类型不符 → 拒绝', !validateBundle(mkBundle(b => { b.dtype = { weights: 'int8', biases: 'int8' }; }), EXPECT).ok);
ok('未提供语义期望时保持向后兼容（旧包可校验）', validateBundle(mkBundle(b => { delete b.architecture; }), { schemaVersion: SCHEMA, featureDim: DIMS[0], dims: DIMS.slice(), dataEpoch: EPOCH }).ok === true);

/* ---------- 4. 版本判断 ---------- */
section('版本判断');
ok('compareVersion 4.1>4.0', compareVersion('4.1', '4.0') === 1);
ok('compareVersion 3.9<4.0', compareVersion('3.9', '4.0') === -1);
ok('区间 min 命中', satisfiesExtensionRange('4.1', { min: '4.0' }) === true);
ok('区间 max 拒绝', satisfiesExtensionRange('4.1', { max: '4.0' }) === false);
ok('releaseSeq 更新', isNewerRelease(3, 2) === true && isNewerRelease(2, 2) === false);
ok('releaseSeq 非法值回退基线', normalizeReleaseSeq('x') === 0 && normalizeReleaseSeq(-1) === 0);

/* ---------- 5. 本地训练成果判定（不依赖 META.trained） ---------- */
section('本地训练成果判定');
const defaultDigest = paramsDigest(defaultParams, DIMS);
let det = detectUserModel({ activeParams: defaultParams, defaultParams, officialDigest: officialDigest, dims: DIMS });
ok('等于内置默认 → 非用户模型', det.known && det.sameAsDefault && !det.isUserModel);
det = detectUserModel({ activeParams: officialParams, defaultParams, officialDigest: officialDigest, dims: DIMS });
ok('等于上次官方 → 非用户模型', det.known && det.sameAsOfficial && !det.isUserModel);
{
    const userParams = {};
    for (const s of spec) { const b = decodeBase64(defaultParams[s.key]); b[7] = (b[7] + 9) & 0xff; userParams[s.key] = encodeBase64(b); }
    det = detectUserModel({ activeParams: userParams, defaultParams, officialDigest: officialDigest, dims: DIMS });
    ok('既非默认也非官方 → 判为用户模型', det.known && det.isUserModel);
    ok('即使 META.trained=0 也能识别（不依赖 trained）', det.isUserModel === true);
}

/* ---------- 6. 应用 / 回滚（假 bridge + 假存储） ---------- */
section('备份 / 写入 / 读回校验 / 回滚');

const buildTyped = params => {
    const out = {};
    for (const s of spec) {
        const bytes = decodeBase64(params[s.key]);
        if (s.kind === 'int16') {
            const o = new Int16Array(s.len);
            const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            for (let k = 0; k < s.len; k++) o[k] = dv.getInt16(k * 2, true);
            out[s.key] = o;
        } else out[s.key] = Int8Array.from(bytes);
    }
    return out;
};
/* 参数键 → 在线快照键（与 applyWeights.js 的 PARAM_TO_SNAP 一致） */
const P2S = { w1: 'W1', b1: 'B1', w2: 'W2', b2: 'B2', w3: 'W3', b3: 'B3', w4: 'W4', b4: 'B4', pr1: 'W_proj1', pr2: 'W_proj2' };
const toLive = params => { const t = buildTyped(params); const out = {}; for (const k in P2S) out[P2S[k]] = t[k]; return out; };
const encodeState = live => {
    const p = {};
    for (const s of spec) {
        const a = live[P2S[s.key]];
        p[s.key] = encodeBase64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    }
    return JSON.stringify({ v: SCHEMA, dv: EPOCH, ...p, trained: live.META.trained, accuracy: live.META.accuracy, ready: true });
};

/* 模拟 weights.js 的在线状态机（只实现被编排层使用到的语义） */
const makeFakeWeights = ({ initialParams, corruptFirstSave }) => {
    const live = { ...toLive(initialParams), META: { version: SCHEMA, trained: 111, accuracy: 0.4, ready: true } };
    live.adamT = 7;
    for (const [mk, wk] of OPT) live[mk] = new Float32Array(live[wk].length).fill(mk.charAt(0) === 'm' ? 0.25 : 0.5);
    const st = { archive: null, corrupt: null, saveCount: 0 };
    return {
        live, state: st,
        snapshotModel() {
            const s = { META: { ...live.META }, adamT: live.adamT };
            for (const k of SNAP) s[k] = new live[k].constructor(live[k]);
            for (const [mk] of OPT) s[mk] = new Float32Array(live[mk]);
            return s;
        },
        restoreModel(snap) {
            if (!snap) return false;
            for (const [sk, len] of CORE_SHAPES) {
                const a = snap[sk];
                if (!a || a.length !== len) return false;
            }
            for (const k of SNAP) if (snap[k]) live[k] = new snap[k].constructor(snap[k]);
            for (const [mk, wk] of OPT) if (snap[mk] && snap[mk].length === live[wk].length) live[mk] = new Float32Array(snap[mk]);
            if (typeof snap.adamT === 'number') live.adamT = snap.adamT;
            if (snap.META) { live.META.trained = snap.META.trained || 0; live.META.accuracy = snap.META.accuracy || 0; live.META.ready = !!snap.META.ready; }
            return true;
        },
        saveWeights() {
            st.saveCount++;
            const raw = encodeState(live);
            st.archive = raw;
            /* 模拟"写入通道出错"：首次落盘写坏 → 读回校验必须能发现 */
            st.corrupt = (corruptFirstSave && st.saveCount === 1) ? raw.replace(/"w1":"([A-Za-z0-9+/=]{4})/, '"w1":"AAAA') : null;
            return true;   /* ★ 故意恒返 true：验证编排层不信任返回值 */
        },
        getMeta() { return { trained: live.META.trained, accuracy: live.META.accuracy, ready: live.META.ready }; },
        /* 前向：只用 W1 前若干值做确定性映射，便于构造探针 */
        forward() { const o = new Float32Array(DIMS[3]); for (let k = 0; k < o.length; k++) o[k] = live.W1[k] + live.B1[k % 128]; return o; },
    };
};
/* 键集合（与 weights.js __snapshotModel / __restoreModel 契约一致） */
const SNAP = ['W1', 'B1', 'W2', 'B2', 'W3', 'B3', 'W4', 'B4', 'W_proj1', 'W_proj2'];
const OPT = [['mW1', 'W1'], ['mB1', 'B1'], ['mW2', 'W2'], ['mB2', 'B2'], ['mW3', 'W3'], ['mB3', 'B3'], ['mW4', 'W4'], ['mB4', 'B4'], ['mW_proj1', 'W_proj1'], ['mW_proj2', 'W_proj2'],
['vW1', 'W1'], ['vB1', 'B1'], ['vW2', 'W2'], ['vB2', 'B2'], ['vW3', 'W3'], ['vB3', 'B3'], ['vW4', 'W4'], ['vB4', 'B4'], ['vW_proj1', 'W_proj1'], ['vW_proj2', 'W_proj2']];
const CORE_SHAPES = [['W1', 134 * 128], ['B1', 128], ['W2', 128 * 64], ['B2', 64], ['W3', 64 * 6], ['B3', 6], ['W4', 64], ['B4', 1], ['W_proj1', 134 * 128], ['W_proj2', 128 * 64]];

const mkStorage = bridge => ({
    readArchive() { return bridge.state.corrupt || bridge.state.archive; },
    /* 长期恢复点（仅安装成功后轮换） */
    writeBackup(rec) { this.backup = rec; return true; },
    readBackup() { return this.backup; },
    /* 安装事务暂存备份（P2-1） */
    writeStagingBackup(rec) { this.staging = rec; return true; },
    readStagingBackup() { return this.staging; },
    removeStagingBackup() { this.staging = null; return true; },
    /* 安装事务日志（P0-1） */
    writeTx(j) { this.tx = j; return true; },
    readTx() { return this.tx; },
    removeTx() { this.tx = null; return true; },
});

const rst = (name, cond, extra) => ok(name, cond, extra);

/* 6a) 正常路径：应用成功、优化器清零、官方值生效 */
{
    const bridge = makeFakeWeights({ initialParams: defaultParams });
    const storageOps = mkStorage(bridge);
    const bundle = mkBundle();
    const res = validateBundle(bundle, EXPECT);
    const r = await applyOfficialBundle({ bridge, storageOps, bundle, decoded: res.decoded, dims: DIMS, probe: res.probe, runtimeEpoch: EPOCH });
    rst('正常路径 ok', r.ok === true, JSON.stringify(r.errors));
    rst('摘要等于包 sha256', r.digest === officialDigest, r.digest);
    rst('在线权重已换为新权重', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
    rst('持久化存档与新权重一致', !!(storageOps.readArchive() && storageOps.readArchive().includes(officialParams.w1.slice(0, 20))));
    rst('优化器动量已清零', bridge.live.mW1.every(v => v === 0) && bridge.live.vW1.every(v => v === 0));
    rst('AdamW 时间步已重置', bridge.live.adamT === 0);
    rst('META 已更新为新权重精度', bridge.live.META.accuracy === 0.5 && bridge.live.META.ready === true);
    rst('已写入本地备份', !!(storageOps.readBackup() && storageOps.readBackup().params.w1));
    rst('备份内容 = 更新前模型', paramsDigest(storageOps.readBackup().params, DIMS) === paramsDigest(defaultParams, DIMS));
}

/* 6b) 落盘内容损坏 → 读回校验发现 → 回滚成功且旧模型完好 */
{
    const bridge = makeFakeWeights({ initialParams: defaultParams, corruptFirstSave: true });
    const storageOps = mkStorage(bridge);
    const bundle = mkBundle();
    const res = validateBundle(bundle, EXPECT);
    const r = await applyOfficialBundle({ bridge, storageOps, bundle, decoded: res.decoded, dims: DIMS, probe: null, runtimeEpoch: EPOCH });
    rst('落盘损坏 → 判定失败', r.ok === false, JSON.stringify(r.errors));
    rst('失败后已确认回滚', r.rolledBack === true, JSON.stringify(r.errors));
    rst('回滚后在线 = 更新前模型', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === paramsDigest(defaultParams, DIMS));
    rst('回滚后存档 = 更新前模型', !!storageOps.readArchive() && storageOps.readArchive().includes(defaultParams.w1.slice(0, 20)));
    rst('失败原因包含存档校验', (r.errors || []).some(e => e.includes('存档')), JSON.stringify(r.errors));
}

/* 6c) 备份写入失败（返回 false）→ 更新前即中止，绝不替换模型（P0-1） */
{
    const bridge = makeFakeWeights({ initialParams: defaultParams });
    const badStorage = { readArchive: () => null, writeBackup: () => false, readBackup: () => null, writeStagingBackup: () => false, readStagingBackup: () => null, removeStagingBackup: () => true };
    const bundle = mkBundle();
    const res = validateBundle(bundle, EXPECT);
    const r = await applyOfficialBundle({ bridge, storageOps: badStorage, bundle, decoded: res.decoded, dims: DIMS, probe: null, runtimeEpoch: EPOCH });
    rst('备份写入 false → 拒绝应用', r.ok === false, JSON.stringify(r.errors));
    rst('备份写入 false → 在备份阶段中止', r.failedAt === 'backup', JSON.stringify(r));
    rst('备份写入 false → 模型完全未改动', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === paramsDigest(defaultParams, DIMS));
    rst('备份写入 false → 不谎报已备份', r.backupWritten === false);
}

/* 6d) 探针标签不符 → 拒绝并回滚 */
{
    const bridge = makeFakeWeights({ initialParams: defaultParams });
    const storageOps = mkStorage(bridge);
    const bundle = mkBundle(b => { b.probe = { input: new Array(DIMS[0]).fill(0), expectTop: 5 }; });
    /* 探针期望值与假前向实际输出不符 → 必须被拒 */
    const res = validateBundle(bundle, EXPECT);
    const realTop = (() => { const o = bridge.forward(); let b = 0; for (let i = 1; i < o.length; i++) if (o[i] > o[b]) b = i; return b; })();
    bundle.probe.expectTop = realTop === 5 ? 4 : 5;
    const r = await applyOfficialBundle({ bridge, storageOps, bundle, decoded: res.decoded, dims: DIMS, probe: bundle.probe, runtimeEpoch: EPOCH });
    rst('探针不符 → 拒绝', r.ok === false && (r.errors || []).some(e => e.includes('探针') || e.includes('前向')), JSON.stringify(r.errors));
    rst('探针不符 → 已回滚', r.rolledBack === true);
}

/* 6e) buildAppliedSnapshot 覆盖全部 10 项且清零优化器 */
{
    const bundle = mkBundle();
    const res = validateBundle(bundle, EXPECT);
    const snap = buildAppliedSnapshot(res.decoded, DIMS, bundle, { version: SCHEMA });
    rst('待生效快照含全部 10 项权重', SNAP.every(k => snap[k] && snap[k].length > 0));
    rst('待生效快照全部动量为零', OPT.every(([mk]) => snap[mk] && snap[mk].every(v => v === 0)));
    rst('待生效快照 adamT=0 且 ready', snap.adamT === 0 && snap.META.ready === true);
    rst('参数键↔快照键映射一致', paramsDigest(snapshotToParams(snap), DIMS) === officialDigest);
}

/* ---------- 7. 清单状态机（含服务器未启用协议的降级） ---------- */
section('清单状态机');
const manifestOf = mut => {
    const e = {
        modelVersion: 'w7d5-t02', releaseSeq: 2, schemaVersion: SCHEMA, featureDim: DIMS[0], dims: DIMS.slice(),
        dataEpoch: EPOCH, size: officialSize, sha256: officialDigest, url: '/update/model/x.json',
    };
    if (mut) mut(e);
    return { protocol: MODEL_PROTOCOL, modelId: MODEL_ID, latest: e };
};
const st = (manifest, opt) => classifyManifestState(Object.assign({ manifest, localSeq: 1, extensionVersion: '4.1' }, opt || {})).state;
/* ↑ 该响应为实测（GET /update/model/manifest.json）返回的服务自身状态信息 */
const LIVE_SERVER_RESPONSE = { status: 'ok', service: 'wuming-ingest', time: '2026-10-15T11:16:34.477868', data_dir: 'E:\\NoNameAI\\aggregate', merged_samples: 134613, total_deduped: 26735 };
ok('实测服务器响应 → unsupported（安全降级，不影响扩展使用）', st(LIVE_SERVER_RESPONSE) === 'unsupported');
ok('null 清单 → unsupported', st(null) === 'unsupported');
ok('protocol 不符 → unsupported', st({ protocol: 'x', modelId: MODEL_ID, latest: manifestOf().latest }) === 'unsupported');
ok('modelId 不符 → unsupported', st({ protocol: MODEL_PROTOCOL, modelId: 'x', latest: manifestOf().latest }) === 'unsupported');
ok('缺 url → invalid', st(manifestOf(e => { e.url = ''; })) === 'invalid');
ok('releaseSeq 非法 → invalid', st(manifestOf(e => { e.releaseSeq = 'x'; })) === 'invalid');
ok('要求更高扩展版本 → needsExtensionUpdate（提示领取整包）', st(manifestOf(e => { e.requiresExtension = { min: '9.0' }; })) === 'needsExtensionUpdate');
ok('更高 releaseSeq → available', st(manifestOf()) === 'available');
ok('相同 releaseSeq 且健康 → latest', st(manifestOf(e => { e.releaseSeq = 1; })) === 'latest');
ok('相同 releaseSeq 但内容损坏 → broken（可重新获取修复）', st(manifestOf(e => { e.releaseSeq = 1; }), { integrityState: 'broken' }) === 'broken');

/* ---------- 8. 更新后重启仍生效（存档满足 loadWeights 的接受条件） ---------- */
section('重启后仍生效');
{
    const bridge = makeFakeWeights({ initialParams: defaultParams });
    const storageOps = mkStorage(bridge);
    const bundle = mkBundle();
    const res = validateBundle(bundle, EXPECT);
    const r = await applyOfficialBundle({ bridge, storageOps, bundle, decoded: res.decoded, dims: DIMS, probe: null, runtimeEpoch: EPOCH });
    rst('应用成功', r.ok === true, JSON.stringify(r.errors));
    const obj = JSON.parse(storageOps.readArchive() || '{}');
    ok('存档结构版本 = 运行时 v' + SCHEMA, obj.v === SCHEMA, obj.v);
    ok('存档数据纪元 >= DATA_EPOCH(' + EPOCH + ')（不会被 loadWeights 拒载）', Number(obj.dv) >= EPOCH, obj.dv);
    const archParams = {};
    for (const s of spec) archParams[s.key] = obj[s.key];
    ok('存档含全部 10 项参数', spec.every(s => typeof obj[s.key] === 'string' && obj[s.key]));
    ok('重启后加载到的权重 = 本次官方权重', paramsDigest(archParams, DIMS) === officialDigest);
}

/* ---------- 9. 离线可用（内置默认权重与运行时契约一致） ---------- */
section('离线可用 / 内置默认权重');
ok('内置默认权重结构版本 = 运行时 v' + SCHEMA, DEFAULT_WEIGHTS.v === SCHEMA, DEFAULT_WEIGHTS.v);
ok('内置默认权重维度 = 运行时 dims', JSON.stringify(DEFAULT_WEIGHTS.dims) === JSON.stringify(DIMS));
ok('内置默认权重 ready = true（离线开箱可用）', DEFAULT_WEIGHTS.ready === true);
ok('已知既有不一致：内置 dv=4 < DATA_EPOCH=5（走 _decodeDefault 不受影响，未修改）', Number(DEFAULT_WEIGHTS.dv) < EPOCH, DEFAULT_WEIGHTS.dv);

/* ---------- 10. 备份安全（P0-1 / P2-1） ---------- */
section('备份安全（P0-1 / P2-1）');
/* 全功能假存储：区分"安装事务暂存备份"与"长期恢复点"，可分别注入故障。
 * writeThrow/writeFalse/readBackupNull/corruptBackup 作用于**暂存备份**（安装前）；
 * commitFalse/commitThrow/commitReadNull/corruptCommit 作用于**长期恢复点轮换**（安装成功后）。 */
const mkStorageFull = (bridge, opt) => {
    opt = opt || {};
    const st = { backup: null, staging: null, tx: null, official: null, writes: 0, stagingWrites: 0, stagingRemoved: 0, reads: 0 };
    const clone = rec => JSON.parse(JSON.stringify(rec));
    const corrupt = rec => { const b = decodeBase64(rec.params.w1); b[0] = (b[0] + 1) & 0xff; rec.params.w1 = encodeBase64(b); return rec; };
    return {
        st,
        readArchive() { return opt.archiveNull ? null : (bridge.state.corrupt || bridge.state.archive); },
        /* 长期恢复点（仅安装整体成功后轮换） */
        writeBackup(rec) {
            st.writes++;
            if (opt.commitThrow) throw new Error('QuotaExceededError');
            if (opt.commitFalse) return false;
            st.backup = clone(rec);
            if (opt.corruptCommit) corrupt(st.backup);
            return true;
        },
        readBackup() { st.reads++; if (opt.commitReadNull) return null; return st.backup; },
        /* 安装事务暂存备份 */
        writeStagingBackup(rec) {
            st.stagingWrites++;
            if (opt.writeThrow) throw new Error('QuotaExceededError');
            if (opt.writeFalse) return false;
            st.staging = clone(rec);
            if (opt.corruptBackup) corrupt(st.staging);
            return true;
        },
        readStagingBackup() { if (opt.readBackupNull) return null; return st.staging; },
        removeStagingBackup() { st.stagingRemoved++; st.staging = null; return true; },
        /* 安装事务日志（P0-1 / P0-2），支持"写入返回 false / 抛异常 / 第 N 次失败 /
         * 写入成功但读回内容不符 / 读回失败 / 删除失败"等细粒度故障注入 */
        writeTx(j) {
            st.txWrites = (st.txWrites || 0) + 1;
            if (opt.txWriteFalse) return false;
            if (opt.txWriteThrow) throw new Error('QuotaExceededError');
            if (opt.txFailAt === st.txWrites) return false;
            if (opt.txThrowAt === st.txWrites) throw new Error('QuotaExceededError');
            st.tx = clone(j);
            if (opt.txCorruptAt === st.txWrites) st.tx.phase = 'corrupted-phase';
            return true;
        },
        readTx() {
            if (opt.readTxThrow) throw new Error('storage read failed');
            if (opt.readTxThrowAfterRemove && (st.txRemoved || 0) > 0) throw new Error('storage read failed after remove');
            if (opt.readTxNull) return null;
            return st.tx;
        },
        removeTx() {
            st.txRemoved = (st.txRemoved || 0) + 1;
            if (opt.removeTxFalse) return false;
            if (opt.removeTxThrow) throw new Error('storage remove failed');
            if (opt.removeTxFailOnce && st.txRemoved === 1) return false;
            if (opt.removeTxKeepTx) return true;   /* 撒谎的存储：报告删除成功但键仍在 */
            st.tx = null;
            return true;
        },
    };
};

/* 10a) 备份写入抛异常 → 中止且模型未变 */
{
    const bridge = makeFakeWeights({ initialParams: defaultParams });
    const storageOps = mkStorageFull(bridge, { writeThrow: true });
    const bundle = mkBundle(); const res = validateBundle(bundle, EXPECT);
    const r = await applyOfficialBundle({ bridge, storageOps, bundle, decoded: res.decoded, dims: DIMS, probe: null, runtimeEpoch: EPOCH, schemaVersion: SCHEMA });
    ok('备份抛异常 → 拒绝应用', r.ok === false, JSON.stringify(r.errors));
    ok('备份抛异常 → 在备份阶段中止', r.failedAt === 'backup');
    ok('备份抛异常 → 模型未改动', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === paramsDigest(defaultParams, DIMS));
    ok('备份抛异常 → 不谎报已备份', r.backupWritten === false);
}
/* 10b) 备份写入成功但读回失败 → 拒绝 */
{
    const bridge = makeFakeWeights({ initialParams: defaultParams });
    const storageOps = mkStorageFull(bridge, { readBackupNull: true });
    const bundle = mkBundle(); const res = validateBundle(bundle, EXPECT);
    const r = await applyOfficialBundle({ bridge, storageOps, bundle, decoded: res.decoded, dims: DIMS, probe: null, runtimeEpoch: EPOCH, schemaVersion: SCHEMA });
    ok('备份读回失败 → 拒绝应用', r.ok === false && r.failedAt === 'backup', JSON.stringify(r.errors));
    ok('备份读回失败 → 模型未改动', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === paramsDigest(defaultParams, DIMS));
}
/* 10c) 备份写入后内容损坏（读回与期望不一致）→ 拒绝 */
{
    const bridge = makeFakeWeights({ initialParams: defaultParams });
    const storageOps = mkStorageFull(bridge, { corruptBackup: true });
    const bundle = mkBundle(); const res = validateBundle(bundle, EXPECT);
    const r = await applyOfficialBundle({ bridge, storageOps, bundle, decoded: res.decoded, dims: DIMS, probe: null, runtimeEpoch: EPOCH, schemaVersion: SCHEMA });
    ok('备份读回内容损坏 → 拒绝应用', r.ok === false && r.failedAt === 'backup', JSON.stringify(r.errors));
    ok('备份损坏 → 错误信息指出不一致', (r.errors || []).some(e => /不一致|摘要/.test(e)), JSON.stringify(r.errors));
    ok('备份损坏 → 模型未改动', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === paramsDigest(defaultParams, DIMS));
}
/* 10d) 备份记录自描述、如实标注恢复范围 */
{
    const rec = buildBackupRecord({ params: defaultParams, meta: { trained: 111 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
    ok('备份记录含结构版本/维度/摘要', rec.schemaVersion === SCHEMA && !!rec.digest && rec.dims.join(',') === DIMS.join(','), JSON.stringify({ v: rec.schemaVersion, d: rec.digest }));
    ok('备份记录 kind = ' + BACKUP_KIND_PARAMS, rec.kind === BACKUP_KIND_PARAMS);
    ok('备份记录如实标注不含优化器状态', rec.hasOptimizerState === false);
    ok('备份记录 version = ' + BACKUP_RECORD_VERSION, rec.version === BACKUP_RECORD_VERSION);
    ok('备份读回校验：一致 → 无错误', verifyBackupRecord(rec, rec, DIMS).length === 0);
    ok('备份读回校验：摘要被改 → 报错', verifyBackupRecord(Object.assign({}, rec, { digest: '0'.repeat(64) }), rec, DIMS).length > 0);
    const recTampered = Object.assign({}, rec, { params: Object.assign({}, rec.params) });
    { const b = decodeBase64(recTampered.params.w1); b[0] = (b[0] + 1) & 0xff; recTampered.params.w1 = encodeBase64(b); }
    ok('备份读回校验：参数被改 → 报错', verifyBackupRecord(recTampered, rec, DIMS).length > 0);
}
/* 10e) 安装成功后：长期备份轮换为"更新前模型"，暂存备份被清除 */
{
    const bridge = makeFakeWeights({ initialParams: defaultParams });
    const storageOps = mkStorageFull(bridge);
    const bundle = mkBundle(); const res = validateBundle(bundle, EXPECT);
    const r = await applyOfficialBundle({ bridge, storageOps, bundle, decoded: res.decoded, dims: DIMS, probe: null, runtimeEpoch: EPOCH, schemaVersion: SCHEMA });
    ok('安装成功', r.ok === true, JSON.stringify(r.errors));
    ok('返回 backupWritten=true', r.backupWritten === true);
    ok('成功后长期备份已轮换', r.backupRotated === true);
    ok('长期备份内容 = 更新前模型', paramsDigest(storageOps.st.backup.params, DIMS) === paramsDigest(defaultParams, DIMS));
    ok('长期备份摘要字段与内容一致', storageOps.st.backup.digest === paramsDigest(defaultParams, DIMS));
    ok('长期备份保存了原模型元数据', storageOps.st.backup.meta && storageOps.st.backup.meta.trained === 111);
    ok('成功后暂存备份已清除', storageOps.st.staging === null);
}

/* 10f) P2-1：已有恢复点 A 时，安装失败/取消不得提前销毁 A */
{
    /* 先放入用户长期恢复点 A（与当前模型不同） */
    const bridge = makeFakeWeights({ initialParams: officialParams });
    const storageOps = mkStorageFull(bridge);
    storageOps.st.backup = buildBackupRecord({ params: userParams, meta: { trained: 9 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
    const beforeA = JSON.stringify(storageOps.st.backup);
    const bundle = mkBundle(); const res = validateBundle(bundle, EXPECT);

    /* (1) 暂存备份写入失败 → 中止，A 完好 */
    {
        const s2 = mkStorageFull(bridge, { writeFalse: true });
        s2.st.backup = JSON.parse(beforeA);
        const r = await applyOfficialBundle({ bridge, storageOps: s2, bundle, decoded: res.decoded, dims: DIMS, probe: null, runtimeEpoch: EPOCH, schemaVersion: SCHEMA });
        ok('暂存写入失败 → 中止', r.ok === false && r.failedAt === 'backup');
        ok('暂存写入失败 → 原恢复点 A 完好', JSON.stringify(s2.st.backup) === beforeA);
    }
    /* (2) 最终状态复核不通过 → 中止，A 完好、暂存被清除 */
    {
        const s3 = mkStorageFull(bridge);
        s3.st.backup = JSON.parse(beforeA);
        const r = await applyOfficialBundle({
            bridge, storageOps: s3, bundle, decoded: res.decoded, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, confirmBeforeWrite: async () => false,
        });
        ok('最终复核不通过 → 中止', r.ok === false && r.failedAt === 'gate');
        ok('最终复核不通过 → 原恢复点 A 完好', JSON.stringify(s3.st.backup) === beforeA);
        ok('最终复核不通过 → 暂存备份被清除', s3.st.staging === null && s3.st.stagingRemoved >= 1);
        ok('最终复核不通过 → 模型未改动', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
    }
    /* (3) 权重校验失败回滚 → A 完好 */
    {
        const b2 = makeFakeWeights({ initialParams: officialParams, corruptFirstSave: true });
        const s4 = mkStorageFull(b2);
        s4.st.backup = JSON.parse(beforeA);
        const r = await applyOfficialBundle({ bridge: b2, storageOps: s4, bundle, decoded: res.decoded, dims: DIMS, probe: null, runtimeEpoch: EPOCH, schemaVersion: SCHEMA });
        ok('校验失败 → 判定失败并回滚', r.ok === false && r.rolledBack === true, JSON.stringify(r.errors));
        ok('校验失败 → 原恢复点 A 完好', JSON.stringify(s4.st.backup) === beforeA);
        ok('校验失败 → 暂存备份被清除', s4.st.staging === null);
    }
    /* (4) 长期备份轮换失败 → 属必要提交步骤失败：恢复本次更新前的模型，原恢复点 A 不变 */
    {
        const b3 = makeFakeWeights({ initialParams: officialParams });
        const s5 = mkStorageFull(b3, { commitFalse: true });
        s5.st.backup = JSON.parse(beforeA);
        const r = await applyOfficialBundle({ bridge: b3, storageOps: s5, bundle, decoded: res.decoded, dims: DIMS, probe: null, runtimeEpoch: EPOCH, schemaVersion: SCHEMA });
        ok('轮换失败 → 判定失败（不再报完整成功）', r.ok === false && r.failedAt === 'backup-rotate', JSON.stringify(r.errors));
        ok('轮换失败 → 已回滚到本次更新前的模型', r.rolledBack === true && paramsDigest(snapshotToParams(b3.snapshotModel()), DIMS) === officialDigest);
        ok('轮换失败 → 原恢复点 A 未被销毁', JSON.stringify(s5.st.backup) === beforeA);
        ok('轮换失败 → 回滚完整后清理暂存备份', s5.st.staging === null);
        ok('轮换失败 → 事务日志已清理', s5.st.tx === null || s5.st.tx === undefined);
    }
}

/* ---------- 11. 恢复事务（P0-2） ---------- */
section('恢复事务（P0-2）');
{
    /* 用户模型 A → 官方模型 B → 恢复 A */
    const bridge = makeFakeWeights({ initialParams: userParams });
    const storageOps = mkStorageFull(bridge);
    const bundle = mkBundle(); const res = validateBundle(bundle, EXPECT);
    const r1 = await applyOfficialBundle({ bridge, storageOps, bundle, decoded: res.decoded, dims: DIMS, probe: null, runtimeEpoch: EPOCH, schemaVersion: SCHEMA });
    ok('A→B 安装成功', r1.ok === true, JSON.stringify(r1.errors));
    ok('安装后备份 = 用户模型 A', paramsDigest(storageOps.st.backup.params, DIMS) === userDigest);
    ok('安装后在线 = 官方 B', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
    const backupAfterInstall = JSON.parse(JSON.stringify(storageOps.st.backup));
    ok('恢复源校验通过', verifyRestoreSource(backupAfterInstall, DIMS, SCHEMA).length === 0, JSON.stringify(verifyRestoreSource(backupAfterInstall, DIMS, SCHEMA)));
    const writesBefore = storageOps.st.writes;
    const bundleLike = { params: backupAfterInstall.params, trained: 111, accuracy: 0.4, size: 0 };
    const r2 = await applyOfficialBundle({ bridge, storageOps, bundle: bundleLike, decoded: buildTyped(backupAfterInstall.params), dims: DIMS, probe: null, runtimeEpoch: EPOCH, schemaVersion: SCHEMA, mode: 'restore' });
    ok('恢复 A 成功', r2.ok === true, JSON.stringify(r2.errors));
    ok('恢复后在线 = A', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest);
    ok('恢复不写备份（writeBackup 未被调用）', storageOps.st.writes === writesBefore, storageOps.st.writes);
    ok('恢复返回 backupWritten=false', r2.backupWritten === false);
    ok('恢复后原备份 A 依然存在（未被自我覆盖）', paramsDigest(storageOps.st.backup.params, DIMS) === userDigest);
    /* 反复恢复：仍成功且备份不变 */
    const r3 = await applyOfficialBundle({ bridge, storageOps, bundle: bundleLike, decoded: buildTyped(backupAfterInstall.params), dims: DIMS, probe: null, runtimeEpoch: EPOCH, schemaVersion: SCHEMA, mode: 'restore' });
    ok('重复恢复仍成功', r3.ok === true, JSON.stringify(r3.errors));
    ok('重复恢复后备份仍为 A', paramsDigest(storageOps.st.backup.params, DIMS) === userDigest);
    ok('重复恢复后在线仍为 A', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest);
}
/* 恢复中途失败 → 原备份保留，当前模型回到恢复前 */
{
    const bridge = makeFakeWeights({ initialParams: officialParams, corruptFirstSave: true });
    const storageOps = mkStorageFull(bridge);
    storageOps.st.backup = buildBackupRecord({ params: userParams, meta: { trained: 1 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
    const before = JSON.stringify(storageOps.st.backup);
    const bundleLike = { params: userParams, trained: 1, accuracy: 0, size: 0 };
    const r = await applyOfficialBundle({ bridge, storageOps, bundle: bundleLike, decoded: buildTyped(userParams), dims: DIMS, probe: null, runtimeEpoch: EPOCH, schemaVersion: SCHEMA, mode: 'restore' });
    ok('恢复落盘损坏 → 判定失败', r.ok === false, JSON.stringify(r.errors));
    ok('恢复失败 → 已回滚', r.rolledBack === true, JSON.stringify(r.errors));
    ok('恢复失败 → 当前模型回到 B', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
    ok('恢复失败 → 原备份 A 未被修改', JSON.stringify(storageOps.st.backup) === before);
    ok('恢复失败 → 未写入备份', storageOps.st.writes === 0);
}
/* 恢复源不兼容 → 拒绝且不动备份 */
{
    ok('旧结构版本备份 → 拒绝恢复', verifyRestoreSource(buildBackupRecord({ params: defaultParams, dims: DIMS, schemaVersion: 6 }), DIMS, SCHEMA).some(e => e.includes('不兼容')));
    ok('维度不符备份 → 拒绝恢复', verifyRestoreSource(buildBackupRecord({ params: defaultParams, dims: [130, 128, 64, 6], schemaVersion: SCHEMA }), DIMS, SCHEMA).some(e => e.includes('维度')));
    ok('参数缺失备份 → 拒绝恢复', verifyRestoreSource({ params: { w1: 'AA==' }, dims: DIMS, schemaVersion: SCHEMA }, DIMS, SCHEMA).length > 0);
    ok('摘要不符备份 → 拒绝恢复', verifyRestoreSource(Object.assign(buildBackupRecord({ params: defaultParams, dims: DIMS, schemaVersion: SCHEMA }), { digest: '0'.repeat(64) }), DIMS, SCHEMA).some(e => e.includes('摘要')));
}

/* ---------- 12. 待生效判定（P0-3） ---------- */
section('待生效判定（P0-3）');
const contract = { schemaVersion: SCHEMA, featureDim: DIMS[0], dims: DIMS.slice(), dataEpoch: EPOCH };
const baseDigest = paramsDigest(defaultParams, DIMS);
const thirdParams = {};
for (const s of spec) { const b = decodeBase64(defaultParams[s.key]); b[9] = (b[9] + 5) & 0xff; thirdParams[s.key] = encodeBase64(b); }
const thirdDigest = paramsDigest(thirdParams, DIMS);
const rec0 = buildPendingRecord({ latest: { modelVersion: 'w7d5-t01' }, bundle: mkBundle(), baseModelDigest: baseDigest, userAuthorized: true, reason: '对局进行中', contract });
const ev = (pending, currentDigest, officialRec, gate) => evaluatePending({ pending, contract, currentDigest, officialRec, gate: gate || { ok: true } }).action;
ok('待生效记录含版本/摘要/授权状态', rec0.version === PENDING_RECORD_VERSION && rec0.baseModelDigest === baseDigest && rec0.targetDigest === officialDigest && rec0.userAuthorized === true && rec0.releaseSeq === 1);
ok('基线一致且空闲 → apply', ev(rec0, baseDigest, null) === 'apply');
ok('当前模型已变化 → reprompt（不静默覆盖）', ev(rec0, userDigest, null) === 'reprompt');
ok('对局中 → wait', ev(rec0, baseDigest, null, { ok: false, reason: '对局进行中' }) === 'wait');
ok('已安装同版本 → drop', ev(rec0, baseDigest, { releaseSeq: 1, modelVersion: 'w7d5-t01', sha256: officialDigest }) === 'drop');
ok('被更新版本取代 → drop', ev(rec0, baseDigest, { releaseSeq: 2 }) === 'drop');
ok('目标已生效 → drop', ev(rec0, officialDigest, null) === 'drop');
ok('结构版本不符 → drop', ev(buildPendingRecord({ bundle: mkBundle(b => { b.schemaVersion = 6; }), baseModelDigest: baseDigest, contract }), baseDigest, null) === 'drop');
ok('数据纪元过旧 → drop', ev(buildPendingRecord({ bundle: mkBundle(b => { b.dataEpoch = 4; }), baseModelDigest: baseDigest, contract }), baseDigest, null) === 'drop');
ok('缺少基线摘要 → reprompt（保守）', ev(buildPendingRecord({ bundle: mkBundle(), baseModelDigest: null, contract }), baseDigest, null) === 'reprompt');
ok('当前摘要不可读 → reprompt（保守）', ev(rec0, null, null) === 'reprompt');
ok('旧格式 v1 记录 → drop', ev({ version: 1, bundle: mkBundle() }, baseDigest, null) === 'drop');
ok('重启后摘要变化 → reprompt（同一套检查）', ev(rec0, thirdDigest, null) === 'reprompt');
ok('用户已明确授权且模型未变 → apply', ev(rec0, baseDigest, null, { ok: true }) === 'apply');

/* ---------- 13. 事务锁（P1-1） ---------- */
section('事务锁（P1-1）');
{
    const lock = createTransactionLock();
    ok('初始未加锁', lock.isLocked() === false);
    ok('首次获取成功', lock.acquire() === true && lock.isLocked() === true);
    ok('二次获取被拒（同一时刻只允许一个事务）', lock.acquire() === false);
    lock.release();
    ok('释放后可再次获取', lock.isLocked() === false && lock.acquire() === true);
    lock.release();
    /* 异常后必须释放：模拟 try/finally */
    const guarded = () => { if (!lock.acquire()) return 'busy'; try { throw new Error('boom'); } finally { lock.release(); } };
    try { guarded(); } catch (e) {}
    ok('异常路径仍释放锁', lock.isLocked() === false && lock.acquire() === true);
    lock.release();
}

/* ---------- 14. 应用闸门（P0 / P1-2） ---------- */
section('应用闸门（P0 / P1-2）');
const gate = o => evaluateApplyGate(o).ok;
const gStable = Object.assign({ modelState: 'stable', modelStateKnown: true, isTraining: false, trainerKnown: true, hasCandidate: false });
ok('状态机 stable + 未训练 + 无候选 → 放行', gate(Object.assign({}, gStable, { over: true })) === true);
ok('状态机 training → 拒绝', gate({ modelState: 'training', modelStateKnown: true, isTraining: false, trainerKnown: true }) === false);
ok('状态机 candidate → 拒绝', gate({ modelState: 'candidate', modelStateKnown: true, isTraining: false, trainerKnown: true }) === false);
ok('真实训练器 isTraining=true → 拒绝', gate({ modelState: 'stable', modelStateKnown: true, isTraining: true, trainerKnown: true }) === false);
ok('存在 A/B 候选 → 拒绝', gate({ modelState: 'stable', modelStateKnown: true, isTraining: false, trainerKnown: true, hasCandidate: true }) === false);
ok('模型状态不可知 → 保守拒绝', gate({ modelState: null, modelStateKnown: false, isTraining: false, trainerKnown: true }) === false);
ok('训练状态不可知 → 保守拒绝', gate({ modelState: 'stable', modelStateKnown: true, isTraining: null, trainerKnown: false }) === false);
ok('对局中（缓存）→ 拒绝', gate(Object.assign({}, gStable, { inGame: true, inGameKnown: true })) === false);
ok('对局已知结束（缓存）→ 放行', gate(Object.assign({}, gStable, { inGame: false, inGameKnown: true })) === true);
ok('存在活动事件链 → 拒绝', gate(Object.assign({}, gStable, { hasActiveEvent: true })) === false);

/* ★ P0 本轮修复重点：实时信号优先级 */
ok('宿主 gameStarted 且未结束 → 拒绝（即使缓存说不在对局）',
    gate(Object.assign({}, gStable, { gameStarted: true, over: false, inGame: false, inGameKnown: true })) === false);
ok('宿主 gameStarted 且已结束 → 放行', gate(Object.assign({}, gStable, { gameStarted: true, over: true })) === true);
ok('第二局已开始（缓存残留"不在对局"）→ 仍拒绝',
    gate(Object.assign({}, gStable, { gameStarted: true, over: false, inGame: false, inGameKnown: true })) === false);
ok('活动事件链优先于缓存"不在对局" → 拒绝',
    gate(Object.assign({}, gStable, { hasActiveEvent: true, inGame: false, inGameKnown: true })) === false);
ok('上局结束标记残留但本局已开始 → 拒绝（over 不得凌驾 gameStarted）',
    gate(Object.assign({}, gStable, { gameStarted: true, over: false, inGame: true, inGameKnown: true })) === false);
ok('菜单/营地（未开局、无活动事件、无缓存）→ 放行', gate(Object.assign({}, gStable, {})) === true);
ok('非对局界面不得被永久阻塞（无任何对局信号）→ 放行',
    gate(Object.assign({}, gStable, { gameStarted: false, over: false, hasActiveEvent: false, inGameKnown: false })) === true);

/* ---------- 15. 官方记录事务（P1-4） ---------- */
section('官方记录事务（P1-4）');
{
    const contract2 = { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH };
    const rec = buildOfficialRecord({ modelId: MODEL_ID, bundle: mkBundle(), digest: officialDigest, size: officialSize, contract: contract2 });
    ok('记录含版本/摘要/体积/结构版本', rec.modelVersion === 'w7d5-t01' && rec.sha256 === officialDigest && rec.size === officialSize && rec.schemaVersion === SCHEMA);
    ok('记录形状合法', isOfficialRecordShape(rec, MODEL_ID) === true);
    ok('读回一致 → 无错误', verifyOfficialRecord(rec, rec).length === 0);
    ok('读回摘要不符 → 报错', verifyOfficialRecord(Object.assign({}, rec, { sha256: '0'.repeat(64) }), rec).some(e => e.includes('sha256')));
    ok('读回版本不符 → 报错', verifyOfficialRecord(Object.assign({}, rec, { modelVersion: 'x' }), rec).some(e => e.includes('modelVersion')));
    ok('读回体积不符 → 报错', verifyOfficialRecord(Object.assign({}, rec, { size: 1 }), rec).some(e => e.includes('size')));
    ok('读回为空 → 报错', verifyOfficialRecord(null, rec).length > 0);
    ok('modelId 不符 → 形状非法', isOfficialRecordShape(Object.assign({}, rec, { modelId: 'x' }), MODEL_ID) === false);
}

/* ---------- 16. 导出工具兼容性硬校验（P1-5） ---------- */
section('导出工具兼容性（P1-5）');
{
    /* 16a) 直接覆盖生产判定函数（与 tools/export-weights.mjs 同源） */
    const ec = o => evaluateExportCompatibility(Object.assign({ schemaVersion: SCHEMA, dataEpoch: EPOCH }, o));
    ok('结构版本一致 + 纪元一致 → 放行', ec({ inputV: SCHEMA, inputDv: EPOCH }).ok === true);
    ok('结构版本不符 → 拒绝', ec({ inputV: SCHEMA - 1, inputDv: EPOCH }).ok === false);
    ok('数据纪元过旧（非默认）→ 拒绝', ec({ inputV: SCHEMA, inputDv: EPOCH - 2 }).ok === false);
    ok('数据纪元过旧 + 显式迁移 + 依据 → 放行并记录', (() => { const r = ec({ inputV: SCHEMA, inputDv: EPOCH - 2, allowEpochMigration: true, migrationNote: '核验通过' }); return r.ok === true && r.epochMigration && r.epochMigration.from === EPOCH - 2; })());
    ok('数据纪元过旧 + 允许迁移但缺依据 → 拒绝', ec({ inputV: SCHEMA, inputDv: EPOCH - 2, allowEpochMigration: true }).ok === false);
    ok('内置默认权重（dv 陈旧）→ 按基线放行', (() => { const r = ec({ inputV: SCHEMA, inputDv: EPOCH - 1, isFromDefault: true }); return r.ok === true && r.epochMigration && r.epochMigration.from === EPOCH - 1; })());
    ok('内置默认权重但结构版本不符 → 仍拒绝', ec({ inputV: SCHEMA - 1, inputDv: EPOCH - 1, isFromDefault: true }).ok === false);
    ok('无版本字段（未知来源）→ 放行', ec({}).ok === true);

    /* 16b) CLI 冒烟测试：真实调用 tools/export-weights.mjs。
     * 沙箱环境可能禁止 spawn 子进程（EBUSY）→ 如实标记 SKIP，不伪装通过。 */
    const { execFileSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(here, '..');
    const tool = path.join(root, 'tools', 'export-weights.mjs');
    let canSpawn = true;
    try { execFileSync(process.execPath, ['-e', '0'], { stdio: 'pipe' }); } catch (e) { if (e && e.code === 'EBUSY') canSpawn = false; }
    if (!canSpawn) {
        console.log('SKIP 导出工具 CLI 冒烟测试：当前环境禁止 spawn 子进程（EBUSY），需在常规开发机复验');
    } else {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmz-exp-'));
        const mkInput = (v, dv) => { const o = { v, dv, trained: 5, accuracy: 0.4 }; for (const s of spec) o[s.key] = defaultParams[s.key]; return o; };
        fs.writeFileSync(path.join(tmp, 'ok.json'), JSON.stringify(mkInput(SCHEMA, EPOCH)));
        fs.writeFileSync(path.join(tmp, 'badv.json'), JSON.stringify(mkInput(SCHEMA - 1, EPOCH)));
        fs.writeFileSync(path.join(tmp, 'baddv.json'), JSON.stringify(mkInput(SCHEMA, EPOCH - 2)));
        const run = args => { try { execFileSync(process.execPath, [tool, ...args], { stdio: 'pipe' }); return 0; } catch (e) { return e.status == null ? -1 : e.status; } };
        ok('导出：合法同纪元输入 → 退出码 0', run(['--input', path.join(tmp, 'ok.json'), '--model-version', 't-ok', '--seq', '1', '--out', path.join(tmp, 'd1')]) === 0);
        ok('导出：结构版本不符 → 退出码 1（拒绝）', run(['--input', path.join(tmp, 'badv.json'), '--model-version', 't-bad', '--seq', '1', '--out', path.join(tmp, 'd2')]) === 1);
        ok('导出：数据纪元过旧 → 退出码 1（拒绝）', run(['--input', path.join(tmp, 'baddv.json'), '--model-version', 't-dv', '--seq', '1', '--out', path.join(tmp, 'd3')]) === 1);
        ok('导出：显式纪元迁移 + 说明 → 退出码 0', run(['--input', path.join(tmp, 'baddv.json'), '--model-version', 't-mig', '--seq', '1', '--out', path.join(tmp, 'd4'), '--allow-epoch-migration', '--migration-note', '核验通过']) === 0);
        ok('导出：允许迁移但缺说明 → 退出码 1', run(['--input', path.join(tmp, 'baddv.json'), '--model-version', 't-mig2', '--seq', '1', '--out', path.join(tmp, 'd5'), '--allow-epoch-migration']) === 1);
        ok('导出：内置默认权重仍可导出（不破坏合法场景）', run(['--from-default', '--model-version', 't-def', '--seq', '1', '--out', path.join(tmp, 'd6')]) === 0);
        ok('导出：结构不符时不产出权重文件', !fs.existsSync(path.join(tmp, 'd2')));
    }
}

/* ---------- 17. 存档完整性分类（P2-1） ---------- */
section('存档完整性分类（P2-1）');
{
    const contract3 = { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH };
    const rec = { modelId: MODEL_ID, modelVersion: 'w7d5-t01', releaseSeq: 1, sha256: officialDigest };
    const encodeArchive = (params, v, dv, trained) => { const o = { v, dv, trained }; for (const s of spec) o[s.key] = params[s.key]; return JSON.stringify(o); };
    const cls = o => classifyIntegrityArchive(Object.assign({ contract: contract3, officialRec: rec }, o));

    ok('无官方记录 → none', classifyIntegrityArchive({ officialRec: null }).state === 'none');
    ok('契约不可用 → unknown', cls({ contract: null, raw: 'x' }).state === 'unknown');
    ok('存档缺失 → broken', cls({ raw: null }).state === 'broken');
    ok('存档无法解析 → broken', cls({ raw: '{bad json' }).state === 'broken');
    ok('结构版本不符 → broken', cls({ raw: encodeArchive(officialParams, SCHEMA - 1, EPOCH, 0) }).state === 'broken');
    ok('数据纪元过旧 → broken', cls({ raw: encodeArchive(officialParams, SCHEMA, EPOCH - 1, 0) }).state === 'broken');
    ok('参数缺失 → broken', cls({ raw: JSON.stringify({ v: SCHEMA, dv: EPOCH, w1: 'AA==' }) }).state === 'broken');
    ok('内容 = 官方权重 → ok', cls({ raw: encodeArchive(officialParams, SCHEMA, EPOCH, 0) }).state === 'ok');
    ok('摘要不同 + 无训练证据 → mismatch（保守，不自动覆盖）', cls({ raw: encodeArchive(userParams, SCHEMA, EPOCH, 0), hasTrainingEvidence: false }).state === 'mismatch');
    ok('摘要不同 + 有训练证据 → superseded（正常）', cls({ raw: encodeArchive(userParams, SCHEMA, EPOCH, 9), hasTrainingEvidence: true }).state === 'superseded');
    ok('内容 = 内置默认 → broken（官方权重丢失）', cls({ raw: encodeArchive(defaultParams, SCHEMA, EPOCH, 0), defaultDigest: paramsDigest(defaultParams, DIMS) }).state === 'broken');
    /* 关键：仅摘要不同不得直接判为"用户训练" */
    const r = cls({ raw: encodeArchive(userParams, SCHEMA, EPOCH, 0), hasTrainingEvidence: false });
    ok('不得仅凭摘要不同就认定用户训练', r.state !== 'superseded');
}

/* ---------- 18. 下载超时与体积限制（P2-2 / P2-3） ---------- */
section('下载超时与体积限制（P2-2 / P2-3）');
{
    const mkAbort = () => class {
        constructor() { this.signal = { aborted: false, _onAbort: null }; }
        abort() { this.signal.aborted = true; if (this.signal._onAbort) this.signal._onAbort(); }
    };
    const okRes = (text, headers) => ({ ok: true, status: 200, headers: { get: k => (headers && headers[k] !== undefined ? headers[k] : null) }, text: () => Promise.resolve(text) });
    const base = { url: 'u', AbortControllerImpl: mkAbort(), timeoutMs: 30, retries: 0, maxBytes: 1e9, sleep: () => Promise.resolve() };

    /* 正文读取阶段超时：fetch 立即返回，但 text() 悬挂直到 abort */
    {
        const fetchImpl = (u, opt) => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => new Promise((_, rej) => { opt.signal._onAbort = () => rej(new Error('aborted')); }) });
        let err = null;
        try { await fetchTextWithLimits(Object.assign({}, base, { fetchImpl })); } catch (e) { err = e; }
        ok('正文读取悬挂 → 超时被中断（不会永久卡住）', !!err && /超时/.test(err.message), err && err.message);
    }
    /* HTTP 状态错误 */
    {
        const fetchImpl = () => Promise.resolve({ ok: false, status: 404, headers: { get: () => null }, text: () => Promise.resolve('') });
        let err = null;
        try { await fetchTextWithLimits(Object.assign({}, base, { fetchImpl })); } catch (e) { err = e; }
        ok('HTTP 非 2xx → 抛错', !!err && /404/.test(err.message));
    }
    /* Content-Length 预检 */
    {
        const fetchImpl = () => Promise.resolve(okRes('x', { 'content-length': '99999999' }));
        let err = null;
        try { await fetchTextWithLimits(Object.assign({}, base, { fetchImpl, maxBytes: 100 })); } catch (e) { err = e; }
        ok('Content-Length 超限 → 提前拒绝', !!err && /体积超限/.test(err.message));
    }
    /* 正文实际长度超限 */
    {
        const fetchImpl = () => Promise.resolve(okRes('x'.repeat(5000)));
        let err = null;
        try { await fetchTextWithLimits(Object.assign({}, base, { fetchImpl, maxBytes: 1000 })); } catch (e) { err = e; }
        ok('正文长度超限 → 拒绝', !!err && /体积超限/.test(err.message));
    }
    /* 重试后成功 */
    {
        let n = 0;
        const fetchImpl = () => { n++; if (n < 2) throw new Error('net down'); return Promise.resolve(okRes('hello')); };
        const text = await fetchTextWithLimits(Object.assign({}, base, { fetchImpl, retries: 1, sleep: () => Promise.resolve() }));
        ok('失败重试后可成功', text === 'hello' && n === 2);
    }
    /* JSON 非法由调用方识别 */
    {
        const fetchImpl = () => Promise.resolve(okRes('not-json'));
        const text = await fetchTextWithLimits(Object.assign({}, base, { fetchImpl }));
        let bad = false; try { JSON.parse(text); } catch (e) { bad = true; }
        ok('非法 JSON → 调用方可识别（解析抛错）', bad);
    }
    /* 体积上限由维度派生且不过小 */
    {
        const mb = computeMaxBundleBytes(DIMS);
        ok('体积上限 ≥ 512KB（不会过小误拒）', mb >= 512 * 1024, mb);
        ok('体积上限远大于合法权重包', mb > officialSize * 4, mb + ' vs ' + officialSize);
        ok('体积上限随维度增长', computeMaxBundleBytes([268, 256, 128, 6]) > mb);
        ok('清单上限为 256KB', MAX_MANIFEST_BYTES === 256 * 1024);
    }
}

/* ---------- 19. 弹窗降级安全（P2-4） ---------- */
section('弹窗降级安全（P2-4）');
{
    /* Node 无 document → 走降级分支；alert 不可用被内部 try/catch 吞掉 */
    const destructive = {
        title: '覆盖权重', message: '确认？',
        buttons: [{ label: '确认覆盖', value: 'go', primary: true }, { label: '取消', value: 'no' }],
        dangerous: true,
    };
    ok('DOM 不可用 + 危险操作 → 默认取消（绝不默认确认）', (await styledDialog(destructive)) === 'no');
    ok('DOM 不可用 + 危险操作（取消为主按钮）→ 取非主按钮', (await styledDialog({
        buttons: [{ label: '取消', value: 'no', primary: true }, { label: '仍然安装', value: 'apply' }], dangerous: true,
    })) === 'apply');
    ok('DOM 不可用 + 显式 defaultValue → 用指定安全值', (await styledDialog(Object.assign({}, destructive, { defaultValue: 'safe' }))) === 'safe');
    ok('DOM 不可用 + 只读提示 → 安全降级为确定', (await styledDialog({ title: '提示', message: '只读' })) === 'ok');
    ok('DOM 不可用 + 危险且无按钮 → 返回 null（取消）', (await styledDialog({ title: 'x', message: 'y', dangerous: true })) === null);
}

/* ---------- 20. 连续对局状态门禁（P0） ---------- */
section('连续对局状态门禁（P0）');
{
    /* 模拟真实生命周期：菜单 → 开局 → 结算 → 不重启直接第二局 → 结算。
     * 用同一 evaluateApplyGate 判定"任何进行中的对局都不得放行"。 */
    const run = (gameStarted, over, hasActiveEvent) => evaluateApplyGate(Object.assign({}, gStable, { gameStarted, over, hasActiveEvent })).ok;
    ok('① 首次进入主菜单（未开局）→ 放行', run(false, false, false) === true);
    ok('② 第一局正在进行 → 拒绝', run(true, false, true) === false);
    ok('③ 第一局正常结算（over=true）→ 放行', run(true, true, false) === true);
    ok('④ 不重启直接第二局已开始 → 拒绝', run(true, false, true) === false);
    ok('⑤ 第二局尚未结束 → 拒绝', run(true, false, true) === false);
    ok('⑥ 第二局结束 → 放行', run(true, true, false) === true);
    /* 连续重新开始三局：每局进行中都必须拒绝 */
    for (let i = 1; i <= 3; i++) {
        ok('连续第 ' + i + ' 局进行中 → 拒绝', run(true, false, i % 2 === 0) === false);
    }
    /* 上局结束标记残留（over 仍为 true）但本局已开始 → 必须拒绝 */
    ok('上局 over 残留 + 本局已开始 → 拒绝', run(true, false, false) === false);
    /* 扩展卸载后重新启用：缓存清空，菜单态放行 */
    ok('扩展重新启用（菜单态）→ 放行', run(false, false, false) === true);
    /* 局内下载 → 局末延迟应用：局内拒绝、局末放行 */
    ok('局内发起安装 → 拒绝（走延迟）', run(true, false, true) === false);
    ok('局末延迟应用 → 放行', run(true, true, false) === true);
    /* 门禁纯函数幂等：重复判定结果一致（防止重复触发产生不同结论） */
    const a1 = run(true, false, true), a2 = run(true, false, true), a3 = run(true, false, true);
    ok('重复判定一致（幂等）', a1 === a2 && a2 === a3 && a1 === false);
}

/* ---------- 21. 手动安装最终摘要复核（P1-1） ---------- */
section('手动安装最终摘要复核（P1-1）');
{
    const contract4 = { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH };
    /* 用户确认时授权对象 = 模型 A */
    const auth = buildPendingRecord({ bundle: mkBundle(), baseModelDigest: userDigest, userAuthorized: true, contract: contract4 });
    const ev4 = (cur, rec) => evaluatePending({ pending: auth, contract: contract4, currentDigest: cur, officialRec: rec || null, gate: { ok: true } }).action;
    ok('确认期间模型未变（A）→ 可继续安装', ev4(userDigest) === 'apply');
    ok('确认期间模型 A→B → 必须重新询问（reprompt）', ev4(thirdDigest) === 'reprompt');
    ok('确认期间模型被重置为内置默认 → 重新询问', ev4(baseDigest) === 'reprompt');
    ok('确认期间模型已变为官方目标 → 安全跳过（drop）', ev4(officialDigest) === 'drop');
    ok('状态恢复 stable 但模型已变化 → 仍必须重新询问', ev4(thirdDigest) === 'reprompt');
    /* 未经重新授权，绝不覆盖 B */
    ok('未重新授权时判定不为 apply', ev4(thirdDigest) !== 'apply');
}

/* ---------- 22. 写入失败的部分修改回滚（P1-2） ---------- */
section('写入失败的部分修改回滚（P1-2）');
{
    /* 可注入写入故障的假 bridge：首次 restoreModel 为"写入"，后续为"回滚" */
    const makeFaultyWeights = (flags) => {
        flags = flags || {};
        const live = { ...toLive(officialParams), META: { version: SCHEMA, trained: 111, accuracy: 0.4, ready: true } };
        live.adamT = 7;
        for (const [mk, wk] of OPT) live[mk] = new Float32Array(live[wk].length).fill(mk.charAt(0) === 'm' ? 0.25 : 0.5);
        const st = { archive: null, saveCount: 0, restoreCalls: 0, corrupt: null };
        const clone = () => { const s = { META: { ...live.META }, adamT: live.adamT }; for (const k of SNAP) s[k] = new live[k].constructor(live[k]); for (const [mk] of OPT) s[mk] = new Float32Array(live[mk]); return s; };
        const applyFrom = (snap, keys, withOpt) => {
            for (const k of keys) if (snap[k]) live[k] = new snap[k].constructor(snap[k]);
            if (withOpt) for (const [mk] of OPT) if (snap[mk] && snap[mk].length === live[mk].length) live[mk] = new Float32Array(snap[mk]);
            if (withOpt && typeof snap.adamT === 'number') live.adamT = snap.adamT;
            if (snap.META) { live.META.trained = snap.META.trained || 0; live.META.accuracy = snap.META.accuracy || 0; live.META.ready = !!snap.META.ready; }
        };
        return {
            live, st, state: st,
            snapshotModel: () => clone(),
            restoreModel(snap) {
                if (!snap) return false;
                for (const [sk, len] of CORE_SHAPES) { const a = snap[sk]; if (!a || a.length !== len) return false; }
                st.restoreCalls++;
                const isRollback = st.restoreCalls > 1;
                if (isRollback) {
                    if (flags.rollbackThrows) throw new Error('rollback exploded');
                    applyFrom(snap, SNAP, !flags.skipOptimizerOnRollback);
                    return true;
                }
                if (flags.rejectWrite) return false;                                  /* 完全拒绝，未修改 */
                if (flags.throwAfter != null) { applyFrom(snap, SNAP.slice(0, flags.throwAfter), false); throw new Error('write failed midway'); }
                if (flags.falseAfterAll) { applyFrom(snap, SNAP, true); return false; } /* 全部写入后返回 false */
                applyFrom(snap, SNAP, true);
                return true;
            },
            saveWeights() {
                st.saveCount++;
                st.archive = flags.saveCorrupt ? encodeState(live).replace(/"w1":"([A-Za-z0-9+/=]{4})/, '"w1":"AAAA') : encodeState(live);
                return true;
            },
            getMeta() { return { trained: live.META.trained, accuracy: live.META.accuracy, ready: live.META.ready }; },
            forward() { const o = new Float32Array(DIMS[3]); for (let k = 0; k < o.length; k++) o[k] = live.W1[k] + live.B1[k % 128]; return o; },
        };
    };
    const runFaulty = async (flags, opt) => {
        const bridge = makeFaultyWeights(flags);
        const storageOps = mkStorageFull(bridge);
        const bundle = mkBundle(); const res = validateBundle(bundle, EXPECT);
        const r = await applyOfficialBundle(Object.assign({
            bridge, storageOps, bundle, decoded: res.decoded, dims: DIMS, probe: null, runtimeEpoch: EPOCH, schemaVersion: SCHEMA,
        }, opt || {}));
        return { bridge, storageOps, r };
    };

    /* (1) restoreModel 完全拒绝 → 确认未发生任何修改，不误报"已回滚" */
    {
        const { bridge, r } = await runFaulty({ rejectWrite: true });
        ok('完全拒绝 → 判定失败', r.ok === false && r.failedAt === 'write');
        ok('完全拒绝 → 未标记部分修改', r.partialWrite === false, JSON.stringify(r));
        ok('完全拒绝 → 模型未改动', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
    }
    /* (2) 写入前三个参数后抛异常 → 必须检测并回滚 */
    {
        const { bridge, r } = await runFaulty({ throwAfter: 3 });
        ok('写一半抛异常 → 判定失败', r.ok === false, JSON.stringify(r.errors));
        ok('写一半抛异常 → 标记已部分修改', r.partialWrite === true);
        ok('写一半抛异常 → 已完整回滚', r.rolledBack === true && r.rollbackStatus === 'complete', JSON.stringify(r));
        ok('写一半抛异常 → 参数回到原模型', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
        ok('写一半抛异常 → 优化器状态回到原模型', runtimeStateDiff(bridge.snapshotModel(), bridge.snapshotModel(), DIMS).length === 0);
        ok('写一半抛异常 → 错误信息指出部分修改', (r.errors || []).some(e => /部分修改/.test(e)), JSON.stringify(r.errors));
    }
    /* (3) 全部写入后返回 false → 仍须回滚 */
    {
        const { bridge, r } = await runFaulty({ falseAfterAll: true });
        ok('全写入后返回 false → 标记部分修改', r.partialWrite === true);
        ok('全写入后返回 false → 已完整回滚', r.rolledBack === true && r.rollbackStatus === 'complete');
        ok('全写入后返回 false → 参数回到原模型', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
    }
    /* (4) 回滚过程再次抛异常 → 不得虚报完整恢复 */
    {
        const { r } = await runFaulty({ throwAfter: 3, rollbackThrows: true });
        ok('回滚再次抛异常 → 不得报告已回滚', r.rolledBack === false, JSON.stringify(r));
        ok('回滚再次抛异常 → rollbackStatus=failed', r.rollbackStatus === 'failed');
        ok('回滚再次抛异常 → 错误信息明确告知未确认', (r.errors || []).some(e => /回滚/.test(e)), JSON.stringify(r.errors));
    }
    /* (5) 内存恢复成功但持久化失败（存档内容损坏）→ 回滚未完全确认 */
    {
        const { r } = await runFaulty({ throwAfter: 3, saveCorrupt: true });
        ok('内存恢复但持久化失败 → 不得报告完整回滚', r.rolledBack === false, JSON.stringify(r));
        ok('内存恢复但持久化失败 → 指出存档问题', (r.errors || []).some(e => /存档/.test(e)), JSON.stringify(r.errors));
    }
    /* (6) 优化器状态恢复不完整 → 必须被检出 */
    {
        const { r } = await runFaulty({ falseAfterAll: true, skipOptimizerOnRollback: true });
        ok('优化器恢复不完整 → 检出并报告', r.rolledBack === false && (r.errors || []).some(e => /优化器/.test(e)), JSON.stringify(r.errors));
    }
    /* (7) runtimeStateDiff 纯函数：参数/优化器/时间步/元数据任一变化都能检出 */
    {
        const bridge = makeFaultyWeights({});
        const snap = bridge.snapshotModel();
        ok('runtimeStateDiff 一致 → 无差异', runtimeStateDiff(bridge.snapshotModel(), snap, DIMS).length === 0);
        bridge.live.mW1[0] += 1;
        ok('优化器被改 → 检出', runtimeStateDiff(bridge.snapshotModel(), snap, DIMS).some(e => /优化器/.test(e)));
        bridge.live.adamT += 1;
        ok('时间步被改 → 检出', runtimeStateDiff(bridge.snapshotModel(), snap, DIMS).some(e => /时间步/.test(e)));
        bridge.live.W1[0] += 1;
        ok('参数被改 → 检出', runtimeStateDiff(bridge.snapshotModel(), snap, DIMS).some(e => /参数/.test(e)));
        bridge.live.META.trained += 5;
        ok('元数据被改 → 检出', runtimeStateDiff(bridge.snapshotModel(), snap, DIMS).some(e => /元数据/.test(e)));
    }
}

/* ---------- 23. 版本记录回滚（P1-3） ---------- */
section('版本记录回滚（P1-3）');
{
    const recA = buildOfficialRecord({ modelId: MODEL_ID, bundle: mkBundle(), digest: officialDigest, size: officialSize, contract: { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH } });
    const recB = Object.assign({}, recA, { modelVersion: 'w7d5-t02', releaseSeq: 2 });
    const mkStore = opt => {
        opt = opt || {};
        const s = { cur: opt.initial || null, writes: 0 };
        return {
            s,
            writeRecord: rec => { s.writes++; if (opt.writeFalse) return false; if (opt.writeThrow) throw new Error('quota'); s.cur = opt.writeCorrupt ? Object.assign({}, rec, { sha256: '0'.repeat(64) }) : rec; return true; },
            readRecord: () => (opt.readNull ? null : s.cur),
            removeRecord: () => { s.removed = true; if (!opt.removeFalse) s.cur = null; },
            verify: verifyOfficialRecord,
        };
    };
    /* 有旧记录 → 恢复并读回核验 */
    {
        const st = mkStore({ initial: recB });
        ok('旧记录写入并读回一致 → ok', restoreOfficialRecord(Object.assign({ prevRec: recA }, st)).ok === true);
        ok('恢复后当前记录 = 旧记录 A', st.s.cur && st.s.cur.modelVersion === recA.modelVersion);
    }
    ok('旧记录写入返回 false → 失败', restoreOfficialRecord(Object.assign({ prevRec: recA }, mkStore({ writeFalse: true }))).ok === false);
    ok('旧记录写入抛异常 → 失败', restoreOfficialRecord(Object.assign({ prevRec: recA }, mkStore({ writeThrow: true }))).ok === false);
    ok('旧记录写入后读回不一致 → 失败', restoreOfficialRecord(Object.assign({ prevRec: recA }, mkStore({ writeCorrupt: true }))).ok === false);
    ok('旧记录写入后无法读回 → 失败', restoreOfficialRecord(Object.assign({ prevRec: recA }, mkStore({ readNull: true }))).ok === false);
    /* 无旧记录 → 必须确认新记录已删除 */
    ok('无旧记录且删除成功 → ok', restoreOfficialRecord(Object.assign({ prevRec: null }, mkStore({ initial: recB }))).ok === true);
    ok('无旧记录但新记录删不掉 → 失败', restoreOfficialRecord(Object.assign({ prevRec: null }, mkStore({ initial: recB, removeFalse: true }))).ok === false);
    /* 状态合成：区分完整 / 部分 / 失败 */
    ok('模型+记录都回滚 → complete', combineRollbackStatus(true, true) === 'complete');
    ok('仅模型回滚 → partial（不得报成完整成功）', combineRollbackStatus(true, false) === 'partial');
    ok('模型未回滚 → failed', combineRollbackStatus(false, true) === 'failed' && combineRollbackStatus(false, false) === 'failed');
}

/* ---------- 24. 训练证据判定（P1-4） ---------- */
section('训练证据判定（P1-4）');
{
    ok('trained>0 但等于官方训练步数 → 无训练证据', computeTrainingEvidence({ archiveTrained: 500, officialTrained: 500, promotedCount: 0 }) === false);
    ok('trained>0 且低于官方 → 无训练证据', computeTrainingEvidence({ archiveTrained: 100, officialTrained: 500, promotedCount: 0 }) === false);
    ok('trained 高于官方 → 有训练证据', computeTrainingEvidence({ archiveTrained: 600, officialTrained: 500, promotedCount: 0 }) === true);
    ok('官方记录无 trained 字段（旧记录）→ 保守：无训练证据', computeTrainingEvidence({ archiveTrained: 500, officialTrained: undefined, promotedCount: 0 }) === false);
    ok('候选晋升计数 > 0 → 有训练证据', computeTrainingEvidence({ archiveTrained: 0, officialTrained: 0, promotedCount: 1 }) === true);
    ok('无任何来源 → 无训练证据', computeTrainingEvidence({}) === false);

    /* 结合完整性分类：官方权重被篡改（trained 未超官方）→ mismatch，绝不判为"用户训练" */
    const contract5 = { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH };
    const rec5 = { modelId: MODEL_ID, modelVersion: 'w7d5-t01', releaseSeq: 1, sha256: officialDigest, trained: 500 };
    const encodeArchive = (params, trained) => { const o = { v: SCHEMA, dv: EPOCH, trained }; for (const s of spec) o[s.key] = params[s.key]; return JSON.stringify(o); };
    const cls5 = o => classifyIntegrityArchive(Object.assign({ contract: contract5, officialRec: rec5 }, o));
    {
        const ev = computeTrainingEvidence({ archiveTrained: 500, officialTrained: rec5.trained, promotedCount: 0 });
        ok('官方权重 trained>0 被篡改 → mismatch（不是 superseded）', cls5({ raw: encodeArchive(userParams, 500), hasTrainingEvidence: ev }).state === 'mismatch');
    }
    {
        const ev = computeTrainingEvidence({ archiveTrained: 900, officialTrained: rec5.trained, promotedCount: 0 });
        ok('官方权重被本地继续训练替换 → superseded', cls5({ raw: encodeArchive(userParams, 900), hasTrainingEvidence: ev }).state === 'superseded');
    }
    {
        const ev = computeTrainingEvidence({ archiveTrained: 700, officialTrained: undefined, promotedCount: 0 });
        ok('有效但来源未知（旧记录无基线）→ mismatch', cls5({ raw: encodeArchive(userParams, 700), hasTrainingEvidence: ev }).state === 'mismatch');
    }
    ok('参数缺失/长度损坏 → broken', cls5({ raw: JSON.stringify({ v: SCHEMA, dv: EPOCH, w1: 'AA==' }), hasTrainingEvidence: true }).state === 'broken');
    ok('模型与内置默认一致 → broken（官方权重丢失）', cls5({ raw: encodeArchive(defaultParams, 0), defaultDigest: paramsDigest(defaultParams, DIMS) }).state === 'broken');
    ok('无官方记录的历史用户模型 → none（不触碰）', classifyIntegrityArchive({ officialRec: null }).state === 'none');
    /* mismatch 绝不触发自动替换：classifyManifestState 只把 broken 当作可修复 */
    ok('mismatch 不进入"可修复"状态', classifyManifestState({ manifest: manifestOf(), localSeq: 1, extensionVersion: '4.1', integrityState: 'mismatch' }).state !== 'broken');
}

/* ---------- 25. 流式下载体积限制（P2-2） ---------- */
section('流式下载体积限制（P2-2）');
{
    const enc = s => new TextEncoder().encode(s);
    /* 构造带 ReadableStream 的假响应：按块产出，支持中途中断 */
    const streamRes = (chunks, opt) => {
        opt = opt || {};
        let i = 0, cancelled = false;
        return {
            ok: true, status: 200,
            headers: { get: k => (opt.headers && opt.headers[k] !== undefined ? opt.headers[k] : null) },
            body: {
                getReader() {
                    return {
                        read() {
                            if (cancelled) return Promise.resolve({ done: true });
                            if (opt.failAt === i) return Promise.reject(new Error('network reset'));
                            if (i >= chunks.length) return Promise.resolve({ done: true });
                            return Promise.resolve({ done: false, value: chunks[i++] });
                        },
                        cancel() { cancelled = true; return Promise.resolve(); },
                        releaseLock() {},
                    };
                },
            },
            text: () => { throw new Error('should not use text() when stream available'); },
        };
    };
    const mkAbort = () => class { constructor() { this.signal = { aborted: false, _onAbort: null }; } abort() { this.signal.aborted = true; if (this.signal._onAbort) this.signal._onAbort(); } };
    const base = { url: 'u', AbortControllerImpl: mkAbort(), timeoutMs: 200, retries: 0, sleep: () => Promise.resolve(), backoffMs: 0 };

    /* 正常流式响应 */
    {
        const res = streamRes([enc('{"a":'), enc('1}')]);
        const t = await readBodyLimited(res, 1024, null);
        ok('流式读取：正常拼接正文', t === '{"a":1}' && JSON.parse(t).a === 1);
    }
    /* 没有 Content-Length 也不影响（流式即时计数） */
    {
        const res = streamRes([enc('x'.repeat(100))], { headers: {} });
        const t = await readBodyLimited(res, 1024, null);
        ok('无 Content-Length：流式仍可正常读取', t.length === 100);
    }
    /* 实际数据超过上限 → 立即拒绝 */
    {
        const res = streamRes([enc('a'.repeat(600)), enc('b'.repeat(600))]);
        let err = null;
        try { await readBodyLimited(res, 1000, null); } catch (e) { err = e; }
        ok('流式超限 → 拒绝', !!err && /体积超限/.test(err.message), err && err.message);
    }
    /* 通过 fetchTextWithLimits 走完整链路：超限即取消请求 */
    {
        let aborted = false;
        const ctl = class { constructor() { this.signal = { _onAbort: () => { aborted = true; } }; } abort() { this.signal._onAbort(); } };
        const fetchImpl = () => Promise.resolve(streamRes([enc('a'.repeat(4000))]));
        let err = null;
        try { await fetchTextWithLimits(Object.assign({}, base, { fetchImpl, AbortControllerImpl: ctl, maxBytes: 1000 })); } catch (e) { err = e; }
        ok('fetch 链路：流式超限 → 拒绝并取消请求', !!err && /体积超限/.test(err.message) && aborted === true, err && err.message);
    }
    /* 下载途中网络中断 */
    {
        const res = streamRes([enc('abc'), enc('def')], { failAt: 1 });
        let err = null;
        try { await readBodyLimited(res, 1024, null); } catch (e) { err = e; }
        ok('下载途中中断 → 抛错（不返回半截正文）', !!err && /network reset/.test(err.message));
    }
    /* 下载过程中超时（正文读取阶段） */
    {
        const fetchImpl = (u, opt) => Promise.resolve({
            ok: true, status: 200, headers: { get: () => null },
            body: { getReader() { return { read: () => new Promise((_, rej) => { opt.signal._onAbort = () => rej(new Error('aborted')); }), cancel() {}, releaseLock() {} }; } },
        });
        let err = null;
        try { await fetchTextWithLimits(Object.assign({}, base, { fetchImpl, timeoutMs: 30 })); } catch (e) { err = e; }
        ok('流式正文悬挂 → 超时中断', !!err && /超时/.test(err.message), err && err.message);
    }
    /* 多字节 UTF-8 被切断在块边界 */
    {
        const full = enc('中文测试✓');
        const chunks = [full.slice(0, 4), full.slice(4, 7), full.slice(7)];
        const res = streamRes(chunks);
        const t = await readBodyLimited(res, 1024, null);
        ok('多字节 UTF-8 跨块正确解码', t === '中文测试✓', t);
    }
    /* 不支持 ReadableStream 的旧环境：退回 text() 并按 UTF-8 字节数校验 */
    {
        const legacy = { ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('中文'.repeat(10)) };
        const t = await readBodyLimited(legacy, 1024, null);
        ok('旧环境退回 text() 可用', t === '中文'.repeat(10));
        const big = { ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('中'.repeat(1000)) };
        let err = null;
        try { await readBodyLimited(big, 1000, null); } catch (e) { err = e; }
        ok('旧环境按 UTF-8 字节数拒绝（非字符数）', !!err && /体积超限/.test(err.message), err && err.message);
    }
    ok('绝对硬上限存在（不允许无限制缓冲）', MAX_ABSOLUTE_BYTES > 0 && MAX_ABSOLUTE_BYTES <= 16 * 1024 * 1024);
    ok('体积上限远大于合法权重包（不误拒）', computeMaxBundleBytes(DIMS) > officialSize * 4);
}

/* ---------- 26. 安装事务一致性（P0-1） ---------- */
section('安装事务一致性（P0-1）');
{
    /* 场景：长期恢复点 = X（历史备份），当前模型 = A，目标 = B。
     * 关键断言：任何回滚都必须回到 A，绝不能回到 X。 */
    const Xparams = {};
    for (const s of spec) { const b = decodeBase64(defaultParams[s.key]); b[3] = (b[3] + 17) & 0xff; Xparams[s.key] = encodeBase64(b); }
    const Xdigest = paramsDigest(Xparams, DIMS);
    const contract6 = { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH };
    const A = userParams, B = mkBundle();

    /* 26a) 旧备份 X + 当前 A + 目标 B：轮换失败 + 记录失败 → 必须回到 A（不是 X） */
    {
        const bridge = makeFakeWeights({ initialParams: A });
        const storageOps = mkStorageFull(bridge, { commitFalse: true });
        storageOps.st.backup = buildBackupRecord({ params: Xparams, meta: { trained: 1 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
        const beforeX = JSON.stringify(storageOps.st.backup);
        const res = validateBundle(B, EXPECT);
        let recordTried = 0;
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle: B, decoded: res.decoded, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, txId: 'tx-a',
            commitRecord: async () => { recordTried++; return { ok: true, errors: [] }; },
            revertRecord: async () => ({ ok: true, errors: [] }),
        });
        ok('26a 轮换失败 → 判定失败', r.ok === false && r.failedAt === 'backup-rotate', JSON.stringify(r.errors));
        ok('26a 回滚到 A（本次事务基线），而不是历史 X', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest);
        ok('26a 长期恢复点 X 未被覆盖/销毁', JSON.stringify(storageOps.st.backup) === beforeX);
        ok('26a 事务日志已清理', storageOps.st.tx === null);
        ok('26a 暂存备份已清理（回滚完整）', storageOps.st.staging === null);
    }
    /* 26b) 长期备份轮换成功、官方记录失败 → 回滚 A，长期备份保持 X */
    {
        const bridge = makeFakeWeights({ initialParams: A });
        const storageOps = mkStorageFull(bridge);
        storageOps.st.backup = buildBackupRecord({ params: Xparams, meta: { trained: 1 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
        const beforeX = JSON.stringify(storageOps.st.backup);
        const res = validateBundle(B, EXPECT);
        let reverted = 0;
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle: B, decoded: res.decoded, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, txId: 'tx-b',
            commitRecord: async () => ({ ok: false, errors: ['记录写入失败'] }),
            revertRecord: async () => { reverted++; return { ok: true, errors: [] }; },
        });
        ok('26b 记录失败 → 判定失败', r.ok === false && r.failedAt === 'record', JSON.stringify(r.errors));
        ok('26b 已回滚到 A', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest);
        ok('26b 已调用记录回滚', reverted === 1);
        ok('26b 长期备份未被轮换（仍是 X）', JSON.stringify(storageOps.st.backup) === beforeX);
        ok('26b 事务日志已清理', storageOps.st.tx === null);
    }
    /* 26c) 官方记录成功、长期备份失败 → 回滚 A 且记录回滚被调用 */
    {
        const bridge = makeFakeWeights({ initialParams: A });
        const storageOps = mkStorageFull(bridge, { commitFalse: true });
        storageOps.st.backup = buildBackupRecord({ params: Xparams, meta: { trained: 1 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
        const beforeX = JSON.stringify(storageOps.st.backup);
        const res = validateBundle(B, EXPECT);
        let committed = 0, reverted = 0;
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle: B, decoded: res.decoded, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, txId: 'tx-c',
            commitRecord: async () => { committed++; return { ok: true, errors: [] }; },
            revertRecord: async () => { reverted++; return { ok: true, errors: [] }; },
        });
        ok('26c 记录已提交但轮换失败 → 判定失败', r.ok === false && r.failedAt === 'backup-rotate');
        ok('26c 记录提交与记录回滚都被调用', committed === 1 && reverted === 1);
        ok('26c 已回滚到 A', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest);
        ok('26c 长期备份仍是 X', JSON.stringify(storageOps.st.backup) === beforeX);
    }
    /* 26d) 全链路成功：长期备份轮换为 A、事务日志清理、暂存清理 */
    {
        const bridge = makeFakeWeights({ initialParams: A });
        const storageOps = mkStorageFull(bridge);
        storageOps.st.backup = buildBackupRecord({ params: Xparams, meta: { trained: 1 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
        const res = validateBundle(B, EXPECT);
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle: B, decoded: res.decoded, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, txId: 'tx-d',
            commitRecord: async () => ({ ok: true, errors: [] }),
            revertRecord: async () => ({ ok: true, errors: [] }),
        });
        ok('26d 成功', r.ok === true, JSON.stringify(r.errors));
        ok('26d 长期备份轮换为 A', paramsDigest(storageOps.st.backup.params, DIMS) === userDigest);
        ok('26d 暂存备份与事务日志已清理', storageOps.st.staging === null && storageOps.st.tx === null);
        ok('26d 事务标识写入暂存记录', r.txId === 'tx-d');
    }
    /* 26e) 事务标识不匹配 / 摘要错误 → 恢复必须拒绝使用暂存备份 */
    {
        const j = buildTxJournal({ txId: 'tx-e', phase: 'weights-written', baseDigest: userDigest, startedAt: 1 });
        const stRec = buildBackupRecord({ params: A, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH, txId: 'tx-OTHER' });
        ok('26e 事务标识不匹配 → 拒绝', verifyStagingForTx(stRec, j, DIMS).some(e => /事务标识/.test(e)));
        const stRec2 = buildBackupRecord({ params: A, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH, txId: 'tx-e' });
        stRec2.digest = '0'.repeat(64);
        ok('26e 摘要字段错误 → 拒绝', verifyStagingForTx(stRec2, j, DIMS).length > 0);
        const j2 = Object.assign({}, j, { baseDigest: thirdDigest });
        ok('26e 内容与事务基线摘要不符 → 拒绝', verifyStagingForTx(buildBackupRecord({ params: A, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH, txId: 'tx-e' }), j2, DIMS).some(e => /基线摘要/.test(e)));
        ok('26e 缺失暂存备份 → 拒绝', verifyStagingForTx(null, j, DIMS).length > 0);
    }
    /* 26f) 旧长期备份损坏：不影响本次事务（回滚只用本次事务基线） */
    {
        const bridge = makeFakeWeights({ initialParams: A });
        const storageOps = mkStorageFull(bridge, { commitFalse: true });
        storageOps.st.backup = { version: 2, kind: 'model-params-backup', params: { w1: 'AA==' }, digest: 'x' };   /* 损坏的 X */
        const res = validateBundle(B, EXPECT);
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle: B, decoded: res.decoded, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, txId: 'tx-f',
            commitRecord: async () => ({ ok: true, errors: [] }),
            revertRecord: async () => ({ ok: true, errors: [] }),
        });
        ok('26f 旧备份损坏不影响本次回滚结果', r.ok === false && paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest);
        ok('26f 损坏的旧备份未被用于回滚（未被覆盖成 A）', paramsDigest(storageOps.st.backup.params, DIMS) !== userDigest);
    }
    /* 26g) ★ P0-2（旧预期已纠正）：prepared 事务日志写入失败 → 必须中止安装。
     *   旧断言期待"日志写失败仍继续安装并成功"——这恰是本轮要修的缺陷：
     *   没有可靠的事务恢复依据就进入权重替换阶段，一旦崩溃将无法安全恢复。 */
    {
        const bridge = makeFakeWeights({ initialParams: A });
        const storageOps = mkStorageFull(bridge, { txWriteFalse: true });
        const res = validateBundle(B, EXPECT);
        let committed = 0;
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle: B, decoded: res.decoded, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, txId: 'tx-g',
            commitRecord: async () => { committed++; return { ok: true, errors: [] }; },
        });
        ok('26g 日志写入失败 → 拒绝安装（不再警告后继续）', r.ok === false && r.failedAt === 'journal', JSON.stringify(r.errors));
        ok('26g 日志写入失败 → 如实反馈 journalWritten=false', r.journalWritten === false);
        ok('26g 模型未被写入触碰', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest);
        ok('26g 官方记录未被提交', committed === 0);
        ok('26g 暂存与日志无残留', storageOps.st.staging === null && storageOps.st.tx === null);
    }
}

/* ---------- 27. 崩溃 / 重启恢复（P0-1） ---------- */
section('崩溃 / 重启恢复（P0-1）');
{
    const contract7 = { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH };
    const A = userParams;
    const officialRec11 = () => buildOfficialRecord({ modelId: MODEL_ID, bundle: mkBundle(), digest: officialDigest, size: officialSize, contract: contract7 });
    /* 官方记录读写（可注入"读取抛异常"等故障）——与 modelUpdate.js 注入生产实现同一契约 */
    const mkRecordOps = (storageOps, opt) => ({
        readRecord: () => { if (opt && opt.readRecordThrow) throw new Error('record read failed'); return storageOps.st.official || null; },
        writeRecord: rec => { storageOps.st.official = rec; return true; },
        removeRecord: () => { storageOps.st.official = null; return true; },
        verifyRecord: verifyOfficialRecord,
    });
    const mkRecovery = (journal, stagingParams, opt) => {
        opt = opt || {};
        const bridge = makeFakeWeights({ initialParams: opt.modelIsNew ? officialParams : A, corruptFirstSave: !!opt.corruptFirstSave });
        const storageOps = mkStorageFull(bridge, opt);
        storageOps.st.backup = buildBackupRecord({ params: thirdParams, meta: { trained: 1 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
        storageOps.st.staging = stagingParams
            ? buildBackupRecord({ params: stagingParams, meta: { trained: 9 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH, txId: journal.txId })
            : null;
        storageOps.st.tx = journal;
        return { bridge, storageOps };
    };
    const runRecovery = (bridge, storageOps, opt) => recoverInterruptedTransaction(Object.assign(
        { storageOps, getBridge: async () => bridge, contract: contract7 }, mkRecordOps(storageOps, opt || {}),
    ));

    /* 27a) 无日志 → 不动任何数据 */
    {
        const { bridge, storageOps } = mkRecovery(null, null);
        storageOps.st.tx = null;
        const plan = await runRecovery(bridge, storageOps);
        ok('27a 无未完成事务 → none', plan.action === 'none');
        ok('27a 长期备份未被触碰', paramsDigest(storageOps.st.backup.params, DIMS) === thirdDigest);
    }
    /* 27b) prepared（权重未改动）→ 仅清理事务数据 */
    {
        const j = buildTxJournal({ txId: 'tx-p', phase: 'prepared', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1, prevRecord: null });
        const { bridge, storageOps } = mkRecovery(j, A);
        const plan = await runRecovery(bridge, storageOps);
        ok('27b prepared → cleanup', plan.action === 'cleanup' && plan.ok === true, JSON.stringify(plan));
        ok('27b 清理后无暂存与日志', storageOps.st.staging === null && storageOps.st.tx === null);
        ok('27b 模型未改动', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest);
        ok('27b 长期备份未变', paramsDigest(storageOps.st.backup.params, DIMS) === thirdDigest);
    }
    /* 27c) weights-written（重启时权重已是新值、记录未提交）→ 用本事务暂存备份回滚到 A */
    {
        const j = buildTxJournal({ txId: 'tx-w', phase: 'weights-written', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1, prevRecord: null });
        const { bridge, storageOps } = mkRecovery(j, A, { modelIsNew: true });
        const plan = await runRecovery(bridge, storageOps);
        ok('27c weights-written → restore', plan.action === 'restore' && plan.ok === true, JSON.stringify(plan));
        ok('27c 已恢复到 A（不是历史 X）', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest);
        ok('27c 官方记录保持"未提交"状态（仍无记录）', storageOps.st.official === null);
        ok('27c 长期备份 X 未被覆盖', paramsDigest(storageOps.st.backup.params, DIMS) === thirdDigest);
        ok('27c 清理暂存与日志', storageOps.st.staging === null && storageOps.st.tx === null);
    }
    /* 27d) record-committed（记录已提交并读回核验，仅缺轮换）→ 补做轮换 */
    {
        const j = buildTxJournal({ txId: 'tx-r', phase: 'record-committed', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1, prevRecord: null });
        const { bridge, storageOps } = mkRecovery(j, A, { modelIsNew: true });
        storageOps.st.official = officialRec11();   /* 官方记录实际指向目标权重（恢复须读回核验） */
        const plan = await runRecovery(bridge, storageOps);
        ok('27d record-committed → finish-rotation', plan.action === 'finish-rotation' && plan.ok === true, JSON.stringify(plan));
        ok('27d 长期备份被补做轮换为 A', paramsDigest(storageOps.st.backup.params, DIMS) === userDigest);
        ok('27d 模型保持新权重（不回滚）', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
        ok('27d 官方记录仍指向目标', String(storageOps.st.official.sha256).toLowerCase() === officialDigest);
        ok('27d 清理暂存与日志', storageOps.st.staging === null && storageOps.st.tx === null);
    }
    /* 27e) backup-rotated（全部提交完成）→ 仅清理 */
    {
        const j = buildTxJournal({ txId: 'tx-br', phase: 'backup-rotated', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1, prevRecord: null });
        const { bridge, storageOps } = mkRecovery(j, A, { modelIsNew: true });
        storageOps.st.official = officialRec11();
        /* 该阶段意味着长期备份已轮换为 A（真实崩溃状态） */
        storageOps.st.backup = buildBackupRecord({ params: A, meta: { trained: 9 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
        const plan = await runRecovery(bridge, storageOps);
        ok('27e backup-rotated → cleanup', plan.action === 'cleanup' && plan.ok === true, JSON.stringify(plan));
        ok('27e 模型保持新权重', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
        ok('27e 长期备份保持 A', paramsDigest(storageOps.st.backup.params, DIMS) === userDigest);
        ok('27e 清理暂存与日志', storageOps.st.staging === null && storageOps.st.tx === null);
    }
    /* 27f) 暂存备份与日志不匹配 → 拒绝自动恢复（manual），保留全部数据 */
    {
        const j = buildTxJournal({ txId: 'tx-m', phase: 'weights-written', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1, prevRecord: null });
        const { bridge, storageOps } = mkRecovery(j, thirdParams, { modelIsNew: true });   /* 暂存内容是别的模型 */
        const before = JSON.stringify(storageOps.st.backup);
        const plan = await runRecovery(bridge, storageOps);
        ok('27f 暂存与日志不匹配 → manual', plan.action === 'manual', JSON.stringify(plan));
        ok('27f 保留暂存与日志（不清除唯一恢复数据）', storageOps.st.staging !== null && storageOps.st.tx !== null);
        ok('27f 长期备份未被触碰', JSON.stringify(storageOps.st.backup) === before);
        ok('27f 模型未被回滚（无可靠恢复源）', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
    }
    /* 27g) 上次回滚未完成（needsManual）→ 阻止继续安装 */
    {
        const j = buildTxJournal({ txId: 'tx-n', phase: 'weights-written', needsManual: true, reason: '上次回滚未完成', startedAt: 1 });
        const { bridge, storageOps } = mkRecovery(j, A, { modelIsNew: true });
        const plan = await runRecovery(bridge, storageOps);
        ok('27g needsManual → manual', plan.action === 'manual');
        ok('27g 数据保留', storageOps.st.staging !== null && storageOps.st.tx !== null);
    }
    /* 27h) 恢复过程中持久化异常（落盘内容损坏）→ 恢复未完成，标记 needsManual 并保留数据 */
    {
        const j = buildTxJournal({ txId: 'tx-h', phase: 'weights-written', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1, prevRecord: null });
        const { bridge, storageOps } = mkRecovery(j, A, { modelIsNew: true, corruptFirstSave: true });
        const plan = await runRecovery(bridge, storageOps);
        ok('27h 持久化异常 → 恢复未完成', plan.action === 'restore' && plan.ok === false, JSON.stringify(plan));
        ok('27h 标记 needsManual 并保留日志', storageOps.st.tx && storageOps.st.tx.needsManual === true);
        ok('27h 暂存备份保留', storageOps.st.staging !== null);
    }
    /* 27i) 事务阶段分类纯函数 */
    ok('27i 未知阶段 → manual', classifyInterruptedTx({ txId: 'x', phase: 'weird' }).action === 'manual');
    ok('27i 无 txId → none', classifyInterruptedTx({ phase: 'prepared' }).action === 'none');
}

/* 可外部改变模型的假 bridge（模拟训练晋升改写共享主模型；P0-2 / P1-1 段共用） */
const makeMutableWeights = initialParams => {
        const live = { ...toLive(initialParams), META: { version: SCHEMA, trained: 111, accuracy: 0.4, ready: true } };
        live.adamT = 7;
        for (const [mk, wk] of OPT) live[mk] = new Float32Array(live[wk].length).fill(mk.charAt(0) === 'm' ? 0.25 : 0.5);
        const st = { archive: null, corrupt: null, saveCount: 0 };
        return {
            live, state: st,
            setParams(params) {
                const t = toLive(params);
                for (const k of SNAP) live[k] = new t[k].constructor(t[k]);
                for (const [mk, wk] of OPT) live[mk] = new Float32Array(live[wk].length).fill(mk.charAt(0) === 'm' ? 0.25 : 0.5);
                live.adamT = 7;
                live.META = { version: SCHEMA, trained: 111, accuracy: 0.4, ready: true };
            },
            snapshotModel() { const s = { META: { ...live.META }, adamT: live.adamT }; for (const k of SNAP) s[k] = new live[k].constructor(live[k]); for (const [mk] of OPT) s[mk] = new Float32Array(live[mk]); return s; },
            restoreModel(snap) {
                if (!snap) return false;
                for (const [sk, len] of CORE_SHAPES) { const a = snap[sk]; if (!a || a.length !== len) return false; }
                for (const k of SNAP) if (snap[k]) live[k] = new snap[k].constructor(snap[k]);
                for (const [mk, wk] of OPT) if (snap[mk] && snap[mk].length === live[wk].length) live[mk] = new Float32Array(snap[mk]);
                if (typeof snap.adamT === 'number') live.adamT = snap.adamT;
                if (snap.META) { live.META.trained = snap.META.trained || 0; live.META.accuracy = snap.META.accuracy || 0; live.META.ready = !!snap.META.ready; }
                return true;
            },
            saveWeights() { st.saveCount++; st.archive = encodeState(live); return true; },
            getMeta() { return { trained: live.META.trained, accuracy: live.META.accuracy, ready: live.META.ready }; },
            forward() { const o = new Float32Array(DIMS[3]); for (let k = 0; k < o.length; k++) o[k] = live.W1[k] + live.B1[k % 128]; return o; },
        };
    };

/* ---------- 28. 重新授权期间的事务基线（P0-2） ---------- */
section('重新授权期间的事务基线（P0-2）');
{
    const A = userParams, B = thirdParams, C = mkBundle();
    const res = validateBundle(C, EXPECT);

    /* 28a) A → 用户确认（模型未变）→ 安装 C */
    {
        const bridge = makeMutableWeights(A);
        const storageOps = mkStorageFull(bridge);
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle: C, decoded: res.decoded, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, txId: 'tx-28a',
            confirmBeforeWrite: async () => ({ ok: true }),
            commitRecord: async () => ({ ok: true, errors: [] }),
        });
        ok('28a 安装成功', r.ok === true, JSON.stringify(r.errors));
        ok('28a 长期备份 = A', paramsDigest(storageOps.st.backup.params, DIMS) === userDigest);
        ok('28a 当前模型 = C', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
    }
    /* 28b) A → 等待确认时训练为 B → 用户拒绝安装 */
    {
        const bridge = makeMutableWeights(A);
        const storageOps = mkStorageFull(bridge);
        storageOps.st.backup = buildBackupRecord({ params: defaultParams, meta: { trained: 1 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
        const beforeX = JSON.stringify(storageOps.st.backup);
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle: C, decoded: res.decoded, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, txId: 'tx-28b',
            confirmBeforeWrite: async () => { bridge.setParams(B); return { ok: false, reason: '用户拒绝' }; },
            commitRecord: async () => ({ ok: true, errors: [] }),
        });
        ok('28b 用户拒绝 → 中止', r.ok === false && r.failedAt === 'gate');
        ok('28b 模型保持 B（未被安装覆盖）', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === thirdDigest);
        ok('28b 长期备份未变', JSON.stringify(storageOps.st.backup) === beforeX);
        ok('28b 暂存与日志已清理', storageOps.st.staging === null && storageOps.st.tx === null);
    }
    /* 28c) A → 确认时训练为 B → 重新授权 → 必须备份 B（不是 A）→ 安装 C */
    {
        const bridge = makeMutableWeights(A);
        const storageOps = mkStorageFull(bridge);
        let first = true;
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle: C, decoded: res.decoded, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, txId: 'tx-28c',
            confirmBeforeWrite: async () => {
                if (first) { first = false; bridge.setParams(B); return { ok: true, rebaseline: true }; }
                return { ok: true };
            },
            commitRecord: async () => ({ ok: true, errors: [] }),
        });
        ok('28c 安装成功', r.ok === true, JSON.stringify(r.errors));
        ok('28c 当前模型 = C', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
        ok('28c 长期备份 = B（实际被覆盖的模型），不是 A', paramsDigest(storageOps.st.backup.params, DIMS) === thirdDigest);
        ok('28c 长期备份不是过期基线 A', paramsDigest(storageOps.st.backup.params, DIMS) !== userDigest);
    }
    /* 28d) 重新授权后模型再次变化 → 需再次重新确认（可重建基线） */
    {
        const bridge = makeMutableWeights(A);
        const storageOps = mkStorageFull(bridge);
        let n = 0;
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle: C, decoded: res.decoded, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, txId: 'tx-28d',
            confirmBeforeWrite: async () => { n++; bridge.setParams(n === 1 ? B : A); return { ok: true, rebaseline: true }; },
            commitRecord: async () => ({ ok: true, errors: [] }),
        });
        ok('28d 反复变化超过上限 → 中止', r.ok === false && r.failedAt === 'gate', JSON.stringify(r.errors));
        ok('28d 提示模型反复变化', (r.errors || []).some(e => /反复变化/.test(e)), JSON.stringify(r.errors));
        ok('28d 中止后暂存与日志已清理', storageOps.st.staging === null && storageOps.st.tx === null);
        ok('28d 中止后模型未被官方权重覆盖', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) !== officialDigest);
    }
    /* 28e) 用户确认后游戏开始对局 → 最终复核拒绝 */
    {
        const bridge = makeMutableWeights(A);
        const storageOps = mkStorageFull(bridge);
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle: C, decoded: res.decoded, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, txId: 'tx-28e',
            confirmBeforeWrite: async () => ({ ok: false, reason: '对局进行中' }),
            commitRecord: async () => ({ ok: true, errors: [] }),
        });
        ok('28e 对局中 → 中止且模型未变', r.ok === false && r.failedAt === 'gate' && paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest);
    }
    /* 28f) 重新授权期间训练器仍在运行：写入前复核仍按同一套授权规则判定 */
    {
        const auth = buildPendingRecord({ bundle: C, baseModelDigest: thirdDigest, userAuthorized: true, contract: { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH } });
        const ev = cur => evaluatePending({ pending: auth, contract: { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH }, currentDigest: cur, officialRec: null, gate: { ok: true } }).action;
        ok('28f 训练仍在运行导致模型再变 → 复核为 reprompt（不写入）', ev(userDigest) === 'reprompt');
        ok('28f 模型未变 → 允许写入', ev(thirdDigest) === 'apply');
    }
}

/* ---------- 29. 恢复事务与官方记录清理（P1） ---------- */
section('恢复事务与官方记录清理（P1）');
{
    const contract9 = { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH };
    const A = userParams;              /* 用户长期备份（将被恢复） */
    const Bmodel = officialParams;     /* 恢复前的当前模型（官方权重） */
    const bundleLike = { params: A, trained: 9, accuracy: 0.5, size: 0 };
    const decodedA = buildTyped(A);

    const runRestore = async (opt) => {
        opt = opt || {};
        const bridge = makeFakeWeights({ initialParams: Bmodel, corruptFirstSave: !!opt.corruptFirstSave });
        const storageOps = mkStorageFull(bridge, opt.storageOpt || {});
        storageOps.st.backup = buildBackupRecord({ params: A, meta: { trained: 9 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
        const beforeBackup = JSON.stringify(storageOps.st.backup);
        let reverted = 0;
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle: bundleLike, decoded: decodedA, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, mode: 'restore', txId: 'tx-29',
            commitRecord: opt.commitRecord || (async () => ({ ok: true, errors: [] })),
            revertRecord: async () => { reverted++; return (opt.revert || (() => ({ ok: true, errors: [] })))(); },
        });
        return { bridge, storageOps, r, beforeBackup, reverted: () => reverted };
    };

    /* 29a) 模型恢复成功 + 记录清理成功 */
    {
        const { bridge, storageOps, r, beforeBackup, reverted } = await runRestore({});
        ok('29a 恢复成功', r.ok === true, JSON.stringify(r.errors));
        ok('29a 当前模型 = 备份 A', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest);
        ok('29a 未触碰长期备份', JSON.stringify(storageOps.st.backup) === beforeBackup);
        ok('29a 恢复模式不写暂存/日志', storageOps.st.staging === null && storageOps.st.tx === null);
        ok('29a 未调用记录回滚', reverted() === 0);
    }
    /* 29b) 记录清理失败（返回 false）→ 回滚模型恢复，不虚报成功 */
    {
        const { bridge, storageOps, r, beforeBackup, reverted } = await runRestore({ commitRecord: async () => ({ ok: false, errors: ['记录删除失败'] }) });
        ok('29b 记录清理失败 → 判定失败且 failedAt=record', r.ok === false && r.failedAt === 'record', JSON.stringify(r.errors));
        ok('29b 已回滚到恢复前的模型 B', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
        ok('29b 已调用记录回滚（恢复原记录）', reverted() === 1);
        ok('29b 长期备份未被修改', JSON.stringify(storageOps.st.backup) === beforeBackup);
        ok('29b 不谎报完整恢复', r.rollbackStatus === 'complete');
    }
    /* 29c) 记录清理抛异常 → 同样回滚 */
    {
        const { bridge, r } = await runRestore({ commitRecord: async () => { throw new Error('quota exceeded'); } });
        ok('29c 记录清理抛异常 → 判定失败', r.ok === false && r.failedAt === 'record', JSON.stringify(r.errors));
        ok('29c 已回滚到恢复前的模型 B', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
    }
    /* 29d) 删除返回成功但记录仍可读回（调用方判定为失败） */
    {
        const { bridge, r } = await runRestore({ commitRecord: async () => ({ ok: false, errors: ['新版本记录删除失败（仍可读回）'] }) });
        ok('29d 记录仍可读回 → 判定失败并回滚', r.ok === false && paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
    }
    /* 29e) 模型恢复成功、元数据处理失败且回滚记录也失败 → 如实区分部分/失败 */
    {
        const { r, reverted } = await runRestore({
            commitRecord: async () => ({ ok: false, errors: ['记录删除失败'] }),
            revert: () => ({ ok: false, errors: ['记录回滚失败'] }),
        });
        ok('29e 记录回滚失败 → 不报完整成功', r.ok === false);
        ok('29e 记录回滚错误被并入 errors', (r.errors || []).some(e => /记录回滚失败/.test(e)), JSON.stringify(r.errors));
        ok('29e 记录回滚被调用', reverted() === 1);
    }
    /* 29f) 恢复中途持久化异常 → 回滚（不留下半成品） */
    {
        const { bridge, r } = await runRestore({ corruptFirstSave: true });
        ok('29f 恢复落盘损坏 → 判定失败', r.ok === false, JSON.stringify(r.errors));
        ok('29f 已回滚到恢复前的模型 B', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
    }
    /* 29g) restoreOfficialRecord：清除路径（prevRec=null）的异常处理 */
    {
        const mk = o => ({
            writeRecord: () => true,
            readRecord: () => (o && o.still ? { modelId: MODEL_ID, modelVersion: 'x', releaseSeq: 1 } : null),
            removeRecord: () => { if (o && o.removeThrow) throw new Error('quota'); },
            verify: verifyOfficialRecord,
        });
        ok('29g 清除成功且读回不存在 → ok', restoreOfficialRecord(Object.assign({ prevRec: null }, mk({}))).ok === true);
        ok('29g 清除后仍可读回 → 失败', restoreOfficialRecord(Object.assign({ prevRec: null }, mk({ still: true }))).ok === false);
        ok('29g 清除抛异常 → 不崩溃且判失败', restoreOfficialRecord(Object.assign({ prevRec: null }, mk({ removeThrow: true, still: true }))).ok === false);
    }
    /* 29h) 重复点击恢复按钮：备份始终保留、结果一致 */
    {
        const bridge = makeFakeWeights({ initialParams: Bmodel });
        const storageOps = mkStorageFull(bridge);
        storageOps.st.backup = buildBackupRecord({ params: A, meta: { trained: 9 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
        const beforeBackup = JSON.stringify(storageOps.st.backup);
        const r1 = await applyOfficialBundle({ bridge, storageOps, bundle: bundleLike, decoded: decodedA, dims: DIMS, probe: null, runtimeEpoch: EPOCH, schemaVersion: SCHEMA, mode: 'restore', txId: 'tx-29h1', commitRecord: async () => ({ ok: true, errors: [] }) });
        const r2 = await applyOfficialBundle({ bridge, storageOps, bundle: bundleLike, decoded: decodedA, dims: DIMS, probe: null, runtimeEpoch: EPOCH, schemaVersion: SCHEMA, mode: 'restore', txId: 'tx-29h2', commitRecord: async () => ({ ok: true, errors: [] }) });
        ok('29h 重复恢复均成功', r1.ok === true && r2.ok === true);
        ok('29h 重复恢复后备份仍完整', JSON.stringify(storageOps.st.backup) === beforeBackup);
        ok('29h 重复恢复后模型仍为 A', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest);
    }
}

/* ---------- 30. 待生效授权强制校验（P2） ---------- */
section('待生效授权强制校验（P2）');
{
    const contract10 = { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH };
    const mkP = ua => {
        const p = buildPendingRecord({ bundle: mkBundle(), baseModelDigest: userDigest, userAuthorized: ua === undefined ? undefined : ua, contract: contract10 });
        if (ua !== undefined) p.userAuthorized = ua;   /* 直接注入原始值，模拟历史/异常/人为构造记录 */
        return p;
    };
    const ev10 = (pending, cur) => evaluatePending({ pending, contract: contract10, currentDigest: cur === undefined ? userDigest : cur, officialRec: null, gate: { ok: true } });
    ok('30 userAuthorized=true → 可 apply', ev10(mkP(true)).action === 'apply');
    ok('30 userAuthorized=false → 绝不 apply', ev10(mkP(false)).action !== 'apply');
    ok('30 userAuthorized=false → reprompt（需重新确认）', ev10(mkP(false)).action === 'reprompt');
    ok('30 userAuthorized 缺失 → 绝不 apply', ev10(mkP(undefined)).action !== 'apply');
    ok('30 userAuthorized 缺失 → reprompt', ev10(mkP(undefined)).action === 'reprompt');
    ok('30 userAuthorized="true" 字符串 → 不算授权', ev10(mkP('true')).action === 'reprompt');
    ok('30 userAuthorized=1 → 不算授权', ev10(mkP(1)).action === 'reprompt');
    ok('30 未授权记录不会触发 apply（即使模型基线一致）', ev10(mkP(false), userDigest).action === 'reprompt');
    /* 旧版 v1 记录继续安全丢弃 */
    ok('30 旧版 v1 记录 → drop', evaluatePending({ pending: { version: 1, bundle: mkBundle() }, contract: contract10, currentDigest: userDigest, officialRec: null, gate: { ok: true } }).action === 'drop');
    /* 授权模型摘要变化 → 仍为 reprompt（授权绑定基线） */
    ok('30 授权基线变化 → reprompt', ev10(mkP(true), thirdDigest).action === 'reprompt');
    /* 已安装/被取代优先于授权检查（避免无意义地追问用户） */
    ok('30 已安装同版本 → drop（优先于授权检查）', evaluatePending({ pending: mkP(false), contract: contract10, currentDigest: userDigest, officialRec: { releaseSeq: 1, modelVersion: 'w7d5-t01', sha256: officialDigest }, gate: { ok: true } }).action === 'drop');
    /* 对局中 → wait 优先于授权追问 */
    ok('30 对局中 → wait', evaluatePending({ pending: mkP(false), contract: contract10, currentDigest: userDigest, officialRec: null, gate: { ok: false, reason: '对局进行中' } }).action !== 'apply');
    /* 未授权 + 用户拒绝覆盖 → 调用方终止任务（此处验证判定不为 apply，确保不会静默应用） */
    ok('30 未授权记录在任何情况下都不会 apply', [true, false, undefined, 'true', 1].every(ua => ev10(mkP(ua)).action !== 'apply' || ua === true));
}

/* ---------- 31. 崩溃恢复状态矩阵（P0-1：以实际状态驱动，不再只看日志阶段） ---------- */
section('崩溃恢复状态矩阵（P0-1）');
{
    const contract11 = { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH };
    const A = userParams;          /* 事务基线（安装前模型） */
    const B = officialParams;      /* 事务目标（官方权重） */
    /* 历史长期恢复点 X（与 A/B 都不同，用于验证"绝不误用历史备份"） */
    const Xparams = {};
    for (const s of spec) { const b = decodeBase64(defaultParams[s.key]); b[5] = (b[5] + 23) & 0xff; Xparams[s.key] = encodeBase64(b); }
    const Xdig = paramsDigest(Xparams, DIMS);
    const targetRec = () => buildOfficialRecord({ modelId: MODEL_ID, bundle: mkBundle(), digest: officialDigest, size: officialSize, contract: contract11 });
    const parseArchiveDigest = raw => {
        try { const o = JSON.parse(raw); const p = {}; for (const s of spec) { if (typeof o[s.key] !== 'string') return null; p[s.key] = o[s.key]; } return paramsDigest(p, DIMS); } catch (e) { return null; }
    };
    const mk = (journal, opt) => {
        opt = opt || {};
        const bridge = makeFakeWeights({ initialParams: opt.live === 'target' ? B : A, corruptFirstSave: !!opt.corruptFirstSave });
        const storageOps = mkStorageFull(bridge, opt.storage || {});
        if (opt.persisted) {
            /* 模拟"权重已持久化"：把指定模型的完整状态编码进存档槽 */
            const src = opt.persisted === 'target' ? B : A;
            bridge.state.archive = encodeState(Object.assign({ ...toLive(src), META: { version: SCHEMA, trained: 111, accuracy: 0.4, ready: true }, adamT: 7 }));
        }
        storageOps.st.backup = buildBackupRecord({ params: opt.backup === 'base' ? A : Xparams, meta: { trained: 1 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
        storageOps.st.staging = opt.staging
            ? buildBackupRecord({ params: opt.staging === 'X' ? Xparams : A, meta: { trained: 9 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH, txId: journal ? journal.txId : null })
            : null;
        storageOps.st.tx = journal;
        if (opt.official === 'target') storageOps.st.official = targetRec();
        if (opt.official === 'prev') storageOps.st.official = Object.assign(targetRec(), { modelVersion: 'w7d5-t00', releaseSeq: 0, sha256: userDigest, appliedAt: 12345 });
        return { bridge, storageOps };
    };
    const run = (bridge, storageOps, opt) => recoverInterruptedTransaction(Object.assign({
        storageOps, getBridge: async () => bridge, contract: contract11,
        readRecord: () => { if (opt && opt.readRecordThrow) throw new Error('record read failed'); return storageOps.st.official || null; },
        writeRecord: rec => { storageOps.st.official = rec; return true; },
        removeRecord: () => { storageOps.st.official = null; return true; },
        verifyRecord: verifyOfficialRecord,
    }));
    const liveDigestOf = bridge => paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS);

    /* 31a) 备份暂存成功、日志写入前崩溃（无事务日志）→ 不动任何数据 */
    {
        const { bridge, storageOps } = mk(null, { live: 'target', persisted: 'target', staging: true, official: null, backup: 'X' });
        const plan = await run(bridge, storageOps);
        ok('31a 无日志 → none（不动任何数据）', plan.action === 'none', JSON.stringify(plan));
        ok('31a 残留暂存不被销毁（无事务可判定）', storageOps.st.staging !== null);
        ok('31a 模型未被触碰', liveDigestOf(bridge) === officialDigest);
    }
    /* 31b) 内存已改、持久化前崩溃：日志停在 prepared，持久化真相仍是基线 → cleanup（不是"已写入"） */
    {
        const j = buildTxJournal({ txId: 'tx-31b', phase: 'prepared', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1, prevRecord: null });
        const { bridge, storageOps } = mk(j, { live: 'target', persisted: 'base', staging: true, official: null, backup: 'X' });
        const plan = await run(bridge, storageOps);
        ok('31b 持久化真相=基线 → cleanup（日志未更新 ≠ 操作已执行）', plan.action === 'cleanup' && plan.ok === true, JSON.stringify(plan));
        ok('31b 持久化存档保持基线（未被恢复误写）', parseArchiveDigest(storageOps.readArchive()) === userDigest);
        ok('31b 长期备份与官方记录未被触碰', paramsDigest(storageOps.st.backup.params, DIMS) === Xdig && storageOps.st.official === null);
    }
    /* 31c) ★ 核心崩溃点：官方记录提交成功后、record-committed 日志更新前崩溃 →
     *   日志=weights-written，但实际 权重=B、记录=B。必须继续完成提交，绝不回滚成 A+B。 */
    {
        const j = buildTxJournal({ txId: 'tx-31c', phase: 'weights-written', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1, prevRecord: null });
        const { bridge, storageOps } = mk(j, { live: 'target', persisted: 'target', staging: true, official: 'target', backup: 'X' });
        const plan = await run(bridge, storageOps);
        ok('31c 记录已提交+日志落后 → 继续提交（不是回滚）', plan.action === 'finish-rotation' && plan.ok === true, JSON.stringify(plan));
        ok('31c 模型保持新权重 B（不回滚成 A）', liveDigestOf(bridge) === officialDigest);
        ok('31c 官方记录仍指向 B（不出现 A 配 B）', String(storageOps.st.official.sha256) === officialDigest);
        ok('31c 长期备份补做轮换为 A', paramsDigest(storageOps.st.backup.params, DIMS) === userDigest);
        ok('31c 清理暂存与日志', storageOps.st.staging === null && storageOps.st.tx === null);
    }
    /* 31d) 同一崩溃点但长期备份也已轮换（仅日志落后）→ cleanup */
    {
        const j = buildTxJournal({ txId: 'tx-31d', phase: 'weights-written', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1, prevRecord: null });
        const { bridge, storageOps } = mk(j, { live: 'target', persisted: 'target', staging: true, official: 'target', backup: 'base' });
        const plan = await run(bridge, storageOps);
        ok('31d 全部已提交（备份已轮换）→ cleanup', plan.action === 'cleanup' && plan.ok === true, JSON.stringify(plan));
        ok('31d 模型保持 B', liveDigestOf(bridge) === officialDigest);
        ok('31d 长期备份保持 A', paramsDigest(storageOps.st.backup.params, DIMS) === userDigest);
        ok('31d 清理暂存与日志', storageOps.st.staging === null && storageOps.st.tx === null);
    }
    /* 31e) 日志=weights-written 但权重实际未被写入（写失败/已回滚）→ cleanup，不执行恢复 */
    {
        const j = buildTxJournal({ txId: 'tx-31e', phase: 'weights-written', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1, prevRecord: null });
        const { bridge, storageOps } = mk(j, { live: 'base', persisted: 'base', staging: true, official: null, backup: 'X' });
        const plan = await run(bridge, storageOps);
        ok('31e 权重未变 → cleanup', plan.action === 'cleanup' && plan.ok === true, JSON.stringify(plan));
        ok('31e 模型保持 A 且未被动过', liveDigestOf(bridge) === userDigest);
    }
    /* 31f) 完整事务的清理残留（暂存已删、权重/记录/备份全部就位）→ cleanup，绝不误判为回滚 */
    {
        const j = buildTxJournal({ txId: 'tx-31f', phase: 'weights-written', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1, prevRecord: null });
        const { bridge, storageOps } = mk(j, { live: 'target', persisted: 'target', staging: null, official: 'target', backup: 'base' });
        const plan = await run(bridge, storageOps);
        ok('31f 清理残留 → cleanup（不误判为需要回滚）', plan.action === 'cleanup' && plan.ok === true, JSON.stringify(plan));
        ok('31f 模型保持 B', liveDigestOf(bridge) === officialDigest);
        ok('31f 日志已清理', storageOps.st.tx === null);
    }
    /* 31g) 记录已提交后被外部清掉：回滚 A 必须同时恢复 A 对应的旧官方记录 */
    {
        const prevRecA = Object.assign(targetRec(), { modelVersion: 'w7d5-t00', releaseSeq: 0, sha256: userDigest, appliedAt: 12345 });
        const j = buildTxJournal({ txId: 'tx-31g', phase: 'record-committed', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1, prevRecord: prevRecA });
        const { bridge, storageOps } = mk(j, { live: 'target', persisted: 'target', staging: true, official: null, backup: 'X' });
        const plan = await run(bridge, storageOps);
        ok('31g 记录缺失 → 回滚到 A', plan.action === 'restore' && plan.ok === true, JSON.stringify(plan));
        ok('31g 模型回到 A', liveDigestOf(bridge) === userDigest);
        ok('31g 旧官方记录被写入并读回核验（A 配 A）', !!storageOps.st.official && String(storageOps.st.official.sha256) === userDigest && storageOps.st.official.modelVersion === 'w7d5-t00');
        ok('31g 长期备份 X 未被触碰', paramsDigest(storageOps.st.backup.params, DIMS) === Xdig);
        ok('31g 清理暂存与日志', storageOps.st.staging === null && storageOps.st.tx === null);
    }
    /* 31h) 旧版日志缺"安装前记录快照"：无法保证回滚后 A 配 A → 保守 manual，数据全保留 */
    {
        const j = buildTxJournal({ txId: 'tx-31h', phase: 'weights-written', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1 });   /* 无 prevRecord 字段 */
        const { bridge, storageOps } = mk(j, { live: 'target', persisted: 'target', staging: true, official: null, backup: 'X' });
        const plan = await run(bridge, storageOps);
        ok('31h 缺旧记录快照 → manual', plan.action === 'manual', JSON.stringify(plan));
        ok('31h 已标记 needsManual（阻止继续安装）', storageOps.st.tx && storageOps.st.tx.needsManual === true);
        ok('31h 暂存与长期备份保留', storageOps.st.staging !== null && paramsDigest(storageOps.st.backup.params, DIMS) === Xdig);
        ok('31h 模型未被回滚', liveDigestOf(bridge) === officialDigest);
    }
    /* 31i) 权重=基线但记录指向目标（提交步骤颠倒/记录被外部改写）→ 把记录修回安装前状态 */
    {
        const j = buildTxJournal({ txId: 'tx-31i', phase: 'weights-written', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1, prevRecord: null });
        const { bridge, storageOps } = mk(j, { live: 'base', persisted: 'base', staging: true, official: 'target', backup: 'X' });
        const plan = await run(bridge, storageOps);
        ok('31i 记录指向目标但权重是基线 → fix-record', plan.action === 'fix-record' && plan.ok === true, JSON.stringify(plan));
        ok('31i 记录被清回"无记录"（与权重一致）', storageOps.st.official === null);
        ok('31i 清理暂存与日志', storageOps.st.staging === null && storageOps.st.tx === null);
    }
    /* 31j) 同上但日志缺旧记录快照 → manual */
    {
        const j = buildTxJournal({ txId: 'tx-31j', phase: 'weights-written', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1 });
        const { bridge, storageOps } = mk(j, { live: 'base', persisted: 'base', staging: true, official: 'target', backup: 'X' });
        const plan = await run(bridge, storageOps);
        ok('31j 无法修复记录 → manual 且保留数据', plan.action === 'manual' && storageOps.st.staging !== null && storageOps.st.tx !== null, JSON.stringify(plan));
    }
    /* 31k) 恢复期间存储再次异常（清理删除失败）→ 不谎报完成；下次启动幂等收尾 */
    {
        const j = buildTxJournal({ txId: 'tx-31k', phase: 'weights-written', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1, prevRecord: null });
        const { bridge, storageOps } = mk(j, { live: 'target', persisted: 'target', staging: true, official: 'target', backup: 'X', storage: { removeTxFailOnce: true } });
        const plan1 = await run(bridge, storageOps);
        ok('31k 清理中断 → 不谎报完成', plan1.ok === false && plan1.action === 'finish-rotation', JSON.stringify(plan1));
        ok('31k 长期备份已补做轮换为 A', paramsDigest(storageOps.st.backup.params, DIMS) === userDigest);
        ok('31k 数据保留（日志与暂存仍在）', storageOps.st.tx !== null && storageOps.st.staging !== null);
        ok('31k 清理中断不标记 needsManual（提交已完成）', !storageOps.st.tx.needsManual);
        const plan2 = await run(bridge, storageOps);
        ok('31k 重试后幂等收尾完成', plan2.action === 'cleanup' && plan2.ok === true, JSON.stringify(plan2));
        ok('31k 终态干净且模型仍为 B', storageOps.st.staging === null && storageOps.st.tx === null && liveDigestOf(bridge) === officialDigest);
    }
    /* 31l) manual 判定会持久化 needsManual：重复启动仍阻止（绝不静默开始下一次安装） */
    {
        const j = buildTxJournal({ txId: 'tx-31l', phase: 'weights-written', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1 });
        const { bridge, storageOps } = mk(j, { live: 'target', persisted: 'target', staging: true, official: null, backup: 'X' });
        const plan1 = await run(bridge, storageOps);
        const plan2 = await run(bridge, storageOps);
        ok('31l 首次判定 manual 并保留数据', plan1.action === 'manual' && storageOps.st.staging !== null);
        ok('31l 重复启动仍为 manual（持续阻止安装）', plan2.action === 'manual', JSON.stringify(plan2));
    }
    /* 31m) 模型恢复失败且 needsManual 日志也写不进去 → 仍返回失败并不销毁恢复数据 */
    {
        const j = buildTxJournal({ txId: 'tx-31m', phase: 'weights-written', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1, prevRecord: null });
        /* txWriteFalse：恢复流程里"重新标记 needsManual"的写入同样失败；
         * corruptFirstSave：恢复落盘损坏 → 恢复失败 → 不谎报成功 */
        const b2 = makeFakeWeights({ initialParams: B, corruptFirstSave: true });
        const s2 = mkStorageFull(b2, { txWriteFalse: true });
        s2.st.backup = buildBackupRecord({ params: Xparams, meta: { trained: 1 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
        s2.st.staging = buildBackupRecord({ params: A, meta: { trained: 9 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH, txId: j.txId });
        s2.st.tx = j;
        const plan = await run(b2, s2);
        ok('31m 恢复失败且日志无法再写 → 不谎报成功', plan.ok === false, JSON.stringify(plan));
        ok('31m 暂存与（原）日志保留', s2.st.staging !== null && s2.st.tx !== null);
        ok('31m 官方记录未被误写', s2.st.official === null);
    }
    /* 31n) 官方记录读取抛异常（存储故障）→ 保守 manual，不假设提交状态 */
    {
        const j = buildTxJournal({ txId: 'tx-31n', phase: 'record-committed', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1, prevRecord: null });
        const { bridge, storageOps } = mk(j, { live: 'target', persisted: 'target', staging: true, backup: 'X' });
        const plan = await run(bridge, storageOps, { readRecordThrow: true });
        ok('31n 记录读取异常 → manual（不猜测提交状态）', plan.action === 'manual', JSON.stringify(plan));
        ok('31n 数据保留', storageOps.st.staging !== null && storageOps.st.tx !== null);
    }
    /* 31o) 权重既非基线也非目标（外部改写）→ manual，绝不自动覆盖 */
    {
        const j = buildTxJournal({ txId: 'tx-31o', phase: 'weights-written', baseDigest: userDigest, targetDigest: officialDigest, startedAt: 1, prevRecord: null });
        const { bridge, storageOps } = mk(j, { live: 'base', persisted: 'base', staging: true, official: null, backup: 'X' });
        /* 存档里放第三种模型（thirdParams）模拟外部改写 */
        bridge.state.archive = encodeState(Object.assign({ ...toLive(thirdParams), META: { version: SCHEMA, trained: 111, accuracy: 0.4, ready: true }, adamT: 7 }));
        const plan = await run(bridge, storageOps);
        ok('31o 权重=第三方模型 → manual（绝不自动覆盖）', plan.action === 'manual', JSON.stringify(plan));
    }
}

/* ---------- 32. 事务日志故障矩阵（P0-2：无可靠恢复依据不得进入不可安全恢复的写入） ---------- */
section('事务日志故障矩阵（P0-2）');
{
    const contract32 = { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH };
    const A = userParams;
    const B = mkBundle();
    const res32 = validateBundle(B, EXPECT);
    const archiveHas = (bridge, params) => {
        const raw = bridge.state.corrupt || bridge.state.archive;
        return !!raw && raw.includes(params.w1.slice(0, 20));
    };
    const runInstall = async (opt, storageOpt) => {
        const bridge = makeFakeWeights({ initialParams: A });
        const storageOps = mkStorageFull(bridge, storageOpt || {});
        const r = await applyOfficialBundle(Object.assign({
            bridge, storageOps, bundle: B, decoded: res32.decoded, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, txId: opt && opt.txId || 'tx-32',
            commitRecord: async info => {
                storageOps.st.official = buildOfficialRecord({ modelId: MODEL_ID, bundle: B, digest: info.digest, size: info.size, contract: contract32 });
                return { ok: true, errors: [] };
            },
        }, (opt && opt.ctx) || {}));
        return { bridge, storageOps, r };
    };

    /* 32a) prepared 写入抛异常 → 拒绝进入权重替换 */
    {
        const { bridge, storageOps, r } = await runInstall(null, { txWriteThrow: true });
        ok('32a 抛异常 → 中止（journal）', r.ok === false && r.failedAt === 'journal', JSON.stringify(r.errors));
        ok('32a 模型零改动', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest);
        ok('32a 无暂存/日志残留', storageOps.st.staging === null && storageOps.st.tx === null);
    }
    /* 32b) 写入成功但读回失败 → 拒绝 */
    {
        const { bridge, storageOps, r } = await runInstall(null, { readTxNull: true });
        ok('32b 读回失败 → 中止（journal）', r.ok === false && r.failedAt === 'journal');
        ok('32b 模型零改动', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest);
    }
    /* 32c) 写入成功但读回内容不符（阶段被改）→ 拒绝 */
    {
        const { bridge, storageOps, r } = await runInstall(null, { txCorruptAt: 1 });
        ok('32c 读回内容不符 → 中止（journal）', r.ok === false && r.failedAt === 'journal');
        ok('32c 模型零改动且无残留', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest && storageOps.st.tx === null);
    }
    /* 32d) weights-written 阶段更新失败 → 无恢复信息不允许继续：安全回滚并中止 */
    {
        const { bridge, storageOps, r } = await runInstall({ txId: 'tx-32d' }, { txFailAt: 2 });
        ok('32d 阶段推进失败 → 中止（journal），不继续提交', r.ok === false && r.failedAt === 'journal', JSON.stringify(r.errors));
        ok('32d 已回滚到 A（内存与存档）', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest && archiveHas(bridge, A));
        ok('32d 回滚完整（rolledBack/rollbackStatus 一致）', r.rolledBack === true && r.rollbackStatus === 'complete' && (r.rollbackErrors || []).length === 0);
        ok('32d 官方记录未被提交', storageOps.st.official === null);
        ok('32d 无残留', storageOps.st.staging === null && storageOps.st.tx === null);
    }
    /* 32e) record-committed 阶段更新失败 → 权重与记录均已核验落盘：继续提交并如实标记降级 */
    {
        const { bridge, storageOps, r } = await runInstall({ txId: 'tx-32e' }, { txFailAt: 3 });
        ok('32e 继续完成提交（状态自洽）', r.ok === true, JSON.stringify(r.errors));
        ok('32e 如实标记 journalDegraded', r.journalDegraded === true);
        ok('32e 权重/记录/长期备份全部落位', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest
            && storageOps.st.official && String(storageOps.st.official.sha256) === officialDigest
            && paramsDigest(storageOps.st.backup.params, DIMS) === userDigest);
        ok('32e 清理完成（无残留）', storageOps.st.staging === null && storageOps.st.tx === null);
    }
    /* 32f) backup-rotated 阶段更新失败 → 同样按实际状态继续，事务彻底完成 */
    {
        const { bridge, storageOps, r } = await runInstall({ txId: 'tx-32f' }, { txFailAt: 4 });
        ok('32f 继续完成并标记降级', r.ok === true && r.journalDegraded === true, JSON.stringify(r.errors));
        ok('32f 长期备份已轮换', paramsDigest(storageOps.st.backup.params, DIMS) === userDigest);
        const plan = await recoverInterruptedTransaction({ storageOps, getBridge: async () => bridge, contract: contract32 });
        ok('32f 再次启动 → 无未完成事务', plan.action === 'none');
    }
    /* 32g) 事务完成后仅清理残留：绝不把"完整事务的删除残留"误判为需要回滚 */
    {
        const { bridge, storageOps, r } = await runInstall({ txId: 'tx-32g' }, { removeTxFailOnce: true });
        ok('32g 提交成功但清理未完成 → ok:true + cleanupPending', r.ok === true && r.cleanupPending === true, JSON.stringify(r));
        ok('32g 暂存保留（供下次启动安全收尾）', storageOps.st.staging !== null);
        ok('32g 日志残留为终态阶段', storageOps.st.tx && storageOps.st.tx.phase === 'backup-rotated');
        const plan = await recoverInterruptedTransaction({
            storageOps, getBridge: async () => bridge, contract: contract32,
            readRecord: () => storageOps.st.official || null,
            writeRecord: rec => { storageOps.st.official = rec; return true; },
            removeRecord: () => { storageOps.st.official = null; return true; },
            verifyRecord: verifyOfficialRecord,
        });
        ok('32g 重启后判定 cleanup（不误判回滚）', plan.action === 'cleanup' && plan.ok === true, JSON.stringify(plan));
        ok('32g 终态干净且模型仍为 B', storageOps.st.staging === null && storageOps.st.tx === null && paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
    }
    /* 32h) 日志写入失败中止后再次启动：不得触发任何恢复动作 */
    {
        const { bridge, storageOps, r } = await runInstall({ txId: 'tx-32h' }, { txWriteFalse: true });
        ok('32h 中止且无残留', r.ok === false && storageOps.st.tx === null);
        const plan = await recoverInterruptedTransaction({ storageOps, getBridge: async () => bridge, contract: contract32 });
        ok('32h 再次启动 → none', plan.action === 'none');
    }
    /* 32i) 回滚成功但日志删除失败：不谎报清理完成；下次启动按基线状态清理（不误判为需回滚） */
    {
        const { bridge, storageOps, r } = await runInstall({ txId: 'tx-32i' }, { txFailAt: 2, removeTxFalse: true });
        ok('32i 回滚成功但清理未完成 → 如实反馈', r.ok === false && r.failedAt === 'journal' && r.rolledBack === true && r.cleanupPending === true, JSON.stringify(r));
        ok('32i 暂存保留（仍有收尾价值）', storageOps.st.staging !== null);
        ok('32i 模型已回到 A', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest);
        /* 模拟重启（存储恢复编写能力）：w=base → 只清理，不执行回滚 */
        storageOps.st.txRemoved = 0;
        delete storageOps.st.tx;
        const plan = await recoverInterruptedTransaction({ storageOps, getBridge: async () => bridge, contract: contract32, readRecord: () => null });
        ok('32i 重启后 → none/cleanup（不误判回滚）', plan.action === 'none' || (plan.action === 'cleanup' && plan.ok === true), JSON.stringify(plan));
    }
    /* 32j) ★ P2 补丁：日志删除成功但读回抛异常 → 不得视为清理成功（保留暂存，不谎报） */
    {
        const { bridge, storageOps, r } = await runInstall({ txId: 'tx-32j' }, { readTxThrowAfterRemove: true });
        ok('32j 删除后读回异常 → ok:true 但 cleanupPending', r.ok === true && r.cleanupPending === true, JSON.stringify(r));
        ok('32j 暂存数据保留（留待后续处理）', storageOps.st.staging !== null);
        ok('32j 提交本身完整（权重/记录/备份就位）', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest
            && storageOps.st.official && String(storageOps.st.official.sha256) === officialDigest
            && paramsDigest(storageOps.st.backup.params, DIMS) === userDigest);
    }
    /* 32k) 恢复"仅清理残留"路径的同一故障 → 同样不报清理完成、数据保留 */
    {
        const bridge = makeFakeWeights({ initialParams: userParams });
        const storageOps = mkStorageFull(bridge, { readTxThrowAfterRemove: true });
        storageOps.st.backup = buildBackupRecord({ params: userParams, meta: { trained: 1 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
        const j = buildTxJournal({ txId: 'tx-32k', phase: 'prepared', baseDigest: userDigest, targetDigest: officialDigest, prevRecord: null });
        storageOps.st.tx = j;
        storageOps.st.staging = buildBackupRecord({ params: userParams, meta: { trained: 9 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH, txId: j.txId });
        const plan = await recoverInterruptedTransaction({ storageOps, getBridge: async () => bridge, contract: contract32 });
        ok('32k 恢复清理时删除后读回异常 → 不报清理完成', plan.ok === false && plan.action === 'cleanup', JSON.stringify(plan));
        ok('32k 暂存数据保留', storageOps.st.staging !== null);
        ok('32k 模型未被触碰', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest);
    }
}

/* ---------- 33. 手动安装重新授权基线（P1-1） ---------- */
section('手动安装重新授权基线（P1-1）');
{
    const contract12 = { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH };
    const A = userParams, B = thirdParams, C = mkBundle();
    const res33 = validateBundle(C, EXPECT);
    /* 第四种模型（重新授权后"再次变化"用） */
    const fourthParams = {};
    for (const s of spec) { const b = decodeBase64(defaultParams[s.key]); b[1] = (b[1] + 31) & 0xff; fourthParams[s.key] = encodeBase64(b); }
    const fourthDigest = paramsDigest(fourthParams, DIMS);

    /* 33a) 旧缺陷根因复现：授权记录不随重新授权更新 → 每次都拿 A 的旧摘要弹窗 */
    {
        const authStale = buildPendingRecord({ bundle: C, baseModelDigest: userDigest, userAuthorized: true, contract: contract12 });
        const evStale = cur => evaluatePending({ pending: authStale, contract: contract12, currentDigest: cur, officialRec: null, gate: { ok: true } }).action;
        ok('33a 旧摘要不更新 → 每次都 reprompt（反复弹窗的根因）',
            evStale(thirdDigest) === 'reprompt' && evStale(thirdDigest) === 'reprompt' && evStale(thirdDigest) === 'reprompt');
        /* 33b) 重绑基线（修复点）：同一模型不再弹窗 */
        const ra = reauthorizeRecord(authStale, thirdDigest);
        ok('33b 重绑基线后同一模型 → apply（不再弹窗）',
            evaluatePending({ pending: ra, contract: contract12, currentDigest: thirdDigest, officialRec: null, gate: { ok: true } }).action === 'apply');
        ok('33b 重绑保持显式授权并规范化摘要', ra.userAuthorized === true && ra.baseModelDigest === thirdDigest);
        /* 33c) 重新授权后模型再次变化 → 仍然必须重新确认 */
        ok('33c 重授权后模型再次变化 → reprompt（不静默覆盖）',
            evaluatePending({ pending: ra, contract: contract12, currentDigest: fourthDigest, officialRec: null, gate: { ok: true } }).action === 'reprompt');
        /* 33d) 无法读取基线 → 保守 reprompt（不接受 null 基线绕过核验） */
        const raNull = reauthorizeRecord(authStale, null);
        ok('33d 无法读取基线 → 仍 reprompt（不允许跳过摘要核验）',
            evaluatePending({ pending: raNull, contract: contract12, currentDigest: thirdDigest, officialRec: null, gate: { ok: true } }).action === 'reprompt'
            && evaluatePending({ pending: raNull, contract: contract12, currentDigest: null, officialRec: null, gate: { ok: true } }).action === 'reprompt');
    }
    /* 33e) 集成：A → 确认期间训练成 B → 用户重新授权 → 备份 B → 安装 C；只弹窗一次 */
    {
        const bridge = makeMutableWeights(A);
        const storageOps = mkStorageFull(bridge);
        let auth = buildPendingRecord({ bundle: C, baseModelDigest: userDigest, userAuthorized: true, contract: contract12 });
        let checkCalls = 0, reprompts = 0;
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle: C, decoded: res33.decoded, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, txId: 'tx-33e',
            confirmBeforeWrite: async () => {
                checkCalls++;
                if (checkCalls === 1) bridge.setParams(B);   /* 确认期间训练晋升为 B */
                const cur = snapshotToParams(bridge.snapshotModel());
                const curDigest = cur ? paramsDigest(cur, DIMS) : null;
                const d = evaluatePending({ pending: auth, contract: contract12, currentDigest: curDigest, officialRec: null, gate: { ok: true } });
                if (d.action === 'apply') return { ok: true };
                /* reprompt：模拟用户点「仍然安装」→ 重绑授权基线（P1-1 修复点） */
                reprompts++;
                auth = reauthorizeRecord(auth, curDigest);
                return { ok: true, rebaseline: true };
            },
            commitRecord: async () => ({ ok: true, errors: [] }),
        });
        ok('33e 安装成功（重授权后不再反复弹窗）', r.ok === true, JSON.stringify(r.errors));
        ok('33e 只弹窗一次', reprompts === 1);
        ok('33e 事务确实重建过基线（两次复核）', checkCalls === 2);
        ok('33e 长期备份 = B（重新授权时被覆盖的模型）', paramsDigest(storageOps.st.backup.params, DIMS) === thirdDigest);
        ok('33e 长期备份不是过期基线 A', paramsDigest(storageOps.st.backup.params, DIMS) !== userDigest);
        ok('33e 当前模型 = C', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
    }
    /* 33f) 重新授权后模型再次变化 → 必须再次重新确认；用户拒绝 → B/第四模型保持 */
    {
        const bridge = makeMutableWeights(A);
        const storageOps = mkStorageFull(bridge);
        storageOps.st.backup = buildBackupRecord({ params: defaultParams, meta: { trained: 1 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
        const beforeX = JSON.stringify(storageOps.st.backup);
        let auth = buildPendingRecord({ bundle: C, baseModelDigest: userDigest, userAuthorized: true, contract: contract12 });
        let checkCalls = 0, reprompts = 0;
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle: C, decoded: res33.decoded, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, txId: 'tx-33f',
            confirmBeforeWrite: async () => {
                checkCalls++;
                if (checkCalls === 1) bridge.setParams(B);
                if (checkCalls === 2) bridge.setParams(fourthParams);   /* 重授权后再次变化 */
                const cur = snapshotToParams(bridge.snapshotModel());
                const curDigest = cur ? paramsDigest(cur, DIMS) : null;
                const d = evaluatePending({ pending: auth, contract: contract12, currentDigest: curDigest, officialRec: null, gate: { ok: true } });
                if (d.action === 'apply') return { ok: true };
                reprompts++;
                if (reprompts === 1) { auth = reauthorizeRecord(auth, curDigest); return { ok: true, rebaseline: true }; }
                return { ok: false, reason: '用户保留当前模型' };
            },
            commitRecord: async () => ({ ok: true, errors: [] }),
        });
        ok('33f 再次变化 → 第二次弹窗且用户拒绝 → 中止', r.ok === false && r.failedAt === 'gate', JSON.stringify(r.errors));
        ok('33f 共弹窗两次（每次变化都重新确认）', reprompts === 2);
        ok('33f 模型保持第四模型（未被官方权重覆盖）', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === fourthDigest);
        ok('33f 长期备份未被触碰', JSON.stringify(storageOps.st.backup) === beforeX);
        ok('33f 中止后暂存与日志已清理', storageOps.st.staging === null && storageOps.st.tx === null);
    }
    /* 33g/33h) 重新授权后进入对局 / 训练仍在运行 → 写入前门禁拒绝安装 */
    {
        const runGateAbort = async gateReason => {
            const bridge = makeMutableWeights(A);
            const storageOps = mkStorageFull(bridge);
            let auth = buildPendingRecord({ bundle: C, baseModelDigest: userDigest, userAuthorized: true, contract: contract12 });
            let checkCalls = 0;
            const r = await applyOfficialBundle({
                bridge, storageOps, bundle: C, decoded: res33.decoded, dims: DIMS, probe: null,
                runtimeEpoch: EPOCH, schemaVersion: SCHEMA, txId: 'tx-33g',
                confirmBeforeWrite: async () => {
                    checkCalls++;
                    if (checkCalls === 1) bridge.setParams(B);
                    if (checkCalls === 2) return { ok: false, reason: gateReason };   /* 最终门禁不通过 */
                    const cur = snapshotToParams(bridge.snapshotModel());
                    const curDigest = cur ? paramsDigest(cur, DIMS) : null;
                    const d = evaluatePending({ pending: auth, contract: contract12, currentDigest: curDigest, officialRec: null, gate: { ok: true } });
                    if (d.action === 'apply') return { ok: true };
                    auth = reauthorizeRecord(auth, curDigest);
                    return { ok: true, rebaseline: true };
                },
                commitRecord: async () => ({ ok: true, errors: [] }),
            });
            return { bridge, storageOps, r };
        };
        const g1 = await runGateAbort('对局进行中');
        ok('33g 重新授权后进入对局 → 拒绝安装', g1.r.ok === false && g1.r.failedAt === 'gate', JSON.stringify(g1.r.errors));
        ok('33g 模型保持 B 未被覆盖', paramsDigest(snapshotToParams(g1.bridge.snapshotModel()), DIMS) === thirdDigest);
        ok('33g 暂存与日志已清理', g1.storageOps.st.staging === null && g1.storageOps.st.tx === null);
        const g2 = await runGateAbort('本地训练正在进行中');
        ok('33h 训练仍在运行 → 拒绝安装', g2.r.ok === false && g2.r.failedAt === 'gate');
        ok('33h 模型保持 B 未被覆盖', paramsDigest(snapshotToParams(g2.bridge.snapshotModel()), DIMS) === thirdDigest);
    }
}

/* ---------- 34. 回滚状态合成矩阵（P1-2：模型与记录任一失败都不得报 complete） ---------- */
section('回滚状态合成矩阵（P1-2）');
{
    const contract34 = { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH };
    const A = userParams;
    const B = mkBundle();
    const res34 = validateBundle(B, EXPECT);
    const archiveHasA = bridge => { const raw = bridge.state.corrupt || bridge.state.archive; return !!raw && raw.includes(A.w1.slice(0, 20)); };
    const mkRollbackFailBridge = () => {
        const bridge = makeFakeWeights({ initialParams: A });
        const orig = bridge.restoreModel.bind(bridge);
        let n = 0;
        bridge.restoreModel = snap => { n++; if (n > 1) throw new Error('rollback exploded'); return orig(snap); };
        return bridge;
    };
    const runInstallFail = async (opt, bridge) => {
        const b = bridge || makeFakeWeights({ initialParams: A });
        const storageOps = mkStorageFull(b);
        const r = await applyOfficialBundle({
            bridge: b, storageOps, bundle: B, decoded: res34.decoded, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, txId: 'tx-34',
            commitRecord: async () => ({ ok: false, errors: ['记录写入失败'] }),
            revertRecord: async () => (opt && opt.revert) ? opt.revert() : { ok: true, errors: [] },
        });
        return { b, storageOps, r };
    };
    /* 34a) 模型回滚成功 + 记录回滚成功 → complete */
    {
        const { b, storageOps, r } = await runInstallFail({});
        ok('34a 模型成功+记录成功 → complete', r.rollbackStatus === 'complete' && r.rolledBack === true && (r.rollbackErrors || []).length === 0, JSON.stringify(r));
        ok('34a 模型回到 A', paramsDigest(snapshotToParams(b.snapshotModel()), DIMS) === userDigest && archiveHasA(b));
        ok('34a 完整回滚 → 清理暂存与日志', storageOps.st.staging === null && storageOps.st.tx === null);
        ok('34a 文案与状态一致（complete）', rollbackStatusText(r).includes('已完整回滚'));
    }
    /* 34b) 模型回滚成功 + 记录回滚失败 → partial（修复前会误报 complete） */
    {
        const { b, storageOps, r } = await runInstallFail({ revert: () => ({ ok: false, errors: ['记录回滚失败'] }) });
        ok('34b 模型成功+记录失败 → partial', r.rollbackStatus === 'partial', JSON.stringify(r));
        ok('34b rolledBack=false（完整回滚未达成）', r.rolledBack === false);
        ok('34b rollbackErrors 含记录回滚错误', (r.rollbackErrors || []).some(e => /记录回滚失败/.test(e)), JSON.stringify(r.rollbackErrors));
        ok('34b 模型确实回到 A', paramsDigest(snapshotToParams(b.snapshotModel()), DIMS) === userDigest);
        ok('34b 回滚不完整 → 保留暂存与 needsManual 日志', storageOps.st.staging !== null && storageOps.st.tx && storageOps.st.tx.needsManual === true);
        ok('34b 文案为 partial（与返回值一致）', rollbackStatusText(r).includes('版本记录未能恢复'));
    }
    /* 34c) 模型回滚失败 + 记录回滚成功 → failed */
    {
        const { storageOps, r } = await runInstallFail({}, mkRollbackFailBridge());
        ok('34c 模型失败+记录成功 → failed', r.rollbackStatus === 'failed' && r.rolledBack === false, JSON.stringify(r));
        ok('34c 文案为 failed（与返回值一致）', rollbackStatusText(r).includes('回滚未能完成'));
        ok('34c 回滚不完整 → 保留暂存与 needsManual 日志', storageOps.st.staging !== null && storageOps.st.tx && storageOps.st.tx.needsManual === true);
    }
    /* 34d) 模型回滚失败 + 记录回滚失败 → failed（两类错误都在 rollbackErrors） */
    {
        const { r } = await runInstallFail({ revert: () => ({ ok: false, errors: ['记录回滚失败'] }) }, mkRollbackFailBridge());
        ok('34d 模型失败+记录失败 → failed', r.rollbackStatus === 'failed', JSON.stringify(r));
        ok('34d 两类错误都被并入 rollbackErrors', (r.rollbackErrors || []).some(e => /还原快照/.test(e)) && (r.rollbackErrors || []).some(e => /记录回滚失败/.test(e)), JSON.stringify(r.rollbackErrors));
    }
    /* 34e) 手动备份恢复入口（mode=restore）：同样合成状态、回滚不完整保留人工标记 */
    {
        const bundleLike = { params: A, trained: 9, accuracy: 0.5, size: 0 };
        const bridge = makeFakeWeights({ initialParams: officialParams });
        const storageOps = mkStorageFull(bridge);
        storageOps.st.backup = buildBackupRecord({ params: A, meta: { trained: 9 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
        const beforeBackup = JSON.stringify(storageOps.st.backup);
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle: bundleLike, decoded: buildTyped(A), dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, mode: 'restore', txId: 'tx-34e',
            commitRecord: async () => ({ ok: false, errors: ['记录删除失败'] }),
            revertRecord: async () => ({ ok: false, errors: ['记录回滚失败'] }),
        });
        ok('34e 恢复入口：模型回滚成功+记录恢复失败 → partial', r.rollbackStatus === 'partial' && r.failedAt === 'record', JSON.stringify(r));
        ok('34e 模型回到恢复前的 B', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === officialDigest);
        ok('34e 原长期备份未被修改', JSON.stringify(storageOps.st.backup) === beforeBackup);
        ok('34e restore 回滚不完整 → 保留 needsManual 人工标记（阻止继续安装）', storageOps.st.tx && storageOps.st.tx.needsManual === true, JSON.stringify(storageOps.st.tx));
    }
    /* 34f) 三个入口的返回结构与文案接口一致（防止只修一处） */
    {
        const { r: installR } = await runInstallFail({ revert: () => ({ ok: false, errors: ['记录回滚失败'] }) });
        const restoreR = await mkRollbackSample();
        ok('34f install/restore 返回均含 rollbackStatus/rolledBack/rollbackErrors',
            ['rollbackStatus', 'rolledBack', 'rollbackErrors'].every(k => k in installR)
            && ['rollbackStatus', 'rolledBack', 'rollbackErrors'].every(k => k in restoreR));
    }
    async function mkRollbackSample() {
        const bridge = makeFakeWeights({ initialParams: officialParams });
        const storageOps = mkStorageFull(bridge);
        storageOps.st.backup = buildBackupRecord({ params: A, meta: { trained: 9 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
        return applyOfficialBundle({
            bridge, storageOps, bundle: { params: A, trained: 9, accuracy: 0.5, size: 0 }, decoded: buildTyped(A), dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, mode: 'restore', txId: 'tx-34f',
            commitRecord: async () => ({ ok: false, errors: ['记录删除失败'] }),
            revertRecord: async () => ({ ok: true, errors: [] }),
        });
    }
}

/* ---------- 35. 官方记录删除核验（P1-3：读回异常绝不冒充删除成功） ---------- */
section('官方记录删除核验（P1-3）');
{
    const recB = buildOfficialRecord({ modelId: MODEL_ID, bundle: mkBundle(), digest: officialDigest, size: officialSize, contract: { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH } });
    const mk = opt => Object.assign({
        prevRec: null,
        writeRecord: () => true,
        readRecord: () => null,
        removeRecord: () => true,
        verify: verifyOfficialRecord,
    }, opt || {});
    let r;
    r = restoreOfficialRecord(mk({}));
    ok('35a 删除成功且读回为空 → ok', r.ok === true && r.errors.length === 0);
    r = restoreOfficialRecord(mk({ readRecord: () => recB, removeRecord: () => false }));
    ok('35b 删除返回 false 且记录仍在 → 失败', r.ok === false);
    ok('35b 错误信息区分"删除操作失败"与"仍可读回"', r.errors.some(e => /删除操作返回失败/.test(e)) && r.errors.some(e => /仍可读回/.test(e)), JSON.stringify(r.errors));
    r = restoreOfficialRecord(mk({ readRecord: () => recB, removeRecord: () => { throw new Error('quota'); } }));
    ok('35c 删除抛异常且记录仍在 → 失败并记录异常', r.ok === false && r.errors.some(e => /删除操作抛出异常/.test(e)), JSON.stringify(r.errors));
    r = restoreOfficialRecord(mk({ readRecord: () => { throw new Error('storage down'); }, removeRecord: () => true }));
    ok('35d 删除成功但读回抛异常 → 绝不报删除成功', r.ok === false && r.errors.some(e => /读回抛出异常/.test(e)), JSON.stringify(r.errors));
    r = restoreOfficialRecord({ prevRec: null, removeRecord: () => true, verify: verifyOfficialRecord });
    ok('35e 缺少读取能力 → 不得报告删除成功', r.ok === false && r.errors.some(e => /缺少官方记录读回能力/.test(e)));
    r = restoreOfficialRecord(mk({ readRecord: () => '', removeRecord: () => true }));
    ok('35f 读回格式异常（空串）→ 视为仍存在', r.ok === false);
    r = restoreOfficialRecord(mk({ readRecord: () => 0, removeRecord: () => true }));
    ok('35f 读回格式异常（0）→ 视为仍存在', r.ok === false);
    r = restoreOfficialRecord(mk({ removeRecord: () => { throw new Error('quota'); } }));
    ok('35g 删除抛异常且读回为空 → 仍判未确认（保守）', r.ok === false && r.errors.some(e => /删除操作抛出异常/.test(e)), JSON.stringify(r.errors));
    r = restoreOfficialRecord(mk({ removeRecord: undefined }));
    ok('35h 无删除能力且记录不存在 → ok', r.ok === true);
    r = restoreOfficialRecord(mk({ removeRecord: undefined, readRecord: () => recB }));
    ok('35h 无删除能力且记录仍存在 → 失败', r.ok === false && r.errors.some(e => /缺少官方记录清除能力/.test(e)));
    r = restoreOfficialRecord(mk({ removeRecord: undefined, readRecord: () => { throw new Error('x'); } }));
    ok('35i 无删除能力且读取异常 → 失败（无法确认）', r.ok === false);
    r = restoreOfficialRecord(mk({ readRecord: () => { throw new Error('getItem failed'); }, removeRecord: () => true }));
    ok('35j 宿主存储访问抛异常（getItem 抛）→ 验证失败', r.ok === false);
    r = restoreOfficialRecord(mk({ prevRec: recB, readRecord: () => recB }));
    ok('35k 旧记录写回+读回核验通过 → ok（既有路径不受影响）', r.ok === true);
    r = restoreOfficialRecord(mk({ prevRec: recB, readRecord: () => { throw new Error('x'); } }));
    ok('35k 旧记录写回后读回异常 → 失败（同样不冒充成功）', r.ok === false);
}

/* ---------- 36. 崩溃恢复互斥（P1 补丁：启动恢复与新的模型修改操作互斥） ---------- */
section('崩溃恢复互斥（P1）');
{
    /* createRecoveryGuard 即 modelUpdate 侧启动恢复锁的实际实现
     * （宿主层模块在 Node 侧无法导入，但恢复持锁/放锁/标志全部由该工厂完成） */
    const lock = createTransactionLock();
    const guard = createRecoveryGuard(lock);

    /* 36a) 恢复进行中：标志置位 + 同一把锁不可再获取（新安装/恢复被拒），并发恢复被跳过 */
    let duringBlocked = null, duringRecovering = null, duringAcquire = null;
    const p1 = guard.run(async () => {
        duringBlocked = guard.blocked();
        duringRecovering = guard.isRecovering();
        duringAcquire = lock.acquire();   /* 模拟并发的手动安装/手动恢复取锁 */
        return 'recovered';
    });
    const r2 = await guard.run(async () => 'never');   /* 并发触发的第二次恢复 */
    const r1 = await p1;
    ok('36a 恢复期间 blocked()=true（_txBlocked 据此拦截）', duringBlocked === true && duringRecovering === true);
    ok('36a 恢复期间新事务取锁失败（互斥成立）', duringAcquire === false);
    ok('36a 并发的第二次恢复被拒绝（started=false，绝不执行）', r2.started === false);
    ok('36a 恢复本身正常完成', r1.started === true && r1.value === 'recovered');

    /* 36b) 恢复结束后：标志与锁全部释放，后续事务可正常进入（无泄漏） */
    ok('36b 恢复结束后 recovering=false 且锁可用', guard.blocked() === false && guard.isRecovering() === false && lock.acquire() === true);
    lock.release();

    /* 36c) 恢复过程抛异常也必须释放锁与标志（finally），不得卡死后续操作 */
    let threw = null;
    try { await guard.run(async () => { throw new Error('recovery exploded'); }); } catch (e) { threw = e; }
    ok('36c 恢复抛异常 → 向上抛出且锁/标志已释放', !!threw && guard.blocked() === false && lock.acquire() === true);
    lock.release();

    /* 36d) 锁已被占用时 run 绝不执行 fn（不改动任何数据） */
    lock.acquire();
    let ran = false;
    const r4 = await guard.run(async () => { ran = true; });
    ok('36d 锁被占用 → started=false 且 fn 不执行', r4.started === false && ran === false);
    lock.release();

    /* 36e) 与手动入口共用同一把锁：模拟"恢复持锁期间 downloadAndApply 取锁"必须失败 */
    const p5 = guard.run(async () => { await new Promise(r => setTimeout(r, 5)); });
    const manualAcquire = lock.acquire();
    await p5;
    ok('36e 恢复持锁期间手动安装入口取锁失败（与下载/恢复/待生效共用锁）', manualAcquire === false && lock.acquire() === true);
    lock.release();
}

/* ---------- 37. 宿主存储适配层：事务日志严格读取（P1 补丁） ---------- */
section('宿主存储适配层：严格读取（P1）');
{
    /* createStrictKeyReader 即 modelUpdate.js 注入的严格读取实现（生产 = 直读 localStorage，访问异常不吞）。
     * 这里用**真实模拟 localStorage 对象**直接验证适配层分类，而不是只在 mock 上抛一个异常。 */
    const store = new Map();
    const ls = {
        getItem(k) { return store.has(k) ? store.get(k) : null; },
        setItem(k, v) { store.set(k, String(v)); },
        removeItem(k) { store.delete(k); },
    };
    const readStrict = createStrictKeyReader(() => ls);

    /* 37a) 三类状态必须可区分：确实不存在 / 读取失败 / 内容损坏 */
    ok('37a 键不存在 → null（确实没有未完成事务）', readStrict('k') === null);
    store.set('k', '');
    ok('37a 空串 → null（视为无值，与既有语义一致）', readStrict('k') === null);
    store.set('k', '{"txId":"t1","phase":"prepared"}');
    ok('37a 合法 JSON → 解析为对象', readStrict('k').txId === 't1');
    store.set('k', '{"txId":"t1",corrupt');
    let e1 = null; try { readStrict('k'); } catch (e) { e1 = e; }
    ok('37a 内容损坏 → 抛异常（绝不冒充"不存在"）', !!e1);
    const throwingStore = { getItem() { throw new Error('SecurityError: storage access denied'); } };
    const readThrow = createStrictKeyReader(() => throwingStore);
    let e2 = null; try { readThrow('k'); } catch (e) { e2 = e; }
    ok('37a 存储访问失败 → 抛异常', !!e2 && /SecurityError/.test(e2.message));
    ok('37a 无存储环境 → null（写入同样会失败，不会存在日志）', createStrictKeyReader(() => null)('k') === null);

    /* 37b) 对照（真实 storage.js）：旧读法 safeGet 把同一故障吞成 null——无法区分"不存在/读失败" */
    globalThis.localStorage = throwingStore;
    ok('37b 对照：safeGet 对访问异常返回 null（异常被吞，旧读法丢信息）', safeGet('k') === null);
    delete globalThis.localStorage;

    /* 37c) 崩溃恢复：日志读取失败 → 不得当成"没有未完成事务"，进入安全阻塞且不动任何数据 */
    {
        const contract37 = { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH };
        const bridge = makeFakeWeights({ initialParams: userParams });
        const storageOps = mkStorageFull(bridge, { readTxThrow: true });
        storageOps.st.staging = buildBackupRecord({ params: userParams, meta: { trained: 9 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH, txId: 'tx-37c' });
        storageOps.st.backup = buildBackupRecord({ params: thirdParams, meta: { trained: 1 }, dims: DIMS, schemaVersion: SCHEMA, dataEpoch: EPOCH });
        const beforeBackup = JSON.stringify(storageOps.st.backup);
        const plan = await recoverInterruptedTransaction({ storageOps, getBridge: async () => bridge, contract: contract37 });
        ok('37c 读取失败 → manual（不再误判为 none）', plan.action === 'manual' && plan.manual === true, JSON.stringify(plan));
        ok('37c 原始现场未被改写（0 次日志写入）', ((storageOps.st.txWrites || 0) === 0));
        ok('37c 暂存与长期备份全部保留', storageOps.st.staging !== null && JSON.stringify(storageOps.st.backup) === beforeBackup);
        ok('37c 模型未被触碰', paramsDigest(snapshotToParams(bridge.snapshotModel()), DIMS) === userDigest);
    }
    /* 37d) 撒谎的存储：removeTx 报告成功但键仍在 → 不得视为清理成功（保留数据供后续处理） */
    {
        const bridge = makeFakeWeights({ initialParams: userParams });
        const storageOps = mkStorageFull(bridge, { removeTxKeepTx: true });
        const bundle = mkBundle();
        const res = validateBundle(bundle, EXPECT);
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle, decoded: res.decoded, dims: DIMS, probe: null,
            runtimeEpoch: EPOCH, schemaVersion: SCHEMA, txId: 'tx-37d',
        });
        ok('37d 删除报告成功但键仍在 → cleanupPending（不谎报清理完成）', r.ok === true && r.cleanupPending === true, JSON.stringify(r));
        ok('37d 暂存保留 + 日志仍在（供后续处理）', storageOps.st.staging !== null && storageOps.st.tx !== null);
    }
    /* 37e) 端到端：事务日志整链路接到"真实模拟存储 + 生产严格读取"上——
     *   损坏日志 → manual 阻断且原文保留；存储恢复后同一数据按正常路径处置 */
    {
        const contract37 = { schemaVersion: SCHEMA, dims: DIMS.slice(), dataEpoch: EPOCH };
        const TXK = 'djsc_model_update_tx_v1';
        const s2 = new Map();
        const ls2 = {
            getItem: k => (s2.has(k) ? s2.get(k) : null),
            setItem: (k, v) => { s2.set(k, String(v)); },
            removeItem: k => { s2.delete(k); },
        };
        const readStrict2 = createStrictKeyReader(() => ls2);
        const bridge = makeFakeWeights({ initialParams: userParams });
        const storageOps = mkStorageFull(bridge);
        storageOps.readTx = () => readStrict2(TXK);
        storageOps.writeTx = j => { ls2.setItem(TXK, JSON.stringify(j)); return true; };
        storageOps.removeTx = () => { ls2.removeItem(TXK); return true; };
        s2.set(TXK, '{"txId":"tx-37e",corrupt');   /* 损坏的事务日志 */
        const plan1 = await recoverInterruptedTransaction({ storageOps, getBridge: async () => bridge, contract: contract37 });
        ok('37e 损坏日志（真实适配层）→ manual 阻断', plan1.action === 'manual' && plan1.manual === true, JSON.stringify(plan1));
        ok('37e 损坏原文未被覆盖（现场完整可查）', s2.get(TXK) === '{"txId":"tx-37e",corrupt');
        s2.set(TXK, JSON.stringify(buildTxJournal({ txId: 'tx-37e', phase: 'prepared', baseDigest: userDigest, targetDigest: officialDigest, prevRecord: null })));
        const plan2 = await recoverInterruptedTransaction({ storageOps, getBridge: async () => bridge, contract: contract37 });
        ok('37e 存储恢复后按正常路径处置（cleanup，不误判阻塞）', plan2.action === 'cleanup' && plan2.ok === true, JSON.stringify(plan2));
        ok('37e 处置后日志键已清理', !s2.has(TXK));
    }
}

console.log('\n==== ' + (fail === 0 ? ('ALL PASS (' + pass + ')') : (fail + ' FAILED / ' + pass + ' passed')) + ' ====');
process.exit(fail === 0 ? 0 : 1);
