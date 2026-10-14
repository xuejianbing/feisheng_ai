/*
 * ============================================
 * // 著者: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 战术规划器 =================
 * 目标：从单步贪心升级到受 Strategic Intent 约束的短程多步规划。
 * 能力：
 *   1. 残局解：检测高置信/确定击杀窗口
 *   2. Dependency Graph：表达破防、增伤、连锁、控制、射程与资源展开关系
 *   3. 有界 2-3 步搜索：只执行首步，状态变化后重新规划
 *   4. 协作式预算：350ms deadline，超预算直接回退单步决策
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js?v=5e5';
import { cfg } from '../../foundation/config/util.js?v=5e5';
import { log } from '../../foundation/diag/logger.js?v=5e5';
import { isEnemyOf } from '../threat/threat.js?v=5e5';
import { probHasShan } from '../../model/predict/handInference.js?v=5e5';
import { baseEquipValue } from '../basic/equipBrain.js?v=5e5';
import { signedNormalizedImprovement, DECISION_MARGIN } from '../state/decisionMargin.js?v=5e5';
import { targetKey, candidateTargetValue, setCandidatePriority, ensureCandidatePolicy, PRIORITY_TIER, isCandidateEligible, sameCandidateAction, sameCandidatePolicyBand, compareActionCandidates } from '../state/actionCandidate.js?v=5e5';
import { resolvePlayerByKey } from '../../foundation/adapt/playerIdentity.js?v=5e5';
import { buildPlannerCandidatePool, buildTacticalPlans, tacticalPlanSummary } from './actionDependencyGraph.js?v=5e5';
import { semanticOf, strategicEffectOf } from '../../foundation/adapt/terms.js?v=5e5';
import { stateKey } from '../../foundation/storage/cache.js?v=5e5';

const PLAN_TIMEOUT = 350;

function _nowMs() {
	try { return performance.now(); } catch (e) { return Date.now(); }
}

function _budgetExceeded(deadline) {
	return Number.isFinite(deadline) && _nowMs() >= deadline;
}

function _plannerDeadline(options) {
	if (options && Number.isFinite(options.deadline)) return options.deadline;
	const budgetMs = options && Number.isFinite(options.budgetMs)
		? Math.max(0, options.budgetMs)
		: PLAN_TIMEOUT;
	return _nowMs() + budgetMs;
}
/* ★【对局中卡死防护】状态感知节流：
 * 完全相同的候选/手牌/Intent 在 1 秒内不重复规划；一旦真实状态变化，允许立即重新规划。
 * 这样同时满足滚动时域规划与热循环性能保护。 */
let _lastPlanT = 0;
let _lastPlanSignature = '';
let _lastPlan = null;
const PLAN_THROTTLE_MS = 1000;

export function resetPlanner() {
	_lastPlanT = 0;
	_lastPlanSignature = '';
	_lastPlan = null;
}

function _handNames(me) {
	try {
		const set = new Set();
		me.getCards('h').forEach(function (c) {
			const n = get.name(c, me);
			if (n) set.add(n);
		});
		return set;
	} catch (e) { return new Set(); }
}

function _countCard(me, name) {
	try {
		let n = 0;
		me.getCards('h').forEach(function (c) {
			if (get.name(c, me) === name) n++;
		});
		return n;
	} catch (e) { return 0; }
}


/* ================= 武器射程前瞻 =================
 * Noname 的 attack distance 已包含当前装备修正；武器 distance.attackFrom 通常为
 * 0 / -1 / -2 ...。替换武器时必须先移除旧武器修正，再加入新武器修正：
 *   projected = currentAttackDistance - oldAttackFrom + newAttackFrom
 */
export function projectAttackDistanceWithWeapon(currentAttackDistance, oldAttackFrom, newAttackFrom) {
	const d = Number(currentAttackDistance);
	const oldV = Number(oldAttackFrom);
	const newV = Number(newAttackFrom);
	if (!isFinite(d) || !isFinite(oldV) || !isFinite(newV)) return Infinity;
	return d - oldV + newV;
}

/**
 * 在已标准化的武器候选里选择能让目标进入【杀】攻击距离（<=1）的武器。
 * weapons: [{ id, attackFrom, value, card? }]
 * 优先级：装备价值 > 未来攻击距离（同价值时更长射程优先）。
 */
