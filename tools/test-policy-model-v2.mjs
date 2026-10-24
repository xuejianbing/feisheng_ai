#!/usr/bin/env node
/*
 * ============================================
 * // 作者：飞升原创
 * 交流群：1080487560
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 无名AI · 策略模型 v2 与组合规则门测试（零依赖，Node 侧） =================
 * 运行：node tools/test-policy-model-v2.mjs        （通过退出码 0 / 1）
 *
 * 覆盖：
 *   1. comboRulesData 数据契约：6 条规则 / 2 条 hard_force / 4 条 soft_boost，规则 id 与 token 齐备
 *   2. ruleGate 自检与 hard_force 命中（构造「已用酒且手上有杀」局面）
 *   3. client_policy_model_v2 权重自检、概率归一、17 类标签、featureKeep 边界
 *   4. policyModelV2 维度适配：134 维与 130 维均能产出影子记录，129 维应被拒绝
 *      （本次改动核心：仓库 features.js 已为 134 维，原实现用 !==130 会让影子链路恒不产出）
 *   5. 影子模式语义：只记录不改分（shadowEvaluate 不修改候选 score）
 *
 * 说明：本测试沿用 tools/noname-stub-loader.mjs 宿主桩，从 Node 侧 **import 生产模块本身**
 *       （含宿主适配层），不是另写理想化假实现；宿主桩语义见该文件注释。
 *       真机（安卓 WebView）上的动态 import 懒加载时延与宿主集成未在此自动化，属「未验证」。
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

/* 宿主桩：game / _status 等由 ruleGate 读取 */
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
const { COMBO_RULES, HARD_FORCE_RULES } = await import('../score/decision/strategy/comboRulesData.js');
const { hardForce, evalToken, selfTest: ruleGateSelfTest } = await import('../score/decision/strategy/ruleGate.js');
const policyModelV2 = await import('../score/model/net/policyModelV2.js');
const { predictClasses, toModelFeatures, shadowEvaluate, selfTest: pmSelfTest, policyModelStats } = policyModelV2;

/* 权重挂载口径说明：
 * 权重文件是纯脚本（无 import/export），Node 会按 CommonJS 解析 → 命中 UMD 的
 * `module.exports` 分支，**不会**挂到 globalThis；而宿主（浏览器/扩展 ESM 环境）里
 * module 不存在，走 `root.CLIENT_POLICY_MODEL_V2` 分支，root = self，行为正常。
 * 因此 Node 侧显式取 CJS 导出并挂到 globalThis，模拟宿主环境的全局可见性。 */
const wmod = await import('../score/model/net/client_policy_model_v2.js');
const weightExport = (wmod['module.exports'] && wmod['module.exports'].classes) ? wmod['module.exports'] : wmod.default;
globalThis.CLIENT_POLICY_MODEL_V2 = weightExport;

/* ---------- 1. 组合规则数据契约 ---------- */
section('comboRulesData 数据契约');
ok('规则总数为 6', COMBO_RULES.rules.length === 6, COMBO_RULES.rules.length);
ok('hard_force 为 2 条', HARD_FORCE_RULES.length === 2, HARD_FORCE_RULES.length);
ok('soft_boost 为 4 条', COMBO_RULES.rules.filter(r => r.layer === 'soft_boost').length === 4);
ok('hard_force 含 CR_jiu_sha', HARD_FORCE_RULES.some(r => r.id === 'CR_jiu_sha'));
ok('hard_force 含 CR_zhuge_burst', HARD_FORCE_RULES.some(r => r.id === 'CR_zhuge_burst'));
ok('每条规则都有 condition 数组', COMBO_RULES.rules.every(r => Array.isArray(r.condition) && r.condition.length > 0));
ok('每条规则都有 action 与 confidence',
    COMBO_RULES.rules.every(r => typeof r.action === 'string' && typeof r.confidence === 'number'));
ok('hard_force 阈值 0.6', COMBO_RULES.hard_force_threshold === 0.6, COMBO_RULES.hard_force_threshold);
ok('force_unsafe 规则未被放进 hard_force',
    HARD_FORCE_RULES.every(r => !(r.evidence && r.evidence.force_unsafe === true)));

/* ---------- 2. ruleGate ---------- */
section('ruleGate');
const rs = ruleGateSelfTest();
ok('ruleGate 自检通过', rs && rs.ok === true, rs && rs.msg);

const fakeMe = {
    getCards: t => (t === 'h' ? [{ name: 'sha' }] : []),
    countCards: () => 1,
    getEquip: () => null,
};
const tokenCtx = { me: fakeMe, hand: { sha: 1 }, used: ['jiu'] };
ok('token sha_in_hand 命中', evalToken('sha_in_hand', tokenCtx) === true);
ok('token jiu_used 命中', evalToken('jiu_used', tokenCtx) === true);
ok('token sha_count_ge_2 不命中', evalToken('sha_count_ge_2', tokenCtx) === false);
ok('token enemy_hp_le_2 不命中', evalToken('enemy_hp_le_2', tokenCtx) === false);

