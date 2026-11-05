/*
 * ============================================
 * // 作者: 飞升原创  交流群: 123456789
 * v3.1α 离线预训练管线（报告 §14C）
 * ============================================
 *
 * 【用途】用真实对局导出的样本重训 v7 内置默认权重，解锁"开箱即用预训练"（P0-03 的正向闭环）。
 *
 * 【输入】游戏内导出的 JSONL 训练样本（__DJSC.trainExport() / 导出面板），
 *   每行：{"features":[130 维有限数], "reward": 分数, "value_target"?: 价值目标}
 *
 * 【流程】与游戏内 localTrainer 同一训练口径：
 *   130 维契约校验 → 打乱 → 80/20 训练/验证划分 → 余弦退火 trainOneWithValue
 *   → 验证集准确率 → saveWeights 序列化（Int8 权重 / Int16 偏置 base64）
 *   → 生成 score/model/weights/defaultWeights.js
 *
 * 【运行】（仓库根 extracted/无名AI 下，Node 18+，零依赖）
 *   node build/train_default_weights.mjs <样本.jsonl> [--epochs N] [--lr 0.02]
 * 成功后跑门禁验证：node tests/run_tests.mjs（§10.2 会自动走 v7 正向分支）
 */

import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scoreToLabel } from '../score/model/train/labelPolicy.js';

/* ---------- 参数 ---------- */
const args = process.argv.slice(2);
const input = args.find(a => !a.startsWith('--'));
function optVal(name, dft) {
    const i = args.indexOf('--' + name);
    return (i >= 0 && args[i + 1]) ? Number(args[i + 1]) : dft;
}
if (!input) {
    console.error('用法: node build/train_default_weights.mjs <样本.jsonl> [--epochs N] [--lr 0.02]');
    process.exit(1);
}
const EPOCHS_ARG = optVal('epochs', 0);   /* 0 = 按样本量自适应（同 localTrainer） */
const LR = optVal('lr', 0.02);

const _here = dirname(fileURLToPath(import.meta.url));          /* 无名AI/build */
const _pkg = resolve(_here, '..');                              /* 无名AI */
const _repoRoot = resolve(_pkg, '..', '..');                    /* WUMAING */
const OUT_FILE = join(_pkg, 'score', 'model', 'weights', 'defaultWeights.js');

/* ---------- 宿主桩 + 浏览器环境桩（与 tests/run_tests.mjs 同口径） ---------- */
const _hostPath = join(_repoRoot, 'noname.js');
const _hostOwned = !existsSync(_hostPath);
/* Node 18 不会对 package 边界外的 .js 自动做 ESM 语法探测。
 * 当测试/训练脚本临时生成 noname.js 宿主桩时，同时在同目录生成最小 package.json，
 * 明确声明 type=module；仅在原文件不存在时创建并在退出时清理，绝不覆盖真实宿主工程。 */
const _hostPkgPath = join(_repoRoot, 'package.json');
const _hostPkgOwned = _hostOwned && !existsSync(_hostPkgPath);
const _HOST_STUB = `/* 自动生成的训练宿主桩——脚本退出时删除，勿手改、勿打包 */
const fn = function () { return undefined; };
const configStore = {};
function P() { return new Proxy(fn, { get(t, k) {
    if (k === Symbol.toPrimitive) return function () { return ''; };
    if (k === 'config') return configStore;
    if (!(k in t)) t[k] = P();
    return t[k];
}, apply: function () { return undefined; } }); }
export const lib = P(); export const game = P(); export const ui = P();
export const get = P(); export const ai = P(); export const _status = P();
export default { lib, game, ui, get, ai, _status };
`;
if (_hostOwned) writeFileSync(_hostPath, _HOST_STUB, 'utf8');
if (_hostPkgOwned) writeFileSync(_hostPkgPath, '{"type":"module"}\n', 'utf8');
process.on('exit', function () {
    if (_hostOwned && existsSync(_hostPath)) { try { rmSync(_hostPath); } catch (e) {} }
    if (_hostPkgOwned && existsSync(_hostPkgPath)) { try { rmSync(_hostPkgPath); } catch (e) {} }
});

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

/* ---------- 读取并校验样本（130 维 + 逐项有限数，与门禁 §10.8 同契约） ---------- */
const rawText = readFileSync(resolve(input), 'utf8');
const samples = [];
let rejected = 0;
rawText.split(/\r?\n/).forEach(function (line) {
    const t = line.trim();
    if (!t) return;
    let row;
    try { row = JSON.parse(t); } catch (e) { rejected++; return; }
    const f = row.features || row.f;
    if (!Array.isArray(f) || f.length !== 130) { rejected++; return; }
    for (let i = 0; i < 130; i++) if (typeof f[i] !== 'number' || !Number.isFinite(f[i])) { rejected++; return; }
    samples.push({ f: f, r: (typeof row.reward === 'number' ? row.reward : (row.r || 0)), v: (typeof row.value_target === 'number' && Number.isFinite(row.value_target)) ? row.value_target : 0 });
});
console.log('[train_default] 读入 ' + (samples.length + rejected) + ' 行，有效 ' + samples.length + ' 条，拒收 ' + rejected + ' 条');
if (samples.length < 200) {
    console.error('[train_default] 样本不足（需 ≥200，当前 ' + samples.length + '）——继续真实对局收集后再试');
    process.exit(1);
}

