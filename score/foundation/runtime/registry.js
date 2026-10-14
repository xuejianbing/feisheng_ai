/*
 * ============================================
 * // Éditeur: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 唯一挂载总线 =================
 * 背景：此前 window.__DJSC 由「模块自挂载 + index.js 通用合并 + engine.js 两段挂载」
 * 三处并行写入，谁后写谁生效 → 同名互相覆盖、异名互相找不到、对象被当函数调用。
 *
 * 本模块把挂载收敛为单一入口，并给出两条铁律：
 *   1) bind() 为「软合并」：只补缺失键，绝不覆盖已有实现，也不写入 undefined。
 *      → 天然幂等，结果与各来源的执行顺序无关，"赛跑"消失。
 *   2) 模块自挂载（直接赋值）仍是其命名空间的权威来源；bind() 只做补全。
 *
 * 不改任何业务逻辑，只统一连接方式。
 */

/* 取根命名空间对象 */
export function root() {
    try {
        if (typeof window === 'undefined') return {};
        return (window.__DJSC = window.__DJSC || {});
    } catch (e) { return {}; }
}

/* 取（必要时创建）某命名空间对象 */
export function ns(name) {
    try {
        const D = root();
        if (!D[name] || typeof D[name] !== 'object') D[name] = {};
        return D[name];
    } catch (e) { return {}; }
}

/* ★ 软合并：只补缺失键；跳过 undefined；绝不覆盖已有实现 */
export function bind(name, api) {
    try {
        if (!api) return ns(name);
        const t = ns(name);
        for (const k in api) {
            if (!Object.prototype.hasOwnProperty.call(api, k)) continue;
            const v = api[k];
            if (v === undefined) continue;
            if (t[k] === undefined) t[k] = v;
        }
        return t;
    } catch (e) { return null; }
}

/* 硬合并：显式声明的覆盖（谨慎使用） */
export function force(name, api) {
    try {
        const t = ns(name);
        for (const k in api) {
            if (!Object.prototype.hasOwnProperty.call(api, k)) continue;
            const v = api[k];
            if (v === undefined) continue;
            t[k] = v;
        }
        return t;
    } catch (e) { return null; }
}

/* ★ 根级挂载（函数/标量）：已存在则不覆盖，避免多处重复挂载互相冲刷 */
export function mount(name, val) {
    try {
        const D = root();
        if (D[name] === undefined) D[name] = val;
        return D[name];
    } catch (e) { return null; }
}

/* ★ 别名守护：仅当目标键尚未实现、且来源是函数时才补写，绝不用 undefined 覆盖 */
export function ensure(obj, key, src) {
    try {
        if (!obj || typeof obj !== 'object') return;
        if (typeof src !== 'function') return;
        if (typeof obj[key] === 'function') return;
        obj[key] = src;
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 给某命名空间挂一个别名（若缺失） */
export function alias(name, otherName) {
    try {
        const D = root();
        if (D[name] === undefined && D[otherName] !== undefined) D[name] = D[otherName];
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= 连接契约 =================
 * 声明「谁必须存在哪些方法」。这是跨模块连接的最低保证，
 * audit() 会逐条核对，任何一条缺失即视为断链。
 * 新增跨模块接口时在此登记，可自动防回归。 */
const CONTRACT = [
    ['predict', null, 'function'],
    ['weightsReady', null, 'function'],
    ['trainBufferSize', null, 'function'],
    ['modelState', 'onGameEnd', 'function'],
    ['modelState', 'forceTrain', 'function'],
    ['decision', 'listDecisionPoints', 'function'],
    ['decision', 'setTrust', 'function'],
    ['bandit', 'updateTrust', 'function'],
    ['postCheck', 'before', 'function'],
    ['postCheck', 'after', 'function'],
    ['postCheck', 'stats', 'function'],
    ['postCheck', 'reset', 'function'],
    ['replay', 'record', 'function'],
    ['replay', 'stats', 'function'],
    ['compare', 'record', 'function'],
    ['compare', 'stats', 'function'],
    ['psychology', 'deterrence', 'function'],
    ['psychology', 'getState', 'function'],
    ['psychology', 'stats', 'function'],
    ['skillTags', 'get', 'function'],
    ['skillTags', 'playerTags', 'function'],
    ['skillTags', 'stats', 'function'],
    ['softMetrics', 'get', 'function'],
    ['softMetrics', 'learn', 'function'],
    ['softMetrics', 'stats', 'function'],
    ['softMetrics', 'reset', 'function'],
    ['multiProfile', 'stats', 'function'],
    ['strategyBus', 'stats', 'function'],
    ['evolution', 'stats', 'function'],
    ['conflict', 'detect', 'function'],
    ['conflict', 'stats', 'function'],
    ['identity', 'readIdentity', 'function'],
    ['identity', 'stats', 'function'],
    ['health', 'check', 'function'],
    ['localTrainer', 'train', 'function'],
    ['guardRecorder', 'record', 'function'],
    ['allyExempt', 'check', 'function'],
    ['aiStats', 'stats', 'function'],
    ['replayAnalysis', 'getStats', 'function'],
    ['compareAI', 'install', 'function'],
    ['selfCheck', 'open', 'function'],
];

/**
 * 连接自检：核对契约，返回缺失项。
 * @returns {{ok:boolean, total:number, missing:Array, stubs:Array}}
 */
export function audit() {
    const out = { ok: true, total: CONTRACT.length, missing: [], stubs: [] };
    try {
        const D = root();
        const resolve = function (name, key) {
            const node = D[name];
            if (node === undefined || node === null) return undefined;
            if (key === null) return node;
            return node[key];
        };
        for (let i = 0; i < CONTRACT.length; i++) {
            const name = CONTRACT[i][0];
            const key = CONTRACT[i][1];
            const type = CONTRACT[i][2];
            const v = resolve(name, key);
            const path = key ? (name + '.' + key) : name;
            if (typeof v !== type) {
                out.missing.push({ path: path, expect: type, actual: typeof v });
            }
        }
        /* 扫描空壳命名空间（有名字但一个键都没有） */
        for (const name in D) {
            if (!Object.prototype.hasOwnProperty.call(D, name)) continue;
            const node = D[name];
            if (node && typeof node === 'object' && Object.keys(node).length === 0) {
                out.stubs.push(name);
            }
        }
        out.ok = out.missing.length === 0;
    } catch (e) {
        out.ok = false;
        out.missing.push({ path: '<audit>', expect: 'no-throw', actual: 'ERR:' + String(e).slice(0, 40) });
    }
    return out;
}

/* 便捷：在控制台输出契约自检结果 */
export function auditText() {
    const r = audit();
    const lines = ['【无名AI 连接契约自检】' + (r.ok ? '✅ 通过' : '❌ 断链 ' + r.missing.length + ' 项')
        + '（契约 ' + r.total + ' 项）'];
    r.missing.forEach(function (m) { lines.push('  ✗ ' + m.path + ' 期望 ' + m.expect + '，实际 ' + m.actual); });
    if (r.stubs.length) lines.push('  ⚠ 空壳命名空间：' + r.stubs.join('、'));
    return lines.join('\n');
}

/* ================= 自注册 ================= */
try {
    const D = root();
    D.registry = D.registry || {};
    D.registry.bind = bind;
    D.registry.force = force;
    D.registry.mount = mount;
    D.registry.ensure = ensure;
    D.registry.alias = alias;
    D.registry.audit = audit;
    D.registry.auditText = auditText;
    if (D.connAudit === undefined) D.connAudit = auditText;
} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

export const reg = { root, ns, bind, force, mount, ensure, alias, audit, auditText };
export default reg;
