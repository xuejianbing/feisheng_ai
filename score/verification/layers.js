/*
 * ============================================
 * // 作者: 飞升原创  交流群: 123456789
 * v3.1α 验证指令·分层自检（报告 §9）
 * ============================================
 *
 * 【四层拆分】解决"检查真实功能"与"检查有没有一个函数名"混层的问题：
 *   L1 加载契约     —— import 成功 / export 存在 / shape·type 正确
 *   L2 运行时连接契约 —— __DJSC 命名空间 / 插件依赖 / 运行时 ready
 *   L3 功能 smoke   —— 真实调用：forward/predict、存储 roundtrip、A/B 状态
 *   L4 实战行为     —— 只能真实对局确认，显式列出、标注 manual，不计失败
 *
 * 聚合而非重写：L2 委托 registry.audit，模块 stats 由各模块自身提供；
 * 本模块只做"按层归类 + 汇总判定"。
 *
 * 调用：__DJSC.verifyLayers()        取四层结构化结果
 *       __DJSC.verifyLayersText()    取可读文本
 */

/* ================= 层定义 ================= */
export const LAYER_DEFS = [
    { id: 'L1', name: '加载契约', auto: true, desc: 'import 成功 / export 存在 / shape·type 正确' },
    { id: 'L2', name: '运行时连接契约', auto: true, desc: '__DJSC 命名空间 / 插件依赖 / 运行时 ready' },
    { id: 'L3', name: '功能 smoke', auto: true, desc: '真实调用核心功能并验证返回值' },
    { id: 'L4', name: '实战行为验证', auto: false, desc: '只能真实对局确认' },
];

/* L4：不可自动化的实战行为清单（来自报告 §9），逐项手动确认 */
const L4_ITEMS = [
    '目标选择（chooseTarget 接管后选敌/选友正确）',
    '响应卡牌（chooseToRespond 杀闪桃无懈）',
    '弃牌（chooseToDiscard 按价值弃低留高）',
    '拼点（compare 接管策略）',
    '回合结束（技能反馈/战报归档触发）',
    '异常模式（扩展武将/特殊事件下特征取值不 NaN）',
];

/* ================= 小工具 ================= */
function _item(name, pass, detail) {
    return { name: name, pass: !!pass, detail: detail || '' };
}

async function _tryImport(rel) {
    try { return { ok: true, mod: await import(rel) }; }
    catch (e) { return { ok: false, err: String(e && e.message || e) }; }
}

function _allFinite(a) {
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
    return true;
}

/* ================= L1：加载契约 =================
 * 关键模块必须 import 成功，且导出面（函数/契约对象）shape·type 正确。 */
const L1_CONTRACT = [
    /* [模块相对路径, [ [导出键, 期望typeof]... ]] */
    ['../model/weights/weights.js', [
        ['MODEL_SCHEMA', 'object'], ['DIM_CHECK', 'object'],
        ['forward', 'function'], ['forwardWithValue', 'function'], ['forwardFastWithValue', 'function'],
        ['predict', 'function'], ['trainOneWithValue', 'function'],
        ['saveWeights', 'function'], ['loadWeights', 'function'], ['resetWeights', 'function'],
    ]],
    ['../model/net/modelState.js', [
        ['getState', 'function'], ['onGameEnd', 'function'], ['forceTrain', 'function'],
        ['triggerHotTrain', 'function'], ['hotGameStart', 'function'], ['hotRecordABScore', 'function'],
        ['hotSwapStats', 'function'], ['forcePromote', 'function'], ['forceDiscard', 'function'],
    ]],
    ['../model/train/localTrainer.js', [['trainLocalAsync', 'function'], ['isTraining', 'function'], ['lastResult', 'function']]],
    ['../foundation/runtime/eventBus.js', [['on', 'function'], ['emit', 'function'], ['eventStats', 'function']]],
    ['../foundation/storage/storage.js', [['safeGet', 'function'], ['safeSet', 'function'], ['safeRemove', 'function']]],
    ['../foundation/runtime/registry.js', [['audit', 'function'], ['bind', 'function'], ['mount', 'function']]],
    ['./selfCheck.js', [['runChecks', 'function'], ['openSelfCheck', 'function']]],
    ['./professionalReadiness.js', [['report', 'function'], ['text', 'function']]],
];

