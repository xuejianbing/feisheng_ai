#!/usr/bin/env node
/*
 * ============================================
 * // 作者：飞升原创
 * 交流群：1080487560
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 无名AI · 策略模型 v3 接线测试（零依赖，Node 侧） =================
 * 运行：node tools/test-policy-model-v3.mjs        （通过退出码 0 / 1）
 *
 * 覆盖（v4.1.5.0「模型/权重接线」验收）：
 *   1. client_policy_model_v3 权重自检、概率归一、17 类标签、featureKeep 边界
 *   2. policyModelV3 维度适配：130 / 134 / 142 维均可产出影子记录，129 维应被拒绝
 *   3. 影子模式语义：只记录不改分（shadowEvaluate 不修改候选 score）
 *   4. 影子队列：drain / confirm 语义正确，记录带 schema 与 decisionId
 *
 * 说明：沿用 tools/noname-stub-loader.mjs 宿主桩，从 Node 侧 import 生产模块本身。
 *      真机（安卓 WebView）动态 import 懒加载时延与宿主集成未在此自动化，属「未验证」。
 */
import { register } from 'node:module';

/* ---------- 宿主环境（必须在 import 生产模块之前就绪） ---------- */
globalThis.self = globalThis;   /* 权重 UMD 的挂载根是 self ?? this */

const LS = (() => {
    const store = new Map();
    return {
        getItem: k => (store.has(String(k)) ? store.get(String(k)) : null),
        setItem: (k, v) => { store.set(String(k), String(v)); },
        removeItem: k => { store.delete(String(k)); },
        clear: () => { store.clear(); },
        _raw: () => store,
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

globalThis.__NONAME_STUB = {
    lib: { config: {} },
    game: { players: [] },
    _status: { phaseNumber: 0 },
};

register('./noname-stub-loader.mjs', import.meta.url);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ('  << ' + extra) : '')); }
};
const section = t => console.log('\n--- ' + t + ' ---');

/* ---------- 依赖（生产模块） ---------- */
const policyModelV3 = await import('../score/model/net/policyModelV3.js');
const { predictClasses, toModelFeatures, shadowEvaluate, drainShadowV3, confirmDrainShadowV3,
        selfTest: pmSelfTest, policyModelStats } = policyModelV3;

/* 权重是纯脚本（UMD）：Node 下走 module.exports 分支，不会挂到 globalThis；
 * 宿主（浏览器/扩展 ESM）里 module 不存在，走 root.CLIENT_POLICY_V3（root=self）。
 * 因此 Node 侧显式取 CJS 导出并挂到 globalThis，模拟宿主环境的全局可见性。 */
const wmod = await import('../score/model/net/client_policy_model_v3.js');
const weightExport = (wmod['module.exports'] && wmod['module.exports'].classes) ? wmod['module.exports'] : wmod.default;
globalThis.CLIENT_POLICY_V3 = weightExport;

/* ---------- 1. 权重本体 ---------- */
section('client_policy_model_v3 权重');
await policyModelV3.startLoading();
const model = (typeof globalThis !== 'undefined' && globalThis.CLIENT_POLICY_V3)
    || (typeof window !== 'undefined' && window.CLIENT_POLICY_V3) || null;
ok('权重已加载到全局', !!model);
if (model) {
    const st = model.selfTest();
    ok('权重 selfTest 通过', st && st.ok === true, st && st.msg);
    ok('类别为 17 类', model.classes.length === 17, model.classes.length);
    ok('schema 为 slot17_student_v3', model.meta.schema === 'slot17_student_v3', model.meta.schema);
    ok('meta.featureDim 为 114', model.meta.featureDim === 114, model.meta.featureDim);
    ok('meta.featureKeep 长度 114', model.meta.featureKeep.length === 114, model.meta.featureKeep.length);
    ok('featureKeep 最大索引 129（对应 130 维特征）',
        Math.max.apply(null, model.meta.featureKeep) === 129, Math.max.apply(null, model.meta.featureKeep));
    const pr = model.predictProba(new Array(130).fill(0));
    ok('predictProba 归一（和≈1）', Math.abs(pr.reduce((a, b) => a + b, 0) - 1) < 1e-9,
        pr.reduce((a, b) => a + b, 0));
}