export function chooseRangeEnablingWeapon(currentAttackDistance, oldAttackFrom, weapons) {
	if (!Array.isArray(weapons) || !weapons.length) return null;
	let best = null;
	for (let i = 0; i < weapons.length; i++) {
		const w = weapons[i];
		if (!w || !w.id || typeof w.attackFrom !== 'number' || !isFinite(w.attackFrom)) continue;
		const projected = projectAttackDistanceWithWeapon(currentAttackDistance, oldAttackFrom, w.attackFrom);
		if (!(projected <= 1)) continue;
		const value = (typeof w.value === 'number' && isFinite(w.value)) ? w.value : 0;
		const cand = Object.assign({}, w, { projectedDistance: projected, value: value });
		if (!best
			|| cand.value > best.value
			|| (cand.value === best.value && cand.projectedDistance < best.projectedDistance)) {
			best = cand;
		}
	}
	return best;
}

function _cardId(card, me) {
	try {
		return (get.name && get.name(card, me)) || (card && card.name) || '';
	} catch (e) { return (card && card.name) || ''; }
}

function _subtype(card, me) {
	try {
		const s = get.subtype ? get.subtype(card, me) : null;
		if (s) return s;
		const id = _cardId(card, me);
		return (id && lib.card && lib.card[id] && lib.card[id].subtype) || null;
	} catch (e) { return null; }
}

function _attackFrom(card, me) {
	try {
		const id = _cardId(card, me);
		if (!id || !lib.card || !lib.card[id]) return 0;
		const d = lib.card[id].distance;
		return (d && typeof d.attackFrom === 'number' && isFinite(d.attackFrom)) ? d.attackFrom : 0;
	} catch (e) { return 0; }
}

function _attackDistance(me, target) {
	try {
		const d = get.distance(me, target, 'attack');
		if (typeof d === 'number' && isFinite(d)) return d;
	} catch (e) { /* fallback below */ }
	try {
		if (me && typeof me.inRange === 'function') return me.inRange(target) ? 1 : Infinity;
	} catch (e) { /* noop */ }
	return Infinity;
}

function _findRangeEnablingWeapon(me, target) {
	try {
		const currentAttackDistance = _attackDistance(me, target);
		if (!(currentAttackDistance > 1) || !isFinite(currentAttackDistance)) return null;

		let oldAttackFrom = 0;
		const equipped = me && me.getCards ? (me.getCards('e') || []) : [];
		for (let i = 0; i < equipped.length; i++) {
			if (_subtype(equipped[i], me) === 'equip1') {
				oldAttackFrom = _attackFrom(equipped[i], me);
				break;
			}
		}

		const hand = me && me.getCards ? (me.getCards('h') || []) : [];
		const weapons = [];
		for (let i = 0; i < hand.length; i++) {
			const card = hand[i];
			if (_subtype(card, me) !== 'equip1') continue;
			const id = _cardId(card, me);
			if (!id) continue;
			weapons.push({
				id: id,
				card: card,
				attackFrom: _attackFrom(card, me),
				value: baseEquipValue(id),
			});
		}
		const best = chooseRangeEnablingWeapon(currentAttackDistance, oldAttackFrom, weapons);
		if (!best) return null;
		best.currentAttackDistance = currentAttackDistance;
		best.oldAttackFrom = oldAttackFrom;
		return best;
	} catch (e) { return null; }
}