/* hard_force：已用酒 + 手上有杀 → 应强制 card:sha */
const acts = [
    { type: 'card', id: 'sha', score: 0.1 },
    { type: 'card', id: 'shunshou', score: 9.9 },
];
const hit = hardForce(fakeMe, acts, { me: fakeMe, hand: tokenCtx.hand, used: tokenCtx.used });
ok('hard_force 在「已用酒且有杀」时命中', !!(hit && hit.candidate), hit ? '未命中' : '返回 null');
ok('hard_force 命中的是 card:sha', !!(hit && hit.candidate.id === 'sha'));
ok('hard_force 写入 forcedByRule 标记', !!(hit && hit.candidate.forcedByRule));

/* ---------- 3. 权重本体 ---------- */
section('client_policy_model_v2 权重');
await policyModelV2.startLoading();
const model = (typeof globalThis !== 'undefined' && globalThis.CLIENT_POLICY_MODEL_V2)
    || (typeof window !== 'undefined' && window.CLIENT_POLICY_MODEL_V2) || null;
ok('权重已加载到全局', !!model);
if (model) {
    const st = model.selfTest();
    ok('权重 selfTest 通过', st && st.ok === true, st && st.msg);
    ok('类别为 17 类', model.classes.length === 17, model.classes.length);
    ok('meta.featureDim 为 114', model.meta.featureDim === 114, model.meta.featureDim);
    ok('meta.featureKeep 长度 114', model.meta.featureKeep.length === 114, model.meta.featureKeep.length);
    ok('featureKeep 最大索引 129（对应 130 维特征）',
        Math.max.apply(null, model.meta.featureKeep) === 129, Math.max.apply(null, model.meta.featureKeep));
    const pr = model.predictProba(new Array(114).fill(0));
    ok('predictProba 归一（和≈1）', Math.abs(pr.reduce((a, b) => a + b, 0) - 1) < 1e-9,
        pr.reduce((a, b) => a + b, 0));
}

/* ---------- 4. 维度适配（本次改动核心） ---------- */
section('维度适配：130 / 134 维均可产出影子记录');
const feat130 = new Array(130).fill(0);
const feat134 = new Array(134).fill(0);
feat130[0] = 1; feat130[40] = 2;
feat134[0] = 1; feat134[40] = 2; feat134[133] = 127;   /* f[133] 目标身份 one-hot */

ok('130 维可映射到 114 维', Array.isArray(toModelFeatures(feat130)) && toModelFeatures(feat130).length === 114);
ok('134 维可映射到 114 维', Array.isArray(toModelFeatures(feat134)) && toModelFeatures(feat134).length === 114);
ok('129 维被拒绝（索引不足）', toModelFeatures(new Array(129).fill(0)) === null);

const cls130 = predictClasses(feat130);
ok('130 维可预测出 17 类降序', Array.isArray(cls130) && cls130.length === 17 &&
    cls130.every((c, i, a) => i === 0 || a[i - 1].p >= c.p));

const shadow130 = shadowEvaluate([{ type: 'card', id: 'sha', _feat: feat130 }],
    { type: 'card', id: 'sha' }, null, { mode: 'test', sessionId: 'unit' });
ok('130 维影子评估可产出记录', shadow130 !== null && shadow130 !== undefined);
const shadow134 = shadowEvaluate([{ type: 'card', id: 'sha', _feat: feat134 }],
    { type: 'card', id: 'sha' }, null, { mode: 'test', sessionId: 'unit' });
ok('134 维影子评估可产出记录（原 !==130 会让此处恒为 null）', shadow134 !== null && shadow134 !== undefined);

/* ---------- 5. 影子模式语义 ---------- */
section('影子模式语义');
const cand = { type: 'card', id: 'sha', score: 5.0, _feat: feat134 };
const before = cand.score;
shadowEvaluate([cand], cand, null, { mode: 'test', sessionId: 'unit' });
ok('shadowEvaluate 不修改候选分数', cand.score === before, before + ' -> ' + cand.score);

const ps = pmSelfTest();
ok('policyModelV2 自检通过', ps && ps.ok === true, ps && ps.msg);
const st2 = policyModelStats();
ok('统计口径为 shadow 模式', st2 && st2.mode === 'shadow-default', st2 && st2.mode);

console.log('\n========================================');
console.log('PASS ' + pass + '  FAIL ' + fail);
console.log('========================================');
process.exit(fail === 0 ? 0 : 1);
