/*
 * 无名AI · Objective / Intent Core
 *
 * 纯策略核心：不直接依赖宿主对象。
 * 输入必须来自公开事实、观察者合法后验与行动者自身私有信息。
 */

export const INTENT = Object.freeze({
	SURVIVE: 'SURVIVE',
	PROTECT: 'PROTECT',
	FINISH: 'FINISH',
	FOCUS: 'FOCUS',
	CONTROL: 'CONTROL',
	DISRUPT: 'DISRUPT',
	DEVELOP: 'DEVELOP',
	SETUP: 'SETUP',
	BURST: 'BURST',
	PRESERVE: 'PRESERVE',
	BALANCE: 'BALANCE',
	CONCEAL: 'CONCEAL',
	PASS: 'PASS',
});

export const IDENTITY_RISK = Object.freeze({
	CONFIRMED: 'CONFIRMED',
	HIGH_CONFIDENCE: 'HIGH_CONFIDENCE',
	UNCERTAIN: 'UNCERTAIN',
	PROTECTED_UNKNOWN: 'PROTECTED_UNKNOWN',
});

function clamp01(v) {
	const n = Number(v);
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(1, n));
}

function hpRatio(hp, maxHp) {
	const m = Math.max(1, Number(maxHp) || 1);
	return Math.max(0, Number(hp) || 0) / m;
}

function roleProb(target, role) {
	if (!target) return 0;
	if (target.hardRole === role) return 1;
	return clamp01(target.belief && target.belief[role]);
}

function enemyProb(selfRole, target) {
	if (!target) return 0;
	if (selfRole === 'zhu' || selfRole === 'zhong') return roleProb(target, 'fan');
	if (selfRole === 'fan') {
		if (target.hardRole === 'zhu' || target.isLord) return 1;
		return roleProb(target, 'zhong');
	}
	return 0;
}

export function classifyIdentityRisk(selfRole, target) {
	if (!target) return IDENTITY_RISK.UNCERTAIN;
	if (target.hardRole) return IDENTITY_RISK.CONFIRMED;
	const b = target.belief || {};
	const ranked = ['fan', 'zhong', 'nei']
		.map(function (role) { return { role, p: clamp01(b[role]) }; })
		.sort(function (a, z) { return z.p - a.p; });
	const best = ranked[0] || { p: 0 };
	const second = ranked[1] || { p: 0 };
	const ep = enemyProb(selfRole, target);
	if (ep <= 0.001) return IDENTITY_RISK.PROTECTED_UNKNOWN;
	if (best.p >= 0.75 && best.p - second.p >= 0.25) return IDENTITY_RISK.HIGH_CONFIDENCE;
	return IDENTITY_RISK.UNCERTAIN;
}

function pickTarget(targets, filter, scorer) {
	let best = null, bestScore = -Infinity;
	for (const t of targets || []) {
		if (!t || t.alive === false || !filter(t)) continue;
		const s = Number(scorer(t)) || 0;
		if (!best || s > bestScore) { best = t; bestScore = s; }
	}
	return best;
}

function pickEnemy(selfRole, targets, preferFinish) {
	return pickTarget(targets, function (t) {
		const risk = t.identityRisk || classifyIdentityRisk(selfRole, t);
		return enemyProb(selfRole, t) >= 0.65 &&
			risk !== IDENTITY_RISK.PROTECTED_UNKNOWN;
	}, function (t) {
		const certainty = enemyProb(selfRole, t);
		const finish = preferFinish ? (5 - Math.min(5, Number(t.hp) || 5)) * 2.5 : 0;
		return certainty * 6 + finish + (Number(t.publicThreat) || 0);
	});
}

export function resolveVictoryObjectives(ctx) {
	const mode = String(ctx && ctx.mode || 'generic');
	const role = String(ctx && ctx.selfRole || 'unknown');
	if (mode === 'identity' || mode === 'connect') {
		if (role === 'zhu') return ['SURVIVE_LORD', 'ELIMINATE_REBELS_AND_SPY'];
		if (role === 'zhong') return ['PROTECT_LORD', 'ELIMINATE_REBELS_AND_SPY'];
		if (role === 'fan') return ['KILL_LORD'];
		if (role === 'nei') return ['SURVIVE_SELF', 'BALANCE_FIELD', 'ENTER_FINAL_DUEL', 'KILL_LORD_AT_FINAL'];
	}
	if (mode === 'doudizhu') {
		if (role === 'landlord') return ['ELIMINATE_FARMERS'];
		if (role === 'farmer') return ['ELIMINATE_LANDLORD'];
	}
	return ['SURVIVE_SELF', 'MAXIMIZE_WIN_PROBABILITY'];
}

