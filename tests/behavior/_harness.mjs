/*
 * ============================================
 * // 作者：飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= Behavior Regression Suite · 共享测试基建 =================
 * 指令 05 · Stage E：tests/behavior/ 行为测试的公共宿主桩与断言脚手架。
 *
 * 设计原则：
 *   - 与 tests/run_tests.mjs 的宿主桩语义完全一致（通用 Proxy，可动态注入）；
 *   - 每个行为测试文件可独立运行：`node tests/behavior/<name>.mjs`；
 *   - 被测模块经由 host.js 唯一耦合点 import 宿主（score/foundation/adapt/host.js
 *     → ../../../../../noname.js），本脚手架在对应位置生成通用宿主桩；
 *   - 测试通过 hostStub 动态注入 get.attitude / get.subtypes / game.players /
 *     _status.currentPhase，从而在不依赖真实无名杀宿主的前提下复现行为。
 */

import { existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ---------- 路径 ---------- */
const _behaviorDir = dirname(fileURLToPath(import.meta.url));          /* .../tests/behavior */
const _pkg = resolve(_behaviorDir, '..', '..');                        /* .../无名AI */
/* host.js `../../../../../noname.js` 解析为仓库根（/workspace）的 noname.js */
const _hostPath = resolve(_behaviorDir, '..', '..', '..', '..', 'noname.js');
const _hostScopePath = join(dirname(_hostPath), 'package.json');

/* ---------- 宿主桩（与 run_tests.mjs 同语义的通用 Proxy） ---------- */
const _HOST_STUB = `/* 自动生成的测试宿主桩——behavior 测试脚手架负责回收，勿手改、勿打包 */
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

/* ---------- 宿主桩生命周期：覆盖写入，退出时恢复/回收 ---------- */
const _hadHost = existsSync(_hostPath);
const _hostBackup = _hadHost ? readFileSync(_hostPath, 'utf8') : null;
const _hadHostScope = existsSync(_hostScopePath);
const _hostScopeBackup = _hadHostScope ? readFileSync(_hostScopePath, 'utf8') : null;

/* Node 18 不会把仓库内 package.json 的 type=module 作用到上一级 noname.js。
 * 临时给宿主桩所在目录建立 ESM scope；测试退出后原样恢复。 */
try {
    let scope = {};
    if (_hostScopeBackup) {
        try { scope = JSON.parse(_hostScopeBackup); } catch (_) { scope = {}; }
    }
    scope.type = 'module';
    writeFileSync(_hostScopePath, JSON.stringify(scope, null, 2) + '\n', 'utf8');
} catch (_) {}

writeFileSync(_hostPath, _HOST_STUB, 'utf8');
function _cleanupHost() {
    try {
        if (_hostBackup !== null) writeFileSync(_hostPath, _hostBackup, 'utf8');
        else if (!_hadHost && existsSync(_hostPath)) rmSync(_hostPath);
    } catch (e) { /* 回收失败不阻断测试 */ }
    try {
        if (_hostScopeBackup !== null) writeFileSync(_hostScopePath, _hostScopeBackup, 'utf8');
        else if (!_hadHostScope && existsSync(_hostScopePath)) rmSync(_hostScopePath);
    } catch (e) { /* 回收失败不阻断测试 */ }
}
process.on('exit', _cleanupHost);
process.on('SIGINT', function () { _cleanupHost(); process.exit(130); });

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

/* ---------- 宿主桩引用（测试注入 seam 的入口） ---------- */
const hostStub = await import(pathToFileURL(_hostPath).href);
export function getHost() { return hostStub; }

/* ---------- 动态加载被测模块（相对 score/ 目录） ---------- */
export function loadScore(rel) {
    return import(pathToFileURL(join(_pkg, 'score', rel)).href);
}

/* ---------- 最小断言框架 ---------- */
let _pass = 0;
const _fails = [];
const _cases = [];
export function ok(cond, name, extra) {
    const passed = !!cond;
    _cases.push({ name: String(name || ''), ok: passed, extra: extra ? String(extra) : '' });
    if (passed) { _pass++; process.stdout.write('.'); }
    else { _fails.push(name + (extra ? '  >> ' + extra : '')); process.stdout.write('F'); }
}
export function eq(a, b, name) { ok(a === b, name, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
export function approx(a, b, tol, name) { ok(Math.abs(a - b) <= tol, name, 'got ' + a + ' want ' + b + ' ±' + tol); }

/* ---------- 汇总退出 ---------- */
export function finish(suiteName) {
    process.stdout.write('\n');
    if (process.env.DJSC_QUALITY_JSON === '1') {
        process.stdout.write('@@DJSC_QUALITY@@' + JSON.stringify({
            suite: String(suiteName || ''),
            passed: _pass,
            failed: _fails.length,
            cases: _cases,
        }) + '\n');
    }
    if (_fails.length) {
        process.stdout.write('[' + suiteName + '] ❌ ' + _pass + ' passed, ' + _fails.length + ' failed\n');
        _fails.forEach(function (f) { process.stdout.write('  - ' + f + '\n'); });
        process.exitCode = 1;
    } else {
        process.stdout.write('[' + suiteName + '] ✅ ' + _pass + ' passed\n');
        process.exitCode = 0;
    }
}