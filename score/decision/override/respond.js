/*
 * ============================================
 * // Autor: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 接管 chooseToRespond =================
 * 只影响 AI 是否需要打出闪/桃/无懈。
 * 降级策略与 use.js 相同：单次异常 → 5 秒内走本体。
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js';
// Author: Feisheng Original | License: GPL-3.0
import { log } from '../../foundation/diag/logger.js';
import { decideRespond } from '../basic/respondBrain.js';
import { isAllyOf as relIsAlly, isEnemyOf } from '../relations/relations.js';
import { evaluateTaoRescue } from '../safety/rescuePolicy.js';
import { evaluateWuxie, shouldUseWuxie } from '../response/wuxieEvaluator.js';   /* ★ 无懈唯一权威策略源 */
import { executionEligibility, invokeHost } from '../execution/executionGateway.js';

const ORIG_KEY = '__djsc_orig_chooseToRespond';
const SENTINEL = '__djsc_overridden_respond';

/* ★ 仅作为 respondBrain 的「关键锦囊」特征输入（影响优先级排序），
 *   不再承担「是否出无懈」的最终政策；最终政策唯一来自 wuxieEvaluator。 */
const CRITICAL_TRICKS = ['lebu', 'bingliang', 'nanman', 'wanjian', 'juedou', 'huogong', 'shandian'];

function _shouldOverride(player, event) {
	return executionEligibility('respond', player, event, { sentinel: SENTINEL }).ok;
}

function _keepShan(player) {
	try {
		if (player.hp <= 2) return false;
		const enemies = (game.players || []).filter(function (p) {
			return p && p.alive !== false && p !== player && isEnemyOf(player, p);
		});
		if (!enemies.length) return false;
		const avgHand = enemies.reduce(function (s, e) {
			return s + (e.countCards ? e.countCards('h') : 0);
		}, 0) / Math.max(1, enemies.length);
		if (avgHand >= 2 && player.hp >= 3) return true;
		return false;
	} catch (e) { return false; }
}

/* 返回 true = 保留桃（不出）；false = 出桃。
 * ★ 修复：dyingTarget 一律交给唯一权威 evaluateTaoRescue，去掉原先
 *   `if (dyingTarget && hp<=0) return false`（那会把敌方濒死也判成必救）。
 *   濒死只提升紧急度，不反转敌我方向：self/ally → 救（不保留）；neutral/enemy → 保留。 */
function _keepTao(player, dyingTarget, ctx) {
	try {
		if (dyingTarget) {
			return !evaluateTaoRescue(player, dyingTarget, ctx || {}).allow;
		}
		if (player.hp >= 2) return true;
		return false;
	} catch (e) { return false; }
}
export { _keepTao };

/* 返回 true = 保留无懈（block）。
 * ★ 指令 03：最终政策唯一来自 wuxieEvaluator.evaluateWuxie：
 *   - resolved + use=false → block（保留）；
 *   - resolved + use=true  → 放行（该出保护）；
 *   - unresolved(use=null) → fail-open 放行，交回原生 AI（绝不 hard block）。
 *   旧「最后一张无懈 + 非关键锦囊 → 保留」的硬否决已删除（改为 evaluator 内的 soft cost）。 */
function _keepWuxie(player, event) {
	try {
		const use = shouldUseWuxie(player, event, {});
		if (use === null) return false;   /* 无法判断 → 不 block */
		return use === false;
	} catch (e) { return false; }
}

