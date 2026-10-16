#!/usr/bin/env node
/*
 * ============================================
 * // 作者：飞升原创
 * 交流群：1080487560
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 无名AI · 六项修复回归测试（零依赖，Node 侧） =================
 * 运行：node tools/test-regressions.mjs        （通过退出码 0 / 1）
 *
 * 覆盖（逐项对应，全部为行为断言，不是字符串匹配）：
 *   P1-a 模型权重落盘扫描：五态结论 + 读失败不得冒充 builtin-only + 元素数/字节数区分
 *   P1-b 配置迁移持久化：逐键落盘、标记最后写、只清止血期取值、重载中不写标记、重启不重跑
 *   P1-c 超大归档：启动不删除、只暂停 + 一次性提示、删除需确认、开关变更落盘
 *   P2-a 训练样本统计：本地/待传/累计已上传三个口径，禁止相加冒充总数
 *   P2-b 上传任务锁：退避/成功/失败/异常路径都必须释放锁，不得永久 busy
 *   P2-c shadow 日志：退出兜底刷盘、监听幂等、清空不被旧缓存写回、off 清理、配额退避
 *
 * 说明：本条测试通过 tools/noname-stub-loader.mjs 把宿主 noname.js 换成桩，
 *       从而**真实 import 生产模块**（含宿主层），不用另写理想化假实现。
 *       真机（安卓 WebView）上的下载/安装链路仍属「未验证」，需游戏内手动测试。
 */
import { register } from 'node:module';

/* ---------- 宿主环境（必须在 import 生产模块之前就绪） ---------- */
const LS = (() => {
    let store = new Map();
    let failSetItem = false;
    let setItemCalls = 0;
    return {
        getItem: k => (store.has(String(k)) ? store.get(String(k)) : null),
        setItem: (k, v) => { setItemCalls++; if (failSetItem) throw new Error('QuotaExceededError'); store.set(String(k), String(v)); },
        removeItem: k => { store.delete(String(k)); },
        clear: () => { store.clear(); },
        _raw: () => store,
        _setFail: f => { failSetItem = f; },
        _setItemCalls: () => setItemCalls,
        _resetCalls: () => { setItemCalls = 0; },
    };
})();
globalThis.localStorage = LS;
globalThis.document = {
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, click() {} }),
    body: { appendChild() {}, removeChild() {} },
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
};

const writes = [];   /* 记录宿主配置写入：{key, value}，语义与无名杀 saveConfig 一致 */
const stub = { lib: { config: {} }, game: {}, _status: {}, ui: {}, get: {}, ai: {} };
stub.game.saveConfig = (key, value) => {
    const mode = stub.game._saveConfigResult;
    /* 'ignored' = 本体在 _status.reloading 时提前 return：不改内存、不落盘 */
    if (mode === 'ignored') return undefined;
    if (typeof value === 'undefined') { delete stub.lib.config[key]; }
    else { stub.lib.config[key] = value; }
    writes.push({ key: key, value: value });
    return mode === 'reject' ? Promise.reject(new Error('putDB failed')) : Promise.resolve();
};
/* 默认：saveConfig 被受理（返回 Promise）。'reject' = 写入失败；'ignored' = 重载中提前返回（undefined） */
stub.game._saveConfigResult = 'ok';
stub.game.log = () => {};
globalThis.__NONAME_STUB = stub;

const listeners = new Map();
const win = {
    __DJSC: {},
    addEventListener: (t, fn) => { listeners.set(t, (listeners.get(t) || 0) + 1); },
    removeEventListener: (t) => { listeners.set(t, Math.max(0, (listeners.get(t) || 0) - 1)); },
    _listenerCount: t => listeners.get(t) || 0,
    _dispatch: t => { /* 触发已注册的退出监听（生产代码里是 pagehide/beforeunload 的同步刷盘） */ },
};
globalThis.window = win;

let confirmAnswer = false;
globalThis.confirm = () => confirmAnswer;
globalThis.alert = () => {};
globalThis.fetch = null;

