/* 职责：已发生的宿主动作/效果记分、回合动量及友方延迟观察。
 * 仅消费真实事件；候选估值不写入本模块。 */
import { get, _status } from '../../foundation/adapt/host.js';
import { VAL_CARD } from '../../knowledge/tables/value-tables.js';
import { probHasShan } from '../threat/threat.js';
import { isPlayerLinked } from '../state/playerState.js';
import { memRecordAtk, memRecordHit } from '../../perception/memory/mem.js';
import { observeAttack, observeAid, observeCardUse } from '../../perception/observer/observer.js';
import { deckConsume } from '../../perception/memory/deckMemory.js';
import { cfg, keyOf } from '../../foundation/config/util.js';
import { archiveGame } from '../../perception/archive/archive.js';
import { getModeStrategy, isSameCamp } from '../strategy/modeStrategy.js';
import { observeElementUse } from '../../perception/feedback/elementFeedback.js';
import { metaRecordCard, metaRecordTarget } from '../../cognition/metaCognition.js';
import { round, rec, give, givePair, giveVs, cash, toMoney } from './scoreLedger.js';
/* ★ 友方动作评估挂起表 */
const _allyActionPending = [];

function _snapshotAlly(p) {
	try {
		return {
			hp: p.hp || 0,
			hc: (p.countCards ? p.countCards('h') : 0),
			eq: (p.countCards ? p.countCards('e') : 0),
		};
	} catch (e) { return null; }
}