/* ---------- 2. 维度适配 ---------- */
section('维度适配：130 / 134 / 142 维均可产出影子记录');
const feat130 = new Array(130).fill(0);
const feat134 = new Array(134).fill(0);
const feat142 = new Array(142).fill(0);
feat130[0] = 1; feat130[40] = 2;
feat134[0] = 1; feat134[40] = 2; feat134[133] = 127;   /* f[133] 目标身份 one-hot */
feat142[0] = 1; feat142[40] = 2; feat142[133] = 127; feat142[140] = 64;

ok('130 维可映射（返回 130 维）', Array.isArray(toModelFeatures(feat130)) && toModelFeatures(feat130).length === 130);
ok('134 维可映射（截取前 130 维）', Array.isArray(toModelFeatures(feat134)) && toModelFeatures(feat134).length === 130);
ok('142 维可映射（截取前 130 维）', Array.isArray(toModelFeatures(feat142)) && toModelFeatures(feat142).length === 130);
ok('129 维被拒绝（索引不足）', toModelFeatures(new Array(129).fill(0)) === null);

const cls130 = predictClasses(feat130);
ok('130 维可预测出 17 类降序', Array.isArray(cls130) && cls130.length === 17 &&
    cls130.every((c, i, a) => i === 0 || a[i - 1].p >= c.p));

const shadow130 = shadowEvaluate([{ type: 'card', id: 'sha', _feat: feat130 }],
    { type: 'card', id: 'sha' }, null, { mode: 'test', sessionId: 'unit', round: 1 });
ok('130 维影子评估可产出记录', shadow130 !== null && shadow130 !== undefined);
const shadow134 = shadowEvaluate([{ type: 'card', id: 'sha', _feat: feat134 }],
    { type: 'card', id: 'sha' }, null, { mode: 'test', sessionId: 'unit', round: 1 });
ok('134 维影子评估可产出记录', shadow134 !== null && shadow134 !== undefined);
const shadow142 = shadowEvaluate([{ type: 'card', id: 'sha', _feat: feat142 }],
    { type: 'card', id: 'sha' }, null, { mode: 'test', sessionId: 'unit', round: 1 });
ok('142 维影子评估可产出记录', shadow142 !== null && shadow142 !== undefined);

/* ---------- 3. 影子模式语义 ---------- */
section('影子模式语义');
const cand = { type: 'card', id: 'sha', score: 5.0, _feat: feat142 };
const before = cand.score;
shadowEvaluate([cand], cand, null, { mode: 'test', sessionId: 'unit' });
ok('shadowEvaluate 不修改候选分数', cand.score === before, before + ' -> ' + cand.score);

/* ---------- 4. 影子队列 ---------- */
section('影子队列 drain / confirm');
const drained = drainShadowV3(100);
ok('drainShadowV3 可取回待传记录', Array.isArray(drained) && drained.length >= 3, drained && drained.length);
ok('记录带 decisionId', drained.every(r => r && /^p3-/.test(r.decisionId)), drained[0] && drained[0].decisionId);
ok('记录带 schema 与 top3', drained.every(r => r.schema === 'slot17_student_v3' && Array.isArray(r.top3) && r.top3.length === 3));
const beforeCount = drained.length;
confirmDrainShadowV3(2);
const afterCount = drainShadowV3(100).length;
ok('confirmDrainShadowV3 移除已确认记录', afterCount === beforeCount - 2, beforeCount + ' -> ' + afterCount);

/* ---------- 5. 自检与统计 ---------- */
section('自检与统计');
const ps = pmSelfTest();
ok('policyModelV3 自检通过', ps && ps.ok === true, ps && ps.msg);
const st2 = policyModelStats();
ok('统计口径为 shadow 模式', st2 && st2.mode === 'shadow-default', st2 && st2.mode);
ok('统计 schema 正确', st2 && st2.schema === 'slot17_student_v3', st2 && st2.schema);
if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.policyModelV3) {
    ok('window.__DJSC.policyModelV3 已挂载（引擎接线入口）',
        typeof window.__DJSC.policyModelV3.shadow === 'function');
} else {
    ok('window.__DJSC.policyModelV3 已挂载（引擎接线入口）', false, '未挂载');
}

console.log('\n========================================');
console.log('PASS ' + pass + '  FAIL ' + fail);
console.log('========================================');
process.exit(fail === 0 ? 0 : 1);
