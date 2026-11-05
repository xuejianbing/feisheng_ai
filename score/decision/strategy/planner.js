/*
 * ============================================
 * // 著者: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 战术规划器 =================
 * 目标：从单步贪心升级到多步规划。
 * 能力：
 *   1. 残局解：检测 1-2 步秒杀窗口
 *   2. 连招规划：铁索+属性杀 / 顺+火攻 / 乐+杀 等组合
 *   3. 两回合展望：评估这一步"打开了什么后续"
 *   4. 超时熔断：200ms 内没算完 → 降级到单步
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js';
import { cfg } from '../../foundation/config/util.js';
import { log } from '../../foundation/diag/logger.js';
import { isEnemyOf, probHasShan, seatPressure, threatOf } from '../threat/threat.js';
import { isAllyOf } from '../relations/relations.js';   /* ★ 指令 05 Stage B：敌我唯一权威源 */
import { baseEquipValue } from '../basic/equipBrain.js';
import { signedNormalizedImprovement, DECISION_MARGIN } from '../state/decisionMargin.js';
import { targetKey, setCandidatePriority, ensureCandidatePolicy, PRIORITY_TIER, isCandidateEligible, sameCandidateAction, sameCandidatePolicyBand, compareActionCandidates } from '../state/actionCandidate.js';

const PLAN_TIMEOUT = 350;
const LOOKAHEAD_DISCOUNT = 0.7;

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
/* ★【对局中卡死防护】全局节流：同一决策热循环内，短时间多次调用 planSequence 只执行一次完整规划。
 *   refineBestWithPlan 每次决策都会调用本函数；若每次都从零做多步杀搜索+候选展望，对局中每轮多次决策会累积成持续卡顿。
 *   这里按 1 秒抽样执行，既保留"残局秒杀/多步展望"的规划价值，又大幅削减对局内计算压力。 */
let _lastPlanT = 0;
const PLAN_THROTTLE_MS = 1000;

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

