#!/usr/bin/env node
/*
 * ============================================
 * // 作者：飞升原创
 * 交流群：1080487560
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 无名AI · 策略模型 v3 热更消费端测试（零依赖，Node 侧） =================
 * 运行：node tools/test-policy-model-update.mjs        （通过退出码 0 / 1）
 *
 * 覆盖（v4.1.5.0 模型/权重接线）：
 *   1. classifyPolicyManifest 状态机：unsupported / invalid / needsExtensionUpdate / available / latest
 *   2. validatePolicyMeta 字段校验（坏 schema / 类别数 / 长度不符）
 *   3. buildModelFromMeta 与内置 UMD 权重预测一致（纯数据重建正确性）
 *   4. 端到端：stub fetch 下发 manifest+payload → 校验通过 → 写入缓存 → loadCachedPolicyMeta 可取回；
 *      坏 sha256 → 拒绝且不覆盖旧缓存
 *   5. installPolicyModelUpdate 暴露 window.__DJSC.policyModelUpdate（面板/控制台入口）
 */
import { register } from 'node:module';

globalThis.self = globalThis;

const LS = (() => {
    const store = new Map();
    return {
        getItem: k => (store.has(String(k)) ? store.get(String(k)) : null),
        setItem: (k, v) => { store.set(String(k), String(v)); },
        removeItem: k => { store.delete(String(k)); },
        clear: () => { store.clear(); },
    };
})();
globalThis.localStorage = LS;
globalThis.document = {
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, click() {} }),
    body: { appendChild() {}, removeChild() {} },
    querySelectorAll: () => [], querySelector: () => null, getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
};
globalThis.window = { __DJSC: {}, addEventListener() {}, removeEventListener() {} };
globalThis.confirm = () => false;
globalThis.alert = () => {};
globalThis.fetch = null;
globalThis.__NONAME_STUB = { lib: { config: {} }, game: { players: [] }, _status: { phaseNumber: 0 } };

register('./noname-stub-loader.mjs', import.meta.url);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ('  << ' + extra) : '')); }
};
const section = t => console.log('\n--- ' + t + ' ---');

const pmu = await import('../js/update/policyModelUpdate.js');
const { classifyPolicyManifest, validatePolicyMeta, loadCachedPolicyMeta, loadCachedPolicyRecord,
        checkPolicyModelUpdate, installPolicyModelUpdate, POLICY_PROTOCOL, POLICY_MODEL_ID } = pmu;
const { buildModelFromMeta, startLoading, predictClasses } = await import('../score/model/net/policyModelV3.js');
const { sha256Hex } = await import('../js/update/weightBundle.js');

/* ---- 内置模型（Node CJS 分支） ---- */
const wmod = await import('../score/model/net/client_policy_model_v3.js');
const builtin = (wmod['module.exports'] && wmod['module.exports'].classes) ? wmod['module.exports']
    : (wmod.default && wmod.default.classes) ? wmod.default : null;
ok('内置 v3 模型可加载', !!builtin);
const meta = builtin.meta;

/* ---- 1. 清单状态机 ---- */
section('classifyPolicyManifest 状态机');
const goodManifest = seq => ({
    protocol: POLICY_PROTOCOL, modelId: POLICY_MODEL_ID,
    latest: { modelVersion: 'v3-test-' + seq, releaseSeq: seq, url: '/update/model/policy_v3.json',
        sha256: 'a'.repeat(64), size: 100, requiresExtension: { min: '4.0.0' },
        schema: 'slot17_student_v3', classes: 17, featureDim: 114, hidden: 32 },
});
ok('协议不符 → unsupported', classifyPolicyManifest({ protocol: 'x' }, 0, '4.1.5.0').state === 'unsupported');
ok('缺字段 → invalid', classifyPolicyManifest({ protocol: POLICY_PROTOCOL, modelId: POLICY_MODEL_ID, latest: { modelVersion: 'x' } }, 0, '4.1.5.0').state === 'invalid');
ok('扩展版本过低 → needsExtensionUpdate',
    classifyPolicyManifest({ ...goodManifest(2), latest: { ...goodManifest(2).latest, requiresExtension: { min: '9.9.9' } } }, 0, '4.1.5.0').state === 'needsExtensionUpdate');
ok('新 seq → available', classifyPolicyManifest(goodManifest(2), 1, '4.1.5.0').state === 'available');
ok('同 seq → latest', classifyPolicyManifest(goodManifest(1), 1, '4.1.5.0').state === 'latest');
ok('旧 seq → latest', classifyPolicyManifest(goodManifest(1), 5, '4.1.5.0').state === 'latest');