register('./noname-stub-loader.mjs', import.meta.url);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ('  << ' + extra) : '')); }
};
const section = t => console.log('\n--- ' + t + ' ---');
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

/* ---------- 依赖（生产模块） ---------- */
const {
    classifyArchiveScan, buildOfficialRecord, OFFICIAL_RECORD_VERSION,
} = await import('../js/update/updateCore.js?v=41a');
const { paramSpec, paramsDigest, normalizeReleaseSeq } = await import('../js/update/weightBundle.js?v=41a');
const { DEFAULT_WEIGHTS } = await import('../score/model/weights/defaultWeights.js?v=41a');

const DIMS = [134, 128, 64, 6];
const SCHEMA = 7;
const EPOCH = 5;
const CONTRACT = { schemaVersion: SCHEMA, featureDim: DIMS[0], dims: DIMS.slice(), dataEpoch: EPOCH };
const BASE_PARAMS = {};
for (const s of paramSpec(DIMS)) BASE_PARAMS[s.key] = DEFAULT_WEIGHTS[s.key];
const BASE_DIGEST = paramsDigest(BASE_PARAMS, DIMS);

const mkArchiveObj = over => Object.assign({ v: SCHEMA, dv: EPOCH, trained: 0, accuracy: 0.5, ready: true }, BASE_PARAMS, over || {});
const mkArchive = over => JSON.stringify(mkArchiveObj(over));
const flip = (b64) => {
    const { decodeBase64, encodeBase64 } = b64c;
    const bytes = decodeBase64(b64);
    bytes[0] = (bytes[0] + 1) & 0xff;
    return encodeBase64(bytes);
};
const b64c = await import('../js/update/weightBundle.js?v=41a');

/* ============================================================
 * P1-a：模型权重落盘扫描
 * ============================================================ */
