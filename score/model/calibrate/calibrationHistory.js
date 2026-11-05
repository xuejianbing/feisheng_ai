/* 职责：校准历史快照与持久化，沿用 djsc_calib_history_v1 和原记录格式。 */
import { log } from '../../foundation/diag/logger.js';
import { safeGet as _lsGet, safeSet as _lsSet, safeRemove as _lsRemove } from '../../foundation/storage/storage.js';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */

const HISTORY_KEY = 'djsc_calib_history_v1';
const MAX_HISTORY = 200;

let HISTORY = [];
try {
    const raw = _lsGet(HISTORY_KEY);
    if (raw) HISTORY = JSON.parse(raw) || [];
} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

function _save() {
    try { _lsSet(HISTORY_KEY, JSON.stringify(HISTORY.slice(-MAX_HISTORY))); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 每次游戏结算时调用 */
export function recordCalibrationSnapshot() {
    try {
        const cal = window.__DJSC && window.__DJSC.calibrator;
        if (!cal) return;
        const s = cal.stats();
        const cf = window.__DJSC.conflict && window.__DJSC.conflict.stats ? window.__DJSC.conflict.stats() : null;
        const cl = window.__DJSC.cognitionLog && window.__DJSC.cognitionLog.stats ? window.__DJSC.cognitionLog.stats() : null;
        HISTORY.push({
            ts: Date.now(),
            round: s.total,
            ruleWin: s.ruleWin,
            modelWin: s.modelWin,
            tie: s.tie,
            winRate: s.winRate,
            shift: Object.assign({}, s.shift),
            conflicts: cf ? cf.conflicts : 0,
            cognitions: cl ? cl.total : 0,
        });
        while (HISTORY.length > MAX_HISTORY) HISTORY.shift();
        _save();
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export function getCalibrationHistory(n) {
    return HISTORY.slice(-(n || 30));
}

export function resetCalibrationHistory() {
    HISTORY = [];
    try { _lsRemove(HISTORY_KEY); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