/* ---- 2. meta 校验 ---- */
section('validatePolicyMeta');
ok('内置 meta 通过校验', validatePolicyMeta(meta).ok === true, validatePolicyMeta(meta).errors.join(';'));
ok('坏 schema 被拒', validatePolicyMeta({ ...meta, schema: 'x' }).ok === false);
ok('坏类别数被拒', validatePolicyMeta({ ...meta, classes: meta.classes.slice(0, 5) }).ok === false);
ok('featureKeep 长度不符被拒', validatePolicyMeta({ ...meta, featureKeep: meta.featureKeep.slice(0, 10) }).ok === false);
ok('缺 w1 被拒', validatePolicyMeta({ ...meta, w1: '' }).ok === false);

/* ---- 3. 纯数据重建 vs 内置预测一致 ---- */
section('buildModelFromMeta 与内置权重预测一致');
const rebuilt = buildModelFromMeta(meta);
ok('可从 meta 重建模型', !!rebuilt);
if (rebuilt && builtin) {
    let maxDiff = 0;
    const probes = [new Array(130).fill(0), new Array(130).fill(1), new Array(130).fill(-1),
        Array.from({ length: 130 }, (_, i) => (i % 7) - 3)];
    for (const p of probes) {
        const a = builtin.predictProba(p), b = rebuilt.predictProba(p);
        for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
    }
    ok('重建模型与内置模型预测一致（maxΔ<1e-12）', maxDiff < 1e-12, maxDiff);
    ok('重建模型 selfTest 通过', rebuilt.selfTest().ok === true);
}

/* ---- 4. 端到端：stub fetch 下发 + 缓存 ---- */
section('端到端下载缓存');
const payloadBytes = Buffer.from(JSON.stringify({ meta }), 'utf8');
const goodSha = sha256Hex(new Uint8Array(payloadBytes));
function makeFetch(manifest, bodyBytes, manifestShaOverride) {
    return async (url) => {
        if (String(url).includes('manifest.json')) {
            return { ok: true, json: async () => manifest };
        }
        return { ok: true, arrayBuffer: async () => bodyBytes.buffer.slice(bodyBytes.byteOffset, bodyBytes.byteOffset + bodyBytes.byteLength) };
    };
}
const manifest1 = { protocol: POLICY_PROTOCOL, modelId: POLICY_MODEL_ID, latest: {
    modelVersion: 'v3-test-r1', releaseSeq: 1, url: '/update/model/policy_v3.json',
    sha256: goodSha, size: payloadBytes.length, requiresExtension: { min: '4.0.0' },
    schema: 'slot17_student_v3', classes: 17, featureDim: 114, hidden: 32 } };

globalThis.fetch = makeFetch(manifest1, payloadBytes);
const st1 = await checkPolicyModelUpdate(true);
ok('下载并缓存成功', st1.ok === true && st1.state === 'downloaded', JSON.stringify(st1));
ok('缓存 meta 可取回', !!loadCachedPolicyMeta());
ok('缓存 seq=1', loadCachedPolicyRecord().seq === 1, JSON.stringify(loadCachedPolicyRecord()));

/* 坏 sha：seq=2 但 sha 不匹配 → 拒绝且不覆盖 seq=1 */
globalThis.fetch = makeFetch({ ...manifest1, latest: { ...manifest1.latest, releaseSeq: 2, sha256: 'b'.repeat(64), modelVersion: 'v3-test-r2' } }, payloadBytes);
const st2 = await checkPolicyModelUpdate(true);
ok('坏 sha256 被拒绝', st2.ok === false && st2.state === 'error', JSON.stringify(st2));
ok('坏包不覆盖旧缓存（seq 仍为 1）', loadCachedPolicyRecord().seq === 1, JSON.stringify(loadCachedPolicyRecord()));

/* 同 seq → latest */
globalThis.fetch = makeFetch(manifest1, payloadBytes);
const st3 = await checkPolicyModelUpdate(true);
ok('同 seq 不重复下载', st3.ok === true && st3.state === 'latest', JSON.stringify(st3));

/* ---- 5. 全局入口挂载 ---- */
section('全局入口');
installPolicyModelUpdate();
ok('window.__DJSC.policyModelUpdate 已挂载',
    !!(typeof window !== 'undefined' && window.__DJSC && window.__DJSC.policyModelUpdate
        && typeof window.__DJSC.policyModelUpdate.check === 'function'));

console.log('\n========================================');
console.log('PASS ' + pass + '  FAIL ' + fail);
console.log('========================================');
process.exit(fail === 0 ? 0 : 1);