section('P1-a 落盘扫描五态');
{
    const builtin = classifyArchiveScan({ raw: null, contract: CONTRACT, officialRec: null });
    ok('无存档无记录 → builtin-only', builtin.verdict === 'builtin-only' && builtin.ok === true, builtin.verdict + '/' + builtin.ok);

    const rec = { modelId: 'main-actor-critic', modelVersion: 'mv-x', releaseSeq: 7, sha256: BASE_DIGEST, size: 51534 };
    const intact = classifyArchiveScan({ raw: mkArchive(), contract: CONTRACT, officialRec: rec });
    ok('官方权重完整落地 → official-intact', intact.verdict === 'official-intact' && intact.digestMatch === true, intact.verdict + '/' + intact.digestMatch);
    ok('official-intact 暴露官方 sha256（不是 digest）', intact.official && intact.official.sha256 === BASE_DIGEST, JSON.stringify(intact.official));
    ok('official-intact 逐参数 10 项齐全', intact.checks.length === 10 && intact.paramsOk === true, intact.checks.length + '/' + intact.paramsOk);

    const i16 = intact.checks.find(r => r.kind === 'int16');
    const i8 = intact.checks.find(r => r.kind === 'int8');
    ok('区分元素数与实际字节数（int16 字节 = 元素×2）', !!i16 && i16.expectBytes === i16.elements * 2 && !!i8 && i8.expectBytes === i8.elements, JSON.stringify(i16) + ' | ' + JSON.stringify(i8));

    const mism = classifyArchiveScan({ raw: mkArchive({ w2: flip(BASE_PARAMS.w2), trained: 120 }), contract: CONTRACT, officialRec: rec, hasTrainingEvidence: true, defaultDigest: paramsDigest(DEFAULT_WEIGHTS, DIMS) });
    ok('本地训练成果覆盖 → archive-mismatch', mism.verdict === 'archive-mismatch' && mism.digestMatch === false && mism.paramsOk === true, mism.verdict + '/' + mism.digestMatch);

    const noRec = classifyArchiveScan({ raw: mkArchive(), contract: CONTRACT, officialRec: null });
    ok('无官方记录但参数完整 → params-ok-no-record', noRec.verdict === 'params-ok-no-record' && noRec.paramsOk === true, noRec.verdict);

    /* damaged 家族 */
    const badLen = classifyArchiveScan({ raw: mkArchive({ b3: BASE_PARAMS.b3.slice(0, 8) }), contract: CONTRACT, officialRec: null });
    ok('参数长度不符 → damaged', badLen.verdict === 'damaged' && badLen.paramsOk === false, badLen.verdict + '/' + badLen.paramsOk);
    const b3row = badLen.checks.find(r => r.key === 'b3');
    ok('长度不符明细可定位（b3：字节数≠元素×2）', !!b3row && b3row.present === true && b3row.bytesOk === false && b3row.expectBytes === b3row.elements * 2, JSON.stringify(b3row));

    const badJson = classifyArchiveScan({ raw: '{not-json', contract: CONTRACT, officialRec: null });
    ok('存档无法解析 → damaged', badJson.verdict === 'damaged', badJson.verdict);

    const oldSchema = classifyArchiveScan({ raw: mkArchive({ v: SCHEMA + 1 }), contract: CONTRACT, officialRec: null });
    ok('网络结构版本不符 → damaged', oldSchema.verdict === 'damaged', oldSchema.verdict);

    const oldEpoch = classifyArchiveScan({ raw: mkArchive({ dv: EPOCH - 1 }), contract: CONTRACT, officialRec: null });
    ok('旧存档（数据纪元过旧）→ damaged', oldEpoch.verdict === 'damaged', oldEpoch.verdict);

    const recNoArchive = classifyArchiveScan({ raw: null, contract: CONTRACT, officialRec: rec });
    ok('有官方记录但存档缺失 → damaged', recNoArchive.verdict === 'damaged', recNoArchive.verdict);

    const legacyDigestField = classifyArchiveScan({ raw: mkArchive(), contract: CONTRACT, officialRec: { modelId: 'main-actor-critic', modelVersion: 'mv', releaseSeq: 3, digest: BASE_DIGEST } });
    ok('只认官方记录 sha256（旧 digest 字段不能冒充一致）', legacyDigestField.verdict === 'archive-mismatch' && legacyDigestField.digestMatch !== true && (legacyDigestField.official || {}).sha256 === null, legacyDigestField.verdict + '|' + legacyDigestField.digestMatch);

    const readFail = classifyArchiveScan({ raw: null, contract: CONTRACT, officialRec: null, readError: new Error('storage boom') });
    ok('读取失败 → ok=false 且不得冒充 builtin-only', readFail.ok === false && readFail.verdict === null && /读取权重存档失败/.test(readFail.errors[0] || ''), readFail.verdict + '|' + JSON.stringify(readFail.errors));

    const noContract = classifyArchiveScan({ raw: mkArchive(), contract: null, officialRec: rec });
    ok('契约不可用 → ok=false 且不得冒充任一结论', noContract.ok === false && noContract.verdict === null, noContract.verdict);
}

