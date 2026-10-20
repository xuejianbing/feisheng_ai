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
import { lib, game, get, _status } from '../../foundation/adapt/host.js?v=41a';
import { bestAction } from '../engine/engine.js?v=41a';
import { isTiesuoRecastSelection } from '../cards/tiesuoRecast.js?v=41a';
import {hostJiedaoTargetDecision,supportedJiedaoShape} from '../cards/jiedaoEvaluator.js?v=41a';
import {hostTiesuoAllowsTarget} from '../cards/tiesuoEvaluator.js?v=41a';
import {isPlayerLinked} from '../state/playerState.js?v=41a';
import {friendlyStripPlan} from '../strategy/friendlyStripPlan.js?v=41a';
import { tacticalEnabled } from '../strategy/tacticalOptimization.js?v=41a';
import {
	executionEligibility,
	stageExecutionDecision,
	commitExecution,
	cancelExecution,
	invokeHost,
	markExecutionFailure,
} from '../execution/executionGateway.js?v=41a';
import { cfg } from '../../foundation/config/util.js?v=41a';
import { effectiveJudgeName } from '../strategy/judgeName.js?v=41a';
import { log } from '../../foundation/diag/logger.js?v=41a';
import { evaluateTaoRescue } from '../safety/rescuePolicy.js?v=41a';
import { evaluateWuxie } from '../response/wuxieEvaluator.js?v=41a';
import { trip, isTripped } from './circuit.js?v=41a';
import { isAllyOf, cardValueOf } from '../threat/threat.js?v=41a';   /* ★ 阵营护栏/五谷拿牌桥 */

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

		/* 找出这张牌在候选里的分数（★ 同牌名可能有多条候选（不同目标），取最高分——
		 *   防止「贴给新目标的高分决策」被「贴给旧目标的 -999 衰减条目」误杀） */
		let thisScore = null;
		for (let i = 0; i < cands.length; i++) {
			const c = cands[i];
			if (c.type === 'card' && c.id === cid) {
				if (thisScore === null || (typeof c.score === 'number' && c.score > thisScore)) thisScore = c.score;
			}
		}
		if (thisScore === null) return false;   /* 引擎没有评估过这张牌 → 不否决 */

		/* ★ 濒死自保豁免：hp<=1 时桃是救命刚需，永不否决 */
		try { if (cid === 'tao' && (player.hp || 0) <= 1) return false; } catch (eTaoV) { }

		/* ★ 引擎判定铁索该重铸而非使用 → 否决「使用」；
			 *   宿主本次请求若已是重铸分支（ev.recast/_recast/_recasting）则放行。 */
		try {
			const _hint0 = _status.djsc_lastTiesuoHint;
			if (cid === 'tiesuo' && _hint0 && _hint0.recast) {
				const _ev0 = _status.event;
				if (isTiesuoRecastSelection(player, card, _ev0)) return false;
				if (_ev0 && (_ev0.recast || _ev0._recast || _ev0._recasting)) return false;
				return true;
			}
		} catch (eTsV) { }

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
	// The independent soft response bridge owns the new policy, including material costs.
	if (tacticalEnabled('wuxie')) return base;

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
				utility: decision.utility,
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