function _shouldRespond(player, card, event) {
	/* ★ 基本响应决策标准（respondBrain）：明确否决 → 不响应（保守，仅拦明显错误） */
	try {
		const brain = _brainRespond(player, card, event);
		if (brain && brain.veto) return false;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	try {
		const id = get.name(card, player);
		if (id === 'shan') return !_keepShan(player);
		if (id === 'tao') {
			const dying = _status.event && _status.event.dying;
			return !_keepTao(player, dying);
		}
		if (id === 'wuxie') return !_keepWuxie(player, event);
		return true;
	} catch (e) { return true; }
}

/* 用 respondBrain 构建响应决策，拦下明显错误的响应（如无杀却喝酒、藤甲着火等） */
function _brainRespond(player, card, event) {
	try {
		const id = get.name(card, player);
		const par = (event && event.getParent && event.getParent()) || event || {};
		const trig = par._trigger || {};
		const srcName = trig.card ? get.name(trig.card, player) : '';
		const tgtObj = trig.target;
		const me = {
			hp: player.hp !== undefined ? player.hp : 3,
			maxHp: player.maxHp || 3,
			handCount: (player.countCards ? player.countCards('h') : 0),
			shaCount: (player.countCards ? player.countCards('hs', 'sha') : 0),
			wuxieCount: (player.countCards ? player.countCards('h', function (c) { return get.name(c) === 'wuxie'; }) : 0),
			hasZhuge: !!(player.getEquip && player.getEquip('zhuge')),
		};
		/* ★ 濒死救援的友敌判定：与攻击侧统一走敌我系统 relIsAlly（含行为推断），
		 *   身份未明时真队友才救；敌/中性不救（防止救反贼/内奸） */
		let allyOfMe = false;
		try { if (tgtObj) allyOfMe = relIsAlly(player, tgtObj); } catch (e) { allyOfMe = false; }
		let allyOfDying = allyOfMe;
		try { if (tgtObj) allyOfDying = relIsAlly(player, tgtObj); } catch (e) { allyOfDying = allyOfMe; }
		const ev = {
			source: srcName,
			card: srcName,
			dying: !!(par.dying || (_status.event && _status.event.dying)),
			dyingIsMe: !!(_status.event && _status.event.player === player),
			dyingTarget: {
				isAlly: allyOfDying, isMe: tgtObj === player,
				isLord: !!(tgtObj && tgtObj.isLord), threat: allyOfDying ? 1 : 0,
			},
			fatal: (me.hp <= 1),
			elemental: srcName === 'huosha' || srcName === 'leisha',
			strong: srcName === 'jiu',
			target: { isMe: tgtObj === player, isLord: !!(tgtObj && tgtObj.isLord), threat: allyOfMe ? 1 : 0, isAlly: allyOfMe },
			keyTrick: CRITICAL_TRICKS.indexOf(srcName) >= 0 ? srcName : '',
			wuxieUse: null,          /* ★ 无懈：唯一权威结论（null=无法判断 → 不否决） */
			keepShan: me.hp >= 3,
		};
		if (id === 'wuxie') {
			try {
				const wr = evaluateWuxie(player, event, {});
				ev.wuxieUse = wr.resolved ? !!wr.use : null;
				if (wr.originalSpellId && CRITICAL_TRICKS.indexOf(wr.originalSpellId) >= 0) {
					ev.keyTrick = wr.originalSpellId;   /* keyTrick 只用于优先级展示，非最终政策 */
				}
			} catch (e) { ev.wuxieUse = null; }
		}
		return decideRespond(id, { me: me, event: ev });
	} catch (e) { return null; }
}

export function installRespondOverride() {
	try {
		const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (!proto) return;
		if (proto[ORIG_KEY]) return;

		const orig = proto.chooseToRespond;
		if (typeof orig !== 'function') return;
		proto[ORIG_KEY] = orig;

		proto.chooseToRespond = function (...args) {
			const player = this;
			const ev = _status.event;

			if (!_shouldOverride(player, ev)) {
				return orig.apply(this, args);
			}

			const originalFilter = ev.filterCard;
			const host = invokeHost({
				kind: 'respond',
				player: player,
				orig: orig,
				thisArg: this,
				args: args,
				prepare: function () {
					try { ev[SENTINEL] = true; } catch (_) {}
					ev.filterCard = function (card, p, e) {
						try {
							if (typeof originalFilter === 'function' && !originalFilter(card, p, e)) return false;
							const should = _shouldRespond(p, card, e);
							try {
								if (!_status.djsc_overrideStats) _status.djsc_overrideStats = { use: {}, respond: {}, discard: {}, compare: {} };
								const b = _status.djsc_overrideStats.respond;
								const key = should ? 'allow' : 'block';
								b[key] = (b[key] || 0) + 1;
							} catch (_) {}
							return should;
						} catch (_) { return false; }
					};
					return function () {
						try { ev.filterCard = originalFilter; } catch (_) {}
					};
				},
				/* 宿主 GameEvent 仍需使用改写后的 filterCard；成功时不提前恢复。 */
				cleanupOnSuccess: false,
				failureReason: function (e) { return '原生 chooseToRespond 异常：' + e.message; },
			});
			return host.result;
		};

		log.info('override', 'chooseToRespond 接管层已安装');
	} catch (e) {
		try { console.error('[决策积分] installRespondOverride 失败：', e); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
	}
}

export function uninstallRespondOverride() {
	try {
		const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (!proto || !proto[ORIG_KEY]) return;
		proto.chooseToRespond = proto[ORIG_KEY];
		delete proto[ORIG_KEY];
		log.info('override', 'chooseToRespond 接管层已卸载');
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