section('P1-a 宿主层 scanWeightsOnDisk（真实 import 生产模块）');
{
    const mod = await import('../js/update/modelUpdate.js?v=41a');
    const OFFICIAL_KEY = 'djsc_official_weights_v1';
    const WEIGHTS_ARCHIVE_KEY = 'djsc_weights_v3';

    const setModule = (readArchive) => {
        win.__DJSC = { __weightsModule: {
            MODEL_SCHEMA: { version: SCHEMA, featureDim: DIMS[0], dims: DIMS.slice(), dtype: { weights: 'int8', biases: 'int16' }, architecture: { activation: 'gelu', norm: 'layernorm', residual: true, critic: true } },
            DATA_EPOCH: EPOCH,
            __readArchive: readArchive,
        } };
    };
    const clearKeys = () => { LS.removeItem(OFFICIAL_KEY); LS.removeItem(WEIGHTS_ARCHIVE_KEY); };
    const officialRecJson = JSON.stringify({ version: OFFICIAL_RECORD_VERSION, modelId: 'main-actor-critic', modelVersion: 'mv-x', releaseSeq: normalizeReleaseSeq(7), schemaVersion: SCHEMA, dataEpoch: EPOCH, sha256: BASE_DIGEST, size: 51534, appliedAt: Date.now() });

    /* ① 已安装官方权重 */
    clearKeys();
    LS.setItem(OFFICIAL_KEY, officialRecJson);
    setModule(() => mkArchive());
    let r = await mod.scanWeightsOnDisk();
    ok('已安装官方权重 → official-intact', r.verdict === 'official-intact' && r.ok === true && r.digestMatch === true, JSON.stringify(r.verdict) + '|' + JSON.stringify(r.errors));

    /* ② 摘要不匹配（本地训练覆盖） */
    setModule(() => mkArchive({ w3: flip(BASE_PARAMS.w3), trained: 300 }));
    r = await mod.scanWeightsOnDisk();
    ok('摘要不匹配 → archive-mismatch', r.verdict === 'archive-mismatch' && r.digestMatch === false, JSON.stringify(r.verdict));

    /* ③ 存档损坏（参数截断） */
    setModule(() => mkArchive({ pr1: '' }));
    r = await mod.scanWeightsOnDisk();
    ok('存档损坏 → damaged', r.verdict === 'damaged' && r.paramsOk === false, JSON.stringify(r.verdict) + '|' + r.paramsOk);

    /* ④ 无官方记录 */
    clearKeys();
    setModule(() => mkArchive());
    r = await mod.scanWeightsOnDisk();
    ok('无官方记录 → params-ok-no-record', r.verdict === 'params-ok-no-record', JSON.stringify(r.verdict));

    /* ⑤ 旧存档（数据纪元过旧） */
    setModule(() => mkArchive({ dv: EPOCH - 2 }));
    r = await mod.scanWeightsOnDisk();
    ok('旧存档 → damaged', r.verdict === 'damaged', JSON.stringify(r.verdict));

    /* ⑥ 存储读取抛错：这是本次修复的核心缺陷（旧实现会报 builtin-only + ok:true） */
    setModule(() => { throw new Error('storage boom'); });
    r = await mod.scanWeightsOnDisk();
    ok('存储读取抛错 → ok=false / verdict=null（不得冒充 builtin-only）', r.ok === false && r.verdict === null, JSON.stringify(r.verdict) + '|' + JSON.stringify(r.errors));
    ok('读取失败错误信息可信', Array.isArray(r.errors) && r.errors.length > 0 && /读取权重存档失败/.test(r.errors[0]), JSON.stringify(r.errors));

    /* ⑦ 全新安装（无存档无记录）→ builtin-only 且 ok=true */
    setModule(() => null);
    r = await mod.scanWeightsOnDisk();
    ok('全新安装 → builtin-only（真·无存档才允许）', r.verdict === 'builtin-only' && r.ok === true && (r.errors || []).length === 0, JSON.stringify(r.verdict) + '|' + JSON.stringify(r.errors));
}

/* ============================================================
 * P2-c：shadow 日志防抖写盘
 * ============================================================ */