export function installAIUseTargetGuard(ev){
			try {
				const origFTGuard = ev.filterTarget;
				ev.filterTarget = function (card, player, target) {
					try {
						if (typeof origFTGuard === 'function' && !origFTGuard(card, player, target)) return false;
						if (!target) return true;
						const gid = get.name(card, player);
						if(gid==='tiesuo'){
							const allowed=hostTiesuoAllowsTarget(player,target,card,game.players);
							if(allowed!==null)return allowed;
						}
						if(gid==='jiedao'&&tacticalEnabled('enabled')){
                            const pair=hostJiedaoTargetDecision(player,target,card);
                            if(pair)return pair.allowed;
                        }
						if(target===player)return true;
						if (['sha', 'juedou', 'huogong', 'jiedao', 'lebu', 'bingliang', 'huosha', 'leisha', 'zhujin'].indexOf(gid) >= 0) {
							let isFriend = false;
							try { isFriend = isAllyOf(player, target); } catch (eAg) { isFriend = false; }
							if (isFriend) { _stat('allyGuard'); return false; }
							return true;
						}
						if (gid === 'guohe' || gid === 'shunshou') {
							let isFriend = false;
							try { isFriend = isAllyOf(player, target); } catch (eAg2) { isFriend = false; }
							if (!isFriend) return true;
							const plan=friendlyStripPlan(player,card,target);
							if(plan!==undefined){if(!plan)_stat('allyGuard');return !!plan;}
							/* 救援豁免：队友判定区有乐/兵/闪电 → 放行（拆负面状态） */
							try {
								const j = target.getCards ? target.getCards('j') : [];
								for (const jc of (j || [])) {
									let n = '';
									try { n = effectiveJudgeName(jc) || get.name(jc, target) || ''; } catch (eJ) { n = (jc && jc.name) || ''; }
									if (n === 'lebu' || n === 'bingliang' || n === 'shandian') return true;
								}
							} catch (eJ2) { }
							_stat('allyGuard');
							return false;
						}
						if (gid === 'tiesuo') {
							let isFriend = false;
							try { isFriend = isAllyOf(player, target); } catch (eAg3) { isFriend = false; }
							if (!isFriend) return true;
							/* 解链豁免：队友已横置 → 铁索对他=解除连环（救友），放行 */
							const linked = isPlayerLinked(target);
							if (linked) return true;
							_stat('allyGuard');
							return false;
						}
						return true;
					} catch (errG) {
						try { return typeof origFTGuard === 'function' ? origFTGuard(card, player, target) : true; }
						catch (e2G) { return true; }
					}
				};
			} catch (eGuard) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eGuard); }
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
					onSuccess: function () {
						/* filterCard 全 false 已把“结束回合”真实提交给宿主。 */
						commitExecution(player, { type: 'end', id: 'end', target: null });
					},
					failureReason: function (e) { return 'filterCard 短路异常：' + e.message; },
				});
				if (!host.ok) cancelExecution(player, 'end-short-circuit-error', 'use');
				return host.result;
			}

			/* ============ ★ 硬接管 B：否决低价值牌 ============ */

			/* ★ 通用攻击牌阵营护栏：真友目标一律否决（治「无脑火攻火队友/借刀杀队友」等）。
			 *   评分层 actionValue 已强罚真友，但宿主原生 AI 自选目标不受控——必须在 filterTarget 拦。
			 *   豁免：self（自残类不新增约束）、拆/顺队友判定区的乐/兵/闪电（救援）、铁索已横置队友（解链救友）。
			 *   AOE（nanman/wanjian 全员结算）不在名单。异常 fail-open。 */
			installAIUseTargetGuard(ev);

			/* ★ 借刀第二目标（被杀者）护栏：filterTarget2 存在时，被杀者为真友 → 否决 */
			try {
				if (typeof ev.filterTarget2 === 'function') {
					const origFT2 = ev.filterTarget2;
					ev.filterTarget2 = function (card, player, target) {
						try {
							if (typeof origFT2 === 'function' && !origFT2(card, player, target)) return false;
                            if(get.name(card,player)==='jiedao'&&tacticalEnabled('enabled')){const pair=hostJiedaoTargetDecision(player,target,card);if(pair)return pair.allowed;}
							if (target && target !== player) {
								let isFriend = false;
								try { isFriend = isAllyOf(player, target); } catch (eF2) { isFriend = false; }
								if (isFriend) { _stat('allyGuard'); return false; }
							}
							return true;
						} catch (errF2) {
							try { return typeof origFT2 === 'function' ? origFT2(card, player, target) : true; }
							catch (e2F2) { return true; }
						}
					};
				}
			} catch (eFT2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eFT2); }

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

		try { installWuguBridge(); } catch (eWg0) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eWg0); }
		try { installLoseHpBridge(); } catch (eWgI) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eWgI); }
		try { installJiedaoTargetBridge(); } catch (eJtI) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eJtI); }
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
		DEGRADED.clear();
		try { uninstallWuguBridge(); } catch (eWgU0) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eWgU0); }
		try { uninstallLoseHpBridge(); } catch (eWgU) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eWgU); }
		try { uninstallJiedaoTargetBridge(); } catch (eJtU) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eJtU); }
		DEGRADED.clear();
		log.info('override', 'chooseToUse 硬接管层已卸载');
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= 主动掉血/失去体力策略（chooseBool 窄桥） =================
 * 窄桥：仅拦「非本机 AI 玩家的掉血类 chooseBool 询问」，按血量动态裁定是否拒绝掉血：
 *   hp<=1 绝不掉血（自杀式卖血）；hp<=2 需 prompt 有摸牌补偿（摸N张）才允许；其余尊重原 AI。
 * 覆写通道：①args 中的 ai 函数 ②事件上挂的 ev.ai（均为函数型，透传参数仅修正返回值）。 */
