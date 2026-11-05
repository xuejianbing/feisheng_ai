/*
 * ============================================
 * // 作者：飛昇原創
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 接管 chooseToCompare =================
 * 拼点时按赢率选牌，而非最大点数。
 * 降级策略与 use.js 相同。
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js';
import { log } from '../../foundation/diag/logger.js';
import { executionEligibility, invokeHost } from '../execution/executionGateway.js';

const ORIG_KEY = '__djsc_orig_chooseToCompare';
const SENTINEL = '__djsc_overridden_compare';

function _shouldOverride(player, event) {
	return executionEligibility('compare', player, event, { sentinel: SENTINEL }).ok;
}

function _compareValue(card, player, event) {
	try {
		const num = card && (card.number || get.number(card));
		if (typeof num !== 'number') return 0;
		let targetHandSize = 2;
		try {
			const targets = (event && event.targets) || [];
			if (targets.length) {
				targetHandSize = targets[0].countCards ? targets[0].countCards('h') : 2;
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		const expected = 7 + Math.min(3, (targetHandSize - 2) * 0.5);
		const winChance = num >= expected ? 1 : (num / expected);
		const hpMul = player.hp <= 2 ? 2 : (player.hp <= 3 ? 1.3 : 1);
		return winChance * hpMul * 10;
	} catch (e) { return 0; }
}

export function installCompareOverride() {
	try {
		const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (!proto) return;
		if (proto[ORIG_KEY]) return;

		const orig = proto.chooseToCompare;
		if (typeof orig !== 'function') return;
		proto[ORIG_KEY] = orig;

		proto.chooseToCompare = function (...args) {
			const player = this;
			const ev = _status.event;

			if (!_shouldOverride(player, ev)) {
				return orig.apply(this, args);
			}

			const originalAi = ev.ai;
			const host = invokeHost({
				kind: 'compare',
				player: player,
				orig: orig,
				thisArg: this,
				args: args,
				prepare: function () {
					try { ev[SENTINEL] = true; } catch (_) {}
					if (!ev.ai) ev.ai = {};
					ev.ai.check = function (card) {
						try { return _compareValue(card, player, ev); } catch (_) { return 0; }
					};
					return function () {
						try { ev.ai = originalAi; } catch (_) {}
					};
				},
				cleanupOnSuccess: false,
				failureReason: function (e) { return '原生 chooseToCompare 异常：' + e.message; },
			});
			return host.result;
		};

		log.info('override', 'chooseToCompare 接管层已安装');
	} catch (e) {
		try { console.error('[决策积分] installCompareOverride 失败：', e); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
	}
}

export function uninstallCompareOverride() {
	try {
		const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (!proto || !proto[ORIG_KEY]) return;
		proto.chooseToCompare = proto[ORIG_KEY];
		delete proto[ORIG_KEY];
		log.info('override', 'chooseToCompare 接管层已卸载');
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