section('P2-c shadow 日志刷盘');
{
    const shadow = await import('../shadow/shadowCore.js?v=41a');
    const T = shadow.__shadowLogTest();
    const KEY = '__ai_reason_shadow_v5';
    const OFF_KEY = '__ai_reason_shadow_off';

    /* 退出兜底：注册幂等 + 脏数据同步落盘 */
    LS.removeItem(KEY);
    shadow.ensureExitFlush();
    shadow.ensureExitFlush();
    shadow.ensureExitFlush();
    ok('退出兜底监听幂等（pagehide/beforeunload 各一次）', win._listenerCount('pagehide') === 1 && win._listenerCount('beforeunload') === 1, win._listenerCount('pagehide') + '/' + win._listenerCount('beforeunload'));

    shadow.shadowCmd('stats');                       /* 让内存缓存从存储加载 */
    T.push({ decisionId: 'd1', reward: 1 });
    const beforeExit = LS.getItem(KEY);
    shadow.flushShadowLog(true);                     /* 等价于 pagehide 触发的同步刷盘 */
    const afterExit = LS.getItem(KEY);
    ok('退出时同步写掉未落盘记录（不再丢 5s 窗口数据）', beforeExit !== afterExit && /d1/.test(afterExit || ''), String(afterExit).slice(0, 60));

    /* 清空后不得被旧缓存写回 */
    shadow.shadowCmd('clear');
    ok('clear 同步清内存缓存', T.state().hasMem === true && T.state().memLen === 0, JSON.stringify(T.state()));
    shadow.flushShadowLog(true);
    ok('清空后强制刷盘不得写回旧日志', LS.getItem(KEY) === null, String(LS.getItem(KEY)).slice(0, 60));

    /* 配额退避：不得每 5s 无限重试 */
    LS.setItem(KEY, JSON.stringify([{ decisionId: 'seed' }]));
    shadow.shadowCmd('stats');
    T.push({ decisionId: 'd2' });
    T.setBackoffMs(60000);
    LS._setFail(true);
    LS._resetCalls();
    shadow.flushShadowLog(true);
    const st1 = T.state();
    const attemptsAfterFirst = LS._setItemCalls();
    shadow.flushShadowLog(false);
    shadow.flushShadowLog(false);
    ok('写盘失败进入退避（不抛异常、数据仍在内存）', st1.backoffUntil > Date.now() && st1.dirty === true, JSON.stringify(st1));
    ok('退避期内普通刷盘不再重复写（无高频重试）', LS._setItemCalls() === attemptsAfterFirst, LS._setItemCalls() + ' vs ' + attemptsAfterFirst);
    LS._setFail(false);
    T.clearBackoff();
    shadow.flushShadowLog(false);
    ok('存储恢复后（退避解除）写盘成功', LS.getItem(KEY) !== null && T.state().dirty === false, JSON.stringify(T.state()));

    /* off：清理计时器/缓存/监听，且不再有任何写盘路径 */
    LS.removeItem(KEY);
    shadow.shadowCmd('stats');
    T.push({ decisionId: 'd3' });
    shadow.shadowCmd('off');
    const offState = T.state();
    ok('off 清理：无缓存、无脏标记、退出监听已移除', offState.hasMem === false && offState.dirty === false && offState.hooked === false, JSON.stringify(offState));
    LS.removeItem(KEY);
    shadow.flushShadowLog(true);
    ok('off 之后任何刷盘都不再写回', LS.getItem(KEY) === null, String(LS.getItem(KEY)));
    ok('off 已持久化关闭标记', LS.getItem(OFF_KEY) === '1', String(LS.getItem(OFF_KEY)));
}

/* ============================================================
 * P2-a：训练样本统计口径
 * ============================================================ */
section('P2-a 样本统计三口径');
{
    const ep = await import('../score/foundation/runtime/extensionPoints.js?v=41a');
    win.__DJSC = win.__DJSC || {};
    win.__DJSC.trainBufferSize = () => 120;             /* 本地保存样本数（含已上传） */
    win.__DJSC.cloudFeedback = { status: () => ({ pendingSamples: 30, bufferTotal: 120, uploadedTotal: 80 }) };

    const impl = ep.getImpl(ep.POINTS.METRIC, 'sampleCount');
    const value = impl();
    ok('指标不再相加（120+80=200 属重复计数）', value === 120, String(value));
    const row = ep.list(ep.POINTS.METRIC).find(r => r.id === 'sampleCount');
    ok('指标名不再声称"待传+已传"总数', !!row && /本地/.test(row.meta.label) && !/待传\+已传/.test(row.meta.label), row && row.meta && row.meta.label);

    /* 上传成功后本地样本保留 → 本地数已包含已上传数，接口必须分别给出三个口径 */
    const ci = await import('../score/foundation/cloud/cloudIngest.js?v=41a');
    LS.setItem('djsc_ingest_last', JSON.stringify({ watermark: 0, keyFp: {}, lastOk: Date.now(), lastErr: '', backoffUntil: 0, uploadedTotal: 80 }));
    const st = ci.status();
    const sc = st.sampleCounts;
    ok('status 暴露三个独立口径', !!sc && sc.localSaved === st.bufferTotal && sc.pending === st.pendingSamples && sc.uploaded === st.uploadedTotal && sc.uploaded === 80, JSON.stringify(sc));
    ok('不再存在"合计=本地+已传"的字段', !('totalSamples' in st) && !('dedupedTotal' in st), Object.keys(st).join(','));
}

