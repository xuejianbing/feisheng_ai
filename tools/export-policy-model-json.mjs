#!/usr/bin/env node
/*
 * ============================================
 * // 作者：飞升原创
 * 交流群：1080487560
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 策略模型 v3 热更数据导出（纯数据，无脚本执行） =================
 * 用法：node tools/export-policy-model-json.mjs [--out <dir>]
 * 默认输出：<repo>/../update/model/  —— 也可用 --out 指定线上 update/model 目录（如 E:\NoNameAI\update\model）
 *
 * 产物：
 *   policy_v3.json        = { meta: CLIENT_POLICY_V3_META }（含 classes/featureKeep/normMin/normRange/w1..b2 的 base64）
 *   manifest.json         = 热更清单（protocol/modelId/latest{modelVersion,releaseSeq,url,sha256,size,requiresExtension,schema,classes,featureDim,hidden}）
 *
 * 设计要点：热更只下发「纯数据 JSON」，客户端 policyModelV3.js 用本地解码/前向重建模型，
 * 绝不在客户端 eval 远端脚本（与 weightBundle 的安全口径一致）。
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

/* ---- 参数 ---- */
const args = process.argv.slice(2);
let outDir = resolve(REPO, '..', 'update', 'model');
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) { outDir = resolve(args[i + 1]); i++; }
}
const MODEL_FILE = join(REPO, 'score', 'model', 'net', 'client_policy_model_v3.js');

/* ---- 加载内置模型（Node CJS 分支） ---- */
const wmod = await import('file:///' + MODEL_FILE.replace(/\\/g, '/'));
const model = (wmod['module.exports'] && wmod['module.exports'].classes) ? wmod['module.exports']
    : (wmod.default && wmod.default.classes) ? wmod.default : null;
if (!model) { console.error('FAIL: 无法加载 client_policy_model_v3.js'); process.exit(1); }
if (!model.selfTest || !model.selfTest().ok) { console.error('FAIL: 模型自检未通过'); process.exit(1); }

/* ---- 组装数据文件 ---- */
const meta = model.meta;
const need = ['classes', 'numClasses', 'featureDim', 'featureKeep', 'normMin', 'normRange', 'hidden', 'w1', 'b1', 'w2', 'b2'];
const missing = need.filter(k => meta[k] == null);
if (missing.length) { console.error('FAIL: meta 缺字段: ' + missing.join(',')); process.exit(1); }
if (meta.featureKeep.length !== meta.featureDim) { console.error('FAIL: featureKeep 与 featureDim 不一致'); process.exit(1); }
if (meta.classes.length !== meta.numClasses) { console.error('FAIL: classes 与 numClasses 不一致'); process.exit(1); }

const payload = { meta: meta };
const text = JSON.stringify(payload);
const bytes = Buffer.from(text, 'utf8');
const sha = createHash('sha256').update(bytes).digest('hex');

mkdirSync(outDir, { recursive: true });
const modelPath = join(outDir, 'policy_v3.json');
writeFileSync(modelPath, text, 'utf8');

/* ---- 清单：releaseSeq 单调递增；已有 manifest 时 +1 ---- */
let prevSeq = 0;
try {
    const prev = JSON.parse(readFileSync(join(outDir, 'policy_manifest.json'), 'utf8'));
    if (prev && prev.latest && Number.isFinite(prev.latest.releaseSeq)) prevSeq = prev.latest.releaseSeq;
} catch (_) { /* 首次发布 */ }
const seq = prevSeq + 1;

const manifest = {
    protocol: 'djsc-policy-model-update-v1',
    modelId: 'slot17_student_v3',
    latest: {
        modelVersion: 'v3-' + (meta.generatedAt || 'unknown') + '-r' + seq,
        releaseSeq: seq,
        url: '/update/model/policy_v3.json',
        sha256: sha,
        size: bytes.length,
        requiresExtension: { min: '4.1.5.0' },
        schema: meta.schema || 'slot17_student_v3',
        classes: meta.numClasses,
        featureDim: meta.featureDim,
        hidden: meta.hidden,
    },
};
writeFileSync(join(outDir, 'policy_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log('OK  ' + modelPath + '  (' + bytes.length + ' B, sha256 ' + sha.slice(0, 16) + '…, releaseSeq ' + seq + ')');
console.log('OK  ' + join(outDir, 'policy_manifest.json'));
console.log('自检：classes=' + meta.classes.length + ' featureDim=' + meta.featureDim + ' hidden=' + meta.hidden + ' threshold=' + meta.threshold);