const LHP_ORIG_KEY = '__djsc_orig_chooseBool';

function _isLoseHpBoolEvent(ev) {
	try {
		const txt = String((ev && (ev.prompt || ev.title || ev.str)) || '');
		return /失去[一二两三四五六七八九十\d]{0,3}点体力/.test(txt);
	} catch (e) { return false; }
}

function _refuseLoseHp(player, txt, aiRet) {
	try {
		if (aiRet !== true) return false;
		const hp = player.hp || 0;
		if (hp <= 1) return true;
		if (hp <= 2 && !/摸[一二两三四五六七八九十\d]{0,3}张/.test(txt)) return true;
		return false;
	} catch (e) { return false; }
}

function _wrapLoseHpAi(aiFn, player, txt) {
	return function () {
		const ret = aiFn.apply(this, arguments);
		try {
			if (_refuseLoseHp(player, txt, ret)) {
				try { _stat('loseHpGuard'); } catch (eSt) { }
				return false;
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		return ret;
	};
}

export function installLoseHpBridge() {
	try {
		const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (!proto || proto[LHP_ORIG_KEY]) return;
		const orig = proto.chooseBool;
		if (typeof orig !== 'function') return;
		proto[LHP_ORIG_KEY] = orig;

		proto.chooseBool = function (...args) {
			const player = this;
			let _askTxt = '';
			try {
				if (player === game.me) return orig.apply(this, args);
				try { if (player.isOnline2 && player.isOnline2()) return orig.apply(this, args); } catch (e0) { }
				if (cfg('hardOverride', false) === false) return orig.apply(this, args);
				if (isTripped('use')) return orig.apply(this, args);
				if (cfg('decisionScore', false) === false) return orig.apply(this, args);
				try { _askTxt = String((typeof args[0] === 'string' && args[0]) || (_status.event && (_status.event.prompt || _status.event.title)) || ''); } catch (eT) { }
				if (!_isLoseHpBoolEvent({ prompt: _askTxt })) return orig.apply(this, args);
				for (let i = 1; i < args.length; i++) {
					if (typeof args[i] === 'function') { args[i] = _wrapLoseHpAi(args[i], player, _askTxt); break; }
				}
			} catch (eBridge) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eBridge); }
			const ret = orig.apply(this, args);
			try {
				const ev = _status.event;
				if (ev && ev.name === 'chooseBool' && typeof ev.ai === 'function' && !ev.__djsc_lhpWrapped) {
					const _txt = String((ev.prompt || ev.title || '') || _askTxt || '');
					if (_isLoseHpBoolEvent({ prompt: _txt })) {
						ev.ai = _wrapLoseHpAi(ev.ai, player, _txt);
						try { ev.__djsc_lhpWrapped = true; } catch (eM) { }
					}
				}
			} catch (eEv) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eEv); }
			return ret;
		};

		log.info('override', '主动掉血策略桥已安装（chooseBool 窄桥）');
	} catch (e) {
		try { console.error('[决策积分] installLoseHpBridge 失败：', e); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
	}
}