/* ---------- 导入生产训练路径 ---------- */
const wm = await import(pathToFileURL(join(_pkg, 'score', 'model', 'weights', 'weights.js')).href);

/* 标签映射由 score/model/train/labelPolicy.js 统一提供。 */

/* 冷启动：v6 默认权重 fail-closed → 随机初始化（就绪位由训练后 markReady 设置） */
wm.loadWeights();
wm.setTrainLR(LR);

/* 打乱 + 80/20 划分 */
const n = samples.length;
const idx = new Array(n);
for (let i = 0; i < n; i++) idx[i] = i;
for (let i = n - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
}
const VAL_RATIO = 0.2;
const valN = Math.max(20, (n * VAL_RATIO) | 0);
const trN = n - valN;

const EPOCHS = EPOCHS_ARG > 0 ? EPOCHS_ARG : Math.max(5, Math.min(20, Math.floor(500 / (n / 100))));
console.log('[train_default] 训练 ' + trN + ' 条 / 验证 ' + valN + ' 条，epochs=' + EPOCHS + '，baseLR=' + LR);

const t0 = Date.now();
for (let epoch = 0; epoch < EPOCHS; epoch++) {
    const coef = 0.5 * (1 + Math.cos(Math.PI * epoch / EPOCHS));
    const epochLR = LR * (0.1 + 0.9 * coef);
    wm.setTrainLR(epochLR);
    for (let i = 0; i < trN; i++) {
        const s = samples[idx[i]];
        wm.trainOneWithValue(Int8Array.from(s.f), scoreToLabel(s.r), s.v, epochLR);
    }
    if (epoch % 5 === 0 || epoch === EPOCHS - 1) {
        let correct = 0;
        for (let i = trN; i < n; i++) {
            const s = samples[idx[i]];
            const logits = wm.forward(Int8Array.from(s.f));
            let maxIdx = 0, maxVal = -Infinity;
            for (let k = 0; k < 6; k++) if (logits[k] > maxVal) { maxVal = logits[k]; maxIdx = k; }
            if (maxIdx === scoreToLabel(s.r)) correct++;
        }
        console.log('[train_default] epoch=' + epoch + ' lr=' + epochLR.toFixed(4) + ' val_acc=' + (correct / valN * 100).toFixed(1) + '%');
    }
}
wm.setTrainLR(LR);

/* 终评 + 落盘到内存存储 */
let finalCorrect = 0;
for (let i = trN; i < n; i++) {
    const s = samples[idx[i]];
    const logits = wm.forward(Int8Array.from(s.f));
    let maxIdx = 0, maxVal = -Infinity;
    for (let k = 0; k < 6; k++) if (logits[k] > maxVal) { maxVal = logits[k]; maxIdx = k; }
    if (maxIdx === scoreToLabel(s.r)) finalCorrect++;
}
const acc = finalCorrect / valN;
wm.setAccuracy(acc);
wm.markReady(true);
wm.saveWeights();

const obj = JSON.parse(_mem.get('djsc_weights_v3'));
if (!obj || obj.v !== 7) { console.error('[train_default] 序列化异常：v=' + (obj && obj.v)); process.exit(1); }

/* ---------- 生成 defaultWeights.js ---------- */
const header = `/*
 * ============================================
 * // 作者: 飞升原创  交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 内置默认权重（由真实对局样本离线训练得到，勿手改） =================
 * 生成方式：node build/train_default_weights.mjs（报告 §14C，与 localTrainer 同一训练口径）
 * 训练样本数：${n} 条 | 训练步数：${obj.trained} | 验证准确率：${acc}
 * 生成时间：${new Date().toISOString()}
 */
export const DEFAULT_WEIGHTS = ${JSON.stringify(obj, null, 4)};
`;
writeFileSync(OUT_FILE, header, 'utf8');
console.log('[train_default] ✅ 已生成 ' + OUT_FILE);
console.log('[train_default] v=' + obj.v + ' trained=' + obj.trained + ' acc=' + acc.toFixed(4) + ' 耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log('[train_default] 下一步：node tests/run_tests.mjs（§10.2 将自动走 v7 正向分支）');
console.log('[train_default] ⚠ 门禁同时校验默认模型的梯度健康度（§10.5 有限差分）：');
console.log('[train_default]   若样本质量差（如标签噪声→模型饱和），梯度探针会全零并阻止发布——');
console.log('[train_default]   这是发布门禁的正确行为，请继续收集真实对局样本后重训，勿绕过。');
process.exit(0);