export async function checkL1() {
    const items = [];
    for (const [rel, keys] of L1_CONTRACT) {
        const r = await _tryImport(rel);
        const label = rel.replace('../', '').replace('./', '');
        if (!r.ok) {
            items.push(_item(label, false, 'import 失败: ' + r.err));
            continue;
        }
        const missing = [];
        for (const [k, t] of keys) {
            if (typeof r.mod[k] !== t) missing.push(k + '(' + typeof r.mod[k] + '≠' + t + ')');
        }
        items.push(missing.length === 0
            ? _item(label, true, keys.length + ' 项导出契约全符')
            : _item(label, false, '导出契约缺失: ' + missing.join('、')));
    }
    /* MODEL_SCHEMA 数值 shape 校验（§7 契约：version/featureDim/dims/dtype/architecture） */
    const wm = await _tryImport('../model/weights/weights.js');
    if (wm.ok) {
        const S = wm.mod.MODEL_SCHEMA;
        const shapeOk = !!S
            && typeof S.version === 'number'
            && S.featureDim === 130
            && Array.isArray(S.dims) && S.dims.length === 4
            && S.dims[0] === 130 && S.dims[3] === 6
            && typeof S.dtype === 'object' && typeof S.architecture === 'object';
        items.push(_item('MODEL_SCHEMA shape', shapeOk,
            shapeOk ? ('v' + S.version + ' / ' + S.dims.join('→') + ' / ' + S.architecture.activation + '+' + S.architecture.norm)
                : '契约字段形状不符: ' + JSON.stringify(S).slice(0, 80)));
    }
    return { layer: 'L1', name: '加载契约', auto: true, items: items };
}

/* ================= L2：运行时连接契约 =================
 * 委托 registry.audit（CONTRACT 声明）+ __DJSC 命名空间 + 插件依赖状态。 */
export async function checkL2() {
    const items = [];
    const D = (typeof window !== 'undefined' && window.__DJSC) || {};

    /* 2.1 连接契约（registry.audit 是权威） */
    const reg = await _tryImport('../foundation/runtime/registry.js');
    if (reg.ok) {
        const a = reg.mod.audit();
        items.push(_item('registry 连接契约', a.ok,
            a.ok ? (a.total + ' 项契约全连') : ('断链 ' + a.missing.length + ' 项: '
                + a.missing.slice(0, 5).map(function (m) { return m.path; }).join('、')
                + (a.missing.length > 5 ? ' …' : ''))));
        if (a.stubs && a.stubs.length) {
            items.push(_item('空壳命名空间', false, a.stubs.join('、')));
        }
    } else {
        items.push(_item('registry 连接契约', false, 'registry import 失败: ' + reg.err));
    }

    /* 2.2 关键命名空间挂载 */
    const NS = ['modelState', 'hotSwap', 'decision', 'bandit', 'health', 'selfCheck', 'localTrainer'];
    for (const n of NS) {
        const v = D[n];
        items.push(_item('__DJSC.' + n, !!v && typeof v === 'object',
            v ? (Object.keys(v).length + ' 个键') : '未挂载'));
    }

    /* 2.3 插件依赖状态（宿主内经引擎安装后才有意义） */
    try {
        const pi = await _tryImport('../plugins/index.js');
        if (pi.ok && typeof pi.mod.pluginOverview === 'function') {
            const ov = pi.mod.pluginOverview();
            const rows = Array.isArray(ov) ? ov : (ov && ov.plugins) || [];
            const disabled = rows.filter(function (p) { return p && p.state === 'disabled'; });
            items.push(_item('插件依赖', disabled.length === 0,
                disabled.length === 0
                    ? (rows.length + ' 个插件无 disabled')
                    : ('disabled: ' + disabled.map(function (p) { return p.id; }).join('、'))));
        }
    } catch (e) { /* 插件总线未就绪不算 L2 失败——宿主早期阶段 */ }

    /* 2.4 模块化版就绪信号 */
    items.push(_item('modularReady', D.modularReady === true,
        D.modularReady === true ? '模块全部暴露完成' : '异步加载中（早期阶段不算失败）'));

    return { layer: 'L2', name: '运行时连接契约', auto: true, items: items };
}

