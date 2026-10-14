/*
 * ============================================
 * // 作者：飛昇原創
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 日志分级 ================= */
import { game } from '../adapt/host.js?v=5e5';
import { formatLogLines } from './logFormat.js?v=5e5';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let _level = 1;   // 默认 info
const _prefix = '【无名AI · 飞雀模型】';

export function setLogLevel(lv) {
	if (typeof lv === 'string' && LEVELS[lv] !== undefined) _level = LEVELS[lv];
	else if (typeof lv === 'number') _level = lv;
}
export function getLogLevel() { return _level; }

function _emit(level, tag, msg) {
	try {
		if (LEVELS[level] < _level) return;
		if (typeof game !== 'object' || typeof game.log !== 'function') return;
		if (Array.isArray(msg)) {
			game.log(formatLogLines(msg.map((line, i) => i === 0 && !String(line).startsWith('[无名AI') ? _prefix + ' ' + line : line)));
		} else {
			game.log(_prefix + (tag ? '[' + (tag === 'selfHeal' ? '自修复' : tag) + '] ' : '') + msg);
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export const log = {
	debug: (tag, msg) => _emit('debug', tag, msg),
	info:  (tag, msg) => _emit('info',  tag, msg),
	warn:  (tag, msg) => _emit('warn',  tag, msg),
	error: (tag, msg) => _emit('error', tag, msg),
};