export function uninstallLoseHpBridge() {
	try {
		const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (proto && proto[LHP_ORIG_KEY]) {
			try { proto.chooseBool = proto[LHP_ORIG_KEY]; } catch (eR) { }
			try { delete proto[LHP_ORIG_KEY]; } catch (eD) { }
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= ★ 五谷丰登拿牌桥 =================
 * 五谷亮牌后全场依次拿牌，原生 AI 只按 get.value 死板拿。
 * 窄桥：仅拦「非本机 AI 玩家的五谷拿牌 chooseCard」，覆写 ev.ai.check
 * （与 chooseToDiscard 已验证的同构通道），按局势动态选牌；任何异常 fail-open。
 */
const WUGU_ORIG_KEY = '__djsc_orig_chooseCard';

function _isWuguEvent(ev) {
	try {
		if (!ev) return false;
		if (ev.type === 'wugu' || ev.name === 'wugu') return true;
		try {
			const par = (typeof ev.getParent === 'function') ? ev.getParent() : (ev.parent || null);
			if (par && (par.name === 'wugu' || par.type === 'wugu')) return true;
		} catch (e0) { }
		try { if (typeof ev.prompt === 'string' && ev.prompt.indexOf('五谷') >= 0) return true; } catch (e1) { }
		return false;
	} catch (e) { return false; }
}

function _buildWuguCheck(player) {
	return function (card) {
		try {
			const name = get.name(card, player);
			let v = 0;
			try { v = cardValueOf(card, player) || 0; } catch (eV) { v = 0; }
			let mul = 1.0, add = 0;
			const hpRatio = (player.hp || 0) / Math.max(1, player.maxHp || 1);
			if (name === 'tao') {
				/* 桃：缺血刚需优先；满血不急（后面拿多半有更好的） */
				if (hpRatio < 0.5) add = 2.0;
				else if (hpRatio < 0.8) add = 0.8;
				else mul = 0.6;
			} else if (name === 'wuxie') {
				const wx = player.countCards ? player.countCards('hs', 'wuxie') : 0;
				if (wx === 0) add = 1.0;
				else if (wx === 1) mul = 0.8;
				else mul = 0.6;
			} else if (name === 'shan') {
				if (hpRatio < 0.4) add = 0.6;
			} else if (name === 'jiu') {
				if (player.countCards && player.countCards('hs', 'sha') > 0) add = 0.5;
				else mul = 0.85;
			} else if (name === 'shandian') {
				/* 闪电拿来自用无意义（要贴自己判定区） */
				mul = 0.5;
			}
			/* 装备：对应部位空缺 → 高价值；已有 → 降权 */
			try {
				const st = get.subtypes ? get.subtypes(card) : null;
				if (st && st.length) {
					const eq = player.getCards ? player.getCards('e', function (ec) {
						try { return get.subtypes(ec).indexOf(st[0]) >= 0; } catch (eE) { return false; }
					}) : [];
					if (!eq.length) add += 0.8;
					else mul *= 0.7;
				}
			} catch (eSt) { }
			return v * mul + add;
		} catch (e) { return 0; }
	};
}

export function installWuguBridge() {
	try {
		const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (!proto || proto[WUGU_ORIG_KEY]) return;
		const orig = proto.chooseCard;
		if (typeof orig !== 'function') return;
		proto[WUGU_ORIG_KEY] = orig;

		proto.chooseCard = function (...args) {
			const player = this;
			try {
				if (player === game.me) return orig.apply(this, args);
				try { if (player.isOnline2 && player.isOnline2()) return orig.apply(this, args); } catch (e0) { }
				if (cfg('hardOverride', false) === false) return orig.apply(this, args);
				if (isTripped('use')) return orig.apply(this, args);
				const ev = _status.event;
				if (!_isWuguEvent(ev)) return orig.apply(this, args);
				if (ev[WUGU_ORIG_KEY]) return orig.apply(this, args);   /* 防重入 */
				try { ev[WUGU_ORIG_KEY] = true; } catch (eS) { }
				try {
					if (!ev.ai) ev.ai = {};
					ev.ai.check = _buildWuguCheck(player);
					/* 部分宿主 chooseCard AI 读 ai.result.card——仅当原字段本就是函数时同型覆写（防类型断层） */
					try {
						if (ev.ai.result && typeof ev.ai.result === 'object' && typeof ev.ai.result.card === 'function') {
							ev.ai.result.card = _buildWuguCheck(player);
						}
					} catch (eRc) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eRc); }
					_stat('wugu');
				} catch (eAi) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eAi); }
			} catch (eBridge) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eBridge); }
			return orig.apply(this, args);
		};

		log.info('override', '五谷丰登拿牌桥已安装');
	} catch (e) {
		try { console.error('[决策积分] installWuguBridge 失败：', e); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
	}
}