/* ================= L3：功能 smoke =================
 * 真实调用并验证返回值形状。模型 smoke 抽成纯函数，便于门禁在 Node 注入复用。 */

/** 模型 smoke（纯函数，参数为 weights 模块——Node 门禁与浏览器共用同一判定） */
export function smokeModel(wm) {
    const items = [];
    const zeros = new Array(130).fill(0);

    /* forward(zeros130) → 长度 6、全 finite、TypedArray */
    try {
        const r = wm.forward(zeros);
        const ok = !!r && r.length === 6 && ArrayBuffer.isView(r) && _allFinite(r);
        items.push(_item('forward(zeros130)', ok, ok ? '6 维全 finite' : '返回异常(null/类型/长度/NaN)'));
    } catch (e) { items.push(_item('forward(zeros130)', false, '抛异常: ' + e.message)); }

    /* predict(zeros130) → probs 长度 6、sum≈1、value finite */
    try {
        const p = wm.predict(zeros);
        let sum = 0;
        for (let i = 0; i < (p && p.probs ? p.probs.length : 0); i++) sum += p.probs[i];
        const ok = !!p && p.probs && p.probs.length === 6
            && Math.abs(sum - 1) <= 1e-4 && _allFinite(p.probs)
            && (p.value === undefined || Number.isFinite(p.value));
        items.push(_item('predict(zeros130)', ok, ok ? ('probs 6 维，Σ=' + sum.toFixed(4)) : 'probs 形状/归一异常'));
    } catch (e) { items.push(_item('predict(zeros130)', false, '抛异常: ' + e.message)); }

    /* forwardWithValue / forwardFastWithValue 与 forward 同几何 */
    try {
        const a = wm.forward(zeros);
        const b = wm.forwardWithValue(zeros);
        const c = wm.forwardFastWithValue(zeros);
        let d1 = 0, d2 = 0;
        for (let i = 0; i < 6; i++) {
            d1 = Math.max(d1, Math.abs(a[i] - b.actorLogits[i]));
            d2 = Math.max(d2, Math.abs(a[i] - c.actorLogits[i]));
        }
        const ok = d1 <= 1e-5 && d2 <= 1e-5;
        items.push(_item('三套前向同几何', ok, 'maxDiff=' + Math.max(d1, d2).toExponential(1)));
    } catch (e) { items.push(_item('三套前向同几何', false, '抛异常: ' + e.message)); }

    return items;
}

/** 存储 smoke：中央存储 encode→decode 精确 roundtrip（临时键，写完即删） */
export function smokeStorage(st) {
    const KEY = 'djsc_smoke_l3_tmp';
    try {
        const payload = { i16: [1234, -2345, 300], f: 0.123456789, s: '自检探测' };
        st.safeSet(KEY, JSON.stringify(payload));
        const back = JSON.parse(st.safeGet(KEY));
        st.safeRemove(KEY);
        const ok = !!back && back.i16[0] === 1234 && back.i16[1] === -2345
            && back.f === payload.f && back.s === payload.s;
        return [_item('存储 encode→decode roundtrip', ok, ok ? '临时键写读删一致' : 'roundtrip 不一致')];
    } catch (e) {
        try { st.safeRemove(KEY); } catch (e2) { /* 清理失败无碍 */ }
        return [_item('存储 encode→decode roundtrip', false, '抛异常: ' + e.message)];
    }
}