/* ============================================================
 * P2-b：上传任务锁
 * ============================================================ */
section('P2-b 上传任务锁');
{
    const ci = await import('../score/foundation/cloud/cloudIngest.js?v=41a');
    const KEY = 'djsc_ingest_last';
    const setCursor = o => LS.setItem(KEY, JSON.stringify(Object.assign({ watermark: 0, keyFp: {}, lastOk: 0, lastErr: '', backoffUntil: 0 }, o || {})));
    const okFetch = () => Promise.resolve({ ok: true, status: 200 });
    const http500 = () => Promise.resolve({ ok: false, status: 500 });
    const rate429 = () => Promise.resolve({ ok: false, status: 429 });

    /* ① 退避：连续两次都必须返回 backoff，绝不出现永久 busy */
    setCursor({ backoffUntil: Date.now() + 10 * 60 * 1000 });
    const b1 = await ci.uploadNow(false);
    const b2 = await ci.uploadNow(false);
    const b3 = await ci.uploadNow(false);
    ok('退避期内上传返回 backoff', b1.skipped === 'backoff', JSON.stringify(b1));
    ok('退避重复调用不泄漏任务锁（回归：旧实现第二次即 busy）', b2.skipped === 'backoff' && b3.skipped === 'backoff', JSON.stringify([b2, b3]));

    /* ② 成功路径 */
    globalThis.fetch = okFetch;
    setCursor({ watermark: 0 });
    const samples = ci.loadCursor && (await import('../score/model/train/trainExport.js?v=41a')).getSamples();
    samples.push({ ts: Date.now(), id: 'a' }, { ts: Date.now(), id: 'b' });
    const s1 = await ci.uploadNow(true);
    ok('成功路径：上传后锁已释放', s1.ok === true && s1.sentSamples === 2, JSON.stringify(s1));
    const s2 = await ci.uploadNow(false);
    ok('成功后再次上传不是 busy', s2.skipped !== 'busy', JSON.stringify(s2));

    /* ③ 失败路径（HTTP 500） */
    globalThis.fetch = http500;
    setCursor({ watermark: 0 });
    const f1 = await ci.uploadNow(true);
    const f2 = await ci.uploadNow(true);
    ok('失败路径：返回错误且锁已释放', f1.ok === false && f2.skipped !== 'busy', JSON.stringify([f1, f2]));

    /* ④ 限流 429 → 退避；退避期内自动上传回到 backoff（且不能是 busy） */
    globalThis.fetch = rate429;
    setCursor({ watermark: 0 });
    const r1 = await ci.uploadNow(true);
    const r2 = await ci.uploadNow(false);
    const r3 = await ci.uploadNow(false);
    ok('429 后自动上传进入退避', r1.ok === false && r2.skipped === 'backoff' && r3.skipped === 'backoff', JSON.stringify([r1.skipped, r2.skipped, r3.skipped]));

    /* ⑤ 异常路径（fetch 同步抛错） */
    globalThis.fetch = () => { throw new Error('boom'); };
    setCursor({ watermark: 0 });
    const e1 = await ci.uploadNow(true);
    const e2 = await ci.uploadNow(true);
    ok('异常路径：锁释放且可再次上传', e1.ok === false && /boom/.test(e1.error || '') && e2.skipped !== 'busy', JSON.stringify([e1, e2]));

    /* ⑥ 关闭自动上传时 force=false 必须跳过（原有语义不变） */
    stub.lib.config['extension_无名AI_cloudAutoUpload'] = false;
    const d1 = await ci.uploadNow(false);
    ok('未开启自动上传时跳过（语义未变）', d1.skipped === 'disabled', JSON.stringify(d1));
    stub.lib.config['extension_无名AI_cloudAutoUpload'] = true;
    const d2 = await ci.uploadNow(false);
    ok('开启后自动上传可继续（锁未卡死）', d2.skipped !== 'disabled' && d2.skipped !== 'busy', JSON.stringify(d2));
}

