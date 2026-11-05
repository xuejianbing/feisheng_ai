/*
 * ============================================
 * // 作者：飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 中央存储抽象（叶子模块，无业务依赖） =================
 * 统一封装 localStorage 访问，治理散落在 42 个文件里的 140+ 处
 * setItem / getItem / removeItem 直调与重复的"配额超限降级"逻辑。
 *
 * 提供的能力：
 *  - safeGet / safeSet / safeRemove：统一 try/catch，异常绝不抛出
 *  - getJSON / setJSON：带 JSON 序列化与校验，损坏数据自动回退默认值
 *  - 防抖写（debouncedSet）：高频更新的 key 合并写入，避免反复全量序列化卡顿
 *  - quota 超限自动降级：写满时先裁剪重试，最终失败绝不打扰对局
 *
 * 所有函数默认静默失败（返回 false / 默认值 / null），保证不引入新报错。
 */

export function getStore() {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch (e) { return null; }
}

/* 读字符串，异常返回默认值 */
export function safeGet(key) {
    try {
        const ls = getStore();
        if (!ls) return null;
        return ls.getItem(key);
    } catch (e) { return null; }
}

/* 写字符串，异常返回 false */
export function safeSet(key, value) {
    try {
        const ls = getStore();
        if (!ls) return false;
        ls.setItem(key, String(value));
        return true;
    } catch (e) { return false; }
}

/* 删除键，异常返回 false */
export function safeRemove(key) {
    try {
        const ls = getStore();
        if (!ls) return false;
        ls.removeItem(key);
        return true;
    } catch (e) { return false; }
}

/* 读 JSON：解析失败或非期望类型时返回默认值，绝不抛错 */
export function getJSON(key, def) {
    try {
        const raw = safeGet(key);
        if (raw === null || raw === undefined) return def;
        const v = JSON.parse(raw);
        return v === undefined ? def : v;
    } catch (e) { return def; }
}

/* 写 JSON：序列化失败或写入失败返回 false */
export function setJSON(key, value) {
    try {
        const json = JSON.stringify(value);
        return safeSet(key, json);
    } catch (e) { return false; }
}

/* ★ 配额超限自动降级写：先尝试写入；失败则把 value 按给定"裁剪函数"缩小后重试。
 *  shape(key, value)：返回裁剪后的 value（如 slice(-N)）。最终仍失败则放弃，静默。 */
export function setJSONQuotaSafe(key, value, shrink) {
    if (!safeSet(key, JSON.stringify(value))) {
        try {
            const next = (shrink && typeof shrink === 'function') ? shrink(value) : value;
            return safeSet(key, JSON.stringify(next));
        } catch (e) { return false; }
    }
    return true;
}

/* ★ 防抖写：对高频更新的 key 合并写入。flushMs 内多次 setJSON 只落一次盘。
 *  返回 flush 函数（供退出/卸载时强制落盘）。 */
const _pending = new Map();   /* key -> { json, timer } */
const _flushes = new Map();   /* key -> flush fn */

export function debouncedSet(key, value, flushMs) {
    flushMs = flushMs || 1000;
    const json = JSON.stringify(value);
    const cur = _pending.get(key);
    if (cur) {
        if (cur.timer) clearTimeout(cur.timer);
        cur.json = json;
        cur.timer = setTimeout(function () { _commit(key); }, flushMs);
        return;
    }
    const rec = { json: json, timer: null };
    rec.timer = setTimeout(function () { _commit(key); }, flushMs);
    _pending.set(key, rec);
}

function _commit(key) {
    try {
        const rec = _pending.get(key);
        if (!rec) return;
        _pending.delete(key);
        const ls = getStore();
        if (ls) ls.setItem(key, rec.json);
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 强制把指定 key 或全部待写数据落盘（卸载/关局前调用） */
export function flushPending(key) {
    try {
        if (key !== undefined) { if (_pending.has(key)) _commit(key); return; }
        const keys = Array.from(_pending.keys());
        for (let i = 0; i < keys.length; i++) _commit(keys[i]);
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 统计当前 pending 写队列（用于面板/自检展示） */
export function pendingStats() {
    return { pending: _pending.size };
}

/* ================= 键枚举 / 配额探针（P2-31：业务层不再直触 localStorage） ================= */

/* 全部键名（Object.keys(localStorage) 的安全替代） */
export function lsKeys() {
    try {
        const ls = getStore();
        if (!ls) return [];
        return Object.keys(ls);
    } catch (e) { return []; }
}

/* 键总数（localStorage.length 的安全替代） */
export function lsLength() {
    try {
        const ls = getStore();
        return ls ? ls.length : 0;
    } catch (e) { return 0; }
}

/* 按下标取键名（localStorage.key(i) 的安全替代；注意枚举期写删会改变下标，调用方同原语义） */
export function lsKey(i) {
    try {
        const ls = getStore();
        return ls ? ls.key(i) : null;
    } catch (e) { return null; }
}

/* 配额探针：写入极小键，成功即删并返回 true；配额满/被禁用返回 false（不抛错） */
export function quotaProbe() {
    try {
        const ls = getStore();
        if (!ls) return true;   /* 无持久化环境时不阻断启动 */
        try {
            ls.setItem('djsc_probe', '1');
            ls.removeItem('djsc_probe');
            return true;
        } catch (e) { return false; }
    } catch (e) { return false; }
}