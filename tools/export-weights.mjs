#!/usr/bin/env node
/*
 * ============================================
 * // 作者：飞升原创
 * 交流群：1080487560
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 无名AI · 模型权重包导出 / 校验脚本（仓库内独立工具） =================
 * 用途：由外部工作台在「打包整包」流程中调用，单独产出一份可供前端下载的模型权重包。
 *  - 只生成「纯数据 JSON」（base64 类型化数组 + 元数据），不含任何可执行脚本；
 *  - 摘要与体积口径与前端完全一致（直接复用 js/update/weightBundle.js 的纯逻辑）；
 *  - 不改动工作台现有的输入 / 输出 / 上传行为：本脚本只新增两个产物文件。
 *
 * 用法（在扩展根目录执行）：
 *   ① 从工作台训练结果导出（输入的 JSON 与 weights.js saveWeights() 存档同构）：
 *      node tools/export-weights.mjs --input trained.json --model-version w7d5-20261015-01 --seq 1 \
 *           --out dist --ext-min 4.1 --notes "首个官方权重" --manifest-out dist/manifest.json
 *   ② 直接以内置默认权重作为发布内容（首期可用它打通链路）：
 *      node tools/export-weights.mjs --from-default --model-version w7d5-20261015-01 --seq 1 --out dist
 *   ③ 离线校验一个权重包（不产出任何东西，失败退出码 1）：
 *      node tools/export-weights.mjs --verify dist/<file>.json
 *
 * 说明：
 *  - dataEpoch 默认取运行时契约值 5（不是照抄输入的 dv）。输入 dv < 默认纪元会给出警告，
 *    因为客户端 loadWeights 会拒载 dv 过旧的存档，这类包发布出去将无法生效。
 *  - 探针（probe）为可选：由工作台用同一前向实现算出确定性输入与期望标签后传入，
 *    客户端在应用权重后会自检一次；不提供探针时客户端只做结构 + 有限性校验。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    BUNDLE_FORMAT, MODEL_ID, MODEL_PROTOCOL,
    paramSpec, PARAM_ORDER, decodeBase64, paramsSize, paramsDigest, validateBundle,
} from '../js/update/weightBundle.js';
import { evaluateExportCompatibility } from '../js/update/updateCore.js';

const DEFAULT_DIMS = [134, 128, 64, 6];
const DEFAULT_SCHEMA = 7;
const DEFAULT_EPOCH = 5;

const die = msg => { console.error('❌ ' + msg); process.exit(1); };
const info = msg => console.log('· ' + msg);

/* ---------- 极简参数解析 ---------- */
const parseArgs = argv => {
    const o = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const [k, inline] = a.slice(2).split('=');
            if (inline !== undefined) o[k] = inline;
            else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) { o[k] = argv[++i]; }
            else o[k] = true;
        } else o._.push(a);
    }
    return o;
};

const args = parseArgs(process.argv.slice(2));

const dims = args.dims ? String(args.dims).split(',').map(x => parseInt(x.trim(), 10)) : DEFAULT_DIMS.slice();
if (dims.length !== 4 || dims.some(v => !Number.isInteger(v) || v <= 0)) die('--dims 必须是 4 个正整数，如 134,128,64,6');
const schemaVersion = args.schema !== undefined ? parseInt(args.schema, 10) : DEFAULT_SCHEMA;
const dataEpoch = args.epoch !== undefined ? parseInt(args.epoch, 10) : DEFAULT_EPOCH;
const spec = paramSpec(dims);
const expect = {
    schemaVersion, featureDim: dims[0], dims: dims.slice(), dataEpoch,
    dtype: { weights: 'int8', biases: 'int16' },
    architecture: { activation: 'gelu', norm: 'layernorm', residual: true, critic: true },
};

