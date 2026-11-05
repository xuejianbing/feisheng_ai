/* 职责：原始玩家操作日志；钩子追加、结算读取，清理时保持原换数组语义。 */
import { _status } from '../../foundation/adapt/host.js';
let _playerLogs = [];
function addPlayerLog(type, data) {
	try {
		_playerLogs.push({
			ts: Date.now(),
			type: type,
			player: _status && _status.me ? (_status.me.name || '?') : '?',
			data: data
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ AI 强度档位 → 冠军策略影响力系数
 *   ⚠ 修复：此前 strengthFactor 在决策链里算完从未被使用，是"死开关"，
 *   所以"极强=接近完美"没有任何依据（档位实际不改变任何行为）。
 *   现在把它真正接到冠军策略的提权系数上：中=1.0（默认，行为与原来完全一致），
 *   极弱=0（纯规则、不接管），强/极强=放大冠军策略影响力。
 *   注意：档位只放大"影响力"，模型/策略本身有错时，放大影响会同时放大错误。 */

export { _playerLogs, addPlayerLog };
export function clearPlayerActionLog() { _playerLogs = []; }
