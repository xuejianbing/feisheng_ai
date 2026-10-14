/*
 * ============================================================
 * 无名AI · 目标基本决策引擎（targetBrain）
 * ------------------------------------------------------------
 * 职责：统一「目标选择」的决策标准，供卡牌/技能使用。
 *       与其它 basic module 同法：分类 → 否决 → 优先级 → 理由。
 *
 * 目标侧维度：
 *   - 威胁度(threat)
 *   - 低血(收割价值 lowHp)
 *   - 手牌/装备价值(equipVal)
 *   - 即将行动(nextToAct，控制价值)
 *   - 敌我(ally/enemy)
 *
 * 本模块为纯函数，可单测。
 * ============================================================
 */

/* ---------- 目标用途分类 ---------- */
export function classifyTarget(purpose) {
	switch (purpose) {
		case 'kill': return '击杀';
		case 'damage': return '输出';
		case 'control': return '控制';
		case 'dismantle': return '拆除';
		case 'support': return '辅助';
		case 'save': return '救援';
		default: return '通用';
	}
}

/* ---------- 目标打分（越高越值得被打/被控制） ---------- */
export function targetScore(purpose, t) {
	t = t || {};
	let s = 0;
	const lowHp = t.hp !== undefined ? (t.hp <= 1 ? 3 : (t.hp <= 2 ? 2 : 0)) : 0;
	const threat = t.threat || 0;
	switch (purpose) {
		case 'kill':
			s = lowHp * 5 + (1 - (t.shanProb || 0.5)) * 2 + threat * 0.5;
			break;
		case 'damage':
			s = lowHp * 3 + threat * 0.7 - (t.equipVal || 0) * 0.2;
			break;
		case 'control':
			s = (t.nextToAct ? 4 : 0) + (t.handCount >= 4 ? 2 : 0) + threat * 0.8;
			break;
		case 'dismantle':
			/* 判定牌（乐/兵）按敌友区分：敌方-> 负分（拆了帮敌，不拆）；队友-> 正分（帮队友解） */
			s = (t.equipVal || 0) * 2 + (t.isJudge ? (t.isAlly ? 4 : -4) : 0) + lowHp;
			break;
		case 'save':
			// 救队友：濒死/主公/血低
			s = (t.hp !== undefined && t.hp <= 0 ? 5 : 0) + (t.isLord ? 3 : 0) + lowHp * 2;
			break;
		case 'support':
			// 给队友递牌/增益：即将行动的主公
			s = (t.isLord ? 3 : 0) + (t.nextToAct ? 2 : 0);
			break;
		default:
			s = lowHp + threat * 0.5 + (t.equipVal || 0) * 0.5;
	}
	return Math.round(s * 10) / 10;
}

/* ---------- 敌我方向过滤（敌我系统：三态 neutral 两者都不选） ---------- */
function isEligible(t, purpose) {
	if (purpose === 'save' || purpose === 'support') return !!t.isAlly;
	if (purpose === 'kill' || purpose === 'damage' || purpose === 'control')
		return t.isEnemy === undefined ? !t.isAlly : !!t.isEnemy;   /* 中性(内/身份未明)→不列为攻击目标 */
	/* dismantle(拆/顺)：敌人可拆（拆装备/拆其防御）；队友仅在带判定牌时拆（帮队友解乐/兵） */
	if (purpose === 'dismantle') return !!t.isJudge || !t.isAlly;
	return true;   // 通用
}

/* ---------- 目标选择 ---------- */
export function pickTargetByPurpose(purpose, targets) {
	targets = targets || [];
	if (!targets.length) return { index: -1, score: 0, reason: '无可选目标' };
	let bestI = -1, bestS = -Infinity, bestR = '';
	targets.forEach(function (t, i) {
		if (!isEligible(t, purpose)) return;
		const s = targetScore(purpose, t);
		if (s > bestS) { bestS = s; bestI = i; bestR = classifyTarget(purpose) + '最佳(' + s + ')'; }
	});
	if (bestI < 0) return { index: -1, score: 0, reason: '无合适' + classifyTarget(purpose) + '目标' };
	return { index: bestI, score: bestS, reason: bestR };
}

/* ---------- 汇总决策：给定用途挑目标 ---------- */
export function decideTarget(purpose, targets, ctx) {
	ctx = ctx || {};
	const ok = pickTargetByPurpose(purpose, targets);
	return {
		purpose: purpose, category: classifyTarget(purpose),
		targetIndex: ok.index, targetScore: ok.score, reason: ok.reason,
	};
}