export function uninstallWuguBridge() {
	try {
		const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (!proto || !proto[WUGU_ORIG_KEY]) return;
		proto.chooseCard = proto[WUGU_ORIG_KEY];
		delete proto[WUGU_ORIG_KEY];
		log.info('override', '五谷丰登拿牌桥已卸载');
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= ★ 借刀第二目标窄桥（chooseTarget） =================
 * 借刀杀人的 target2（被杀者）由使用者通过 chooseTarget 类事件选择，
 * chooseToUse 的 filterTarget 护栏够不到——这里窄拦「借刀特征事件」：
 * 被杀者为真友或使用者本人 → 否决（宿主 filter 正常时本不会出现 self，防御性兜底）。
 * 识别不到的特征场景 fail-open，不影响其它 chooseTarget。
 */
const JTGT_ORIG_KEY = '__djsc_orig_chooseTarget';

function _isJiedaoTarget2Event(ev) {
	try {
		if (!ev) return false;
		if (ev.type === 'jiedao' || ev.name === 'jiedao') return true;
		try {
			const par = (typeof ev.getParent === 'function') ? ev.getParent() : (ev.parent || null);
			if (par && (par.name === 'jiedao' || par.type === 'jiedao')) return true;
		} catch (e0) { }
		try { if (typeof ev.prompt === 'string' && ev.prompt.indexOf('借刀') >= 0) return true; } catch (e1) { }
		return false;
	} catch (e) { return false; }
}

export function installJiedaoTargetBridge() {
	try {
		const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (!proto || proto[JTGT_ORIG_KEY]) return;
		const orig = proto.chooseTarget;
		if (typeof orig !== 'function') return;
		proto[JTGT_ORIG_KEY] = orig;

		proto.chooseTarget = function (...args) {
			const player = this;
			try {
				if (player === game.me) return orig.apply(this, args);
				try { if (player.isOnline2 && player.isOnline2()) return orig.apply(this, args); } catch (e0) { }
				if (cfg('hardOverride', false) === false) return orig.apply(this, args);
				if (isTripped('use')) return orig.apply(this, args);
				const ev = _status.event;
				if (!_isJiedaoTarget2Event(ev)||supportedJiedaoShape()) return orig.apply(this, args);
				if (ev[JTGT_ORIG_KEY]) return orig.apply(this, args);   /* 防重入 */
				try { ev[JTGT_ORIG_KEY] = true; } catch (eS) { }
				try {
					const origFT = ev.filterTarget;
					ev.filterTarget = function (card, player2, target) {
						try {
							if (typeof origFT === 'function' && !origFT(card, player2, target)) return false;
							if (!target) return true;
							if (target === player) { _stat('allyGuard'); return false; }   /* 借敌人刀杀自己=白挨打 */
							let isFriend = false;
							try { isFriend = isAllyOf(player, target); } catch (eF) { isFriend = false; }
							if (isFriend) { _stat('allyGuard'); return false; }
							return true;
						} catch (errJT) {
							try { return typeof origFT === 'function' ? origFT(card, player2, target) : true; }
							catch (e2JT) { return true; }
						}
					};
					_stat('jiedaoBridge');
				} catch (eAi) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eAi); }
			} catch (eBridge) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eBridge); }
			return orig.apply(this, args);
		};

		log.info('override', '借刀第二目标桥已安装');
	} catch (e) {
		try { console.error('[决策积分] installJiedaoTargetBridge 失败：', e); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
	}
}

export function uninstallJiedaoTargetBridge() {
	try {
		const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (!proto || !proto[JTGT_ORIG_KEY]) return;
		proto.chooseTarget = proto[JTGT_ORIG_KEY];
		delete proto[JTGT_ORIG_KEY];
		log.info('override', '借刀第二目标桥已卸载');
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ 导出私有 helper 供发布门禁（§10.12）与诊断复用 */
export { _resolveDyingTarget, _shouldBlockTaoRescue, _wuxieRequestOf, _bridgeWuxieChooseToUse, _isWuguEvent, _buildWuguCheck, _isJiedaoTarget2Event, _isLoseHpBoolEvent, _refuseLoseHp };