function _hasNatureSha(me) {
	try {
		return me.getCards('h').some(function (c) {
			if (get.name(c, me) !== 'sha') return false;
			return game.hasNature && (game.hasNature(c, 'fire') || game.hasNature(c, 'thunder'));
		});
	} catch (e) { return false; }
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
			const pS = probHasShan(me, target);
			const shaExpect = 2 * (1 - pS);
			steps.push({ id: 'sha', expect: shaExpect, dmg: 2, type: 'damage', target: targetKey(target) });
			totalDmg += shaExpect;
			if (pS <= 0) guaranteedDmg += 2;
		} else if (hand.has('sha') && shaReachable && take('sha')) {
			prepareShaRange();
			const pS = probHasShan(me, target);
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

/* ★ 多步展望（3 步 + 分支预测） */
function _outlookScore(me, action, target, deadline) {
	try {
		if (_budgetExceeded(deadline)) return null;
		if (!action || !action.id) return 0;
		const id = action.id;
		const hand = _handNames(me);
		if (_budgetExceeded(deadline)) return null;
		let score = 0;

		/* ===== 第 1 步：当前牌的即时收益 ===== */
		if (id === 'lebu') {
			const seat = seatPressure(me);
			if (seat.nextEnemy === target) score += 3;
			else score += 1.5;
			if (hand.has('sha')) score += 1;
		}
		if (id === 'bingliang') {
			score += 1.5;
			if (hand.has('sha')) score += 0.5;
		}
		if (id === 'shunshou') {
			try {
				const es = target && target.getGainableCards ? target.getGainableCards(me, 'e').length : 0;
				const hs = target && target.getGainableCards ? target.getGainableCards(me, 'h').length : 0;
				if (es >= 2) score += 2.5;
				else if (hs >= 3) score += 2;
				else score += 1;
			} catch (e) { score += 1; }
		}
		if (id === 'guohe') {
			score += 1.5;
			if (hand.has('sha')) score += 0.8;
		}
		if (id === 'sha') {
			const hp = target && target.hp || 0;
			if (hp <= 1) score += 5;
			else if (hp <= 2) score += 2;
			else if (target && target.hp < target.maxHp) score += 1.5;
			else score += 0.8;
			if (_countCard(me, 'sha') >= 2) score += 1;
		}
		if (id === 'juedou') {
			const hp = target && target.hp || 0;
			if (hp <= 1) score += 4;
			else if (hp <= 2) score += 1.5;
			else score += 0.5;
			const mySha = _countCard(me, 'sha');
			if (mySha >= 2) score += 2;
			else if (mySha >= 1) score += 1;
			else score -= 1;
		}
		if (id === 'huogong') {
			const hp = target && target.hp || 0;
			if (hp <= 2) score += 2;
			else score += 0.8;
		}
		if (id === 'nanman' || id === 'wanjian') {
			let hitCount = 0;
			(game.players || []).forEach(function (p) {
				if (p === me || !p.isIn()) return;
				if (!isEnemyOf(me, p)) return;
				const hasRespond = id === 'nanman'
					? (p.countCards ? p.countCards('hs', 'sha') > 0 : false)
					: (p.countCards ? p.countCards('hs', 'shan') > 0 : false);
				if (!hasRespond) hitCount++;
			});
			score += hitCount * 1.5;
		}
		if (id === 'tiesuo') {
			if (_hasNatureSha(me)) score += 3;
			if (hand.has('huogong')) score += 2;
			score += 1;
		}
		if (id === 'wuzhong') score += 1.5;
		if (id === 'taoyuan') {
			let allyDamaged = 0;
			(game.players || []).forEach(function (p) {
				if (p !== me && isAllyOf(me, p) && p.isDamaged && p.isDamaged()) allyDamaged++;
			});
			score += allyDamaged * 1.5;
		}
		if (id === 'tao') {
			let dyingAlly = 0;
			(game.players || []).forEach(function (p) {
				if (p !== me && isAllyOf(me, p) && (p.hp || 0) <= 0) dyingAlly++;
			});
			if (dyingAlly > 0) score += 5.0;
			else if ((me.hp || 0) <= 1) score += 2.0;
			else score += 0.5;
		}
		if (id === 'wuxie') score += 1.0;
		if (id === 'jiu') {
			if (hand.has('sha')) score += 2.5;
			else score += 0.5;
		}
		if (id === 'shandian') {
			const alive = (game.players || []).filter(function (p) { return p.alive !== false; }).length;
			if (alive <= 4) score += 2.0;
			else score += 0.5;
		}

		if (_budgetExceeded(deadline)) return null;

		/* ===== 第 2 步：本次牌的「后续连招」展望 ===== */
		try {
			/* 拆牌类 → 下一步杀 加成 */
			if ((id === 'guohe' || id === 'shunshou') && hand.has('sha')) {
				score += 1.5;  /* 拆完能杀 */
			}
			/* 铁索 → 属性杀 / 火攻 加成 */
			if (id === 'tiesuo' && (_hasNatureSha(me) || hand.has('huogong'))) {
				score += 2.0;
			}
			/* 乐 → 后手杀 加成 */
			if (id === 'lebu' && hand.has('sha')) {
				score += 1.0;
			}
			/* 无中 → 后续收益未知，但可衔接任意连招 */
			if (id === 'wuzhong') {
				const followUpCount = ['sha', 'juedou', 'huogong', 'tao', 'wuxie'].filter(function (c) {
					return hand.has(c);
				}).length;
				score += followUpCount * 0.4;
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		if (_budgetExceeded(deadline)) return null;

		/* ===== 第 3 步：敌方反应分支预测（粗略） ===== */
		try {
			/* 攻击目标 → 预估敌方「还有几张闪/桃」 */
			if (target && (id === 'sha' || id === 'juedou' || id === 'huogong')) {
				const tgtHand = target.countCards ? target.countCards('h') : 0;
				const tgtHp = target.hp || 0;
				/* 手牌少 + 血少 → 敌方「翻盘概率低」→ 攻击收益高 */
				if (tgtHand <= 2 && tgtHp <= 2) score += 1.5;
				/* 手牌多 → 敌方可能反击 → 收益打折 */
				if (tgtHand >= 5) score -= 0.5;
				/* 敌方有反馈/奸雄类卖血技 → 攻击价值下降 */
				try {
					if (target.hasSkill && (
						target.hasSkill('fankui') ||
						target.hasSkill('jianxiong') ||
						target.hasSkill('yiji') ||
						target.hasSkill('ganglie')
					)) {
						score -= 1.0;
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			}

			/* AOE → 统计敌方未被消耗的闪/杀数量 */
			if (id === 'nanman' || id === 'wanjian') {
				let enemyReady = 0;
				(game.players || []).forEach(function (p) {
					if (p === me || !p.isIn()) return;
					if (!isEnemyOf(me, p)) return;
					const need = id === 'nanman' ? 'sha' : 'shan';
					if (p.countCards && p.countCards('hs', need) > 0) enemyReady++;
				});
				if (enemyReady === 0) score += 3.0;   /* 敌方毫无防备 → AOE 收益爆炸 */
				else if (enemyReady === 1) score += 1.5;
			}

			/* 桃 → 队友若自己有桃，则救援价值降 */
			if (id === 'tao') {
				let allyTao = 0;
				(game.players || []).forEach(function (p) {
					if (p === me || !p.isIn()) return;
					if (!isAllyOf(me, p)) return;
					if ((p.hp || 0) <= 0 && p.countCards) {
						allyTao += p.countCards('hs', 'tao');
					}
				});
				if (allyTao >= 1) score -= 1.5;
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		if (_budgetExceeded(deadline)) return null;
		return Math.round(score * 100) / 100;
	} catch (e) { return 0; }
}

export function planSequence(me, options) {
	try {
		if (!me) return null;
		const t0 = _nowMs();
		const deadline = _plannerDeadline(options);
		if (_budgetExceeded(deadline)) return null;

		const candidates = _status.djsc_lastCandidates || [];
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
			const firstCandidate = candidates.find(function (c) {
				return c && isCandidateEligible(c) && sameCandidateAction(c, plannedFirst);
			}) || null;
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

		const ranked = candidates
			.filter(function (a) { return isCandidateEligible(a) && a.type !== 'end'; })
			.slice(0, 5);

		if (ranked.length < 2) return null;

		const sequences = [];
		for (const candidate of ranked) {
			if (_budgetExceeded(deadline)) {
				log.warn('planner', '规划预算耗尽，放弃本轮 Planner 改判');
				return null;
			}
			const outlook = _outlookScore(me, candidate, bestT, deadline);
			if (outlook === null || _budgetExceeded(deadline)) {
				log.warn('planner', '规划预算耗尽，放弃本轮 Planner 改判');
				return null;
			}
			const total = (candidate.score || 0) + outlook * LOOKAHEAD_DISCOUNT;
			sequences.push({
				action: candidate,
				baseScore: candidate.score || 0,
				futureScore: outlook,
				total: Math.round(total * 100) / 100,
				steps: [candidate],
				isKill: false,
			});
		}

		sequences.sort(function (a, b) { return b.total - a.total; });

		const elapsed = _nowMs() - t0;
		if (_budgetExceeded(deadline)) {
			log.warn('planner', '规划预算耗尽 ' + Math.round(elapsed) + 'ms，放弃本轮 Planner 改判');
			return null;
		}

		return {
			best: sequences[0],
			alternatives: sequences.slice(1, 3),
			all: sequences,
			isKill: false,
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
		if (now - _lastPlanT < PLAN_THROTTLE_MS) return null;
		const plan = planSequence(me, options);
		if (plan) _lastPlanT = now;
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
		const improvement = planTop && planTop.id
			? signedNormalizedImprovement(best.score || 0, planBest.total)
			: 0;
		if (planTop && planTop.id && samePolicyTier && improvement > DECISION_MARGIN.PLANNER_REPLACE) {
			const canonical = canonicalTop || planTop;
			canonical.score = planBest.total;
			canonical.reason = '规划：' + planTop.id + '（基础 ' + planBest.baseScore +
				' + 展望 ' + planBest.futureScore + '，相对提升 ' + improvement.toFixed(3) + '）';
			canonical.planned = true;
			canonical.target = planTop.target || (planBest.target || null);
			return canonical;
		}

		return best;
	} catch (e) { return best; }
}
