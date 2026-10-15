/* ============================================================
 * identityPolicy.js — 身份局/国战 技能与目标特化层
 * （v4.0.19-merge 增量：与 modeStrategy 的 decisionBoost 互补，
 *   不重复其加减分，只在「技能优先级 / 技能目标 / 国战敌我处置」
 *   三个他未覆盖的维度上工作。）
 *
 * 设计原则：
 *   1. fail-open：任何异常返回中性值，绝不阻塞原决策链；
 *   2. 只消费公开事实（身份信念/血线/存活数/势力明置状态），
 *      不读取对手隐藏手牌与未公开身份；
 *   3. 幅度克制（±12 内），让 utility 与信念仍然主导排序。
 * ============================================================ */
import { beliefOfFor, hardIdentityOf, currentMode } from '../../perception/observer/identity.js?v=41a';

function _swallow(e) {
	try {
		if (typeof window !== 'undefined' && window.__DJSC && typeof window.__DJSC.swallow === 'function') window.__DJSC.swallow(e);
	} catch (e2) { }
}

/* ---------- 基础事实 ---------- */
function _aliveCount() {
	try { return (game.players || []).filter(function (p) { return p && p.alive !== false; }).length; } catch (e) { _swallow(e); }
	return 0;
}

/* 我方身份：zhu/zhong/mingzhong/fan/nei；未知返回 null */
export function selfRoleOf(me) {
	try {
		if (!me) return null;
		if (me === game.zhu) return 'zhu';
		if (me._trueMe && me._trueMe === game.zhu) return 'zhu';
		const id = me.identity || (me._trueMe && me._trueMe.identity) || me.group;
		if (typeof id === 'string') {
			if (id === 'zhu' || id === 'zhong' || id === 'fan' || id === 'nei' || id === 'mingzhong') return id;
			if (id === 'unknown') return null;
		}
	} catch (e) { _swallow(e); }
	return null;
}

/* 目标是否主公（含硬证据） */
function _isLordTarget(me, t) {
	try {
		if (!t) return false;
		if (t === game.zhu) return true;
		if (t._trueMe && t._trueMe === game.zhu) return true;
		const hard = hardIdentityOf(me, t);
		if (hard && hard.role === 'zhu' && Number(hard.confidence || 0) >= 0.5) return true;
	} catch (e) { _swallow(e); }
	return false;
}

/* ---------- 技能优先级身份偏置 ----------
 * 返回 -12..+12。cat: attack/control/defense/aux/draw/passive */
export function skillPriorityBias(me, sid, cat, tags, ctx) {
	try {
		if (currentMode() !== 'identity') return 0;
		const role = selfRoleOf(me);
		if (!role) return 0;
		let bias = 0;
		const alive = _aliveCount();

		if (role === 'zhong' || role === 'mingzhong') {
			/* 忠臣职责：保护主公 → 辅助/防御技更积极 */
			if (cat === 'aux' || cat === 'defense') bias += 7;
			if (cat === 'attack' && alive > 5) bias -= 2;   /* 前期少抢输出，留拆火 */
		} else if (role === 'zhu') {
			/* 主公：明身份被集火，防御/回复优先；控制技价值大 */
			if (cat === 'defense' || cat === 'aux') bias += 8;
			if (cat === 'control') bias += 5;
		} else if (role === 'fan') {
			/* 反贼：集火链——攻击/控制更果断；残局辅助意义下降 */
			if (cat === 'attack' || cat === 'control') bias += 6;
			if (cat === 'aux' && alive <= 4) bias -= 4;
		} else if (role === 'nei') {
			/* 内奸：前期隐藏（强攻暴露身份）、中期装忠、残局收割 */
			if (alive >= 5) {
				if (cat === 'attack' || cat === 'control') bias -= 8;
				if (cat === 'aux' || cat === 'defense') bias += 3;
			} else if (alive === 4) {
				if (cat === 'control') bias -= 3;            /* 装忠期少暴露控制欲 */
			} else if (alive <= 3) {
				if (cat === 'attack' || cat === 'control') bias += 9;  /* 收割期果断 */
			}
		}
		return Math.max(-12, Math.min(12, bias));
	} catch (e) { _swallow(e); }
	return 0;
}

/* ---------- 技能时机动态门 ----------
 * 修复「静态乘数不知道此刻有没有用」的呆：
 *   - 摸牌类：手牌已溢出 → 抑制；
 *   - 辅助类：没有受益人（队友都健康）→ 抑制；
 *   - 防御类：满血无敌压 → 轻抑制；
 *   - 判定/拼点类：残局慎发；
 *   - 国战暗置期：强攻/强控暴露势力 → 抑制。
 * 返回 -15..0（负值减分），不做硬 veto（保持原语义，只调优先级）。 */
export function skillTimingAdjust(me, sid, cat, tags, ctx) {
	try {
		let adj = 0;
		const hp = (me && me.hp !== undefined) ? me.hp : 3;
		const maxHp = Math.max(1, (me && me.maxHp) || 4);
		let handN = 0;
		try { handN = me.countCards ? me.countCards('h') : 0; } catch (eH) { handN = 0; }

		if (cat === 'draw' && handN >= maxHp + 2) adj -= 10;          /* 手牌溢出再摸=浪费 */
		if (cat === 'aux') {
			const ts = (ctx && ctx.targets) || [];
			const hurtAlly = ts.some(function (t) { return t.isAlly && t !== me && t.hp !== undefined && t.hp < (t.maxHp || 3); });
			if (!hurtAlly && hp >= maxHp) adj -= 8;                    /* 全场健康还给谁？ */
		}
		if (cat === 'defense' && hp >= maxHp) adj -= 5;                /* 满血开盾价值低 */
		if ((tags && (tags.judge || tags.compare)) && ctx && ctx.stage === 'endgame') adj -= 6;
		if (_isGuozhan() && _unrevealed(me) && (cat === 'attack' || cat === 'control')) adj -= 5;
		return adj;
	} catch (e) { _swallow(e); }
	return 0;
}

