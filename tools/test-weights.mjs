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
import { applyOfficialBundle, detectUserModel, snapshotToParams, buildAppliedSnapshot } from '../js/update/applyWeights.js';
import {
    buildBackupRecord, verifyBackupRecord, verifyRestoreSource, buildPendingRecord, evaluatePending,
    BACKUP_KIND_PARAMS, BACKUP_RECORD_VERSION, PENDING_RECORD_VERSION,
} from '../js/update/updateCore.js';
import { DEFAULT_WEIGHTS } from '../score/model/weights/defaultWeights.js';

const DIMS = [134, 128, 64, 6];
const SCHEMA = 7;
const EPOCH = 5;
const EXPECT = { schemaVersion: SCHEMA, featureDim: DIMS[0], dims: DIMS.slice(), dataEpoch: EPOCH };

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
const mkBundle = mut => {
    const b = {
        format: BUNDLE_FORMAT, modelId: MODEL_ID, modelVersion: 'w7d5-t01', releaseSeq: 1,
        schemaVersion: SCHEMA, featureDim: DIMS[0], dims: DIMS.slice(), dataEpoch: EPOCH,
        dtype: { weights: 'int8', biases: 'int16' }, params: { ...officialParams },
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
    writeBackup(rec) { this.backup = rec; return true; },
    readBackup() { return this.backup; },
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
    const badStorage = { readArchive: () => null, writeBackup: () => false, readBackup: () => null };
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

/* ---------- 10. 备份安全（P0-1） ---------- */
section('备份安全（P0-1）');
/* 全功能假存储：可注入写入失败 / 读回失败 / 写入后损坏 */
const mkStorageFull = (bridge, opt) => {
    opt = opt || {};
    const st = { backup: null, writes: 0, reads: 0 };
    return {
        st,
        readArchive() { return opt.archiveNull ? null : (bridge.state.corrupt || bridge.state.archive); },
        writeBackup(rec) {
            st.writes++;
            if (opt.writeThrow) throw new Error('QuotaExceededError');
            if (opt.writeFalse) return false;
            st.backup = JSON.parse(JSON.stringify(rec));
            if (opt.corruptBackup) { const b = decodeBase64(st.backup.params.w1); b[0] = (b[0] + 1) & 0xff; st.backup.params.w1 = encodeBase64(b); }
            return true;
        },
        readBackup() { st.reads++; if (opt.readBackupNull) return null; return st.backup; },
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
/* 10e) 安装成功后：备份内容 = 更新前模型 */
{
    const bridge = makeFakeWeights({ initialParams: defaultParams });
    const storageOps = mkStorageFull(bridge);
    const bundle = mkBundle(); const res = validateBundle(bundle, EXPECT);
    const r = await applyOfficialBundle({ bridge, storageOps, bundle, decoded: res.decoded, dims: DIMS, probe: null, runtimeEpoch: EPOCH, schemaVersion: SCHEMA });
    ok('安装成功', r.ok === true, JSON.stringify(r.errors));
    ok('返回 backupWritten=true', r.backupWritten === true);
    ok('备份内容 = 更新前模型', paramsDigest(storageOps.st.backup.params, DIMS) === paramsDigest(defaultParams, DIMS));
    ok('备份摘要字段与内容一致', storageOps.st.backup.digest === paramsDigest(defaultParams, DIMS));
    ok('备份保存了原模型元数据', storageOps.st.backup.meta && storageOps.st.backup.meta.trained === 111);
}

/* ---------- 11. 恢复事务（P0-2） ---------- */
section('恢复事务（P0-2）');
const userParams = {};
for (const s of spec) { const b = decodeBase64(defaultParams[s.key]); b[7] = (b[7] + 9) & 0xff; userParams[s.key] = encodeBase64(b); }
const userDigest = paramsDigest(userParams, DIMS);
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

console.log('\n==== ' + (fail === 0 ? ('ALL PASS (' + pass + ')') : (fail + ' FAILED / ' + pass + ' passed')) + ' ====');
process.exit(fail === 0 ? 0 : 1);