/* ============================================================
 * P1-b / P1-c：配置迁移持久化 + 超大归档非破坏性
 * ============================================================ */
section('P1-b 配置迁移持久化');
{
    const MIG = 'extension_无名AI_cfgMigratedVer';
    const run = async (cfg, query, saveResult) => {
        stub.lib.config = Object.assign({}, cfg);
        stub.game._saveConfigResult = saveResult || 'ok';
        writes.length = 0;
        await import('../js/config/config.js?' + query);
        await tick();
        return writes.slice();
    };

    /* ① 首次升级：逐键落盘，标记最后写 */
    const w1 = await run({ 'extension_无名AI_useTrainedModel': false, 'extension_决策积分引擎_championBoost': '3', 'extension_无名AI_archiveGames': true }, 'mig1');
    const delIdx = w1.map(w => w.key);
    ok('逐键调用本体 saveConfig 落盘（不再是空参调用）', delIdx.indexOf('extension_无名AI_useTrainedModel') >= 0 && delIdx.indexOf('extension_决策积分引擎_championBoost') >= 0, JSON.stringify(w1));
    ok('止血期取值被删除（value=undefined 即本体删键语义）', w1.filter(w => w.value === undefined).length === 2, JSON.stringify(w1));
    ok('useTrainedModel 删除后不再残留（默认开启生效）', stub.lib.config['extension_无名AI_useTrainedModel'] === undefined, String(stub.lib.config['extension_无名AI_useTrainedModel']));
    const marker = w1.find(w => w.key === MIG);
    ok('迁移标记落盘且值为 471', !!marker && marker.value === '471', JSON.stringify(marker));
    ok('迁移标记在删除动作之后写入', w1.indexOf(marker) === w1.length - 1, JSON.stringify(w1.map(w => w.key)));

    /* ② 重启（标记已存在）→ 不重跑、不再重置玩家设置 */
    const w2 = await run({ 'extension_无名AI_useTrainedModel': true, [MIG]: '471' }, 'mig2');
    ok('已完成迁移不重跑（玩家后续手动选择不被覆盖）', w2.length === 0, JSON.stringify(w2));

    /* ③ 玩家主动保存的非止血期取值一律保留 */
    const w3 = await run({ 'extension_无名AI_useTrainedModel': true, 'extension_无名AI_championBoost': '5' }, 'mig3');
    ok('非止血期取值不被误删', stub.lib.config['extension_无名AI_useTrainedModel'] === true && stub.lib.config['extension_无名AI_championBoost'] === '5', JSON.stringify(stub.lib.config));
    ok('无键可删时仍记录迁移完成', w3.length === 1 && w3[0].key === MIG, JSON.stringify(w3));

    /* ④ 写入被拒（存储失败）→ 不写标记、下次重试 */
    const w4 = await run({ 'extension_无名AI_useTrainedModel': false }, 'mig4', 'reject');
    ok('写入失败不谎报迁移完成（标记不落盘也不留内存）', w4.filter(w => w.key === MIG).length === 0 && stub.lib.config[MIG] === undefined, JSON.stringify({ writes: w4.map(w => w.key), marker: stub.lib.config[MIG] }));

    /* ⑤ 重载中（saveConfig 提前返回 undefined）→ 同样不写标记 */
    const w5 = await run({ 'extension_无名AI_useTrainedModel': false }, 'mig5', 'ignored');
    ok('重载中（写入未受理）不写标记', stub.lib.config[MIG] === undefined && w5.length === 0, JSON.stringify({ writes: w5, marker: stub.lib.config[MIG] }));
}