/* ---------- 己方技能目标偏置 ----------
 * 修复 skillTarget 己方分支「注释说优先主公、打分没有主公」的呆。 */
export function allyTargetBias(me, tpp, tctx) {
	try {
		let bias = 0;
		const mode = currentMode();

		if (mode === 'identity') {
			const role = selfRoleOf(me);
			if (!role) return 0;
			/* 主公/明忠是全场明牌身份：保护他=胜利条件 */
			if (tpp === game.zhu || (tpp._trueMe && tpp._trueMe === game.zhu)) {
				bias += 4;
				if (tctx && tctx.hp !== undefined && tctx.hp <= 1) bias += 4;   /* 濒死主公急救援 */
			}
			/* 信念加权：高置信友方优先 */
			const b = beliefOfFor(me, tpp);
			if (b) {
				if (role === 'fan') bias += (b.fan || 0) * 2;
				else bias += (b.zhong || 0) * 2;
			}
			/* 内奸：帮弱势方（血线平衡策略） */
			if (role === 'nei' && tctx && tctx.hp !== undefined) {
				const alive = _aliveCount();
				if (alive > 4 && tctx.hp <= 2) bias += 3;   /* 前期扶弱制强 */
			}
		} else if (mode === 'guozhan') {
			/* 国战：明置同势力 +3；珠联璧合搭档 +6；暗置未知 +0 */
			const g1 = _groupOf(tpp), g2 = _groupOf(me);
			if (g1 && g1 === g2) bias += 3;
			if (_zhulianWith(me, tpp)) bias += 6;
		}
		return bias;
	} catch (e) { _swallow(e); }
	return 0;
}

/* ---------- 敌方技能目标偏置 ---------- */
export function enemyTargetBias(me, tpp, tctx) {
	try {
		let bias = 0;
		const mode = currentMode();

		if (mode === 'identity') {
			const role = selfRoleOf(me);
			if (!role) return 0;
			if (role === 'fan') {
				/* 反贼：主公是唯一必杀目标 */
				if (_isLordTarget(me, tpp)) bias += 5;
			} else if (role === 'zhu' || role === 'zhong' || role === 'mingzhong') {
				/* 主忠：高反贼嫌疑优先控制 */
				const b = beliefOfFor(me, tpp);
				if (b && (b.fan || 0) >= 0.5) bias += 3;
			} else if (role === 'nei') {
				/* 内奸平衡策略：压制强势方，放过残血（留着平衡） */
				const hp = tctx && tctx.hp !== undefined ? tctx.hp : 3;
				const maxHp = tctx && tctx.maxHp ? tctx.maxHp : 4;
				if (hp >= maxHp && (tctx && (tctx.threat || 0) >= 2)) bias += 3;
				if (hp <= 1) bias -= 2;
			}
		} else if (mode === 'guozhan') {
			const g1 = _groupOf(tpp), g2 = _groupOf(me);
			if (g1 && g2 && g1 !== g2) bias += 2;          /* 异势力明确敌对 */
			if (!g1) bias -= 2;                            /* 暗置未知：不确定性抑制 */
		}
		return bias;
	} catch (e) { _swallow(e); }
	return 0;
}

/* ---------- 国战敌我处置（接入 relations.dispositionOf） ----------
 * 返回 +1/-1/0 表示处置；null 表示「本层不处理，走原逻辑」。
 * 只基于公开势力与珠联璧合，不猜测暗置玩家的势力。 */
export function guozhanDispositionOf(me, t) {
	try {
		if (!_isGuozhan() || !me || !t || t === me) return null;
		const gm = _groupOf(me), gt = _groupOf(t);
		if (_zhulianWith(me, t)) return 1;
		if (gm && gt) return gm === gt ? 1 : -1;   /* 双方都明置：同势力友/异势力敌 */
		return 0;                                   /* 有暗置：保守中性（宿主 attitude 对暗置不可靠） */
	} catch (e) { _swallow(e); }
	return null;
}

/* ---------- 内部工具 ---------- */
function _isGuozhan() {
	try { return currentMode() === 'guozhan'; } catch (e) { return false; }
}

/* 势力明置探测：暗置/未明置返回 null */
function _groupOf(p) {
	try {
		if (!p) return null;
		const g = p.group1 || p.group;
		if (typeof g !== 'string' || !g) return null;
		if (g === 'unknown' || g === 'transparent' || g === 'none') return null;
		return g;
	} catch (e) { _swallow(e); }
	return null;
}

function _unrevealed(p) {
	try { return !_groupOf(p); } catch (e) { return false; }
}

/* 珠联璧合探测：宿主接口形态不定，逐级尝试，全失败退 false */
function _zhulianWith(me, t) {
	try {
		if (!me || !t) return false;
		if (typeof me.getZhuLianBiHe === 'function' && me.getZhuLianBiHe(t)) return true;
		const zl = _status && _status.zhuLianBiHe;
		if (Array.isArray(zl)) {
			for (const pair of zl) {
				if (Array.isArray(pair) && pair.indexOf(me) >= 0 && pair.indexOf(t) >= 0) return true;
			}
		}
		if (me.zhuLianBiHe && (me.zhuLianBiHe === t || me.zhuLianBiHe.indexOf && me.zhuLianBiHe.indexOf(t) >= 0)) return true;
	} catch (e) { _swallow(e); }
	return false;
}
