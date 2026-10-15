/*
 * ============================================
 * // Penulis: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */
import { safeGet as _lsGet, safeSet as _lsSet } from '../../foundation/storage/storage.js?v=41a';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */

/* ================= 校验事件记录器 =================
 * 记录合法性校验事件（拦截/豁免）
 */

const STORAGE_KEY = 'djsc_guard_recorder';

// எழுத்தாளர்: ஃபைஷெங் ஒரிஜினல் | உரிமம்: GPL-3.0
let _events = [];
let _exported = 0;

try {
    const raw = _lsGet(STORAGE_KEY);
    if (raw) {
        const obj = JSON.parse(raw);
        if (obj && Array.isArray(obj.events)) _events = obj.events;
        if (obj && typeof obj.exported === 'number') _exported = obj.exported;
    }
} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

function _save() {
    try {
        _lsSet(STORAGE_KEY, JSON.stringify({
            events: _events.slice(-100),
            exported: _exported,
        }));
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 记录一次校验事件 */
export function recordGuardEvent(type, card, target, result) {
    try {
        _events.push({
            ts: Date.now(),
            type: type,
            card: card,
            target: target,
            result: result,
        });
        if (_events.length > 100) _events = _events.slice(-100);
        _save();
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 获取统计 */
export function getGuardStats() {
    const blocked = _events.filter(e => e.result === 'blocked').length;
    const allowed = _events.filter(e => e.result === 'allowed').length;
    return {
        total: _events.length,
        blocked: blocked,
        allowed: allowed,
        exported: _exported,
        recent: _events.slice(-10),
    };
}

/* 重置 */
export function resetGuardRecorder() {
    _events = [];
    _save();
    return { ok: true };
}
