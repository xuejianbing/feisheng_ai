/*
 * ============================================
 * // 作者：飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 发布门禁：模型链路契约自动化测试 =================
 * 对应《无名AI3.1α 深度系统审查报告》§10：
 *   10.1 Int8 权重 / Int16 偏置 save→load 位级 round-trip（P0-04 回归）
 *   10.2 内置默认权重 fail-closed 契约（P0-03）
 *   10.3 reset 失败不得随机化/落盘，必须原样保留当前权重
 *   10.4 forward / forwardWithValue / forwardFastWithValue 三路径一致（残差 on/off）
 *   10.5 反向传播梯度：逐层有限差分核验 + 首步更新方向 + 训练降损冒烟（P1-17 回归）
 *   10.6 候选训练不得污染 stable；discard 后 active 回到 stable（P0-05/P0-06、P1-16）
 *   10.7 热更快照覆盖全部网络参数 + 全部优化器状态；结构护栏拒绝异形快照（P1-13/P1-14/P1-15）
 *   10.8 训练数据导入：仅 130 维有限数可入 BUFFER（P1-19）
 *   10.9 插件生命周期：注册/安装分离、依赖拓扑安装、缺依赖禁用、依赖恢复自恢复、
 *        卸载 props 逆向清理 + 级联卸载、生命周期广播（P0-02/P1-22/P1-23/P2-33）
 *   §10.10（verifyAll/selfCheck 自检面板）断言完整游戏宿主挂载面，Node 下不可测，
 *        须在游戏内控制台执行 window.__DJSC.verifyAll() 验证。
 *   §10.11 分层自检（报告 §9）：L1 加载契约 / L3 功能 smoke 全通过；L2 连接契约依赖
 *        游戏宿主挂载面，Node 下只校验结构；L4 实战行为不可自动化，须全部 manual 不计失败。
 *
 * 运行（需 Node 18+，仅用 Node 内置能力，无第三方依赖）：
 *   node tests/run_tests.mjs
 * 退出码：0 全部通过；1 存在失败（可用于 CI 阻止发布）。
 *
 * 说明：被测模块通过相对路径 import 游戏本体 noname.js；本脚本会在仓库根
 *   自动放置一个等价宿主桩 noname.js（若不存在），退出时自动删除。
 */

import { existsSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ---------- 最小断言框架 ---------- */
let _pass = 0;
const _fails = [];
function ok(cond, name, extra) {
    if (cond) { _pass++; process.stdout.write('.'); }
    else { _fails.push(name + (extra ? '  >> ' + extra : '')); process.stdout.write('F'); }
}
function eq(a, b, name) { ok(a === b, name, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
function approx(a, b, tol, name) { ok(Math.abs(a - b) <= tol, name, 'got ' + a + ' want ' + b + ' ±' + tol); }

/* ---------- 宿主桩（noname.js）：不存在则生成，退出自删 ---------- */
const _here = dirname(fileURLToPath(import.meta.url));          /* 无名AI/tests */
const _repoRoot = resolve(_here, '..', '..', '..');             /* WUMAING */
const _hostPath = join(_repoRoot, 'noname.js');
const _hostOwned = !existsSync(_hostPath);
/* Node 18 不会对 package 边界外的 .js 自动做 ESM 语法探测。
 * 当测试/训练脚本临时生成 noname.js 宿主桩时，同时在同目录生成最小 package.json，
 * 明确声明 type=module；仅在原文件不存在时创建并在退出时清理，绝不覆盖真实宿主工程。 */
const _hostPkgPath = join(_repoRoot, 'package.json');
const _hostPkgOwned = _hostOwned && !existsSync(_hostPkgPath);
const _HOST_STUB = `/* 自动生成的测试宿主桩——run_tests.mjs 退出时删除，勿手改、勿打包 */
const fn = function () { return undefined; };
const configStore = {};
function P() { return new Proxy(fn, { get(t, k) {
    if (k === Symbol.toPrimitive) return function () { return ''; };
    if (k === 'config') return configStore;
    if (!(k in t)) t[k] = P();
    return t[k];
}, apply: function () { return undefined; } }); }
export const lib = P();
export const game = P();
export const ui = P();
export const get = P();
export const ai = P();
export const _status = P();
export const _configStore = configStore;
export default { lib, game, ui, get, ai, _status };
`;
if (_hostOwned) writeFileSync(_hostPath, _HOST_STUB, 'utf8');
if (_hostPkgOwned) writeFileSync(_hostPkgPath, '{"type":"module"}\n', 'utf8');
function _cleanupHost() {
    if (_hostOwned && existsSync(_hostPath)) { try { rmSync(_hostPath); } catch (e) {} }
    if (_hostPkgOwned && existsSync(_hostPkgPath)) { try { rmSync(_hostPkgPath); } catch (e) {} }
}
process.on('exit', _cleanupHost);

/* ---------- 浏览器环境桩（必须在 import 业务模块前装好） ---------- */
const _mem = new Map();
globalThis.window = globalThis.window || {};
globalThis.window.__DJSC = globalThis.window.__DJSC || {};
globalThis.localStorage = {
    getItem: k => (_mem.has(k) ? _mem.get(k) : null),
    setItem: (k, v) => _mem.set(k, String(v)),
    removeItem: k => _mem.delete(k),
    clear: () => _mem.clear(),
    key: i => Array.from(_mem.keys())[i],
    get length() { return _mem.size; },
};

/* ---------- 导入被测模块 ---------- */
const _pkg = resolve(_here, '..');
/* 旧源码契约随实现迁移到真实环节模块；具体调度连接另有 B3 行为与顺序断言。 */
function readDecisionSources() {
    return ['engine/engine.js', 'context/decisionContext.js', 'context/targetContext.js', 'rules/basicRules.js', 'generation/scoredCandidates.js', 'scoring/candidateScoring.js', 'selection/plannedSelection.js', 'selection/modelReview.js', 'safety/finalCandidateGuard.js', 'feedback/executedLearning.js', 'execution/decisionEffects.js', 'scoring/scoreLedger.js', 'scoring/scoreEvents.js', 'scoring/candidateValuation.js', 'scoring/skillCandidateScore.js', 'scoring/cardCandidateScore.js', 'scoring/equipCandidateScore.js', 'records/decisionRecords.js', 'settlement/gameSettlement.js', 'feedback/decisionObservations.js', 'execution/hostHooks.js'].map(file =>
        readFileSync(join(_pkg, 'score/decision', file), 'utf8')).join('\n');
}
const wm = await import(pathToFileURL(join(_pkg, 'score', 'model', 'weights', 'weights.js')).href);
const te = await import(pathToFileURL(join(_pkg, 'score', 'model', 'train', 'trainExport.js')).href);
const hs = await import(pathToFileURL(join(_pkg, 'score', 'model', 'net', 'modelHotSwap.js')).href);
const ms = await import(pathToFileURL(join(_pkg, 'score', 'model', 'net', 'modelState.js')).href);  /* §8：统一 A/B 状态机本体（modelHotSwap 为其兼容外壳） */
const dt = await import(pathToFileURL(join(_pkg, 'score', 'cognition', 'deepThink.js')).href);  /* P0：模型未就绪时 deepThink 必须 fail-closed */
const hostStub = await import(pathToFileURL(_hostPath).href);
window.__DJSC.__weightsModule = wm;
window.__DJSC.__trainExportModule = te;

/* ---------- 工具 ---------- */
const W_KEYS = [
    ['__getW1', 130 * 128], ['__getB1', 128],
    ['__getW2', 128 * 64], ['__getB2', 64],
    ['__getW3', 64 * 6], ['__getB3', 6],
    ['__getW4', 64], ['__getB4', 1],
    ['__getPr1', 130 * 128], ['__getPr2', 128 * 64],
];
function snapshotArrays() {
    const out = {};
    for (const [k, n] of W_KEYS) {
        const a = wm[k]();
        const copy = new Int32Array(n);
        for (let i = 0; i < n; i++) copy[i] = a[i];
        out[k] = copy;
    }
    return out;
}
/* FNV-1a 风格哈希：把全部网络参数（可选含优化器矩）压成一个整数 */
function hashModel(includeMoments) {
    let h = 0x811c9dc5;
    const mix = v => { h ^= (v & 0xffffffff) >>> 0; h = Math.imul(h, 0x01000193) >>> 0; };
    const s = snapshotArrays();
    for (const k of Object.keys(s)) for (let i = 0; i < s[k].length; i++) mix(s[k][i]);
    if (includeMoments) {
        const m = wm.__getMoments();
        ok(!!m, '10.6 优化器状态可快照');
        for (const k of Object.keys(m)) {
            const a = m[k];
            if (typeof a === 'number') { mix(a); continue; }
            for (let i = 0; i < a.length; i++) mix((a[i] * 1e6) | 0);
        }
    }
    return h >>> 0;
}
function arraysEqual(got, want) {
    for (const k of Object.keys(want)) {
        const a = got[k]();
        if (a.length !== want[k].length) return '长度不符 ' + k + ' ' + a.length + '≠' + want[k].length;
        for (let i = 0; i < a.length; i++) if (a[i] !== want[k][i]) return '首个差异 ' + k + '[' + i + '] ' + a[i] + '≠' + want[k][i];
    }
    return null;
}
function maxDiff(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    return d;
}
function allFinite(a) { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; }
function feat130(seed) {
    const f = new Array(130);
    for (let i = 0; i < 130; i++) f[i] = Math.sin((i + 1) * (seed + 1) * 0.07) * 2 + Math.cos(i * 0.013 + seed);
    return f;
}
const WEIGHTS_STORE_KEY = 'djsc_weights_v3';

/* ================= 10.2 内置默认权重契约（版本自适应） ================= */
/* 全新内存存储：无任何存档。
 * 默认权重 v≠7（当前 v6 旧契约作废，待 §14C 重训）：必须 fail-closed、ready=false、诊断说明版本差；
 * 默认权重 v=7（build/train_default_weights.mjs 重训后）：必须加载成功、ready=true、无诊断。
 * 两个分支共享底线：前向可用且全 finite（防崩兜底）。 */
_mem.clear();
const dw = await import(pathToFileURL(join(_pkg, 'score', 'model', 'weights', 'defaultWeights.js')).href);
eq(wm.loadWeights(), false, '10.2 无存档时 loadWeights 返回 false（不代表失败，见 ready 位）');
if (dw.DEFAULT_WEIGHTS && dw.DEFAULT_WEIGHTS.v === wm.MODEL_SCHEMA.version) {
    eq(wm.isReady(), true, '10.2 v7 默认权重加载成功 → ready=true（§14C 闭环）');
    eq(wm.getDefaultDiag(), null, '10.2 v7 默认权重无诊断');
    ok(wm.getAccuracy() > 0, '10.2 v7 默认权重带验证准确率', 'acc=' + wm.getAccuracy());
} else {
    eq(wm.isReady(), false, '10.2 回退模型必须 ready=false');
    const diag = wm.getDefaultDiag() || '';
    ok(/v6/.test(diag) && /v7/.test(diag), '10.2 诊断必须说明 v6≠v7', JSON.stringify(diag));
}
const cold = wm.forward(new Array(130).fill(0.1));
ok(!!cold && cold.length === 6 && allFinite(cold), '10.2 fail-closed 后前向仍可用且全 finite（防崩兜底）');

/* ================= 10.3 reset 语义（版本自适应） ================= */
const beforeReset = snapshotArrays();
const hashBeforeReset = hashModel(false);
const _defaultsOK = !!(dw.DEFAULT_WEIGHTS && dw.DEFAULT_WEIGHTS.v === wm.MODEL_SCHEMA.version);
if (!_defaultsOK) {
    /* 默认权重不可用：reset 必须失败且全部参数一位不动、不落盘 */
    eq(wm.resetWeights(), false, '10.3 默认权重不可用时 reset 返回 false');
    eq(hashModel(false), hashBeforeReset, '10.3 reset 失败后全部网络参数一位不动');
    const resetDiff = arraysEqual({
        __getW1: wm.__getW1, __getB1: wm.__getB1, __getW2: wm.__getW2, __getB2: wm.__getB2,
        __getW3: wm.__getW3, __getB3: wm.__getB3, __getW4: wm.__getW4, __getB4: wm.__getB4,
        __getPr1: wm.__getPr1, __getPr2: wm.__getPr2,
    }, beforeReset);
    ok(resetDiff === null, '10.3 reset 失败后逐参数比对一致', resetDiff);
    eq(_mem.has(WEIGHTS_STORE_KEY), false, '10.3 reset 失败不得把随机权重落盘');
} else {
    /* 默认权重可用（§14C 已闭环）：reset 必须成功恢复出厂权重；连续两次 hash 一致（报告 §10.3 原文） */
    eq(wm.resetWeights(), true, '10.3 v7 默认权重可用时 reset 返回 true');
    const h1 = hashModel(false);
    eq(wm.resetWeights(), true, '10.3 第二次 reset 仍成功');
    eq(hashModel(false), h1, '10.3 连续两次 reset hash 一致（确定性恢复出厂）');
    eq(wm.isReady(), true, '10.3 reset 后 ready=true');
}

/* ================= 10.1 Int8/Int16 save→load 位级 round-trip ================= */
/* P0-04 回归：偏置是 Int16，>127 的值以前会被 Int8 decoder 拆碎、几何整体错位。 */
wm.__getB1()[7] = 1234;
wm.__getB1()[8] = -2345;
wm.__getB3()[2] = -567;
wm.__getW1()[3] = 127;
wm.__getW1()[4] = -128;
wm.__getPr2()[10] = 63;
const beforeSave = snapshotArrays();
eq(wm.saveWeights(), true, '10.1 saveWeights 返回 true');
eq(wm.loadWeights(), true, '10.1 刚写入的 v7 存档可被 loadWeights 接受');
const rtDiff = arraysEqual({
    __getW1: wm.__getW1, __getB1: wm.__getB1, __getW2: wm.__getW2, __getB2: wm.__getB2,
    __getW3: wm.__getW3, __getB3: wm.__getB3, __getW4: wm.__getW4, __getB4: wm.__getB4,
    __getPr1: wm.__getPr1, __getPr2: wm.__getPr2,
}, beforeSave);
ok(rtDiff === null, '10.1 全部 Int8 权重 + Int16 偏置 save→load 位级一致', rtDiff);
eq(wm.__getB1()[7], 1234, '10.1 Int16 偏置大正值 1234 存活（P0-04 回归）');
eq(wm.__getB1()[8], -2345, '10.1 Int16 偏置大负值 -2345 存活（P0-04 回归）');
eq(wm.__getB3()[2], -567, '10.1 Int16 B3 存活');
wm.setAccuracy(0.42);
wm.saveWeights();
wm.loadWeights();
approx(wm.getAccuracy(), 0.42, 1e-9, '10.1 META.accuracy 随存档往返');

/* ================= 10.4 三套前向路径一致（残差 on/off） ================= */
function checkForwardPaths(tag) {
    for (let seed = 0; seed < 3; seed++) {
        const x = seed === 0 ? new Array(130).fill(0) : feat130(seed);
        const a = wm.forward(x);
        const b = wm.forwardWithValue(x);
        const c = wm.forwardFastWithValue(x);
        ok(!!a && !!b && !!c, '10.4[' + tag + '] 三路径均返回结果 seed=' + seed);
        ok(maxDiff(a, b.actorLogits) <= 1e-5, '10.4[' + tag + '] forward ≈ forwardWithValue seed=' + seed, 'diff=' + maxDiff(a, b.actorLogits));
        ok(maxDiff(a, c.actorLogits) <= 1e-5, '10.4[' + tag + '] forward ≈ forwardFastWithValue seed=' + seed, 'diff=' + maxDiff(a, c.actorLogits));
        ok(Number.isFinite(b.value) && Math.abs(b.value) <= 1, '10.4[' + tag + '] Critic value ∈ [-1,1] finite seed=' + seed);
        const p = wm.predict(x);
        eq(p.probs.length, 6, '10.4[' + tag + '] predict 概率长度 6');
        ok(allFinite(p.probs), '10.4[' + tag + '] predict 概率全 finite');
        const sum = p.probs.reduce((s, v) => s + v, 0);
        approx(sum, 1, 1e-4, '10.4[' + tag + '] predict 概率和≈1');
        approx(p.confidence, Math.max.apply(null, p.probs), 1e-9, '10.4[' + tag + '] confidence=最大概率');
        ok(Number.isFinite(p.value), '10.4[' + tag + '] predict value finite');
    }
}
checkForwardPaths('res-off');
hostStub._configStore['extension_无名AI_useResidual'] = true;
checkForwardPaths('res-on');
delete hostStub._configStore['extension_无名AI_useResidual'];

/* ================= 10.5 反向传播梯度：有限差分 + 首步更新方向 ================= */
/* P1-17 回归 + 链式法则正确性：
 * ① __gradientsForTest 的解析梯度必须与损失曲面的有限差分一致（逐层、含残差 on/off）；
 * ② 真实 trainOne 首步更新方向必须与梯度反方向一致（零动量起点 AdamW 首步 = sign(g)，
 *   验证真实训练路径应用的是同一组快照梯度，而非更新后权重算出的梯度）。
 * 口径映射：权重浮点值 = Int8量子/128 → FD量子差分×128 得浮点梯度；
 *   gW2/gW3/gPr2 缓冲 = 浮点梯度；gW1/gPr1 缓冲 = 浮点梯度/128（weights.js 历史口径）；
 *   偏置浮点值 = Int16量子本身 → 缓冲 = FD量子差分。 */
{
    /* ★ FD 必须在未饱和状态做：10.1 注入的 B3[2]=-567 使 logits[2]≈-567，
     * Float32 logits 量子(≈3.4e-5)大于深层 1 量子扰动响应(≈6e-6)，损失成阶梯函数，FD 无意义。
     * 清档回 fail-closed 随机态（logits 健康），此时 FD 与解析梯度实测吻合到 ~0.3%。
     * ★ 确定性随机态：FD 断言是回归门禁，必须逐次可复现。mulberry32 固定种子替换
     *   Math.random（仅本段，退出前还原），权重初始化与随机舍入全部确定。 */
    const _origRandom = Math.random;
    let _seed = 0x9e3779b9;
    Math.random = function () {
        _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
        let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    _mem.clear();
    wm.loadWeights();
    eq(wm.isReady(), _defaultsOK, '10.5 清档后 ready 位与默认权重可用性一致（' + (_defaultsOK ? 'v7 默认已载入' : 'fail-closed 随机态') + '）');
    const snapB = wm.__snapshotModel();
    const gx = feat130(7), glabel = 2;
    const lossCE = (x, label) => {
        /* 不加下限钳制：训练端 dLogits 用原始 probs；钳制会让饱和类（如 10.1 注入的 B3[2]=-567）
         * 的损失项变成常数，有限差分恒为 0，掩盖真实梯度。p 最小 ~1e-31，double 取 log 安全。 */
        const r = wm.forwardWithValue(x);
        const p = wm.softmax(r.actorLogits);
        let L = 0;
        for (let k = 0; k < 6; k++) L -= ((k === label) ? 0.95 : 0.05 / 6) * Math.log(Math.max(p[k], 1e-300));
        return L;
    };
    const fdW = (arr, idx) => {          /* 权重量子 ±1 → 浮点梯度 */
        if (arr[idx] >= 120 || arr[idx] <= -120) return null;   /* 防 Int8 回绕 */
        arr[idx] += 1; const lp = lossCE(gx, glabel);
        arr[idx] -= 2; const lm = lossCE(gx, glabel);
        arr[idx] += 1;
        return (lp - lm) / 2 * 128;
    };
    const fdB = (arr, idx) => {          /* 偏置量子 ±1 → 浮点梯度（输出层用，线性无截断误差） */
        arr[idx] += 1; const lp = lossCE(gx, glabel);
        arr[idx] -= 2; const lm = lossCE(gx, glabel);
        arr[idx] += 1;
        return (lp - lm) / 2;
    };
    /* 偏置 1 量子 = 1.0 浮点单位（权重的 128 倍），经 GELU/LN 曲率时中心差分截断误差 16~29%；
     * Richardson 外推 (4·fd(h) − fd(2h))/3 消去二阶项，实测回到 ~1% 内。 */
    const fdB2 = (arr, idx) => {
        arr[idx] += 1; const l1p = lossCE(gx, glabel); arr[idx] -= 2; const l1m = lossCE(gx, glabel); arr[idx] += 1;
        arr[idx] += 2; const l2p = lossCE(gx, glabel); arr[idx] -= 4; const l2m = lossCE(gx, glabel); arr[idx] += 2;
        return (4 * ((l1p - l1m) / 2) - (l2p - l2m) / 4) / 3;
    };
    const close = (a, b, name) => {
        const tol = Math.max(2e-5, 0.05 * Math.max(Math.abs(a), Math.abs(b)));
        ok(a !== null && b !== null && Math.abs(a - b) <= tol, name, 'analytic=' + a + ' fd=' + b);
    };
    /* 偏置 FD 粗核：偏置 1 量子 = 1.0 浮点（权重的 128 倍），h=1.0 大步长穿过 GELU/LN
     * 高曲率区时 Richardson 仍剩可达 ~50% 截断残差，故只做"同号 + 量级一致"核验
     * （能抓住偏置未接入前向/接错层：FD≈0 或反号）；gB 精确性由恒等式+同层 gW FD 锚定。 */
    const closeLooseBias = (a, b, name) => {
        const m = Math.max(Math.abs(a), Math.abs(b));
        ok(a !== null && b !== null && m > 1e-8 && a * b > 0 && Math.abs(a - b) <= 1.5 * m, name, 'analytic=' + a + ' fd=' + b);
    };

    /* 钩子纯读性：不动权重/动量/adamT */
    const hPre = hashModel(true);
    const G = wm.__gradientsForTest(gx, glabel);
    ok(!!G, '10.5 __gradientsForTest 返回梯度对象');
    eq(hashModel(true), hPre, '10.5 梯度钩子纯读，模型+优化器状态逐位不变');

    /* 输出层 W3/B3（残差 off）：label 类与非 label 类都核 */
    const w3 = wm.__getW3(), b3 = wm.__getB3();
    close(G.gW3[glabel * 64 + 0], fdW(w3, glabel * 64 + 0), '10.5 gW3[label,0] 有限差分一致');
    close(G.gW3[glabel * 64 + 63], fdW(w3, glabel * 64 + 63), '10.5 gW3[label,63] 有限差分一致');
    const kOther = (glabel + 1) % 6;
    close(G.gW3[kOther * 64 + 17], fdW(w3, kOther * 64 + 17), '10.5 gW3[other,17] 有限差分一致');
    close(G.gB3[glabel], fdB(b3, glabel), '10.5 gB3[label] 有限差分一致');
    close(G.gB3[kOther], fdB(b3, kOther), '10.5 gB3[other] 有限差分一致');

    /* 隐藏层 W2/B2：验证 LN′+GELU′ 链式反传。
     * FD 信噪比 ∝ |g|：从候选中挑 |gW2| 最大的 3 个索引做 FD（小梯度索引的截断噪声占比高）。 */
    const w2 = wm.__getW2(), b2 = wm.__getB2();
    const cand2 = [0 * 128 + 0, 17 * 128 + 100, 33 * 128 + 33, 40 * 128 + 7, 63 * 128 + 127, 25 * 128 + 60, 50 * 128 + 3, 9 * 128 + 40]
        .sort((p, q) => Math.abs(G.gW2[q]) - Math.abs(G.gW2[p])).slice(0, 3);
    for (const idx of cand2) close(G.gW2[idx], fdW(w2, idx), '10.5 gW2[' + ((idx / 128) | 0) + ',' + (idx % 128) + '] 有限差分一致（|g| 最大档）');
    /* gB2[j] 与 gW2[j,·] 同源（都 = dH2raw[j]）：恒等式 gB2[j]·hn1[i] ≈ gW2[j,i]（差一次 Float32 舍入）。
     * dH2raw 的正确性已由 gW2 FD 锚定，恒等式把 gB2 无噪声地绑到已验证量上。 */
    for (const [j, i] of [[0, 0], [17, 100], [33, 33], [63, 127]]) {
        const expect = G.gB2[j] * G.hn1[i];
        approx(G.gW2[j * 128 + i], expect, Math.max(1e-9, 1e-5 * Math.abs(expect)), '10.5 gB2[' + j + ']·hn1[' + i + '] ≈ gW2 恒等');
    }
    /* 粗核：偏置确实以增益≈1 进入前向。取 |gB2| 最大的索引（SNR 最高）。 */
    let b2i = 0;
    for (const j of [0, 17, 33, 63]) if (Math.abs(G.gB2[j]) > Math.abs(G.gB2[b2i])) b2i = j;
    closeLooseBias(G.gB2[b2i], fdB2(b2, b2i), '10.5 gB2[' + b2i + '] FD 粗核（前向增益≈1）');

    /* 第一层 W1/B1：缓冲口径 = 浮点梯度/128，比对时 ×128。同样挑 |gW1| 最大档做 FD。 */
    const w1 = wm.__getW1(), b1 = wm.__getB1();
    const cand1 = [0 * 130 + 0, 7 * 130 + 64, 127 * 130 + 129, 3 * 130 + 9, 25 * 130 + 60, 50 * 130 + 3, 64 * 130 + 129, 100 * 130 + 17]
        .sort((p, q) => Math.abs(G.gW1[q]) - Math.abs(G.gW1[p])).slice(0, 3);
    for (const idx of cand1) close(G.gW1[idx] * 128, fdW(w1, idx), '10.5 gW1[' + ((idx / 130) | 0) + ',' + (idx % 130) + ']×128 有限差分一致（|g| 最大档）');
    /* gB1[j] 与 gW1[j,·] 同源（都 = dH1raw[j]，gW1 缓冲口径 = 浮点梯度/128）：
     * 恒等式 gW1缓冲[j,i] ≈ gB1[j]·(x[i]/128)（差一次 Float32 舍入）。
     * dH1raw 的正确性已由 gW1 FD 锚定，恒等式把 gB1 无噪声地绑到已验证量上。 */
    for (const [j, i] of [[0, 0], [7, 64], [64, 129], [127, 129]]) {
        const expect = G.gB1[j] * (gx[i] / 128);
        approx(G.gW1[j * 130 + i], expect, Math.max(1e-9, 1e-5 * Math.abs(expect)), '10.5 gB1[' + j + ']·(x[' + i + ']/128) ≈ gW1 恒等');
    }
    /* 粗核：偏置确实以增益≈1 进入前向。取 |gB1| 最大的索引（SNR 最高）。 */
    let b1i = 0;
    for (const j of [0, 7, 64, 127]) if (Math.abs(G.gB1[j]) > Math.abs(G.gB1[b1i])) b1i = j;
    closeLooseBias(G.gB1[b1i], fdB2(b1, b1i), '10.5 gB1[' + b1i + '] FD 粗核（前向增益≈1）');

    /* Critic 梯度公式自洽（valueTarget=0.5）：gW4=dV·hn2，gB4=dV */
    const Gv = wm.__gradientsForTest(gx, glabel, 0.5);
    const rV = wm.forwardWithValue(gx);
    for (const j of [0, 31, 63]) approx(Gv.gW4[j], Gv.dV * rV.hidden2[j], 1e-6, '10.5 gW4[' + j + ']=dV·hn2 自洽');
    approx(Gv.gB4[0], Gv.dV, 1e-6, '10.5 gB4=dV 自洽（Float32 缓冲舍入内）');

    /* 残差 on：投影矩阵梯度进入链式法则。
     * 结构上 gPr 与 gW 由 _computeGrads 同一局部量填充（前向中 W·x 与 W_proj·x 同位相加），
     * 因此逐元素恒等是精确断言；FD 仅做粗核（proj 前向正确性另由 10.4 res-on 路径一致性覆盖）。 */
    hostStub._configStore['extension_无名AI_useResidual'] = true;
    const Gr = wm.__gradientsForTest(gx, glabel);
    eq(Gr.useRes, true, '10.5 残差开关生效');
    let prIdentityBad = 0;
    for (let i = 0; i < Gr.gW1.length; i += 1999) if (Gr.gPr1[i] !== Gr.gW1[i]) prIdentityBad++;
    for (let i = 0; i < Gr.gW2.length; i += 997) if (Gr.gPr2[i] !== Gr.gW2[i]) prIdentityBad++;
    eq(prIdentityBad, 0, '10.5 gPr1===gW1、gPr2===gW2 逐元素恒等（同一梯度源）');
    const pr1 = wm.__getPr1(), pr2 = wm.__getPr2();
    /* 同索引 FD 对 FD：gPr===gW 已逐元素恒等（真梯度必同），且 res-on 前向只依赖 (W+Wpr) 之和，
     * 扰动 w 或 pr 的同一索引产生同一损失曲面响应 → 两侧 FD 差分值应几乎逐位一致，
     * 无随机态噪声困扰。选 |gW| 最大的候选索引，FD 信噪比最高。 */
    let best1 = 0, bestA1 = -1;
    for (const idx of [0 * 130 + 0, 3 * 130 + 9, 7 * 130 + 64, 25 * 130 + 60, 50 * 130 + 3, 127 * 130 + 129]) {
        const a = Math.abs(Gr.gW1[idx]);
        if (a > bestA1) { bestA1 = a; best1 = idx; }
    }
    close(fdW(pr1, best1), fdW(w1, best1), '10.5 pr1/w1 同索引[' + best1 + '] FD 对 FD（res-on，真梯度必同）');
    close(Gr.gW1[best1] * 128, fdW(w1, best1), '10.5 gW1[max档] 残差模式下解析仍一致');
    let best2 = 0, bestA2 = -1;
    for (const idx of [0 * 128 + 0, 9 * 128 + 40, 17 * 128 + 100, 33 * 128 + 7, 40 * 128 + 7, 63 * 128 + 127]) {
        const a = Math.abs(Gr.gW2[idx]);
        if (a > bestA2) { bestA2 = a; best2 = idx; }
    }
    close(fdW(pr2, best2), fdW(w2, best2), '10.5 pr2/w2 同索引[' + best2 + '] FD 对 FD（res-on，真梯度必同）');
    close(Gr.gW2[best2], fdW(w2, best2), '10.5 gW2[max档] 残差模式下解析仍一致');
    delete hostStub._configStore['extension_无名AI_useResidual'];

    /* 真实训练路径首步：零动量起点，AdamW 首步 mHat/(√vHat+eps)=sign(g)，
     * 故 ΔW 符号必须 = -sign(g)（若用了更新后权重算梯度，深层符号会错位） */
    const snapZ = wm.__snapshotModel();
    for (const k of Object.keys(snapZ)) if (/^[mv]/.test(k) && snapZ[k] && snapZ[k].fill) snapZ[k].fill(0);
    snapZ.adamT = 0;
    wm.__restoreModel(snapZ);
    const Gs = wm.__gradientsForTest(gx, glabel);
    const pairs = [
        [wm.__getW1(), Gs.gW1], [wm.__getW2(), Gs.gW2], [wm.__getW3(), Gs.gW3],
        [wm.__getB1(), Gs.gB1], [wm.__getB2(), Gs.gB2], [wm.__getB3(), Gs.gB3],
    ];
    const befores = pairs.map(p => p[0].slice());
    eq(wm.trainOne(gx, glabel, 0.02), true, '10.5 trainOne 首步执行成功');
    let signChecked = 0, signBad = 0;
    for (let pi = 0; pi < pairs.length; pi++) {
        const before = befores[pi], after = pairs[pi][0], grads = pairs[pi][1];
        for (let i = 0; i < before.length; i += 613) {   /* 稀疏确定性抽样 */
            const g = grads[i];
            if (Math.abs(g) < 1e-9) continue;
            if (Math.abs(before[i]) >= 125 && before[i] <= 127 && before[i] >= -128) continue;  /* 避开 Int8 饱和钳位 */
            signChecked++;
            const d = after[i] - before[i];
            if (d !== 0 && (d > 0) === (g > 0)) signBad++;
        }
    }
    ok(signChecked > 10, '10.5 首步方向抽样量充足（' + signChecked + '）');
    eq(signBad, 0, '10.5 首步更新方向全部与梯度反方向一致');

    /* 学习冒烟：强信号合成集上训练必须显著降损 */
    wm.__restoreModel(snapB);
    const cls = [];
    for (let c = 0; c < 6; c++) for (let rep = 0; rep < 2; rep++) {
        const f = feat130(c * 2 + rep);
        f[c * 3] = 12; f[c * 3 + 1] = -12;   /* 类标签强信号 */
        cls.push({ f: f, c: c });
    }
    const avgLoss = () => { let s = 0; for (const it of cls) s += lossCE(it.f, it.c); return s / cls.length; };
    const L0 = avgLoss();
    for (let ep = 0; ep < 60; ep++) for (const it of cls) wm.trainOne(it.f, it.c, 0.02);
    const L1 = avgLoss();
    /* 阈值 0.75：v6 fail-closed 冷启动（随机态）下轻松达标；v7 默认权重已载入时为热启动，
     * 损失起点更低、下降空间更小（实测 ~0.73），0.75 仍能抓住"训练不学习"回归。 */
    ok(L1 < L0 * 0.75, '10.5 强信号训练 720 步后损失显著下降', 'L0=' + L0.toFixed(3) + ' L1=' + L1.toFixed(3));
    wm.__restoreModel(snapB);
    Math.random = _origRandom;
}

/* ================= 10.7 热更快照完整性 + 结构护栏 ================= */
const snap = wm.__snapshotModel();
ok(!!snap, '10.7 __snapshotModel 非空');
const PARAMS = {
    W1: 130 * 128, B1: 128, W2: 128 * 64, B2: 64,
    W3: 64 * 6, B3: 6, W4: 64, B4: 1, W_proj1: 130 * 128, W_proj2: 128 * 64,
};
const MOM_SHAPE = {
    mW1: 130 * 128, mB1: 128, mW2: 128 * 64, mB2: 64,
    mW3: 64 * 6, mB3: 6, mW4: 64, mB4: 1, mW_proj1: 130 * 128, mW_proj2: 128 * 64,
    vW1: 130 * 128, vB1: 128, vW2: 128 * 64, vB2: 64,
    vW3: 64 * 6, vB3: 6, vW4: 64, vB4: 1, vW_proj1: 130 * 128, vW_proj2: 128 * 64,
};
for (const k of Object.keys(PARAMS)) ok(snap[k] && snap[k].length === PARAMS[k], '10.7 快照含网络参数 ' + k + '[' + PARAMS[k] + ']');
for (const k of Object.keys(MOM_SHAPE)) ok(snap[k] && snap[k].length === MOM_SHAPE[k], '10.7 快照含优化器状态 ' + k + '[' + MOM_SHAPE[k] + ']');
eq(typeof snap.adamT, 'number', '10.7 快照含 adamT');
ok(!!snap.META && typeof snap.META.ready === 'boolean', '10.7 快照含 META.ready');
/* 异形快照（w1 少一维）必须被 __applySnapshot 拒绝，且在线参数不受影响 */
wm.__getW1()[10] = 55;
const bad = {
    w1: wm.__getW1().slice(0, 10), b1: wm.__getB1(), w2: wm.__getW2(), b2: wm.__getB2(),
    w3: wm.__getW3(), b3: wm.__getB3(), w4: wm.__getW4(), b4: wm.__getB4(),
    pr1: wm.__getPr1(), pr2: wm.__getPr2(),
};
eq(wm.__applySnapshot(bad), false, '10.7 异形快照（w1 长度错误）必须拒绝');
eq(wm.__getW1()[10], 55, '10.7 拒绝后在线权重不被污染');
/* restore 往返 */
wm.__getW1()[11] = -77;
eq(wm.__restoreModel(snap), true, '10.7 完整快照可还原');
eq(wm.__getW1()[10], snap.W1[10], '10.7 还原后 W1[10] 回到快照值');
eq(wm.__getW1()[11], snap.W1[11], '10.7 还原抹掉还原后的临时改动');
eq(wm.__restoreModel(null), false, '10.7 null 快照拒绝');

/* ================= 10.8 训练数据导入准入：仅 130 维有限数 ================= */
te.resetAll();
function sample(dim, mut) {
    const f = new Array(dim);
    for (let i = 0; i < dim; i++) f[i] = (i % 7) - 3;
    if (mut) mut(f);
    return { f: f, r: 1 };
}
const batch = [
    sample(48), sample(96), sample(129), sample(131),       /* 错误维度 */
    sample(130, f => { f[5] = NaN; }),                      /* 非有限 NaN */
    sample(130, f => { f[9] = 'x'; }),                      /* 非有限 字符串 */
    (function () { const f = new Array(130); for (let i = 0; i < 130; i++) f[i] = (i % 5) - 2; return { f: f, r: 2 }; })(),  /* 唯一合法样本 */
];
const imp = te.importFromJson(JSON.stringify({ samples: batch }));
eq(imp.ok, true, '10.8 导入正常返回');
eq(imp.added, 1, '10.8 仅 1 条合法 130 维有限数样本入库', JSON.stringify(imp));
eq(imp.skippedWrongDim, 4, '10.8 48/96/129/131 维全部拒绝');
eq(imp.skippedNonFinite, 2, '10.8 NaN / 字符串样本全部拒绝');
eq(te.bufferSize(), 1, '10.8 BUFFER 中只有合法样本');

/* ================= 10.6 候选训练隔离 + discard 回滚 ================= */
te.resetAll();
const samples300 = [];
for (let i = 0; i < 300; i++) {
    const f = feat130(i);
    f[0] = i - 150;   /* 保证 300 条特征互不相同，去重不会合并 */
    samples300.push({ f: f, r: (i % 5) - 2 });
}
const imp2 = te.importFromJson(JSON.stringify({ samples: samples300 }));
eq(imp2.added, 300, '10.6 300 条互异样本全部入库', JSON.stringify(imp2));
hs.resetHotSwap();
const hStable = hashModel(true);
const tr = await hs.triggerHotTrain();
eq(tr.ok, true, '10.6 候选训练成功', JSON.stringify(tr));
eq(hashModel(true), hStable, '10.6 候选训练后 stable 权重+优化器状态逐位不变');
const st1 = hs.hotSwapStats();
eq(st1.hasCandidate, true, '10.6 候选已登记');
eq(ms.getState(), 'candidate', '10.6 §8 统一状态机：候选登记后 state=candidate');
ok(_mem.has('djsc_model_state'), '10.6 §8 统一存储键 djsc_model_state 已写入');
eq(_mem.has('djsc_hotswap_v1'), false, '10.6 §8 legacy djsc_hotswap_v1 已迁移删除');
/* 候选局：开局换入候选（在线变化）→ 局末记录分数后精确还原 */
hs.hotGameStart();
eq(hs.hotSwapStats().abArm, 'candidate', '10.6 首局分到候选组');
ok(hashModel(false) !== hStable, '10.6 候选局在线权重确实换为候选');
hs.hotRecordABScore(0.5);
eq(hs.hotSwapStats().abArm, null, '10.6 局末分组状态清空');
eq(hashModel(true), hStable, '10.6 候选局结束在线模型精确还原');
eq(hs.hotSwapStats().abScores.length, 1, '10.6 候选分数记在候选头上（P1-16）');
/* 丢弃候选：active 必须回到 stable */
eq(hs.forceDiscard(), true, '10.6 forceDiscard 成功');
eq(hs.hotSwapStats().hasCandidate, false, '10.6 discard 后候选清空');
eq(ms.getState(), 'stable', '10.6 §8 统一状态机：discard 后 state=stable');
eq(hashModel(true), hStable, '10.6 discard 后 active === stable');

/* ================= 10.35 训练标签契约一致性（P0） =================
 * Stable / Candidate / Default 三条训练链必须共享同一 reward -> A-F 映射。
 * 防止 modelState 热更新候选继续使用 2/1/0/-1 的旧阈值，与正式训练语义漂移。
 */
{
    const lp = await import(pathToFileURL(join(_pkg, 'score', 'model', 'train', 'labelPolicy.js')).href);

    /* 边界契约：5 个阈值切出 6 档 A-F */
    eq(lp.scoreToLabel(127), 0, '10.35 +127 -> A');
    eq(lp.scoreToLabel(80), 0, '10.35 +80 -> A');
    eq(lp.scoreToLabel(79), 1, '10.35 +79 -> B');
    eq(lp.scoreToLabel(30), 1, '10.35 +30 -> B');
    eq(lp.scoreToLabel(29), 2, '10.35 +29 -> C');
    eq(lp.scoreToLabel(0), 2, '10.35 0 -> C');
    eq(lp.scoreToLabel(-1), 3, '10.35 -1 -> D');
    eq(lp.scoreToLabel(-30), 3, '10.35 -30 -> D');
    eq(lp.scoreToLabel(-31), 4, '10.35 -31 -> E');
    eq(lp.scoreToLabel(-80), 4, '10.35 -80 -> E');
    eq(lp.scoreToLabel(-81), 5, '10.35 -81 -> F');
    eq(lp.scoreToLabel(-127), 5, '10.35 -127 -> F');

    /* 直观回归样本：修复前 modelState 会分别判 A/E/E */
    eq(lp.scoreToLabel(20), 2, '10.35 reward +20 应为 C，不得误判 A');
    eq(lp.scoreToLabel(-20), 3, '10.35 reward -20 应为 D，不得误判 E');
    eq(lp.scoreToLabel(-100), 5, '10.35 reward -100 应为 F，不得压成 E');

    /* 非法 reward fail-closed；已编码 label 走独立兼容入口 */
    eq(lp.scoreToLabel(NaN), null, '10.35 NaN reward 拒绝');
    eq(lp.scoreToLabel(Infinity), null, '10.35 Infinity reward 拒绝');
    eq(lp.normalizeLabelIndex(5), 5, '10.35 已编码数字标签 5 -> F');
    eq(lp.normalizeLabelIndex('F'), 5, '10.35 已编码字符标签 F -> 5');
    eq(lp.normalizeLabelIndex(20), null, '10.35 reward 20 不得被误当 label index');

    /* 源码守卫：阈值只允许存在于 labelPolicy.js。 */
    const fs35 = await import('node:fs');
    const lt35 = fs35.readFileSync(join(_pkg, 'score', 'model', 'train', 'localTrainer.js'), 'utf8');
    const ms35 = ['score/model/state/modelLifecycle.js', 'score/model/train/candidateTraining.js'].map(file => fs35.readFileSync(join(_pkg, file), 'utf8')).join('\n');
    const off35 = fs35.readFileSync(join(_pkg, 'build', 'train_default_weights.mjs'), 'utf8');

    ok(/from '\.\/labelPolicy\.js'/.test(lt35), '10.35 localTrainer 使用 labelPolicy');
    ok(/scoreToLabel\(s\.r\)/.test(lt35), '10.35 localTrainer reward 走 scoreToLabel');
    ok(/function\s+_scoreToLabel\s*\(/.test(lt35) === false, '10.35 localTrainer 不再私有复制阈值');

    ok(/from '\.\.\/train\/labelPolicy\.js'/.test(ms35), '10.35 modelState 使用 labelPolicy');
    ok(/scoreToLabel\(s\.r\)/.test(ms35), '10.35 Candidate reward 走统一 scoreToLabel');
    ok(/normalizeLabelIndex\(s\.label\)/.test(ms35), '10.35 Candidate 已编码 label 与 reward 明确分流');
    ok(/function\s+_labelIdx\s*\(/.test(ms35) === false, '10.35 modelState 旧 2/1/0/-1 映射已移除');

    ok(/labelPolicy\.js/.test(off35) && /scoreToLabel/.test(off35), '10.35 离线默认权重训练使用 labelPolicy');
    ok(/function\s+scoreToLabel\s*\(/.test(off35) === false, '10.35 离线训练不再复制阈值');
}

/* ================= 10.9 插件生命周期：注册/安装分离、依赖拓扑、自恢复、卸载清理 ================= */
/* P0-02 注册与安装分离；P1-22 依赖恢复自动重试；P1-23 卸载逆向清理 props + 级联卸载。
 * 注：§10.10（verifyAll/selfCheck 自检面板）断言的是完整游戏宿主挂载面（24 面板 + 24 命令
 * + 51 模块），Node 下无宿主只能得到"全缺失"退化结果，不具备可测性 → 浏览器控制台跑
 * window.__DJSC.verifyAll() 验证。 */
const pl = await import(pathToFileURL(join(_pkg, 'score', 'foundation', 'runtime', 'plugins.js')).href);
const eb = await import(pathToFileURL(join(_pkg, 'score', 'foundation', 'runtime', 'eventBus.js')).href);
{
    const calls = [];
    const mk = (id, spec) => pl.definePlugin(Object.assign({
        id: id, name: id, version: '1.0.0',
        onInstall: function () { calls.push('install:' + id); },
        onUninstall: function () { calls.push('uninstall:' + id); },
        onStart: function () { calls.push('start:' + id); },
        onGameEnd: function () { calls.push('end:' + id); },
    }, spec));

    /* ① 注册与安装分离（P0-02）：install:false 只登记不安装 */
    eq(pl.registerPlugin(mk('t.a', { props: { t9a: { x: 1 } } }), { install: false }).ok, true, '10.9 注册返回 ok');
    eq(pl.pluginState('t.a').state, 'pending', '10.9 install:false → pending，未安装');
    eq(calls.indexOf('install:t.a') >= 0, false, '10.9 注册阶段 onInstall 未被调用');
    eq((window.__DJSC.t9a || {}).x, undefined, '10.9 注册阶段 props 未绑定');

    /* ② 拓扑安装：t.b 依赖 t.a，installAllPlugins 按依赖序装 */
    pl.registerPlugin(mk('t.b', { depends: ['t.a'] }), { install: false });
    eq(pl.installAllPlugins().ok, true, '10.9 installAllPlugins 成功');
    eq(pl.pluginState('t.a').state, 'installed', '10.9 t.a installed');
    eq(pl.pluginState('t.b').state, 'installed', '10.9 t.b installed');
    ok(calls.indexOf('install:t.a') >= 0 && calls.indexOf('install:t.a') < calls.indexOf('install:t.b'), '10.9 拓扑序：t.a 先于 t.b 安装');
    eq(window.__DJSC.t9a.x, 1, '10.9 安装后 props 绑定到 __DJSC');

    /* ③ 缺依赖 → disabled 并记 reason，不波及其它插件 */
    pl.registerPlugin(mk('t.c', { depends: ['t.missing'] }), { install: false });
    pl.installAllPlugins();
    eq(pl.pluginState('t.c').state, 'disabled', '10.9 缺依赖插件被禁用');
    ok(/缺依赖|依赖不可用/.test(pl.pluginState('t.c').reason || ''), '10.9 禁用原因记录缺依赖', pl.pluginState('t.c').reason);
    eq(pl.pluginState('t.a').state, 'installed', '10.9 缺依赖不波及其它插件');

    /* ④ 依赖恢复自动重试（P1-22）：迟到依赖注册安装后，下游自动复活 */
    pl.registerPlugin(mk('t.d', { depends: ['t.late'] }), { install: false });
    pl.installAllPlugins();
    eq(pl.pluginState('t.d').state, 'disabled', '10.9 t.d 因 t.late 缺席被禁用');
    pl.registerPlugin(mk('t.late'), {});  /* 默认立即安装 → 成功 → retryDependents */
    eq(pl.pluginState('t.late').state, 'installed', '10.9 延迟注册的 t.late 安装成功');
    eq(pl.pluginState('t.d').state, 'installed', '10.9 t.d 依赖恢复后自动重试安装成功（P1-22）');

    /* ⑤ onInstall 抛异常 → disabled + reason，不传染 */
    pl.registerPlugin(pl.definePlugin({ id: 't.e', name: 't.e', onInstall: function () { throw new Error('boom'); } }), {});
    eq(pl.pluginState('t.e').state, 'disabled', '10.9 onInstall 异常 → disabled');
    ok(/安装异常/.test(pl.pluginState('t.e').reason || ''), '10.9 异常原因已记录', pl.pluginState('t.e').reason);

    /* ⑥ 卸载逆向清理（P1-23）：props 键删除 + 自建命名空间移除；软合并不碰已有键 */
    window.__DJSC.t9pre = { existing: 7 };
    pl.registerPlugin(mk('t.f', { props: { t9pre: { existing: 999, added: 8 }, t9new: { y: 2 } } }), {});
    eq(window.__DJSC.t9pre.existing, 7, '10.9 软合并不覆盖已有键');
    eq(window.__DJSC.t9pre.added, 8, '10.9 软合并补缺失键');
    eq(window.__DJSC.t9new.y, 2, '10.9 新命名空间创建');
    pl.uninstallPlugin('t.f');
    eq(window.__DJSC.t9pre.existing, 7, '10.9 卸载后已有键保留');
    eq(window.__DJSC.t9pre.added, undefined, '10.9 卸载后本插件写入键被删除');
    eq(window.__DJSC.t9new, undefined, '10.9 自建命名空间删空后整体移除');

    /* ⑦ 级联卸载：卸 t.a → 依赖它的 t.b 一并卸载 */
    calls.length = 0;
    pl.uninstallPlugin('t.a');
    eq(pl.pluginState('t.a').state, 'pending', '10.9 t.a 卸载后回 pending');
    eq(pl.pluginState('t.b').state, 'pending', '10.9 级联：t.b 随 t.a 卸载');
    ok(calls.indexOf('uninstall:t.a') >= 0 && calls.indexOf('uninstall:t.b') >= 0, '10.9 级联 onUninstall 均被调用');
    eq(window.__DJSC.t9a, undefined, '10.9 t.a 的 props 命名空间已清理');

    /* ⑧ 生命周期广播：installed 插件收 onStart/onGameEnd + eventBus 发布（P2-33） */
    calls.length = 0;
    let evStart = 0, evEnd = 0;
    eb.on('game:start', function () { evStart++; });
    eb.on('game:end', function () { evEnd++; });
    pl.broadcastStart();
    pl.broadcastGameEnd();
    ok(evStart === 1 && evEnd === 1, '10.9 广播经 eventBus 发布 game:start/game:end');
    ok(calls.indexOf('start:t.late') >= 0 && calls.indexOf('end:t.late') >= 0, '10.9 installed 插件收到 onStart/onGameEnd');
    ok(calls.indexOf('start:t.a') < 0 && calls.indexOf('start:t.e') < 0, '10.9 未安装/禁用插件不收广播');
    eb.clear();
}

/* ================= 10.11 分层自检（报告 §9：L1 加载 / L2 连接 / L3 功能 / L4 实战） =================
 * L2 依赖完整游戏宿主挂载面，Node 下只校验结构不判定通过；L4 不可自动化，必须 manual 且不计失败。 */
{
    const lm = await import(pathToFileURL(join(_pkg, 'score', 'verification', 'layers.js')).href);
    eq(typeof lm.checkL1, 'function', '10.11 layers 导出 checkL1');
    eq(typeof lm.checkL2, 'function', '10.11 layers 导出 checkL2');
    eq(typeof lm.checkL3, 'function', '10.11 layers 导出 checkL3');
    eq(typeof lm.checkL4, 'function', '10.11 layers 导出 checkL4');
    eq(typeof lm.verifyLayers, 'function', '10.11 layers 导出 verifyLayers');
    eq(Array.isArray(lm.LAYER_DEFS) && lm.LAYER_DEFS.length === 4, true, '10.11 恰好四层');
    eq(lm.LAYER_DEFS.map(function (l) { return l.id; }).join(','), 'L1,L2,L3,L4', '10.11 层序 L1→L4');
    eq(lm.LAYER_DEFS[3].auto, false, '10.11 L4 标记为不可自动化');

    /* L1 加载契约：关键模块全部 import 成功 + 导出 shape/type 契约 + MODEL_SCHEMA 形状 */
    const L1 = await lm.checkL1();
    const l1Fails = L1.items.filter(function (it) { return !it.pass; });
    eq(l1Fails.length, 0, '10.11 L1 加载契约全通过', l1Fails.map(function (i) { return i.name + ':' + i.detail; }).join(' | '));

    /* L3 功能 smoke：模型三路径 / predict 归一 / 存储 roundtrip / A-B 状态
     * （Node 下无业务模块订阅 eventBus——宿主引擎未跑；模拟 3 条业务订阅以验证 L3 判定口径，
     *    真实订阅存在性由浏览器端 __DJSC.verifyLayers() 判定） */
    eb.on('game:start', function () {}); eb.on('game:end', function () {}); eb.on('train:done', function () {});
    const L3 = await lm.checkL3();
    const l3Fails = L3.items.filter(function (it) { return !it.pass; });
    eq(l3Fails.length, 0, '10.11 L3 功能 smoke 全通过', l3Fails.map(function (i) { return i.name + ':' + i.detail; }).join(' | '));
    ok(L3.items.some(function (it) { return it.name.indexOf('forward') === 0 && it.pass; }), '10.11 L3 含 forward(zeros130) 且通过');
    ok(L3.items.some(function (it) { return it.name.indexOf('roundtrip') >= 0 && it.pass; }), '10.11 L3 含存储 roundtrip 且通过');
    eq(_mem.has('djsc_smoke_l3_tmp'), false, '10.11 L3 存储 smoke 临时键已清理，不留残渣');

    /* L4 实战行为：全部 manual、pass 为 null、不计失败 */
    const L4 = lm.checkL4();
    eq(L4.auto, false, '10.11 L4 层标记 auto=false');
    ok(L4.items.length >= 6, '10.11 L4 实战行为清单非空（' + L4.items.length + ' 项）');
    eq(L4.items.every(function (it) { return it.manual === true && it.pass === null; }), true, '10.11 L4 全部 manual 且不计失败');

    /* 汇总：verifyLayers 四层齐备；L2 在 Node 下允许断链（缺游戏宿主），但结构必须完整 */
    const all = await lm.verifyLayers();
    eq(all.layers.length, 4, '10.11 verifyLayers 返回四层');
    all.layers.forEach(function (l) {
        ok(l.summary && typeof l.summary.ok === 'number' && typeof l.summary.fail === 'number', '10.11 ' + l.layer + ' 带 ok/fail 汇总');
    });
    eq(typeof all.summary === 'string' && all.summary.indexOf('L4') >= 0, true, '10.11 汇总文本含四层');
    eq(typeof window.__DJSC.verifyLayers, 'function', '10.11 __DJSC.verifyLayers 已挂载');
    eb.clear();
}

/* ================= 10.12 桃救援策略（指令 01：敌方濒死误出桃） =================
 * 唯一权威 evaluateTaoRescue + 四层防线（Policy / Hard Guard / Score Alignment / Tests）。
 * 不变量：self→allow、ally→allow、neutral→block、enemy→block、invalid→block；
 *          relation 解析失败 → 非 self 一律 block（fail-closed），self 仍 allow。
 * 「濒死」只提升紧急度，绝不反转关系方向。 */
{
    const rp = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'safety', 'rescuePolicy.js')).href);

    eq(typeof rp.evaluateTaoRescue, 'function', '10.12 rescuePolicy 导出 evaluateTaoRescue');
    ok(rp.TAO_RESCUE_SCORE && rp.TAO_RESCUE_SCORE.self === 8 && rp.TAO_RESCUE_SCORE.ally === 5
        && rp.TAO_RESCUE_SCORE.neutral === -3 && rp.TAO_RESCUE_SCORE.enemy === -8,
        '10.12 Score 契约 self8/ally5/neutral-3/enemy-8');

    const P = { name: 'me', hp: 1 };
    const T = { name: 't', hp: 0 };

    function _ev(player, target, ctx, name) {
        if (typeof rp.evaluateTaoRescue !== 'function') { ok(false, name, 'evaluateTaoRescue missing'); return {}; }
        try { return rp.evaluateTaoRescue(player, target, ctx) || {}; }
        catch (e) { ok(false, name, 'threw ' + e.message); return {}; }
    }

    /* ---- 关系矩阵：self / ally / enemy / neutral ---- */
    const self = _ev(P, P, {}, '10.12 self');
    eq(self.allow, true, '10.12 自救 allow（target===player 特判）');
    eq(self.relation, 'self', '10.12 自救 relation=self');
    eq(self.score, 8, '10.12 自救 score=+8');

    const ally = _ev(P, T, { disposition: 1 }, '10.12 ally');
    eq(ally.allow, true, '10.12 友方濒死 allow');
    eq(ally.relation, 'ally', '10.12 友方 relation=ally');
    eq(ally.score, 5, '10.12 友方 score=+5');

    const enemy = _ev(P, T, { disposition: -1 }, '10.12 enemy');
    eq(enemy.allow, false, '10.12 敌方濒死 block');
    eq(enemy.relation, 'enemy', '10.12 敌方 relation=enemy');
    eq(enemy.score, -8, '10.12 敌方 score=-8');

    const neutral = _ev(P, T, { disposition: 0 }, '10.12 neutral');
    eq(neutral.allow, false, '10.12 中性濒死 block');
    eq(neutral.relation, 'neutral', '10.12 中性 relation=neutral');
    eq(neutral.score, -3, '10.12 中性 score=-3');

    /* ---- invalid / missing target ---- */
    const inv = _ev(P, null, {}, '10.12 invalid');
    eq(inv.allow, false, '10.12 target 缺失 → block');
    eq(inv.score, -8, '10.12 invalid score=-8');
    ok(String(inv.reason || '').indexOf('invalid') >= 0, '10.12 invalid reason 含 invalid');

    /* ---- relation API 失败 → 非 self 一律 fail-closed ---- */
    const throwRel = { dispositionOf: function () { throw new Error('boom'); } };
    const failEnemy = _ev(P, T, { relations: throwRel, attitude: function () { return null; } }, '10.12 relfail');
    eq(failEnemy.allow, false, '10.12 relation 失败 → 非 self block（fail-closed）');
    ok(String(failEnemy.reason || '').indexOf('unknown') >= 0, '10.12 relation 失败 reason 含 unknown');

    const failSelf = _ev(P, P, { relations: throwRel, attitude: function () { return null; } }, '10.12 relfail-self');
    eq(failSelf.allow, true, '10.12 relation 失败时 self 仍 allow');

    /* ---- attitude fallback ---- */
    eq(_ev(P, T, { attitude: function () { return -5; } }, '10.12 att-enemy').allow, false, '10.12 attitude<0 回退 → block');
    eq(_ev(P, T, { attitude: function () { return 3; } }, '10.12 att-ally').allow, true, '10.12 attitude>0 回退 → allow');

    /* ---- disposition=NaN 不应短路，回退关系链 ---- */
    eq(_ev(P, T, { disposition: NaN, relations: { dispositionOf: function () { return 1; } } }, '10.12 nan').allow,
        true, '10.12 disposition=NaN 时回退 relations → ally allow');

    /* ---- 1 桃 / 多桃：策略与数量无关（不改变方向） ---- */
    eq(_ev(P, T, { disposition: -1, taoCount: 1 }, '10.12 1tao').allow, false, '10.12 1 桃时敌方仍 block');
    eq(_ev(P, T, { disposition: -1, taoCount: 3 }, '10.12 3tao').allow, false, '10.12 多桃时敌方仍 block（数量不改变方向）');

    /* ===== 防线 3：Score Alignment（optimization._scoreTao） ===== */
    const om = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'safety', 'optimization.js')).href);
    eq(typeof om._scoreTao, 'function', '10.12 optimization 导出 _scoreTao');
    if (typeof om._scoreTao === 'function') {
        const sSelf = om._scoreTao(P, P, P, { disposition: 1 });
        const sAlly = om._scoreTao(P, T, T, { disposition: 1 });
        const sEnemy = om._scoreTao(P, T, T, { disposition: -1 });
        const sNeutral = om._scoreTao(P, T, T, { disposition: 0 });
        ok(sSelf > 0, '10.12 optimization 自救濒死 score>0（got ' + sSelf + '）');
        ok(sAlly > 0, '10.12 optimization 友方濒死 score>0（got ' + sAlly + '）');
        ok(sEnemy <= 0, '10.12 optimization 敌方濒死 score<=0（不得给正救援倾向，got ' + sEnemy + '）');
        ok(sNeutral <= 0, '10.12 optimization 中性濒死 score<=0（got ' + sNeutral + '）');
    }

    /* ===== 防线 4：responseAI._shouldSaveTao（true=保留桃） ===== */
    const ra = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'response', 'responseAI.js')).href);
    eq(typeof ra._shouldSaveTao, 'function', '10.12 responseAI 导出 _shouldSaveTao');
    if (typeof ra._shouldSaveTao === 'function') {
        const dEnemy = { hp: 0, maxHp: 4 };
        const dAlly = { hp: 0, maxHp: 4 };
        const dNeutral = { hp: 0, maxHp: 4 };
        eq(ra._shouldSaveTao(P, dEnemy, { disposition: -1, dyingTarget: dEnemy }), true, '10.12 responseAI 敌方濒死 → 保留桃（不救）');
        eq(ra._shouldSaveTao(P, dAlly, { disposition: 1, dyingTarget: dAlly }), false, '10.12 responseAI 友方濒死 → 不保留（出桃救）');
        eq(ra._shouldSaveTao(P, P, { dyingTarget: P }), false, '10.12 responseAI 自救濒死 → 不保留（出桃救）');
        eq(ra._shouldSaveTao(P, dNeutral, { disposition: 0, dyingTarget: dNeutral }), true, '10.12 responseAI 中性濒死 → 保留桃');
    }

    /* ===== 防线 4：respond._keepTao（true=保留桃） ===== */
    const rd = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'override', 'respond.js')).href);
    eq(typeof rd._keepTao, 'function', '10.12 respond 导出 _keepTao');
    if (typeof rd._keepTao === 'function') {
        eq(rd._keepTao(P, { hp: 0, maxHp: 4 }, { disposition: -1 }), true, '10.12 respond 敌方濒死 → 保留桃');
        eq(rd._keepTao(P, { hp: 0, maxHp: 4 }, { disposition: 1 }), false, '10.12 respond 友方濒死 → 不保留');
        eq(rd._keepTao(P, P, {}), false, '10.12 respond 自救濒死 → 不保留');
        eq(rd._keepTao(P, { hp: 0, maxHp: 4 }, { disposition: 0 }), true, '10.12 respond 中性濒死 → 保留桃');
    }

    /* ===== 防线 2：Hard Guard（use._resolveDyingTarget / _shouldBlockTaoRescue） ===== */
    const us = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'override', 'use.js')).href);
    eq(typeof us._resolveDyingTarget, 'function', '10.12 use 导出 _resolveDyingTarget');
    eq(typeof us._shouldBlockTaoRescue, 'function', '10.12 use 导出 _shouldBlockTaoRescue');

    if (typeof us._resolveDyingTarget === 'function') {
        const t0 = { name: 'd0' };
        eq(us._resolveDyingTarget({ dying: t0 }, 6), t0, '10.12 resolveDyingTarget 直接读 event.dying');
        const root = { dying: t0, getParent: function () { return null; } };
        const mid = { getParent: function () { return root; } };
        const top = { getParent: function () { return mid; } };
        eq(us._resolveDyingTarget(top, 6), t0, '10.12 resolveDyingTarget 沿 getParent 上溯');
        const a = {}, b = {};
        a.getParent = function () { return b; };
        b.getParent = function () { return a; };
        eq(us._resolveDyingTarget(a, 6), null, '10.12 resolveDyingTarget 循环引用不死循环');
        eq(us._resolveDyingTarget(null, 6), null, '10.12 resolveDyingTarget 空事件 → null');
    }

    if (typeof us._shouldBlockTaoRescue === 'function') {
        const dEnemy = { name: 'e', hp: 0 };
        const dAlly = { name: 'a', hp: 0 };
        eq(us._shouldBlockTaoRescue(P, { name: 'sha' }, {}, { cardId: 'sha', dyingTarget: dEnemy }), false, '10.12 guard 非桃不拦');
        eq(us._shouldBlockTaoRescue(P, { name: 'tao' }, {}, { cardId: 'tao', dyingTarget: null }), false, '10.12 guard 无濒死不拦');
        eq(us._shouldBlockTaoRescue(P, { name: 'tao' }, {}, { cardId: 'tao', dyingTarget: dEnemy, disposition: -1 }), true, '10.12 guard 敌方濒死 → 拦桃');
        eq(us._shouldBlockTaoRescue(P, { name: 'tao' }, {}, { cardId: 'tao', dyingTarget: dAlly, disposition: 1 }), false, '10.12 guard 友方濒死 → 放行');
        eq(us._shouldBlockTaoRescue(P, { name: 'tao' }, {}, { cardId: 'tao', dyingTarget: P }), false, '10.12 guard 自救 → 放行');
        const r = { dying: dEnemy, getParent: function () { return null; } };
        const e2 = { getParent: function () { return r; } };
        eq(us._shouldBlockTaoRescue(P, { name: 'tao' }, e2, { cardId: 'tao', disposition: -1 }), true, '10.12 guard 经事件链找到敌方濒死 → 拦桃');
    }

    /* chooseToUse（off-turn）与 chooseToRespond 共用同一权威 policy */
    eq(_ev(P, T, { disposition: -1 }).allow, false, '10.12 chooseToUse/chooseToRespond 共用 policy：敌方 block');
    eq(_ev(P, P, {}).allow, true, '10.12 chooseToUse/chooseToRespond 共用 policy：self allow');
}

/* ================= 10.13 铁索状态规划（指令 02：状态读取 + 重铸决策） =================
 * Task 1 统一 linked-state：全库唯一 isPlayerLinked 入口，消除 !!isLinked / !isLinked / isChained。
 * 后续 Task 2-6 evaluator 断言持续加入本节。 */
{
    const fsSync = await import('node:fs');
    const ps = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'state', 'playerState.js')).href);
    eq(typeof ps.isPlayerLinked, 'function', '10.13 playerState 导出 isPlayerLinked');

    /* ---- 宿主真实 API：isLinked 为函数 ---- */
    eq(ps.isPlayerLinked({ isLinked: function () { return true; } }), true, '10.13 isLinked()===true → true');
    eq(ps.isPlayerLinked({ isLinked: function () { return false; } }), false, '10.13 isLinked()===false → false');
    eq(ps.isPlayerLinked({ isLinked: function () { return 1; } }), true, '10.13 isLinked() 真值归一为 true');

    /* ---- 非法 / 缺失 ---- */
    eq(ps.isPlayerLinked(null), false, '10.13 null → false');
    eq(ps.isPlayerLinked(undefined), false, '10.13 undefined → false');
    eq(ps.isPlayerLinked({}), false, '10.13 无 isLinked → false');
    eq(ps.isPlayerLinked({ isLinked: function () { throw new Error('boom'); } }), false, '10.13 isLinked() 抛错 → fail-closed false');

    /* ---- legacy 布尔字段（仅在 isLinked 非函数时生效） ---- */
    eq(ps.isPlayerLinked({ isLinked: true }), true, '10.13 legacy isLinked=true → true');
    eq(ps.isPlayerLinked({ isLinked: false }), false, '10.13 legacy isLinked=false → false');

    /* ---- 关键回归：函数对象不得被当作 true（旧 bug：!!p.isLinked） ---- */
    eq(ps.isPlayerLinked({ isLinked: function () { return false; } }), false, '10.13 函数对象不得恒 true（消除 !!p.isLinked）');

    /* ---- 源码守卫：旧写法不得复活 ---- */
    const engSrc = readDecisionSources();
    eq(engSrc.indexOf('!!p.isLinked') < 0, true, '10.13 engine.js 不再出现 !!p.isLinked');
    ok(!/!target\.isLinked\b/.test(engSrc), '10.13 engine.js 不再出现 !target.isLinked');

    const dtSrc = fsSync.readFileSync(join(_pkg, 'score', 'decision', 'safety', 'damageTransfer.js'), 'utf8');
    eq(dtSrc.indexOf('isChained') < 0, true, '10.13 damageTransfer.js 不再出现 isChained');
}

/* ================= 10.14 铁索 evaluator：纯模拟 + 动作枚举（Task 2-3） ================= */
{
    const ev = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'cards', 'tiesuoEvaluator.js')).href);
    eq(typeof ev.getCurrentLinkedSet, 'function', '10.14 导出 getCurrentLinkedSet');
    eq(typeof ev.toggleLinkedSet, 'function', '10.14 导出 toggleLinkedSet');
    eq(typeof ev.generateTiesuoActions, 'function', '10.14 导出 generateTiesuoActions');

    function mkP(name, linked) { return { name: name, hp: 4, maxHp: 4, isLinked: function () { return !!linked; } }; }
    const me = mkP('me', false);
    const A = mkP('A', true);
    const E1 = mkP('E1', true);
    const E2 = mkP('E2', false);
    const all = [me, A, E1, E2];

    /* ---- Task 2：纯模拟器 ---- */
    const S = ev.getCurrentLinkedSet(all);
    eq(S instanceof Set, true, '10.14 getCurrentLinkedSet 返回 Set');
    eq(S.size, 2, '10.14 当前横置集合 size=2 (A,E1)');
    eq(S.has(A) && S.has(E1), true, '10.14 集合含 A、E1');
    eq(S.has(E2) && S.has(me), false, '10.14 集合不含 E2、me');

    const a1 = ev.toggleLinkedSet(S, [E2]);
    eq(a1.has(E2), true, '10.14 单目标未横置 → 横置');
    eq(a1.size, 3, '10.14 toggle 后 size=3');
    const a2 = ev.toggleLinkedSet(S, [A]);
    eq(a2.has(A), false, '10.14 单目标已横置 → 解除');
    eq(a2.size, 1, '10.14 解除后 size=1');
    const a3 = ev.toggleLinkedSet(S, [A, E2]);
    eq(a3.has(A), false, '10.14 双目标：A 解除');
    eq(a3.has(E2), true, '10.14 双目标：E2 横置');
    eq(a3.size, 2, '10.14 双目标 toggle 后 size=2');

    /* 纯函数：不修改真实 Player、不修改输入 set */
    eq(typeof A.isLinked === 'function' ? A.isLinked() : A.isLinked, true, '10.14 模拟不修改真实 Player（A 仍横置）');
    eq(S.size, 2, '10.14 模拟不修改输入 beforeSet');

    /* ---- Task 3：动作枚举 ---- */
    const cands = [A, E1, E2];
    const acts = ev.generateTiesuoActions(me, { name: 'tiesuo' }, cands, { canRecast: true });
    eq(acts.filter(function (x) { return x.type === 'recast'; }).length, 1, '10.14 可重铸 → 恰含 1 个 RECAST');
    eq(acts.filter(function (x) { return x.type === 'use' && x.targets.length === 1; }).length, 3, '10.14 生成全部 3 个单目标');
    eq(acts.filter(function (x) { return x.type === 'use' && x.targets.length === 2; }).length, 3, '10.14 生成全部 3 个双目标');
    eq(acts.length, 7, '10.14 总候选 = 1 + 3 + 3 = 7');

    const pairKeys = acts.filter(function (x) { return x.type === 'use' && x.targets.length === 2; })
        .map(function (x) { return x.targets.map(function (t) { return t.name; }).sort().join('+'); });
    eq(new Set(pairKeys).size, 3, '10.14 双目标无重复 pair');

    /* 每个 use 候选必须带 beforeLinked/afterLinked */
    const anyUse = acts.filter(function (x) { return x.type === 'use'; })[0];
    ok(anyUse.beforeLinked instanceof Set && anyUse.afterLinked instanceof Set, '10.14 use 候选带 beforeLinked/afterLinked');
    eq(anyUse.beforeLinked.size, 2, '10.14 beforeLinked 取自全局 players');

    /* 不可重铸 → 不生成 RECAST */
    const actsNoRecast = ev.generateTiesuoActions(me, { name: 'tiesuo' }, cands, { canRecast: false });
    eq(actsNoRecast.filter(function (x) { return x.type === 'recast'; }).length, 0, '10.14 不可重铸 → 无 RECAST');
    eq(actsNoRecast.length, 6, '10.14 不可重铸 → 6 个 use');

    /* 非法目标（null/undefined/重复）被过滤 */
    const actsDirty = ev.generateTiesuoActions(me, { name: 'tiesuo' }, [A, null, undefined, A], { canRecast: false });
    eq(actsDirty.filter(function (x) { return x.type === 'use' && x.targets.length === 1; }).length, 1, '10.14 重复/空目标被去重过滤（单目标=1）');
    eq(actsDirty.length, 1, '10.14 去重后仅剩 1 个 use（无 pair）');
}

/* ================= 10.15 铁索 evaluator：状态 utility + 动作 delta（Task 4-5） ================= */
{
    const ev = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'cards', 'tiesuoEvaluator.js')).href);
    eq(typeof ev.evaluateLinkedState, 'function', '10.15 导出 evaluateLinkedState');
    eq(typeof ev.scoreTiesuoAction, 'function', '10.15 导出 scoreTiesuoAction');

    function P(name, rel, hp, maxHp) {
        return { name: name, rel: rel, hp: hp == null ? 4 : hp, maxHp: maxHp == null ? 4 : maxHp, isLinked: function () { return false; } };
    }
    /* 关系注入：+1 ally / -1 enemy / 0 neutral（与项目 dispositionOf 语义一致） */
    const ctx = { relationOf: function (mi, t) { return t.rel; } };
    const me = P('me', 1);

    const E = P('E', -1), E_low = P('E_low', -1, 1, 4);
    const A = P('A', 1), A_low = P('A_low', 1, 1, 4);
    const N = P('N', 0);

    const uNone = ev.evaluateLinkedState(me, null, new Set(), ctx);
    eq(uNone, 0, '10.15 空横置集合 U=0');

    const uE = ev.evaluateLinkedState(me, null, new Set([E]), ctx);
    ok(uE > uNone, '10.15 enemy linked > enemy unlinked');

    const uA = ev.evaluateLinkedState(me, null, new Set([A]), ctx);
    ok(uA < 0 && uA < uNone, '10.15 ally linked < ally unlinked');

    const uEl = ev.evaluateLinkedState(me, null, new Set([E_low]), ctx);
    ok(uEl > uE, '10.15 enemy low HP linked 增益 > enemy high HP');

    const uAl = ev.evaluateLinkedState(me, null, new Set([A_low]), ctx);
    ok(uAl < uA, '10.15 ally low HP linked 惩罚 > ally high HP（更负）');

    const uN = ev.evaluateLinkedState(me, null, new Set([N]), ctx);
    ok(uN <= 0, '10.15 neutral linked 不产生正收益');
    ok(Math.abs(uN) < Math.abs(uE), '10.15 neutral 不被当成明确 enemy（量级近零）');

    /* ---- Task 5：动作 delta ---- */
    const E1 = P('E1', -1), E2 = P('E2', -1), A1 = P('A1', 1);
    function mk(targets, before) {
        return { type: 'use', targets: targets, beforeLinked: before, afterLinked: ev.toggleLinkedSet(before, targets) };
    }
    const before = new Set([E1]);
    const dNew = ev.scoreTiesuoAction(me, mk([E2], before), ctx);
    ok(dNew > 0, '10.15 已有敌人 linked，再链新敌人 → 单目标为正');

    const dRe = ev.scoreTiesuoAction(me, mk([E1], before), ctx);
    ok(dRe < 0 && dRe < dNew, '10.15 已 linked 敌人再次被选 → 显著降分（解链敌人）');

    const dUnlinkAlly = ev.scoreTiesuoAction(me, mk([A1], new Set([A1])), ctx);
    ok(dUnlinkAlly > 0, '10.15 解除 linked 队友 → 为正');

    const b2 = new Set([A1, E1]);
    const dOnlyNew = ev.scoreTiesuoAction(me, mk([E2], b2), ctx);
    const dSwap = ev.scoreTiesuoAction(me, mk([A1, E2], b2), ctx);
    ok(dSwap > dOnlyNew, '10.15 [ally,newEnemy] 胜过仅 [newEnemy]（非加性组合）');
}

/* ================= 10.16 铁索 evaluator：recast 同层竞争 + 主入口（Task 6） ================= */
{
    const ev = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'cards', 'tiesuoEvaluator.js')).href);
    eq(typeof ev.estimateTiesuoRecastValue, 'function', '10.16 导出 estimateTiesuoRecastValue');
    eq(typeof ev.tiesuoUseThreshold, 'function', '10.16 导出 tiesuoUseThreshold');
    eq(typeof ev.tiesuoUtilityToEngineRaw, 'function', '10.16 导出 tiesuoUtilityToEngineRaw');
    eq(typeof ev.evaluateTiesuoActions, 'function', '10.16 导出 evaluateTiesuoActions');

    function P6(name, rel, hp, maxHp) {
        return { name: name, rel: rel, hp: hp == null ? 4 : hp, maxHp: maxHp == null ? 4 : maxHp, isLinked: function () { return false; } };
    }
    const relationOf = function (mi, t) { return t.rel; };
    const me6 = P6('me', 1);

    /* recast 必须稳定、非零、可覆写 */
    const rv = ev.estimateTiesuoRecastValue(me6, { relationOf: relationOf });
    ok(typeof rv === 'number' && rv > 0, '10.16 recast 基准为正（稳定非零）');
    eq(ev.estimateTiesuoRecastValue(me6, { recastValue: 3 }), 3, '10.16 recastValue 可显式覆写');

    /* 所有 use 为负 → RECAST */
    const A6 = P6('A6', 1);
    const resNeg = ev.evaluateTiesuoActions(me6, {}, { candidates: [A6], players: [A6], relationOf: relationOf });
    eq(resNeg.bestAction.type, 'recast', '10.16 所有 use 为负 → 选 RECAST');

    /* 默认门槛 = 1.2 + 1.3 = 2.5；普通单敌 ΔU=2 不够，应该重铸 */
    const E6 = P6('E6', -1);
    const resSingleNormal = ev.evaluateTiesuoActions(me6, {}, { candidates: [E6], players: [E6], relationOf: relationOf });
    eq(resSingleNormal.useThreshold, 2.5, '10.16 默认使用门槛 = RecastValue 1.2 + Margin 1.3');
    eq(resSingleNormal.bestAction.type, 'recast', '10.16 普通单敌 ΔU=2 < 2.5 → RECAST');

    /* 危险单目标（1血敌人）ΔU=3.2，超过门槛 → use */
    const E6low = P6('E6low', -1, 1, 4);
    const resUse = ev.evaluateTiesuoActions(me6, {}, { candidates: [E6low], players: [E6low], relationOf: relationOf });
    eq(resUse.bestAction.type, 'use', '10.16 危险单目标 ΔU>=2.5 → use');
    eq(resUse.bestAction.targets.length, 1, '10.16 危险单目标 use 正确');

    /* RecastValue 提高后，门槛同步提高 */
    const resLow = ev.evaluateTiesuoActions(me6, {}, { candidates: [E6low], players: [E6low], relationOf: relationOf, recastValue: 2.5 });
    eq(resLow.useThreshold, 3.8, '10.16 recast=2.5 时使用门槛=3.8');
    eq(resLow.bestAction.type, 'recast', '10.16 危险单目标仍低于提高后的门槛 → RECAST');

    /* 统一 utility→engine raw 映射：1.2→3，2→5，4→10 */
    eq(ev.tiesuoUtilityToEngineRaw(1.2), 3, '10.16 recast utility 1.2 → engine raw 3');
    eq(ev.tiesuoUtilityToEngineRaw(2), 5, '10.16 普通单目标 utility 2 → engine raw 5');
    eq(ev.tiesuoUtilityToEngineRaw(4), 10, '10.16 双目标 utility 4 → engine raw 10');
    eq(ev.tiesuoUtilityToEngineRaw(100), 20, '10.16 极端 utility 经过 raw cap=20');

    /* 高价值双目标 → use，且返回完整 candidates */
    const E7 = P6('E7', -1);
    const resPair = ev.evaluateTiesuoActions(me6, {}, { candidates: [E6, E7], players: [E6, E7], relationOf: relationOf });
    eq(resPair.bestAction.type, 'use', '10.16 高价值双目标超过使用门槛 → use');
    eq(resPair.bestAction.targets.length, 2, '10.16 选中双目标');
    ok(resPair.candidates.length >= 4, '10.16 返回完整 candidates（重铸+单+双）');
    ok(resPair.candidates.every(function (a) { return typeof a.score === 'number'; }), '10.16 所有候选项均被评分');
    ok(resPair.candidates.some(function (a) { return a.type === 'recast'; }), '10.16 candidates 含 RECAST 候选');
    eq(typeof resPair.currentStateValue, 'number', '10.16 返回 currentStateValue');
    eq(typeof resPair.recastValue, 'number', '10.16 返回 recastValue');
}

/* ================= 10.17 engine 集成：bestAction 消费 evaluator（Task 7） =================
 * engine.js 对 tiesuo 不再走普通 targetScore → top1/top2，也不再写死「最多连 6 个」；
 * 改为调用 evaluateTiesuoActions，并在最终结果里消费 evaluator 的 targets / recast 类型。
 * 因 engine.js 依赖完整宿主挂载面（Node 下不可执行），沿用 §10.13 的源码守卫 + 策略行为断言。 */
{
    const fsSync = await import('node:fs');
    const engSrc = readDecisionSources();

    /* ---- 源码守卫：接入唯一权威源 ---- */
    ok(engSrc.indexOf('evaluateTiesuoActions') >= 0, '10.17 engine.js 调用 evaluateTiesuoActions');
    ok(/import\s*\{[^}]*evaluateTiesuoActions[^}]*tiesuoUtilityToEngineRaw[^}]*\}\s*from\s*['"][^'"]*tiesuoEvaluator\.js['"]/.test(engSrc),
        '10.17 engine.js 从 tiesuoEvaluator.js 导入 evaluator + utility 映射');
    ok(engSrc.indexOf('actScore = tiesuoUtilityToEngineRaw(tieUtility)') >= 0,
        '10.17 tiesuo use/recast 统一通过 utility→engine raw 映射');
    eq(engSrc.indexOf('actScore = (tieRes && typeof tieRes.recastValue') < 0, true,
        '10.17 删除 recast 直接塞 1.2、use 沿用普通 s 的尺度断层');

    /* ---- 源码守卫：旧 tiesuo 专用分支已删除 ---- */
    eq(engSrc.indexOf('picked.length >= 6') < 0, true, '10.17 旧「最多连 6 个敌人」分支已删除');
    eq(engSrc.indexOf('cands.sort(function (a, b) { return b.ts - a.ts; })') < 0, true,
        '10.17 旧「tsMap 降序选连目标」已删除');
    ok(engSrc.indexOf('_resolveCardCandidateTarget(me, id, cardDecisionCtx, bestT || null)') >= 0,
        '10.17 其他牌在评分前走统一候选目标解析，铁索仍由专用 evaluator 独立处理');

    /* ---- 源码守卫：recast 显式表达 + 消费 evaluator 目标 ---- */
    ok(engSrc.indexOf('best.target') >= 0, '10.17 _finalResult 消费 best.target');
    ok(/recast\s*:/.test(engSrc), '10.17 engine.js 显式表达 recast（不伪装成普通 use）');

    /* ---- 策略行为：方案 §13 决策范例 1-4 ---- */
    const ev17 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'cards', 'tiesuoEvaluator.js')).href);
    function mkP17(name, rel, linked, hp) {
        return { name: name, rel: rel, hp: hp == null ? 4 : hp, maxHp: 4, isLinked: function () { return !!linked; } };
    }
    const rel17 = function (mi, t) { return t.rel; };
    const me17 = mkP17('me', 1, false);

    /* 范例 1：只有一个普通敌人值得横置 → 收益不足门槛，优先重铸 */
    {
        const A1 = mkP17('A1', 1, false);
        const E1 = mkP17('E1', -1, true);
        const E2 = mkP17('E2', -1, false);
        const r = ev17.evaluateTiesuoActions(me17, {}, { candidates: [A1, E1, E2], players: [A1, E1, E2], relationOf: rel17 });
        eq(r.bestAction.type, 'recast', '10.17 范例1 单连普通敌人 ΔU=2 < 2.5 → RECAST');
    }

    /* 范例 2：A 已横置 + E1 已横置 + E2 未横置 → [A,E2] 最优（解队友 + 链新敌） */
    {
        const A2 = mkP17('A2', 1, true);
        const E1 = mkP17('E1', -1, true);
        const E2 = mkP17('E2', -1, false);
        const r = ev17.evaluateTiesuoActions(me17, {}, { candidates: [A2, E1, E2], players: [A2, E1, E2], relationOf: rel17 });
        eq(r.bestAction.type, 'use', '10.17 范例2 最佳动作为 use');
        eq(r.bestAction.targets.length, 2, '10.17 范例2 最佳为双目标');
        ok(r.bestAction.targets.indexOf(A2) >= 0 && r.bestAction.targets.indexOf(E2) >= 0,
            '10.17 范例2 最佳为 [解队友 A + 链新敌 E2]');
    }

    /* 范例 3：仅需救低血队友（敌方有属性威胁）→ [A] */
    {
        const A3 = mkP17('A3', 1, true, 1);
        const E1 = mkP17('E1', -1, true);
        const r = ev17.evaluateTiesuoActions(me17, {}, { candidates: [A3, E1], players: [A3, E1], relationOf: rel17, enemyAttrThreat: true });
        eq(r.bestAction.type, 'use', '10.17 范例3 最佳动作为 use');
        eq(r.bestAction.targets.length, 1, '10.17 范例3 单目标');
        eq(r.bestAction.targets[0], A3, '10.17 范例3 应解除低血队友 A');
    }

    /* 范例 4：无意义场面（敌人均已横置、队友未横置）→ RECAST */
    {
        const A4 = mkP17('A4', 1, false);
        const E1 = mkP17('E1', -1, true);
        const E2 = mkP17('E2', -1, true);
        const r = ev17.evaluateTiesuoActions(me17, {}, { candidates: [A4, E1, E2], players: [A4, E1, E2], relationOf: rel17 });
        eq(r.bestAction.type, 'recast', '10.17 范例4 无意义场面 → RECAST');
    }
}

/* ================= 10.18 aiOverride 对齐 recast（Task 8） =================
 * 当 engine 的 bestAction 显式标记 recast（铁索无意义 → 重铸）时，
 * aiOverride 不得再把 tiesuo 的 aiOrder 推到 100+ / 加 aiValue / 标 useful，
 * 否则原生 AI 只会优先"打出铁索"而非重铸，直接堵死宿主重铸路径。
 * aiOverride.js 依赖完整宿主挂载面，沿用源码守卫 + 纯谓词行为断言。 */
{
    const fsSync = await import('node:fs');
    const aoSrc = fsSync.readFileSync(join(_pkg, 'score', 'decision', 'safety', 'aiOverride.js'), 'utf8');

    /* ---- 纯谓词：显式导出，判据只认 recast === true ---- */
    ok(/export\s+function\s+isRecastRecommended\s*\(/.test(aoSrc),
        '10.18 aiOverride 导出纯谓词 isRecastRecommended');
    ok(/export\s+function\s+isRecastRecommended\s*\(\s*ba\s*\)\s*\{\s*return\s+!!\(\s*ba\s*&&\s*ba\.recast\s*===\s*true\s*\);\s*\}/.test(aoSrc),
        '10.18 isRecastRecommended 严格判定 recast === true');

    /* ---- 三处守卫：aiOrder / aiValue / useful 均在 recast 时短路 ---- */
    ok(aoSrc.indexOf('isRecastRecommended(ba)') >= 0, '10.18 aiOrder/aiValue/useful 调用 isRecastRecommended');
    ok(/isRecastRecommended\(ba\)\)\s*\{\s*return num;/.test(aoSrc),
        '10.18 recast 时 aiValue 短路返回 num（不额外加价值）');
    /* ★ 用户实测「无意义也不重铸」→ 仅「不推高」不足以让位：宿主 _recasting 技能 order=6，
     * 必须主动把铁索自身使用顺序压到 6 以下，重铸才会真正发生。 */
    ok(aoSrc.indexOf('Math.min(num, 5)') >= 0,
        '10.18 recast 时 aiOrder 主动让出顺序（< 宿主 _recasting 的 order 6）');
    ok(/isRecastRecommended\(ba\)\)\s*\{\s*return;/.test(aoSrc),
        '10.18 recast 时 useful 短路返回（不标为值得用）');

    /* ---- 行为：谓词真值表 ---- */
    const ao = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'safety', 'aiOverride.js')).href);
    const g18 = function (x) { return (typeof ao.isRecastRecommended === 'function') ? ao.isRecastRecommended(x) : '<missing>'; };
    eq(typeof ao.isRecastRecommended, 'function', '10.18 isRecastRecommended 可被 import');
    eq(g18({ recast: true }), true, '10.18 {recast:true} → true');
    eq(g18({ recast: false }), false, '10.18 {recast:false} → false');
    eq(g18({ recast: 1 }), false, '10.18 recast 非严格 true → false');
    eq(g18({}), false, '10.18 无 recast 字段 → false');
    eq(g18(null), false, '10.18 null → false');
    eq(g18(undefined), false, '10.18 undefined → false');

    /* ---- 端到端：evaluator 判 recast 的场面，经 engine 口径映射后谓词必命中 ---- */
    const ev18 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'cards', 'tiesuoEvaluator.js')).href);
    function mkP18(name, rel, linked) {
        return { name: name, rel: rel, hp: 4, maxHp: 4, isLinked: function () { return !!linked; } };
    }
    const A18 = mkP18('A18', 1, false), E18a = mkP18('E18a', -1, true), E18b = mkP18('E18b', -1, true);
    const r18 = ev18.evaluateTiesuoActions(mkP18('me', 1, false), {},
        { candidates: [A18, E18a, E18b], players: [A18, E18a, E18b], relationOf: function (mi, t) { return t.rel; } });
    eq(r18.bestAction.type, 'recast', '10.18 无意义场面 evaluator 判 recast');
    const ba18 = {
        rule: 'tiesuo',
        recast: r18.bestAction.type === 'recast',
        target: (r18.bestAction.type === 'use') ? r18.bestAction.targets.map(function (p) { return p.name; }) : null,
    };
    eq(g18(ba18), true, '10.18 engine「recast→ba.recast=true」口径被谓词识别');
    eq(g18({ rule: 'tiesuo', recast: false, target: ['E1'] }), false, '10.18 正常使用（recast=false）不被误判为重铸');
}

/* ================= 10.19 收敛 legacy 铁索启发（Task 9） =================
 * 铁索的最终「使用 / 重铸」只能由 tiesuoEvaluator 唯一决定：
 *  - cardPlayBrain 不再有 tiesuo 专用优先级 / canChainEnemies / isLinking；
 *  - engine.applyBasicCardPlayRules 跳过 tiesuo（不施加通用优先级倾斜），
 *    并向 evaluator 传入属性机会 modifier（复用 threat.linkedChainValue）；
 *  - optimization.js / threat.js 的横置状态读取收敛到 isPlayerLinked；
 *  - damageTransfer 的 tiesuoTiming / tiesuoBonus 第三套使用价值被删除。 */
{
    const fsSync = await import('node:fs');
    const cpbSrc = fsSync.readFileSync(join(_pkg, 'score', 'decision', 'cardplay', 'cardPlayBrain.js'), 'utf8');
    const engSrc = readDecisionSources();
    const optSrc = fsSync.readFileSync(join(_pkg, 'js', 'content', 'optimization.js'), 'utf8');
    const dtSrc  = fsSync.readFileSync(join(_pkg, 'score', 'decision', 'safety', 'damageTransfer.js'), 'utf8');
    const thSrc  = fsSync.readFileSync(join(_pkg, 'score', 'decision', 'threat', 'threat.js'), 'utf8');

    /* ---- cardPlayBrain：无第二套最终 tiesuo policy ---- */
    eq(cpbSrc.indexOf('canChainEnemies') < 0, true, '10.19 cardPlayBrain 删除 canChainEnemies');
    eq(cpbSrc.indexOf('isLinking') < 0, true, '10.19 cardPlayBrain 不再读取自造 isLinking 字段');
    ok(!/if\s*\(\s*id\s*===\s*'tiesuo'\s*\)\s*return/.test(cpbSrc), '10.19 cardPlayBrain 删除 tiesuo 专用 basePriority');
    ok(!/else\s+if\s*\(\s*id\s*===\s*'tiesuo'\s*\)/.test(cpbSrc), '10.19 cardPlayBrain 删除 tiesuo 专用 pickTarget 分支');

    /* ---- engine：基本出牌规则跳过 tiesuo + 属性机会 modifier + 不再自造 isLinking ---- */
    ok(/a\.id\s*===\s*'tiesuo'\)\s*return;/.test(engSrc), '10.19 engine.applyBasicCardPlayRules 跳过 tiesuo（唯一权威=evaluator）');
    eq(engSrc.indexOf('isLinking:') < 0, true, '10.19 engine.js 删除自造 ctx.isLinking 字段');
    ok(engSrc.indexOf('hasOurAttr') >= 0 && engSrc.indexOf('enemyAttrThreat') >= 0, '10.19 engine 向 evaluator 传入属性机会 modifier');
    ok(/import\s*\{[^}]*linkedChainValue[^}]*\}\s*from\s*['"][^'"]*threat\.js['"]/.test(engSrc), '10.19 engine 导入 threat.linkedChainValue 计算属性机会');

    /* ---- optimization：横置读取收敛到 helper ---- */
    ok(/import\s*\{[^}]*isPlayerLinked[^}]*\}\s*from\s*['"][^'"]*playerState\.js['"]/.test(optSrc), '10.19 optimization 导入 isPlayerLinked');
    eq(optSrc.indexOf('.isLinked()') < 0, true, '10.19 optimization 不再直接调用 .isLinked()');
    eq(optSrc.indexOf('.isLinked ') < 0 && optSrc.indexOf('.isLinked||') < 0 && optSrc.indexOf('.isLinked)') < 0, true, '10.19 optimization 不再把 .isLinked 当属性直读');

    /* ---- threat：linkedChainValue 收敛到 helper ---- */
    ok(/import\s*\{[^}]*isPlayerLinked[^}]*\}\s*from\s*['"][^'"]*playerState\.js['"]/.test(thSrc), '10.19 threat 导入 isPlayerLinked');
    eq(thSrc.indexOf('target.isLinked') < 0, true, '10.19 threat.linkedChainValue 不再直接 target.isLinked');
    eq(/[^a-zA-Z]p\.isLinked\b/.test(thSrc), false, '10.19 threat.linkedChainValue 不再直接 p.isLinked');

    /* ---- damageTransfer：删除第三套铁索使用价值 ---- */
    eq(dtSrc.indexOf('tiesuoTiming') < 0, true, '10.19 damageTransfer 删除 tiesuoTiming');
    eq(dtSrc.indexOf('tiesuoBonus') < 0, true, '10.19 damageTransfer 删除 tiesuoBonus');
    const dt = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'safety', 'damageTransfer.js')).href);
    eq(typeof dt.countTiesuo, 'function', '10.19 damageTransfer 仍保留 countTiesuo');
    eq(typeof dt.tiesuoTiming, 'undefined', '10.19 tiesuoTiming 不再导出');
    eq(typeof dt.tiesuoBonus, 'undefined', '10.19 tiesuoBonus 不再导出');

    /* ---- cardPlayBrain 行为：tiesuo 不再有特殊优先级 ---- */
    const cpb = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'cardplay', 'cardPlayBrain.js')).href);
    eq(cpb.classifyCard('tiesuo'), 'control', '10.19 tiesuo 分类仍为 control（分类保留）');
    const ctx19 = { me: { hp: 4 }, targets: [{ isAlly: false, hp: 4, threat: 3, isLinking: false }, { isAlly: false, hp: 4, threat: 3, isLinking: false }] };
    eq(cpb.basePriority('tiesuo', ctx19), 60, '10.19 tiesuo 不再有专用优先级，落回 control 默认 60');

    /* ---- threat.linkedChainValue 仍可 import（收敛未破坏模块） ---- */
    const th = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'threat', 'threat.js')).href);
    eq(typeof th.linkedChainValue, 'function', '10.19 threat.linkedChainValue 仍导出且可 import');
}

/* ================= 10.20 铁索宿主侧收敛：result.target / basic.order 读 evaluator =================
 * 根因（用户实测「残局还会单连」）：
 *   optimization.js 的宿主原生铁索 result.target 仍保留旧启发
 *     「同阵营可连人数 < 2 → return 0」（es < 2 / fs < 2），
 *   在残局（1 队友 + 1 敌人）会把两个目标都判 0 → 宿主选不出/只选单目标；
 *   同时 basic.order / useful 恒高，使「重铸」永远输给「使用」。
 * 修复：宿主侧必须消费 evaluator 唯一权威结论（hostTiesuoDecision / hostTiesuoTargetEffect）。 */
{
    const fsSync = await import('node:fs');
    const optSrc = fsSync.readFileSync(join(_pkg, 'js', 'content', 'optimization.js'), 'utf8');
    const ev20 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'cards', 'tiesuoEvaluator.js')).href);
    const relOf20 = function (mi, t) { return t.rel; };
    function mkP20(name, rel, linked, hp) {
        return { name: name, rel: rel, hp: hp == null ? 4 : hp, maxHp: 4, isLinked: function () { return !!linked; } };
    }
    const me20 = mkP20('me20', 1, false);

    /* ---- 源码守卫：宿主侧接入 evaluator、删除旧启发 ---- */
    ok(/import\s*\{[^}]*hostTiesuoDecision[^}]*\}\s*from\s*['"][^'"]*tiesuoEvaluator\.js['"]/.test(optSrc),
        '10.20 optimization 导入 hostTiesuoDecision（宿主侧收敛到 evaluator）');
    eq(optSrc.indexOf('es < 2') < 0, true, '10.20 optimization 删除 es<2 旧启发');
    eq(optSrc.indexOf('fs < 2') < 0, true, '10.20 optimization 删除 fs<2 旧启发');
    eq(optSrc.indexOf('ui.selected.targets.length') < 0, true, '10.20 optimization 删除旧双目标分支');

    const dFn = (typeof ev20.hostTiesuoDecision === 'function') ? ev20.hostTiesuoDecision : function () { return { use: false, targets: [] }; };
    const eFn = (typeof ev20.hostTiesuoTargetEffect === 'function') ? ev20.hostTiesuoTargetEffect : function () { return 0; };

    /* ---- hostTiesuoDecision：与 evaluator 主入口结论一致 ---- */
    {
        const A = mkP20('A', 1, true), E = mkP20('E', -1, false);
        const d = dFn(me20, [me20, A, E], { relationOf: relOf20 });
        eq(d.use, true, '10.20 [A linked, E unlinked] → use');
        eq(Array.isArray(d.targets) && d.targets.length, 2, '10.20 [A linked, E unlinked] → 双目标（解队友+链敌人）');
        ok(d.targets.indexOf(A) >= 0 && d.targets.indexOf(E) >= 0, '10.20 目标 = [A, E]');
    }
    {
        const A = mkP20('A', 1, true), E = mkP20('E', -1, true);
        const d = dFn(me20, [me20, A, E], { relationOf: relOf20 });
        eq(d.use, false, '10.20 [普通A linked, E linked] → 单解收益不足门槛 → recast');
        eq(d.targets.length, 0, '10.20 普通单解队友不强行 use');
    }
    {
        const A = mkP20('A_low', 1, true, 1), E = mkP20('E', -1, true);
        const d = dFn(me20, [me20, A, E], { relationOf: relOf20, enemyAttrThreat: true });
        eq(d.use, true, '10.20 [危险残血A linked, E linked] → 单解达到门槛 → use');
        eq(d.targets.length, 1, '10.20 危险残血队友允许单目标解除');
        eq(d.targets[0], A, '10.20 解除危险残血队友 A');
    }
    {
        const A = mkP20('A', 1, false), E = mkP20('E', -1, true);
        eq(dFn(me20, [me20, A, E], { relationOf: relOf20 }).use, false, '10.20 [A unlinked, E linked] → 无意义 → recast');
    }

    /* ---- hostTiesuoTargetEffect：方向遵循宿主约定（已横置→正，未横置→负；未选中→0） ---- */
    {
        const A = mkP20('A', 1, true), E = mkP20('E', -1, false);
        const ea = eFn(me20, A, [me20, A, E], { relationOf: relOf20 });
        const ee = eFn(me20, E, [me20, A, E], { relationOf: relOf20 });
        ok(typeof ea === 'number' && ea > 0, '10.20 选中且已横置的队友 A → 正 effect（解除队友）');
        ok(typeof ee === 'number' && ee < 0, '10.20 选中且未横置的敌人 E → 负 effect（横置敌人）');
    }
    {
        /* evaluator 判 recast 时任何目标都不得获得正 effect（宿主不得使用铁索） */
        const A = mkP20('A', 1, false), E = mkP20('E', -1, true);
        eq(eFn(me20, A, [me20, A, E], { relationOf: relOf20 }), 0, '10.20 recast 场面：队友 A effect=0');
        eq(eFn(me20, E, [me20, A, E], { relationOf: relOf20 }), 0, '10.20 recast 场面：敌人 E effect=0');
    }
}

/* ================= 10.21 无懈可击 evaluator：上下文解析 + 效果估值 + 资源成本 + parity（指令 03） =================
 * 目标：建立唯一权威无懈策略源，解决「顺手/拆桥不打、队友乐不打、最后一张捏死、反无懈不会判断」。
 * 全部为纯函数测试，通过 context 注入确证事实（relationOf / wuxieCount）。 */
{
    const fx = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'response', 'wuxieEvaluator.js')).href);
    eq(typeof fx.resolveWuxieContext, 'function', '10.21 导出 resolveWuxieContext');
    eq(typeof fx.evaluateTrickEffect, 'function', '10.21 导出 evaluateTrickEffect');
    eq(typeof fx.estimateWuxieResourceCost, 'function', '10.21 导出 estimateWuxieResourceCost');
    eq(typeof fx.evaluateWuxie, 'function', '10.21 导出 evaluateWuxie');
    eq(typeof fx.shouldUseWuxie, 'function', '10.21 导出 shouldUseWuxie');

    /* ---- 玩家桩：rel +1 友 / -1 敌 / 0 中性；可注入手牌/装备/判定区 ---- */
    function mkP(name, rel, opts) {
        opts = opts || {};
        return {
            name: name, rel: rel,
            hp: opts.hp == null ? 4 : opts.hp, maxHp: 4,
            _h: opts.h == null ? 0 : opts.h,
            _e: opts.e || [], _j: opts.j || [],
            countCards: function (a) { return a === 'h' ? this._h : 0; },
            getCards: function (a) { return a === 'e' ? this._e : (a === 'j' ? this._j : []); },
        };
    }
    const relOf = function (mi, t) { return t.rel; };
    const me = mkP('me', 1, { h: 3 });
    const ally = mkP('ally', 1, { h: 2 });
    const enemy = mkP('enemy', -1, { h: 2 });
    const C = function (id) { return { name: id }; };

    /* ---- Task 2：context resolver ---- */
    function trickEvent(cardName, src, tgt, parent) {
        return { name: cardName, _trigger: { card: { name: cardName }, player: src, target: tgt }, getParent: function () { return parent || null; } };
    }
    function respondEvent(parent) {
        return { name: 'chooseToRespond', _trigger: {}, card: null, getParent: function () { return parent || null; } };
    }
    {
        const ctx = fx.resolveWuxieContext(me, respondEvent(trickEvent('lebu', enemy, ally)), {});
        eq(ctx.resolved, true, '10.21 lebu 场景可解析');
        eq(ctx.originalSpellId, 'lebu', '10.21 解析出原始锦囊 lebu');
        eq(ctx.source, enemy, '10.21 解析出来源 enemy');
        eq(ctx.target, ally, '10.21 解析出受害目标 ally');
        eq(ctx.chainDepth, 0, '10.21 无无懈链 → depth=0');
    }
    {
        /* host 形态：事件本身携带 card/player/target（非 _trigger） */
        const ev = { name: 'guohe', card: { name: 'guohe' }, player: enemy, target: ally, getParent: function () { return null; } };
        const ctx = fx.resolveWuxieContext(me, ev, {});
        eq(ctx.originalSpellId, 'guohe', '10.21 host 形态事件解析 guohe');
        eq(ctx.target, ally, '10.21 host 形态解析目标');
    }
    {
        const ctx = fx.resolveWuxieContext(me, respondEvent(trickEvent('shunshou', enemy, ally)), {});
        eq(ctx.originalSpellId, 'shunshou', '10.21 解析 shunshou');
    }
    {
        /* 反无懈链：current → 敌无懈 → 我无懈 → 原始 lebu */
        const lebuEv = trickEvent('lebu', enemy, ally);
        const w1 = trickEvent('wuxie', me, null, lebuEv);
        const w2 = trickEvent('wuxie', enemy, null, w1);
        const ctx = fx.resolveWuxieContext(me, respondEvent(w2), {});
        eq(ctx.originalSpellId, 'lebu', '10.21 反无懈链仍追到原始锦囊 lebu');
        eq(ctx.target, ally, '10.21 反无懈链不丢失受害目标');
        eq(ctx.chainDepth, 2, '10.21 反无懈链 depth=2');
    }
    {
        const ctx = fx.resolveWuxieContext(me, respondEvent(null), {});
        eq(ctx.resolved, false, '10.21 无法解析 → resolved=false（fail-open）');
    }

    /* ---- Task 3：relation-aware trick effect ---- */
    const ectx = { relationOf: relOf };
    function eff(player, id, tgt, src) {
        return fx.evaluateTrickEffect(player, { originalSpellId: id, target: tgt, source: src }, ectx);
    }
    ok(eff(me, 'lebu', me) < -5, '10.21 自己中乐 → 强负收益');
    ok(eff(me, 'lebu', ally) < -4, '10.21 队友中乐 → 强负收益');
    ok(eff(me, 'lebu', enemy) > 0, '10.21 敌人中乐 → 正收益（不该无懈）');
    ok(eff(me, 'bingliang', ally) < -4, '10.21 队友中兵粮 → 强负收益');
    eq(eff(me, 'lebu', null), 0, '10.21 目标未知 → 保守中性');

    /* ---- Task 4/5：顺手 / 过河估值 ---- */
    {
        const lowAlly = mkP('lowAlly', 1, { h: 1 });
        ok(eff(me, 'shunshou', lowAlly) > -3, '10.21 顺手低价值队友 → 收益有限（可保留）');
        const equipAlly = mkP('equipAlly', 1, { h: 0, e: [C('bagua')] });
        ok(eff(me, 'shunshou', equipAlly) < -3, '10.21 顺手关键装备 → 高保护价值');
        const dyingAlly = mkP('dyingAlly', 1, { h: 1, hp: 1 });
        ok(eff(me, 'shunshou', dyingAlly) < -3, '10.21 顺手低血队友关键手牌 → 高保护价值');
        ok(eff(me, 'guohe', equipAlly) < -2.5, '10.21 拆队友关键装备 → 保护价值');
        const normalAlly = mkP('normalAlly', 1, { h: 0, e: [C('horses')] });
        ok(eff(me, 'guohe', normalAlly) > -2.5, '10.21 拆队友普通装备 → 价值有限');
        const judgeAlly = mkP('judgeAlly', 1, { h: 0, j: [C('lebu')] });
        ok(eff(me, 'guohe', judgeAlly) > 0, '10.21 拆队友判定区乐 → 反而帮队友，不无懈');
        const judgeAlly2 = mkP('judgeAlly2', 1, { h: 0, j: [C('bingliang')] });
        ok(eff(me, 'guohe', judgeAlly2) > 0, '10.21 拆队友判定区兵粮 → 不无懈');
        const judgeAlly3 = mkP('judgeAlly3', 1, { h: 0, j: [C('shandian')] });
        ok(eff(me, 'guohe', judgeAlly3) > 0, '10.21 拆队友判定区闪电 → 不无懈（帮队友）');
    }

    /* ---- 延时锦囊分类：兵/乐/闪电三者同族（判定区） ---- */
    ok(eff(me, 'shandian', me) < -4, '10.21 自己判定区闪电 → 强负收益（应无懈）');
    ok(eff(me, 'shandian', ally) < -4, '10.21 队友判定区闪电 → 强负收益');
    ok(eff(me, 'shandian', enemy) > 0, '10.21 敌人判定区闪电 → 正收益（不无懈）');
    {
        const ctxSd = fx.resolveWuxieContext(me, null, { originalSpellId: 'shandian', source: ally });
        eq(ctxSd.resolved, true, '10.21 闪电无独立目标 → 以使用者为受害者并解析');
        eq(ctxSd.target, ally, '10.21 闪电受害者 = 判定区持有者');
    }

    /* ---- Task 6：资源成本（soft，永不 veto） ---- */
    {
        const c1 = fx.estimateWuxieResourceCost(me, { wuxieCount: 1 });
        const c2 = fx.estimateWuxieResourceCost(me, { wuxieCount: 2 });
        ok(c2 < c1, '10.21 2 张无懈成本 < 最后 1 张');
        const lowHand = mkP('lowHand', 1, { h: 1 });
        ok(fx.estimateWuxieResourceCost(lowHand, { wuxieCount: 1 }) > c1, '10.21 手牌低 → 成本升高');
        ok(Number.isFinite(c1) && c1 > 0, '10.21 资源成本始终有限正数（非 veto）');
    }

    /* ---- Task 7/8：evaluateWuxie 验收矩阵 R1–R12 ---- */
    function dec(player, ctx) {
        return fx.evaluateWuxie(player, null, Object.assign({ relationOf: relOf, wuxieCount: 2 }, ctx || {}));
    }
    /* R1：敌人乐队友 → 高优先无懈 */
    eq(dec(me, { originalSpellId: 'lebu', source: enemy, target: ally }).use, true, '10.21 R1 敌人乐队友 → use');
    /* R12：最后一张无懈 + 队友乐 → 仍使用 */
    eq(dec(me, { originalSpellId: 'lebu', source: enemy, target: ally, wuxieCount: 1 }).use, true, '10.21 R12 最后一张无懈 + 队友乐 → 仍 use');
    /* R2：敌人兵粮低手牌队友 → 使用 */
    eq(dec(me, { originalSpellId: 'bingliang', source: enemy, target: mkP('lowAlly2', 1, { h: 1 }) }).use, true, '10.21 R2 敌人兵粮低手牌队友 → use');
    /* R3：敌人顺手队友普通低价值牌 → 可保留 */
    eq(dec(me, { originalSpellId: 'shunshou', source: enemy, target: mkP('lowAlly3', 1, { h: 1 }), wuxieCount: 1 }).use, false, '10.21 R3 顺手普通低价值队友 → hold');
    /* R4：敌人顺手队友关键装备 → 使用 */
    eq(dec(me, { originalSpellId: 'shunshou', source: enemy, target: mkP('eqAlly', 1, { h: 0, e: [C('bagua')] }) }).use, true, '10.21 R4 顺手关键装备 → use');
    /* R5：敌人拆队友关键装备 → 使用 */
    eq(dec(me, { originalSpellId: 'guohe', source: enemy, target: mkP('eqAlly2', 1, { h: 0, e: [C('bagua')] }), wuxieCount: 1 }).use, true, '10.21 R5 拆关键装备 → use');
    /* R6/R7：敌人拆队友判定区乐/兵粮 → 不无懈 */
    eq(dec(me, { originalSpellId: 'guohe', source: enemy, target: mkP('jAlly', 1, { h: 0, j: [C('lebu')] }) }).use, false, '10.21 R6 拆判定区乐 → hold');
    eq(dec(me, { originalSpellId: 'guohe', source: enemy, target: mkP('jAlly2', 1, { h: 0, j: [C('bingliang')] }) }).use, false, '10.21 R7 拆判定区兵粮 → hold');
    /* R8：自己中乐 → 使用 */
    eq(dec(me, { originalSpellId: 'lebu', source: enemy, target: me, wuxieCount: 1 }).use, true, '10.21 R8 自己中乐 → use');
    /* R9：敌人对敌人乐 → 不无懈 */
    eq(dec(me, { originalSpellId: 'lebu', source: enemy, target: mkP('enemy2', -1, { h: 2 }) }).use, false, '10.21 R9 敌人对敌人乐 → hold');
    /* R9b：延时锦囊同族（闪电）——队友判定区 → use；敌人判定区 → hold；拆队友判定区闪电 → hold */
    eq(dec(me, { originalSpellId: 'shandian', source: ally, target: ally, wuxieCount: 1 }).use, true, '10.21 R9b 队友判定区闪电 → use');
    eq(dec(me, { originalSpellId: 'shandian', source: enemy, target: enemy }).use, false, '10.21 R9b 敌人判定区闪电 → hold');
    eq(dec(me, { originalSpellId: 'guohe', source: enemy, target: mkP('jAlly3', 1, { h: 0, j: [C('shandian')] }) }).use, false, '10.21 R9b 拆队友判定区闪电 → hold');
    /* R11：上下文解析失败 → use=null（fail-open） */
    eq(fx.evaluateWuxie(me, respondEvent(null), {}).use, null, '10.21 R11 无法解析 → use=null');
    eq(fx.shouldUseWuxie(me, respondEvent(null), {}), null, '10.21 R11 shouldUseWuxie → null');
    /* R10：反无懈 parity（0/1/2/3 层 + AI 再出一张 flip） */
    {
        const base = { originalSpellId: 'lebu', source: enemy, target: ally, relationOf: relOf, wuxieCount: 2 };
        const p0 = fx.evaluateWuxie(me, null, Object.assign({}, base, { chainDepth: 0 }));
        const p1 = fx.evaluateWuxie(me, null, Object.assign({}, base, { chainDepth: 1 }));
        const p2 = fx.evaluateWuxie(me, null, Object.assign({}, base, { chainDepth: 2 }));
        const p3 = fx.evaluateWuxie(me, null, Object.assign({}, base, { chainDepth: 3 }));
        eq(p0.finalStateIfPass, 'resolve', '10.21 R10 depth0 → 原锦囊生效');
        eq(p1.finalStateIfPass, 'negate', '10.21 R10 depth1 → 原锦囊失效');
        eq(p2.finalStateIfPass, 'resolve', '10.21 R10 depth2 → 原锦囊生效');
        eq(p3.finalStateIfPass, 'negate', '10.21 R10 depth3 → 原锦囊失效');
        eq(p1.finalStateIfUse, 'resolve', '10.21 R10 depth1 再出无懈 → flip 为生效');
        eq(p0.use, true, '10.21 R10 depth0 有害锦囊 → use（使原锦囊失效）');
        eq(p1.use, false, '10.21 R10 depth1 原锦囊已被无懈 → hold（不应再翻转）');
        eq(p2.use, true, '10.21 R10 depth2 → 再出无懈 use');
        /* 诊断写入 _status.djsc_lastWuxie */
        eq(p2.originalSpellId, 'lebu', '10.21 反无懈不丢失 originalSpellId');
    }
}

/* ================= 10.22 无懈集成回归：唯一权威 evaluator + fail-open + 旧逻辑退役 =================
 * 根因：respond.js / respondBrain.js / responseAI.js / wuxieTiming.js / resourceManage.js
 *   各自维护第二套 critical/harmful 名单与「最后一张无懈」硬否决，互相冲突。
 * 修复：所有最终 use/hold 统一消费 wuxieEvaluator；unresolved 必须 fail-open。 */
{
    const fsSync = await import('node:fs');
    const respSrc = fsSync.readFileSync(join(_pkg, 'score', 'decision', 'override', 'respond.js'), 'utf8');
    const brainSrc = fsSync.readFileSync(join(_pkg, 'score', 'decision', 'basic', 'respondBrain.js'), 'utf8');
    const raiSrc = fsSync.readFileSync(join(_pkg, 'score', 'decision', 'response', 'responseAI.js'), 'utf8');
    const wtSrc = fsSync.readFileSync(join(_pkg, 'score', 'decision', 'timing', 'wuxieTiming.js'), 'utf8');
    const rmSrc = fsSync.readFileSync(join(_pkg, 'score', 'decision', 'resource', 'resourceManage.js'), 'utf8');

    /* ---- 源码守卫：统一消费 evaluator ---- */
    ok(/import\s*\{[^}]*shouldUseWuxie[^}]*\}\s*from\s*['"][^'"]*wuxieEvaluator\.js['"]/.test(respSrc),
        '10.22 respond.js 从 wuxieEvaluator 导入 shouldUseWuxie');
    ok(/wuxieEvaluator\.js/.test(raiSrc), '10.22 responseAI.js 接入 wuxieEvaluator');
    ok(/import\s*\{[^}]*evaluateWuxie[^}]*\}\s*from\s*['"][^'"]*wuxieEvaluator\.js['"]/.test(wtSrc),
        '10.22 wuxieTiming.js 委托 evaluateWuxie');
    ok(/wuxieEvaluator\.js/.test(rmSrc), '10.22 resourceManage.js 接入 wuxieEvaluator');

    /* ---- 旧逻辑退役：第二套名单 / 最后一张硬否决 / 旧 harmful 数组 ---- */
    eq(respSrc.indexOf('wxCount >= 2') < 0, true, '10.22 respond.js 删除「wxCount>=2」硬政策');
    eq(respSrc.indexOf("'zhujin'") < 0, true, '10.22 respond.js 删除第二套 harmful 名单');
    eq(raiSrc.indexOf('CRITICAL_TRICKS') < 0, true, '10.22 responseAI.js 删除 CRITICAL_TRICKS');
    eq(wtSrc.indexOf('CRITICAL_SPELLS') < 0, true, '10.22 wuxieTiming.js 删除本地 CRITICAL_SPELLS');
    eq(rmSrc.indexOf('juedou') < 0, true, '10.22 resourceManage.wuxieTiming 不再自维护锦囊名单');
    ok(brainSrc.indexOf('ev.wuxieUse') >= 0, '10.22 respondBrain 消费注入的 ev.wuxieUse');
    eq(brainSrc.indexOf("!key && wxCount") < 0, true, '10.22 respondBrain 删除「非关键锦囊留底牌」硬否决');

    /* ---- 行为：respondBrain 无懈否决只由 wuxieUse 决定；null fail-open ---- */
    const rb = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'basic', 'respondBrain.js')).href);
    eq(rb.decideRespond('wuxie', { me: {}, event: { wuxieUse: false } }).veto, true, '10.22 wuxieUse=false → veto（保留）');
    eq(rb.decideRespond('wuxie', { me: {}, event: { wuxieUse: true } }).veto, false, '10.22 wuxieUse=true → 不 veto');
    eq(rb.decideRespond('wuxie', { me: {}, event: { wuxieUse: null } }).veto, false, '10.22 wuxieUse=null → fail-open 不 veto');
    eq(rb.decideRespond('wuxie', { me: {}, event: {} }).veto, false, '10.22 缺失 wuxieUse → fail-open 不 veto');

    /* ---- 行为：wrapper 与 evaluator 结论一致 ---- */
    const wt = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'timing', 'wuxieTiming.js')).href);
    const meP = { name: 'meP', hp: 4, maxHp: 4, countCards: function () { return 3; }, getCards: function () { return []; } };
    eq(wt.wuxieTiming(meP, meP, 'lebu').use, true, '10.22 wrapper：自己中乐 → use');
    eq(wt.wuxieTiming(meP, null, 'guohe').use, null, '10.22 wrapper：缺少目标 → use=null（结构化 fail-open）');
    eq(wt.wuxieTiming(meP, null, 'guohe').resolved, false, '10.22 wrapper：缺少目标 → resolved=false');
    eq(wt.wuxieBonus(meP, { id: 'wuxie' }), 1.0, '10.22 wuxieBonus 上下文缺失 → 中性 1.0（不得因中文 reason 误降权）');
    eq(wt.wuxieBonus(meP, { id: 'sha' }), 1.0, '10.22 wuxieBonus 非无懈 → 1.0');
}

/* ================= 10.23 回合内动作一致性：状态新鲜度 + 自我抵消软惩罚（指令 04） =================
 * 根因分两类：
 *   A. State Freshness：缓存指纹 makeStateKey() 不含判定区/装备，且 _lastBestAction 100ms
 *      缓存不受 checkStateChanged() 影响 → 挂乐/兵后下一步可能看不到新控制状态；
 *   B. Action Consistency：顺/拆会把刚建立、仍在判定区生效的乐/兵破坏掉（自我抵消），
 *      原实现只有「判定区有任意延时牌 → ×0.4」的粗暴同目标降权（指令明令禁止）。
 * 修复：① 指纹纳入各存活角色判定区/装备；② 唯一权威 turnStrategicState，
 *      FinalScore = DirectValue − soft 自我抵消惩罚（语义与无懈方案共享）。 */
{
    /* 先尝试导入被测模块：缺失时记为失败而非中断整套测试 */
    let tss = null;
    try {
        tss = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'state', 'turnStrategicState.js')).href);
    } catch (e) {
        ok(false, '10.23 turnStrategicState 模块存在且可导入', String(e && e.message));
    }
    const cache = await import(pathToFileURL(join(_pkg, 'score', 'foundation', 'storage', 'cache.js')).href);
    const wx = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'response', 'wuxieEvaluator.js')).href);

    /* ---- 玩家桩：rel +1 友 / -1 敌；可注入手牌/装备/判定区 ---- */
    function mkP23(name, rel, opts) {
        opts = opts || {};
        return {
            name: name, rel: rel, alive: true,
            hp: opts.hp == null ? 4 : opts.hp, maxHp: 4,
            _h: opts.h == null ? 2 : opts.h, _j: opts.j || [], _e: opts.e || [],
            countCards: function (a) { return a === 'h' ? this._h : 0; },
            getCards: function (a) { return a === 'e' ? this._e : (a === 'j' ? this._j : []); },
        };
    }
    const C23 = function (id) { return { name: id }; };
    const rctx = { relationOf: function (mi, t) { return t.rel; } };
    const me23 = mkP23('me23', 1, { h: 3 });

    if (tss) {
        ['getJudgeCardNames', 'hasDelayedControl', 'delayedControlIdsIn',
         'evaluateDestroyPenalty', 'selfCreatedDestructionPenalty',
         'recordControlState', 'recordSelfCreatedControl', 'getControlRecords', 'clearTurnState'].forEach(function (fn) {
            eq(typeof tss[fn], 'function', '10.23 导出 ' + fn);
        });

        /* ---- 共享语义：不得第二套判定区语义 ---- */
        eq(typeof wx.delayedControlValue, 'function', '10.23 wuxieEvaluator 导出共享 delayedControlValue');
        {
            const src23 = (await import('node:fs')).readFileSync(join(_pkg, 'score', 'decision', 'state', 'turnStrategicState.js'), 'utf8');
            ok(/wuxieEvaluator\.js/.test(src23), '10.23 turnStrategicState 复用 wuxieEvaluator 语义（不另写一套）');
        }

        /* ---- Judge-zone 读取：兵/乐/闪电同族，且关系感知 ---- */
        eq(tss.hasDelayedControl(mkP23('e', -1, { j: [C23('lebu')] })), true, '10.23 判定区乐 → hasDelayedControl');
        eq(tss.hasDelayedControl(mkP23('e', -1, { j: [C23('shandian')] })), true, '10.23 判定区闪电 → 同族');
        eq(tss.hasDelayedControl(mkP23('e', -1, { j: [] })), false, '10.23 无判定牌 → false');

        /* ---- B② 先乐 → 后过河降权；先兵 → 后顺手降权 ---- */
        {
            const eLebu = mkP23('eLebu', -1, { j: [C23('lebu')] });
            const eBing = mkP23('eBing', -1, { j: [C23('bingliang')] });
            const penLebu = tss.selfCreatedDestructionPenalty(me23, eLebu, rctx);
            const penBing = tss.selfCreatedDestructionPenalty(me23, eBing, rctx);
            ok(penLebu > 3, '10.23 先乐→后过河：敌方判定区乐 → 降权 > 3（got ' + penLebu + '）');
            ok(penBing > 3, '10.23 先兵→后顺手：敌方判定区兵粮 → 降权 > 3（got ' + penBing + '）');
            const eShan = mkP23('eShan', -1, { j: [C23('shandian')] });
            ok(tss.selfCreatedDestructionPenalty(me23, eShan, rctx) > 0, '10.23 敌方判定区闪电 → 同样降权（同族）');
        }

        /* ---- 无控制状态 → penalty=0（先顺装备后挂乐 / 先拆装备后挂兵 允许） ---- */
        {
            const eEquip = mkP23('eEquip', -1, { j: [], e: [C23('bagua')] });
            eq(tss.selfCreatedDestructionPenalty(me23, eEquip, rctx), 0, '10.23 先顺高价值装备→后挂乐：先前顺无惩罚');
            eq(tss.hasDelayedControl(eEquip), false, '10.23 装备不等于延时控制（不做同目标降权）');
            eq(tss.selfCreatedDestructionPenalty(me23, mkP23('eNo', -1, { j: [] }), rctx), 0, '10.23 无判定区延时 → penalty=0');
        }

        /* ---- 高收益可覆盖低价值旧状态：soft，不是 hard ban ---- */
        {
            const eLebu2 = mkP23('eLebu2', -1, { j: [C23('lebu')] });
            const pen = tss.selfCreatedDestructionPenalty(me23, eLebu2, rctx);
            ok(pen > 0 && (8 - pen) > 0, '10.23 拆关键装备收益 8 可覆盖乐惩罚 ' + pen + '（soft）');
        }

        /* ---- ally 的敌方乐可解除：负惩罚（鼓励解除） ---- */
        {
            const allyLebu = mkP23('allyLebu', 1, { j: [C23('lebu')] });
            ok(tss.selfCreatedDestructionPenalty(me23, allyLebu, rctx) < 0, '10.23 队友判定区乐 → 负惩罚（鼓励过河解除）');
        }

        /* ---- provenance：记录本回合自建控制 + 生命周期校验 ---- */
        {
            tss.clearTurnState();
            const eP = mkP23('eP', -1, { j: [C23('lebu')] });
            tss.recordControlState(me23, eP, 'lebu');
            eq(tss.getControlRecords().length, 1, '10.23 recordControlState 写入 provenance');
            const dp = tss.evaluateDestroyPenalty(me23, eP, rctx);
            eq(dp.selfCreated, true, '10.23 已记录的敌方乐标记 selfCreated');
            eq(dp.penalty > 0, true, '10.23 已记录且仍在判定区 → 惩罚生效');

            /* protected state 已移除 → penalty=0 */
            eP._j.length = 0;
            eq(tss.selfCreatedDestructionPenalty(me23, eP, rctx), 0, '10.23 控制牌离开判定区 → penalty=0');
            eP._j.push(C23('lebu'));

            /* 目标死亡 → penalty=0 */
            eP.alive = false;
            eq(tss.selfCreatedDestructionPenalty(me23, eP, rctx), 0, '10.23 目标阵亡 → penalty=0');
            eP.alive = true;

            /* 跨回合不污染：相位切换后 provenance 清空，且惩罚仍来自真实状态、不叠加 */
            const before = tss.selfCreatedDestructionPenalty(me23, eP, rctx);
            hostStub._status.currentPhase = { name: 'nextActor' };
            tss.evaluateDestroyPenalty(me23, eP, rctx);   /* 触发相位同步 */
            eq(tss.getControlRecords().length, 0, '10.23 跨回合 provenance 不污染（记录清空）');
            const after = tss.selfCreatedDestructionPenalty(me23, eP, rctx);
            eq(after, before, '10.23 跨回合惩罚不叠加（仍为真实状态值）');
        }

        /* ---- recordSelfCreatedControl：仅 lebu/bingliang、仅命中动作时记录 ---- */
        {
            tss.clearTurnState();
            const eR = mkP23('eR', -1, { j: [] });
            hostStub.game.players = [me23, eR];
            tss.recordSelfCreatedControl(me23, { rule: 'guohe', strat: 'useCardAfter', target: 'eR' }, eR);
            eq(tss.getControlRecords().length, 0, '10.23 非乐/兵动作 → 不记录 provenance');
            tss.recordSelfCreatedControl(me23, { rule: 'lebu', strat: 'useCardAfter', target: 'eR' }, eR);
            eq(tss.getControlRecords().length, 1, '10.23 使用乐命中目标 → 记录 provenance');
        }
        tss.clearTurnState();
    }

    /* ---- A. State Freshness：判定区变化必须使决策缓存失效 ---- */
    {
        const meS = mkP23 ? mkP23('meS', 1, { h: 3, j: [] }) : null;
        if (meS) {
            const eS = mkP23('eS', -1, { h: 2, j: [] });
            hostStub.game.me = meS;
            hostStub.game.players = [meS, eS];
            hostStub.game.alivePlayers = [meS, eS];
            hostStub._status.currentPhase = meS;
            cache.checkStateChanged();                                   /* 基线同步 */
            eq(cache.checkStateChanged(), false, '10.23 状态未变 → 缓存保留');
            eS._j.push(C23('lebu'));
            eq(cache.checkStateChanged(), true, '10.23 敌方判定区落乐 → 指纹变化（缓存失效，下一步可见）');
            eS._j.length = 0;
            eq(cache.checkStateChanged(), true, '10.23 判定牌离开 → 再次失效');
        }
    }

    /* ---- 源码守卫：唯一权威接入 + 粗暴同目标降权退役 + 缓存指纹纳入判定区 ---- */
    {
        const fsSync23 = await import('node:fs');
        const engSrc = readDecisionSources();
        const cacheSrc = fsSync23.readFileSync(join(_pkg, 'score', 'foundation', 'storage', 'cache.js'), 'utf8');
        ok(/turnStrategicState\.js/.test(engSrc), '10.23 engine.js 接入唯一权威 turnStrategicState');
        ok(/evaluateActionTransitionPenalty/.test(engSrc), '10.23 engine.js 调用通用 evaluateActionTransitionPenalty');
        eq(engSrc.indexOf('s *= 0.4') < 0, true, '10.23 engine.js 删除「判定区有延时牌 → ×0.4」粗暴同目标降权');
        ok(/getCards\(['"]j['"]\)/.test(cacheSrc), '10.23 cache.makeStateKey 纳入判定区指纹');
        ok(/checkStateChanged/.test(engSrc) && /_lastBestAction = null/.test(engSrc),
            '10.23 engine.js 状态变化时清空 _lastBestAction（100ms 缓存不得掩盖状态变化）');
        ok(/import\s*\{[^}]*\bgame\b[^}]*\}\s*from\s*['"][^'"]*host\.js['"]/.test(cacheSrc),
            '10.23 cache.js 显式导入宿主（消除隐式全局静默失效）');
    }
}

/* ================= 10.24 架构稳定化 Stage A：统一 Player State Snapshot（指令 05） =================
 * 契约：策略层不再猜宿主字段（isLinked/isChained/judges/isJudge/isJudged/equipVal）；
 * 一律经 buildPlayerSnapshot 归一 alive/hp/maxHp/handCount/linked/judge/equip/nextToAct/threat。
 */
{
    let ps = null;
    try { ps = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'state', 'playerSnapshot.js')).href); }
    catch (e) { ps = null; }

    ok(ps && typeof ps.buildPlayerSnapshot === 'function', '10.24 导出 buildPlayerSnapshot');
    ['judgeCardsOf', 'equipCardsOf', 'equipValueOf', 'handCountOf', 'nextToActOf', 'isLordOf', 'buildPlayerSnapshot'].forEach(function (fn) {
        if (!ps) return;
        eq(typeof ps[fn], 'function', '10.24 导出 ' + fn);
    });

    /* 玩家桩：宿主风格 API（getCards/countCards/isNextToAct/isLinked 函数） */
    function mkA(name, opts) {
        opts = opts || {};
        const p = {
            name: name, name1: name, alive: opts.alive !== false,
            hp: opts.hp == null ? 4 : opts.hp, maxHp: opts.maxHp == null ? 4 : opts.maxHp,
            _h: opts.h || [], _j: opts.j || [], _e: opts.e || [],
            countCards: function (a) {
                if (a === 'hs') return this._h.length;
                return a === 'h' ? this._h.length : (a === 'e' ? this._e.length : (a === 'j' ? this._j.length : 0));
            },
            getCards: function (a) {
                if (a === 'h') return this._h;
                return a === 'e' ? this._e : (a === 'j' ? this._j : []);
            },
        };
        if (opts.isNextToAct !== undefined) p.isNextToAct = opts.isNextToAct;
        if (opts.isLinked !== undefined) p.isLinked = opts.isLinked;
        return p;
    }

    if (ps) {
        /* A. 判定区事实归一 */
        const pJ = mkA('pJ', { j: [{ name: 'lebu' }, { name: 'bingliang' }] });
        const sJ = ps.buildPlayerSnapshot(pJ);
        eq(sJ.hasJudge, true, '10.24 判定区有牌 → hasJudge=true');
        eq(sJ.judgeCards.length, 2, '10.24 judgeCards 读取真实判定区');
        eq(sJ.judgeNames.join(','), 'lebu,bingliang', '10.24 judgeNames 归一');
        eq(ps.buildPlayerSnapshot(mkA('pNoJ', { j: [] })).hasJudge, false, '10.24 空判定区 → hasJudge=false');

        /* B. 装备区：equipCount / equipVal 不再读宿主猜测字段 p.equipVal */
        const sE = ps.buildPlayerSnapshot(mkA('pE', { e: [{ name: 'bagua' }, { name: 'zhuge' }] }));
        eq(sE.equipCount, 2, '10.24 equipCount 读取真实装备区');
        ok(sE.equipVal >= sE.equipCount, '10.24 equipVal ≥ equipCount（装备价值而非宿主猜测）');
        const pFake = mkA('pFake', { e: [] }); pFake.equipVal = 999;
        eq(ps.buildPlayerSnapshot(pFake).equipVal, 0, '10.24 不再读取宿主猜测字段 p.equipVal');

        /* C. 手牌 / 存活 / HP 归一 */
        const sH = ps.buildPlayerSnapshot(mkA('pH', { h: [{ name: 'sha' }, { name: 'shan' }, { name: 'tao' }], hp: 2, maxHp: 4 }));
        eq(sH.handCount, 3, '10.24 handCount 读取真实手牌');
        eq(sH.hp, 2, '10.24 hp 归一');
        eq(sH.maxHp, 4, '10.24 maxHp 归一');
        eq(sH.alive, true, '10.24 alive 归一');
        eq(ps.buildPlayerSnapshot(mkA('pD', { alive: false })).alive, false, '10.24 阵亡归一');

        /* D. 横置：唯一权威 isPlayerLinked 语义，不猜 isChained */
        const pL = mkA('pL'); pL.isLinked = function () { return true; };
        eq(ps.buildPlayerSnapshot(pL).linked, true, '10.24 isLinked() 函数 → linked=true');
        const pL2 = mkA('pL2'); pL2.isLinked = function () { return false; };
        eq(ps.buildPlayerSnapshot(pL2).linked, false, '10.24 isLinked() 返回 false → linked=false');
        const pL3 = mkA('pL3'); pL3.isChained = true;
        eq(ps.buildPlayerSnapshot(pL3).linked, false, '10.24 不采信猜测字段 isChained');

        /* E. nextToAct 归一 */
        eq(ps.buildPlayerSnapshot(mkA('pN', { isNextToAct: true })).nextToAct, true, '10.24 nextToAct 归一');
        eq(ps.buildPlayerSnapshot(mkA('pN2', { isNextToAct: false })).nextToAct, false, '10.24 nextToAct=false 归一');

        /* F. 健壮性：空玩家 → 安全空快照 */
        const sNull = ps.buildPlayerSnapshot(null);
        eq(sNull.alive, false, '10.24 null 玩家 → 安全空快照');
        eq(sNull.handCount, 0, '10.24 null 玩家 handCount=0');

        /* G. 源码守卫：策略层不再猜宿主字段 + 唯一入口收敛 */
        const fsA = await import('node:fs');
        const engA = readDecisionSources();
        const ccA = fsA.readFileSync(join(_pkg, 'score', 'decision', 'strategy', 'comboChain.js'), 'utf8');
        const exA = fsA.readFileSync(join(_pkg, 'score', 'bootstrap', 'dataExport.js'), 'utf8');
        ok(/playerSnapshot\.js/.test(engA) && /buildPlayerSnapshot/.test(engA), '10.24 engine.js 接入统一 playerSnapshot');
        eq(/isJudge\s*\|\|\s*\w+\.isJudged/.test(engA), false, '10.24 engine.js 退役 p.isJudge || p.isJudged 猜测');
        eq(/isFinite\(p\.equipVal\)/.test(engA), false, '10.24 engine.js 退役 p.equipVal 猜测');
        eq(/p\.judges\s*&&/.test(engA), false, '10.24 engine.js 退役 p.judges 原始读取');
        ok(/isPlayerLinked/.test(ccA), '10.24 comboChain 使用唯一横置入口 isPlayerLinked');
        ok(/isPlayerLinked/.test(exA), '10.24 export 使用唯一横置入口 isPlayerLinked');
    }
}

/* ================= 10.25 架构稳定化 Stage B：Relations 单一权威源（指令 05） =================
 * 契约：score/decision/** 的「政策决策」不得再散落 get.attitude()；敌我三元
 *   isAllyOf/isNeutralOf/isEnemyOf 一律经 relations.dispositionOf（含行为推断软翻转）。
 *   threat.js 的 enemiesOf/isEnemyOf 收敛到 relations（消除第二套敌我源 / 内奸误判）。
 */
{
    let rel = null;
    try { rel = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'relations', 'relations.js')).href); }
    catch (e) { rel = null; }

    ok(rel && typeof rel.isEnemyOf === 'function', '10.25 relations 导出规范名 isEnemyOf');
    ok(rel && typeof rel.isAllyOf === 'function' && typeof rel.isNeutralOf === 'function', '10.25 relations 敌我三元齐全');

    const fsB = await import('node:fs');

    /* 已迁移的政策决策文件：须无 get.attitude（源码守卫） */
    const policyFiles = [
        'score/decision/timing/taoyuanTiming.js',
        'score/decision/timing/wuguTiming.js',
        'score/decision/timing/duelTiming.js',
        'score/decision/timing/jiedaoTiming.js',
        'score/decision/timing/aoeTiming.js',
        'score/decision/timing/jiuTiming.js',
        'score/decision/timing/judgeTiming.js',
        'score/decision/timing/shunshouTiming.js',
        'score/decision/cardplay/responseOpt.js',
        'score/decision/response/responseAI.js',
        'score/decision/override/respond.js',
        'score/decision/override/discard.js',
        'score/decision/tuning/shaTargetOpt.js',
        'score/decision/tuning/endgameOpt.js',
        'score/decision/strategy/planner.js',
        'score/decision/strategy/multiTurnPlan.js',
        'score/decision/strategy/multiTurnOpt.js',
        'score/decision/strategy/comboChain.js',
        'score/decision/safety/optimization.js',
        'score/decision/safety/aiOverride.js',
    ];
    policyFiles.forEach(function (f) {
        let src = '';
        try { src = fsB.readFileSync(join(_pkg, f), 'utf8'); } catch (e) { src = ''; }
        eq(src.indexOf('get.attitude') < 0, true, '10.25 ' + f + ' 无 get.attitude 散落');
    });

    /* timing 文件：补上显式 import（消除静默失效） */
    ['taoyuanTiming', 'wuguTiming', 'duelTiming', 'jiedaoTiming', 'aoeTiming', 'jiuTiming', 'judgeTiming', 'shunshouTiming'].forEach(function (n) {
        const src = fsB.readFileSync(join(_pkg, 'score', 'decision', 'timing', n + '.js'), 'utf8');
        ok(/^import\s/m.test(src), '10.25 ' + n + ' 显式 import（评分层不再依赖全局）');
    });

    /* threat.js：enemiesOf/isEnemyOf 收敛到 relations（_dispositionOf） */
    const thSrc = fsB.readFileSync(join(_pkg, 'score', 'decision', 'threat', 'threat.js'), 'utf8');
    ok(/_dispositionOf\(char, p\) === -1/.test(thSrc), '10.25 enemiesOf 收敛到 relations._dispositionOf');
    ok(/function isEnemyOf\(me, t\)[\s\S]*?_dispositionOf\(me, t\) === -1/.test(thSrc), '10.25 isEnemyOf 收敛到 _dispositionOf（不再 get.attitude + 阵营 map）');
    eq(/get\.attitude\(char, p\)/.test(thSrc), false, '10.25 enemiesOf 不再散落 get.attitude');
    eq(/camp\[p\.identity\]/.test(thSrc), false, '10.25 enemiesOf 移除阵营 map 重推导（内奸不再误判为敌）');
    eq(thSrc.indexOf('require(') < 0, true, '10.25 threat.js 无 ESM 内 require（cardValueWithTarget 走 import）');
    eq(/isEnemyOf\(target, me\)/.test(thSrc), false, '10.25 cardValueWithTarget 视角修正为 isEnemyOf(me, target)');

    /* engine.js：政策决策无 get.attitude 散落 */
    const engB = readDecisionSources();
    eq(engB.indexOf('get.attitude') < 0, true, '10.25 engine.js 无 get.attitude 散落');

    /* 保留 raw-fact 的合法边界仍存在（relations 基线 / 阵营归类 modeStrategy / diagnostics postCheck） */
    const relSrc = fsB.readFileSync(join(_pkg, 'score', 'decision', 'relations', 'relations.js'), 'utf8');
    ok(/get\.attitude\(me, t\)/.test(relSrc), '10.25 relations 保留 get.attitude 同源基线（唯一权威本身）');
}

/* ================= 10.26 架构稳定化 Stage C：targetBrain Data Contract（指令 05） =================
 * 契约：targetBrain 的目标候选一律经 buildTargetCandidate（playerSnapshot.js）生产，
 *   确保 handCount/equipVal(judgeCards)/nextToAct/linked/isAlly/isEnemy/threat 真实且更新；
 *   engine.js 不再手拼 pickTargetByPurpose 的候选数组（消除字段缺失/口径漂移）。
 *   同时验证 probHasShan 单参兼容（旧实现曾导致 targetBrain/kill 的 shanProb 恒 0.3）。
 */
{
    let snapMod = null;
    try { snapMod = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'state', 'playerSnapshot.js')).href); }
    catch (e) { snapMod = null; }

    ok(snapMod && typeof snapMod.buildTargetCandidate === 'function', '10.26 buildTargetCandidate 存在');

    const fsC = await import('node:fs');
    const engC = readDecisionSources();

    /* 引擎目标候选来源已收敛到 buildTargetCandidate（3 个 pickTargetByPurpose 候选数组） */
    ok(/buildTargetCandidate\(me, p\)/.test(engC), '10.26 engine 经 buildTargetCandidate(me,p) 生产候选');
    eq(/targets\.push\(\{\s*name:\s*p\.name1/.test(engC), false, '10.26 applyBasicTargetRules 不再手拼 name/hp/threat');
    eq(/shanProb:\s*\(function\(\)\{\s*try \{\s*return probHasShan\(p\)/.test(engC), false, '10.26 _buildTargetBrainCandidates 不再手拼 shanProb');

    /* 契约字段集：targetBrain 消费字段全部存在 */
    const snapC = fsC.readFileSync(join(_pkg, 'score', 'decision', 'state', 'playerSnapshot.js'), 'utf8');
    ['pp', 'name', 'isAlly', 'isEnemy', 'hp', 'maxHp', 'threat', 'handCount', 'shaCount',
     'shanProb', 'equipVal', 'equipCount', 'judgeCards', 'isJudge', 'nextToAct', 'linked', 'isLord'].forEach(function (k) {
        ok(snapC.indexOf(k + ':') >= 0, '10.26 buildTargetCandidate 契约字段 ' + k);
    });

    /* probHasShan 单参兼容（曾恒返回 0.3 的 shanProb 数据失真） */
    const thC = fsC.readFileSync(join(_pkg, 'score', 'decision', 'threat', 'threat.js'), 'utf8');
    ok(/if \(tgt === undefined\) tgt = me;/.test(thC), '10.26 probHasShan 兼容单参调用（shanProb 不再恒 0.3）');

    /* 功能冒烟：桩玩家 → 契约字段真实（判定区/手牌透传，阵亡返回 null） */
    if (snapMod) {
        function mkP26(name, opts) {
            opts = opts || {};
            return {
                name: name, alive: opts.alive !== false,
                hp: opts.hp == null ? 4 : opts.hp, maxHp: 4,
                _h: opts.h == null ? 2 : opts.h, _j: opts.j || [], _e: opts.e || [],
                countCards: function (a) { return a === 'h' ? this._h : 0; },
                getCards: function (a) { return a === 'e' ? this._e : (a === 'j' ? this._j : []); },
            };
        }
        const C26 = function (id) { return { name: id }; };
        const me26 = mkP26('me26', { h: 3 });
        const p26 = mkP26('p26', { hp: 1, h: 2, j: [C26('lebu')], e: [C26('bagua')] });
        const cand = snapMod.buildTargetCandidate(me26, p26);
        ok(cand && typeof cand === 'object', '10.26 buildTargetCandidate 返回对象');
        ok(cand && cand.isJudge === true, '10.26 判定区 → isJudge=true');
        ok(cand && cand.hp === 1, '10.26 hp 透传');
        ok(cand && cand.handCount === 2, '10.26 handCount 真实');
        ok(cand && Array.isArray(cand.judgeCards) && cand.judgeCards.length === 1, '10.26 judgeCards 真实');
        eq(typeof (cand && cand.shanProb), 'number', '10.26 shanProb 实数');
        eq(typeof (cand && cand.linked), 'boolean', '10.26 linked 事实');
        eq(snapMod.buildTargetCandidate(me26, { name: 'dead26', alive: false }), null, '10.26 阵亡 → null');
    }
}

/* ================= 10.27 架构稳定化 Stage D：Action Semantics / State Transition Utility（指令 05） =================
 * 语义：拆除(过河/顺手)从 relation-only 升级为 state-transition utility：
 *   - 过河拆/顺手 队友的乐/兵/闪电 = 帮队友 → 正收益（旧实现被 inferPurpose 分到 control → 恒 -8）；
 *   - 拆/顺 无负面判定区的队友 = 伤队友 → 仍强负；
 *   - 纯控制(lebu/bingliang/shandian) 仍只对真敌（贴队友仍强罚，不放松）。
 *   同时清理 judgeBrain 的 drawDependency 死条件（全仓无生产者），并验证 directionScore 同口径。
 */
{
    let relMod = null;
    try { relMod = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'relations', 'relations.js')).href); }
    catch (e) { relMod = null; }

    ok(relMod && typeof relMod.actionValue === 'function', '10.27 actionValue 存在');
    ok(relMod && typeof relMod.directionScore === 'function', '10.27 directionScore 存在');

    /* 源码守卫：inferPurpose 把 guohe/shunshou 拆为 dismantle（消除与 engine._CARD_PURPOSE 的口径漂移） */
    const fsD = await import('node:fs');
    const relD = fsD.readFileSync(join(_pkg, 'score', 'decision', 'relations', 'relations.js'), 'utf8');
    ok(/const DISMANTLE = \['guohe', 'shunshou'\]/.test(relD), '10.27 inferPurpose 新增 dismantle 分类');
    eq(/'guohe', 'shunshou', 'lebu'/.test(relD), false, '10.27 guohe/shunshou 不再并入 control 名单');

    /* judgeBrain 死条件清理（drawDependency 全仓无生产者） */
    const jbD = fsD.readFileSync(join(_pkg, 'score', 'decision', 'basic', 'judgeBrain.js'), 'utf8');
    eq(/drawDependency/.test(jbD), false, '10.27 judgeBrain 移除 drawDependency 死条件');

    /* 功能冒烟：拆队友负面判定区→正；拆无负面队友→负；纯控制贴队友→负 */
    if (relMod) {
        function mkP27(name, opts) {
            opts = opts || {};
            return {
                name: name, alive: true,
                hp: opts.hp == null ? 4 : opts.hp,
                _j: opts.j || [],
                isFriend: opts.isFriend,   /* undefined → 走 get.attitude(桩)=0 → 中性 */
                getCards: function (a) { return a === 'j' ? this._j : []; },
            };
        }
        const me27 = mkP27('me27');
        const allyJudge = mkP27('allyJudge', { j: [{ name: 'lebu' }], isFriend: function () { return true; } });
        const allyClean = mkP27('allyClean', { isFriend: function () { return true; } });

        const v1 = relMod.actionValue(me27, { id: 'guohe', target: allyJudge, base: 0 });
        ok(v1 > 0, '10.27 过河拆队友乐 → 正收益');
        const v2 = relMod.actionValue(me27, { id: 'shunshou', target: allyJudge, base: 0 });
        ok(v2 > 0, '10.27 顺手队友乐 → 正收益');
        const v3 = relMod.actionValue(me27, { id: 'guohe', target: allyClean, base: 0 });
        ok(v3 < 0, '10.27 拆无负面队友 → 负收益');
        const v4 = relMod.actionValue(me27, { id: 'lebu', target: allyJudge, base: 0 });
        ok(v4 < 0, '10.27 乐贴队友仍强罚（纯控制不放松）');

        eq(relMod.directionScore(me27, { id: 'guohe' }, allyJudge), 1, '10.27 directionScore 拆队友负面判定 → +1');
        eq(relMod.directionScore(me27, { id: 'guohe' }, allyClean), -3, '10.27 directionScore 拆无负面队友 → -3');
    }
}

/* ================= 10.28 架构稳定化 Stage D：铁索状态转换 + 闪电语义归位（指令 05） =================
 * 覆盖“铁索解除队友”反例：tiesuo 不再并入 relation-only 的 control（否则对队友恒 -8、对敌恒 +2，
 * 与“解横置队友/横置敌人”的真实状态转换语义冲突），升级为 state，交回 tiesuoEvaluator 唯一权威；
 * 同时把 shandian(闪电) 从 control 中移除（其对自己使用、入己判定区并轮转，非“贴敌人”）。
 */
{
    let relMod = null;
    try { relMod = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'relations', 'relations.js')).href); }
    catch (e) { relMod = null; }
    ok(relMod && typeof relMod.inferPurpose === 'function', '10.28 inferPurpose 已导出（动作语义唯一源）');

    /* 源码守卫：tiesuo → STATE；shandian 不再出现在 control 名单 */
    const fsD = await import('node:fs');
    const relD = fsD.readFileSync(join(_pkg, 'score', 'decision', 'relations', 'relations.js'), 'utf8');
    ok(/const STATE = \['tiesuo'\]/.test(relD), '10.28 inferPurpose 新增 STATE 分类（状态转换）');
    eq(/const CTRL = \['lebu', 'bingliang', 'jiedao'\]/.test(relD), true, '10.28 control 名单不再含 tiesuo/shandian');

    if (relMod) {
        function mkP28(name, opts) {
            opts = opts || {};
            return {
                name: name, alive: true,
                hp: opts.hp == null ? 4 : opts.hp,
                _j: opts.j || [],
                isFriend: opts.isFriend,   /* undefined → disposition 中性 */
                getCards: function (a) { return a === 'j' ? this._j : []; },
            };
        }
        const me28 = mkP28('me28');
        const ally28 = mkP28('ally28', { isFriend: function () { return true; } });

        eq(relMod.inferPurpose({ id: 'tiesuo' }), 'state', '10.28 铁索 → state（状态转换，非 control）');
        eq(relMod.inferPurpose({ id: 'shandian' }), 'generic', '10.28 闪电 → generic（自用非控敌）');
        eq(relMod.inferPurpose({ id: 'lebu' }), 'control', '10.28 乐 → control（纯控制不变）');
        eq(relMod.inferPurpose({ id: 'guohe' }), 'dismantle', '10.28 过河 → dismantle（拆除不变）');

        /* ★ 反例：铁索对队友 = 交回 tiesuoEvaluator，不再 relation-only 强罚 -8 */
        eq(relMod.actionValue(me28, { id: 'tiesuo', target: ally28, base: 5 }), 5,
            '10.28 铁索对队友 → 中性 base（解横置交回 evaluator，不再强罚）');
        eq(relMod.directionScore(me28, { id: 'tiesuo' }, ally28), 0,
            '10.28 directionScore 铁索 → 0（不做关系方向加减分）');
    }
}

/* ================= 10.29 架构稳定化 Stage F：特殊牌 Evaluator（指令 05） =================
 * 借刀 = weaponHolder + victim pair action（jiedaoEvaluator 唯一权威）；
 * 桃园 = Σ allyHeal − Σ enemyHeal；五谷 = 敌我人数 + 手牌需求 + 座次净效用。
 * 关键反例：帮敌人回血/补牌 → 净效用为负 → 不放（旧实现只看我方残血/缺牌，恒放）。
 */
{
    const fsF = await import('node:fs');
    let je = null, tt = null, wu = null;
    try { je = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'cards', 'jiedaoEvaluator.js')).href); } catch (e) { je = null; }
    try { tt = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'timing', 'taoyuanTiming.js')).href); } catch (e) { tt = null; }
    try { wu = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'timing', 'wuguTiming.js')).href); } catch (e) { wu = null; }

    ok(je && typeof je.evaluateJiedaoPair === 'function' && typeof je.bestJiedaoPair === 'function', '10.29 jiedaoEvaluator pair 接口齐全');
    ok(tt && typeof tt.taoyuanValue === 'function', '10.29 taoyuanValue 导出（Σ allyHeal−Σ enemyHeal）');
    ok(wu && typeof wu.wuguValue === 'function', '10.29 wuguValue 导出（敌我人数+需求+座次）');

    /* 源码守卫：jiedaoTiming 委托 evaluator（不再 relation-only 单目标） */
    const jdSrc = fsF.readFileSync(join(_pkg, 'score', 'decision', 'timing', 'jiedaoTiming.js'), 'utf8');
    ok(/jiedaoEvaluator\.js/.test(jdSrc), '10.29 jiedaoTiming 委托 jiedaoEvaluator');

    /* 敌我注入（与 behavior 同 seam；本块为门禁最后一块，不改动其余 10.x） */
    const host29 = await import(pathToFileURL(_hostPath).href);
    host29.get.attitude = function (me, t) { return t && t.rel ? t.rel : 0; };
    host29.get.subtypes = function (c) { return (c && c.subtypes) || []; };

    function W29(name) { return { name: name, subtypes: ['equip1'] }; }
    function P29(name, rel, o) {
        o = o || {};
        return {
            name: name, rel: rel, alive: true,
            hp: o.hp == null ? 4 : o.hp, maxHp: o.maxHp == null ? 4 : o.maxHp,
            _h: o.h == null ? 4 : o.h, _e: o.e || [],
            countCards: function (z) { return z === 'h' ? this._h : 0; },
            getCards: function (z) { return z === 'e' ? this._e : []; },
        };
    }

    if (je) {
        const meF = P29('meF', 1);
        const holderE = P29('holderE', -1, { e: [W29('qinglong')] });
        const holderA = P29('holderA', 1, { e: [W29('zhuge')] });
        const victimE = P29('victimE', -1, { hp: 1 });
        eq(je.evaluateJiedaoPair(meF, holderE, victimE).use, true, '10.29 借敌刀杀敌 → use');
        eq(je.evaluateJiedaoPair(meF, holderA, victimE).use, true, '10.29 借友刀杀敌 → use');
        eq(je.evaluateJiedaoPair(meF, holderE, holderA).score, -Infinity, '10.29 被刀对象是队友 → -Infinity');
    }

    if (tt) {
        const meT = P29('meT', 1, { hp: 4 });
        host29.game.players = [meT, P29('eLow1', -1, { hp: 1 }), P29('eLow2', -1, { hp: 2 })];
        const tv = tt.taoyuanValue(meT);
        ok(tv.enemyHeal > 0 && tv.net < 0, '10.29 敌方回血更多 → taoyuanValue.net<0');
        eq(tt.taoyuanTiming(meT).use, false, '10.29 帮敌人奶更多 → 不放桃园');
    }

    if (wu) {
        const meW = P29('meW', 1, { h: 3 });
        host29.game.players = [meW, P29('eLow1', -1, { h: 1 }), P29('eLow2', -1, { h: 2 })];
        const wv = wu.wuguValue(meW);
        ok(wv.enemyLow >= 2 && wv.net < 0, '10.29 敌方缺牌更多 → wuguValue.net<0');
        eq(wu.wuguTiming(meW).use, false, '10.29 帮敌人补牌 → 不放五谷');
    }
}

/* ================= 10.30 架构稳定化 Stage G：Timing Audit（指令 05） =================
 * 审计 score/decision/timing/** 的显式 import 与静默失效。
 * 真实 bug：shandianTiming/taoTiming 曾引用全局 game 但未 import，在 ESM 严格模式下
 * ReferenceError 被 catch 吞掉 → 恒 use:false（闪电残局分支 / 桃残局分支静默失效）。
 * 修复后 11 个 timing 模块全部显式 import；验证残局/濒死分支不再静默失效。
 */
{
    const fsG = await import('node:fs');
    const timingNames = ['taoTiming', 'shandianTiming', 'jiedaoTiming', 'wuguTiming', 'taoyuanTiming', 'shunshouTiming', 'judgeTiming', 'jiuTiming', 'aoeTiming', 'duelTiming', 'wuxieTiming'];
    timingNames.forEach(function (n) {
        const src = fsG.readFileSync(join(_pkg, 'score', 'decision', 'timing', n + '.js'), 'utf8');
        ok(/^import\s/m.test(src), '10.30 ' + n + ' 显式 import（无全局 game/get 裸引用）');
    });

    /* 修复守卫：shandianTiming/taoTiming 显式 import host（消除 ReferenceError 静默失效） */
    const sdSrc = fsG.readFileSync(join(_pkg, 'score', 'decision', 'timing', 'shandianTiming.js'), 'utf8');
    const taoSrc = fsG.readFileSync(join(_pkg, 'score', 'decision', 'timing', 'taoTiming.js'), 'utf8');
    ok(/adapt\/host\.js/.test(sdSrc), '10.30 shandianTiming 显式 import game');
    ok(/adapt\/host\.js/.test(taoSrc), '10.30 taoTiming 显式 import game');

    /* 功能冒烟：注入 game.players，验证残局/濒死分支不再静默 false */
    let sd = null, tao = null;
    try { sd = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'timing', 'shandianTiming.js')).href); } catch (e) { sd = null; }
    try { tao = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'timing', 'taoTiming.js')).href); } catch (e) { tao = null; }

    const host30 = await import(pathToFileURL(_hostPath).href);
    function aliveP30(name) { return { name: name, alive: true }; }
    host30.game.players = [aliveP30('a'), aliveP30('b'), aliveP30('c'), aliveP30('d')];

    if (sd) eq(sd.shandianTiming({ hp: 4 }).use, true, '10.30 残局闪电 → use true（不再静默 false）');
    if (tao) eq(tao.taoTiming({ hp: 0, maxHp: 4, countCards: function () { return 0; } }).use, true, '10.30 濒死吃桃 → use true（不再静默 false）');
}

/* ================= 10.31 架构稳定化 Stage H：Hook Lifecycle（指令 05） =================
 * 审计 Player.prototype.* / game.* / get.* 猴补丁，要求每个 patch 有 original ref / install flag /
 * install / uninstall / restore 一一对应，并验证 install→uninstall→install again。
 * 真实 bug 1：engine.game.gameDraw 只打 patch 标记没存原函数 → 卸载不还原，重装时旧闭包残留/嵌套包装。
 * 真实 bug 2：engine.proto.phaseBegin 只打标记没存 orig → uninstall 循环无法还原。
 * 真实 bug 3：engine.uninstall 用 `for(k in orig) proto[k]=orig[k]`，把 get.cards/gameDraw 原函数误还原到
 *            Player.prototype（__djsc_getCards 等垃圾键）。
 * 真实 bug 4：teamBroadcast.installBroadcastHooks 改 game.check 却不保存原函数、无 uninstall。
 */
{
    const fsH = await import('node:fs');
    const engSrc = readDecisionSources();
    const tbSrc = fsH.readFileSync(join(_pkg, 'score', 'perception', 'team', 'teamBroadcast.js'), 'utf8');

    /* 源码守卫：install 保存 original ref */
    ok(/orig\.__djsc_gameDraw\s*=\s*_origGameDraw/.test(engSrc), '10.31 engine 保存 game.gameDraw 原函数');
    ok(/orig\.phaseBegin\s*=\s*oPhaseBegin/.test(engSrc), '10.31 engine 保存 proto.phaseBegin 原函数');
    ok(/_origCheck\s*=\s*orig\b/.test(tbSrc) || /_origCheck\s*=\s*orig;/.test(tbSrc), '10.31 teamBroadcast 保存 game.check 原函数');

    /* 源码守卫：uninstall 一一对应还原 */
    ok(/game\.gameDraw\s*=\s*orig\.__djsc_gameDraw/.test(engSrc), '10.31 uninstall 还原 game.gameDraw');
    ok(/proto\.__djsc_phaseBegin_patched\)\s*delete/.test(engSrc), '10.31 uninstall 清理 phaseBegin 标记');
    ok(/__djsc_getCards'\s*\|\|\s*k\s*===\s*'__djsc_gameDraw'\)\s*continue/.test(engSrc), '10.31 uninstall 循环跳过非 proto 原始引用');
    ok(/uninstallBroadcastHooks\(\)/.test(engSrc), '10.31 engine.uninstallHooks 调用 uninstallBroadcastHooks');
    ok(/export\s+function\s+uninstallBroadcastHooks/.test(tbSrc), '10.31 teamBroadcast 导出 uninstallBroadcastHooks');

    /* 运行时：teamBroadcast（叶子级）install→uninstall→install again 真实闭环 */
    let tb = null;
    try { tb = await import(pathToFileURL(join(_pkg, 'score', 'perception', 'team', 'teamBroadcast.js')).href); } catch (e) { tb = null; }
    if (tb && typeof tb.installBroadcastHooks === 'function' && typeof tb.uninstallBroadcastHooks === 'function') {
        const hostH = await import(pathToFileURL(_hostPath).href);
        function nativeCheck() { return 'native'; }
        hostH.game.check = nativeCheck;

        tb.installBroadcastHooks();
        eq(hostH.game.check === nativeCheck, false, '10.31 install 后 game.check 已包装');
        tb.installBroadcastHooks();  /* 幂等：_hooked 守卫，不二次包装 */
        tb.uninstallBroadcastHooks();
        eq(hostH.game.check === nativeCheck, true, '10.31 uninstall 还原 game.check');

        tb.installBroadcastHooks();
        eq(hostH.game.check === nativeCheck, false, '10.31 install again 再次包装');
        tb.uninstallBroadcastHooks();
        eq(hostH.game.check === nativeCheck, true, '10.31 install→uninstall→install→uninstall 完整闭环还原');
    } else {
        /* 叶子模块无法在 Node 加载时，不把运行时闭环纳入硬门禁（源码守卫上述已覆盖 wiring） */
    }
}

/* ================= 10.32 架构稳定化 Stage I：Cache Audit（指令 05） =================
 * 概率/局势缓存的 state revision：
 *   bug 1: handInference 的 probHasShan 等按 round+player.name 缓存，同回合手牌增减/牌堆消耗后仍返回旧值。
 *   bug 2: threat.js situationFactor/incomingPressure 只按 round+aliveCount / round+hp 缓存，局势 stale。
 * 修复：handInference 用 _inferKey(hand 精确值 + deck log2 分桶)；threat 局势缓存补 _aliveFingerprint。
 */
{
    const fsI = await import('node:fs');
    const hiSrc = fsI.readFileSync(join(_pkg, 'score', 'model', 'predict', 'handInference.js'), 'utf8');
    const thSrc = fsI.readFileSync(join(_pkg, 'score', 'decision', 'threat', 'threat.js'), 'utf8');

    /* 源码守卫：_inferKey 真正接入（不是死函数） */
    ok(/const key = _inferKey\('shan', player\);/.test(hiSrc), '10.32 handInference·shan 使用 _inferKey');
    ok(/const key = _inferKey\('wuxie', player\);/.test(hiSrc), '10.32 handInference·wuxie 使用 _inferKey');
    ok(/const key = _inferKey\('tao', player\);/.test(hiSrc), '10.32 handInference·tao 使用 _inferKey');
    ok(/const key = _inferKey\('sha', player\);/.test(hiSrc), '10.32 handInference·sha 使用 _inferKey');
    ok(/const key = _inferKey\('jiu', player\);/.test(hiSrc), '10.32 handInference·jiu 使用 _inferKey');
    ok(/const key = _inferKey\('equip_' \+ equipId, player\);/.test(hiSrc), '10.32 handInference·equip 使用 _inferKey');
    ok(/const key = _inferKey\(cardId, player\);/.test(hiSrc), '10.32 handInference·probHasCard 使用 _inferKey');
    ok(/'shan_' \+ \(player\.name1 \|\| player\.name/.test(hiSrc) === false, '10.32 旧 name-only key 已移除');
    ok(/function _inferKey\(prefix, player\)/.test(hiSrc) && /function _deckBucket\(\)/.test(hiSrc), '10.32 _inferKey/_deckBucket 已定义');

    /* 源码守卫：threat 局势缓存补 _aliveFingerprint */
    ok(/function _aliveFingerprint\(\)/.test(thSrc), '10.32 threat 定义 _aliveFingerprint');
    ok(/_aliveFingerprint\(\)/.test(thSrc) && /relationStateKey\(me\)/.test(thSrc), '10.32 situationFactor + incomingPressure 纳入 alive fingerprint');

    /* 运行时（机会式）：handInference 模块可加载 + 概率推断出口闭合（deck 内容依赖真实 DOM，
     * Node 纯 Proxy 宿主桩下 totalRemaining 的对账会清空静态牌堆，故这里只冒烟出口而不断言具体概率）。 */
    let hi = null;
    try { hi = await import(pathToFileURL(join(_pkg, 'score', 'model', 'predict', 'handInference.js')).href); } catch (e) { hi = null; }
    if (hi) {
        eq(typeof hi.probHasShan, 'function', '10.32 handInference 导出 probHasShan');
        eq(typeof hi.probHasWuxie, 'function', '10.32 handInference 导出 probHasWuxie');
        eq(typeof hi.probHasCard, 'function', '10.32 handInference 导出 probHasCard');
        eq(typeof hi.clearInferCache, 'function', '10.32 handInference 导出 clearInferCache');
    }
}

/* ================= 10.33 架构稳定化 Stage J：Exception Health（指令 05） =================
 * catch 分流：expected fallback（swallowError） 与 unexpected（reportUnexpected 进诊断）。
 * 修复：swallow.js 增加 unexpected 注册表（module/reason/counter/last），healthCheck 汇入「异常健康度」，
 *       extension.js 关键安装失败上报 unexpected。
 */
{
    const fsJ = await import('node:fs');
    const swSrc = fsJ.readFileSync(join(_pkg, 'score', 'foundation', 'diag', 'swallow.js'), 'utf8');
    const hlSrc = fsJ.readFileSync(join(_pkg, 'score', 'foundation', 'diag', 'health.js'), 'utf8');
    const extSrc = fsJ.readFileSync(join(_pkg, 'js/bootstrap/extensionLifecycle.js'), 'utf8');

    ok(/export\s+function\s+reportUnexpected/.test(swSrc), '10.33 swallow 导出 reportUnexpected');
    ok(/export\s+function\s+unexpectedStats/.test(swSrc), '10.33 swallow 导出 unexpectedStats');
    ok(/export\s+function\s+resetUnexpected/.test(swSrc), '10.33 swallow 导出 resetUnexpected');
    ok(/unexpectedStats/.test(hlSrc) && /异常健康度/.test(hlSrc), '10.33 healthCheck 汇入异常健康度');
    const panelsSrc = fsJ.readFileSync(join(_pkg, 'score/view/bootstrap/panels.js'), 'utf8');
    ok(/reportUnexpected\('extension\.mountAllPanels'/.test(panelsSrc), '10.33 extension 面板挂载失败进入诊断');
    ok(/reportUnexpected\('engine', 'installScoreEngine 安装失败'/.test(extSrc), '10.33 extension 引擎安装失败进入诊断');

    /* 运行时：swallow.js 为叶子模块，Node 下可直接加载 */
    let sw = null;
    try { sw = await import(pathToFileURL(join(_pkg, 'score', 'foundation', 'diag', 'swallow.js')).href); } catch (e) { sw = null; }
    if (sw && typeof sw.reportUnexpected === 'function' && typeof sw.unexpectedStats === 'function') {
        sw.reportUnexpected('diag.test', 'test reason', new Error('boom'));
        sw.reportUnexpected('diag.test', 'test reason2', new Error('boom2'));
        sw.reportUnexpected('diag.other', 'other', null);
        const st = sw.unexpectedStats();
        eq(st.total, 3, '10.33 unexpected total 计数');
        eq(st.modules, 2, '10.33 unexpected 按模块聚合');
        eq(st.items[0].module, 'diag.test', '10.33 最高频模块');
        eq(st.items[0].count, 2, '10.33 counter 递增');
        eq(st.items[0].reason, 'test reason2', '10.33 保留最新 reason');
        ok(typeof st.items[0].last === 'number' && st.items[0].last > 0, '10.33 记录 last occurrence（时间戳）');
        eq(sw.unexpectedStats().items.length, 2, '10.33 unexpectedStats 幂等（不重复计数）');
        sw.resetUnexpected();
        eq(sw.unexpectedStats().total, 0, '10.33 resetUnexpected 清空');
    }
}

/* ================= 10.34 模型 readiness 决策门禁（P0） =================
 * 修复：默认权重契约不匹配/模型未 ready 时，裸 predict() 仍可产生随机初始化概率；
 * 若该概率经 __DJSC.confidence → deepThink 进入最终复核，会把随机模型泄漏到真实决策。
 * 门禁要求：
 *   1) engine 的生产 confidence 必须走 safeModelPredict + weightsReady；
 *   2) deepThink 自身再做一层 weightsReady fail-closed；
 *   3) 未 ready 时不调用 confidence，不增加 deepChecks，不得替换 best。
 */
{
    const fs34 = await import('node:fs');
    const eng34 = readDecisionSources();
    const dt34 = fs34.readFileSync(join(_pkg, 'score', 'cognition', 'deepThink.js'), 'utf8');

    ok(/export\s+function\s+safeModelPredict\s*\(/.test(eng34), '10.34 engine 导出 safeModelPredict 生产门禁');
    ok(/if\s*\(!weightsReady\(\)\)[\s\S]{0,500}?action:\s*'skip'/.test(eng34), '10.34 safeModelPredict 未 ready 返回 skip');
    ok(/reg\.mount\('confidence',\s*safeModelPredict\)/.test(eng34), '10.34 __DJSC.confidence 挂载 safeModelPredict 而非裸 predict');
    ok(/if\s*\(!weightsReady\(\)\)[\s\S]{0,300}?skippedNotReady\+\+/.test(dt34), '10.34 deepThink 自身具备 readiness 双保险');

    const prevReady = wm.isReady();
    const prevConfidence = window.__DJSC.confidence;
    let confidenceCalls = 0;
    try {
        wm.markReady(false);
        window.__DJSC.confidence = function (feat) {
            confidenceCalls++;
            const high = !!(feat && feat[0] === 1);
            const p = high ? 0.99 : 0.01;
            return { action: 'A', label: 'A', probs: [p, 0, 0, 0, 0, 1 - p], confidence: p, maxProb: p, value: 0 };
        };

        const fBest = new Array(130).fill(0);
        const fAlt = new Array(130).fill(0);
        fAlt[0] = 1;
        const best = { type: 'card', id: 'sha', score: 20, reason: '', _feat: fBest };
        const alt = { type: 'card', id: 'shunshou', score: 19, reason: '', _feat: fAlt };
        const before = dt.thinkingStats();
        const out = dt.criticBest({ hp: 4, maxHp: 4 }, [best, alt], best, { modelP: 0.01 });
        const after = dt.thinkingStats();

        eq(out.replaced, false, '10.34 未 ready 时 deepThink 不得替换 best');
        eq(out.best === best, true, '10.34 未 ready 时保持原始 best 引用');
        eq(confidenceCalls, 0, '10.34 未 ready 时不得调用任何模型 confidence');
        eq(after.deepChecks, before.deepChecks, '10.34 未 ready 时不进入 deepChecks');
        eq(after.skippedNotReady, before.skippedNotReady + 1, '10.34 skippedNotReady 诊断计数 +1');
        ok(out.thinking.some(function (x) { return /模型未就绪/.test(String(x)); }), '10.34 thinking 明确记录模型未就绪原因');
    } finally {
        window.__DJSC.confidence = prevConfidence;
        wm.markReady(prevReady);
    }
}

/* ================= 10.35 多步规划：先装备武器再击杀远距离残血目标 =================
 * 目标：
 *   1) planner 不得把当前攻击范围外的【杀】误判成可直接执行；
 *   2) 手牌武器若能把目标纳入攻击范围，应生成「装备 → 杀」序列；
 *   3) 多把可达武器中优先选择价值较高者；
 *   4) 规划第一步是装备时，refineBestWithPlan 必须返回 type= equip 且不把敌人当作装备目标。
 */
{
    const fs35 = await import('node:fs');
    const pl35 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'strategy', 'planner.js')).href);
    const src35 = fs35.readFileSync(join(_pkg, 'score', 'decision', 'strategy', 'planner.js'), 'utf8');

    eq(typeof pl35.projectAttackDistanceWithWeapon, 'function', '10.35 导出 projectAttackDistanceWithWeapon');
    eq(typeof pl35.chooseRangeEnablingWeapon, 'function', '10.35 导出 chooseRangeEnablingWeapon');

    /* 当前无武器：攻击距离3，装备 attackFrom=-2（攻击范围3）后 → 距离1，可杀 */
    eq(pl35.projectAttackDistanceWithWeapon(3, 0, -2), 1, '10.35 无武器：distance 3 + range3 weapon → attack distance 1');

    /* 当前已有 range2 武器（attackFrom=-1），换 range3（-2）：distance2 → distance1 */
    eq(pl35.projectAttackDistanceWithWeapon(2, -1, -2), 1, '10.35 替换武器时正确移除旧 attackFrom 再加入新值');

    /* range 不足仍不可达 */
    eq(pl35.projectAttackDistanceWithWeapon(4, 0, -2), 2, '10.35 range3 weapon 无法覆盖 distance4');

    const pick = pl35.chooseRangeEnablingWeapon(3, 0, [
        { id: 'range2', attackFrom: -1, value: 9 },
        { id: 'range3_low', attackFrom: -2, value: 5 },
        { id: 'range3_high', attackFrom: -2, value: 8 },
    ]);
    ok(pick && pick.id === 'range3_high', '10.35 只在可达武器中选择，且同等可达时优先高价值');
    eq(pl35.chooseRangeEnablingWeapon(5, 0, [{ id: 'range3', attackFrom: -2, value: 8 }]), null,
        '10.35 没有任何武器能覆盖目标 → null');

    /* 源码守卫：kill sequence 真正消费 range helper，而不是只新增死函数 */
    ok(src35.indexOf('_findRangeEnablingWeapon(me, target)') >= 0,
        '10.35 _findKillSequence 调用 range-enabling weapon 搜索');
    ok(src35.indexOf('shaReachable') >= 0,
        '10.35 【杀】进入残局解前必须经过攻击范围门禁');
    ok(/steps\.push\(\{\s*id:\s*rangeWeapon\.id,\s*type:\s*'equip'/.test(src35),
        '10.35 远距离击杀序列显式先 push equip step');
    ok(/action:\s*firstCandidate/.test(src35) &&
       src35.indexOf('sameCandidateAction(c, plannedFirst)') >= 0,
        '10.35 planner 第一动作直接返回已验证的 canonical equip candidate');
    ok(src35.indexOf('canonicalKill.targetObj = planBest.target') < 0 &&
       src35.indexOf('canonicalKill.target = targetKey') < 0,
        '10.35 装备/无目标首步保留 canonical target，不错误携带敌方 player target');

    const eng35 = readDecisionSources();
    ok(/if \(best && best\.type === 'equip'\)\s*_finalTarget = null;/.test(eng35),
        '10.35 engine 最终结果中 equip.target 强制为 null');
}

/* ================= 10.36 World-state invalidation：关系变化不得沿用旧敌我/旧目标 =================
 * 真实案例：某目标刚被当作敌人，随后同回合身份明置/态度翻转/行为证据改变。
 * 约束：不能写“跳身份后别杀”特判；缓存必须依赖统一 relation world-state。
 */
{
    const fs36 = await import('node:fs');
    const host36 = await import(pathToFileURL(_hostPath).href);
    const obs36 = await import(pathToFileURL(join(_pkg, 'score', 'perception', 'observer', 'observer.js')).href);
    const id36 = await import(pathToFileURL(join(_pkg, 'score', 'perception', 'observer', 'identity.js')).href);
    const rel36 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'relations', 'relations.js')).href);
    const th36 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'threat', 'threat.js')).href);

    function P36(name, rel, opts) {
        opts = opts || {};
        return {
            name: name, name1: name, playerid: name, rel: rel, alive: opts.alive !== false,
            hp: opts.hp == null ? 4 : opts.hp, maxHp: 4,
            identity: opts.identity || '', identityShown: !!opts.identityShown,
            group: opts.group || '',
            _h: opts.h || [], _e: opts.e || [], _j: opts.j || [],
            countCards: function (z) {
                if (z === 'h' || z === 'hs') return this._h.length;
                if (z === 'e') return this._e.length;
                if (z === 'j') return this._j.length;
                return 0;
            },
            getCards: function (z) {
                if (z === 'h' || z === 'hs') return this._h;
                if (z === 'e') return this._e;
                if (z === 'j') return this._j;
                return [];
            },
        };
    }

    const me36 = P36('me36', 1, { identity: 'zhu', identityShown: true });
    const p36 = P36('p36', -1, { identity: 'fan', identityShown: false });
    const q36 = P36('q36', 0, { identity: 'nei', identityShown: false });
    const r36 = P36('r36', 0, { identity: 'zhong', identityShown: false });
    host36.game.me = me36;
    host36.game.zhu = me36;
    host36.game.players = [me36, p36, q36, r36];
    host36.game.dead = [];
    host36.game.alivePlayers = [me36, p36, q36, r36];
    host36._status.currentPhase = me36;
    host36._status.roundNumber = 2;
    host36._status.mode = 'identity';
    host36.get.mode = function () { return 'identity'; };
    host36.get.attitude = function (me, t) { return t && typeof t.rel === 'number' ? t.rel : 0; };

    /* A. 真实身份场流程：未明目标先由合法行为证据被推成敌；
     * 同一 round 身份公开为忠臣后，必须立即作废旧敌人缓存。
     * 注意：不能再靠宿主 get.attitude 证明“敌对”，因为它可能读 hidden identity。 */
    th36.clearThreatCache();
    obs36.resetObs();
    id36.resetBelief();
    obs36.observeAttack(p36, me36, 10);
    const rk1 = rel36.relationStateKey(me36);
    ok(th36.enemiesOf(me36).indexOf(p36) >= 0, '10.36 未明身份 + 强公开攻击证据 → enemiesOf 暂含目标');
    p36.identity = 'zhong';
    p36.identityShown = true;
    const rk2 = rel36.relationStateKey(me36);
    ok(rk1 !== rk2, '10.36 身份公开改变关系事实 → relationStateKey 变化');
    eq(th36.enemiesOf(me36).indexOf(p36) < 0, true,
        '10.36 同一 round 公开为友方后 enemiesOf 不得返回旧敌缓存');

    /* B. relation fingerprint 只消费公开/推断后的关系结果，不把隐藏 identity 当作状态事实。 */
    p36.rel = 0;
    p36.identityShown = false;
    p36.identity = 'fan';
    id36.resetBelief();
    const hiddenKey1 = rel36.relationStateKey(me36);
    p36.identity = 'zhong';       // 未明置：不能因为隐藏字段本身变化就泄漏到关系状态
    const hiddenKey2 = rel36.relationStateKey(me36);
    eq(hiddenKey2, hiddenKey1, '10.36 未明置 identity 本身不泄漏进 relation state key');
    p36.identityShown = true;
    const shownKey = rel36.relationStateKey(me36);
    ok(shownKey !== hiddenKey2, '10.36 身份公开 → relation state key 立即变化');

    /* C. identity belief：行为证据 revision 不再等到下一 round。 */
    p36.identityShown = false;
    p36.identity = '';
    p36.rel = 0;
    obs36.resetObs();
    id36.resetBelief();
    id36.updateBelief();
    const rev0 = obs36.getObservationRevision();
    const beforeId = id36.identityOf(p36);
    obs36.observeAttack(p36, me36, 4);
    ok(obs36.getObservationRevision() > rev0, '10.36 新行为证据 → observation revision 递增');
    const afterId = id36.identityOf(p36);
    ok(beforeId !== afterId || afterId === 'fan',
        '10.36 同一 round 新攻击证据会触发 belief 重算（无需等下一轮）');

    /* D. 架构守卫：engine 只依赖 relation fingerprint，不出现“身份跳明置”事件特判。 */
    const engSrc36 = readDecisionSources();
    const thSrc36 = fs36.readFileSync(join(_pkg, 'score', 'decision', 'threat', 'threat.js'), 'utf8');
    const idSrc36 = fs36.readFileSync(join(_pkg, 'score', 'perception', 'observer', 'identity.js'), 'utf8');

    ok(engSrc36.indexOf('relationStateKey(_relMe)') >= 0,
        '10.36 engine bestAction 接入统一 relation world-state fingerprint');
    ok(engSrc36.indexOf('_lastBestAction = null') >= 0 && engSrc36.indexOf('clearThreatCache()') >= 0,
        '10.36 relation world-state 变化同步失效 bestAction + threat caches');
    ok(thSrc36.indexOf('hit.relationKey === relKey') >= 0,
        '10.36 enemiesOf cache 以 relationKey 为命中条件');
    ok(idSrc36.indexOf('getObservationRevision()') >= 0,
        '10.36 identity belief 订阅 observation revision');
    eq(/if\s*\([^\n]*identityShown[^\n]*(?:sha|attack|kill)/.test(engSrc36), false,
        '10.36 engine 不写“身份明置后禁止攻击”专用补丁');
}

/* ================= 10.37 Identity Inventory：身份配额约束 + hard fact / dynamic stance 分层 =================
 * 规则：
 *   1) 身份配额来自宿主规则，不靠行为猜；
 *   2) 已公开/唯一剩余槽位 = hard identity，不被后续行为改写；
 *   3) 未公开真实 identity 字段不得进入 posterior；
 *   4) 内奸 identity 固定，但 disposition/stance 仍可随局势变化。
 */
{
    const host37 = await import(pathToFileURL(_hostPath).href);
    const obs37 = await import(pathToFileURL(join(_pkg, 'score', 'perception', 'observer', 'observer.js')).href);
    const id37 = await import(pathToFileURL(join(_pkg, 'score', 'perception', 'observer', 'identity.js')).href);
    const rel37 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'relations', 'relations.js')).href);
    const fs37 = await import('node:fs');

    function P37(name, identity, shown) {
        return {
            name: name, name1: name, playerid: name, alive: true, hp: 4, maxHp: 4,
            identity: identity || '', identityShown: !!shown,
            _h: [], _e: [], _j: [], rel: 0,
            countCards: function (z) { return 0; },
            getCards: function (z) { return []; },
        };
    }

    const zhu37 = P37('zhu37', 'zhu', true);
    const me37 = P37('me37', 'zhong', false);       // 自己知道自己是忠，但对外未明置
    const f1 = P37('f1', 'fan', true);
    const f2 = P37('f2', 'fan', true);
    const f3 = P37('f3', 'fan', true);
    const f4 = P37('f4', 'fan', true);
    const x37 = P37('x37', 'fan', false);           // 故意塞“真实 fan”验证不会透视
    const y37 = P37('y37', 'zhong', false);         // 同样未明置

    host37.game.me = me37;
    host37.game.zhu = zhu37;
    host37.game.players = [zhu37, me37, f1, f2, f3, f4, x37, y37];
    host37.game.dead = [];
    host37.game.alivePlayers = host37.game.players.slice();
    host37._status.currentPhase = me37;
    host37._status.roundNumber = 3;
    host37._status.mode = 'normal';
    host37.get.mode = function () { return 'identity'; };
    const oldIdentityList37 = host37.get.identityList;
    const oldAtt37 = host37.get.attitude;
    host37.get.identityList = function (n) {
        if (n === 8) return ['zhu', 'zhong', 'zhong', 'nei', 'fan', 'fan', 'fan', 'fan'];
        return [];
    };
    host37.get.attitude = function (me, t) { return t && typeof t.rel === 'number' ? t.rel : 0; };

    try {
        obs37.resetObs();
        id37.resetBelief();

        const inv37 = id37.roleInventory();
        eq(inv37.constrainable, true, '10.37 8人身份配额可约束');
        eq(inv37.source, 'host_identityList', '10.37 优先读取宿主 identityList 规则');
        eq(inv37.counts.fan, 4, '10.37 8人标准场反贼配额=4');
        eq(inv37.counts.zhong, 2, '10.37 8人标准场忠臣配额=2');
        eq(inv37.counts.nei, 1, '10.37 8人标准场内奸配额=1');

        /* 四反已经全部公开：剩余未明玩家从逻辑上不再可能是反。 */
        const rem37 = id37.remainingRoleSlots(me37);
        eq(rem37.counts.fan, 0, '10.37 四反已确认 → observer 视角剩余 fan 槽位=0');
        eq(rem37.counts.zhong, 1, '10.37 observer 自己占一个忠槽 → 剩余忠槽=1');
        eq(rem37.counts.nei, 1, '10.37 剩余内奸槽=1');

        const bx1 = id37.beliefOfFor(me37, x37);
        eq(bx1.fan, 0, '10.37 反贼槽位耗尽 → 未明玩家 P(fan)=0');

        /* 隐藏真实 identity 改值不能影响合法 posterior。 */
        const beforeLeak37 = JSON.stringify(id37.beliefOfFor(me37, x37));
        x37.identity = 'zhong';
        const afterLeak37 = JSON.stringify(id37.beliefOfFor(me37, x37));
        eq(afterLeak37, beforeLeak37, '10.37 未明置 identity 字段变化不影响 posterior');

        /* 即便宿主旧 attitude 仍为敌，规则已排除 fan 时忠臣也不应继续把该人当敌。 */
        x37.rel = -1;
        eq(rel37.dispositionOf(me37, x37), 0,
            '10.37 忠臣视角：fan 已无剩余槽位 → 未明忠/内保持中立，不沿用旧敌对 attitude');
        eq(id37.isLikelyAlly(me37, x37), false,
            '10.37 忠/内仍各有槽位时不能把未明目标升级成确定队友');

        /* 再公开 y=内奸，则 x 成为唯一剩余忠臣：hard lock。 */
        y37.identity = 'nei';
        y37.identityShown = true;
        id37.resetBelief();
        const hardX37 = id37.hardIdentityOf(me37, x37);
        eq(hardX37.role, 'zhong', '10.37 剩余身份槽位唯一 → x hard-lock 为忠臣');
        eq(hardX37.source, 'unique_remaining_slot', '10.37 hard-lock 来源=规则唯一解');
        eq(id37.confidenceOfFor(me37, x37), 1, '10.37 规则唯一解置信度=1');
        eq(id37.isLikelyAlly(me37, x37), true,
            '10.37 唯一剩余忠臣 hard-lock 后才可作为确定队友');

        /* hard identity 不因后续敌对行为漂移。 */
        obs37.observeAttack(x37, zhu37, 10);
        eq(id37.identityOfFor(me37, x37), 'zhong',
            '10.37 hard identity 后即使出现反常行为也不改身份，只影响后续策略评估');

        /* 内奸：identity 固定；stance 由公平可见的阵营强弱变化，不再跟宿主 attitude 走。 */
        const spy37 = y37;
        spy37.identityShown = false;
        eq(id37.identityOfFor(spy37, spy37), 'nei', '10.37 内奸知道自己的固定身份');
        const stanceRebelStrong37 = rel37.dispositionOf(spy37, x37);
        eq(stanceRebelStrong37, 1, '10.37 反方更强 → 内奸可暂时与确定忠臣合作');
        f3.alive = false;
        f4.alive = false;
        host37.game.alivePlayers = host37.game.players.filter(function (p) { return p.alive !== false; });
        const stanceLoyalStrong37 = rel37.dispositionOf(spy37, x37);
        eq(stanceLoyalStrong37, -1, '10.37 主忠更强 → 内奸转而压制忠臣');
        eq(id37.identityOfFor(spy37, spy37), 'nei', '10.37 stance 翻转不改变内奸身份');
        f3.alive = true;
        f4.alive = true;
        host37.game.alivePlayers = host37.game.players.filter(function (p) { return p.alive !== false; });

        /* 源码守卫：不允许回退到“读取未公开真实身份统计人数”的实现。 */
        const idSrc37 = fs37.readFileSync(join(_pkg, 'score', 'perception', 'observer', 'identity.js'), 'utf8');
        const modeSrc37 = fs37.readFileSync(join(_pkg, 'score', 'decision', 'strategy', 'modeStrategy.js'), 'utf8');
        ok(idSrc37.indexOf('get.identityList') >= 0, '10.37 Role Inventory 使用宿主规则入口');
        ok(idSrc37.indexOf('remainingRoleSlots') >= 0 && idSrc37.indexOf('hardIdentityOf') >= 0,
            '10.37 身份推理包含剩余槽位 + hard fact 层');
        eq(/\(game\.players \|\| \[\]\).*x\.identity === "fan"/s.test(idSrc37), false,
            '10.37 不再遍历隐藏 identity 作为人数先验');
        ok(modeSrc37.indexOf('spyAttackBonus(me, tgt)') >= 0,
            '10.37 内奸策略消费统一 stance 权威，不在 modeStrategy 重算阵营强弱');
    } finally {
        host37.get.identityList = oldIdentityList37;
        host37.get.attitude = oldAtt37;
    }
}

/* ================= 10.38 Identity information boundary：公平信息 / 不确定性 / 逻辑可能性 =================
 * 修复 PR #9 审计项：
 *   A. 身份模式不得通过宿主 get.attitude/rawAttitude 间接读取 hidden identity；
 *   B. 50/50 或接近打平必须保持 unknown；
 *   C. “概率很低/显示为0.00”与“规则槽位为0=逻辑不可能”严格分离；
 *   D. observer-specific 推理不得混入匿名 identityOf(other)；
 *   E. 内奸 identity 固定，stance 仅由公平可见信息动态变化。
 */
{
    const host38 = await import(pathToFileURL(_hostPath).href);
    const obs38 = await import(pathToFileURL(join(_pkg, 'score', 'perception', 'observer', 'observer.js')).href);
    const id38 = await import(pathToFileURL(join(_pkg, 'score', 'perception', 'observer', 'identity.js')).href);
    const rel38 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'relations', 'relations.js')).href);
    const fs38 = await import('node:fs');

    function P38(name, identity, shown) {
        return {
            name: name, name1: name, playerid: name, alive: true, hp: 4, maxHp: 4,
            identity: identity || '', identityShown: !!shown,
            storage: {}, ai: { shown: 0 }, _h: [], _e: [], _j: [],
            countCards: function () { return 0; },
            getCards: function () { return []; },
        };
    }
    function install38(players, me, zhu, roleList) {
        host38.game.me = me;
        host38.game.zhu = zhu;
        host38.game.players = players;
        host38.game.dead = [];
        host38.game.alivePlayers = players.filter(function (p) { return p.alive !== false; });
        host38._status.currentPhase = me;
        host38._status.roundNumber = 4;
        host38._status.mode = 'normal';
        host38.get.mode = function () { return 'identity'; };
        host38.get.identityList = function () { return roleList.slice(); };
    }

    const oldIdentityList38 = host38.get.identityList;
    const oldAtt38 = host38.get.attitude;
    try {
        /* A + B：四反已出，忠视角剩余 1忠1内 → 50/50 必须 unknown，不得硬选忠。 */
        {
            const zhu = P38('zhu38a', 'zhu', true);
            const me = P38('me38a', 'zhong', false);
            const fans = [1,2,3,4].map(function (i) { return P38('f38a' + i, 'fan', true); });
            const x = P38('x38a', 'fan', false);    // hidden 真值故意错误
            const y = P38('y38a', 'zhong', false);
            install38([zhu, me].concat(fans, [x, y]), me, zhu,
                ['zhu','zhong','zhong','nei','fan','fan','fan','fan']);
            host38.get.attitude = function (from, to) {
                /* 故意模拟会偷看 hidden identity 的宿主 attitude。 */
                return to && to.identity === 'fan' ? -9 : 9;
            };
            obs38.resetObs();
            id38.resetBelief();

            const bx = id38.beliefOfFor(me, x);
            ok(bx && Math.abs((bx.zhong || 0) - (bx.nei || 0)) < 1e-9,
                '10.38 忠/内各一槽且无行为证据 → posterior 50/50');
            eq(id38.identityOfFor(me, x), 'unknown',
                '10.38 50/50 不确定身份 → identityOfFor=unknown');
            eq(id38.isLikelyAlly(me, x), false,
                '10.38 50/50 忠/内 → 不升级为确定队友');
            eq(rel38.dispositionOf(me, x), 0,
                '10.38 四反已满 + 忠/内未分 → neutral');

            const beforeBelief = JSON.stringify(id38.beliefOfFor(me, x));
            const beforeDisp = rel38.dispositionOf(me, x);
            x.identity = 'zhong'; // 未明置 hidden 真值改变
            const afterBelief = JSON.stringify(id38.beliefOfFor(me, x));
            const afterDisp = rel38.dispositionOf(me, x);
            eq(afterBelief, beforeBelief,
                '10.38 hidden identity 改变不能经宿主 attitude 污染 belief');
            eq(afterDisp, beforeDisp,
                '10.38 hidden identity 改变不能经宿主 attitude 污染 disposition');
        }

        /* C：概率即使低到四舍五入显示 0.00，只要仍有槽位，就不能判“逻辑不可能”。 */
        {
            const zhu = P38('zhu38b', 'zhu', true);
            const me = P38('me38b', 'zhong', false);
            const x = P38('x38b', 'fan', false);
            const others = Array.from({ length: 17 }, function (_, i) { return P38('u38b' + i, '', false); });
            install38([zhu, me, x].concat(others), me, zhu,
                ['zhu'].concat(Array.from({ length: 18 }, function () { return 'zhong'; }), ['fan']));
            host38.get.attitude = function () { return 0; };
            obs38.resetObs();
            id38.resetBelief();
            obs38.observeAid(x, zhu, 100);

            const b = id38.beliefOfFor(me, x);
            ok(b && b.fan > 0 && b.fan < 0.01,
                '10.38 fan posterior 可低于1%但仍为正');
            eq(Math.round((b.fan || 0) * 100) / 100, 0,
                '10.38 低概率显示到两位小数可成为0.00');
            eq(id38.isRolePossibleFor(me, x, 'fan'), true,
                '10.38 fan 槽位仍存在 → 逻辑上仍可能为fan');
        }

        /* D：observer 私有身份会改变合法剩余槽位；匿名视角不能混进当前玩家推理链。 */
        {
            const zhu = P38('zhu38c', 'zhu', true);
            const me = P38('me38c', 'zhong', false);
            const x = P38('x38c', 'fan', false);
            const y = P38('y38c', 'nei', false);
            install38([zhu, me, x, y], me, zhu, ['zhu','zhong','nei','fan']);
            host38.get.attitude = function () { return 0; };
            obs38.resetObs();
            id38.resetBelief();

            const observerBelief = id38.beliefOfFor(me, x);
            const anonymousBelief = id38.beliefOf(x);
            ok(observerBelief && anonymousBelief &&
                Math.abs((observerBelief.zhong || 0) - (anonymousBelief.zhong || 0)) > 0.1,
                '10.38 observer-specific posterior 与匿名视角确实不同');
        }

        /* E：内奸身份固定；stance 随公开阵营质量变化，不依赖 hidden identity/get.attitude。 */
        {
            const zhu = P38('zhu38d', 'zhu', true);
            const spy = P38('spy38d', 'nei', false);
            const f1 = P38('f38d1', 'fan', true);
            const f2 = P38('f38d2', 'fan', true);
            const f3 = P38('f38d3', 'fan', true);
            const f4 = P38('f38d4', 'fan', true);
            const x = P38('x38d', 'fan', false);
            const y = P38('y38d', 'fan', false);
            install38([zhu, spy, f1, f2, f3, f4, x, y], spy, zhu,
                ['zhu','zhong','zhong','nei','fan','fan','fan','fan']);
            host38.get.attitude = function (from, to) {
                return to && to.identity === 'fan' ? -9 : 9;
            };
            obs38.resetObs();
            id38.resetBelief();

            eq(id38.identityOfFor(spy, spy), 'nei',
                '10.38 内奸知道自己的固定身份');
            eq(rel38.dispositionOf(spy, f1), -1,
                '10.38 反方公开质量更强 → 内奸公平地压反');
            eq(rel38.dispositionOf(spy, x), 1,
                '10.38 规则唯一剩余忠臣 → 反方强时内奸可暂时合作');

            /* 两名公开反贼退出存活局面 → 强弱翻转；身份不变但 stance 翻转。 */
            f3.alive = false;
            f4.alive = false;
            host38.game.alivePlayers = host38.game.players.filter(function (p) { return p.alive !== false; });
            eq(id38.identityOfFor(spy, spy), 'nei',
                '10.38 局势变化后内奸 identity 仍固定');
            eq(rel38.dispositionOf(spy, x), -1,
                '10.38 主忠公开质量更强 → 内奸转而压忠');
            eq(rel38.dispositionOf(spy, f1), 1,
                '10.38 主忠更强时 → 内奸可暂时与反合作');
        }

        /* 源码守卫：身份推理链不再消费宿主 hidden-role attitude，也不混淆概率0与槽位0。 */
        const idSrc38 = fs38.readFileSync(join(_pkg, 'score', 'perception', 'observer', 'identity.js'), 'utf8');
        const relSrc38 = fs38.readFileSync(join(_pkg, 'score', 'decision', 'relations', 'relations.js'), 'utf8');
        const identityRelBlock38 = relSrc38.slice(
            relSrc38.indexOf('function _identityDisposition'),
            relSrc38.indexOf('function dispositionOf')
        );
        const dispositionBlock38 = relSrc38.slice(
            relSrc38.indexOf('function dispositionOf'),
            relSrc38.indexOf('function isAllyOf')
        );
        eq(/get\.attitude\s*\(\s*zhu\s*,\s*p\s*\)/.test(idSrc38), false,
            '10.38 identity belief 不再使用宿主 get.attitude(zhu,p)');
        eq(identityRelBlock38.indexOf('get.attitude') >= 0, false,
            '10.38 identity disposition 分支不调用宿主 get.attitude');
        ok(relSrc38.indexOf("import { spyDispositionOf } from '../strategy/identityStance.js';") >= 0,
            '10.38 relations 的内奸立场委托统一 identityStance 权威');
        eq(identityRelBlock38.indexOf('.isFriend(') >= 0, false,
            '10.38 identity disposition helper 不调用宿主 isFriend');
        ok(dispositionBlock38.indexOf("if (_isIdentityMode()) return _identityDisposition(me, t);") >= 0,
            '10.38 disposition 在宿主 isFriend/get.attitude 之前先返回身份模式公平路径');
        ok(idSrc38.indexOf('isRolePossibleFor') >= 0,
            '10.38 逻辑可能性由 role slots 独立表达');
        eq(/\(b\.fan \|\| 0\) === 0|\(b\.zhong \|\| 0\) === 0/.test(relSrc38), false,
            '10.38 relations 不再用四舍五入 belief===0 判逻辑不可能');
        eq(idSrc38.indexOf('const otherId = identityOf(other)') >= 0, false,
            '10.38 基础行为 belief 不再混入匿名 identityOf(other)');
        ok(idSrc38.indexOf('const otherId = _publicRoleOf(other)') >= 0,
            '10.38 二阶行为证据只使用公开身份');

        /* 身份相关决策/学习链不得绕过 relations 重新调用宿主 get.attitude。 */
        const fairRelationFiles38 = [
            'score/decision/analysis/postCheck.js',
            'score/decision/safety/rescuePolicy.js',
            'score/cognition/metaCognition.js',
            'score/cognition/situationEval.js',
            'score/perception/discover/autoDiscover.js',
            'score/perception/feedback/elementFeedback.js',
            'score/perception/knowledge/sharedKnowledge.js',
            'score/model/calibrate/decisionCalibrator.js',
            'score/model/features/features.js',
            'score/decision/utility/deepValue.js',
            'score/decision/safety/modelGuard.js',
        ];
        for (const relPath38 of fairRelationFiles38) {
            const src38 = fs38.readFileSync(join(_pkg, ...relPath38.split('/')), 'utf8');
            eq(/get\.attitude\s*\(/.test(src38), false,
                '10.38 ' + relPath38 + ' 不得直接调用宿主 get.attitude');
        }
        const modeSrc38 = fs38.readFileSync(join(_pkg, 'score', 'decision', 'strategy', 'modeStrategy.js'), 'utf8');
        const genericEnemy38 = modeSrc38.slice(
            modeSrc38.indexOf('export function isEnemy(a, b)'),
            modeSrc38.indexOf('/* 快捷：应用模式加成 */')
        );
        ok(genericEnemy38.indexOf("return isLikelyEnemy(a, b);") >= 0 &&
            genericEnemy38.indexOf("const att = get.attitude(a, b);") >
            genericEnemy38.indexOf("return isLikelyEnemy(a, b);"),
            '10.38 modeStrategy.isEnemy 身份模式先走公平推断，再允许非身份模式 attitude fallback');
    } finally {
        host38.get.identityList = oldIdentityList38;
        host38.get.attitude = oldAtt38;
    }
}

/* ================= 10.39 Situation cache + single spy stance authority =================
 * A. 局面缓存必须在状态完全相同时复用，但同一 round 的 HP/手牌/装备/关系变化必须失效；
 * B. relations 与 modeStrategy 必须消费同一个内奸 stance 权威；
 * C. 测试汇总不再手工维护章节编号。
 */
{
    const host39 = await import(pathToFileURL(_hostPath).href);
    const id39 = await import(pathToFileURL(join(_pkg, 'score', 'perception', 'observer', 'identity.js')).href);
    const rel39 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'relations', 'relations.js')).href);
    const sit39 = await import(pathToFileURL(join(_pkg, 'score', 'cognition', 'situationEval.js')).href);
    const stance39 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'strategy', 'identityStance.js')).href);
    const mode39 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'strategy', 'modeStrategy.js')).href);
    const fs39 = await import('node:fs');

    function P39(name, identity, shown, hp, hand, equip) {
        return {
            name: name, name1: name, playerid: name,
            alive: true, hp: hp == null ? 4 : hp, maxHp: 4,
            identity: identity || '', identityShown: !!shown,
            _h: hand == null ? 0 : hand, _e: equip == null ? 0 : equip,
            countCards: function (z) {
                if (z === 'h' || z === 'hs') return this._h;
                if (z === 'e') return this._e;
                return 0;
            },
            getCards: function () { return []; },
        };
    }
    function install39(players, me, zhu, roles) {
        host39.game.me = me;
        host39.game.zhu = zhu;
        host39.game.players = players;
        host39.game.dead = [];
        host39.game.alivePlayers = players.filter(function (p) { return p.alive !== false; });
        host39._status.currentPhase = me;
        host39._status.roundNumber = 5;
        host39._status.mode = 'normal';
        host39.get.mode = function () { return 'identity'; };
        host39.get.identityList = function () { return roles.slice(); };
    }

    const oldIdentityList39 = host39.get.identityList;
    const oldAtt39 = host39.get.attitude;
    try {
        /* A. 同一 round 关系公开后，局面缓存必须看到新敌人；随后 HP 变化也必须重新估值。 */
        {
            const zhu = P39('zhu39a', 'zhu', true, 4, 0, 0);
            const me = P39('me39a', 'zhong', false, 4, 4, 1);
            const fan = P39('fan39a', 'fan', false, 8, 6, 3);
            const spy = P39('spy39a', 'nei', false, 4, 0, 0);
            install39([zhu, me, fan, spy], me, zhu, ['zhu','zhong','fan','nei']);
            host39.get.attitude = function () { return 0; };
            id39.resetBelief();

            const hiddenValue = sit39.evaluateSituation(me);
            eq(sit39.evaluateSituation(me), hiddenValue,
                '10.39 状态完全相同 → situation cache 返回相同估值');

            fan.identityShown = true;
            id39.resetBelief();
            const revealedValue = sit39.evaluateSituation(me);
            ok(revealedValue !== hiddenValue,
                '10.39 同一 round 身份关系公开 → situation cache 失效并重新估值');

            fan.hp = 1;
            const hpChangedValue = sit39.evaluateSituation(me);
            ok(hpChangedValue !== revealedValue,
                '10.39 同一 round HP 变化 → situation cache 失效并重新估值');
        }

        /* B. 内奸 stance 只有 identityStance.js 一个强弱/阈值权威。 */
        {
            const zhu = P39('zhu39b', 'zhu', true, 4, 2, 0);
            const spy = P39('spy39b', 'nei', false, 4, 2, 0);
            const f1 = P39('f39b1', 'fan', true, 4, 2, 0);
            const f2 = P39('f39b2', 'fan', true, 4, 2, 0);
            const f3 = P39('f39b3', 'fan', true, 4, 2, 0);
            const f4 = P39('f39b4', 'fan', true, 4, 2, 0);
            const x = P39('x39b', 'fan', false, 4, 2, 0);
            const y = P39('y39b', 'zhong', false, 4, 2, 0);
            install39([zhu, spy, f1, f2, f3, f4, x, y], spy, zhu,
                ['zhu','zhong','zhong','nei','fan','fan','fan','fan']);
            host39.get.attitude = function (from, to) {
                return to && to.identity === 'fan' ? -9 : 9;
            };
            id39.resetBelief();

            const centralDisposition = stance39.spyDispositionOf(spy, f1);
            eq(rel39.dispositionOf(spy, f1), centralDisposition,
                '10.39 relations 内奸敌友 = identityStance 统一结果');

            const centralBonus = stance39.spyAttackBonus(spy, f1);
            const modeBonus = mode39.MODE_STRATEGIES.identity.decisionBoost(spy, {
                type: 'card', id: 'sha', target: f1.name1,
            });
            eq(modeBonus, centralBonus,
                '10.39 modeStrategy 内奸攻击加成 = identityStance 统一结果');

            const beforeHidden = JSON.stringify(stance39.evaluateSpyStance(spy));
            x.identity = 'zhong';
            const afterHidden = JSON.stringify(stance39.evaluateSpyStance(spy));
            eq(afterHidden, beforeHidden,
                '10.39 hidden identity 字段变化不影响内奸 stance');

            f3.alive = false;
            f4.alive = false;
            host39.game.alivePlayers = host39.game.players.filter(function (p) { return p.alive !== false; });
            const flipped = stance39.evaluateSpyStance(spy);
            eq(flipped.dominantSide, 'loyal',
                '10.39 公开存活局势翻转 → central stance 同步翻转');
        }

        /* 源码守卫。 */
        const sitSrc39 = fs39.readFileSync(join(_pkg, 'score', 'cognition', 'situationEval.js'), 'utf8');
        const relSrc39 = fs39.readFileSync(join(_pkg, 'score', 'decision', 'relations', 'relations.js'), 'utf8');
        const modeSrc39 = fs39.readFileSync(join(_pkg, 'score', 'decision', 'strategy', 'modeStrategy.js'), 'utf8');
        const stanceSrc39 = fs39.readFileSync(join(_pkg, 'score', 'decision', 'strategy', 'identityStance.js'), 'utf8');

        ok(sitSrc39.indexOf('_cacheRound = r;') >= 0 &&
            sitSrc39.indexOf('relationStateKey(me)') >= 0 &&
            sitSrc39.indexOf("countCards('h')") >= 0 &&
            sitSrc39.indexOf("countCards('e')") >= 0,
            '10.39 situation cache 同时绑定 round / relation / HP-手牌-装备状态');
        ok(relSrc39.indexOf('spyDispositionOf(me, t)') >= 0 &&
            relSrc39.indexOf('function _identitySpyDisposition') < 0,
            '10.39 relations 不再维护第二套内奸 stance');
        ok(modeSrc39.indexOf('spyAttackBonus(me, tgt)') >= 0 &&
            modeSrc39.indexOf('let loyalMass = 0, rebelMass = 0') < 0,
            '10.39 modeStrategy 不再重算内奸阵营强弱');
        ok(stanceSrc39.indexOf('SPY_STANCE_MARGIN') >= 0 &&
            stanceSrc39.indexOf('spyDispositionOf') >= 0 &&
            stanceSrc39.indexOf('spyAttackBonus') >= 0,
            '10.39 identityStance 集中管理内奸阈值、敌友与攻击加成');
    } finally {
        host39.get.identityList = oldIdentityList39;
        host39.get.attitude = oldAtt39;
    }
}


/* ================= 10.40 Identity boundary completion：engine / ordering / revision / precision =================
 * 补齐 PR #10 审计剩余项：
 * A. 相同公开信息下，game.players 遍历顺序不得改变 posterior；
 * B. engine 决策/学习/历史记录不得读取未公开 target.identity；
 * C. 一次 card event 只推进一次 observation revision；
 * D. 决策置信度保留完整精度，禁止两位小数跨阈值。
 */
{
    const fs40 = await import('node:fs');
    const host40 = await import(pathToFileURL(_hostPath).href);
    const obs40 = await import(pathToFileURL(join(_pkg, 'score', 'perception', 'observer', 'observer.js')).href);
    const id40 = await import(pathToFileURL(join(_pkg, 'score', 'perception', 'observer', 'identity.js')).href);

    function P40(name, identity, shown) {
        return {
            name: name, name1: name, playerid: name, alive: true, hp: 4, maxHp: 4,
            identity: identity || '', identityShown: !!shown,
            _h: [], _e: [], _j: [],
            countCards: function () { return 0; },
            getCards: function () { return []; },
        };
    }

    const oldMode40 = host40.get.mode;
    const oldIdentityList40 = host40.get.identityList;
    const oldStatusMode40 = host40._status.mode;
    try {
        const zhu = P40('zhu40', 'zhu', true);
        const me = P40('me40', 'zhong', false);
        const shownFan = P40('shownFan40', 'fan', true);
        const x = P40('x40', 'fan', false);
        const n = P40('n40', 'nei', false);

        host40.game.me = me;
        host40.game.zhu = zhu;
        host40.game.dead = [];
        host40.game.players = [zhu, me, shownFan, x, n];
        host40.game.alivePlayers = host40.game.players.slice();
        host40._status.currentPhase = me;
        host40._status.roundNumber = 4;
        host40._status.mode = 'normal';
        host40.get.mode = function () { return 'identity'; };
        host40.get.identityList = function (count) {
            if (count === 5) return ['zhu', 'zhong', 'fan', 'fan', 'nei'];
            return [];
        };

        obs40.resetObs();
        id40.resetBelief();
        obs40.observeAttack(shownFan, x, 1);
        const bOrder1 = id40.beliefOfFor(me, x);

        host40.game.players = [n, x, shownFan, me, zhu];
        host40.game.alivePlayers = host40.game.players.slice();
        id40.resetBelief();
        const bOrder2 = id40.beliefOfFor(me, x);
        eq(JSON.stringify(bOrder2), JSON.stringify(bOrder1),
            '10.40 相同公开事实仅改变 game.players 顺序 → posterior 完全不变');

        /* 一张带直接统计 + attack/aid 委托的牌，只能推进一次 revision。 */
        obs40.resetObs();
        const rev0 = obs40.getObservationRevision();
        obs40.observeCardUse(me, { name: 'tao' }, x);
        const rev1 = obs40.getObservationRevision();
        eq(rev1 - rev0, 1, '10.40 桃 card event → observation revision 只递增一次');
        obs40.observeCardUse(me, { name: 'guohe' }, x);
        const rev2 = obs40.getObservationRevision();
        eq(rev2 - rev1, 1, '10.40 过河拆桥 card event → observation revision 只递增一次');

        const engSrc40 = readDecisionSources();
        const idSrc40 = fs40.readFileSync(join(_pkg, 'score', 'perception', 'observer', 'identity.js'), 'utf8');

        eq(engSrc40.indexOf('const tid = dyingAlly.identity') < 0, true,
            '10.40 桃救援价值不直接读取 dyingAlly.identity');
        eq(/tgtIdentity:\s*bestT\s*&&\s*bestT\.identity/.test(engSrc40), false,
            '10.40 autoFeature 不把 hidden target.identity 写入学习特征');
        eq(/real:\s*p\.identity/.test(engSrc40), false,
            '10.40 身份历史快照不再持久化 hidden real identity');
        ok(engSrc40.indexOf('public: publicIdentity') >= 0 &&
            engSrc40.indexOf('_beliefOfFor(observer, p)') >= 0,
            '10.40 历史身份快照只保存 public identity + observer-specific posterior');
        ok(engSrc40.indexOf("expose = (p === game.zhu) || !!p.identityShown || p.identity === 'mingzhong';") >= 0,
            '10.40 identity hidden-reward 只把公开身份目标视为已暴露');
        ok(/if \(mode === 'identity'\)[\s\S]{0,900}return 'unknown';[\s\S]{0,250}return \(player && player\.identity\) \|\| 'unknown';/.test(engSrc40),
            '10.40 _campOf 在 identity 模式先返回 unknown，非身份模式才允许宿主 identity fallback');

        const confStart40 = idSrc40.indexOf('export function confidenceOfFor');
        const confEnd40 = idSrc40.indexOf('export function identityOf(p)', confStart40);
        const confBlock40 = idSrc40.slice(confStart40, confEnd40);
        eq(confBlock40.indexOf('Math.round') < 0, true,
            '10.40 confidenceOfFor 决策值保留完整精度，不因四舍五入跨阈值');
        eq(idSrc40.indexOf('b.fan *= weight') < 0 &&
            idSrc40.indexOf('b.zhong *= weight') < 0 &&
            idSrc40.indexOf('b.nei *= weight') < 0, true,
            '10.40 移除归一化前等比例放大的伪“回合权重”');
    } finally {
        host40.get.mode = oldMode40;
        host40.get.identityList = oldIdentityList40;
        host40._status.mode = oldStatusMode40;
    }
}


/* ================= 10.41 Strategic Transition Ledger V2 =================
 * A. create-state 只有真实落区才确认；被无懈/未生效不得留下假 commitment；
 * B. remove-target-card 只有真实移除战略状态才写 REMOVE；
 * C. CREATE→REMOVE 与 REMOVE→CREATE 都是 soft penalty；
 * D. actor / target / turn epoch 隔离；同角色额外回合也清空；
 * E. engine 候选评分只消费通用 strategic operation，不靠具体牌名单触发。
 */
{
    const fs41 = await import('node:fs');
    const host41 = await import(pathToFileURL(_hostPath).href);
    const tss41 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'state', 'turnStrategicState.js')).href);
    const terms41 = await import(pathToFileURL(join(_pkg, 'score', 'foundation', 'adapt', 'terms.js')).href);

    function C41(id) { return { name: id }; }
    function P41(name, rel, o) {
        o = o || {};
        return {
            name: name, name1: name, playerid: name, rel: rel, alive: true, hp: 4, maxHp: 4,
            _h: o.h || [], _e: o.e || [], _j: o.j || [],
            countCards: function (z) {
                if (z === 'h') return this._h.length;
                if (z === 'e') return this._e.length;
                if (z === 'j') return this._j.length;
                return 0;
            },
            getCards: function (z) {
                if (z === 'h') return this._h;
                if (z === 'e') return this._e;
                if (z === 'j') return this._j;
                return [];
            },
        };
    }

    const me = P41('me41', 1);
    const other = P41('other41', 1);
    const enemy = P41('enemy41', -1);
    const enemy2 = P41('enemy42', -1);
    const rctx = { relationOf: function (_me, t) { return t.rel; } };

    host41.game.me = me;
    host41.game.players = [me, other, enemy, enemy2];
    host41.game.alivePlayers = host41.game.players.slice();
    host41._status.currentPhase = me;

    eq(terms41.strategicEffectOf('lebu').operation, 'create-state',
        '10.41 乐由 profile 映射为 create-state');
    eq(terms41.strategicEffectOf('shunshou').operation, 'remove-target-card',
        '10.41 顺由 profile 映射为 remove-target-card');

    /* A1. 被无懈/未落区：pending 结案但不得制造 CREATE。 */
    tss41.beginStrategicTurn(me);
    tss41.beginStrategicAction(me, 'lebu', enemy, rctx);
    eq(tss41.getStrategicRecords().length, 0,
        '10.41 useCard 时只记录 pending，不提前宣称 CREATE');
    eq(tss41.getPendingStrategicActions().length, 1,
        '10.41 create-state 动作前快照进入 pending');
    tss41.reconcileStrategicTransitions(me, rctx);
    eq(tss41.getStrategicRecords().length, 0,
        '10.41 乐未进入判定区（如被无懈）→ 不产生假 commitment');

    /* A2. 真实落区：下一决策 reconcile 后确认 CREATE。 */
    tss41.beginStrategicAction(me, 'lebu', enemy, rctx);
    enemy._j.push(C41('lebu'));
    const made = tss41.reconcileStrategicTransitions(me, rctx);
    ok(made.some(function (x) { return x.operation === 'create-state'; }),
        '10.41 乐真实落区 → 确认 CREATE');
    const destroyAfterCreate = tss41.evaluateDestroyPenalty(me, enemy, rctx);
    eq(destroyAfterCreate.selfCreated, true,
        '10.41 已确认 CREATE 后，同 actor 识别 self-created');
    ok(destroyAfterCreate.effectivePenalty > 0,
        '10.41 CREATE→REMOVE 敌方有利状态存在 soft opportunity cost');

    /* actor 隔离：另一角色不能把我的 CREATE 当成自己的 commitment。 */
    eq(tss41.evaluateRemovalChoice(other, enemy, enemy._j[0], rctx).selfCreated, false,
        '10.41 self-created 必须匹配 actor，不跨角色串账');
    /* CREATE 后若状态被别人/自然结算移除，再次补挂不属于自己的反向操作。 */
    enemy._j.length = 0;
    eq(tss41.evaluateCreateConsistency(me, enemy, 'lebu', rctx).penalty, 0,
        '10.41 自建状态被外部移除后重新补挂 → 不误判为 self reversal');
    enemy._j.push(C41('lebu'));


    /* B1. 顺/拆若拿走装备而非状态，不得写 REMOVE-state。 */
    tss41.beginStrategicTurn(me);
    enemy._j = [C41('lebu')];
    enemy._e = [C41('weapon41')];
    tss41.beginStrategicAction(me, 'guohe', enemy, rctx);
    enemy._e.length = 0;
    tss41.reconcileStrategicTransitions(me, rctx);
    eq(tss41.getStrategicRecords().filter(function (x) { return x.operation === 'remove-state'; }).length, 0,
        '10.41 过河只拆装备、判定状态仍在 → 不误记 REMOVE-state');

    /* B2/C. 真正移除兵粮后，再给同目标兵粮应识别 REMOVE→CREATE reversal。 */
    tss41.beginStrategicTurn(me);
    enemy._j = [C41('bingliang')];
    tss41.beginStrategicAction(me, 'shunshou', enemy, rctx);
    enemy._j.length = 0;
    const removed = tss41.reconcileStrategicTransitions(me, rctx);
    ok(removed.some(function (x) { return x.operation === 'remove-state'; }),
        '10.41 顺手真实拿走兵粮 → 写 REMOVE-state');
    const recreate = tss41.evaluateCreateConsistency(me, enemy, 'bingliang', rctx);
    ok(recreate.penalty > 0 && Number.isFinite(recreate.penalty),
        '10.41 REMOVE→同目标CREATE → 有限 reversal penalty');
    eq(tss41.evaluateCreateConsistency(me, enemy2, 'bingliang', rctx).penalty, 0,
        '10.41 REMOVE 后换目标 CREATE → 不视为反转');

    /* D. 同一个角色获得额外回合：显式 phaseBegin epoch 也必须清空旧 ledger。 */
    tss41.beginStrategicTurn(me);
    enemy._j = [C41('lebu')];
    tss41.recordStateCreation(me, enemy, 'lebu', rctx);
    const epoch1 = tss41.getStrategicTurnEpoch();
    eq(tss41.getStrategicRecords().length, 1, '10.41 当前回合存在 confirmed ledger');
    const epoch2 = tss41.beginStrategicTurn(me);
    ok(epoch2 > epoch1, '10.41 同角色额外回合也创建新 turn epoch');
    eq(tss41.getStrategicRecords().length, 0,
        '10.41 同角色额外回合清空上一回合 strategic ledger');

    /* E. 源码守卫：engine 不再在 useCard 时按乐/兵硬编码记 commitment；
     * transition evaluator 独立于“拆牌/延时类打敌”具体牌列表。 */
    const eng41 = readDecisionSources();
    const tssSrc41 = fs41.readFileSync(join(_pkg, 'score', 'decision', 'state', 'turnStrategicState.js'), 'utf8');
    const opt41 = fs41.readFileSync(join(_pkg, 'score', 'decision', 'safety', 'optimization.js'), 'utf8');

    ok(eng41.indexOf('beginStrategicAction(me, _cid, _target') >= 0,
        '10.41 engine useCard 对任意 strategic operation 只建 pending');
    eq(eng41.indexOf("if (_cid === 'lebu' || _cid === 'bingliang')") < 0, true,
        '10.41 engine 不再按乐/兵具体牌名记录 commitment');
    ok(eng41.indexOf('reconcileStrategicTransitions(_stMe') >= 0,
        '10.41 每次 bestAction 前先按真实状态 reconcile pending');
    ok(eng41.indexOf('const tp = evaluateActionTransitionPenalty(me, cardTarget, id') >= 0,
        '10.41 transition evaluator 使用候选自身绑定目标，而非全局 bestT');
    ok(tssSrc41.indexOf("operation === 'remove-state'") >= 0 &&
       tssSrc41.indexOf("operation === 'create-state'") >= 0,
        '10.41 ledger 同时表达 CREATE 与 confirmed REMOVE');
    eq(/const\s+(DELAYED_CONTROL_IDS|PROVENANCE_IDS)\s*=/.test(tssSrc41), false,
        '10.41 核心 ledger 不维护乐/兵专用名单');
    ok(opt41.indexOf("idsWithStrategicOperation('remove-target-card')") >= 0,
        '10.41 button hook 按 profile operation 自动枚举');
    ok(opt41.indexOf('uninstallButtonHooks();') >= 0,
        '10.41 generic button hook 有对称卸载路径');
}


/* ================= 10.42 Wuxie Host Bridge V2 =================
 * 真实宿主链路：_wuxie → chooseToUse({type:'wuxie', info_map, state})。
 * 验收：
 * A. 官方 info_map/state 优先于 parent-chain 猜测；
 * B. 回合外响应不受 currentPhase guard 阻断；
 * C. unresolved 原生 ai1 原样保留；
 * D. 顺/拆按“一次一张 + 行动方最优合法选择”估值；
 * E. AOE 按实际 targets 净效用；
 * F. 不读取隐藏手牌内容 / 不维护第二套最终政策。
 */
{
    const fs42 = await import('node:fs');
    const fx42 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'response', 'wuxieEvaluator.js')).href);
    const use42 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'override', 'use.js')).href);
    const wt42 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'timing', 'wuxieTiming.js')).href);

    function C42(id) { return { name: id }; }
    function P42(name, rel, o) {
        o = o || {};
        return {
            name: name, name1: name, playerid: name, rel: rel, alive: true,
            hp: o.hp == null ? 4 : o.hp, maxHp: 4,
            _h: o.h == null ? 0 : o.h, _e: o.e || [], _j: o.j || [],
            countCards: function (z, filter) {
                if (z === 'h') return this._h;
                if (z === 'hs') return this._h;
                return 0;
            },
            getCards: function (z) {
                if (z === 'e') return this._e;
                if (z === 'j') return this._j;
                return [];
            },
            isOnline2: function () { return false; },
        };
    }
    const rel42 = function (_me, t) { return t && typeof t.rel === 'number' ? t.rel : 0; };
    const me42 = P42('me42', 1, { h: 2 });
    const ally42 = P42('ally42', 1, { h: 1 });
    const enemy42 = P42('enemy42', -1, { h: 2 });
    const human42 = P42('human42', 1);
    hostStub.game.me = human42;
    hostStub.game.players = [human42, me42, ally42, enemy42];
    hostStub.game.alivePlayers = hostStub.game.players.slice();

    eq(typeof fx42.resolveWuxieHostContext, 'function', '10.42 导出 resolveWuxieHostContext');
    eq(typeof use42._bridgeWuxieChooseToUse, 'function', '10.42 use.js 导出 wuxie host bridge');

    /* A1. 官方普通无懈 request：state=+1 表示原锦囊即将生效。 */
    const reqLebu42 = {
        type: 'wuxie', state: 1,
        info_map: {
            card: C42('lebu'),
            player: enemy42,
            target: ally42,
            targets: [ally42],
            state: 1,
        },
        ai1: function () { return 0; },
    };
    const hc42 = fx42.resolveWuxieHostContext(me42, reqLebu42, {});
    eq(hc42.resolved, true, '10.42 host info_map 乐可直接解析');
    eq(hc42.originalSpellId, 'lebu', '10.42 host info_map 原锦囊=lebu');
    eq(hc42.source, enemy42, '10.42 host info_map source 正确');
    eq(hc42.target, ally42, '10.42 host info_map target 正确');
    eq(hc42.hostState, 1, '10.42 host state=+1 保留');
    eq(hc42.currentlyNegated, false, '10.42 state=+1 → 原锦囊当前未被抵消');

    /* A2. 反无懈：当前 card=wuxie，但 _source 指向原始锦囊；state=-1 权威表示原锦囊已被抵消。 */
    const reqCounter42 = {
        type: 'wuxie', state: -1,
        info_map: {
            card: C42('wuxie'),
            player: enemy42,
            state: -1,
            _source: {
                card: C42('lebu'),
                player: enemy42,
                target: ally42,
                targets: [ally42],
            },
        },
        ai1: function () { return 9; },
    };
    const hcCounter42 = fx42.resolveWuxieHostContext(me42, reqCounter42, {});
    eq(hcCounter42.originalSpellId, 'lebu', '10.42 counter-wuxie 仍追到原始 lebu');
    eq(hcCounter42.hostState, -1, '10.42 counter-wuxie 读取宿主 state=-1');
    eq(hcCounter42.currentlyNegated, true, '10.42 state=-1 → 原锦囊当前已被抵消');
    eq(hcCounter42.inWuxieChain, true, '10.42 _source/current=wuxie → 识别反无懈链');
    eq(fx42.evaluateWuxie(me42, reqCounter42, { relationOf: rel42, hostRequest: reqCounter42, wuxieCount: 2 }).use,
        false, '10.42 对有害乐：宿主已是失效态时不反无懈恢复它');

    /* B. 真正的实战根因回归：响应者不是 currentPhase，bridge 仍须接管 type=wuxie 的 ai1。 */
    hostStub._status.currentPhase = enemy42;
    const reqSelf42 = {
        type: 'wuxie', state: 1,
        info_map: { card: C42('lebu'), player: enemy42, target: me42, targets: [me42], state: 1 },
        ai1: function () { return 0; },
    };
    const br42 = use42._bridgeWuxieChooseToUse(me42, [reqSelf42]);
    eq(br42.isWuxie, true, '10.42 回合外 type=wuxie 被窄范围识别');
    eq(br42.resolved, true, '10.42 回合外无懈 request 可解析');
    eq(br42.use, true, '10.42 敌人乐自己 → bridge 判定使用无懈');
    eq(br42.bridged, true, '10.42 resolved request 实际改写宿主 ai1');
    ok(reqSelf42.ai1(C42('wuxie')) > 0, '10.42 currentPhase≠响应者时 ai1 仍获得正分，不再“捏死”');

    /* C. unresolved 必须完全 fail-open：原生 ai1 函数引用不变。 */
    const nativeAi42 = function () { return 7; };
    const reqUnknown42 = {
        type: 'wuxie', state: 1,
        info_map: { card: C42('wuxie'), state: 1 },
        ai1: nativeAi42,
    };
    const brUnknown42 = use42._bridgeWuxieChooseToUse(me42, [reqUnknown42]);
    eq(brUnknown42.resolved, false, '10.42 无原始锦囊事实 → unresolved');
    eq(brUnknown42.bridged, false, '10.42 unresolved 不改写宿主策略');
    eq(reqUnknown42.ai1, nativeAi42, '10.42 unresolved 原生 ai1 引用原样保留');
    eq(reqUnknown42.ai1(), 7, '10.42 unresolved 原生 ai1 行为原样保留');

    /* C2. hardOverride=false 时必须完全尊重“只评分、不改宿主选择”的配置语义。 */
    hostStub._configStore['extension_无名AI_hardOverride'] = false;
    const nativeOff42 = function () { return 5; };
    const reqOff42 = {
        type: 'wuxie', state: 1,
        info_map: { card: C42('lebu'), player: enemy42, target: me42, targets: [me42], state: 1 },
        ai1: nativeOff42,
    };
    const brOff42 = use42._bridgeWuxieChooseToUse(me42, [reqOff42]);
    eq(brOff42.bridged, false, '10.42 hardOverride=false → Wuxie bridge 不改写');
    eq(reqOff42.ai1, nativeOff42, '10.42 hardOverride=false → 原生 ai1 引用不变');
    delete hostStub._configStore['extension_无名AI_hardOverride'];

    /* D. 顺/拆：行动方按最优合法选择，而不是“有乐就默认帮忙拆乐”或把所有装备求和。 */
    const allyOnlyLebu42 = P42('allyOnlyLebu42', 1, { h: 0, j: [C42('lebu')] });
    const allyLebuBagua42 = P42('allyLebuBagua42', 1, { h: 0, j: [C42('lebu')], e: [C42('bagua')] });
    const allyTwoEquip42 = P42('allyTwoEquip42', 1, { h: 0, e: [C42('bagua'), C42('zhuge')] });

    function dec42(id, target, extra) {
        return fx42.evaluateWuxie(me42, null, Object.assign({
            originalSpellId: id, source: enemy42, target: target,
            relationOf: rel42, wuxieCount: 2,
        }, extra || {}));
    }
    eq(dec42('guohe', allyOnlyLebu42).use, false,
        '10.42 敌方过河：我方只有乐可拆 → 放行（让其帮忙解乐）');
    eq(dec42('guohe', allyLebuBagua42).use, true,
        '10.42 敌方过河：乐+八卦 → 假设敌人拆八卦，应该无懈');
    eq(dec42('shunshou', allyLebuBagua42).use, true,
        '10.42 敌方顺手：乐+八卦 → 假设敌人拿最有利牌，应该无懈');
    eq(fx42.evaluateTrickEffect(me42, {
            originalSpellId: 'guohe', source: enemy42, target: allyTwoEquip42,
        }, { relationOf: rel42 }), -3.5,
        '10.42 两件关键装备一次过河仍只按“最好的一件”计，不把所有装备求和');

    /* E. 多目标 AOE 使用实际 targets 净效用。 */
    const allyA42 = P42('allyA42', 1), allyB42 = P42('allyB42', 1);
    const enemyA42 = P42('enemyA42', -1), enemyB42 = P42('enemyB42', -1), enemyC42 = P42('enemyC42', -1);
    const aoeGood42 = fx42.evaluateWuxie(me42, null, {
        originalSpellId: 'nanman', source: enemy42,
        targets: [allyA42, allyB42, enemyA42, enemyB42, enemyC42],
        relationOf: rel42, wuxieCount: 2,
    });
    eq(aoeGood42.use, false, '10.42 AOE 敌方受损更多、净效用对我方有利 → 不无懈');
    const aoeBad42 = fx42.evaluateWuxie(me42, null, {
        originalSpellId: 'nanman', source: enemy42,
        targets: [me42, allyA42, allyB42, enemyA42],
        relationOf: rel42, wuxieCount: 2,
    });
    eq(aoeBad42.use, true, '10.42 AOE 我方受损更多 → 使用无懈');

    /* F. 结构守卫：真实 host bridge 在 generic currentPhase hard override 之前，且 timing 不再解析中文 reason。 */
    const useSrc42 = fs42.readFileSync(join(_pkg, 'score', 'decision', 'override', 'use.js'), 'utf8');
    const wxSrc42 = fs42.readFileSync(join(_pkg, 'score', 'decision', 'response', 'wuxieEvaluator.js'), 'utf8');
    const wtSrc42 = fs42.readFileSync(join(_pkg, 'score', 'decision', 'timing', 'wuxieTiming.js'), 'utf8');

    const bridgeCall42 = useSrc42.indexOf('const wuxieBridge = _bridgeWuxieChooseToUse(player, args)');
    const genericCall42 = useSrc42.indexOf('return _runChooseToUse.call(this, player, ev, orig, args)');
    ok(bridgeCall42 >= 0 && genericCall42 > bridgeCall42,
        '10.42 wuxie bridge 先于 generic chooseToUse/currentPhase hard override');
    ok(/req\.type !== 'wuxie'/.test(useSrc42),
        '10.42 host bridge 严格限定 type=wuxie，不扩大回合外接管面');
    ok(/request\.info_map/.test(wxSrc42) && /request\.state/.test(wxSrc42) && /map\._source/.test(wxSrc42),
        '10.42 evaluator 直接消费宿主 info_map/state/_source');
    eq(wxSrc42.indexOf("countCards('h', function (c)") >= 0, true,
        '10.42 仅统计自己的无懈数量；顺拆手牌估值只依赖 countCards 数量');
    eq(wtSrc42.indexOf("reason.indexOf('待定')") < 0, true,
        '10.42 wuxieTiming fail-open 不再依赖中文 reason 文本');
    eq(wt42.wuxieBonus(me42, { id: 'wuxie' }), 1.0,
        '10.42 engine 缺少实时 spell context 时 wuxieBonus 保持中性 1.0');
}


/* ================= 10.43 Skill Decision Kernel V2 =================
 * A. 裸 target 不再等价于敌人：效果语义决定 support/offense；
 * B. 未登记的新技能能自动生成 __targets / intent / confidence；
 * C. 每技能先过宿主 filterTarget，复杂依赖选牌时 fail-open；
 * D. support/offense 只在正确关系目标中推荐；
 * E. chooseTarget / chooseCardTarget 宿主桥可承接推荐目标，且 .set('ai') 后写不会覆盖；
 * F. 无高置信/不匹配 skill action 时完全 fail-open。
 */
{
    const fs43 = await import('node:fs');
    const sc43 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'skills', 'skillScanner.js')).href);
    const sk43 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'skills', 'skills.js')).href);
    const sp43 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'skills', 'skillPlayBrain.js')).href);
    const eng43 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'engine', 'engine.js')).href);
    const ao43 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'safety', 'aiOverride.js')).href);
    const host43 = await import(pathToFileURL(join(_pkg, 'score', 'foundation', 'adapt', 'host.js')).href);

    /* A1. 增益作用于 target → support/ally，不再误判“资敌”。 */
    const supportSrc43 = `
        async function content(event, trigger, player) {
            const { target } = event;
            await target.recover();
            if (target.isDamaged()) await target.draw(2);
        }
    `;
    const support43 = sc43.scanObjectMethod(supportSrc43, { skill: { enable: 'phaseUse' } });
    ok((support43.recover || 0) > 0, '10.43 target.recover → 正向 recover');
    ok((support43.draw || 0) > 0, '10.43 target.draw → 正向 draw');
    eq(Number(support43.feedRecover || 0), 0, '10.43 target.recover 不再默认 feedRecover');
    eq(Number(support43.feedDraw || 0), 0, '10.43 target.draw 不再默认 feedDraw');
    eq(support43.__targetIntent, 'support', '10.43 增益 target 自动识别 support');
    eq((support43.__targets || [])[0], 'ally', '10.43 增益 target 自动生成 ally 目标');
    ok((support43.__targetConfidence || 0) >= 0.7 && (support43.__targetConfidence || 0) < 1,
        '10.43 自动 support 推断为高但非满置信度');

    /* A2. 负面作用于 target → offense/enemy。 */
    const offense43 = sc43.scanObjectMethod(`
        function content(event, trigger, player) {
            event.target.damage();
            event.target.discard();
        }
    `, { skill: { enable: 'phaseUse' } });
    ok((offense43.damage || 0) > 0, '10.43 target.damage → 对敌正收益 damage');
    ok((offense43.discardEnemy || 0) > 0, '10.43 target.discard → 对敌正收益 discardEnemy');
    eq(offense43.__targetIntent, 'offense', '10.43 负面 target 自动识别 offense');
    eq((offense43.__targets || [])[0], 'enemy', '10.43 负面 target 自动生成 enemy 目标');

    /* A3. 同时有明显正负目标效果 → mixed，不强行单方向。 */
    const mixed43 = sc43.scanObjectMethod(`
        function content(event) {
            event.target.recover();
            event.target.damage();
        }
    `, { skill: { enable: 'phaseUse' } });
    eq(mixed43.__targetIntent, 'mixed', '10.43 正负目标效果并存 → mixed');
    ok((mixed43.__targets || []).includes('ally') && (mixed43.__targets || []).includes('enemy'),
        '10.43 mixed 同时保留 ally/enemy');

    /* A4. 语义本身有歧义的效果不能仅凭 target 名字强推敌友。 */
    const ambiguous43 = sc43.scanObjectMethod(`
        function content(event) {
            event.target.addSkill('some_skill');
            event.target.turnOver();
        }
    `, { skill: { enable: 'phaseUse' } });
    eq(ambiguous43.__targetIntent, undefined,
        '10.43 addSkill/turnOver 等歧义效果无显式关系证据 → 不自动定向');
    eq((ambiguous43.__targets || []).length, 0,
        '10.43 歧义目标效果保持 fail-open，不生成 ally/enemy 目标');

    /* B. 模拟“炜烈类”未知技能：不写 ID 特判，源码扫描自动形成 ally/support profile。 */
    const SID43 = 'kernel_support_fixture_alpha';
    host43.lib.skill[SID43] = {
        enable: 'phaseUse',
        filterTarget: (card, player, target) => target.isDamaged(),
        filterCard: true,
        content: async function (event, trigger, player) {
            const target = event.target;
            await target.recover();
            if (target.isDamaged()) await target.draw(2);
        },
    };
    host43.lib.translate[SID43 + '_info'] = '弃置一张牌，令一名已受伤角色回复体力，若仍受伤则摸牌。';
    sk43.scanReset();
    const tags43 = sk43.skillTagsOf(SID43);
    const prof43 = sk43.skillProfileOf(SID43);
    eq((tags43.__targets || [])[0], 'ally', '10.43 未登记技能自动得到 ally targets');
    eq(tags43.__targetIntent, 'support', '10.43 未登记技能自动得到 support intent');
    eq(prof43.targets.category, 'ally', '10.43 profile 目标类别=ally');
    eq(prof43.targets.intent, 'support', '10.43 profile 保留 support intent');
    ok(prof43.targets.confidence >= 0.7 && prof43.targets.confidence < 1,
        '10.43 profile 保留自动推断置信度且不冒充手工 1.0');

    /* C. filterTarget 合法性：已受伤可选，满血不可选。 */
    const me43 = { name: 'me43', name1: 'me43', playerid: 'me43' };
    const allyDamaged43 = {
        name: 'allyDamaged43', name1: 'allyDamaged43', playerid: 'allyDamaged43',
        hp: 2, maxHp: 4, isDamaged: () => true,
    };
    const allyFull43 = {
        name: 'allyFull43', name1: 'allyFull43', playerid: 'allyFull43',
        hp: 4, maxHp: 4, isDamaged: () => false,
    };
    const enemyDamaged43 = {
        name: 'enemyDamaged43', name1: 'enemyDamaged43', playerid: 'enemyDamaged43',
        hp: 2, maxHp: 4, isDamaged: () => true,
    };
    eq(eng43._isLegalSkillTarget(SID43, me43, allyDamaged43), true,
        '10.43 filterTarget：受伤角色合法');
    eq(eng43._isLegalSkillTarget(SID43, me43, allyFull43), false,
        '10.43 filterTarget：满血角色非法');

    /* 依赖所选卡牌的 filterTarget：预选阶段不能确证非法 → fail-open。 */
    const CARD_DEP43 = 'kernel_carddep_fixture_alpha';
    host43.lib.skill[CARD_DEP43] = {
        enable: 'phaseUse',
        filterCard: true,
        filterTarget: function (card, player, target) { return !!card && target.isDamaged(); },
        content: function () {},
    };
    eq(eng43._isLegalSkillTarget(CARD_DEP43, me43, allyDamaged43), true,
        '10.43 card-dependent filterTarget 在无 card 快照时 fail-open');

    /* C2. self-only 技能不能被“无外部目标”规则误伤；target intent 高于粗分类。 */
    eq(eng43._skillNeedsExternalTarget('self_only_43', { tags: { __targets: ['self'] } }), false,
        '10.43 self-only 技能不要求外部目标');
    eq(eng43._skillNeedsExternalTarget('ally_skill_43', { tags: { __targets: ['ally'] } }), true,
        '10.43 ally 技能要求外部目标');
    eq(eng43._skillPurposeFromIntent('support', 'draw', 0.75), 'support',
        '10.43 support intent 覆盖 category=draw，避免把给牌/摸牌辅助误映射 attack');
    eq(eng43._skillPurposeFromIntent('support', 'draw', 0.4), null,
        '10.43 低置信 support intent 不生成宿主强方向');
    eq(eng43._skillPurposeFromIntent('mixed', 'attack', 1), null,
        '10.43 mixed intent 不被粗分类强制成单方向');

    /* C3. 原生 skill effect 方向守卫不依赖 bestAction。 */
    eq(ao43.skillTargetDirectionAdjustment('support', 0.75, -1), -12,
        '10.43 原生技能评估：support→敌方 强负修正');
    eq(ao43.skillTargetDirectionAdjustment('support', 0.75, 1), 1.5,
        '10.43 原生技能评估：support→友方 正修正');
    eq(ao43.skillTargetDirectionAdjustment('offense', 0.75, 1), -12,
        '10.43 原生技能评估：offense→友方 强负修正');
    eq(ao43.skillTargetDirectionAdjustment('offense', 0.75, -1), 1.5,
        '10.43 原生技能评估：offense→敌方 正修正');
    eq(ao43.skillTargetDirectionAdjustment('support', 0.4, -1), 0,
        '10.43 低置信 intent 不干预原生技能 effect');
    eq(eng43._isSingleTargetSkillProfile({
        tags: { __targets: ['enemy', 'multi'], __scope: 'any1' },
        targets: { category: 'enemy' },
    }, { targetIndexes: [0] }), false,
        '10.43 multi 语义技能即使当前只剩一个目标也不能进入单目标宿主桥');
    eq(eng43._isSingleTargetSkillProfile({
        tags: { __targets: ['ally'], __scope: 'any1' },
        targets: { category: 'ally' },
    }, { targetIndexes: [0] }), true,
        '10.43 明确单目标 support profile 可进入单目标桥');

    const SELF43 = 'kernel_self_fixture_alpha';
    host43.lib.skill[SELF43] = {
        enable: 'phaseUse',
        filterTarget: function (card, player, target) { return player === target; },
        content: function () {},
    };
    eq(eng43._canConfirmSelfSkillTarget(SELF43, me43, {
        tags: { __targets: ['ally', 'self'] },
        targets: { intent: 'support' },
    }), true, '10.43 ally+self 技能可确证 self 合法时纳入候选池');

    /* D. support profile 只推荐真友；只有敌方合法目标时 targetIndex=-1。 */
    const ctxAlly43 = {
        me: { hp: 4, maxHp: 4 },
        targets: [{ pp: allyDamaged43, isAlly: true, isEnemy: false, hp: 2, maxHp: 4, threat: 1 }],
    };
    const ctxEnemy43 = {
        me: { hp: 4, maxHp: 4 },
        targets: [{ pp: enemyDamaged43, isAlly: false, isEnemy: true, hp: 2, maxHp: 4, threat: 2 }],
    };
    eq(sp43.decideSkill(SID43, prof43, ctxAlly43).targetIndex, 0,
        '10.43 support 技能存在合法友方 → 推荐友方');
    eq(sp43.decideSkill(SID43, prof43, ctxEnemy43).targetIndex, -1,
        '10.43 support 技能只有敌方 → 不推荐资敌目标');

    /* E. 宿主桥：推荐目标获得强正分；技能随后 .set('ai', ...) 也不会覆盖桥。 */
    host43.game.players = [me43, allyDamaged43, enemyDamaged43];
    const ba43 = {
        type: 'skill', id: SID43, targetObj: allyDamaged43,
        target: 'allyDamaged43', purpose: 'support', rule: 'defense', score: 8,
        targetIntent: 'support', targetConfidence: 0.75, targetInferred: true,
        skillTargetResolved: true, skillTargetSingle: true,
    };
    const event43 = {
        ai: function () { return 0; },
        filterTarget: function (card, player, target) { return target.isDamaged(); },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao43.bridgeSkillTargetEvent(event43, me43, SID43, 'ai', ba43);
    ok(event43.ai(allyDamaged43) >= 12,
        '10.43 chooseTarget bridge 把内部推荐目标真正映射到宿主 ai');
    event43.set('ai', function () { return 0; });
    ok(event43.ai(allyDamaged43) >= 12,
        '10.43 技能后续 .set(\'ai\') 仍保留目标桥');

    const eventCardTarget43 = {
        ai2: function () { return 0; },
        filterTarget: function (_card, player, target) { return target.isDamaged(); },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao43.bridgeSkillTargetEvent(eventCardTarget43, me43, SID43, 'ai2', ba43);
    ok(eventCardTarget43.ai2(allyDamaged43) >= 12,
        '10.43 chooseCardTarget 的 ai2 同样桥接推荐目标');

    /* E2. 当前具体选择事件不接受推荐目标 → 不桥接。 */
    const rejectedNative43 = function () { return 4; };
    const rejectedEvent43 = {
        ai: rejectedNative43,
        filterTarget: function (_card, _player, target) { return target !== allyDamaged43; },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao43.bridgeSkillTargetEvent(rejectedEvent43, me43, SID43, 'ai', ba43);
    eq(rejectedEvent43.ai, rejectedNative43,
        '10.43 当前 chooseTarget filterTarget 拒绝推荐目标 → 原生 AI 完全不改');

    /* E3. mixed / 低置信 / 未经 kernel 解析 → 一律 fail-open。 */
    const lowNative43 = function () { return 2; };
    const lowEvent43 = {
        ai: lowNative43,
        filterTarget: function () { return true; },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao43.bridgeSkillTargetEvent(lowEvent43, me43, SID43, 'ai', Object.assign({}, ba43, {
        targetConfidence: 0.4,
    }));
    eq(lowEvent43.ai, lowNative43, '10.43 低置信目标策略 → 不桥接');

    const mixedEvent43 = {
        ai: lowNative43,
        filterTarget: function () { return true; },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao43.bridgeSkillTargetEvent(mixedEvent43, me43, SID43, 'ai', Object.assign({}, ba43, {
        targetIntent: 'mixed', targetConfidence: 1,
    }));
    eq(mixedEvent43.ai, lowNative43, '10.43 mixed 技能 → 不桥接');

    const unprovenEvent43 = {
        ai: lowNative43,
        filterTarget: function () { return true; },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao43.bridgeSkillTargetEvent(unprovenEvent43, me43, SID43, 'ai', Object.assign({}, ba43, {
        skillTargetResolved: false,
    }));
    eq(unprovenEvent43.ai, lowNative43, '10.43 未经 kernel 合法目标解析 → 不桥接');

    /* E4. 手工 ID 表等显式高置信策略也可桥接，不要求 inferred=true。 */
    const explicitEvent43 = {
        ai: lowNative43,
        filterTarget: function () { return true; },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao43.bridgeSkillTargetEvent(explicitEvent43, me43, SID43, 'ai', Object.assign({}, ba43, {
        targetConfidence: 1, targetInferred: false,
        skillTargetResolved: true, skillTargetSingle: true,
    }));
    ok(explicitEvent43.ai(allyDamaged43) >= 12,
        '10.43 显式已知技能的高置信已解析目标也可进入宿主桥');

    /* E5. 同一次技能发动只消费一次通用目标桥，后续选择回原生。 */
    const ownerEvent43 = { skill: SID43 };
    const onceCtx43 = { id: SID43, event: ownerEvent43 };
    const firstOnce43 = {
        ai: function () { return 0; },
        filterTarget: function () { return true; },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao43.bridgeSkillTargetChoiceOnce(firstOnce43, me43, onceCtx43, 'ai', ba43);
    ok(firstOnce43.ai(allyDamaged43) >= 12,
        '10.43 同次技能第一次目标事件消费通用桥');
    ok(!!ownerEvent43.__djscSkillTargetBridgeConsumed,
        '10.43 第一次桥接后在技能事件记录 consumed');
    const secondNative43 = function () { return 6; };
    const secondOnce43 = {
        ai: secondNative43,
        filterTarget: function () { return true; },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao43.bridgeSkillTargetChoiceOnce(secondOnce43, me43, onceCtx43, 'ai', ba43);
    eq(secondOnce43.ai, secondNative43,
        '10.43 同次技能第二次目标事件 fail-open，不重复绑定第一目标');

    /* F1. 不匹配当前 best skill → 原生 AI 引用不动。 */
    const native43 = function () { return 3; };
    const noBridge43 = { ai: native43, set: function (k, v) { this[k] = v; return this; } };
    ao43.bridgeSkillTargetEvent(noBridge43, me43, SID43, 'ai', {
        type: 'skill', id: 'other_skill_43', targetObj: allyDamaged43, purpose: 'support',
    });
    eq(noBridge43.ai, native43, '10.43 bestAction 技能不匹配 → 宿主 AI 完全不改');

    /* F2. active skill 解析只使用公开事件链中的 skill/name，不读目标隐藏信息。 */
    eq(ao43.resolveActiveSkillId(me43, { name: SID43 }), SID43,
        '10.43 从当前公开 skill event 解析技能 ID');
    eq(ao43.resolveActiveSkillId(me43, { name: 'chooseTarget', parent: { skill: SID43 } }), SID43,
        '10.43 可沿 parent 解析 skill ID');

    /* 源码结构守卫。 */
    const scannerSrc43 = fs43.readFileSync(join(_pkg, 'score', 'decision', 'skills', 'skillScanner.js'), 'utf8');
    const skillsSrc43 = ['skills.js', 'skillSourceTags.js', 'skillProfiles.js', 'skillAdvice.js'].map(file => fs43.readFileSync(join(_pkg, 'score/decision/skills', file), 'utf8')).join('\n');
    const engineSrc43 = readDecisionSources();
    const overrideSrc43 = fs43.readFileSync(join(_pkg, 'score', 'decision', 'safety', 'aiOverride.js'), 'utf8');
    eq(scannerSrc43.indexOf("if (_match(expr, TARGET_RE)) return -1") < 0, true,
        '10.43 scanner 不再硬编码 target=enemy');
    ok(scannerSrc43.indexOf("out.__targetIntent = 'support'") >= 0
        && scannerSrc43.indexOf("out.__targetIntent = 'offense'") >= 0,
        '10.43 scanner 输出通用 support/offense 目标画像');
    ok(skillsSrc43.indexOf('__targetConfidence') >= 0 && skillsSrc43.indexOf('__targetInferred') >= 0,
        '10.43 skill profile 保留目标方向置信度/来源');
    ok(engineSrc43.indexOf('_isLegalSkillTarget(sid, me, t.pp)') >= 0,
        '10.43 engine 每技能目标先过 filterTarget');
    ok(overrideSrc43.indexOf('const origChooseTarget = proto.chooseTarget') >= 0
        && overrideSrc43.indexOf('const origChooseCardTarget = proto.chooseCardTarget') >= 0
        && overrideSrc43.indexOf('_protoOwned.chooseTarget = proto.chooseTarget') >= 0
        && overrideSrc43.indexOf('_protoOwned.chooseCardTarget = proto.chooseCardTarget') >= 0,
        '10.43 宿主桥覆盖 chooseTarget + chooseCardTarget');
    ok(overrideSrc43.indexOf("if (key === field && typeof value === 'function')") >= 0,
        '10.43 事件 .set(ai/ai2) 后写仍经过桥接');
    ok(overrideSrc43.indexOf("ba.skillTargetResolved !== true || confidence < 0.55") >= 0
        && overrideSrc43.indexOf("ba.skillTargetSingle !== true && (!Array.isArray(ba.targetList) || !ba.targetList.length)") >= 0,
        '10.43 宿主桥只接受 kernel 已解析的高置信单目标/显式多目标组');
    ok(overrideSrc43.indexOf("__djscSkillTargetBridgeConsumed") >= 0,
        '10.43 同次技能发动的通用目标桥只消费一次');
    ok(overrideSrc43.indexOf("eventAcceptsSkillTargetPlan(next, player, decision)") >= 0,
        '10.43 宿主桥再次校验当前选择事件合法目标/目标组');
    const skillDirPos43 = overrideSrc43.indexOf('const skillDir = skillDirectionEffectModifier(card, player, target)');
    const bestActionPos43 = overrideSrc43.indexOf('const ba = _getBA(player)', skillDirPos43);
    ok(skillDirPos43 >= 0 && bestActionPos43 > skillDirPos43,
        '10.43 原生 skill effect 方向守卫先于 bestAction，避免被降权技能绕过');
}

/* ================= 10.44 Skill Decision Kernel V2 · Stage 2 =================
 * A. 多目标技能遵守宿主 selectTarget 数量，不再“全阵营全选”；
 * B. 动态数量 / mixed 组合 fail-open；
 * C. chooseCardTarget = 目标计划 + 低机会成本牌轻量 tie-break；
 * D. chooseButton 只有 planner 明确给出 buttonChoice 才接管；
 * E. chooseControl 只有 planner 明确给出 controlChoice 才接管；
 * F. chooseButtonTarget/chooseControl 新 hook 必须可卸载。
 */
{
    const fs44 = await import('node:fs');
    const sp44 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'skills', 'skillPlayBrain.js')).href);
    const eng44 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'engine', 'engine.js')).href);
    const ao44 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'safety', 'aiOverride.js')).href);
    const host44 = await import(pathToFileURL(join(_pkg, 'score', 'foundation', 'adapt', 'host.js')).href);

    const me44 = { name: 'me44', name1: 'me44', playerid: 'me44' };
    const a1_44 = { name: 'a1_44', name1: 'a1_44', playerid: 'a1_44' };
    const a2_44 = { name: 'a2_44', name1: 'a2_44', playerid: 'a2_44' };
    const a3_44 = { name: 'a3_44', name1: 'a3_44', playerid: 'a3_44' };
    const e1_44 = { name: 'e1_44', name1: 'e1_44', playerid: 'e1_44' };

    /* A. 固定 2 目标：3 个友方候选只能规划收益最高的 2 个。 */
    const profMulti44 = {
        tags: { __targets: ['multi'], recover: 1 },
        targets: { intent: 'support', confidence: 0.75, inferred: true },
        classify: 'aux',
        profit: { base: 2, cost: { net: 0 }, multi: { final: 2 } },
    };
    const ctxMulti44 = {
        me: { hp: 4, maxHp: 4 },
        selectTargetRange: [2, 2],
        targets: [
            { pp: a1_44, isAlly: true, isEnemy: false, hp: 1, maxHp: 4, threat: 1 },
            { pp: a2_44, isAlly: true, isEnemy: false, hp: 2, maxHp: 4, threat: 4 },
            { pp: a3_44, isAlly: true, isEnemy: false, hp: 4, maxHp: 4, threat: 0 },
            { pp: e1_44, isAlly: false, isEnemy: true, hp: 1, maxHp: 4, threat: 5 },
        ],
    };
    const dm44 = sp44.decideSkill('multi44', profMulti44, ctxMulti44);
    eq(dm44.targetIndexes.length, 2, '10.44 selectTarget=[2,2] → 恰好规划2个目标');
    ok(dm44.targetIndexes.includes(0) && dm44.targetIndexes.includes(1),
        '10.44 多目标 support 按友方收益排序选前2，不把敌方/满血低价值目标塞入');
    eq(dm44.targetRangeResolved, true, '10.44 固定目标数量标记 resolved');

    const dyn44 = sp44.decideSkill('multi44', profMulti44, Object.assign({}, ctxMulti44, {
        selectTargetRange: null,
    }));
    eq(dyn44.targetIndexes.length, 1, '10.44 动态 selectTarget → 只推荐主目标');
    eq(dyn44.targetRangeResolved, false, '10.44 动态数量不猜剩余组合');

    const variable44 = sp44.decideSkill('multi44', profMulti44, Object.assign({}, ctxMulti44, {
        selectTargetRange: [1, 3],
    }));
    eq(variable44.targetIndexes.length, 1,
        '10.44 可变 [1,3] → 只规划最小必要1个，不通用贪满3个');
    eq(variable44.targetRangeResolved, false,
        '10.44 可变数量保留宿主追加目标的决策权');

    const zeroOptional44 = sp44.decideSkill('multi44', profMulti44, Object.assign({}, ctxMulti44, {
        selectTargetRange: [0, 3],
    }));
    eq(zeroOptional44.targetIndex, -1,
        '10.44 可选 [0,3] → 通用层不擅自至少选择1个目标');
    eq(zeroOptional44.targetIndexes.length, 0,
        '10.44 可选 [0,3] → 不预生成目标组合');
    eq(zeroOptional44.targetRangeResolved, false,
        '10.44 可选 [0,3] → 0还是更多目标的数量决策交回宿主');
    eq(zeroOptional44.targetDecisionResolved, false,
        '10.44 可选 [0,3] → 目标决策本身标记 unresolved');
    eq(zeroOptional44.targetRequired, false,
        '10.44 可选 [0,3] → 不得按缺少必选目标触发 veto-target');

    const zeroFixed44 = sp44.decideSkill('multi44', profMulti44, Object.assign({}, ctxMulti44, {
        selectTargetRange: [0, 0],
        targets: [],
    }));
    eq(zeroFixed44.targetIndex, -1,
        '10.44 固定 [0,0] → 无目标是合法最终决策');
    eq(zeroFixed44.targetRangeResolved, true,
        '10.44 固定 [0,0] → 数量契约已完全解析');
    eq(zeroFixed44.targetDecisionResolved, true,
        '10.44 固定 [0,0] → 目标决策已完成，不是未知状态');
    eq(zeroFixed44.targetRequired, false,
        '10.44 固定 [0,0] → 明确无需外部目标');

    const mixedProf44 = Object.assign({}, profMulti44, {
        targets: { intent: 'mixed', confidence: 0.7, inferred: true },
    });
    const mixed44 = sp44.decideSkill('mixed44', mixedProf44, ctxMulti44);
    eq(mixed44.targetIndex, -1, '10.44 mixed 多目标 → 不强制单方向组合');

    /* A2. engine 直接读取宿主 selectTarget 契约。 */
    host44.lib.skill.range_num_44 = { filterTarget: function () { return true; }, selectTarget: 2 };
    host44.lib.skill.range_arr_44 = { filterTarget: function () { return true; }, selectTarget: [1, 3] };
    host44.lib.skill.range_dyn_44 = { filterTarget: function () { return true; }, selectTarget: function () { return [1, 2]; } };
    host44.lib.skill.range_special_44 = { filterTarget: function () { return true; }, selectTarget: -1 };
    eq(JSON.stringify(eng44._skillTargetRange('range_num_44')), JSON.stringify([2, 2]),
        '10.44 数字 selectTarget → 固定区间');
    eq(JSON.stringify(eng44._skillTargetRange('range_arr_44')), JSON.stringify([1, 3]),
        '10.44 数组 selectTarget → 保留区间');
    host44.lib.skill.range_neg_44 = { filterTarget: function () { return true; }, selectTarget: -1 };
    eq(eng44._skillTargetRange('range_neg_44'), null,
        '10.44 负数 selectTarget 属宿主特殊语义 → 预规划 fail-open');
    eq(eng44._skillTargetRange('range_dyn_44'), null,
        '10.44 函数 selectTarget → 预规划 fail-open');

    const var44 = sp44.decideSkill('multi44', profMulti44, Object.assign({}, ctxMulti44, {
        selectTargetRange: [1, 3],
    }));
    eq(var44.targetIndexes.length, 1,
        '10.44 可变 [1,3] → 只规划最小必要1个目标');
    eq(var44.targetRangeResolved, false,
        '10.44 可变数量组合标记 unresolved，额外目标交回宿主');
    eq(eng44._skillTargetRange('range_special_44'), null,
        '10.44 负数 selectTarget 属宿主特殊语义 → fail-open');

    /* B. 多目标 action 传入宿主 target bridge 时，整组推荐目标都可获得正分。 */
    host44.game.players = [me44, a1_44, a2_44, a3_44, e1_44];
    const baMulti44 = {
        type: 'skill', id: 'stage2_skill_44',
        targetObj: a1_44, target: 'a1_44', targetList: [a1_44, a2_44],
        targetRangeResolved: true,
        skillTargetResolved: true,
        skillTargetSingle: false,
        purpose: 'support', rule: 'aux', score: 9,
        targetIntent: 'support', targetConfidence: 0.75, targetInferred: true,
    };
    const decMulti44 = ao44.getSkillTargetBridgeDecision(me44, 'stage2_skill_44', baMulti44);
    eq(decMulti44.targets.length, 2, '10.44 host target decision 保留多目标组合');
    const targetAI44 = ao44.wrapSkillTargetAI(function () { return 0; }, me44, decMulti44);
    ok(targetAI44(a1_44) >= 12 && targetAI44(a2_44) >= 12,
        '10.44 规划组合中的两个目标都获得宿主正分');

    /* B2. 多目标宿主桥必须和当前事件的固定选择数量一致。 */
    const fixed2Evt44 = {
        ai: function () { return 0; },
        selectTarget: [2, 2],
        filterTarget: function () { return true; },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillTargetEvent(fixed2Evt44, me44, 'stage2_skill_44', 'ai', baMulti44);
    ok(fixed2Evt44.ai(a1_44) >= 12 && fixed2Evt44.ai(a2_44) >= 12,
        '10.44 当前事件同为固定2目标 → 整组计划可桥接');

    const fixed1Native44 = function () { return 3; };
    const fixed1Evt44 = {
        ai: fixed1Native44,
        selectTarget: [1, 1],
        filterTarget: function () { return true; },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillTargetEvent(fixed1Evt44, me44, 'stage2_skill_44', 'ai', baMulti44);
    eq(fixed1Evt44.ai, fixed1Native44,
        '10.44 engine计划2目标但当前事件只选1个 → 不把上一阶段整组误桥过来');

    const baSingle44 = {
        type: 'skill', id: 'stage2_single_44',
        targetObj: a1_44, target: 'a1_44',
        skillTargetResolved: true,
        skillTargetSingle: true,
        purpose: 'support', rule: 'aux', score: 8,
        targetIntent: 'support', targetConfidence: 0.75, targetInferred: true,
    };
    const singleIntoFixed2Native44 = function () { return 4; };
    const singleIntoFixed2Evt44 = {
        ai: singleIntoFixed2Native44,
        selectTarget: [2, 2],
        filterTarget: function () { return true; },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillTargetEvent(singleIntoFixed2Evt44, me44, 'stage2_single_44', 'ai', baSingle44);
    eq(singleIntoFixed2Evt44.ai, singleIntoFixed2Native44,
        '10.44 单目标计划遇到当前固定2目标事件 → stage mismatch，完全 fail-open');

    const singleSelectedNative44 = function () { return 5; };
    const singleSelectedEvt44 = {
        ai: singleSelectedNative44,
        selectTarget: [1, 1],
        filterTarget: function (_card, _player, target) {
            return !ui.selected.buttons.length || target === a1_44;
        },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillTargetEvent(singleSelectedEvt44, me44, 'stage2_single_44', 'ai', baSingle44);
    eq(singleSelectedEvt44.ai, singleSelectedNative44,
        '10.44 单目标 filterTarget 依赖已选 button/card 等实时选择态 → 也必须 fail-open');

    const selectedDepNative44 = function () { return 4; };
    const selectedDepEvt44 = {
        ai: selectedDepNative44,
        selectTarget: [2, 2],
        filterTarget: function (_card, _player, target) {
            return !ui.selected.targets.length || target !== ui.selected.targets[0];
        },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillTargetEvent(selectedDepEvt44, me44, 'stage2_skill_44', 'ai', baMulti44);
    eq(selectedDepEvt44.ai, selectedDepNative44,
        '10.44 多目标 filterTarget 依赖 ui.selected → 组合合法性不可静态证明，完全原生');

    const eventStateNative44 = function () { return 5; };
    const eventStateEvt44 = {
        ai: eventStateNative44,
        selectTarget: [2, 2],
        filterTarget: function (_card, _player, target) {
            return !event.targets.length || target !== event.targets[0];
        },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillTargetEvent(eventStateEvt44, me44, 'stage2_skill_44', 'ai', baMulti44);
    eq(eventStateEvt44.ai, eventStateNative44,
        '10.44 多目标 filterTarget 依赖 event.targets → 保守 fail-open，不执行未定义事件态');

    const thisStateNative44 = function () { return 6; };
    const thisStateEvt44 = {
        ai: thisStateNative44,
        selectTarget: [2, 2],
        filterTarget: function (_card, _player, target) {
            return !this.selected || target !== this.selected[0];
        },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillTargetEvent(thisStateEvt44, me44, 'stage2_skill_44', 'ai', baMulti44);
    eq(thisStateEvt44.ai, thisStateNative44,
        '10.44 多目标 filterTarget 依赖 this.selected → 保守 fail-open');

    const getEventNative44 = function () { return 7; };
    const getEventEvt44 = {
        ai: getEventNative44,
        selectTarget: [2, 2],
        filterTarget: function (_card, _player, target) {
            return get.event().targets.indexOf(target) < 0;
        },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillTargetEvent(getEventEvt44, me44, 'stage2_skill_44', 'ai', baMulti44);
    eq(getEventEvt44.ai, getEventNative44,
        '10.44 多目标 filterTarget 依赖 get.event() → 保守 fail-open');

    /* C. chooseCardTarget card half：原生同分时低价值牌略优，但只做很小 tie-break。 */
    host44.get.owner = function () { return me44; };
    host44.get.value = function (card) { return card && card.v; };
    const costAI44 = ao44.wrapSkillCostCardAI(function () { return 5; }, me44, decMulti44);
    const low44 = costAI44({ name: 'low44', v: 1 });
    const high44 = costAI44({ name: 'high44', v: 8 });
    ok(low44 > high44, '10.44 选牌成本 tie-break：低价值牌优先');
    ok(Math.abs(low44 - high44) <= 0.4, '10.44 选牌桥偏置有限，不覆盖技能原生 ai1');

    const jointEvt44 = {
        ai1: function () { return 5; },
        ai2: function () { return 0; },
        selectTarget: [2, 2],
        filterTarget: function () { return true; },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillTargetEvent(jointEvt44, me44, 'stage2_skill_44', 'ai2', baMulti44);
    ao44.bridgeSkillCardCostEvent(jointEvt44, me44, 'stage2_skill_44', 'ai1', baMulti44);
    ok(jointEvt44.ai1({ name: 'jointLow44', v: 1 }) > jointEvt44.ai1({ name: 'jointHigh44', v: 8 }),
        '10.44 同一 chooseCardTarget 目标计划已确认 → 牌成本 tie-break 生效');

    const detachedNative44 = function () { return 5; };
    const detachedEvt44 = {
        ai1: detachedNative44,
        filterTarget: function () { return true; },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillCardCostEvent(detachedEvt44, me44, 'stage2_skill_44', 'ai1', baMulti44);
    eq(detachedEvt44.ai1, detachedNative44,
        '10.44 没有同事件目标桥 provenance → card half 完全 fail-open');

    const cardDepNative44 = function () { return 3; };
    const cardDepEvt44 = {
        ai1: cardDepNative44,
        ai2: function () { return 0; },
        filterTarget: function (card, player, target) { return !!card && target === a1_44; },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillCardCostEvent(cardDepEvt44, me44, 'stage2_skill_44', 'ai1', baMulti44);
    eq(cardDepEvt44.ai1, cardDepNative44,
        '10.44 target 合法性依赖所选 card → card half 完全 fail-open');

    /* D. chooseButton：玩家 link 也不猜语义；只有 planner 明确 buttonChoice 才接管。 */
    const nativeBtn44 = function () { return 2; };
    const buttonNoPlanEvt44 = {
        ai: nativeBtn44,
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillButtonEvent(buttonNoPlanEvt44, me44, 'stage2_skill_44', 'ai', baMulti44);
    eq(buttonNoPlanEvt44.ai, nativeBtn44,
        '10.44 button.link 即使可能是玩家，无显式 buttonChoice 仍完全原生');

    const buttonPlanEvt44 = {
        ai: function () { return 2; },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillButtonEvent(buttonPlanEvt44, me44, 'stage2_skill_44', 'ai', Object.assign({}, baMulti44, {
        buttonChoice: a2_44,
    }));
    ok(buttonPlanEvt44.ai({ link: a2_44 }) >= 12,
        '10.44 planner 显式 buttonChoice=玩家 → 对应按钮加分');
    eq(buttonPlanEvt44.ai({ link: { name: 'sha' } }), 2,
        '10.44 显式玩家 buttonChoice 不影响其它非匹配按钮');

    /* E. chooseControl：没有显式 controlChoice 一律原生；只有 planner 明确给出时才接管。 */
    const nativeCtl44 = function () { return 2; };
    const ctlNoPlan44 = {
        controls: ['continue44', 'cancel2'],
        ai: nativeCtl44,
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillControlEvent(ctlNoPlan44, me44, 'stage2_skill_44', baMulti44);
    eq(ctlNoPlan44.ai, nativeCtl44,
        '10.44 唯一有效项也不能凭结构猜继续 → 无 controlChoice 时完全原生');

    const ctlPlan44 = {
        controls: ['modeA44', 'modeB44', 'cancel2'],
        ai: function () { return 2; },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillControlEvent(ctlPlan44, me44, 'stage2_skill_44', Object.assign({}, baMulti44, {
        controlChoice: 'modeB44',
    }));
    eq(ctlPlan44.ai(), 1,
        '10.44 planner 显式 controlChoice=modeB44 → 宿主选择对应索引1');

    const ctlBadPlan44 = {
        controls: ['modeA44', 'modeB44', 'cancel2'],
        ai: nativeCtl44,
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillControlEvent(ctlBadPlan44, me44, 'stage2_skill_44', Object.assign({}, baMulti44, {
        controlChoice: 'missing44',
    }));
    eq(ctlBadPlan44.ai(), 2,
        '10.44 显式 controlChoice 不存在于当前 controls → 回退原生');

    /* E2. 显式 button/control provenance 只能在同一技能 owner event 消费一次。
     * 没有更精确 stage provenance 时，后续同类选择必须 fail-open，不能复用第一次语义。 */
    const buttonOwner44 = {};
    const buttonCtx44 = { id: 'stage2_skill_44', event: buttonOwner44 };
    const buttonFirst44 = {
        ai: function () { return 2; },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillButtonChoiceOnce(buttonFirst44, me44, buttonCtx44, 'ai', Object.assign({}, baMulti44, {
        buttonChoice: a2_44,
    }));
    ok(buttonFirst44.ai({ link: a2_44 }) >= 12,
        '10.44 同一技能 owner event 的第一次显式 buttonChoice 可消费');
    const buttonSecondNative44 = function () { return 3; };
    const buttonSecond44 = {
        ai: buttonSecondNative44,
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillButtonChoiceOnce(buttonSecond44, me44, buttonCtx44, 'ai', Object.assign({}, baMulti44, {
        buttonChoice: a1_44,
    }));
    eq(buttonSecond44.ai, buttonSecondNative44,
        '10.44 同一技能 owner event 后续 chooseButton 无 stage provenance → fail-open，不复用显式选择');

    const controlOwner44 = {};
    const controlCtx44 = { id: 'stage2_skill_44', event: controlOwner44 };
    const controlFirst44 = {
        controls: ['modeA44', 'modeB44'],
        ai: function () { return 0; },
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillControlChoiceOnce(controlFirst44, me44, controlCtx44, Object.assign({}, baMulti44, {
        controlChoice: 'modeB44',
    }));
    eq(controlFirst44.ai(), 1,
        '10.44 同一技能 owner event 的第一次显式 controlChoice 可消费');
    const controlSecondNative44 = function () { return 0; };
    const controlSecond44 = {
        controls: ['modeA44', 'modeB44'],
        ai: controlSecondNative44,
        set: function (k, v) { this[k] = v; return this; },
    };
    ao44.bridgeSkillControlChoiceOnce(controlSecond44, me44, controlCtx44, Object.assign({}, baMulti44, {
        controlChoice: 'modeB44',
    }));
    eq(controlSecond44.ai, controlSecondNative44,
        '10.44 同一技能 owner event 后续 chooseControl 无 stage provenance → fail-open，不复用显式选择');

    /* F. Hook lifecycle 行为门禁：
     * N1(O) 被第三方 X 包裹后，卸载不能覆盖 X；N1 必须永久失效。
     * reinstall 生成 N2(X(N1(O))) 时，只有 N2 活跃，N1 不得复活。 */
    ao44.uninstallAIOverride();
    const protoLife44 = host44.lib.element.Player.prototype;
    const savedLife44 = {
        chooseCard: protoLife44.chooseCard,
        chooseButton: protoLife44.chooseButton,
        addSkill: protoLife44.addSkill,
        getSkills: protoLife44.getSkills,
        gameCheck: host44.game.check,
        players: host44.game.players,
        libSkill: host44.lib.skill,
        checkHooked: host44.game.__djsc_check_hooked,
    };
    const nativeChooseCardLife44 = function () { return { ai: function () { return 0; } }; };
    const nativeChooseButtonLife44 = function () { return { ai: function () { return 0; } }; };
    const nativeAddSkillLife44 = function () { return 'native-add'; };
    const nativeGetSkillsLife44 = function () { return []; };
    const nativeCheckLife44 = function () { return 'native-check'; };
    host44.game.players = [];
    /* Node 的通用 Proxy 宿主桩会在读取 lib.skill[id] 时自动生成 truthy 函数，
     * 会触发 installAIOverride 的“已存在”守卫；本段改用普通对象模拟真实 lib.skill。 */
    host44.lib.skill = {};
    protoLife44.chooseCard = nativeChooseCardLife44;
    protoLife44.chooseButton = nativeChooseButtonLife44;
    protoLife44.addSkill = nativeAddSkillLife44;
    protoLife44.getSkills = nativeGetSkillsLife44;
    host44.game.check = nativeCheckLife44;
    host44.game.__djsc_check_hooked = false;

    ao44.installAIOverride();
    const ownedButtonV1_44 = protoLife44.chooseButton;
    const ownedAddV1_44 = protoLife44.addSkill;
    const ownedGetV1_44 = protoLife44.getSkills;
    const ownedCheckV1_44 = host44.game.check;
    ok(ownedButtonV1_44 !== nativeChooseButtonLife44
        && typeof ownedButtonV1_44.__djscHookActive === 'function'
        && ownedButtonV1_44.__djscHookActive(),
        '10.44 第一代 chooseButton wrapper 安装后 token 活跃');
    ok(typeof ownedAddV1_44.__djscHookActive === 'function' && ownedAddV1_44.__djscHookActive()
        && typeof ownedGetV1_44.__djscHookActive === 'function' && ownedGetV1_44.__djscHookActive()
        && typeof ownedCheckV1_44.__djscHookActive === 'function' && ownedCheckV1_44.__djscHookActive(),
        '10.44 addSkill/getSkills/game.check 同样绑定本代 hook token');

    const thirdButton44 = function () { return ownedButtonV1_44.apply(this, arguments); };
    const thirdAdd44 = function () { return ownedAddV1_44.apply(this, arguments); };
    const thirdGet44 = function () { return ownedGetV1_44.apply(this, arguments); };
    const thirdCheck44 = function () { return ownedCheckV1_44.apply(this, arguments); };
    protoLife44.chooseButton = thirdButton44;
    protoLife44.addSkill = thirdAdd44;
    protoLife44.getSkills = thirdGet44;
    host44.game.check = thirdCheck44;

    ao44.uninstallAIOverride();
    eq(protoLife44.chooseButton, thirdButton44,
        '10.44 卸载不覆盖后装第三方 chooseButton wrapper');
    eq(protoLife44.addSkill, thirdAdd44,
        '10.44 卸载不覆盖后装第三方 addSkill wrapper');
    eq(protoLife44.getSkills, thirdGet44,
        '10.44 卸载不覆盖后装第三方 getSkills wrapper');
    eq(host44.game.check, thirdCheck44,
        '10.44 卸载不覆盖后装第三方 game.check wrapper');
    ok(!ownedButtonV1_44.__djscHookActive()
        && !ownedAddV1_44.__djscHookActive()
        && !ownedGetV1_44.__djscHookActive()
        && !ownedCheckV1_44.__djscHookActive(),
        '10.44 卸载后被第三方包住的第一代 Noname-AI wrappers 全部永久失效');

    ao44.installAIOverride();
    const ownedButtonV2_44 = protoLife44.chooseButton;
    ok(ownedButtonV2_44 !== thirdButton44
        && typeof ownedButtonV2_44.__djscHookActive === 'function'
        && ownedButtonV2_44.__djscHookActive(),
        '10.44 reinstall 在第三方 wrapper 外生成新的活跃 wrapper');
    ok(!ownedButtonV1_44.__djscHookActive(),
        '10.44 reinstall 后第一代 wrapper 不会因全局重新启用而复活');
    ao44.uninstallAIOverride();

    /* 恢复本段测试前宿主状态。 */
    protoLife44.chooseCard = savedLife44.chooseCard;
    protoLife44.chooseButton = savedLife44.chooseButton;
    protoLife44.addSkill = savedLife44.addSkill;
    protoLife44.getSkills = savedLife44.getSkills;
    host44.game.check = savedLife44.gameCheck;
    host44.game.players = savedLife44.players;
    host44.lib.skill = savedLife44.libSkill;
    if (savedLife44.checkHooked === undefined) delete host44.game.__djsc_check_hooked;
    else host44.game.__djsc_check_hooked = savedLife44.checkHooked;

    /* G. 结构守卫：新增宿主 hook + 对称卸载 + generation token。 */
    const src44 = fs44.readFileSync(join(_pkg, 'score', 'decision', 'safety', 'aiOverride.js'), 'utf8');
    const brainSrc44 = fs44.readFileSync(join(_pkg, 'score', 'decision', 'skills', 'skillPlayBrain.js'), 'utf8');
    ok(src44.indexOf('const origChooseButtonTarget = proto.chooseButtonTarget') >= 0
        && src44.indexOf('const origChooseButton = proto.chooseButton') >= 0
        && src44.indexOf('const origChooseControl = proto.chooseControl') >= 0,
        '10.44 stage2 hook 覆盖 chooseButtonTarget / chooseButton / chooseControl');
    ok(src44.indexOf('eventAcceptsSkillTargetPlan(next, player, decision)') >= 0
        && src44.indexOf('_eventFixedTargetCount(next)') >= 0
        && src44.indexOf('_eventFilterDependsOnSelection') >= 0,
        '10.44 多目标桥要求匹配固定目标数，且 selection-dependent 组合 fail-open');
    ok(src44.indexOf('ba.buttonChoice === undefined || ba.buttonChoice === null') >= 0
        && src44.indexOf('ba.controlChoice === undefined || ba.controlChoice === null') >= 0,
        '10.44 button/control 均要求 planner 显式语义选择');
    ok(src44.indexOf('__djscSkillButtonBridgeConsumed') >= 0
        && src44.indexOf('__djscSkillControlBridgeConsumed') >= 0,
        '10.44 button/control 无 stage provenance 时按 owner event 单次消费');
    ok(src44.indexOf('const attached = next.__djscSkillTargetDecision') >= 0,
        '10.44 card half 必须绑定同事件已确认的 target plan');
    ok(src44.indexOf('_protoBackup.chooseButtonTarget') >= 0
        && src44.indexOf('_protoBackup.chooseButton') >= 0
        && src44.indexOf('_protoBackup.chooseControl') >= 0,
        '10.44 stage2 hook 有对称备份/卸载');
    ok(src44.indexOf('proto.chooseTarget === _protoOwned.chooseTarget') >= 0
        && src44.indexOf('proto.chooseButton === _protoOwned.chooseButton') >= 0
        && src44.indexOf('proto.chooseControl === _protoOwned.chooseControl') >= 0,
        '10.44 choose* 卸载只还原自己仍持有的 wrapper，不覆盖后装扩展');
    ok(src44.indexOf('proto.addSkill === _protoOwned.addSkill') >= 0
        && src44.indexOf('proto.getSkills === _protoOwned.getSkills') >= 0
        && src44.indexOf('g.check === _protoOwned.gameCheck') >= 0,
        '10.44 legacy addSkill/getSkills/game.check 也使用 wrapper ownership');
    ok(src44.indexOf('let _activeHookToken = null') >= 0
        && src44.indexOf('__djscHookActive') >= 0
        && src44.indexOf('_activeHookToken !== hookToken') >= 0,
        '10.44 generation token 使被第三方包住的旧 wrapper 卸载后永久透明化');
    ok(brainSrc44.indexOf('ctx.selectTargetRange') >= 0
        && brainSrc44.indexOf('targetRangeResolved') >= 0,
        '10.44 多目标 planner 消费宿主数量契约');
    ok(brainSrc44.indexOf('targetDecisionResolved') >= 0
        && brainSrc44.indexOf('targetRequired') >= 0
        && brainSrc44.indexOf('可选零目标区间') >= 0,
        '10.44 [0,N] 以显式 provenance 表示“可合法不选目标”');
    ok(eng44._skillTargetRange && true,
        '10.44 engine 保留 selectTarget range 解析入口');
    const engineSrc44 = readDecisionSources();
    ok(engineSrc44.indexOf('d.targetRequired !== false') >= 0
        && engineSrc44.indexOf('d.targetDecisionResolved !== false') >= 0,
        '10.44 veto-target 只针对“目标必选且决策已解析”的缺目标情况');
}

/* ================= 10.45 Skill Choice Transaction Stage 3 =================
 * 目标：
 * A. 同一技能的连续选择拥有稳定 transactionId + 单调 stageOrdinal；
 * B. 新阶段开始时读取已完成上一阶段的宿主 result 摘要，形成 priorSelections；
 * C. card/target/button/control 等阶段类型统一记录，但 button/control 不猜语义；
 * D. 独立 chooseCard 只做低机会成本轻量 tie-break；
 * E. transaction provenance 下 target bridge 按 stage 消费，允许同技能后续 target stage，
 *    但每个 stage 不会重复消费上一阶段计划；
 * F. chooseCard hook 纳入 generation-token 生命周期。
 */
{
    const fs45 = await import('node:fs');
    const tx45 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'skills', 'skillChoiceTransaction.js')).href);
    const ao45 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'safety', 'aiOverride.js')).href);
    const host45 = await import(pathToFileURL(join(_pkg, 'score', 'foundation', 'adapt', 'host.js')).href);

    tx45._resetSkillChoiceTransactionSequenceForTests();

    const me45 = { name: 'me45', name1: 'me45', playerid: 'me45' };
    const a45 = { name: 'a45', name1: 'a45', playerid: 'a45' };
    const b45 = { name: 'b45', name1: 'b45', playerid: 'b45' };

    /* A/B. card -> target，且 target 阶段能看到上一阶段宿主 result。 */
    const owner45a = {};
    const ctx45a = { id: 'skill_tx_45a', event: owner45a };
    const cardEvt45a = {};
    const st0_45a = tx45.beginSkillChoiceStage(me45, ctx45a, 'card', cardEvt45a);
    eq(st0_45a.ordinal, 0, '10.45 card→target：首阶段 ordinal=0');
    eq(cardEvt45a.__djscSkillChoiceStage, st0_45a, '10.45 stage provenance 挂到宿主 choice event');
    cardEvt45a.result = { bool: true, cards: [{ name: 'c45a' }] };
    const targetEvt45a = {};
    const st1_45a = tx45.beginSkillChoiceStage(me45, ctx45a, 'target', targetEvt45a);
    eq(st1_45a.ordinal, 1, '10.45 card→target：第二阶段 ordinal=1');
    eq(st1_45a.transactionId, st0_45a.transactionId, '10.45 card→target：同一 owner event 共用 transactionId');
    eq(st1_45a.priorSelections.length, 1, '10.45 target 阶段携带上一阶段已完成 selection');
    eq(st1_45a.priorSelections[0].choiceType, 'card', '10.45 priorSelections 保留 card 阶段类型');
    eq(st1_45a.priorSelections[0].selection.cards.length, 1, '10.45 priorSelections 保留宿主已选牌摘要');

    /* card -> 2 targets：目标数量来自宿主 result，不由 transaction 猜。 */
    targetEvt45a.result = { bool: true, targets: [a45, b45] };
    const ctlEvt45a = {};
    const st2_45a = tx45.beginSkillChoiceStage(me45, ctx45a, 'control', ctlEvt45a);
    eq(st2_45a.priorSelections.length, 2, '10.45 card→2targets→control：前两阶段均进入 provenance');
    eq(st2_45a.priorSelections[1].selection.targets.length, 2,
        '10.45 card→2targets：transaction 记录宿主实际选出的2目标，不预猜数量');

    /* button -> target */
    const owner45b = {};
    const ctx45b = { id: 'skill_tx_45b', event: owner45b };
    const btnEvt45b = {};
    const b0_45 = tx45.beginSkillChoiceStage(me45, ctx45b, 'button', btnEvt45b);
    btnEvt45b.result = { bool: true, links: ['mode45'] };
    const b1_45 = tx45.beginSkillChoiceStage(me45, ctx45b, 'target', {});
    eq(b1_45.ordinal, 1, '10.45 button→target：stage 顺序连续');
    eq(b1_45.priorSelections[0].choiceType, 'button', '10.45 button→target：保留按钮阶段 provenance');

    /* target -> control */
    const owner45c = {};
    const ctx45c = { id: 'skill_tx_45c', event: owner45c };
    const tEvt45c = {};
    tx45.beginSkillChoiceStage(me45, ctx45c, 'target', tEvt45c);
    tEvt45c.result = { bool: true, targets: [a45] };
    const c1_45 = tx45.beginSkillChoiceStage(me45, ctx45c, 'control', {});
    eq(c1_45.priorSelections[0].choiceType, 'target', '10.45 target→control：control 可追溯上一目标阶段');

    /* card -> target -> control 完整三段。 */
    const owner45d = {};
    const ctx45d = { id: 'skill_tx_45d', event: owner45d };
    const d0e45 = {};
    const d0_45 = tx45.beginSkillChoiceStage(me45, ctx45d, 'card', d0e45);
    d0e45.result = { bool: true, cards: [{ name: 'dcard45' }] };
    const d1e45 = {};
    const d1_45 = tx45.beginSkillChoiceStage(me45, ctx45d, 'target', d1e45);
    d1e45.result = { bool: true, targets: [a45] };
    const d2_45 = tx45.beginSkillChoiceStage(me45, ctx45d, 'control', {});
    eq(d0_45.ordinal, 0, '10.45 三段事务 card ordinal=0');
    eq(d1_45.ordinal, 1, '10.45 三段事务 target ordinal=1');
    eq(d2_45.ordinal, 2, '10.45 三段事务 control ordinal=2');
    eq(d2_45.priorSelections.length, 2, '10.45 三段事务 control 看到前两段已完成选择');

    const snap45 = tx45.skillChoiceTransactionSnapshot(ctx45d, me45);
    eq(snap45.stages.length, 3, '10.45 transaction snapshot 完整保留3个阶段');
    eq(snap45.stages[0].choiceType, 'card', '10.45 snapshot stage0=card');
    eq(snap45.stages[1].choiceType, 'target', '10.45 snapshot stage1=target');
    eq(snap45.stages[2].choiceType, 'control', '10.45 snapshot stage2=control');

    /* transaction 隔离：不同 owner / 不同 skill / close 后重开都不能串状态。 */
    const isoOwner1_45 = {};
    const isoOwner2_45 = {};
    const iso1_45 = tx45.beginSkillChoiceStage(me45, { id: 'iso_skill_45', event: isoOwner1_45 }, 'card', {});
    const iso2_45 = tx45.beginSkillChoiceStage(me45, { id: 'iso_skill_45', event: isoOwner2_45 }, 'card', {});
    ok(iso1_45.transactionId !== iso2_45.transactionId,
        '10.45 相同 skillId 但不同 owner event → transaction 隔离');
    const isoOtherSkill45 = tx45.beginSkillChoiceStage(me45, { id: 'iso_other_45', event: isoOwner1_45 }, 'target', {});
    ok(isoOtherSkill45.transactionId !== iso1_45.transactionId,
        '10.45 同 owner event 切换到另一个真实 skillId → 新 transaction，不串技能');
    const closeCtx45 = { id: 'close_skill_45', event: {} };
    const close0_45 = tx45.beginSkillChoiceStage(me45, closeCtx45, 'card', {});
    ok(tx45.closeSkillChoiceTransaction(closeCtx45, me45), '10.45 transaction 可显式关闭');
    const close1_45 = tx45.beginSkillChoiceStage(me45, closeCtx45, 'target', {});
    ok(close1_45.transactionId !== close0_45.transactionId,
        '10.45 已关闭 transaction 再进入新阶段 → 创建新 transaction');

    /* bounded provenance：未知宿主 result 不原样传播。 */
    const boundedOwner45 = {};
    const boundedCtx45 = { id: 'bounded_skill_45', event: boundedOwner45 };
    const boundedStage45 = tx45.beginSkillChoiceStage(me45, boundedCtx45, 'button', {});
    const unknownResult45 = { privateInternalObject: { secret: 45 } };
    ok(tx45.completeSkillChoiceStage(boundedStage45, unknownResult45),
        '10.45 unknown result 仍可标记阶段完成');
    eq(boundedStage45.selection, null,
        '10.45 unknown result 不原样进入 transaction，只保留白名单 selection 摘要');

    /* active skill context 规范化：子事件复制同一 skill/sourceSkill 时收敛到最外层 owner。 */
    const oldLibSkill45 = host45.lib.skill;
    host45.lib.skill = Object.assign({}, oldLibSkill45);
    host45.lib.skill.ctx_same_45 = {};
    host45.lib.skill.ctx_outer_45 = {};
    host45.lib.skill.ctx_inner_45 = {};
    const outerSame45 = { skill: 'ctx_same_45' };
    const childSame45 = { sourceSkill: 'ctx_same_45', parent: outerSame45 };
    const leafSame45 = { name: 'chooseTarget', parent: childSame45 };
    const resolvedSame45 = ao45.resolveActiveSkillContext(me45, leafSame45);
    eq(resolvedSame45.id, 'ctx_same_45',
        '10.45 resolveActiveSkillContext 识别同一 skillId');
    eq(resolvedSame45.event, outerSame45,
        '10.45 同一 skillId 沿父链收敛到最外层 owner event');

    const outerOther45 = { skill: 'ctx_outer_45' };
    const innerOther45 = { skill: 'ctx_inner_45', parent: outerOther45 };
    const resolvedOther45 = ao45.resolveActiveSkillContext(me45, innerOther45);
    eq(resolvedOther45.id, 'ctx_inner_45',
        '10.45 嵌套另一个真实技能时保留最近的 inner skill');
    eq(resolvedOther45.event, innerOther45,
        '10.45 遇到不同真实 skillId 即停止向外串 transaction');
    host45.lib.skill = oldLibSkill45;

    /* D. 独立 chooseCard：只做有界机会成本 tie-break。 */
    host45.get.owner = function () { return me45; };
    host45.get.value = function (card) { return card && card.v; };
    const ownerCard45 = {};
    const ctxCard45 = { id: 'skill_card_45', event: ownerCard45 };
    const cardChoice45 = {
        ai: function () { return 5; },
        set: function (k, v) { this[k] = v; return this; },
    };
    const cardStage45 = tx45.beginSkillChoiceStage(me45, ctxCard45, 'card', cardChoice45);
    const baCard45 = { type: 'skill', id: 'skill_card_45', rule: 'aux', score: 8 };
    ao45.bridgeSkillCardStageEvent(cardChoice45, me45, ctxCard45, 'ai', baCard45);
    const low45 = cardChoice45.ai({ name: 'low45', v: 1 });
    const high45 = cardChoice45.ai({ name: 'high45', v: 8 });
    ok(low45 > high45, '10.45 独立 chooseCard：低价值牌在原生同分时略优');
    ok(Math.abs(low45 - high45) <= 0.4, '10.45 独立 chooseCard：机会成本偏置保持有界');
    eq(cardChoice45.__djscSkillCardStageDecision.transactionId, cardStage45.transactionId,
        '10.45 chooseCard bridge 决策携带 transaction provenance');

    const foreign45 = {};
    host45.get.owner = function (card) { return card && card.owner; };
    const ownedCardScore45 = cardChoice45.ai({ name: 'owned45', v: 2, owner: me45 });
    const foreignCardScore45 = cardChoice45.ai({ name: 'foreign45', v: 2, owner: foreign45 });
    ok(ownedCardScore45 < 5 && foreignCardScore45 === 5,
        '10.45 独立 chooseCard 只对明确属于当前玩家的牌加机会成本；外部/未知所有者 fail-open');
    host45.get.owner = function () { return me45; };

    const noCardBridgeNative45 = function () { return 5; };
    const noCardBridge45 = {
        ai: noCardBridgeNative45,
        set: function (k, v) { this[k] = v; return this; },
    };
    tx45.beginSkillChoiceStage(me45, ctxCard45, 'card', noCardBridge45);
    ao45.bridgeSkillCardStageEvent(noCardBridge45, me45, ctxCard45, 'ai',
        { type: 'skill', id: 'other_skill_45', rule: 'aux' });
    eq(noCardBridge45.ai, noCardBridgeNative45,
        '10.45 当前 bestAction 不是本技能 → 独立 chooseCard 完全原生');

    /* E. target consumption 改为 stage-scoped：同技能两个 target stage 均可独立桥接。 */
    host45.game.players = [me45, a45, b45];
    const baTarget45 = {
        type: 'skill', id: 'skill_target_45',
        targetObj: a45, target: 'a45',
        skillTargetResolved: true, skillTargetSingle: true,
        purpose: 'support', rule: 'aux', score: 8,
        targetIntent: 'support', targetConfidence: 0.75, targetInferred: true,
    };
    const ownerTarget45 = {};
    const ctxTarget45 = { id: 'skill_target_45', event: ownerTarget45 };
    const te0_45 = {
        ai: function () { return 0; },
        selectTarget: [1, 1],
        filterTarget: function () { return true; },
        set: function (k, v) { this[k] = v; return this; },
    };
    const ts0_45 = tx45.beginSkillChoiceStage(me45, ctxTarget45, 'target', te0_45);
    ao45.bridgeSkillTargetChoiceOnce(te0_45, me45, ctxTarget45, 'ai', baTarget45);
    ok(te0_45.ai(a45) >= 12, '10.45 target stage0 可桥接');
    ok(ts0_45.targetBridgeConsumed === true, '10.45 target stage0 仅在本 stage 标记 consumed');

    te0_45.result = { bool: true, targets: [a45] };
    const te1_45 = {
        ai: function () { return 0; },
        selectTarget: [1, 1],
        filterTarget: function () { return true; },
        set: function (k, v) { this[k] = v; return this; },
    };
    const ts1_45 = tx45.beginSkillChoiceStage(me45, ctxTarget45, 'target', te1_45);
    ao45.bridgeSkillTargetChoiceOnce(te1_45, me45, ctxTarget45, 'ai', baTarget45);
    ok(te1_45.ai(a45) >= 12, '10.45 同技能后续 target stage 可重新评估并独立桥接');
    eq(ts1_45.ordinal, 1, '10.45 第二 target stage 使用新的 ordinal，不复用 stage0');

    /* C. button/control 只有 provenance，不因 transaction 自动产生语义。 */
    const ownerNoSemantic45 = {};
    const ctxNoSemantic45 = { id: 'skill_nosem_45', event: ownerNoSemantic45 };
    const btnNative45 = function () { return 3; };
    const btnNoSem45 = { ai: btnNative45, set: function (k, v) { this[k] = v; return this; } };
    tx45.beginSkillChoiceStage(me45, ctxNoSemantic45, 'button', btnNoSem45);
    ao45.bridgeSkillButtonChoiceOnce(btnNoSem45, me45, ctxNoSemantic45, 'ai',
        { type: 'skill', id: 'skill_nosem_45', rule: 'aux' });
    eq(btnNoSem45.ai, btnNative45,
        '10.45 transaction button stage 无显式 buttonChoice → 不猜语义');

    const ctlNative45 = function () { return 2; };
    const ctlNoSem45 = {
        controls: ['x45', 'cancel2'],
        ai: ctlNative45,
        set: function (k, v) { this[k] = v; return this; },
    };
    tx45.beginSkillChoiceStage(me45, ctxNoSemantic45, 'control', ctlNoSem45);
    ao45.bridgeSkillControlChoiceOnce(ctlNoSem45, me45, ctxNoSemantic45,
        { type: 'skill', id: 'skill_nosem_45', rule: 'aux' });
    eq(ctlNoSem45.ai, ctlNative45,
        '10.45 transaction control stage 无显式 controlChoice → 不猜语义');

    /* F. 源码守卫：每个 stage fresh-evaluate；chooseCard hook 有 ownership-safe 生命周期。 */
    const src45 = fs45.readFileSync(join(_pkg, 'score', 'decision', 'safety', 'aiOverride.js'), 'utf8');
    const txSrc45 = fs45.readFileSync(join(_pkg, 'score', 'decision', 'skills', 'skillChoiceTransaction.js'), 'utf8');
    ok(src45.indexOf("beginSkillChoiceStage(this, skillCtx, 'card', next)") >= 0
        && src45.indexOf("beginSkillChoiceStage(this, skillCtx, 'target', next)") >= 0
        && src45.indexOf("beginSkillChoiceStage(this, skillCtx, 'button', next)") >= 0
        && src45.indexOf("beginSkillChoiceStage(this, skillCtx, 'control', next)") >= 0,
        '10.45 card/target/button/control 均进入统一 transaction');
    ok(src45.indexOf('const ba = _getBA(player)') >= 0
        && src45.indexOf('_getFreshSkillBA(this, skillCtx.id)') >= 0
        && src45.indexOf('const ba = bestAction()') >= 0,
        '10.45 每个连续选择 stage 重新进入 _getBA→bestAction，由 state-key 决定复用而非回合缓存');
    ok(src45.indexOf('_protoBackup.chooseCard') >= 0
        && src45.indexOf('_protoOwned.chooseCard') >= 0
        && src45.indexOf('proto.chooseCard === _protoOwned.chooseCard') >= 0,
        '10.45 chooseCard hook 有备份/所有权/卸载对称路径');
    ok(txSrc45.indexOf('priorSelections') >= 0
        && txSrc45.indexOf('__djscSkillChoiceTransaction') >= 0
        && txSrc45.indexOf('__djscSkillChoiceStage') >= 0,
        '10.45 transaction 显式记录 owner/stage/priorSelections provenance');
    ok(src45.indexOf('localId === foundId') >= 0
        && src45.indexOf('遇到另一个真实技能') >= 0,
        '10.45 active skill context 对同技能父链规范化，遇到嵌套不同技能即截断');
    ok(txSrc45.indexOf('stage.selection = _selectionSummary(result)') >= 0
        && txSrc45.indexOf('|| result || null') < 0,
        '10.45 transaction 不保留未知原始 result 对象');
}

/* ================= 10.46 通用技能选牌策略：成本/交换 vs 给牌 =================
 * 不使用任何技能 ID 特判。验证：
 * A. 明确 loseCard/selfDiscard/selfLose → cost；
 * B. giveCard → give，不套弃牌策略；
 * C. cost 模式强保留保命牌，优先低价值/冗余牌；
 * D. unknown/give 仅保留极小机会成本；
 * E. aiOverride 的 chooseCard wrapper 实际消费这套策略。
 */
{
    const fs46 = await import('node:fs');
    const sc46 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'skills', 'skillCardChoiceBrain.js')).href);
    const ao46 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'safety', 'aiOverride.js')).href);
    const host46 = await import(pathToFileURL(join(_pkg, 'score', 'foundation', 'adapt', 'host.js')).href);

    const costProf46 = { tags: { loseCard: 1.8, draw: 1.2 } };
    const costProfSelf46 = { tags: { selfDiscard: -1.2 } };
    const giveProf46 = { tags: { giveCard: 1.5, aux: 1.0, loseCard: 0.8 } };
    const unknownProf46 = { tags: { aux: 1.0 } };

    eq(sc46.classifySkillCardSelection(costProf46), 'cost',
        '10.46 loseCard 语义 → 通用成本/交换选牌');
    eq(sc46.classifySkillCardSelection(costProfSelf46), 'cost',
        '10.46 selfDiscard 语义 → 通用成本/交换选牌');
    eq(sc46.classifySkillCardSelection(giveProf46), 'give',
        '10.46 giveCard 是强语义，即使同时有 loseCard 也不能套弃牌策略');
    eq(sc46.classifySkillCardSelection(unknownProf46), 'unknown',
        '10.46 无成本/给牌证据 → 语义未知，保持保守');
    eq(sc46.classifySkillCardSelection(unknownProf46, {
        skillInfo: { filterCard: true },
    }), 'cost',
        '10.46 宿主 filterCard 且默认丢失/弃置 → declarative 成本选牌');
    eq(sc46.classifySkillCardSelection(unknownProf46, {
        skillInfo: { filterCard: true, discard: false, lose: false },
    }), 'unknown',
        '10.46 宿主明确 discard:false/lose:false → 不擅自当成本');
    eq(sc46.classifySkillCardSelection(giveProf46, {
        skillInfo: { filterCard: true, discard: false, lose: false },
    }), 'give',
        '10.46 giveCard + 非弃置宿主契约 → 保持给牌语义');

    const lowHpCtx46 = {
        me: {
            hp: 1, maxHp: 4,
            shaCount: 3, shanCount: 2, wuxieCount: 1, jiuCount: 1,
            hasZhuge: false, hasPaoxiao: false,
        },
    };
    const taoCost46 = sc46.skillCardSelectionAdjustment('tao', costProf46,
        Object.assign({ cardValue: 8 }, lowHpCtx46));
    const wxCost46 = sc46.skillCardSelectionAdjustment('wuxie', costProf46,
        Object.assign({ cardValue: 8 }, lowHpCtx46));
    const jiuCost46 = sc46.skillCardSelectionAdjustment('jiu', costProf46,
        Object.assign({ cardValue: 6 }, lowHpCtx46));
    const shaCost46 = sc46.skillCardSelectionAdjustment('sha', costProf46,
        Object.assign({ cardValue: 3 }, lowHpCtx46));
    ok(taoCost46.veto && taoCost46.adjustment <= -6,
        '10.46 低血成本选牌：桃强保留，不能拿去换牌');
    ok(wxCost46.veto && wxCost46.adjustment <= -6,
        '10.46 唯一无懈在成本选牌中强保留');
    ok(jiuCost46.veto && jiuCost46.adjustment <= -6,
        '10.46 濒死酒在成本选牌中强保留');
    ok(shaCost46.adjustment > taoCost46.adjustment,
        '10.46 三张杀的冗余杀明显优先于保命桃作为成本');

    const oneSha46 = sc46.skillCardSelectionAdjustment('sha', costProf46, {
        me: { hp: 4, maxHp: 4, shaCount: 1, shanCount: 1, wuxieCount: 1, jiuCount: 0 },
        cardValue: 3,
    });
    const threeSha46 = sc46.skillCardSelectionAdjustment('sha', costProf46, {
        me: { hp: 4, maxHp: 4, shaCount: 3, shanCount: 1, wuxieCount: 1, jiuCount: 0 },
        cardValue: 3,
    });
    ok(threeSha46.adjustment > oneSha46.adjustment,
        '10.46 同样是杀：3张时比唯一1张更适合作为技能成本');

    const junk46 = sc46.skillCardSelectionAdjustment('generic_junk_46', costProf46, {
        me: { hp: 4, maxHp: 4, shaCount: 1, shanCount: 1, wuxieCount: 1, jiuCount: 0 },
        cardValue: 1,
    });
    const useful46 = sc46.skillCardSelectionAdjustment('wuzhong', costProf46, {
        me: { hp: 4, maxHp: 4, shaCount: 1, shanCount: 1, wuxieCount: 1, jiuCount: 0 },
        cardValue: 8,
    });
    ok(junk46.adjustment > useful46.adjustment,
        '10.46 普通低价值牌比高宿主价值锦囊更适合作为交换成本');

    const giveTao46 = sc46.skillCardSelectionAdjustment('tao', giveProf46, {
        me: { hp: 1, maxHp: 4 }, cardValue: 8,
    });
    const giveJunk46 = sc46.skillCardSelectionAdjustment('generic_junk_46', giveProf46, {
        me: { hp: 1, maxHp: 4 }, cardValue: 1,
    });
    ok(!giveTao46.veto && Math.abs(giveTao46.adjustment) <= 0.2
        && Math.abs(giveJunk46.adjustment) <= 0.2,
        '10.46 giveCard 不使用弃牌硬保留/强排序，只保留极小机会成本');

    const unknown46 = sc46.skillCardSelectionAdjustment('tao', unknownProf46, {
        me: { hp: 1, maxHp: 4 }, cardValue: 8,
    });
    ok(!unknown46.veto && Math.abs(unknown46.adjustment) <= 0.2,
        '10.46 选牌语义未知时不擅自套成本策略');

    /* aiOverride 集成：同样原生分数下，cost profile 应明显选低价值牌而避开低血桃。 */
    const me46 = {
        name: 'me46', name1: 'me46', playerid: 'me46',
        hp: 1, maxHp: 4,
        getCards: function (zone) {
            if (zone === 'h') {
                return [
                    { name: 'tao', owner: this, v: 8 },
                    { name: 'sha', owner: this, v: 3 },
                    { name: 'sha', owner: this, v: 3 },
                    { name: 'sha', owner: this, v: 3 },
                    { name: 'generic_junk_46', owner: this, v: 1 },
                ];
            }
            return [];
        },
        hasSkill: function () { return false; },
    };
    const oldOwner46 = host46.get.owner;
    const oldValue46 = host46.get.value;
    host46.get.owner = function (card) { return card && card.owner; };
    host46.get.value = function (card) { return card && card.v; };

    const stage46 = { skillId: 'generic_cost_skill_46', transactionId: 'tx46', ordinal: 0 };
    const wrapped46 = ao46.wrapSkillCardOpportunityAI(function () { return 5; }, me46, stage46, costProf46);
    const scoreTao46 = wrapped46({ name: 'tao', owner: me46, v: 8 });
    const scoreJunk46 = wrapped46({ name: 'generic_junk_46', owner: me46, v: 1 });
    const scoreSha46 = wrapped46({ name: 'sha', owner: me46, v: 3 });
    ok(scoreJunk46 > scoreSha46 && scoreSha46 > scoreTao46,
        '10.46 chooseCard 集成：垃圾牌 > 冗余杀 > 低血桃 的成本选择顺序');

    const foreign46 = { name: 'other46' };
    eq(wrapped46({ name: 'generic_junk_46', owner: foreign46, v: 1 }), 5,
        '10.46 非当前玩家持有的牌不参与技能成本重排');

    /* declarative 技能：直接 filterCard/check(card)，不调用 chooseCard()，通过 aiValue 接入。 */
    const oldSkillRegistry46 = host46.lib.skill;
    host46.lib.skill = Object.assign({}, oldSkillRegistry46);
    host46.lib.skill.generic_decl_cost_46 = {
        enable: 'phaseUse',
        filterCard: true,
        selectCard: [1, Infinity],
        check: function (card) { return 6 - card.v; },
    };
    host46.lib.skill.generic_decl_give_46 = {
        enable: 'phaseUse',
        filterCard: true,
        discard: false,
        lose: false,
        selectCard: [1, Infinity],
    };
    const declCostEvt46 = { skill: 'generic_decl_cost_46' };
    const declCostBA46 = { type: 'skill', id: 'generic_decl_cost_46', rule: 'aux' };
    const declTaoValue46 = ao46.skillCardAIValueModifier(
        me46, { name: 'tao', owner: me46 }, 8, declCostBA46, declCostEvt46);
    const declJunkValue46 = ao46.skillCardAIValueModifier(
        me46, { name: 'generic_junk_46', owner: me46 }, 1, declCostBA46, declCostEvt46);
    ok(declTaoValue46 > 8 && declJunkValue46 < 1,
        '10.46 declarative 成本技能：关键牌提高 aiValue、垃圾牌降低 aiValue，使原生 C-get.value 自然选垃圾');

    const declGiveEvt46 = { skill: 'generic_decl_give_46' };
    const declGiveBA46 = { type: 'skill', id: 'generic_decl_give_46', rule: 'aux' };
    eq(ao46.skillCardAIValueModifier(
        me46, { name: 'generic_junk_46', owner: me46 }, 1, declGiveBA46, declGiveEvt46), 1,
        '10.46 declarative 非弃置/给牌技能不通过 aiValue 套成本策略');
    eq(ao46.skillCardAIValueModifier(
        me46, { name: 'generic_junk_46', owner: me46 }, 1,
        { type: 'skill', id: 'other_decl_46', rule: 'aux' }, declCostEvt46), 1,
        '10.46 当前真实 skill 与 bestAction 不一致 → aiValue 不跨技能污染');
    host46.lib.skill = oldSkillRegistry46;

    host46.get.owner = oldOwner46;
    host46.get.value = oldValue46;

    /* 结构守卫：策略模块本身不允许出现真实技能 ID。 */
    const choiceSrc46 = fs46.readFileSync(join(_pkg, 'score', 'decision', 'skills', 'skillCardChoiceBrain.js'), 'utf8');
    ok(choiceSrc46.indexOf("skillId === 'zhiheng'") < 0
        && choiceSrc46.indexOf("skillId === 'rende'") < 0
        && choiceSrc46.indexOf("skillId === 'lijian'") < 0,
        '10.46 技能选牌策略无真实技能 ID 特判');
    ok(choiceSrc46.indexOf("return 'cost'") >= 0
        && choiceSrc46.indexOf("return 'give'") >= 0
        && choiceSrc46.indexOf("return 'unknown'") >= 0,
        '10.46 选牌策略按通用语义 cost/give/unknown 分流');
}

/* ================= 10.47 统一动作评分值域 + 候选目标契约 ================= */
{
    const fs47 = await import('node:fs');
    let ac47 = null, cp47 = null;
    try { ac47 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'state', 'actionCandidate.js')).href); } catch (e) { ac47 = null; }
    try { cp47 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'cardplay', 'cardPlayBrain.js')).href); } catch (e) { cp47 = null; }

    ok(ac47 && typeof ac47.runtimeScore === 'function' && typeof ac47.makeActionCandidate === 'function',
        '10.47 actionCandidate 统一候选契约可用');
    if (ac47) {
        eq(ac47.runtimeScore(8.126), 8.13, '10.47 runtime score 保持 float，仅做有限小数归一');
        eq(ac47.runtimeScore(Infinity), 0, '10.47 runtime score 非有限值安全归零');
        const t47 = { name1: 'target47' };
        const c47 = ac47.makeActionCandidate({ type: 'card', id: 'sha', targetObj: t47, score: 8.126 });
        eq(c47.target, 'target47', '10.47 targetObj 与执行 target 自动保持同源');
        eq(c47.score, 8.13, '10.47 candidate score 保持 runtime float');
        ok(ac47.hasConsistentBoundTarget(c47), '10.47 候选绑定目标一致性可验证');
    }

    const eng47 = readDecisionSources();
    eq(/score:\s*toInt8\(s\)/.test(eng47), false, '10.47 skill runtime 排序不再使用 toInt8');
    eq(/score:\s*toInt8\(actScore\)/.test(eng47), false, '10.47 card runtime 排序不再使用 toInt8');
    ok(/const boundTarget = _resolveCardCandidateTarget[\s\S]*const cardTarget = boundTarget\.target[\s\S]*expectedValue\(me, id, cardTarget\)/.test(eng47),
        '10.47 卡牌先绑定实际目标，再按该目标计算 EV');
    eq(/a\.target\s*=\s*targets\[tk\.index\]\.name/.test(eng47), false,
        '10.47 评分结束后的 targetBrain 不再偷偷重写执行目标');
    ok(/candidateTargetValue\(best\)/.test(eng47),
        '10.47 最终执行目标来自 winner candidate，而非全局 bestT');

    ok(cp47 && typeof cp47.decideCard === 'function', '10.47 cardPlayBrain 可加载');
    if (cp47) {
        const enemyKill47 = { isAlly:false, isEnemy:true, hp:1, maxHp:4, handCount:1, shaCount:0, shanProb:0.1, threat:10, equipVal:0 };
        const enemySafe47 = { isAlly:false, isEnemy:true, hp:4, maxHp:4, handCount:2, shaCount:1, shanProb:0.8, threat:1, equipVal:0 };
        const ally47 = { isAlly:true, isEnemy:false, hp:4, maxHp:4, handCount:2, shaCount:0, shanProb:0.2, threat:0, equipVal:0 };
        const ctx47 = {
            me:{ hp:4, maxHp:4, sha:1, hasSuit:true },
            targets:[enemyKill47, enemySafe47, ally47],
            targetLocked:true,
            hasRejudge:false,
        };
        const lockedSafe47 = cp47.decideCard('sha', ctx47, 1);
        ok(!lockedSafe47.veto && lockedSafe47.priority < 99,
            '10.47 已绑定非斩杀目标时，不再借其他残血目标触发 +99 补刀');
        const lockedAlly47 = cp47.decideCard('sha', ctx47, 2);
        ok(lockedAlly47.veto, '10.47 基本规则否决使用候选自身绑定目标，不再看全局目标');
    }

    const replay47 = fs47.readFileSync(join(_pkg, 'score', 'view', 'dashboard', 'replayPanel.js'), 'utf8');
    ok(replay47.indexOf('最终选择：') >= 0 && replay47.indexOf('原因：') >= 0 && replay47.indexOf('调整过程：') >= 0,
        '10.47 对局回放按“最终选择/原因/调整过程”展示');
    eq(replay47.indexOf('🎯 总线：') < 0, true,
        '10.47 回放默认不再用“总线 winner”内部术语作为主说明');

    const conflict47 = fs47.readFileSync(join(_pkg, 'score', 'decision', 'analysis', 'conflictDetector.js'), 'utf8');
    ok(conflict47.indexOf('这里只记录意见不同，不代表模型已接管') >= 0,
        '10.47 对局冲突提示明确说明“分歧≠模型接管”');
}

/* ================= 10.48 统一决策边际与评分边界 ================= */
{
    const fs48 = await import('node:fs');
    const dm48 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'state', 'decisionMargin.js')).href);

    const mSmall48 = dm48.normalizedMargin(8, 6);
    const mLarge48 = dm48.normalizedMargin(80, 60);
    ok(Math.abs(mSmall48 - mLarge48) < 1e-12,
        '10.48 normalized margin 对整体评分缩放保持不变');
    ok(dm48.isCloseDecision(8, 7.5), '10.48 接近候选按相对边际识别');
    ok(!dm48.isCloseDecision(8, 2), '10.48 明显领先候选不会误判为接近');
    const impA48 = dm48.signedNormalizedImprovement(6, 8);
    const impB48 = dm48.signedNormalizedImprovement(60, 80);
    ok(Math.abs(impA48 - impB48) < 1e-12,
        '10.48 planner 相对提升对整体评分缩放保持不变');
    const spread48 = dm48.candidateSpread([{ score: 8 }, { score: 6 }, { score: 2 }]);
    eq(spread48.absolute, 6, '10.48 candidateSpread 返回真实候选跨度');
    ok(spread48.normalized > 0 && spread48.normalized <= 1,
        '10.48 candidateSpread 同时提供归一化跨度');

    const champ48 = fs48.readFileSync(join(_pkg, 'score', 'decision', 'strategy', 'championStrategy.js'), 'utf8');
    ok(champ48.indexOf('normalizedMargin') >= 0 && champ48.indexOf('DECISION_MARGIN.CLOSE') >= 0,
        '10.48 Champion 使用统一 normalized margin');
    eq(/gapLimit\s*[:=]\s*14/.test(champ48), false,
        '10.48 Champion 不再依赖旧绝对 gapLimit=14');
    eq(champ48.indexOf('Math.round((a.score || 0) + bonus)') < 0, true,
        '10.48 Champion 不再把 float utility 直接整数化');
    const champCommit48 = champ48.indexOf('winner.a.score =');
    const champReject48 = champ48.indexOf('winner.a === best');
    ok(champCommit48 > champReject48 && champReject48 >= 0,
        '10.48 Champion 仅在确认改判后提交分数修正，未改判不污染 candidates');

    const deep48 = fs48.readFileSync(join(_pkg, 'score', 'cognition', 'deepThink.js'), 'utf8');
    eq(deep48.indexOf('GAP_THRESHOLD = 6') < 0, true,
        '10.48 DeepThink 删除旧绝对 gap 阈值');
    eq(deep48.indexOf('MODEL_W = 28') < 0, true,
        '10.48 DeepThink 删除固定 28 分模型注入');
    ok(deep48.indexOf('candidateSpread(cands)') >= 0 &&
       deep48.indexOf('MODEL_SPREAD_SHARE') >= 0 &&
       deep48.indexOf('RISK_SPREAD_SHARE') >= 0,
        '10.48 DeepThink 模型/风险影响受当前候选 spread 约束');
    eq(/modelP\s*>\s*_stats\.lastGap/.test(deep48), false,
        '10.48 DeepThink 不再比较概率与 utility gap 两种不同单位');

    const planner48 = fs48.readFileSync(join(_pkg, 'score', 'decision', 'strategy', 'planner.js'), 'utf8');
    ok(planner48.indexOf('signedNormalizedImprovement') >= 0 &&
       planner48.indexOf('DECISION_MARGIN.PLANNER_REPLACE') >= 0,
        '10.48 Planner 改判门槛使用相对提升');
    eq(planner48.indexOf('(best.score || 0) + 1.5') < 0, true,
        '10.48 Planner 删除旧固定 +1.5 改判门槛');
    ok(planner48.indexOf('canonicalOf(planTop)') >= 0 &&
       planner48.indexOf('canonicalOf(planBest.action)') >= 0,
        '10.48 Planner 普通规划与残局规划都回到 canonical candidate');

    const eng48 = readDecisionSources();
    eq(/gapLimit\s*:\s*14/.test(eng48), false,
        '10.48 engine 不再向 Champion 传绝对 gapLimit');
    eq(/aN\.score\s*<=\s*-8/.test(eng48), false,
        '10.48 负样本不再依赖旧绝对 -8 阈值');
	ok(eng48.indexOf('trainRecordSample(me, aN') < 0 && eng48.indexOf('negativePool[0]') < 0,
		'P1 未执行负分候选不得标记为真实训练样本');
	ok(!/action:\s*a,/.test(eng48.slice(eng48.indexOf('/* 决策后检测只追踪'), eng48.indexOf('/* ★ 事务只随返回值携带'))),
		'P1 收益后检测仅回填最终选中的动作');
    ok(eng48.indexOf('normalizedMargin(c[0].score || 0, c[1].score || 0)') >= 0,
        '10.48 决策质量统计使用 normalized margin');
    /* 拆分后验证模块行为，不再要求实现语句必须位于 engine.js。 */
    const selection48 = await import(pathToFileURL(join(_pkg, 'score/decision/selection/candidateSelection.js')).href);
    /* 目录迁移契约：旧入口与新入口必须指向同一函数，不能生成第二套状态。 */
    const oldSelection48 = await import(pathToFileURL(join(_pkg, 'score/decision/state/candidateSelection.js')).href);
    eq(oldSelection48.selectInitialCandidate, selection48.selectInitialCandidate, '目录归位：动作初选旧入口共享新实现');
    eq(oldSelection48.mergePlannedCandidate, selection48.mergePlannedCandidate, '目录归位：规划归并旧入口共享新实现');
    const responseNew48 = await import(pathToFileURL(join(_pkg, 'score/decision/response/responseAI.js')).href);
    const responseOld48 = await import(pathToFileURL(join(_pkg, 'score/decision/cardplay/responseAI.js')).href);
    eq(responseOld48.installResponseAI, responseNew48.installResponseAI, '目录归位：响应安装共享同一实现');
    eq(responseOld48.uninstallResponseAI, responseNew48.uninstallResponseAI, '目录归位：响应卸载共享同一实现');
    const compareNew48 = await import(pathToFileURL(join(_pkg, 'score/decision/response/compareAI.js')).href);
    const compareOld48 = await import(pathToFileURL(join(_pkg, 'score/perception/stats/compareAI.js')).href);
    eq(compareOld48.installCompareAI, compareNew48.installCompareAI, '目录归位：拼点安装共享同一实现');
    eq(compareOld48.uninstallCompareAI, compareNew48.uninstallCompareAI, '目录归位：拼点卸载共享同一实现');
    const actions48 = await import(pathToFileURL(join(_pkg, 'score/decision/state/actionCandidate.js')).href);
    const original48 = actions48.makeActionCandidate({ type: 'card', id: 'sha', target: 'enemyA', score: 2 });
    const refined48 = actions48.makeActionCandidate({ type: 'card', id: 'sha', target: 'enemyA', score: 5 });
    const candidates48 = [original48];
    const merged48 = selection48.mergePlannedCandidate(candidates48, refined48);
    eq(merged48.best, original48, '10.48 Planner 复用原候选对象');
    eq(original48.score, 5, '10.48 Planner 更新原候选收益');
    eq(candidates48.length, 1, '10.48 Planner 同一动作不产生重复候选');
    ok(eng48.includes('mergePlannedCandidate(acts, refined)') &&
       eng48.includes('best = plannedSelection.best') && eng48.includes('eligibleActs = plannedSelection.eligibleActs'),
       '10.48 引擎消费 Planner 归并结果与合法候选');

    const bus48 = fs48.readFileSync(join(_pkg, 'score', 'decision', 'strategy', 'strategyBus.js'), 'utf8');
    eq(/Math\.abs\(scoreGap\)\s*>=\s*5/.test(bus48), false,
        '10.48 StrategyBus 不保留旧绝对分差 5');
    ok(bus48.indexOf('normalizedMargin') >= 0 && bus48.indexOf('DECISION_MARGIN.CLEAR') >= 0,
        '10.48 StrategyBus 即使未来重新启用也复用统一 margin 契约');
}

/* ================= 10.49 Action utility / policy priority 分离 ================= */
{
    const fs49 = await import('node:fs');
    const ac49 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'state', 'actionCandidate.js')).href);

    const veto49 = ac49.makeActionCandidate({ type:'card', id:'lebu', score:7.25 });
    ac49.vetoCandidate(veto49, '目标非法');
    eq(veto49.score, 7.25, '10.49 veto 不修改真实 utility');
    eq(ac49.isCandidateEligible(veto49), false, '10.49 veto candidate 结构上不可选');
    eq(veto49.policy.vetoReason, '目标非法', '10.49 veto 原因进入 policy');

    const normalHighUtil49 = ac49.makeActionCandidate({ type:'card', id:'a', score:8 });
    const normalLowUtil49 = ac49.makeActionCandidate({ type:'card', id:'b', score:5 });
    ac49.setCandidatePriority(normalHighUtil49, ac49.PRIORITY_TIER.NORMAL, 20, '');
    ac49.setCandidatePriority(normalLowUtil49, ac49.PRIORITY_TIER.NORMAL, 90, '');
    const normalSorted49 = [normalLowUtil49, normalHighUtil49].sort(ac49.compareActionCandidates);
    eq(normalSorted49[0], normalHighUtil49, '10.49 normal tier 保持 utility-first，不让普通 priority 覆盖收益');

    const critical9949 = ac49.makeActionCandidate({ type:'card', id:'sha', score:2 });
    const critical10049 = ac49.makeActionCandidate({ type:'card', id:'wuzhong', score:1 });
    ac49.setCandidatePriority(critical9949, ac49.PRIORITY_TIER.CRITICAL, 99, '可直接完成击杀');
    ac49.setCandidatePriority(critical10049, ac49.PRIORITY_TIER.CRITICAL, 100, '高优先纯收益');
    const criticalSorted49 = [critical9949, critical10049].sort(ac49.compareActionCandidates);
    eq(criticalSorted49[0], critical10049, '10.49 critical tier 内显式 priorityValue 生效');

    const forced49 = ac49.makeActionCandidate({ type:'equip', id:'qinglong', score:-2 });
    ac49.setCandidatePriority(forced49, ac49.PRIORITY_TIER.FORCED, 11, '已验证击杀序列');
    const tierSorted49 = [normalHighUtil49, critical10049, forced49].sort(ac49.compareActionCandidates);
    eq(tierSorted49[0], forced49, '10.49 forced tier 高于 critical/normal，且无需伪造高 utility');
    eq(forced49.score, -2, '10.49 forced priority 不污染原始 utility');

    const eng49 = readDecisionSources();
    eq(eng49.indexOf('a.score += 999') < 0, true, '10.49 engine 删除 +999 灌爆收益');
    eq(/Math\.min\(a\.score,\s*-(?:12|8|6)\)/.test(eng49), false,
        '10.49 card/skill/equip/judge veto 不再伪造成负分');
    ok(eng49.indexOf("const priorityReason = killCritical ? '可直接完成击杀' : '高优先纯收益'") >= 0,
        '10.49 priority>=99 区分补刀与纯收益，不再把无中/五谷误标补刀');
    const selection49 = await import(pathToFileURL(join(_pkg, 'score/decision/selection/candidateSelection.js')).href);
    const chosen49 = selection49.selectInitialCandidate([veto49, normalLowUtil49, normalHighUtil49]);
    eq(chosen49.best, normalHighUtil49, '10.49 初选保持 normal utility-first');
    eq(chosen49.eligibleActs.includes(veto49), false, '10.49 初选排除 veto 候选');
    const end49 = ac49.makeActionCandidate({ type: 'end', id: 'end', score: 0 });
    const bad49 = ac49.makeActionCandidate({ type: 'card', id: 'sha', score: -1 });
    eq(selection49.selectInitialCandidate([bad49, end49]).best, end49, '10.49 负收益回退原有结束动作');
    eq(selection49.selectInitialCandidate([]).best.type, 'end', '10.49 空候选生成结束动作');
    const criticalSelection49 = ac49.makeActionCandidate({ type: 'card', id: 'sha', score: -2 });
    ac49.setCandidatePriority(criticalSelection49, ac49.PRIORITY_TIER.CRITICAL, 99, '职责');
    eq(selection49.selectInitialCandidate([end49, criticalSelection49]).best, criticalSelection49,
       '10.49 明确战略职责仍优先于结束回合');
    ok(eng49.includes('selectInitialCandidate(acts)') && eng49.includes('best = initialSelection.best') &&
       eng49.includes('eligibleActs = initialSelection.eligibleActs'), '10.49 引擎消费候选模块初选结果');
    ok(eng49.indexOf('applyChampionRule(eligibleActs') >= 0 &&
       eng49.indexOf('deepThinkCritic(me, eligibleActs') >= 0,
        '10.49 Champion/DeepThink 只消费 eligible candidates');

    const planner49 = fs49.readFileSync(join(_pkg, 'score', 'decision', 'strategy', 'planner.js'), 'utf8');
    eq(/score:\s*100\s*\+\s*totalDmg/.test(planner49), false,
        '10.49 Planner 击杀序列不再写入 100+ fake utility');
    ok(planner49.indexOf('killRank:') >= 0 &&
       planner49.indexOf("PRIORITY_TIER.FORCED") >= 0 &&
       planner49.indexOf('setCandidatePriority(canonicalKill, tier') >= 0,
        '10.49 Planner 使用内部 killRank + 显式 forced/critical policy');
    ok(planner49.indexOf('samePolicyTier') >= 0,
        '10.49 普通 Planner 改判不得跨 policy tier');

    const guard49 = fs49.readFileSync(join(_pkg, 'score', 'decision', 'safety', 'modelGuard.js'), 'utf8');
    eq(/killAvailable\.score\s*>\s*action\.score\s*\+\s*5/.test(guard49), false,
        '10.49 Guard 删除旧固定 +5 击杀分差');
    ok(guard49.indexOf("priorityTier === PRIORITY_TIER.FORCED") >= 0,
        '10.49 Guard 读取已验证 forced-kill policy');
    ok(guard49.indexOf('isCandidateEligible(c)') >= 0,
        '10.49 Guard fallback 不会重新选中 veto candidate');

    const champ49 = fs49.readFileSync(join(_pkg, 'score', 'decision', 'strategy', 'championStrategy.js'), 'utf8');
    const deep49 = fs49.readFileSync(join(_pkg, 'score', 'cognition', 'deepThink.js'), 'utf8');
    ok(champ49.indexOf('sameCandidatePolicyBand(a, best)') >= 0,
        '10.49 Champion 只在当前 policy band 内复核');
    ok(deep49.indexOf('sameCandidatePolicyBand(a, best)') >= 0,
        '10.49 DeepThink 只在当前 policy band 内复核');

    const replay49 = fs49.readFileSync(join(_pkg, 'score', 'view', 'dashboard', 'replayPanel.js'), 'utf8');
    ok(replay49.indexOf('真实收益评分：') >= 0 && replay49.indexOf('策略优先级：') >= 0,
        '10.49 对局回放分别显示真实收益与策略优先级');
    const narr49 = fs49.readFileSync(join(_pkg, 'score', 'cognition', 'explain', 'decisionNarrator.js'), 'utf8');
    ok(narr49.indexOf('真实收益评分 ') >= 0 && narr49.indexOf('策略优先级 ') >= 0,
        '10.49 决策解释器使用玩家可读的 utility / policy 说明');
}


/* ================= 10.50 Policy band / forced-kill provenance hardening ================= */
{
    const fs50 = await import('node:fs');
    const ac50 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'state', 'actionCandidate.js')).href);

    const n1 = ac50.makeActionCandidate({ type:'card', id:'sha', target:'p1', score:5 });
    const n2 = ac50.makeActionCandidate({ type:'card', id:'sha', target:'p2', score:5 });
    eq(ac50.sameCandidateAction(n1, n2), false,
        '10.50 同 id 不同目标不是同一 action candidate');
    const n1copy = ac50.makeActionCandidate({ type:'card', id:'sha', target:'p1', score:1 });
    eq(ac50.sameCandidateAction(n1, n1copy), true,
        '10.50 type+id+target 完全一致才视为同一候选');

    const normalA = ac50.makeActionCandidate({ type:'card', id:'a', score:4 });
    const normalB = ac50.makeActionCandidate({ type:'card', id:'b', score:3 });
    ac50.setCandidatePriority(normalA, ac50.PRIORITY_TIER.NORMAL, 10, '');
    ac50.setCandidatePriority(normalB, ac50.PRIORITY_TIER.NORMAL, 90, '');
    eq(ac50.sameCandidatePolicyBand(normalA, normalB), true,
        '10.50 normal 层仍允许 utility-first 复核，不锁普通 priorityValue');

    const critical99 = ac50.makeActionCandidate({ type:'card', id:'sha', score:2 });
    const critical100 = ac50.makeActionCandidate({ type:'card', id:'wuzhong', score:1 });
    ac50.setCandidatePriority(critical99, ac50.PRIORITY_TIER.CRITICAL, 99, '击杀');
    ac50.setCandidatePriority(critical100, ac50.PRIORITY_TIER.CRITICAL, 100, '纯收益');
    eq(ac50.sameCandidatePolicyBand(critical99, critical100), false,
        '10.50 critical 层不同 priorityValue 不得互相改判');
    const critical99b = ac50.makeActionCandidate({ type:'card', id:'jiu', score:9 });
    ac50.setCandidatePriority(critical99b, ac50.PRIORITY_TIER.CRITICAL, 99, '击杀准备');
    eq(ac50.sameCandidatePolicyBand(critical99, critical99b), true,
        '10.50 critical 同 tier+priorityValue 可在 band 内复核');

    const planner50 = fs50.readFileSync(join(_pkg, 'score', 'decision', 'strategy', 'planner.js'), 'utf8');
    ok(planner50.indexOf('sameCandidateAction(c, plannedFirst)') >= 0 &&
       planner50.indexOf('if (!firstCandidate) continue;') >= 0,
        '10.50 Planner forced/critical 只能来自现存且目标精确匹配的 eligible candidate');
    ok(planner50.indexOf("const certainty = (steps.length === 1 && guaranteedDmg >= hp) ? 'forced' : 'critical'") >= 0,
        '10.50 只有当前单步确定击杀可进入 forced，多步/概率路线降为 critical');
    eq(planner50.indexOf('const out = canonicalKill || {') >= 0, false,
        '10.50 Planner 找不到 canonical candidate 时禁止合成新动作');
    ok(planner50.indexOf('compareActionCandidates(proposed, best)') >= 0,
        '10.50 Planner critical 提升仍服从统一 policy comparator');

    const champ50 = fs50.readFileSync(join(_pkg, 'score', 'decision', 'strategy', 'championStrategy.js'), 'utf8');
    const deep50 = fs50.readFileSync(join(_pkg, 'score', 'cognition', 'deepThink.js'), 'utf8');
    ok(champ50.indexOf('sameCandidatePolicyBand(a, best)') >= 0,
        '10.50 Champion 不得跨 critical/forced priorityValue 改判');
    ok(deep50.indexOf('sameCandidatePolicyBand(a, best)') >= 0,
        '10.50 DeepThink 不得跨 critical/forced priorityValue 改判');

    const guard50 = fs50.readFileSync(join(_pkg, 'score', 'decision', 'safety', 'modelGuard.js'), 'utf8');
    ok(guard50.indexOf('sameCandidateAction(action, context.killAvailable)') >= 0,
        '10.50 Guard forced-kill 使用精确候选身份而非“任意攻击牌”放行');
    ok(guard50.indexOf('已有 Planner 严格验证的 forced-kill') <
       guard50.indexOf('红线 1：目标已死 / 目标缺失'),
        '10.50 forced-kill Guard 独立于 action.target，无目标动作不能绕过');
    eq(guard50.indexOf("const isUtility = ['wuzhong', 'tao', 'wuxie', 'shan', 'jiu']") >= 0, false,
        '10.50 forced-kill 不再允许 unrelated utility 例外绕过');

    const eng50 = readDecisionSources();
    const selection50 = await import(pathToFileURL(join(_pkg, 'score/decision/selection/candidateSelection.js')).href);
    const actions50 = await import(pathToFileURL(join(_pkg, 'score/decision/state/actionCandidate.js')).href);
    const targetA50 = actions50.makeActionCandidate({ type: 'card', id: 'sha', target: 'enemyA', score: 2 });
    const targetB50 = actions50.makeActionCandidate({ type: 'card', id: 'sha', target: 'enemyB', score: 6 });
    const candidates50 = [targetA50];
    eq(selection50.mergePlannedCandidate(candidates50, targetB50).best, targetB50,
       '10.50 同名卡不同目标不得归并');
    eq(targetA50.target, 'enemyA', '10.50 原候选目标保持不变');
    eq(candidates50.length, 2, '10.50 不同目标保留独立候选');
    selection50.mergePlannedCandidate(candidates50, targetB50);
    eq(candidates50.length, 2, '10.50 已存在候选再次归并不重复追加');
    const veto50 = actions50.makeActionCandidate({ type: 'card', id: 'sha', target: 'enemyC', score: 10 });
    actions50.vetoCandidate(veto50, '不可用');
    const replacement50 = actions50.makeActionCandidate({ type: 'card', id: 'sha', target: 'enemyC', score: 3 });
    const vetoCandidates50 = [veto50];
    const merged50 = selection50.mergePlannedCandidate(vetoCandidates50, replacement50);
    eq(merged50.best, replacement50, '10.50 不复用已否决的同身份候选');
    eq(merged50.eligibleActs.includes(veto50), false, '10.50 规划后合法候选仍排除否决项');
    eq(eng50.indexOf('best.target = _a2.target') >= 0, false,
        '10.50 Guard fallback 后禁止按相同 id 改写到另一个目标');
}


/* ================= 10.51 手牌保留方向与 play feedback 语义 ================= */
{
    const fs51 = await import('node:fs');
    const keep51 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'cardplay', 'keepStrategyOpt.js')).href + '?pr21-retention');

    hostStub.game.players = [];
    function me51(opts) {
        opts = opts || {};
        return {
            hp: opts.hp == null ? 4 : opts.hp,
            maxHp: opts.maxHp == null ? 4 : opts.maxHp,
            countCards: function (zone, filter) {
                if (typeof filter === 'function') return 0;
                return opts.handCount == null ? 3 : opts.handCount;
            },
            getHandcardLimit: function () { return opts.handLimit == null ? 5 : opts.handLimit; },
            getEquip: function () { return null; },
        };
    }

    const healthy = me51({ hp:4, maxHp:4, handCount:3, handLimit:5 });
    const taoEarly = keep51.keepBonus(healthy, { card:{ name:'tao' }, stage:'early' });
    const nanmanEarly = keep51.keepBonus(healthy, { card:{ name:'nanman' }, stage:'early' });
    ok(taoEarly < 1 && taoEarly >= 0.65,
        '10.51 高保留价值牌只能降低当前出牌吸引力');
    eq(nanmanEarly, 1,
        '10.51 低保留价值牌不会仅因“不值得留”而获得正向出牌加成');

    const lowHpEarly = keep51.keepBonus(
        me51({ hp:1, maxHp:4, handCount:3, handLimit:5 }),
        { card:{ name:'tao' }, stage:'early' }
    );
    ok(lowHpEarly < taoEarly,
        '10.51 低血量+早期提高 retention pressure，桃的当前消耗机会成本更高');

    const spendNow = keep51.keepBonus(
        me51({ hp:4, maxHp:4, handCount:7, handLimit:5 }),
        { card:{ name:'tao' }, stage:'endgame' }
    );
    ok(spendNow > taoEarly && spendNow <= 1,
        '10.51 残局/溢出只解除保留抑制，不允许 retention 层把动作放大到 1 以上');

    const pEarly = keep51.retentionPressure(healthy, { stage:'early' });
    const pOverflow = keep51.retentionPressure(
        me51({ hp:4, maxHp:4, handCount:7, handLimit:5 }),
        { stage:'endgame' }
    );
    ok(pEarly > 0 && pOverflow < 0,
        '10.51 retentionPressure 单一方向：正值保留，负值释放资源');

    const eng51 = readDecisionSources();
    eq(/let\s+handKeepBias\s*=/.test(eng51), false,
        '10.51 engine 删除第二套 handKeepBias 状态变量');
    eq(/score\s*\*=\s*\(1\s*[+-]\s*handKeepBias/.test(eng51), false,
        '10.51 engine 删除基于 handKeepBias 的第二套乘法调分');
    ok(eng51.indexOf("keepBonus(me, { id: id, card: { name: id }, stage: stageLabel })") >= 0,
        '10.51 engine 将阶段上下文交给统一 retention 入口');
    eq(eng51.indexOf("getDecisionBonus('keep', id)") >= 0, false,
        '10.51 used-card 结果不再从 keep feedback 读取');
    ok(eng51.indexOf("getDecisionBonus('play', id)") >= 0,
        '10.51 实际出牌候选读取 play feedback');
    eq(eng51.indexOf('recordKeepOutcome(k, win)') >= 0, false,
        '10.51 REC.cards 不再写入伪 keep outcome');
    ok(eng51.indexOf('recordPlayOutcome(k, win)') >= 0,
        '10.51 REC.cards 明确写入 play outcome');

    const fbKey51 = '无名AI_decisionFeedback';
    _mem.set(fbKey51, JSON.stringify({
        v: 1,
        target: {},
        tempo: {},
        keep: {
            sha: { ratio: 1.4, samples: 8, lastUpdate: 1 }
        }
    }));
    const fb51 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'feedback', 'decisionFeedback.js')).href + '?pr21-migration');
    eq(fb51.getDecisionBonus('play', 'sha'), 1.4,
        '10.51 v1 keep 历史数据按真实来源迁移到 v2 play');
    eq(fb51.getDecisionBonus('keep', 'sha'), 1.0,
        '10.51 v2 keep 不继承 used-card 数据，未采集真实保留行为前保持中性');

    const migrated51 = JSON.parse(_mem.get(fbKey51));
    eq(migrated51.v, 2, '10.51 feedback 存储升级到 v2');
    ok(migrated51.play && migrated51.play.sha && migrated51.keep &&
       Object.keys(migrated51.keep).length === 0,
        '10.51 v1 keep -> v2 play 迁移落盘，keep 命名空间清空');

    for (let i = 0; i < 5; i++) fb51.recordPlayOutcome('tao', true);
    fb51.flushDecisionFeedback();
    eq(fb51.getDecisionBonus('play', 'tao'), 1.4,
        '10.51 新的 play outcome 达到样本门槛后可独立生效');
    eq(fb51.getDecisionBonus('keep', 'tao'), 1.0,
        '10.51 play 学习不会污染 keep 维度');

    fb51.resetDecisionFeedback();
}


/* ================= 10.52 评分增量 / 倍率契约 ================= */
{
    const fs52 = await import('node:fs');
    const ac52 = await import(pathToFileURL(join(_pkg, 'score', 'decision', 'state', 'actionCandidate.js')).href + '?pr22-delta');

    eq(ac52.applyRelativeUtilityDelta(10, 0), 10,
        '10.52 delta=0 为中性值');
    eq(ac52.applyRelativeUtilityDelta(10, 0.2), 12,
        '10.52 正分 +0.2 按相对收益提升为 12');
    eq(ac52.applyRelativeUtilityDelta(10, -0.2), 8,
        '10.52 正分 -0.2 按相对收益降低为 8');
    eq(ac52.applyRelativeUtilityDelta(-10, 0.2), -8,
        '10.52 负分 +0.2 必须提高 utility，不能被普通倍率反向放大');
    eq(ac52.applyRelativeUtilityDelta(-10, -0.2), -12,
        '10.52 负分 -0.2 必须降低 utility');
    eq(ac52.applyRelativeUtilityDelta(0, 0.3), 0,
        '10.52 相对增量不能凭空从零制造 utility');
    eq(ac52.applyRelativeUtilityDelta(10, NaN), 10,
        '10.52 非有限 delta 安全回退为中性');

    const eng52 = readDecisionSources();
    const deltaCalls52 = [
        ['moodStrategyBonus', 'moodDelta'],
        ['counterRelationBonus', 'relationDelta'],
        ['damageTransferBonus', 'transferDelta'],
        ['treeSearchBonus', 'treeDelta'],
        ['deckTopBonus', 'deckDelta'],
        ['gameTheoryBonus', 'gameDelta'],
        ['situationStrategyBonus', 'situationDelta'],
    ];

    for (const [fn, deltaName] of deltaCalls52) {
        ok(eng52.indexOf('const ' + deltaName + ' = ' + fn + '(') >= 0,
            '10.52 ' + fn + ' 明确命名为 delta 信号');
        ok(eng52.indexOf('applyRelativeUtilityDelta(s, ' + deltaName + ')') >= 0,
            '10.52 ' + fn + ' 通过相对增量契约消费');
    }

    const forbiddenDirectMultiply52 = [
        'moodStrategyBonus',
        'counterRelationBonus',
        'damageTransferBonus',
        'treeSearchBonus',
        'deckTopBonus',
        'gameTheoryBonus',
        'situationStrategyBonus',
    ];
    for (const fn of forbiddenDirectMultiply52) {
        const re = new RegExp('(?:const\\s+\\w+\\s*=\\s*' + fn + '\\([^;]+;[\\s\\S]{0,120}?s\\s*\\*=)', 'm');
        eq(re.test(eng52), false,
            '10.52 ' + fn + ' 不得再作为 multiplier 直接乘到 score');
    }

    const multiplierContracts52 = [
        'responseBonus',
        'discardBonus',
        'endgameBonus',
        'resourceTimingBonus',
        'aoeBonus',
        'judgeBonus',
        'equipReplaceBonus',
        'keepBonus',
        'multiTurnBonus',
        'duelBonus',
        'jiedaoBonus',
        'shandianBonus',
        'taoyuanBonus',
        'wuguBonus',
        'shaTargetBonus',
        'taoBonus',
        'jiuBonus',
        'wuxieBonus',
        'shunshouBonus',
        'deepValueBonus',
    ];
    for (const fn of multiplierContracts52) {
        ok(eng52.indexOf(fn + '(') >= 0,
            '10.52 既有 1.0-based multiplier 保持独立契约：' + fn);
    }
}

/* ================= 10.54 Planner 单次计算 / 协作式预算 ================= */
{
    const fs54 = await import('node:fs');
    const planner54 = fs54.readFileSync(join(_pkg, 'score', 'decision', 'strategy', 'planner.js'), 'utf8');
    const eng54 = readDecisionSources();

    ok(planner54.indexOf('function _budgetExceeded(deadline)') >= 0 &&
       planner54.indexOf('function _plannerDeadline(options)') >= 0,
        '10.54 Planner 建立统一 deadline/budget 入口');

    ok(planner54.indexOf('for (const p of (game.players || []))') >= 0 &&
       planner54.indexOf("if (_budgetExceeded(deadline)) {\n\t\t\t\tlog.warn('planner', '规划预算耗尽") >= 0,
        '10.54 敌人遍历过程中检查预算，而非事后才判断');

    ok(planner54.indexOf('for (const candidate of ranked)') >= 0 &&
       planner54.indexOf('_outlookScore(me, candidate, bestT, deadline)') >= 0,
        '10.54 普通候选展望逐候选检查并传递 deadline');

    ok(planner54.indexOf('_findKillSequence(me, p, deadline)') >= 0 &&
       planner54.indexOf('function _findKillSequence(me, target, deadline)') >= 0,
        '10.54 残局击杀搜索也受同一个 Planner deadline 约束');

    eq(/if\s*\(elapsed\s*>\s*PLAN_TIMEOUT\)/.test(planner54), false,
        '10.54 删除“全部算完后才超时”的旧事后判断');

    ok(planner54.indexOf('export function planForDecision(me, options)') >= 0 &&
       planner54.indexOf('const plan = planSequence(me, options)') >= 0,
        '10.54 Planner 节流与预算统一由 planForDecision 管理');

    ok(planner54.indexOf('export function refineBestWithPlan(me, best, bestT, precomputedPlan)') >= 0 &&
       planner54.indexOf('arguments.length >= 4 ? precomputedPlan : planForDecision(me)') >= 0,
        '10.54 refineBestWithPlan 支持消费预计算 plan，兼容旧调用');

    ok(eng54.indexOf("import { refineBestWithPlan, planForDecision } from '../strategy/planner.js'") >= 0,
        '10.54 Engine 只导入 planForDecision，不再直接导入 planSequence');

    eq((eng54.match(/planSequence\s*\(/g) || []).length, 0,
        '10.54 Engine 中不存在直接 planSequence 调用，观测层不能二次规划');

    eq((eng54.match(/decisionPlan\s*=\s*planForDecision\(me\)/g) || []).length, 1,
        '10.54 每次 bestAction 只有一个 Planner 计算入口');

    ok(eng54.indexOf('refineBestWithPlan(me, best, bestT, decisionPlan)') >= 0 &&
       eng54.indexOf('if (decisionPlan && decisionPlan.best)') >= 0,
        '10.54 Planner 改判与 layers.plan 复用同一 decisionPlan');

    eq(eng54.indexOf('const plan = planSequence(me)') >= 0, false,
        '10.54 决策日志不再绕过节流重复规划');

    ok(eng54.indexOf("reg.mount('plan', function ()") >= 0 &&
       eng54.indexOf('_status.djsc_lastDecisionPlan') >= 0,
        '10.54 战术规划面板只读取最近一次 decisionPlan，不主动触发 Planner');
}


/* ================= 10.55 State-key bestAction 缓存 ================= */
{
    const fs55 = await import('node:fs');
    const cache55 = await import(pathToFileURL(join(_pkg, 'score', 'foundation', 'storage', 'cache.js')).href + '?pr31-state-cache');
    const eng55 = readDecisionSources();

    let ownHand = [{ name:'sha', suit:'spade', number:7 }];
    let enemyHandCount = 3;
    let hiddenEnemyHandReads = 0;
    let ownCardStat = { sha:0 };
    let ownSkillStat = { testSkill:0 };

    const me55 = {
        playerid:'me55', name:'me55', alive:true, hp:4, maxHp:4,
        countCards:function(zone) { return zone === 'h' ? ownHand.length : 0; },
        getCards:function(zone) {
            if (zone === 'h') return ownHand;
            return [];
        },
        getStat:function(kind) {
            if (kind === 'card') return ownCardStat;
            if (kind === 'skill') return ownSkillStat;
            return { card:ownCardStat, skill:ownSkillStat };
        },
        isLinked:function() { return false; },
    };
    const enemy55 = {
        playerid:'enemy55', name:'enemy55', alive:true, hp:3, maxHp:4,
        countCards:function(zone) { return zone === 'h' ? enemyHandCount : 0; },
        getCards:function(zone) {
            if (zone === 'h') {
                hiddenEnemyHandReads++;
                return [{ name:'shan', suit:'heart', number:2 }];
            }
            return [];
        },
        isLinked:function() { return false; },
    };

    hostStub.game.me = me55;
    hostStub.game.players = [me55, enemy55];
    hostStub.game.alivePlayers = [me55, enemy55];
    hostStub._status.currentPhase = me55;
    hostStub._status.roundNumber = 2;
    hostStub._status.event = { name:'chooseToUse', type:'phaseUse', step:1, skill:'' };

    const k1 = cache55.stateKey();
    const k1b = cache55.stateKey();
    eq(k1b, k1, '10.55 完全相同 world-state 生成稳定 fingerprint');
    eq(hiddenEnemyHandReads, 0, '10.55 stateKey 不读取其他玩家隐藏手牌内容');

    enemy55.hp = 2;
    const kHp = cache55.stateKey();
    ok(kHp !== k1, '10.55 对手 HP 变化立即改变 stateKey');
    enemy55.hp = 3;

    enemyHandCount = 2;
    const kHandCount = cache55.stateKey();
    ok(kHandCount !== k1, '10.55 对手公开手牌数量变化立即改变 stateKey');
    enemyHandCount = 3;

    hostStub._status.event = { name:'chooseToUse', type:'phaseUse', step:2, skill:'' };
    const kEvent = cache55.stateKey();
    ok(kEvent !== k1, '10.55 当前事件 step/window 变化立即改变 stateKey');

    hostStub._status.event = { name:'chooseToUse', type:'phaseUse', step:1, skill:'', target:enemy55 };
    const kEventTarget = cache55.stateKey();
    ok(kEventTarget !== k1, '10.55 同一事件步骤的 target 变化也立即失效');

    hostStub._status.event = { name:'chooseToUse', type:'phaseUse', step:1, skill:'' };

    ownHand = [{ name:'tao', suit:'heart', number:7 }];
    const kOwnCard = cache55.stateKey();
    ok(kOwnCard !== k1, '10.55 决策者自己手牌内容变化即使数量相同也失效');
    ownHand = [{ name:'sha', suit:'spade', number:7 }];

    ownSkillStat = { testSkill:1 };
    const kSkillUse = cache55.stateKey();
    ok(kSkillUse !== k1, '10.55 本回合技能使用次数变化立即改变 stateKey');
    ownSkillStat = { testSkill:0 };

    ownCardStat = { sha:1 };
    const kCardUse = cache55.stateKey();
    ok(kCardUse !== k1, '10.55 本回合出牌次数变化立即改变 stateKey');
    ownCardStat = { sha:0 };

    ok(eng55.indexOf('const BEST_ACTION_CACHE_TTL = 1200') >= 0,
        '10.55 bestAction 使用保守 1.2s 安全 TTL');
    ok(eng55.indexOf("_decisionStateKey = stateKey() + '::REL=' + _currentRelationKey") >= 0,
        '10.55 bestAction cache key 同时包含 world-state 与 relation fingerprint');
    ok(eng55.indexOf('_lastBestActionStateKey === _decisionStateKey') >= 0,
        '10.55 只有完全相同 state-key 才允许复用 bestAction');
    eq(/Date\.now\(\)\s*-\s*_lastBestActionTime\)\s*<\s*100\b/.test(eng55), false,
        '10.55 删除旧 100ms 纯时间缓存判断');
    ok(eng55.indexOf("_lastBestActionStateKey = '';\n\t\t\tclearThreatCache()") >= 0,
        '10.55 relation 变化同步失效 bestAction state-key');
    ok((eng55.match(/_lastBestActionStateKey = '';/g) || []).length >= 3,
        '10.55 strategic/world/relation 三类状态变化均可清空 state-key');
}


/* ================= 10.56 bestAction 分阶段性能观测 ================= */
{
    const fs56 = await import('node:fs');
    const eng56 = readDecisionSources();
    const trace56 = fs56.readFileSync(join(_pkg, 'score', 'decision', 'engine', 'decisionTrace.js'), 'utf8');
    const panel56 = fs56.readFileSync(join(_pkg, 'score', 'view', 'panel', 'panel.js'), 'utf8');

    for (const phase of ['preflight','context','targets','candidates','planner','model','observability','guard','telemetry']) {
        ok(eng56.indexOf("_markPhase('" + phase + "')") >= 0,
            '10.56 bestAction 记录阶段耗时：' + phase);
    }

    ok(eng56.indexOf('_finalResult.phaseMs = _phaseMs') >= 0 &&
       eng56.indexOf('_finalizeDecisionRecord(me, acts, best, _decisionMs, _phaseMs)') >= 0,
        '10.56 最终结果与 DECISION_LOG 均携带 phaseMs');

    ok(eng56.indexOf('entry.phaseMs = phaseMs') >= 0,
        '10.56 决策回放记录保存 phaseMs 快照');

    ok(trace56.indexOf("lines.push('性能：'") >= 0 &&
       trace56.indexOf(".sort(function (a, b) { return b.ms - a.ms; })") >= 0,
        '10.56 详细日志按耗时排序输出性能热点');

    ok(panel56.indexOf('性能热点：') >= 0,
        '10.56 决策回放面板显示性能热点');

    eq(/_perfPhases\[[^\]]+\]\s*=\s*[^;]*score/.test(eng56), false,
        '10.56 性能观测数据不写入 candidate score');
}


/* ================= 10.57 非关键学习持久化异步化 ================= */
{
    const fs57 = await import('node:fs');
    const auto57 = fs57.readFileSync(join(_pkg, 'score', 'model', 'features', 'autoFeature.js'), 'utf8');

    ok(auto57.indexOf('const AUTO_FEATURE_SAVE_DEBOUNCE_MS = 500') >= 0 &&
       auto57.indexOf('let _autoFeatureSaveTimer = null') >= 0,
        '10.57 AutoFeature 建立独立 500ms 写盘合并窗口');

    ok(auto57.indexOf('_autoFeatureSaveTimer = setTimeout(_flushAutoFeatureStore, AUTO_FEATURE_SAVE_DEBOUNCE_MS)') >= 0,
        '10.57 AutoFeature 持久化离开当前决策同步路径');

    const recordStart57 = auto57.indexOf('export function recordDecisionContext(context)');
    const settleStart57 = auto57.indexOf('export function settleDecisionContext(context, reward, win)');
    const recordBody57 = recordStart57 >= 0 && settleStart57 > recordStart57
        ? auto57.slice(recordStart57, settleStart57)
        : '';
    eq(recordBody57.indexOf('_lsSet(') >= 0, false,
        '10.57 recordDecisionContext 不再直接同步写 localStorage');

    ok(auto57.indexOf('_flushAutoFeatureStore();') >= 0,
        '10.57 定时器不可用时保留同步持久化兜底，不丢学习数据');
}


/* ================= 10.58 单次 bestAction 关系 memo ================= */
{
    const fs58 = await import('node:fs');
    const eng58 = readDecisionSources();
    const bestStart58 = eng58.indexOf('function bestAction()');
    const bestEnd58 = eng58.indexOf('function rulesDecide()', bestStart58);
    const bestBody58 = bestStart58 >= 0 && bestEnd58 > bestStart58
        ? eng58.slice(bestStart58, bestEnd58)
        : '';

    ok(bestBody58.indexOf('const _enemyRelationMemo = new Map()') >= 0 &&
       bestBody58.indexOf('const _allyRelationMemo = new Map()') >= 0,
        '10.58 敌友 memo 仅创建在单次 bestAction 生命周期内');

    ok(bestBody58.indexOf('const value = !!isEnemyOf(me, target)') >= 0 &&
       bestBody58.indexOf('const value = !!isAllyOf(me, target)') >= 0,
        '10.58 memo miss 仍委托既有敌友权威入口，不重写关系算法');

    eq((bestBody58.match(/isEnemyOf\(me,\s*/g) || []).length, 1,
        '10.58 bestAction 直接敌方推断收敛到 memo miss 一处');
    eq((bestBody58.match(/isAllyOf\(me,\s*/g) || []).length, 1,
        '10.58 bestAction 直接友方推断收敛到 memo miss 一处');

    ok(bestBody58.indexOf('_isEnemyMemo(') >= 0 &&
       bestBody58.indexOf('_isAllyMemo }, _getRoundNumber)') >= 0,
        '10.58 候选评分/特征/后检测复用单次决策关系结果');
}


/* 接口负责人：反复挂载不得替换已被界面/引擎持有的记录器对象。 */
{
    const recorder = await import(pathToFileURL(join(_pkg, 'score/decision/safety/guardRecorder.js')).href);
    const first = recorder.mountGuardRecorderInterface();
    const second = recorder.mountGuardRecorderInterface();
    eq(first, second, '公共接口：重复挂载保留记录器对象身份');
    eq(first.record, recorder.recordGuardEvent, '公共接口：记录方法来自所属模块');
    eq(first.getStats, recorder.getGuardStats, '公共接口：统计方法来自所属模块');
    eq(first.reset, recorder.resetGuardRecorder, '公共接口：重置方法来自所属模块');
}

/* 公共读取入口：页面与引擎使用相同函数，重复连接不得清理训练样本。 */
{
    const training = await import(pathToFileURL(join(_pkg, 'score/model/train/trainExport.js')).href);
    const allies = await import(pathToFileURL(join(_pkg, 'score/decision/safety/allyExempt.js')).href);
    const count = training.bufferSize();
    const api = training.mountTrainingInterface();
    const exportFunction = api.trainExport;
    eq(api.trainBufferSize, training.bufferSize, '统一训练入口：样本数量直接来自训练模块');
    eq(api.trainExport, training.exportForImport, '统一训练入口：导出使用同一函数');
    eq(api.trainImport, training.importFromJson, '统一训练入口：导入使用同一函数');
    eq(api.trainExport.cleanLowValue, training.cleanLowValue, '统一训练入口：保留旧清洗方法');
    training.mountTrainingInterface();
    eq(api.trainExport, exportFunction, '统一训练入口：重复连接不更换函数');
    eq(api.trainBufferSize(), count, '统一训练入口：连接不清理样本');
    eq(JSON.parse(api.trainExport()).count, count, '统一训练入口：导出与读取数量一致');
    api.checkAllyExempt = function () { return true; };
    allies.mountAllyExemptInterface();
    eq(api.checkAllyExempt, allies.checkAllyExempt, '队友判断：恢复正式模块，覆盖旧简化判断');
    eq(api.checkAllyExempt(null, null, 'sha'), false, '队友判断：缺少玩家时不放行');
    const globalCheck = api.checkAllyExempt;
    allies.mountAllyExemptInterface();
    eq(api.checkAllyExempt, globalCheck, '队友判断：重复连接仍使用同一函数');
    const entry = await import(pathToFileURL(join(_pkg, 'js/bootstrap/publicInterface.js')).href);
    entry.mountExtensionInterface();
    await new Promise(resolve => setTimeout(resolve, 0));
    eq(api.checkAllyExempt, allies.checkAllyExempt, '入口联通：启动不再覆盖队友判断');
    eq(api.trainExport, training.exportForImport, '入口联通：启动不再另建导出函数');
    eq(api.trainBufferSize(), count, '入口联通：启动连接后原样本仍可读取');
}

/* B1：查询与决策分离，保持实时读取、原接口以及战报格式。 */
{
    const queriesUrl = pathToFileURL(join(_pkg, 'score/foundation/runtime/engineQueries.js')).href;
    const isolated = await import(queriesUrl + '?isolated-query-contract');
    eq(isolated.getInstalled(), false, 'B1 尚未连接引擎时显示未安装');
    eq(isolated.getScoreLog().length, 0, 'B1 尚未连接时展示空记录');
    let state = { installed: false, round: {}, scores: [], decisions: [] };
    isolated.connectEngineQueries({
        getInstalled: () => state.installed, getRound: () => state.round,
        getScoreLog: () => state.scores, getDecisionLog: () => state.decisions,
    });
    eq(isolated.getRound(), state.round, 'B1 读取原对象而非复制快照');
    state = { installed: true, round: { playerA: 3 }, scores: [{ score: 3 }], decisions: [] };
    eq(isolated.getInstalled(), true, 'B1 状态变化后查询立即更新');
    eq(isolated.getScoreLog(), state.scores, 'B1 对局记录换新后不会读到旧数组');
    let invalidRejected = false;
    try { isolated.connectEngineQueries({ getInstalled: () => false }); } catch (_) { invalidRejected = true; }
    ok(invalidRejected, 'B1 不完整的连接会明确报错');
    eq(isolated.getInstalled(), true, 'B1 错误连接不会覆盖上次有效连接');

    const queries = await import(queriesUrl);
    const engine = await import(pathToFileURL(join(_pkg, 'score/decision/engine/engine.js')).href);
    eq(queries.getRound(), engine.getRound(), 'B1 引擎旧接口与新读取入口共享回合数据');
    eq(queries.getScoreLog(), engine.getScoreLog(), 'B1 新旧入口共享评分记录');
    eq(queries.getDecisionLog(), engine.getDecisionLog(), 'B1 新旧入口共享决策记录');
    const health = await import(pathToFileURL(join(_pkg, 'score/foundation/diag/health.js')).href);
    const installedBefore = engine.getInstalled();
    try {
        engine.setInstalled(true);
        eq(health.healthCheck().results[0].ok, true, 'B1 健康检查能读到已安装状态');
        engine.setInstalled(false);
        eq(health.healthCheck().results[0].ok, false, 'B1 健康检查能读到卸载状态');
    } finally { engine.setInstalled(installedBefore); }
    const report = await import(pathToFileURL(join(_pkg, 'score/view/report/report.js')).href);
    const exported = JSON.parse(report.exportDecisionsJson());
    eq(exported.v, 1, 'B1 战报导出版本保持不变');
    eq(exported.decisions.length, engine.getDecisionLog().length, 'B1 战报仍能读取引擎的决策记录');
    const sourceFS = await import('node:fs');
    for (const file of ['score/foundation/diag/health.js', 'score/view/report/report.js']) {
        const src = sourceFS.readFileSync(join(_pkg, file), 'utf8');
        ok(!/from\s+['"][^'"]*decision\/engine\/engine\.js['"]/.test(src), 'B1 ' + file + ' 不再反向导入引擎');
    }
}

/* B1：插件重复安装、完整卸载、再次装载与主引擎前置状态。 */
{
    const pluginUrl = pathToFileURL(join(_pkg, 'score/foundation/runtime/plugins.js')).href;
    const manager = await import(pluginUrl + '?b1-lifecycle-contract');
    const counts = { install: 0, uninstall: 0, start: 0, end: 0 };
    manager.registerPlugin(manager.definePlugin({
        id: 'b1.lifecycle', props: { b1LifecycleProbe: { value: 7 } },
        onInstall() { counts.install++; }, onUninstall() { counts.uninstall++; },
        onStart() { counts.start++; }, onGameEnd() { counts.end++; },
    }), { install: false });
    eq(counts.install, 0, 'B1 插件登记不执行安装');
    manager.installAllPlugins(); manager.scan();
    manager.installAllPlugins(); manager.installPlugin('b1.lifecycle'); manager.scan();
    eq(counts.install, 1, 'B1 重复装载已安装插件只执行一次安装');
    eq(counts.start, 1, 'B1 同一轮启动广播不重复');
    manager.uninstallAllPlugins(); manager.uninstallAllPlugins();
    eq(counts.uninstall, 1, 'B1 重复卸载只清理一次');
    eq(window.__DJSC.b1LifecycleProbe, undefined, 'B1 重复装载后接口所有权仍可正确清理');
    eq(counts.end, 0, 'B1 插件卸载不会被当作对局结束');
    manager.installAllPlugins(); manager.scan();
    eq(counts.install, 2, 'B1 卸载后可以重新安装');
    eq(counts.start, 2, 'B1 新一轮装载重新广播启动');
    manager.uninstallAllPlugins();

    const engine = await import(pathToFileURL(join(_pkg, 'score/decision/engine/engine.js')).href);
    const lifecycle = await import(pathToFileURL(join(_pkg, 'score/bootstrap/lifecycle.js')).href);
    const pluginIndex = await import(pathToFileURL(join(_pkg, 'score/plugins/index.js')).href);
    const host = await import(pathToFileURL(_hostPath).href);
    const previousInstalled = engine.getInstalled();
    const previousPlayer = host.lib.element.Player;
    const coreStateBefore = pluginIndex.getPluginState('djsc.engine').state;
    try {
        engine.setInstalled(false);
        host.lib.element.Player = null;
        lifecycle.installScoreEngine();
        lifecycle.installScoreEngine();
        eq(engine.getInstalled(), false, 'B1 宿主未准备好时不假报主引擎安装成功');
        eq(pluginIndex.getPluginState('djsc.engine').state, coreStateBefore, 'B1 核心未装好时不继续安装依赖插件');
        const rejected = pl.installPlugin('djsc.engine');
        eq(rejected.ok, false, 'B1 引擎插件不能替代启动管理安装主引擎');
        engine.setInstalled(true);
        eq(pl.installPlugin('djsc.engine').ok, true, 'B1 主引擎就绪后插件检查可重试通过');
        pl.uninstallPlugin('djsc.engine');
        eq(engine.getInstalled(), true, 'B1 卸载登记插件不擅自卸载主引擎');
    } finally {
        host.lib.element.Player = previousPlayer;
        engine.setInstalled(previousInstalled);
    }
}

/* B1：补全模块归位后，旧路径仍转出同一对象，不能重新覆盖正式接口。 */
{
    const globalBefore = ['opponentPredict', 'teamBroadcast', 'multiturn', 'economy', 'cognitiveLog']
        .map(key => [key, window.__DJSC[key]]);
    const legacy = await import(pathToFileURL(join(_pkg, 'score/foundation/runtime/missingModules.js')).href);
    const wiring = await import(pathToFileURL(join(_pkg, 'score/bootstrap/legacyFeatureInterfaces.js')).href);
    const definitions = [
        ['opponentPredict', 'score/model/predict/opponentPredict.js', 'legacyOpponentFeatures'],
        ['teamBroadcast', 'score/perception/team/teamBroadcast.js', 'legacyTeamFeatures'],
        ['multiturn', 'score/decision/strategy/multiturn.js', 'legacyPlanFeatures'],
        ['economy', 'score/decision/resource/economy.js', 'legacyEconomyFeatures'],
        ['cognitiveLog', 'score/cognition/log/cognitiveLog.js', 'legacyCognitiveFeatures'],
    ];
    for (const [name, file, exportedName] of definitions) {
        const domain = await import(pathToFileURL(join(_pkg, file)).href);
        eq(legacy[name], domain[exportedName], 'B1 ' + name + ' 旧入口共享所属模块对象');
        eq(wiring[name], legacy[name], 'B1 ' + name + ' 启动装配不另建状态');
    }
    for (const [key, value] of globalBefore) {
        eq(window.__DJSC[key], value, 'B1 再读旧路径不覆盖已装配的 ' + key);
    }
    const player = { id: 'b1-legacy-fixture', name: 'b1-legacy-fixture', hp: 3, countCards: () => 5 };
    const prediction = legacy.opponentPredict.predict(player);
    eq(prediction.cardDraw, 0.3, 'B1 对手旧特征默认摸牌值保持不变');
    eq(prediction.probSha, 0.6, 'B1 对手旧特征进攻概率保持不变');
    eq(legacy.teamBroadcast.getStatus(player).messageCount, 0, 'B1 团队旧字段仍可读取');
    const plan = legacy.multiturn.plan(player);
    eq(plan.turns, 3, 'B1 旧规划仍提供三回合');
    eq(plan.aggression, 0.7, 'B1 旧规划进攻值保持不变');
    eq(legacy.economy.evaluate(player).cardBalance, 0, 'B1 旧经济字段仍可读取');
    eq(legacy.cognitiveLog.stats().confidence, 0, 'B1 旧认知日志字段仍可读取');
    const sourceFS = await import('node:fs');
    const compatibility = sourceFS.readFileSync(join(_pkg, 'score/foundation/runtime/missingModules.js'), 'utf8');
    ok(!compatibility.includes('const _opponentMemory') && !compatibility.includes('window.__DJSC'),
       'B1 基础目录兼容文件不再保存业务状态或直接挂载');
}

/* ---------- B2：迁移兼容、共享状态与导出格式 ---------- */
{
    const load = file => import(pathToFileURL(join(_pkg, file)).href);
    const pairs = [
        ['score/cognition/profile/profiles.js', 'score/foundation/config/profiles.js'],
        ['score/model/calibrate/calibratorPanel.js', 'score/view/dashboard/calibratorPanel.js'],
        ['score/foundation/io/export.js', 'score/bootstrap/dataExport.js'],
        ['score/foundation/io/mergeExport.js', 'score/bootstrap/mergedDataExport.js'],
    ];
    for (const [oldPath, newPath] of pairs) {
        const old = await load(oldPath), current = await load(newPath);
        eq(Object.keys(old).join(','), Object.keys(current).join(','), 'B2 旧入口导出名称保持 ' + oldPath);
        for (const name of Object.keys(old)) {
            eq(old[name], current[name], 'B2 新旧入口共享实现 ' + name);
        }
    }
    const oldTransfer = await load('score/foundation/io/exportAll.js');
    const transfer = await load('score/bootstrap/dataTransfer.js');
    const panel = await load('score/view/dashboard/exportPanel.js');
    eq(oldTransfer.openExportPanel, panel.openExportPanel, 'B2 旧导出面板仍可打开同一实现');
    for (const name of ['autoExportCheck', 'getAutoExportConfig', 'setAutoExportConfig', 'exportDistillPackage', 'exportFullTrainingPackage', 'exportFullBackup', 'importBackup', 'listExportedFiles', 'listImportableFiles']) {
        eq(oldTransfer[name], transfer[name], 'B2 导出编排旧接口兼容 ' + name);
    }
    eq(window.__DJSC.export.panel, panel.openExportPanel, 'B2 全局面板接口仍已挂载');
    eq(window.__DJSC.export.distill, transfer.exportDistillPackage, 'B2 全局蒸馏接口仍连接实际编排');
    const oldProfiles = await load('score/cognition/profile/profiles.js');
    const profiles = await load('score/foundation/config/profiles.js');
    const storageBefore = new Map(_mem);
    const profileBefore = profiles.exportProfilesJson();
    try {
        profiles.importProfilesJson(JSON.stringify({ v: 1, active: '迁移测试', list: [{ name: '迁移测试', ts: 1, data: { mode: 'standard' } }] }), 'replace');
        eq(oldProfiles.loadProfile('迁移测试').data.mode, 'standard', 'B2 新入口写入的配置从旧入口读取');
        const stored = JSON.parse(localStorage.getItem('无名AI_profiles'));
        eq(stored.v, 1, 'B2 配置方案存储版本仍为 1');
        eq(stored.list[0].data.mode, 'standard', 'B2 原配置键与快照格式不变');
    } finally {
        profiles.importProfilesJson(profileBefore, 'replace');
        _mem.clear(); for (const [key, value] of storageBefore) _mem.set(key, value);
    }
    const host = await load('score/foundation/adapt/host.js');
    const previousWrite = host.game.writeFile;
    const writes = [];
    try {
        // 宿主文件写入被替换为内存记录；不落盘，不导入/清空训练数据。
        host.game.writeFile = (content, dir, name, done) => {
            writes.push({ content, dir, name });
            // 仅验证数据编排，不触发结果面板或后续文件回调。
        };
        const r = transfer.exportFullTrainingPackage();
        eq(r.ok, true, 'B2 完整训练包仍可构造');
        const pkg = JSON.parse(writes[0].content);
        eq(pkg.meta.version, 1, 'B2 完整训练包版本不变');
        eq(pkg.meta.type, 'full_training', 'B2 完整训练包类型不变');
        eq(pkg.distill.manifest.structure.output, 6, 'B2 训练标签结构不变');
        ok(Array.isArray(pkg.distill.train), 'B2 训练样本数组保留');
        ok(writes[0].dir.endsWith('/data/output/'), 'B2 原输出目录不变');
        const distill = transfer.exportDistillPackage();
        eq(distill.ok, true, 'B2 蒸馏包仍可编排首个文件');
        ok(writes[1].name.startsWith('train_'), 'B2 蒸馏首个文件命名不变');
        for (const line of writes[1].content.split('\n').filter(Boolean)) {
            const row = JSON.parse(line);
            ok(Array.isArray(row.features) && 'reward' in row && 'meta' in row, 'B2 JSONL 样本字段保留');
        }
    } finally { host.game.writeFile = previousWrite; }
    const sourceFS = await import('node:fs');
    const dataSource = sourceFS.readFileSync(join(_pkg, 'score/bootstrap/dataTransfer.js'), 'utf8');
    ok(!dataSource.includes('document.') && !dataSource.includes('innerHTML'), 'B2 数据打包不再绘制导出面板');
    const downloadSource = sourceFS.readFileSync(join(_pkg, 'score/foundation/io/download.js'), 'utf8');
    ok(!downloadSource.includes('decision/') && !downloadSource.includes('model/'), 'B2 通用下载工具不读取决策和训练模块');
}

/* ---------- B3：分段连接及真实 Commit 延迟副作用 ---------- */
{
    const load = file => import(pathToFileURL(join(_pkg, 'score/decision', file)).href);
    const source = readFileSync(join(_pkg, 'score/decision/engine/engine.js'), 'utf8');
    const stages = ['buildDecisionContext', 'buildTargetContext', 'generateScoredCandidates', 'scoreCandidates',
        'selectInitialCandidate', 'refineCandidatePlan', 'reviewCandidate', 'guardCandidate', 'attachDecisionEffects'];
    const body = source.slice(source.indexOf('function bestAction()'), source.indexOf('function rulesDecide()'));
    let previous = -1;
    for (const name of stages) {
        const position = body.indexOf(name + '(');
        ok(position > previous, 'B3 主链按顺序调度 ' + name);
        previous = position;
    }
    const engine = await load('engine/engine.js');
    const rules = await load('rules/basicRules.js');
    eq(engine._isLegalSkillTarget, rules._isLegalSkillTarget, 'B3 引擎旧技能目标接口指向同一实现');
    eq(engine._skillTargetRange, rules._skillTargetRange, 'B3 引擎旧目标范围接口保持');
    const oldGuard = await import(pathToFileURL(join(_pkg, 'score/model/net/modelGuard.js')).href);
    const guard = await load('safety/modelGuard.js');
    const guardPanel = await import(pathToFileURL(join(_pkg, 'score/view/dashboard/guardPanel.js')).href);
    for (const name of ['guardCheck', 'applyGuardPenalty', 'guardStatus', 'resetGuard', 'GUARD_STATS', 'RED_LINES']) {
        eq(oldGuard[name], guard[name], 'B3 护栏旧路径共享实现/状态 ' + name);
    }
    eq(oldGuard.openGuardPanel, guardPanel.openGuardPanel, 'B3 护栏展示旧入口兼容');
    eq(window.__DJSC.modelGuard.check, guard.guardCheck, 'B3 全局护栏接口连接决策域实现');
    const oldValue = await import(pathToFileURL(join(_pkg, 'score/model/net/deepValue.js')).href);
    const value = await load('utility/deepValue.js');
    for (const name of Object.keys(oldValue)) eq(oldValue[name], value[name], 'B3 规则价值旧入口兼容 ' + name);
    const generator = await load('generation/scoredCandidates.js');
    const acts = [];
    const me = { name: 'b3-fixture', hp: 4, maxHp: 4, skills: [], getCards: () => [] };
    generator.generateScoredCandidates({ me, acts, hand: [], sit: { mode: 'balanced' } }, {});
    eq(acts.length, 1, 'B3 无技能和手牌仍生成一个结束候选');
    eq(acts[0].type, 'end', 'B3 空局面候选保持结束回合');
    eq(acts[0].score, 0, 'B3 结束候选不改变数值');
    const effects = await load('execution/decisionEffects.js');
    const txModule = await load('state/decisionTransaction.js');
    const result = { rule: 'sha' };
    const calls = [];
    const tx = effects.attachDecisionEffects(result, { type: 'card', id: 'sha', target: 'b3-target' }, [
        { label: 'first', fn: (actual, info) => { calls.push([actual.id, info.id]); } },
        { label: 'failure', fn: () => { throw new Error('预期的观察模块故障'); } },
        { label: 'last', fn: () => { calls.push('last'); } },
    ], { meta: { fixture: true } });
    eq(calls.length, 0, 'B3 创建返回值不会提前产生记录或训练');
    eq(result.__djscTransaction, tx, 'B3 返回值关联唯一事务');
    eq(Object.keys(result).includes('__djscTransaction'), false, 'B3 事务不进入导出 JSON');
    const player = {};
    txModule.stageDecisionTransaction(player, tx);
    eq(calls.length, 0, 'B3 stage 也不执行学习副作用');
    eq(txModule.commitDecisionTransaction(player, { type: 'card', id: 'sha', target: 'b3-target' }).ok, true,
       'B3 匹配执行 Commit 后才触发延迟效果');
    eq(calls.length, 2, 'B3 单个记录故障不阻断后续效果');
    eq(calls[0][1], tx.id, 'B3 效果接收同一 decisionId');
    eq(calls[1], 'last', 'B3 副作用按原顺序调用');
    txModule.commitDecisionTransaction(player, { type: 'card', id: 'sha', target: 'b3-target' });
    eq(calls.length, 2, 'B3 重复 Commit 不重复回填');
    const learning = readFileSync(join(_pkg, 'score/decision/feedback/executedLearning.js'), 'utf8');
    ok(body.includes("_deferEffect('learning-and-postcheck'") &&
       body.includes('recordExecutedLearning(') && learning.includes('decisionId: _txInfo && _txInfo.id'),
       'B3 学习模块只从原 Commit 回调接入并传递事务编号');
    const review = readFileSync(join(_pkg, 'score/decision/selection/modelReview.js'), 'utf8');
    ok(review.includes('const { best, bestT } = readFinalState()') && body.includes('readFinalState: () => ({ best, bestT })'),
       'B3 延迟观测读取护栏之后的最终 winner 和目标');
}

/* ---------- B3：旧宿主注册入口拆分 ---------- */
{
    const host = await import(pathToFileURL(join(_pkg, 'js/shared/utils.js')).href);
    const previousSkills = host.lib.skill;
    try {
        host.lib.skill = {};
        const definitions = [
            ['startupSkills', 'registerStartupSkills', ['_aiyh_firstKs', '_aiyh_holdFire']],
            ['globalRules', 'registerGlobalRules', ['aiyh_gjcx_qj', '_aiyh_reserved_shan', '_noScopeSkill', 'aiMangju']],
            ['identityRules', 'registerIdentityRules', ['gjcx_zhuAi', 'gjcx_neiAi', 'gjcx_neiZhong', 'gjcx_neiFan', 'gjcx_neiJiang']],
        ];
        const order = [];
        for (const [file, name, keys] of definitions) {
            const module = await import(pathToFileURL(join(_pkg, 'js/content/legacy', file + '.js')).href);
            module[name]();
            order.push(...keys);
            for (const key of keys) ok(!!host.lib.skill[key], 'B3 原宿主技能名仍注册 ' + key);
        }
        eq(Object.keys(host.lib.skill).join(','), order.join(','), 'B3 十一组旧规则注册顺序保持');
        eq(typeof host.lib.skill._aiyh_firstKs.toLoad, 'function', 'B3 开局配置同步回调保留');
        eq(typeof host.lib.skill.aiyh_gjcx_qj.mod.aiOrder, 'function', 'B3 通用出牌顺序回调保留');
        eq(host.lib.skill.gjcx_zhuAi.content.constructor.name, 'AsyncFunction', 'B3 主公异步回调类型保持');
        const source = readFileSync(join(_pkg, 'js/content/precontent.js'), 'utf8');
        const body = source.slice(source.indexOf('export function precontent'));
        ok(body.indexOf('initAICardOpt();') < body.indexOf('registerStartupSkills();') &&
           body.indexOf('registerStartupSkills();') < body.indexOf('registerGlobalRules();') &&
           body.indexOf('registerGlobalRules();') < body.indexOf('registerIdentityRules();'),
           'B3 precontent 保留初始化和三组规则的装配顺序');
    } finally { host.lib.skill = previousSkills; }
}

/* ---------- B3 收尾：状态所有权与技能公共入口 ---------- */
{
    const load = file => import(pathToFileURL(join(_pkg, file)).href);
    const engine = await load('score/decision/engine/engine.js');
    const ledger = await load('score/decision/scoring/scoreLedger.js');
    ledger.resetLedgerState();
    const oldRound = engine.getRound();
    const player = { name: 'b3-ledger', name1: 'b3-ledger' };
    ledger.give(player, 2.5, '结构迁移夹具');
    eq(engine.getRound(), ledger.round, 'B3 台账与旧引擎接口读取同一对象');
    eq(engine.getScoreLog(), ledger.scoreLog, 'B3 记分日志不复制');
    eq(engine.getREC(), ledger.REC, 'B3 事件记录不复制');
    eq(ledger.conservationLedger().balance, 0, 'B3 抽出台账后仍逐笔守恒');
    engine.resetRound();
    ok(engine.getRound() !== oldRound && engine.getRound() === ledger.round, 'B3 重置后的实时绑定继续对接');
    eq(Object.keys(engine.getRound()).length, 0, 'B3 旧重置入口仍生效');
    const skills = await load('score/decision/skills/skills.js');
    const tags = await load('score/decision/skills/skillSourceTags.js');
    const profiles = await load('score/decision/skills/skillProfiles.js');
    const advice = await load('score/decision/skills/skillAdvice.js');
    const display = await load('score/view/report/skillPresentation.js');
    for (const [name, owner] of [['skillTagsOf', tags], ['_collectSource', tags], ['skillProfileOf', profiles],
        ['aggregateSkillTags', profiles], ['skillBranchesOf', advice], ['detectCombo', advice], ['renderSkillBreakdownText', display]]) {
        eq(skills[name], owner[name], 'B3 技能公共入口共享唯一实现 ' + name);
    }
    const host = await load('score/foundation/adapt/host.js');
    const id = 'b3_skill_cache_fixture';
    const previous = host.lib.skill[id];
    try {
        host.lib.skill[id] = { enable: 'phaseUse', content() { player.draw(1); } };
        skills.clearGainCache();
        const before = profiles.skillProfileOf(id);
        eq(before, skills.skillProfileOf(id), 'B3 画像缓存新旧入口共享');
        skills.clearGainCache();
        ok(profiles.skillProfileOf(id) !== before, 'B3 旧清理入口同时失效实际画像缓存');
    } finally { host.lib.skill[id] = previous; skills.clearGainCache(); ledger.resetLedgerState(); }
}

/* ---------- B4：模型状态单例、快照和校准历史共享 ---------- */
{
    const load = file => import(pathToFileURL(join(_pkg, file)).href);
    const original = await load('score/model/net/modelState.js');
    const lifecycle = await load('score/model/state/modelLifecycle.js');
    eq(Object.keys(original).join(','), Object.keys(lifecycle).join(','), 'B4 旧模型入口完整保留导出名称');
    for (const name of Object.keys(original)) eq(original[name], lifecycle[name], 'B4 模型新旧入口共享唯一实现 ' + name);
    eq(window.__DJSC.modelState.getState, lifecycle.getState, 'B4 全局模型读取同一状态机');
    eq(window.__DJSC.modelState.forceTrain, lifecycle.forceTrain, 'B4 训练入口仍连接同一候选槽');
    const history = await load('score/model/calibrate/calibrationHistory.js');
    const view = await load('score/view/dashboard/calibratorPanel.js');
    eq(view.getCalibrationHistory, history.getCalibrationHistory, 'B4 校准展示读取模型持有的历史');
    eq(window.__DJSC.calibHistory.record, history.recordCalibrationSnapshot, 'B4 原结算记录接口仍连接同一历史');
    const snapshots = await load('score/model/weights/modelSnapshot.js');
    const weights = await load('score/model/weights/weights.js');
    const snapshot = snapshots._snapshotWeights(weights);
    ok(snapshots._snapshotComplete(snapshot), 'B4 快照校验仍覆盖完整网络与投影层');
    const clone = snapshots._cloneSnapshot(snapshot);
    ok(clone.w1 !== snapshot.w1 && clone.pr2 !== snapshot.pr2, 'B4 候选复制不共享在线权重数组');
    const bad = { ...snapshot, b4: [] };
    eq(snapshots._snapshotComplete(bad), false, 'B4 缺价值头的快照仍被拒绝');
    const source = readFileSync(join(_pkg, 'score/model/state/modelLifecycle.js'), 'utf8');
    ok(!source.includes('document.') && !source.includes("alert("), 'B4 状态机不再直接操作提示界面');
    ok(source.includes("const STORAGE_KEY = 'djsc_model_state'") && source.includes('const STATE_V = 2'),
       'B4 原存储键与状态版本保持不变');
}

/* ---------- B5：真实宿主暴露出的卸载与反射模式 ---------- */
{
    const panel = await import(pathToFileURL(join(_pkg, 'score/view/panel/panel.js')).href);
    const savedRoot = window.__DJSC;
    panel.uninstallDebugBridge();
    const calibrator = { stats: () => ({ total: 0 }) };
    const openPanel = () => {};
    const baselineLog = () => 'baseline';
    const root = { calibrator, openCalibratorPanel: openPanel, log: baselineLog };
    window.__DJSC = root;
    try {
        panel.installDebugBridge();
        const otherOwner = () => 'new owner';
        window.__DJSC.log = otherOwner;
        panel.uninstallDebugBridge();
        eq(window.__DJSC, root, 'B5 卸载调试桥不删除全局模块根对象');
        eq(window.__DJSC?.calibrator, calibrator, 'B5 卸载保留校准接口');
        eq(window.__DJSC?.openCalibratorPanel, openPanel, 'B5 卸载保留面板入口');
        eq(window.__DJSC?.log, otherOwner, 'B5 不删除后来由其它来源接管的成员');
        panel.installDebugBridge();
        panel.uninstallDebugBridge();
        eq(window.__DJSC?.log, otherOwner, 'B5 再安装卸载恢复原成员');
    } finally { window.__DJSC = savedRoot; }
    const scanner = await import(pathToFileURL(join(_pkg, 'score/foundation/runtime/globalScanner.js')).href);
    const host = await import(pathToFileURL(join(_pkg, 'score/foundation/adapt/host.js')).href);
    const previousPlayer = host.lib.element.Player;
    let accessed = 0;
    const proto = { chooseFixture() {} };
    Object.defineProperty(proto, 'offsetHeight', { enumerable: true, get() { accessed++; throw new TypeError('Illegal invocation'); } });
    proto.chooseAnotherFixture = function () {};
    host.lib.element.Player = { prototype: proto };
    try {
        const names = scanner.scanPlayerPrototype();
        eq(accessed, 0, 'B5 反射扫描不执行宿主访问器');
        ok(names.includes('chooseFixture') && names.includes('chooseAnotherFixture'), 'B5 访问器不导致整轮扫描丢失');
    } finally { host.lib.element.Player = previousPlayer; }
}

/* B5 浏览器为 ESM 宿主，不保证存在全局 game；目标查找必须走适配桥。 */
{
    const host = await import(pathToFileURL(join(_pkg, 'score/foundation/adapt/host.js')).href);
    const guard = await import(pathToFileURL(join(_pkg, 'score/decision/safety/modelGuard.js')).href);
    const previousPlayers = host.game.players;
    const previousGlobal = Object.getOwnPropertyDescriptor(globalThis, 'game');
    const me = { name: 'b5-actor', hp: 4 }, target = { name: 'b5-target', hp: 4, isDead: () => false };
    try {
        delete globalThis.game;
        host.game.players = [me, target];
        const result = guard.guardCheck(me, { type: 'card', id: 'b5_fixture', score: 1, target: target.name }, { allCandidates: [] });
        eq(result.ok, true, 'B5 没有全局 game 时仍从宿主桥找到真实存活目标');
    } finally {
        host.game.players = previousPlayers;
        if (previousGlobal) Object.defineProperty(globalThis, 'game', previousGlobal);
    }
}

/* B5 实际入口的收益快照必须带上事务编号，并且不可重复拍摄。 */
{
    const host = await import(pathToFileURL(join(_pkg, 'score/foundation/adapt/host.js')).href);
    const effects = await import(pathToFileURL(join(_pkg, 'score/decision/execution/decisionEffects.js')).href);
    const post = await import(pathToFileURL(join(_pkg, 'score/decision/analysis/postCheck.js')).href);
    const previous = host.game.players;
    const me = { name: 'b5-feedback-actor', hp: 4, maxHp: 4, countCards: () => 3, getCards: () => [] };
    const target = { name: 'b5-feedback-target', hp: 4, maxHp: 4, countCards: () => 3, getCards: () => [] };
    try {
        host.game.players = [me, target];
        const tx = { id: 'b5-real-entry-id', meta: { postCheck: { action: { type: 'card', id: 'sha' }, target, isEnemy: true } } };
        const key = effects.captureExecutionSnapshot(me, tx);
        ok(!!key, 'B5 真实入口建立执行前快照');
        target.hp = 3;
        eq(effects.captureExecutionSnapshot(me, tx), key, 'B5 再进入入口复用同一快照，不改成动作后快照');
        const result = post.postCheckAfter(key, me, target);
        eq(result.decisionId, tx.id, 'B5 真实入口收益结果保留同一 decisionId');
        eq(result.id, 'sha', 'B5 反馈动作不串写');
        ok(result.gain > 0, 'B5 消费原快照可看到实际目标血量变化');
    } finally { host.game.players = previous; }
}

/* ---------- 汇总 ---------- */
process.stdout.write('\n');
if (_fails.length) {
    console.error('\n❌ 发布门禁未通过：' + _fails.length + ' / ' + (_pass + _fails.length));
    for (const f of _fails) console.error('  FAIL ' + f);
    process.exitCode = 1;
} else {
    console.log('\n✅ 发布门禁全部通过：' + _pass + ' 项断言');
}
/* trainExport 的防抖落盘定时器无需等待；宿主桩在 process exit 时自动清理 */
setTimeout(() => { process.exit(process.exitCode || 0); }, 50);
