/*
 * ============================================
 * // Éditeur: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 残局策略（细化版） =================
 * 针对 1v1 / 1v2 / 2v1 / 2v2 各类残局，结合：
 *   - 双方 / 多方血线（斩杀线、续命线）
 *   - 手牌结构与关键牌（杀、闪、桃、无懈、距离）
 *   - 攻击距离可达性
 *   - 队友濒死优先级
 *   - 身份局暗置身份的阵营推断
 *   - 牌堆剩余（接近牌堆见底时的爆发/断粮） 等维度，
 * 输出更细化的残局策略与评分加成，避免"血多就进攻、血少就防守"的呆板表现。
 */

import { lib, game, get, ai } from '../../foundation/adapt/host.js';
import { isAllyOf, isEnemyOf } from '../relations/relations.js';   /* ★ 指令 05 Stage B：敌我唯一权威源 */
import { isEndgamePhase } from '../state/gamePhase.js';

/* 若无 lib/game/get 则空跑（兼容性保护） */
try { void get; void ai; void lib; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

/* ★ 判断是否残局（存活 <= 4，覆盖 1v1/1v2/2v1/2v2） */
export function isEndgame(me) {
	try {
		return isEndgamePhase();
	} catch (e) {
		return false;
	}
}

function aliveCount() {
	try {
		return (game.players || []).filter(function (p) {
			return p && p.alive !== false;
		}).length;
	} catch (e) {
		return 0;
	}
}

/* 剩余牌堆规模：值越小越接近残局牌堆 */
function deckLeft() {
	try {
		const draw = game.cards || lib.card;
		if (lib && lib.init && lib.init.cards) return lib.init.cards.count();
		return 0;
	} catch (e) {
		return 0;
	}
}

/* players 至少2人 */
function friendCount(me) {
	try {
		let n = 0;
		(game.players || []).forEach(function (p) {
			if (!p || p === me || p.alive === false) return;
			try { if (isAllyOf(me, p)) n++; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});
		return n;
	} catch (e) { return 0; }
}

function enemyCount(me) {
	try {
		let n = 0;
		(game.players || []).forEach(function (p) {
			if (!p || p === me || p.alive === false) return;
			try { if (isEnemyOf(me, p)) n++; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});
		return n;
	} catch (e) { return 0; }
}

/* 我方最优敌人（态度最敌对，优先残血） */
function bestEnemy(me) {
	try {
		let best = null, bestScore = -1e9;
		(game.players || []).forEach(function (p) {
			if (!p || p === me || p.alive === false) return;
			try {
				if (!isEnemyOf(me, p)) return;
				let score = 1;
				score += Math.max(0, (p.maxHp || 3) - (p.hp || 0)) * 1.5; /* 残血优先 */
				score += (p.countCards ? p.countCards('he') : 0) * 0.1;    /* 手牌薄优先 */
				if (score > bestScore) { bestScore = score; best = p; }
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});
		return best;
	} catch (e) { return null; }
}

/* 周期性最优队友（含濒死加分） */
function bestFriend(me) {
	try {
		let best = null, bestScore = -1e9;
		(game.players || []).forEach(function (p) {
			if (!p || p === me || p.alive === false) return;
			try {
				if (!isAllyOf(me, p)) return;
				let score = 1;
				if ((p.hp || 0) <= 1) score += 1000;   /* 濒死队友极大优先级 */
				score += (p.maxHp || 3) - (p.hp || 0);
				if (score > bestScore) { bestScore = score; best = p; }
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});
		return best;
	} catch (e) { return null; }
}

/* 我方能否攻击到某目标（距离 + 武器/马匹） */
function canAtk(me, target) {
	try {
		if (!target) return false;
		let range = 1;
		const wp = me.getEquips ? me.getEquips('equip1') : [];
		for (const w of wp) {
			try {
				const r = get.info(w) && get.info(w).range;
				if (r && r.global) range = Math.max(range, r.global);
				if (r && typeof r === 'number') range = Math.max(range, r);
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}
		let dist = 1;
		try { dist = me.getAttackRange ? me.getAttackRange(target) : (get.distance ? get.distance(me, target) : 1); } catch (e) { try { dist = get.distance(me, target); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); } }
		return dist <= range;
	} catch (e) { return false; }
}

/* 我方是否濒死 */
function myDying(me) { try { return (me.hp || 1) <= 1 && (me.hp || 1) <= ((me.maxHp || 3) / 3); } catch (e) { return false; } }

/* 手牌里是否有杀/决斗类输出，及闪桃数量 */
function handHas(me, names) {
	try {
		const hs = me.countCards ? me.countCards('h') : 0;
		/* JS：遍历手牌判断名称 */
		let cards = [];
		try {
			cards = me.getCards ? me.getCards('h') : (me.getHandcards ? me.getHandcards() : []);
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		for (const c of cards) {
			try { const nm = get.name(c); if (names.indexOf(nm) >= 0) return true; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}
		return false;
	} catch (e) { return false; }
}

function handDefense(me) {
	/* 返回防守牌计数（闪/桃/无懈/装备防御） */
	try {
		let n = 0;
		let cards = [];
		try { cards = me.getCards ? me.getCards('h') : []; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		for (const c of cards) {
			try { const nm = get.name(c); if (nm === 'shan' || nm === 'tao' || nm === 'wuxie' || nm === 'jink') n++; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}
		return n;
	} catch (e) { return 0; }
}

/* ============================================================
 * ★ 残局评分题：评自己是残局时的目标水位（血线）——
 *   0~1 之间，越接近 0 越渴求攻击，越接近 1 越保守
 * ============================================================ */
export function endgameAggression(me) {
	try {
		if (!isEndgame(me)) return 0.5;
		const living = aliveCount();
		const friends = friendCount(me);
		const enemies = enemyCount(me);
		let pAgg = 0.5;

		if (living <= 2) {
			/* ---- 1v1 ---- */
			const foe = bestEnemy(me);
			if (!foe) return 0.5;
			/* 我能杀到他吗 */
			const reach = canAtk(me, foe);
			const myHp = me.hp || 0, foHp = foe.hp || 0;
			const myShan = handDefense(me), foeHand = foe.countCards ? foe.countCards('h') : 0;
			const foeDying = foHp <= 1;
			const foeMightShan = foeHand >= 1; /* 有闪可能 */
			const foeMightTao = foeHand >= 1;

			if (foeDying && reach) pAgg = 1.0;            /* 斩杀掉线，全力进攻 */
			else if (foeDying && !reach) pAgg = 0.95;      /* 敌人残血但够不着→尽量摸牌/拆距离 */
			else if (myDying(me)) pAgg = 0.1;              /* 自己濒死→先保命 */
			else if (foeHand <= 0 && reach) pAgg = 0.9;    /* 敌人空手且够得着→压制 */
			else if (myHp >= foHp + 1) pAgg = 0.75;        /* 自己血多→中高进攻 */
			else if (myHp <= foHp - 1) pAgg = 0.25;        /* 自己血少→低进攻 */
			else {
				/* 均势：看手牌结构 */
				if (myShan >= 2 || (myShan >= 1 && foeHand === 0)) pAgg = 0.55;
				else pAgg = 0.4;
			}
		} else if (living === 3) {
			/* ---- 1v2 / 2v1 ---- */
			if (enemies >= 2) pAgg = 0.2;                  /* 一打多：首要存活，保存实力 */
			else if (friends >= 1 && enemies === 1) {
				/* 2v1：尽快集火解决唯一敌人 */
				const foe = bestEnemy(me);
				if (foe && (foe.hp || 0) <= 1) pAgg = 1.0;
				else pAgg = 0.7;
			}
			else pAgg = 0.5;
		} else {
			/* ---- 2v2 ---- */
			const foe = bestEnemy(me);
			if (myDying(me)) pAgg = 0.1;
			else if (foe && (foe.hp || 0) <= 1 && canAtk(me, foe)) pAgg = 0.9;
			else if (friends >= 1 && enemies >= 1) {
				/* 队友濒死→偏向配合抢救，同时寻找集火 */
				pAgg = 0.5;
			}
			else pAgg = 0.5;
		}
		return Math.max(0, Math.min(1, pAgg));
	} catch (e) { return 0.5; }
}

/* ★ 残局策略（细化） */
export function endgameStrategy(me) {
	try {
		const living = aliveCount();
		if (living <= 0) return { strategy: 'unknown', desc: '无人存活' };
		if (living === 1) return { strategy: 'win', desc: '已经赢了' };

		const friends = friendCount(me);
		const enemies = enemyCount(me);
		const foe = bestEnemy(me);
		const ally = bestFriend(me);
		const agg = endgameAggression(me);

		if (living === 2) {
			/* ===== 1v1 ===== */
			const reach = canAtk(me, foe);
			const foHp = foe ? foe.hp || 0 : 0;
			const myHp = me.hp || 0;

			if (foe && foHp <= 1 && reach) return { strategy: 'finish_kill', desc: '1v1 敌人残血可斩，全力收掉' };
			if (foe && foHp <= 1 && !reach) return { strategy: 'seek_range', desc: '1v1 敌人残血但够不着，摸牌/拆距离求斩杀' };
			if (myDying(me)) return { strategy: 'defensive', desc: '1v1 自己濒死，桃闪优先保命' };
			if (agg >= 0.85) return { strategy: 'aggressive', desc: '1v1 优势明显，主动压制' };
			if (agg <= 0.3) return { strategy: 'defensive', desc: '1v1 劣势，先保手牌稳守' };
			return { strategy: 'balanced', desc: '1v1 均势，攻守平衡' };
		}

		if (living === 3) {
			/* ===== 1v2 / 2v1 ===== */
			if (enemies >= 2) {
				const dyingAlly = ally && (ally.hp || 0) <= 1 && isAllyOf(me, ally);
				return { strategy: 'survive_1v2', desc: '1v2 少卿多，保存实力+绝不贪刀', allyDying: !!dyingAlly };
			}
			if (friends === 1 && enemies === 1) {
				const foeDying = foe && (foe.hp || 0) <= 1;
				if (foeDying && canAtk(me, foe)) return { strategy: 'finish_kill', desc: '2v1 敌人残血，集火收掉' };
				if (ally && (ally.hp || 0) <= 1) return { strategy: 'save_ally', desc: '2v1 队友濒死，先救队友再合击' };
				return { strategy: 'focus', desc: '2v1 集火唯一敌人' };
			}
			return { strategy: 'balanced', desc: '3人残局，权衡攻守' };
		}

		/* ===== 2v2 ===== */
		const foeDying = foe && (foe.hp || 0) <= 1;
		const allyDying = ally && (ally.hp || 0) <= 1 && isAllyOf(me, ally);
		if (myDying(me)) return { strategy: 'defensive', desc: '2v2 自己濒死，先保命' };
		if (foeDying && canAtk(me, foe)) return { strategy: 'finish_kill', desc: '2v2 敌军残血，斩优先' };
		if (allyDying && !foeDying) return { strategy: 'save_ally', desc: '2v2 队友濒死，优先抢救' };
		if (allyDying && foeDying) return { strategy: 'finish_kill', desc: '2v2 敌我皆残，抢斩杀线' };
		return { strategy: 'balanced', desc: '2v2 均势，稳扎稳打' };
	} catch (e) {
		return { strategy: 'unknown', desc: '残局策略出错' };
	}
}

/* ★ 残局评分加成（牌类加成；act.id 当前卡牌） */
export function endgameBonus(me, act) {
	try {
		if (!isEndgame(me)) return 1.0;
		if (!act || !act.id) return 1.0;

		const id = act.id;
		const strat = endgameStrategy(me);
		const agg = endgameAggression(me);
		const foe = bestEnemy(me);
		const ally = bestFriend(me);
		const salvo = ['sha', 'huosha', 'leisha', 'juedou'];           /* 点杀 */
		const aoe = ['nanman', 'wanjian', 'huogong', 'shunshou', 'guohe', 'fanyan', 'hunshui']; /* 泛指 */
		const save = ['tao', 'taoyuan', 'jui', 'wuxie'];
		const rangeSeek = ['shunshou', 'guohe', 'tiesuo', 'zhujin', 'leinu'];

		switch (strat.strategy) {
			case 'finish_kill':
				/* 敌人残血：能用杀/决斗/锦囊补刀就强烈加成 */
				if (foe) {
					const foeDying = (foe.hp || 0) <= 1;
					if (foeDying) {
						if (salvo.indexOf(id) >= 0) return 1.45;         /* 直接补刀 */
						if (id === 'nanman' || id === 'wanjian') return 1.25; /* AOE补刀 */
						if (id === 'tiesuo') return 0.95;               /* 别用来链自己人 */
					}
				}
				return 1.15;

			case 'seek_range':
				/* 敌人残血但够不着：优先摸牌/拆距离/拿武器 */
				if (rangeSeek.indexOf(id) >= 0) return 1.4;
				if (salvo.indexOf(id) >= 0 && !canAtk(me, foe)) return 1.3; /* 打出距离罩界 */
				return 1.05;

			case 'defensive':
				/* 保守：保命牌加成，攻击牌压低 */
				if (save.indexOf(id) >= 0) return 1.5;
				if (id === 'shan' || id === 'jink') return 1.4;
				if (salvo.indexOf(id) >= 0) return 1.12;
				return 1.0;

			case 'survive_1v2':
				/* 一打多：只做安全收益，AOE 别乱放 */
				if (save.indexOf(id) >= 0) return 1.45;
				if (id === 'shan' || id === 'jink') return 1.35;
				if (aoe.indexOf(id) >= 0) return 0.85;   /* 一打多放AOE容易误伤资源 */
				return 1.0;

			case 'focus':
				/* 集火：加速输出 */
				if (salvo.indexOf(id) >= 0) return 1.3;
				if (id === 'nanman' || id === 'wanjian') return 1.15;
				return 1.0;

			case 'save_ally':
				/* 救队友：桃/桃园/无懈/桃医治优先 */
				if (id === 'tao' || id === 'taoyuan' || id === 'jui') return 1.6;
				if (id === 'wuxie') return 1.5;
				return 1.0;

			case 'aggressive':
				/* 进攻压制 */
				if (salvo.indexOf(id) >= 0) return 1.35;
				if (id === 'nanman' || id === 'wanjian') return 1.2;
				return 1.05;

			case 'balanced':
				return 1.0;

			default:
				return 1.0;
		}
	} catch (e) {
		return 1.0;
	}
}