/** A/B smoke：状态机处于合法状态且统计可取（隔离不变式由门禁 §10.6 在 Node 全覆盖） */
export function smokeAB(ms) {
    try {
        const s = ms.getState();
        const okState = ['stable', 'training', 'candidate'].indexOf(s) >= 0;
        const st = ms.hotSwapStats();
        const okStats = !!st && typeof st === 'object';
        return [_item('A/B 状态机', okState && okStats,
            'state=' + s + (okStats ? '，统计可取' : '，统计异常'))];
    } catch (e) { return [_item('A/B 状态机', false, '抛异常: ' + e.message)]; }
}

export async function checkL3() {
    const items = [];
    const wm = await _tryImport('../model/weights/weights.js');
    if (wm.ok) items.push.apply(items, smokeModel(wm.mod));
    else items.push(_item('模型 smoke', false, 'weights import 失败: ' + wm.err));

    const st = await _tryImport('../foundation/storage/storage.js');
    if (st.ok) items.push.apply(items, smokeStorage(st.mod));
    else items.push(_item('存储 smoke', false, 'storage import 失败: ' + st.err));

    const ms = await _tryImport('../model/net/modelState.js');
    if (ms.ok) items.push.apply(items, smokeAB(ms.mod));
    else items.push(_item('A/B smoke', false, 'modelState import 失败: ' + ms.err));

    /* eventBus 真实业务订阅（P2-33 口径：≥3 个订阅才证明落地） */
    const eb = await _tryImport('../foundation/runtime/eventBus.js');
    if (eb.ok) {
        const stats = eb.mod.eventStats();
        let total = 0;
        Object.keys(stats).forEach(function (k) { total += stats[k]; });
        items.push(_item('eventBus 业务订阅', total >= 3, total + ' 个订阅 / ' + Object.keys(stats).length + ' 类事件'));
    } else {
        items.push(_item('eventBus 业务订阅', false, 'eventBus import 失败: ' + eb.err));
    }

    return { layer: 'L3', name: '功能 smoke', auto: true, items: items };
}

/* ================= L4：实战行为验证 =================
 * 不可自动化。显式列出待手动确认项，status=manual，永远不计入失败。 */
export function checkL4() {
    return {
        layer: 'L4', name: '实战行为验证', auto: false,
        items: L4_ITEMS.map(function (t) { return { name: t, manual: true, pass: null, detail: '需真实对局确认' }; }),
    };
}

/* ================= 汇总 ================= */
function _summarize(layer) {
    let ok = 0, fail = 0, manual = 0;
    layer.items.forEach(function (it) {
        if (it.manual) { manual++; return; }
        it.pass ? ok++ : fail++;
    });
    return { ok: ok, fail: fail, manual: manual, pass: fail === 0 };
}

export async function verifyLayers() {
    const L1 = await checkL1();
    const L2 = await checkL2();
    const L3 = await checkL3();
    const L4 = checkL4();
    const layers = [L1, L2, L3, L4];
    layers.forEach(function (l) { l.summary = _summarize(l); });
    const totalFail = layers.reduce(function (n, l) { return n + l.summary.fail; }, 0);
    return {
        layers: layers,
        pass: totalFail === 0,
        summary: layers.map(function (l) {
            return l.layer + ' ' + l.name + ': '
                + (l.auto ? ('✅' + l.summary.ok + ' ❌' + l.summary.fail) : ('⏭ 手动 ' + l.summary.manual + ' 项'));
        }).join(' ｜ '),
    };
}

export async function verifyLayersText() {
    const r = await verifyLayers();
    const lines = ['【无名AI 分层自检】' + (r.pass ? '✅ 自动层全通过' : '❌ 有失败项'), r.summary, '─'.repeat(46)];
    r.layers.forEach(function (l) {
        lines.push(l.layer + ' ' + l.name + (l.auto ? '' : '（不可自动化）'));
        l.items.forEach(function (it) {
            const icon = it.manual ? '⏭' : (it.pass ? '  ✅' : '  ❌');
            lines.push('  ' + icon + ' ' + it.name + (it.detail ? ' — ' + it.detail : ''));
        });
    });
    return lines.join('\n');
}

/* ================= 挂到全局 ================= */
if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.verifyLayers = verifyLayers;
    window.__DJSC.verifyLayersText = verifyLayersText;
}