function _evaluateAllyAction(rec) {
	try {
		const me = rec.me;
		const target = rec.target;
		if (!me || !target) return;

		/* 如果根本没有对友方造成任何损失 → 是支援，补正分 */
		if (!rec.hurt) {
			give(me, rec.value * 0.8, "支援友方（" + rec.id + "）");
			return;
		}

		const snap = rec.snap;
		if (!snap) return;
		const hpNow = target.hp || 0;
		const hcNow = (target.countCards ? target.countCards('h') : 0);
		const roundNow = round[keyOf(target)] || 0;

		/* 正收益判定：友方回血 / 摸牌 / 得分上升 */
		const hpGain = hpNow - snap.hp;
		const hcGain = hcNow - snap.hc;
		const roundGain = roundNow - (snap.round || 0);
		const hasPositive = (hpGain > 0) || (hcGain > 0) || (roundGain > rec.value * 0.5);

		if (hasPositive) return; // 有正收益，不惩罚

		/* 无正收益 → 按损失程度扣 50% / 70% */
		const hpLoss = -hpGain;
		const hcLoss = -hcGain;
		let rate = 0.5;                                  // 默认 50%
		if (hpLoss >= 2 || hcLoss >= 2 || hpNow <= 0) {
			rate = 0.7;                                  // 重伤 / 濒死 → 70%
		}

		const penalty = Math.abs(rec.value) * rate * 3;
		give(me, -penalty, "对友方无正收益造成损失（扣除 " + (rate * 100) + "%）");
		/* 阵营分惩罚：让敌人得分，相当于阵营失衡 */
		giveVs(me, -Math.abs(rec.value) * rate, "阵营分扣除 " + (rate * 100) + "%");
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ 标记：某玩家正在被"友方评估"的动作伤害 */
function _markAllyHurt(target) {
	try {
		for (let i = 0; i < _allyActionPending.length; i++) {
			const rec = _allyActionPending[i];
			if (rec.target === target) rec.hurt = true;
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

let _turnUse = 0, _lastTurnPlayer = null;

let _momPlayer = null, _momVal = 0, _momStreak = 0;
const MOM_CAP = 5;        /* ← 线性步数上下限 */
const MOM_STEP = 0.06;    /* ← 每步线性增量（5 步→+30%） */
function _updateMomentum(me, netGain) {
	try {
		const cur = _status && _status.currentPhase;
		if (!cur) { _momPlayer = null; _momVal = 0; _momStreak = 0; return; }
		if (_momPlayer !== cur) { _momPlayer = cur; _momVal = 0; _momStreak = 0; }
		if (cur !== me) return;
		/* ★ 货币化后取符号：单次高收益不因数量级翻转方向 / 过冲步数 */
		const money = toMoney(netGain);
		const dir = money > 0 ? 1 : (money < 0 ? -1 : 0);
		if (dir === 0) return;
		if ((_momStreak > 0 && dir > 0) || (_momStreak < 0 && dir < 0)) _momStreak += dir;
		else _momStreak = dir;
		if (_momStreak > MOM_CAP) _momStreak = MOM_CAP;
		else if (_momStreak < -MOM_CAP) _momStreak = -MOM_CAP;
		_momVal = 1 + _momStreak * MOM_STEP;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
/* 读取当前行动者的回合动量倍率（非本回合/无动量恒 1.0） */
function turnMomentum(me) {
	try {
		const cur = _status && _status.currentPhase;
		if (cur !== me || !_momVal) return 1.0;
		return Math.min(1.3, Math.max(0.7, _momVal));
	} catch (e) { return 1.0; }
}
function scoreCardUse(me, card, target) {
	try {
		/* 统一 id 提取：字符串直接用；VCard 依次看 name / cardname */
		const id = (typeof card === "string")
			? card
			: (card && (card.name || card.cardname || "")) || "";
		if (!id) return;

		rec("cards", id);

		/* ★ 牌堆记忆：使用牌时扣减 */
		try { deckConsume(card); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ★ 元素反馈：观察出牌 */
		try {
			let hpB = me.hp || 0;
			observeElementUse('card', id, me, {
				target: target && (target.name1 || target.name) ? target : null,
				hpBefore: hpB,
			});
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		/* ★ 元认知：记录卡牌使用 */
		try { metaRecordCard(id); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		if (target && target.name) {
			try { metaRecordTarget(target.name1 || target.name); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}

		/* 回合内出牌叠加激励 */
		try {
			const cur = _status && _status.currentPhase;
			if (_lastTurnPlayer !== cur) { _lastTurnPlayer = cur; _turnUse = 0; }
			if (me === cur) {
				_turnUse++;
				if (_turnUse >= 3) {
					const bonus = (_turnUse - 2) * 0.5;
					giveVs(me, bonus, "回合内第" + _turnUse + "张牌（用牌叠加激励）");
				}
			}
		} catch (eT) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eT); }

		const v = VAL_CARD[id];
		if (!v || !v.use) return;

		/* 记录"对目标出杀"的次数（供 threat.js 的 probHasShan 读取） */
		if (id === "sha" && target && get.itemtype(target) === "player") {
			try { memRecordAtk(target); } catch (eM) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eM); }
		}
		/* 行为观察：记录攻/援行为 */
		try { observeCardUse(me, card, target); } catch (eO) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eO); }

		/* ★ 友方延迟评估：不立即给正分，等 600ms 后评估是否有正收益 */
		if (target && get.itemtype(target) === "player") {
			/* ★ 判断友方（好感度 + 阵营策略双保险） */
			let isAlly = false;
			try {
				if (isSameCamp(me, target)) isAlly = true;
				const strategy = typeof getModeStrategy === 'function' ? getModeStrategy() : null;
				if (strategy && strategy.getCamp) {
					if (strategy.getCamp(me) === strategy.getCamp(target)) isAlly = true;
				}
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

			if (isAlly) {
				/* ★ 锦囊类特殊处理：只记录特征，不重罚（走本体合法检测） */
				const PENALTY_CARDS = ['lebu', 'bingliang', 'tiesuo', 'shunshou'];
				if (PENALTY_CARDS.indexOf(id) >= 0) {
					/* 判断是横置还是解除横置 */
					if (id === 'tiesuo') {
						/* 铁索连环：横置友方只记录，解除横置加分 */
						const isLinking = !isPlayerLinked(target);
						if (isLinking) {
							/* 横置友方 → 只记录特征，不重罚 */
							logBestAction(me, null, { reason: '对友方铁索横置（特征记录）' });
							return;
						} else {
							/* 解除友方横置 → 加分（牌价值经动态汇率换算成货币） */
							cash(me, 'card', Math.abs(v.use) * 1.5, "解除友方横置（支援）");
							return;
						}
					} else if (id === 'shunshou') {
						/* 顺手牵羊：拿判定区加分，拿非判定区只记录 */
						let isJudgeArea = false;
						try {
							if (target.judges && target.judges.length > 0) {
								isJudgeArea = true;
							}
						} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

						if (isJudgeArea) {
							/* 拿判定区 → 加分（解乐/解兵） */
							cash(me, 'card', Math.abs(v.use) * 1.5, "顺友方判定区（解乐/解兵，支援）");
							return;
						} else {
							/* 拿非判定区 → 只记录特征，不重罚 */
							logBestAction(me, null, { reason: '顺友方非判定区（特征记录）' });
							return;
						}
					} else {
						/* 乐不思蜀 / 兵粮寸断 → 只记录特征，不重罚 */
						logBestAction(me, null, { reason: '对友方使用' + (id === 'lebu' ? '乐不思蜀' : '兵粮寸断') + '（特征记录）' });
						return;
					}
				}

				/* ★ 对友方出牌：挂起，延迟评估，不立即给正分 */
				const rec = {
					me: me, target: target,
					value: v.use || 1,
					id: id,
					t0: Date.now(),
					snap: _snapshotAlly(target),
					hurt: false,
				};
				/* 记录挂起前的友方得分，供评估对比 */
				try { rec.snap.round = round[keyOf(target)] || 0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				_allyActionPending.push(rec);

				setTimeout(function () {
					_evaluateAllyAction(rec);
					const idx = _allyActionPending.indexOf(rec);
					if (idx >= 0) _allyActionPending.splice(idx, 1);
				}, 600);

				/* 只给一点基础分（表示行动本身），大头等评估 */
				cash(me, 'card', (v.use || 1) * 0.2, "对友方使用（待评估）");
			} else {
				givePair(me, target, v.use, "使用" + v.name + "（" + id + "）");
			}
		} else if (Array.isArray(target)) {
			/* ★ AOE：按友方/敌方分别结算 */
			let allyHurt = 0, enemyHit = 0;
			target.forEach(function (t) {
				if (!get.itemtype(t) === "player") return;
				let isAlly = false;
				try {
					if (isSameCamp(me, t)) isAlly = true;
					const strategy = typeof getModeStrategy === 'function' ? getModeStrategy() : null;
					if (strategy && strategy.getCamp) {
						if (strategy.getCamp(me) === strategy.getCamp(t)) isAlly = true;
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				if (isAlly) allyHurt++;
				else enemyHit++;
			});

			if (allyHurt > 0) {
				/* AOE 误伤友方，按 70% 重罚（牌价值经动态汇率换算成货币） */
				const rate = 0.7;
				cash(me, 'card', -allyHurt * Math.abs(v.use) * rate * 3, "AOE误伤友方（扣除 " + (rate * 100) + "%）");
				giveVs(me, -allyHurt * Math.abs(v.use) * rate, "阵营分扣除 " + (rate * 100) + "%");
			}
			if (enemyHit > 0) {
				giveVs(me, enemyHit * v.use, "AOE命中敌人");
			}
		} else {
			giveVs(me, v.use, "使用" + v.name + "（" + id + "）");
		}
		/* ★ 单回合动量：以本牌净收益方向（v.use 符号）更新。
		 *   顺风（正收益连击）放大后续动作、逆风及时止损；方向经 toMoney 货币化判定。 */
		_updateMomentum(me, v.use);
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= 效果处理器表 =================
 * 键与 installHooks 里 EF 数组一一对应。
 * 每个处理器签名：(me, a) —— me 是玩家对象，a 是 arguments 类数组。
 * 键为 "die" 的情况不在此表——阵亡计分独立在 installHooks 里处理。
 */
const EFFECT_HANDLERS = {
	damage: function (me, a) {
		try { _markAllyHurt(me); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }   /* ★ 友方评估标记 */
		const p0 = a[0];
		let src = null, n = 1;
		if (p0 && typeof p0 === "object" && !Array.isArray(p0)) {
			if (get.itemtype(p0) === "player") src = p0;
			if (typeof p0.num === "number") n = p0.num;
			if (p0.source && get.itemtype(p0.source) === "player" && p0.source !== me) src = p0.source;
		} else {
			/* noname 签名 damage(num, source, ...)：number 与 player 参数乱序，遍历全部参数 */
			for (let i = 0; i < a.length; i++) {
				const v = a[i];
				if (typeof v === "number") n = v;
				else if (v && typeof v === "object" && !Array.isArray(v) && v !== me) {
					/* 玩家判定优先 get.itemtype，其次 hp 兜底（兼容未初始化/隐匿状态的玩家） */
					let isP = false;
					try { isP = (typeof get === "object" && get.itemtype && get.itemtype(v) === "player"); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					if (isP || v.hp !== undefined) src = v;
				}
			}
		}
		if (src && src !== me) {
			/* ★ 污染修复：判断 src 和 me 是否是友方 */
			let isAlly = false;
			try {
				if (isSameCamp(src, me)) isAlly = true;
				const strategy = getModeStrategy();
				if (strategy && strategy.isSameCamp && strategy.isSameCamp(src, me)) isAlly = true;
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

			if (isAlly) {
				/* 打队友：src 不加分，me 也不扣分（避免污染） */
				/* 但是记录伤害次数 */
				try { memRecordHit(me); } catch (eH) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eH); }
				try { observeAttack(src, me, n); } catch (eO) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eO); }
			} else {
				/* 打敌人：正常计分 */
				givePair(src, me, 2 * n * cfg("dmgRate", 1), "造成" + n + "点伤害");
				try { memRecordHit(me); } catch (eH) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eH); }
				try { observeAttack(src, me, n); } catch (eO) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eO); }
			}
			/* ★ 追踪：src 对 me 的伤害次数（友方伤害线性衰减用） */
			try {
				if (src) {
					if (!src._djsc_hurtAlly) src._djsc_hurtAlly = {};
					const key = me.name1 || me.name || '?';
					src._djsc_hurtAlly[key] = (src._djsc_hurtAlly[key] || 0) + 1;
				}
			} catch (eT) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eT); }
		} else {
			giveVs(me, -2 * n * cfg("dmgRate", 1), "受到" + n + "点伤害");
		}
	},
	changeHp: function (me, a) {
		const v = parseFloat(a[0]) || 0;
		if (v > 0) giveVs(me, 2 * v, "回复" + v + "点");
		else if (v < 0) giveVs(me, 2 * v, "失去" + (-v) + "点体力");
	},
	recover: function (me, a) {
		const n = Math.abs(parseFloat(a[0]) || 1);
		giveVs(me, 2 * n, "回复" + n + "点");
		/* 行为观察：若参数里能找出施救者，记为援助行为
		 * noname 签名 recover(num, source, ...)：遍历参数找 player 来源 */
		try {
			let src = null;
			for (let i = 0; i < a.length; i++) {
				const v = a[i];
				if (v && typeof v === "object" && !Array.isArray(v) && v !== me) {
					let isP = false;
					try { isP = (typeof get === "object" && get.itemtype && get.itemtype(v) === "player"); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					if (isP || v.hp !== undefined) { src = v; break; }
				}
			}
			if (!src && a[0] && typeof a[0] === "object" && !Array.isArray(a[0])) {
				const p0 = a[0];
				if (p0.source && get.itemtype(p0.source) === "player" && p0.source !== me) src = p0.source;
				else if (p0.sourcex && get.itemtype(p0.sourcex) === "player" && p0.sourcex !== me) src = p0.sourcex;
			}
			if (src) observeAid(src, me, n * 0.8);
		} catch (eO) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eO); }
	},
	draw: function (me, a) {
		const n = Math.abs(parseFloat(a[0]) || 1);
		giveVs(me, n * cfg("drawRate", 1), "摸" + n + "张");
		/* ★ 牌堆感知：摸牌消耗 */
		try {
			const ev = _status.event;
			if (ev && ev.cards && Array.isArray(ev.cards)) {
				ev.cards.forEach(function(c) { try { deckConsume(c); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	},
	discard: function (me, a) {
		try { _markAllyHurt(me); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }   /* ★ 友方评估标记 */
		let n = 1;
		let cards = null;
		try {
			const c0 = a[0];
			if (Array.isArray(c0)) { n = c0.length; cards = c0; }
			else if (typeof c0 === "number") n = c0;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		giveVs(me, -1 * n * cfg("discardRate", 1), "弃" + n + "张");
		if (n > 3) giveVs(me, -(n - 3) * 0.3 * cfg("discardRate", 1), "弃" + n + "张过多额外惩罚");
		/* ★ 牌堆感知：弃牌消耗 */
		try {
			if (cards) cards.forEach(function(c) { try { deckConsume(c); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
			else {
				const ev = _status.event;
				if (ev && ev.cards) ev.cards.forEach(function(c) { try { deckConsume(c); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	},
	loseHp: function (me, a) {
		try { _markAllyHurt(me); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }   /* ★ 友方评估标记 */
		const n = Math.abs(parseFloat(a[0]) || 1);
		giveVs(me, -2 * n, "失去" + n + "点体力");
	},
	gainMaxHp: function (me) { giveVs(me, 2, "体力上限+1"); },
	loseMaxHp: function (me) { giveVs(me, -2, "体力上限-1"); },
	turnOver: function (me) { giveVs(me, -3, "翻面"); },
	link: function (me) { giveVs(me, -1, "横置"); },
	gain: function (me, a) {
		const n = (Array.isArray(a[0]) ? a[0].length : Math.abs(parseFloat(a[0]) || 1));
		giveVs(me, n, "获得" + n + "张");
		/* ★ 牌堆感知：获得牌消耗 */
		try {
			if (Array.isArray(a[0])) {
				a[0].forEach(function(c) { try { deckConsume(c); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	},
	lose: function (me, a) {
		try { _markAllyHurt(me); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }   /* ★ 友方评估标记 */
		const n = (Array.isArray(a[0]) ? a[0].length : Math.abs(parseFloat(a[0]) || 1));
		giveVs(me, -n, "失去" + n + "张");
		/* ★ 牌堆感知：失去牌消耗 */
		try {
			if (Array.isArray(a[0])) {
				a[0].forEach(function(c) { try { deckConsume(c); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	},
	judge: function (me) {
		giveVs(me, 1, "判定");
		/* ★ 牌堆感知：判定牌消耗 */
		try {
			const ev = _status.event;
			let jc = null;
			if (ev) {
				if (ev.card) jc = ev.card;
				else if (ev.result && ev.result.card) jc = ev.result.card;
			}
			if (jc) deckConsume(jc);
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	},
	equip: function (me) { giveVs(me, 1, "装备"); },
};

function scoreEffect(mm, me, a) {
	try {
		rec("effects", mm);
		const h = EFFECT_HANDLERS[mm];
		if (h) h(me, a || []);
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ 玩家日志收集器（模块级作用域）
 *   必须在 installHooks 与 settle 之间共享，故放在此处。
 *   若象旧实现那样声明在 installHooks 内，settle() 归档时会取不到 _playerLogs，
 *   抛 ReferenceError 并被 catch 吞掉，导致整段 archiveGame 归档失败（整局战报丢失）。 */

export { _snapshotAlly, _evaluateAllyAction, _markAllyHurt, _updateMomentum, turnMomentum, scoreCardUse, scoreEffect, EFFECT_HANDLERS };
export function resetScoreEventCounters() { _turnUse = 0; _lastTurnPlayer = null; }