function _findKillSequence(me, target, deadline) {
	try {
		if (_budgetExceeded(deadline)) return null;
		if (!target || !target.isIn()) return null;
		const hp = target.hp || 0;
		if (hp <= 0) return null;
		if (hp > 3) return null;

		const hand = _handNames(me);
		if (_budgetExceeded(deadline)) return null;
		/* ★ 资源占用表：追踪已被前面步骤消耗的牌，避免同一张杀被重复计入。
		 * 例如「酒+杀」已用掉那张杀，则后续「决斗看首杀」不能再算它。 */
		const used = {};
		function take(name) {
			if ((hand.has(name) ? 1 : 0) - (used[name] || 0) > 0) {
				used[name] = (used[name] || 0) + 1;
				return true;
			}
			return false;
		}

		const steps = [];
		let totalDmg = 0;      /* 乐观累计（用于估算能否压线） */
		let guaranteedDmg = 0; /* 严格确定伤害：只有已知无响应窗口才计入 */

		/* ★ 攻击范围必须是残局解的一部分：
		 * 当前在范围外时，不允许直接把【杀】算进序列；若手牌武器能补足射程，
		 * 则把“装备武器”作为第一步，再继续酒/杀。 */
		const currentAttackDistance = _attackDistance(me, target);
		const rangeWeapon = currentAttackDistance > 1 ? _findRangeEnablingWeapon(me, target) : null;
		const shaReachable = currentAttackDistance <= 1 || !!rangeWeapon;
		let rangePrepared = false;
		function prepareShaRange() {
			if (!shaReachable) return false;
			if (!rangePrepared && rangeWeapon && currentAttackDistance > 1) {
				steps.push({
					id: rangeWeapon.id,
					type: 'equip',
					enables: 'sha',
					projectedDistance: rangeWeapon.projectedDistance,
				});
				rangePrepared = true;
			}
			return true;
		}

		/* 击杀判断：期望伤害覆盖剩余血；
		 *  且有保底命中(或期望足以超额覆盖)才判可杀，避免纯"期望伤害"造假必杀解。 */
		function killable(expect, guaranteed) {
			if (expect < hp) return false;             /* 期望都没压线 → 不可能 */
			if (guaranteed >= hp) return true;         /* 严格确定伤害足以击杀 */
			return expect >= hp + 1;                   /* 概率路线仅作为高置信规划 */
		}

		if (hand.has('jiu') && shaReachable && take('sha')) {
			prepareShaRange();
			steps.push({ id: 'jiu', dmg: 0, type: 'buff' });
			/* ★ 杀命中按 probHasShan 折算：期望伤害 = 命中率 × 伤害 */
			const pS = probHasShan(target);
			const shaExpect = 2 * (1 - pS);
			steps.push({ id: 'sha', expect: shaExpect, dmg: 2, type: 'damage', target: targetKey(target) });
			totalDmg += shaExpect;
			if (pS <= 0) guaranteedDmg += 2;
		} else if (hand.has('sha') && shaReachable && take('sha')) {
			prepareShaRange();
			const pS = probHasShan(target);
			const shaExpect = 1 * (1 - pS);
			steps.push({ id: 'sha', expect: shaExpect, dmg: 1, type: 'damage', target: targetKey(target) });
			totalDmg += shaExpect;
			if (pS <= 0) guaranteedDmg += 1;
		}

		if (_budgetExceeded(deadline)) return null;
		if (hand.has('huogong') && totalDmg < hp) {
			const mySuits = new Set();
			me.getCards('h').forEach(function (c) {
				mySuits.add(get.suit(c));
			});
			let canBurn = false;
			try {
				const known = me.getKnownCards ? me.getKnownCards(target) : [];
				known.forEach(function (c) {
					if (mySuits.has(get.suit(c))) canBurn = true;
				});
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			if (canBurn || totalDmg === 0) {
				take('huogong');
				/* 火攻本身有手牌/花色条件，命中率较低、且需展示手牌——按 0.7 折算 */
				steps.push({ id: 'huogong', expect: 0.7, dmg: 1, type: 'damage', target: targetKey(target) });
				totalDmg += 0.7;
			}
		}

		if (_budgetExceeded(deadline)) return null;
		if (hand.has('juedou') && totalDmg < hp) {
			const mySha = _countCard(me, 'sha') - (used['sha'] || 0);   /* ★ 扣除已用的杀 */
			const tgtHand = target.countCards ? target.countCards('h') : 0;
			if (mySha >= 1 || tgtHand <= 1) {
				take('juedou');
				steps.push({ id: 'juedou', expect: 0.75, dmg: 1, type: 'damage', target: targetKey(target) });
				totalDmg += 0.75;
			}
		}

		if (_budgetExceeded(deadline)) return null;
		if (hand.has('nanman') && totalDmg < hp) {
			take('nanman');
			steps.push({ id: 'nanman', expect: 0.8, dmg: 1, type: 'damage' });
			totalDmg += 0.8;
		}
		if (hand.has('wanjian') && totalDmg < hp) {
			take('wanjian');
			steps.push({ id: 'wanjian', expect: 0.8, dmg: 1, type: 'damage' });
			totalDmg += 0.8;
		}

		if (_budgetExceeded(deadline)) return null;
		if (hand.has('zhujin') && totalDmg < hp) {
			take('zhujin');
			steps.push({ id: 'zhujin', expect: 0.9, dmg: 1, type: 'damage', target: targetKey(target) });
			totalDmg += 0.9;
		}

		/* ★ 既要期望伤害压线，又要判定合理才判可杀 */
		if (killable(totalDmg, guaranteedDmg)) {
			/* forced 只允许“当前第一步本身即可确定击杀”。
			 * 多步、概率响应、射程准备等路线即使很强，也只进入 critical。 */
			const certainty = (steps.length === 1 && guaranteedDmg >= hp) ? 'forced' : 'critical';
			return {
				target: target,
				targetName: target.name || target.name1 || '?',
				steps: steps,
				totalDmg: Math.round(totalDmg * 10) / 10,
				guaranteedDmg: Math.round(guaranteedDmg * 10) / 10,
				killable: true,
				certainty: certainty,
				killRank: Math.round((guaranteedDmg * 10 + totalDmg) * 100) / 100,
			};
		}
		return null;
	} catch (e) { return null; }
}

function _playerByKey(key) {
	return resolvePlayerByKey(key, game.players || []);
}

function _annotateRangeEnablers(me, candidates) {
	try {
		const list = Array.isArray(candidates) ? candidates : [];
		const attacks = list.filter(function (c) {
			if (!c || c.type === 'end') return false;
			const d = _describePlannerAction(c);
			return d.semantic === 'attack' && d.state && d.state.family === 'basic-strike';
		});
		for (const equip of list) {
			if (!equip || !equip.id) continue;
			const info = lib.card && lib.card[equip.id];
			const isWeaponCandidate = equip.type === 'equip' || !!(info && info.subtype === 'equip1');
			if (!isWeaponCandidate) continue;
			const newAttackFrom = (info && info.distance && Number(info.distance.attackFrom));
			if (!Number.isFinite(newAttackFrom)) continue;

			let oldAttackFrom = 0;
			const equipped = me && me.getCards ? (me.getCards('e') || []) : [];
			for (const card of equipped) {
				if (_subtype(card, me) === 'equip1') {
					oldAttackFrom = _attackFrom(card, me);
					break;
				}
			}

			const enabled = [];
			for (const attack of attacks) {
				const rawTarget = attack.targetObj || candidateTargetValue(attack);
				const target = rawTarget && typeof rawTarget === 'object'
					? rawTarget
					: _playerByKey(Array.isArray(rawTarget) ? rawTarget[0] : rawTarget);
				if (!target) continue;
				const current = _attackDistance(me, target);
				if (!(current > 1) || !Number.isFinite(current)) continue;
				if (projectAttackDistanceWithWeapon(current, oldAttackFrom, newAttackFrom) <= 1) {
					const key = targetKey(target);
					if (key != null && enabled.indexOf(String(key)) < 0) enabled.push(String(key));
				}
			}
			if (enabled.length) {
				try {
					Object.defineProperty(equip, 'plannerEnablesTargets', {
						value: enabled,
						writable: true,
						configurable: true,
						enumerable: false,
					});
				} catch (_) { equip.plannerEnablesTargets = enabled; }
			}
		}
		return list;
	} catch (_) { return candidates; }
}

function _describePlannerAction(action) {
	try {
		if (!action) return {};
		const id = String(action.id || '');
		const effect = strategicEffectOf(id) || null;
		return {
			semantic: semanticOf(id) || '',
			operation: effect && effect.operation || '',
			state: effect && effect.state || null,
		};
	} catch (_) { return {}; }
}

function _resourceBudget(me) {
	const out = {};
	try {
		const hand = me && me.getCards ? (me.getCards('h') || []) : [];
		for (const card of hand) {
			const id = _cardId(card, me);
			if (id) out[id] = (out[id] || 0) + 1;
		}
	} catch (_) {}
	return out;
}

function _plannerStateSignature(me, options) {
	try {
		const candidates = options && Array.isArray(options.candidates)
			? options.candidates
			: (_status.djsc_lastCandidates || []);
		const actionPart = candidates.map(function (c) {
			const a = c && c.strategicAlignment || {};
			const p = c && c.policy || {};
			return String(c && c.type || 'card') + ':' + String(c && c.id || '?') + ':' +
				JSON.stringify(candidateTargetValue(c)) + ':' + Number(c && c.score || 0).toFixed(2) +
				':A=' + String(a.intent || '') + '/' + String(a.target || '') + '/' + String(a.threatTarget || '') +
				'/' + String(a.level || '') + '/' + Number(a.value || 0).toFixed(3) +
				':P=' + String(p.eligible !== false ? 1 : 0) + '/' + String(p.veto === true ? 1 : 0) +
				'/' + String(p.priorityTier || 'normal') + '/' + Number(p.priorityValue || 0).toFixed(3);
		}).join('|');
		const budget = _resourceBudget(me);
		const handPart = Object.keys(budget).sort().map(function (k) { return k + '=' + budget[k]; }).join(',');
		const publicState = (game.players || []).map(function (p) {
			if (!p) return '';
			let handCount = 0;
			try { handCount = p.countCards ? p.countCards('h') : 0; } catch (_) {}
			let linked = false;
			try { linked = typeof p.isLinked === 'function' ? !!p.isLinked() : false; } catch (_) {}
			return String(targetKey(p) || '?') + ':' + Number(p.hp || 0) + '/' + Number(p.maxHp || 0) +
				':h' + Number(handCount || 0) + ':l' + (linked ? 1 : 0) + ':a' + (p.alive === false ? 0 : 1);
		}).join(',');
		const strategicState = options && options.strategicState;
		const intent = strategicState && strategicState.intent;
		const intentPart = intent ? [
			intent.type || '',
			intent.target || '',
			intent.threatTarget || '',
			intent.priorityTier || '',
			Number(intent.priorityValue || 0).toFixed(3),
			Number(intent.confidence || 0).toFixed(3),
			strategicState.fingerprint || '',
			strategicState.roleObjective || '',
		].join(':') : '';
		// 宿主状态键包含装备、判定、属性手牌、使用次数和事件窗口。
		// 不能仅按手牌牌名/数量复用酒后杀、换武器后杀的旧计划。
		return 'ME=' + targetKey(me) + '::WORLD=' + stateKey() + '::' + actionPart + '::H=' + handPart + '::P=' + publicState + '::I=' + intentPart;
	} catch (_) { return ''; }
}

export function planSequence(me, options) {
	try {
		if (!me) return null;
		const t0 = _nowMs();
		const deadline = _plannerDeadline(options);
		if (_budgetExceeded(deadline)) return null;

		const candidates = options && Array.isArray(options.candidates)
			? options.candidates
			: (_status.djsc_lastCandidates || []);
		const bestT = _status.djsc_lastBestT || null;
		if (!candidates.length) return null;

		let killSeq = null;
		for (const p of (game.players || [])) {
			if (_budgetExceeded(deadline)) {
				log.warn('planner', '规划预算耗尽，放弃本轮 Planner 改判');
				return null;
			}
			if (!p || p === me || !p.isIn()) continue;
			if (!isEnemyOf(me, p)) continue;
			const ks = _findKillSequence(me, p, deadline);
			if (!ks) continue;

			/* Planner 只能提升宿主已经生成的真实合法候选，不能凭推演合成动作。
			 * 对有目标动作，type + id + target 必须全部一致。 */
			const first = ks.steps[0] || {};
			const plannedFirst = {
				type: first.type === 'equip' ? 'equip' : 'card',
				id: first.id,
				target: first.target == null ? null : first.target,
			};
			let firstCandidate = candidates.find(function (c) {
				return c && isCandidateEligible(c) && sameCandidateAction(c, plannedFirst);
			}) || null;
			if (!firstCandidate && first.type === 'equip') {
				const cardVariant = { type: 'card', id: first.id, target: plannedFirst.target };
				firstCandidate = candidates.find(function (c) {
					return c && isCandidateEligible(c) && sameCandidateAction(c, cardVariant);
				}) || null;
			}
			if (!firstCandidate) continue;
			ks.firstCandidate = firstCandidate;

			const ksTier = ks.certainty === 'forced' ? 2 : 1;
			const bestTier = killSeq ? (killSeq.certainty === 'forced' ? 2 : 1) : -1;
			if (!killSeq || ksTier > bestTier || (ksTier === bestTier && ks.killRank > killSeq.killRank)) {
				killSeq = ks;
			}
		}
		/* 最后一个敌人的搜索也可能刚好跨过 deadline；任何超预算结果都不得进入改判。 */
		if (_budgetExceeded(deadline)) {
			log.warn('planner', '规划预算耗尽，放弃本轮 Planner 改判');
			return null;
		}
		if (killSeq && killSeq.firstCandidate) {
			log.debug('planner', '残局解：打 ' + killSeq.targetName + ' ' + killSeq.totalDmg + ' 点可秒');
			const firstCandidate = killSeq.firstCandidate;
			return {
				best: {
					action: firstCandidate,
					baseScore: firstCandidate.score || 0,
					total: firstCandidate.score || 0,
					futureScore: 0,
					killRank: killSeq.killRank,
					certainty: killSeq.certainty,
					steps: killSeq.steps,
					isKill: true,
					target: killSeq.target,
				},
				alternatives: [],
				all: [killSeq],
				isKill: true,
				elapsed: _nowMs() - t0,
			};
		}

		const eligible = candidates
			.filter(function (a) { return isCandidateEligible(a); })
			.slice()
			.sort(compareActionCandidates);
		_annotateRangeEnablers(me, eligible);
		const ranked = buildPlannerCandidatePool(eligible, {
			topUtilityCount: 8,
			maxCandidates: 18,
			compareCandidates: compareActionCandidates,
			isEligible: isCandidateEligible,
			describeAction: _describePlannerAction,
		});
		if (!ranked.length) return null;

		/* #40：Dependency Graph 只在当前真实合法候选之间建边。
		 * 计划最多 3 步，但只返回/执行第一步；下一次 world-state 变化后重新规划。 */
		const graph = buildTacticalPlans(ranked, {
			maxDepth: 3,
			beamWidth: 5,
			discount: 0.72,
			intent: options && options.strategicState ? options.strategicState.intent : null,
			resourceBudget: _resourceBudget(me),
			describeAction: _describePlannerAction,
		});
		if (!graph || !graph.best) return null;

		const elapsed = _nowMs() - t0;
		if (_budgetExceeded(deadline)) {
			log.warn('planner', '规划预算耗尽 ' + Math.round(elapsed) + 'ms，放弃本轮 Planner 改判');
			return null;
		}

		return {
			best: graph.best,
			alternatives: graph.alternatives,
			all: graph.all,
			isKill: false,
			plannerVersion: 'v2',
			expanded: graph.expanded,
			maxDepth: graph.maxDepth,
			elapsed: elapsed,
		};
	} catch (e) {
		log.warn('planner', '规划异常：' + String(e).slice(0, 60));
		return null;
	}
}

export function planForDecision(me, options) {
	try {
		if (cfg('enablePlanner', true) === false) return null;
		const now = Date.now();
		const signature = _plannerStateSignature(me, options);
		/* 只节流完全相同的决策状态；动作执行后候选/手牌/Intent 变化可立即重新规划。 */
		if (signature && signature === _lastPlanSignature && now - _lastPlanT < PLAN_THROTTLE_MS) {
			return _lastPlan;
		}
		const plan = planSequence(me, options);
		if (plan) {
			_lastPlanT = now;
			_lastPlanSignature = signature;
			_lastPlan = plan;
		}
		return plan;
	} catch (e) {
		return null;
	}
}

export function refineBestWithPlan(me, best, bestT, precomputedPlan) {
	try {
		if (cfg('enablePlanner', true) === false) return best;
		/* Engine 可传入本次 bestAction 已计算过的 plan，避免为改判和日志各算一次。
		 * 未传时保留兼容行为，由 planForDecision 统一处理节流与预算。 */
		const plan = arguments.length >= 4 ? precomputedPlan : planForDecision(me);
		if (!plan || !plan.best) return best;

		const planBest = plan.best;

		const liveCandidates = (_status.djsc_lastCandidates || []);
		function canonicalOf(action) {
			if (!action) return null;
			return liveCandidates.find(function (c) {
				return c && isCandidateEligible(c) && sameCandidateAction(c, action);
			}) || null;
		}

		if (plan.isKill && planBest.action) {
			const canonicalKill = canonicalOf(planBest.action);
			if (!canonicalKill || !isCandidateEligible(canonicalKill)) return best;

			const tier = planBest.certainty === 'forced' ? PRIORITY_TIER.FORCED : PRIORITY_TIER.CRITICAL;
			const currentPolicy = ensureCandidatePolicy(canonicalKill);
			const priorityValue = tier === PRIORITY_TIER.FORCED
				? Number(planBest.killRank || 0)
				: Math.max(99, Number(currentPolicy && currentPolicy.priorityValue || 0));
			const reason = tier === PRIORITY_TIER.FORCED ? '已验证确定击杀序列' : '高置信击杀序列';

			/* 先在副本上比较，避免未胜出的规划污染 live candidate policy。 */
			const proposed = Object.assign({}, canonicalKill, {
				policy: Object.assign({}, canonicalKill.policy || {}),
			});
			setCandidatePriority(proposed, tier, priorityValue, reason);
			if (canonicalKill !== best && compareActionCandidates(proposed, best) >= 0) return best;

			setCandidatePriority(canonicalKill, tier, priorityValue, reason);
			canonicalKill.reason = (canonicalKill.reason || '') + '（★残局解：' + planBest.steps.map(function (step) { return step.id; }).join(' → ') +
				'，预计' + planBest.steps.reduce(function (sum, x) { return sum + (x.dmg || 0); }, 0) + '点伤害）';
			canonicalKill.killTarget = planBest.target;
			canonicalKill.isKill = true;
			canonicalKill.planned = true;
			return canonicalKill;
		}

		const planTop = planBest.action;
		const canonicalTop = planTop ? canonicalOf(planTop) : null;
		const samePolicyTier = canonicalTop
			? sameCandidatePolicyBand(canonicalTop, best)
			: false;
		const currentBestPlan = Array.isArray(plan.all)
			? plan.all.find(function (p) { return p && p.action && sameCandidateAction(p.action, best); })
			: null;
		const baselinePlanValue = currentBestPlan ? Number(currentBestPlan.total || 0) : Number(best && best.score || 0);
		const improvement = planTop && planTop.id
			? signedNormalizedImprovement(baselinePlanValue, planBest.total)
			: 0;

		function attachPlanTrace(candidate, chosenPlan, relativeImprovement) {
			if (!candidate || !chosenPlan) return candidate;
			candidate.planned = true;
			candidate.planUtility = Number(chosenPlan.total || 0);
			candidate.planFuture = Number(chosenPlan.futureScore || 0);
			candidate.planSteps = (chosenPlan.steps || []).map(function (step) {
				return { type: step.type || 'card', id: step.id || '?', target: candidateTargetValue(step) };
			});
			candidate.planDependencies = (chosenPlan.dependencies || []).map(function (d) {
				return { kind: d.kind, from: d.from, to: d.to, reason: d.reason };
			});
			const summary = tacticalPlanSummary(chosenPlan);
			candidate.reason = (candidate.reason || '') + '｜规划：' + summary +
				(relativeImprovement > 0 ? '｜相对提升 ' + relativeImprovement.toFixed(3) : '');
			return candidate;
		}

		/* 当前动作本来就是最佳首步时，只附加计划轨迹，不改 canonical score。 */
		if (planTop && best && sameCandidateAction(planTop, best)) {
			return attachPlanTrace(best, planBest, 0);
		}

		if (planTop && planTop.id && samePolicyTier && improvement > DECISION_MARGIN.PLANNER_REPLACE) {
			const canonical = canonicalTop || planTop;
			/* #40 硬约束：plan.total 是独立 planning value，绝不写回 candidate.score。 */
			attachPlanTrace(canonical, planBest, improvement);
			canonical.target = planTop.target || (planBest.target || null);
			return canonical;
		}

		return best;
	} catch (e) { return best; }
}
