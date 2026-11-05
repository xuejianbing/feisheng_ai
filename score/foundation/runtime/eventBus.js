/*
 * ============================================
 * // Author: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ============================================
 * ★ 事件总线（模块解耦，事件驱动）
 * ============================================ */

const _listeners = new Map();

/**
 * 订阅事件
 */
export function on(event, callback) {
    if (!_listeners.has(event)) {
        _listeners.set(event, []);
    }
    _listeners.get(event).push(callback);
}

/**
 * 发布事件
 */
export function emit(event, data) {
    if (!_listeners.has(event)) return;
    for (const callback of _listeners.get(event)) {
        try {
            callback(data);
        } catch (e) {
            console.warn('[eventBus] 事件处理错误:', event, e);
        }
    }
}

/**
 * 取消订阅
 */
export function off(event, callback) {
    if (!_listeners.has(event)) return;
    const arr = _listeners.get(event);
    const idx = arr.indexOf(callback);
    if (idx >= 0) arr.splice(idx, 1);
}

/**
 * ★ P2-33：一次性订阅（触发一次后自动移除）
 */
export function once(event, callback) {
    function wrapper(data) {
        off(event, wrapper);
        callback(data);
    }
    wrapper.__once = callback;
    on(event, wrapper);
    return wrapper;
}

/**
 * ★ P2-33：清空全部订阅（扩展卸载时调用，防止热重载后旧闭包残留）
 */
export function clear() {
    _listeners.clear();
}

/**
 * 事件统计
 */
export function eventStats() {
    const result = {};
    for (const [event, callbacks] of _listeners) {
        result[event] = callbacks.length;
    }
    return result;
}

/* ============================================
 * ★ 模块注册表（简单依赖注入）
 * ============================================ */

const _modules = new Map();

/**
 * 注册模块
 */
export function registerModule(name, module) {
    _modules.set(name, module);
}

/**
 * 获取模块
 */
export function getModule(name) {
    return _modules.get(name);
}

/**
 * 列出所有模块
 */
export function listModules() {
    return Array.from(_modules.keys());
}