export function resolveRoleObjective(ctx) {
	const mode = String(ctx && ctx.mode || 'generic');
	const role = String(ctx && ctx.selfRole || 'unknown');
	const lordHp = Number(ctx && ctx.lordHp);
	const alive = Number(ctx && ctx.aliveCount) || 0;

	if (mode === 'identity' || mode === 'connect') {
		if (role === 'zhu') {
			if (lordHp <= 1) return 'LORD_SURVIVAL';
			return 'REMOVE_CONFIRMED_REBEL';
		}
		if (role === 'zhong') {
			if (lordHp <= 1) return 'LORD_SURVIVAL';
			return 'REMOVE_CONFIRMED_REBEL';
		}
		if (role === 'fan') return lordHp <= 2 ? 'LORD_FINISH' : 'PRESSURE_LORD';
		if (role === 'nei') {
			if (alive <= 2) return 'FINAL_DUEL';
			if (ctx.spyDominantSide && ctx.spyDominantSide !== 'balanced') return 'BALANCE_FIELD';
			return 'CONCEAL_AND_SURVIVE';
		}
	}
	if (mode === 'doudizhu') {
		return role === 'farmer' ? 'FOCUS_LANDLORD' : 'REMOVE_FARMERS';
	}
	if (hpRatio(ctx.selfHp, ctx.selfMaxHp) <= 0.25) return 'SELF_SURVIVAL';
	return 'GENERAL_ADVANTAGE';
}

function makeIntent(type, opts) {
	opts = opts || {};
	return {
		type,
		target: opts.target || null,
		threatTarget: opts.threatTarget || null,
		confidence: clamp01(opts.confidence == null ? 0.5 : opts.confidence),
		urgency: opts.urgency || 'normal',
		priorityTier: opts.priorityTier || 'normal',
		priorityValue: Number(opts.priorityValue) || 0,
		reasons: Array.isArray(opts.reasons) ? opts.reasons.slice(0, 6) : [],
	};
}