/* ---------- 模式三：离线校验 ---------- */
if (args.verify) {
    const p = resolve(String(args.verify));
    if (!existsSync(p)) die('找不到待校验文件：' + p);
    let bundle;
    try { bundle = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { die('JSON 解析失败：' + e.message); }
    const r = validateBundle(bundle, expect);
    if (!r.ok) die('权重包未通过校验：\n   - ' + r.errors.join('\n   - '));
    info('校验通过：size=' + r.size + ' sha256=' + r.digest + ' modelVersion=' + bundle.modelVersion + ' seq=' + bundle.releaseSeq);
    process.exit(0);
}

/* ---------- 读取输入权重 ---------- */
let input = null;
if (args['from-default']) {
    const p = resolve('score/model/weights/defaultWeights.js');
    if (!existsSync(p)) die('找不到 score/model/weights/defaultWeights.js（请在扩展根目录执行）');
    input = (await import(pathToFileURL(p).href)).DEFAULT_WEIGHTS;
    info('已以内置默认权重为输入（trained=' + input.trained + ' dv=' + input.dv + '）');
} else if (args.input) {
    const p = resolve(String(args.input));
    if (!existsSync(p)) die('找不到输入文件：' + p);
    try { input = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { die('输入 JSON 解析失败：' + e.message); }
} else {
    die('缺少 --input <json> 或 --from-default（校验模式用 --verify <bundle.json>）');
}
if (!input || typeof input !== 'object') die('输入不是对象');

/* ---------- 参数齐备性（在生成前先报出缺失项，避免产出半包） ---------- */
const missing = spec.filter(s => typeof input[s.key] !== 'string' || !input[s.key]).map(s => s.key);
if (missing.length) die('输入权重缺少必要参数：' + missing.join(', ') + '（需要全部 10 项，含 Critic 头 w4/b4 与残差投影 pr1/pr2）');
for (const s of spec) {
    const b = decodeBase64(input[s.key]);
    const need = s.kind === 'int16' ? s.len * 2 : s.len;
    if (!b || b.byteLength !== need) die('参数 ' + s.key + ' 字节数不符（需要 ' + need + '）：' + (b ? b.byteLength : '解码失败'));
}
info('输入权重齐备：10 项全部长度正确');

/* ---------- 兼容性硬校验（P1-5）：默认拒绝，绝不静默放行 ----------
 * 判定逻辑与前端同源（js/update/updateCore.js 的 evaluateExportCompatibility），
 * 便于自动化测试直接覆盖生产实现。 */
const isFromDefault = !!args['from-default'];
const allowEpochMigration = args['allow-epoch-migration'] === true || args['allow-epoch-migration'] === 'true';
const migrationNote = (args['migration-note'] && args['migration-note'] !== true) ? String(args['migration-note']) : null;

const compat = evaluateExportCompatibility({
    inputV: input.v, inputDv: input.dv,
    schemaVersion, dataEpoch,
    isFromDefault, allowEpochMigration, migrationNote,
});
if (!compat.ok) die(compat.reason);
const epochMigration = compat.epochMigration;
if (epochMigration && epochMigration.from !== epochMigration.to) {
    info('数据纪元迁移：dv=' + epochMigration.from + ' → ' + epochMigration.to + '（依据：' + epochMigration.reason + '）');
}

/* ---------- 必需元数据 ---------- */
if (!args['model-version'] || args['model-version'] === true) die('缺少 --model-version <字符串>');
const modelVersion = String(args['model-version']);
if (!/^[A-Za-z0-9._-]{1,64}$/.test(modelVersion)) die('--model-version 只允许字母/数字/._- 且不超过 64 字符');
const seq = args.seq !== undefined ? parseInt(args.seq, 10) : NaN;
if (!Number.isInteger(seq) || seq < 1) die('--seq 必须是 >= 1 的整数（客户端以它单调递增判断新旧）');

/* ---------- 组包 ---------- */
const params = {};
for (const k of PARAM_ORDER) params[k] = String(input[k]);
const size = paramsSize(params, dims);
const sha256 = paramsDigest(params, dims);
if (!size || !sha256) die('摘要计算失败');

const bundle = {
    format: BUNDLE_FORMAT,
    modelId: MODEL_ID,
    modelVersion,
    releaseSeq: seq,
    schemaVersion,
    featureDim: dims[0],
    dims: dims.slice(),
    dataEpoch,
    dtype: { weights: 'int8', biases: 'int16' },
    architecture: { activation: 'gelu', norm: 'layernorm', residual: true, critic: true },
    /* 纪元迁移审计（无迁移时为 null）：记录输入 dv → 目标纪元及依据，便于事后追溯 */
    epochMigration,
    params,
    trained: Number(input.trained || 0),
    accuracy: Number(input.accuracy || 0),
    size,
    sha256,
    publishedAt: args.published ? String(args.published) : new Date().toISOString(),
    notes: args.notes && args.notes !== true ? String(args.notes) : '',
    requiresExtension: { min: args['ext-min'] && args['ext-min'] !== true ? String(args['ext-min']) : null, max: args['ext-max'] && args['ext-max'] !== true ? String(args['ext-max']) : null },
};
if (args.probe && args.probe !== true) {
    const pp = resolve(String(args.probe));
    if (!existsSync(pp)) die('找不到探针文件：' + pp);
    bundle.probe = JSON.parse(readFileSync(pp, 'utf8'));
}

/* ---------- 产出前自检（同一校验口径，绝不放行半成品） ---------- */
const r = validateBundle(bundle, expect);
if (!r.ok) die('生成的权重包未通过自检：\n   - ' + r.errors.join('\n   - '));

const outDir = resolve(args.out && args.out !== true ? String(args.out) : 'dist');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const fileName = MODEL_ID + '-' + modelVersion + '-' + sha256.slice(0, 8) + '.json';   /* 不可变、内容寻址文件名 */
const outPath = join(outDir, fileName);
writeFileSync(outPath, JSON.stringify(bundle), 'utf8');

info('✅ 权重包已生成：' + outPath);
info('   size=' + size + ' bytes  sha256=' + sha256);
info('   releaseSeq=' + seq + '  modelVersion=' + modelVersion + '  dataEpoch=' + dataEpoch + '  dims=' + JSON.stringify(dims));

/* ---------- 清单（服务端只需静态托管这个文件与上面的权重包） ---------- */
const manifestEntry = {
    modelVersion: bundle.modelVersion,
    releaseSeq: bundle.releaseSeq,
    schemaVersion: bundle.schemaVersion,
    featureDim: bundle.featureDim,
    dims: bundle.dims,
    dataEpoch: bundle.dataEpoch,
    size: bundle.size,
    sha256: bundle.sha256,
    url: '/update/model/' + fileName,
    publishedAt: bundle.publishedAt,
    notes: bundle.notes,
    requiresExtension: bundle.requiresExtension,
};
const manifest = { protocol: MODEL_PROTOCOL, modelId: MODEL_ID, latest: manifestEntry };
if (args['manifest-out'] && args['manifest-out'] !== true) {
    const mp = resolve(String(args['manifest-out']));
    const md = dirname(mp);
    if (!existsSync(md)) mkdirSync(md, { recursive: true });
    writeFileSync(mp, JSON.stringify(manifest, null, 2), 'utf8');
    info('✅ 清单已生成：' + mp);
} else {
    console.log('\n--- manifest.latest（请静态托管到 ' + MODEL_PROTOCOL + ' 约定的清单地址） ---');
    console.log(JSON.stringify(manifestEntry, null, 2));
}
console.log('\n提示：权重包文件名含内容摘要，属不可变文件；升级时旧文件请保留（已下载客户端可能仍在引用）。');
