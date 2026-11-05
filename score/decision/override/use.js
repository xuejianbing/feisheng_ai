/*
 * ============================================
 * // 著者: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 接管 chooseToUse（完整版） =================
 * 设计原则：
 *   ★ 硬接管 A：引擎说"结束回合" → 短路结束
 *   ★ 硬接管 B：引擎明确否决某张牌 → filterCard 过滤
 *   ★ 软接管：出牌顺序/估值交给 aiOverride.js
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js';
import { bestAction } from '../engine/engine.js';
import {
	executionEligibility,
	stageExecutionDecision,
	confirmExecutionFromHostEvent,
	cancelExecution,
	invokeHost,
	markExecutionFailure,
} from '../execution/executionGateway.js';
import { cfg } from '../../foundation/config/util.js';
import { log } from '../../foundation/diag/logger.js';
import { evaluateTaoRescue } from '../safety/rescuePolicy.js';
import { evaluateWuxie } from '../response/wuxieEvaluator.js';

const ORIG_KEY = '__djsc_orig_chooseToUse';
const SENTINEL = '__djsc_overridden_use';
const VETO_THRESHOLD = 8;  /* ★ 否决阈值：候选分差超过此值 → 硬否决低分牌 */
const MAX_DYING_DEPTH = 6;      /* ★ 濒死事件链最大上溯层数 */
const TAO_GUARD_KEY = '__djsc_tao_guard';  /* ★ 护栏安装哨兵（避免叠加） */
const WUXIE_BRIDGE_KEY = '__djsc_wuxie_host_bridge';