section('P1-c 超大归档不删除');
{
    const ARCH = '无名AI_archive';
    const NOTICE = 'extension_无名AI_archiveNoticeVer';
    const big = 'x'.repeat(1048576 + 10);

    /* ① 超阈值：暂停 + 提示一次，绝不删除 */
    stub.lib.config = { 'extension_无名AI_archiveGames': true, 'extension_无名AI_cfgMigratedVer': '471' };
    stub.game._saveConfigResult = 'ok';
    writes.length = 0;
    LS.setItem(ARCH, big);
    confirmAnswer = false;
    await import('../js/config/config.js?arch1');
    await tick(60);
    ok('启动不再删除历史归档', LS.getItem(ARCH) === big, 'len=' + String(LS.getItem(ARCH)).length);
    ok('归档开关暂停并落盘', stub.lib.config['extension_无名AI_archiveGames'] === false && writes.some(w => w.key === 'extension_无名AI_archiveGames' && w.value === false), JSON.stringify(writes));
    ok('提示标记落盘（防重复弹窗）', stub.lib.config[NOTICE] === '1' && writes.some(w => w.key === NOTICE), JSON.stringify(stub.lib.config));
    ok('玩家未确认时不删除归档', LS.getItem(ARCH) === big, 'len=' + String(LS.getItem(ARCH)).length);

    /* ② 再次启动（开关已关 + 已提示）→ 不再写入、不再打扰 */
    writes.length = 0;
    stub.lib.config = { 'extension_无名AI_archiveGames': false, [NOTICE]: '1', 'extension_无名AI_cfgMigratedVer': '471' };
    await import('../js/config/config.js?arch2');
    await tick(60);
    ok('重启不重复提示/不重复改写开关', writes.length === 0, JSON.stringify(writes));
    ok('归档仍在（可继续查看/导出）', LS.getItem(ARCH) === big, 'len=' + String(LS.getItem(ARCH)).length);

    /* ③ 玩家在提示里明确确认后才允许删除 */
    stub.lib.config = { 'extension_无名AI_archiveGames': true, 'extension_无名AI_cfgMigratedVer': '471' };
    writes.length = 0;
    LS.setItem(ARCH, big);
    confirmAnswer = true;
    await import('../js/config/config.js?arch3');
    await tick(60);
    ok('明确确认后清空归档（删除必须经玩家授权）', LS.getItem(ARCH) === null, 'len=' + String(LS.getItem(ARCH)).length);

    /* ④ 设置菜单入口存在（手动清理 + 已有导出入口） */
    const cfgMod = await import('../js/config/config.js?arch4');
    const items = cfgMod.config || {};
    ok('设置菜单提供「清空战报归档」入口', typeof items.clearArchive === 'object' && typeof items.clearArchive.onclick === 'function', typeof items.clearArchive);
    ok('归档开关/查看/导出入口保持', typeof items.archiveGames === 'object' && typeof items.openArchivePanel === 'object' && typeof items.exportGameFeedback === 'object', [typeof items.archiveGames, typeof items.openArchivePanel, typeof items.exportGameFeedback].join(','));
    LS.setItem(ARCH, big);
    confirmAnswer = false;
    const cleared = items.clearArchive.onclick.call({});
    ok('菜单入口同样需要确认（取消则不动数据）', cleared === false && LS.getItem(ARCH) === big, String(LS.getItem(ARCH)).length);
    OK_MARK: ok('设置菜单入口：确认后清空', (() => { confirmAnswer = true; items.clearArchive.onclick.call({}); const gone = LS.getItem(ARCH) === null; LS.removeItem(ARCH); return gone; })());
}

console.log('\n================ 结果 ================');
console.log('PASS ' + pass + '  FAIL ' + fail);
process.exit(fail ? 1 : 0);
