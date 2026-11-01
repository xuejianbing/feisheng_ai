#!/usr/bin/env node
/**
 * 私有权重注入：发布前把 private/weights 里的权重同步到扩展源码树，并校验摘要。
 *
 * 背景（2026-11-01）：权重是收费版的核心资产，不再随仓库公开。仓库只保留
 * 一份历史基线，新权重放在 private/（已 gitignore），构建时注入。
 *
 * 目录约定：
 *   private/weights/defaultWeights.js   真正的权重模块
 *   private/weights/manifest.json       { "sha256": "<文件 sha256>", "version": "...", "note": "..." }
 *
 * 用法：
 *   node tools/prepare-private-weights.mjs            # 注入并校验
 *   node tools/prepare-private-weights.mjs --check    # 只校验，不写
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'private/weights/defaultWeights.js');
const MANIFEST = resolve(ROOT, 'private/weights/manifest.json');
const DEST = resolve(ROOT, 'score/model/weights/defaultWeights.js');

const checkOnly = process.argv.includes('--check');

function fail(msg) {
  console.error(`[weights] ${msg}`);
  process.exit(1);
}

if (!existsSync(SRC)) fail(`缺少 ${SRC}；私有权重不在仓库里，请先从私有备份恢复`);
if (!existsSync(MANIFEST)) fail(`缺少 ${MANIFEST}`);

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
} catch (e) {
  fail(`manifest.json 不是合法 JSON：${e.message}`);
}

const bytes = readFileSync(SRC);
const digest = createHash('sha256').update(bytes).digest('hex');
const expect = String(manifest.sha256 || '').toLowerCase();

if (expect && digest !== expect) fail(`摘要不符：文件 ${digest}，清单 ${expect}`);
if (!expect) console.warn('[weights] 清单没有 sha256，跳过摘要校验');

if (checkOnly) {
  console.log(`[weights] 校验通过 ${digest.slice(0, 16)}… (version=${manifest.version || 'unknown'})`);
  process.exit(0);
}

writeFileSync(DEST, bytes);
console.log(`[weights] 已注入 ${DEST}`);
console.log(`[weights] sha256 ${digest.slice(0, 16)}… version=${manifest.version || 'unknown'}`);