function _stat(action) {
	try {
		if (!_status.djsc_overrideStats) {
			_status.djsc_overrideStats = { use: {}, respond: {}, discard: {}, compare: {}, soft: {} };
		}
		const b = _status.djsc_overrideStats.use;
		b[action] = (b[action] || 0) + 1;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

function _shouldOverride(player, event) {
	const gate = executionEligibility('use', player, event, {
		sentinel: SENTINEL,
		requireCurrentPhase: true,
		extraGuard: function (_player, ev) {
			try {
				const parent = ev.getParent && ev.getParent();
				if (parent && parent.name === 'chooseToUse') return 'nested-chooseToUse';
				if (parent && (parent.name === 'chooseToSkill' || parent.name === 'chooseToCharacter')) {
					return 'multi-step-host-choice';
				}
			} catch (_) {}
			return true;
		},
	});
	return gate.ok;
}
function _hasAvailableLimitedSkill(player) {
	try {
		const skills = player.skills || [];
		for (const sid of skills) {
			const info = lib.skill[sid];
			if (!info) continue;
			if (!info.limited && !info.awaken) continue;
			if (info.viewAs) {
				try {
					if (typeof lib.filter.skillEnabled === 'function' && !lib.filter.skillEnabled(info, player)) continue;
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				return true;
			}
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return false;
}

function _hasForcedSkill(player) {
	try {
		const skills = player.skills || [];
		for (const sid of skills) {
			const info = lib.skill[sid];
			if (info && info.forced && info.viewAs) {
				try {
					if (typeof lib.filter.skillEnabled === 'function' && !lib.filter.skillEnabled(info, player)) continue;
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				return true;
			}
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return false;
}

/* ★ 检查某张牌是否被引擎明确否决 */
function _shouldVeto(player, card) {
	try {
		const cands = _status.djsc_lastCandidates;
		if (!cands || !cands.length) return false;

		const cid = get.name(card, player);
		if (!cid) return false;

		/* 找出这张牌在候选里的分数 */
		let thisScore = null;
		for (let i = 0; i < cands.length; i++) {
			const c = cands[i];
			if (c.type === 'card' && c.id === cid) {
				thisScore = c.score;
				break;
			}
		}
		if (thisScore === null) return false;   /* 引擎没有评估过这张牌 → 不否决 */

		/* 引擎最高分候选 */
		const top = cands[0];
		if (!top) return false;

		/* 如果这张牌就是引擎第一名 → 不否决 */
		if (top.type === 'card' && top.id === cid) return false;

		/* 分差超过阈值 → 硬否决 */
		if ((top.score - thisScore) > VETO_THRESHOLD) {
			return true;
		}
		return false;
	} catch (e) { return false; }
}

/* ================= ★ Wuxie Host Bridge V2 =================
 * 当前无名杀 _wuxie 走 player.chooseToUse({type:'wuxie', info_map, state})，
 * 而不是 chooseToRespond。这里必须先于 currentPhase hard-override guard 接入，
 * 但严格只处理 type='wuxie'，不会扩大其它回合外 chooseToUse 的接管范围。
 */

function _wuxieRequestOf(args) {
	try {
		const req = Array.isArray(args) ? args[0] : null;
		if (!req || typeof req !== 'object' || req.type !== 'wuxie') return null;
		return req;
	} catch (e) { return null; }
}

function _bridgeWuxieChooseToUse(player, args) {
	const request = _wuxieRequestOf(args);
	if (!request) return null;
	const base = { isWuxie: true, bridged: false, resolved: false, use: null, decision: null };

	try {
		/* 无懈虽走 chooseToUse，但执行语义属于 respond：
		 * 人类/联机/接管开关/熔断/降级统一交给 Execution Gateway。 */
		if (cfg('responseAI', true) === false) return base;
		const gate = executionEligibility('respond', player, request, { allowMissingEvent: true });
		if (!gate.ok) return base;

		try {
			if (request[WUXIE_BRIDGE_KEY]) return request[WUXIE_BRIDGE_KEY];
		} catch (e) {}

		const decision = evaluateWuxie(player, request, { hostRequest: request });
		const result = {
			isWuxie: true,
			bridged: false,
			resolved: !!(decision && decision.resolved),
			use: decision && decision.resolved ? !!decision.use : null,
			decision: decision || null,
		};

		/* unresolved = 真正 fail-open：不修改宿主 ai1，原生决策原样执行。 */
		if (!decision || !decision.resolved) {
			try {
				_status.djsc_lastWuxieBridge = {
					bridged: false, resolved: false, use: null,
					reason: decision ? decision.reason : 'context-unresolved',
					ts: Date.now(),
				};
			} catch (e) {}
			return result;
		}

		const originalAi1 = (typeof request.ai1 === 'function') ? request.ai1 : null;
		request.ai1 = function () {
			try {
				if (!decision.use) return 0;
				let nativeScore = 0;
				if (originalAi1) {
					const n = Number(originalAi1.apply(this, arguments));
					if (isFinite(n)) nativeScore = n;
				}
				/* evaluator 已经完成最终 use 判定时，至少返回正分确保宿主 AI 真正选择无懈；
				 * 同时保留更高的原生正分，不破坏宿主内部选牌排序。 */
				return Math.max(1, nativeScore, 1 + Math.max(0, Number(decision.score) || 0));
			} catch (e) {
				return decision.use ? 1 : 0;
			}
		};
		result.bridged = true;

		try {
			Object.defineProperty(request, WUXIE_BRIDGE_KEY, {
				value: result, configurable: true, enumerable: false, writable: false,
			});
		} catch (e) {}

		try {
			_status.djsc_lastWuxieBridge = {
				bridged: true,
				resolved: true,
				use: !!decision.use,
				originalSpellId: decision.originalSpellId,
				hostState: decision.hostState,
				score: decision.score,
				reason: decision.reason,
				ts: Date.now(),
			};
		} catch (e) {}
		return result;
	} catch (e) {
		/* 桥接异常同样 fail-open：不阻断宿主。 */
		return base;
	}
}

/* ================= ★ 窄范围桃救援护栏（指令 01 / Root Cause D） =================
 * 只解决"回合外 chooseToUse 不走 hard override，导致原生 AI 可能给敌方濒死出桃"。
 * 不删除 currentPhase 全局保护，不扩大 bestAction 接管范围，只对 tao 追加 veto。 */

/* ★ 沿着宿主事件链查找真正的濒死目标。
 *  只读 ev.dying（必须为对象），沿 getParent 上溯至多 maxDepth 层；
 *  用 Set 防循环引用；绝不扫描 game.players 猜 hp<=0。 */
function _resolveDyingTarget(event, maxDepth = MAX_DYING_DEPTH) {
	try {
		if (!event || typeof event !== 'object') {
			try {
				const g = _status.event && _status.event.dying;
				if (g && typeof g === 'object') return g;
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			return null;
		}
		const seen = new Set();
		let ev = event;
		let depth = 0;
		while (ev && typeof ev === 'object' && depth <= maxDepth) {
			if (seen.has(ev)) break;
			seen.add(ev);
			try {
				if (ev.dying && typeof ev.dying === 'object') return ev.dying;
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			let parent = null;
			try { parent = (typeof ev.getParent === 'function') ? ev.getParent() : null; }
			catch (e) { parent = null; }
			if (!parent || parent === ev) break;
			ev = parent;
			depth++;
		}
		try {
			const g = _status.event && _status.event.dying;
			if (g && typeof g === 'object') return g;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		return null;
	} catch (e) { return null; }
}

/* ★ 判定"这张牌是否属于应被硬拦截的敌方/中性濒死救援"。
 *  返回 true = 拦截（filterCard 返回 false）。唯一权威 = evaluateTaoRescue。 */
function _shouldBlockTaoRescue(player, card, event, ctx) {
	try {
		ctx = ctx || {};
		if (!player) return false;
		let cardId = ctx.cardId;
		if (cardId === undefined) {
			try { cardId = get.name(card, player); } catch (e) { cardId = undefined; }
		}
		if (cardId !== 'tao') return false;
		let dying;
		if ('dyingTarget' in ctx) dying = ctx.dyingTarget;
		else dying = _resolveDyingTarget(event, ctx.maxDepth);
		if (!dying) return false;
		const decision = evaluateTaoRescue(player, dying, ctx);
		try {
			_status.djsc_lastResponse = {
				kind: decision.allow ? 'tao-rescue-allow' : 'tao-rescue-block',
				allow: decision.allow,
				relation: decision.relation,
				disposition: decision.disposition,
				reason: decision.reason,
				target: (dying === player) ? 'self' : ((dying && dying.name) || 'unknown'),
				source: 'chooseToUse-guard',
				ts: Date.now()
			};
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		return !decision.allow;
	} catch (e) { return false; }
}

/* ★ 安装窄范围桃救援护栏：仅对 tao 追加 veto，其余牌完全走原生 filter。
 *  返回 restore 函数；未安装时返回 null。 */
function _installTaoRescueGuard(player, ev) {
	try {
		if (!player || !ev || typeof ev !== 'object') return null;
		if (player === game.me) return null;
		if (typeof ev.filterCard !== 'function') return null;
		if (ev[TAO_GUARD_KEY] !== undefined) return null;   /* 已安装 → 不叠加 */
		const inner = ev.filterCard;
		ev.filterCard = function (card, p, e) {
			try {
				if (typeof inner === 'function' && !inner(card, p, e)) return false;
				if (_shouldBlockTaoRescue(player, card, ev, null)) return false;
				return true;
			} catch (err) {
				/* 护栏异常 → 保守放行：交回原生 filter 结果 */
				try { return typeof inner === 'function' ? inner(card, p, e) : true; }
				catch (e2) { return true; }
			}
		};
		ev[TAO_GUARD_KEY] = inner;
		return function restore() {
			try {
				if (ev[TAO_GUARD_KEY] !== undefined) {
					ev.filterCard = ev[TAO_GUARD_KEY];
					delete ev[TAO_GUARD_KEY];
				}
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		};
	} catch (e) { return null; }
}

export function installUseOverride() {
	try {
		const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (!proto) return;
		if (proto[ORIG_KEY]) return;

		const orig = proto.chooseToUse;
		if (typeof orig !== 'function') return;
		proto[ORIG_KEY] = orig;

		proto.chooseToUse = function (...args) {
			const player = this;
			const ev = _status.event;

			/* ★ 无懈官方入口必须先于 currentPhase guard：
			 * _wuxie 的回合外响应本来就不是 currentPhase 玩家。
			 * detected wuxie request 无论 resolved 与否都直接回宿主：
			 * resolved 时只改写该 request.ai1；unresolved 时完全原样 fail-open。 */
			const wuxieBridge = _bridgeWuxieChooseToUse(player, args);
			if (wuxieBridge && wuxieBridge.isWuxie) {
				return orig.apply(this, args);
			}

			/* ★ 窄范围桃救援护栏：独立于 currentPhase / _shouldOverride 先行安装。
			 * 只在"对濒死目标使用桃"时追加 veto；非桃牌与其余路径完全不受影响。 */
			const restoreGuard = _installTaoRescueGuard(player, ev);
			try {
				return _runChooseToUse.call(this, player, ev, orig, args);
			} finally {
				if (restoreGuard) restoreGuard();
			}
		};

		/* ★ 原有 hard override 主流程（护栏已在外部装好并在 finally 恢复） */
		const _runChooseToUse = function (player, ev, orig, args) {
			if (!_shouldOverride(player, ev)) {
				return orig.apply(this, args);
			}

			let ba = null;
			const t0 = performance.now();
			try {
				ba = bestAction();
			} catch (e) {
				markExecutionFailure('use', player, 'bestAction 异常：' + e.message, 'fatal');
				_stat('error');
				return orig.apply(this, args);
			}
			const dt = performance.now() - t0;
			if (dt > 800) {
				markExecutionFailure('use', player, 'bestAction 耗时 ' + Math.round(dt) + 'ms', 'warn');
				_stat('timeout');
				return orig.apply(this, args);
			}

			if (!ba || !ba.rule) {
				_stat('pass');
				return orig.apply(this, args);
			}

			/* ★ Evaluate → Stage：hard override 也只登记事务，真正 useCard/endTurn 再 Commit。 */
			try { stageExecutionDecision(player, ba, 'use'); }
			catch (eTx) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTx); }

			/* ============ ★ 硬接管 A：引擎说"结束回合" → 短路 ============ */
			if (ba.action === 'C' && ba.rule === 'end') {
				if (_hasAvailableLimitedSkill(player) || _hasForcedSkill(player)) {
					_stat('pass-limited');
					try { cancelExecution(player, 'end-deferred-by-forced-skill', 'use'); } catch (eTx) {}
					return orig.apply(this, args);
				}
				_stat('endTurn');
				const origFilterEnd = ev.filterCard;
				const host = invokeHost({
					kind: 'use',
					player: player,
					orig: orig,
					thisArg: this,
					args: args,
					prepare: function () {
						try { ev[SENTINEL] = true; } catch (_) {}
						ev.filterCard = function () { return false; };
						return function () {
							try { ev.filterCard = origFilterEnd; } catch (_) {}
							try { delete ev[SENTINEL]; } catch (_) {}
						};
					},
					cleanupOnSuccess: false,
					failureReason: function (e) { return 'filterCard 短路异常：' + e.message; },
				});
				if (!host.ok) {
					cancelExecution(player, 'end-short-circuit-error', 'use', ba.__djscTransaction && ba.__djscTransaction.id);
				} else {
					confirmExecutionFromHostEvent(
						player,
						{ type: 'end', id: 'end', target: null },
						host.result,
						{
							eventName: 'chooseToUse',
							transactionId: ba.__djscTransaction && ba.__djscTransaction.id,
							verify: function (event) { return !!event.result && event.result.bool === false; },
						}
					).then(function (result) {
						if (!result.ok) cancelExecution(player, result.reason, 'use', ba.__djscTransaction && ba.__djscTransaction.id);
					}).catch(function () {
						cancelExecution(player, 'end-confirm-error', 'use', ba.__djscTransaction && ba.__djscTransaction.id);
					}).finally(function () {
						try { ev.filterCard = origFilterEnd; } catch (_) {}
						try { delete ev[SENTINEL]; } catch (_) {}
					});
				}
				return host.result;
			}

			/* ============ ★ 硬接管 B：否决低价值牌 ============ */
			const origFilterVeto = ev.filterCard;
			const host = invokeHost({
				kind: 'use',
				player: player,
				orig: orig,
				thisArg: this,
				args: args,
				prepare: function () {
					ev.filterCard = function (card, p, e) {
						try {
							if (typeof origFilterVeto === 'function' && !origFilterVeto(card, p, e)) return false;
							if (_shouldVeto(player, card)) {
								_stat('veto');
								return false;
							}
							return true;
						} catch (err) {
							try { return typeof origFilterVeto === 'function' ? origFilterVeto(card, p, e) : true; }
							catch (_) { return true; }
						}
					};
					return function () { try { ev.filterCard = origFilterVeto; } catch (_) {} };
				},
				cleanupOnSuccess: true,
				onSuccess: function () { _stat('pass'); },
				failureReason: function (e) { return 'filterCard 否决异常：' + e.message; },
			});
			if (!host.ok) _stat('error');
			return host.result;
		};

		log.info('override', 'chooseToUse 硬接管层已安装（结束回合 + 低价值牌否决）');
	} catch (e) {
		try { console.error('[决策积分] installUseOverride 失败：', e); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
	}
}

export function uninstallUseOverride() {
	try {
		const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (!proto || !proto[ORIG_KEY]) return;
		proto.chooseToUse = proto[ORIG_KEY];
		delete proto[ORIG_KEY];
		log.info('override', 'chooseToUse 硬接管层已卸载');
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ 导出私有 helper 供发布门禁（§10.12）与诊断复用 */
export { _resolveDyingTarget, _shouldBlockTaoRescue, _wuxieRequestOf, _bridgeWuxieChooseToUse };