export function resolveStrategicIntentCore(ctx) {
	ctx = ctx || {};
	const mode = String(ctx.mode || 'generic');
	const role = String(ctx.selfRole || 'unknown');
	const targets = Array.isArray(ctx.targets) ? ctx.targets : [];
	const ownLow = hpRatio(ctx.selfHp, ctx.selfMaxHp) <= 0.25;
	const lordLow = Number(ctx.lordHp) <= 1;
	const victory = resolveVictoryObjectives(ctx);
	const roleObjective = resolveRoleObjective(ctx);

	/* 身份局：胜利条件与身份职责优先于普通 utility。 */
	if (mode === 'identity' || mode === 'connect') {
		if (role === 'zhu') {
			if (ownLow || lordLow) {
				return { victory, roleObjective, intent: makeIntent(INTENT.SURVIVE, {
					target: ctx.selfKey,
					confidence: 1,
					urgency: 'critical',
					priorityTier: 'critical',
					priorityValue: 100,
					reasons: ['主公处于生存临界状态'],
				}) };
			}
			const enemy = pickEnemy(role, targets, true);
			if (enemy && Number(enemy.hp) <= 1) {
				return { victory, roleObjective, intent: makeIntent(INTENT.FINISH, {
					target: enemy.key, confidence: enemyProb(role, enemy),
					urgency: 'critical', priorityTier: 'critical', priorityValue: 88,
					reasons: ['确认/高置信反贼进入斩杀窗口'],
				}) };
			}
			if (enemy) return { victory, roleObjective, intent: makeIntent(INTENT.FOCUS, {
				target: enemy.key, confidence: enemyProb(role, enemy),
				reasons: ['优先处理确认或高置信反贼'],
			}) };
			return { victory, roleObjective: 'PRESERVE_INFORMATION', intent: makeIntent(INTENT.PRESERVE, {
				confidence: 0.8, reasons: ['未发现足够可信的反贼目标，保护未知身份'],
			}) };
		}

		if (role === 'zhong') {
			const threat = pickEnemy(role, targets, false);
			if (lordLow) {
				return { victory, roleObjective: 'LORD_SURVIVAL', intent: makeIntent(INTENT.PROTECT, {
					target: ctx.lordKey, threatTarget: threat && threat.key,
					confidence: 1, urgency: 'critical', priorityTier: 'critical', priorityValue: 100,
					reasons: ['主公1血/濒危', threat ? '优先解除已识别反贼威胁' : '优先保主'],
				}) };
			}
			const finish = pickEnemy(role, targets, true);
			if (finish && Number(finish.hp) <= 1) {
				return { victory, roleObjective, intent: makeIntent(INTENT.FINISH, {
					target: finish.key, confidence: enemyProb(role, finish),
					urgency: 'critical', priorityTier: 'critical', priorityValue: 86,
					reasons: ['高置信反贼进入斩杀窗口'],
				}) };
			}
			if (threat) return { victory, roleObjective, intent: makeIntent(INTENT.FOCUS, {
				target: threat.key, confidence: enemyProb(role, threat),
				reasons: ['围绕高置信反贼集中行动'],
			}) };
			return { victory, roleObjective: 'PRESERVE_INFORMATION', intent: makeIntent(INTENT.PRESERVE, {
				confidence: 0.85, reasons: ['反贼身份槽位/后验不足，不主动集火未知角色'],
			}) };
		}

		if (role === 'fan') {
			const lord = targets.find(function (t) { return t && t.isLord; }) || null;
			if (lord && Number(lord.hp) <= 1 && ctx.ownAttackReady) {
				return { victory, roleObjective: 'LORD_FINISH', intent: makeIntent(INTENT.FINISH, {
					target: lord.key, confidence: 1,
					urgency: 'critical', priorityTier: 'critical', priorityValue: 100,
					reasons: ['主公进入可斩杀血线', '反贼胜利目标直接相关'],
				}) };
			}
			return { victory, roleObjective, intent: makeIntent(INTENT.FOCUS, {
				target: ctx.lordKey || (lord && lord.key), confidence: 1,
				reasons: ['反贼核心目标：持续压制主公'],
			}) };
		}

		if (role === 'nei') {
			const lord = targets.find(function (t) { return t && t.isLord; }) || null;
			if ((Number(ctx.aliveCount) || 0) <= 2 && lord) {
				return { victory, roleObjective: 'FINAL_DUEL', intent: makeIntent(INTENT.FINISH, {
					target: lord.key, confidence: 1,
					urgency: 'critical', priorityTier: 'critical', priorityValue: 96,
					reasons: ['仅剩主公与内奸，进入最终决战'],
				}) };
			}
			if (ctx.spyDominantSide === 'rebel' || ctx.spyDominantSide === 'loyal') {
				const side = ctx.spyDominantSide;
				const balanceTarget = pickTarget(targets, function (t) {
					if (!t || t.isLord) return false;
					if (side === 'rebel') return roleProb(t, 'fan') >= 0.60;
					return roleProb(t, 'zhong') >= 0.60;
				}, function (t) {
					return (side === 'rebel' ? roleProb(t, 'fan') : roleProb(t, 'zhong')) * 6 +
						(Number(t.publicThreat) || 0);
				});
				return { victory, roleObjective: 'BALANCE_FIELD', intent: makeIntent(INTENT.BALANCE, {
					target: balanceTarget && balanceTarget.key,
					confidence: balanceTarget ? 0.8 : 0.6,
					reasons: ['当前场面' + side + '侧占优', '内奸维持场面均衡并保留残局胜率'],
				}) };
			}
			return { victory, roleObjective: 'CONCEAL_AND_SURVIVE', intent: makeIntent(INTENT.CONCEAL, {
				confidence: 0.8, reasons: ['场面暂时均衡，优先隐藏立场并保留自身资源'],
			}) };
		}
	}

	/* 斗地主只建立胜利目标与聚焦目标，不改原有具体牌策略。 */
	if (mode === 'doudizhu') {
		const enemyRole = role === 'landlord' ? 'farmer' : 'landlord';
		const enemy = pickTarget(targets, function (t) { return t.role === enemyRole; }, function (t) {
			return (5 - Math.min(5, Number(t.hp) || 5)) * 2 + (Number(t.publicThreat) || 0);
		});
		if (enemy && Number(enemy.hp) <= 1 && ctx.ownAttackReady) {
			return { victory, roleObjective, intent: makeIntent(INTENT.FINISH, {
				target: enemy.key, confidence: 1,
				urgency: 'critical', priorityTier: 'critical', priorityValue: 92,
				reasons: ['敌方进入明确斩杀血线'],
			}) };
		}
		return { victory, roleObjective, intent: makeIntent(INTENT.FOCUS, {
			target: enemy && enemy.key, confidence: enemy ? 1 : 0.5,
			reasons: ['围绕模式胜利目标集中行动'],
		}) };
	}

	if (ownLow) return { victory, roleObjective, intent: makeIntent(INTENT.SURVIVE, {
		target: ctx.selfKey, confidence: 0.9,
		urgency: 'critical', priorityTier: 'critical', priorityValue: 90,
		reasons: ['自身处于低血高风险'],
	}) };

	const genericEnemy = pickTarget(targets, function (t) { return t.relation === 'enemy'; }, function (t) {
		return (5 - Math.min(5, Number(t.hp) || 5)) * 2 + (Number(t.publicThreat) || 0);
	});
	if (genericEnemy && Number(genericEnemy.hp) <= 1) return { victory, roleObjective, intent: makeIntent(INTENT.FINISH, {
		target: genericEnemy.key, confidence: 0.8,
		urgency: 'critical', priorityTier: 'critical', priorityValue: 82,
		reasons: ['敌方目标进入斩杀窗口'],
	}) };
	if (genericEnemy) return { victory, roleObjective, intent: makeIntent(INTENT.FOCUS, {
		target: genericEnemy.key, confidence: 0.7, reasons: ['集中处理当前高价值敌方目标'],
	}) };
	return { victory, roleObjective, intent: makeIntent(INTENT.DEVELOP, {
		confidence: 0.6, reasons: ['没有明确关键目标，优先发育与保留资源'],
	}) };
}
