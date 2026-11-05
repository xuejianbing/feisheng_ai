import { ok, eq, finish } from './_harness.mjs';
import {
	INTENT,
	IDENTITY_RISK,
	classifyIdentityRisk,
	resolveStrategicIntentCore,
} from '../../score/decision/strategy/objectiveCore.js';
import { applyStrategicIntentToCandidates } from '../../score/decision/strategy/intentAlignment.js';
import { makeActionCandidate, compareActionCandidates, PRIORITY_TIER } from '../../score/decision/state/actionCandidate.js';
import { shouldRefreshStrategicState, makeStrategicStateRecord } from '../../score/decision/strategy/strategicStateCore.js';

function target(spec) {
	return Object.assign({
		key: '?', alive: true, hp: 3, maxHp: 4,
		hardRole: null, belief: { fan: 0, zhong: 0, nei: 0 },
		confidence: 0, isLord: false, publicThreat: 1, relation: 'neutral',
	}, spec || {});
}

/* 忠臣：主公濒危时，不再只是 +0.x bonus，而是明确 PROTECT / CRITICAL。 */
{
	const fan = target({ key: 'fanA', hp: 2, hardRole: 'fan', belief: { fan: 1, zhong: 0, nei: 0 }, confidence: 1, publicThreat: 3 });
	fan.identityRisk = classifyIdentityRisk('zhong', fan);
	const out = resolveStrategicIntentCore({
		mode: 'identity', selfRole: 'zhong', selfKey: 'loyal',
		selfHp: 3, selfMaxHp: 4,
		lordKey: 'lord', lordHp: 1, lordMaxHp: 4, aliveCount: 4,
		targets: [target({ key: 'lord', hp: 1, hardRole: 'zhu', isLord: true }), fan],
	});
	eq(out.roleObjective, 'LORD_SURVIVAL', '10.63 忠臣主公1血进入LORD_SURVIVAL');
	eq(out.intent.type, INTENT.PROTECT, '10.63 忠臣主公1血生成PROTECT');
	eq(out.intent.target, 'lord', '10.63 PROTECT目标锁定主公');
	eq(out.intent.threatTarget, 'fanA', '10.63 PROTECT同时记录确认反贼威胁');
	eq(out.intent.priorityTier, PRIORITY_TIER.CRITICAL, '10.63 保主属于CRITICAL职责');
}

/* 身份槽位已经排除反贼：unknown 必须保护，不因“未知”自动当敌人。 */
{
	const unknown = target({ key: 'unknownB', belief: { fan: 0, zhong: 0.55, nei: 0.45 }, confidence: 0.55 });
	unknown.identityRisk = classifyIdentityRisk('zhong', unknown);
	eq(unknown.identityRisk, IDENTITY_RISK.PROTECTED_UNKNOWN, '10.63 fan概率为0的unknown进入保护状态');
	const out = resolveStrategicIntentCore({
		mode: 'identity', selfRole: 'zhong', selfKey: 'loyal',
		selfHp: 3, selfMaxHp: 4,
		lordKey: 'lord', lordHp: 3, lordMaxHp: 4, aliveCount: 3,
		targets: [target({ key: 'lord', hp: 3, hardRole: 'zhu', isLord: true }), unknown],
	});
	eq(out.intent.type, INTENT.PRESERVE, '10.63 无可信反贼时忠臣选择PRESERVE');
	eq(out.intent.target, null, '10.63 不把protected unknown设为集火目标');
}

/* 反贼：主公1血且自己有杀时，直接进入 FINISH_LORD。 */
{
	const out = resolveStrategicIntentCore({
		mode: 'identity', selfRole: 'fan', selfKey: 'fan',
		selfHp: 3, selfMaxHp: 4,
		lordKey: 'lord', lordHp: 1, lordMaxHp: 4, aliveCount: 4,
		ownAttackReady: true,
		targets: [target({ key: 'lord', hp: 1, hardRole: 'zhu', isLord: true })],
	});
	eq(out.roleObjective, 'LORD_FINISH', '10.63 反贼识别主公斩杀职责');
	eq(out.intent.type, INTENT.FINISH, '10.63 反贼斩主生成FINISH');
	eq(out.intent.target, 'lord', '10.63 FINISH目标为主公');
	eq(out.intent.priorityTier, PRIORITY_TIER.CRITICAL, '10.63 斩主窗口属于CRITICAL');
}

/* 反贼普通阶段只 FOCUS，不把所有打主公动作强升 critical。 */
{
	const out = resolveStrategicIntentCore({
		mode: 'identity', selfRole: 'fan', selfKey: 'fan',
		selfHp: 3, selfMaxHp: 4,
		lordKey: 'lord', lordHp: 4, lordMaxHp: 4, aliveCount: 5,
		ownAttackReady: true,
		targets: [target({ key: 'lord', hp: 4, hardRole: 'zhu', isLord: true })],
	});
	eq(out.intent.type, INTENT.FOCUS, '10.63 反贼非斩杀阶段保持FOCUS');
	eq(out.intent.priorityTier, PRIORITY_TIER.NORMAL, '10.63 普通FOCUS仍是utility-first');
}

/* 内奸：身份固定，stance动态；只剩主公时进入FINAL_DUEL。 */
{
	const out = resolveStrategicIntentCore({
		mode: 'identity', selfRole: 'nei', selfKey: 'spy',
		selfHp: 3, selfMaxHp: 4,
		lordKey: 'lord', lordHp: 3, lordMaxHp: 4, aliveCount: 2,
		spyDominantSide: 'balanced',
		targets: [target({ key: 'lord', hp: 3, hardRole: 'zhu', isLord: true })],
	});
	eq(out.roleObjective, 'FINAL_DUEL', '10.63 内奸最终残局进入FINAL_DUEL');
	eq(out.intent.type, INTENT.FINISH, '10.63 内奸最终残局转为FINISH');
	eq(out.intent.target, 'lord', '10.63 内奸最终敌人为主公');
}

/* 内奸中期：优势侧明确时 BALANCE，但不把它升级成关键胜利职责。 */
{
	const loyal = target({ key: 'loyalA', hardRole: 'zhong', belief: { zhong: 1, fan: 0, nei: 0 }, publicThreat: 4 });
	const out = resolveStrategicIntentCore({
		mode: 'identity', selfRole: 'nei', selfKey: 'spy',
		selfHp: 3, selfMaxHp: 4,
		lordKey: 'lord', lordHp: 3, lordMaxHp: 4, aliveCount: 4,
		spyDominantSide: 'loyal',
		targets: [target({ key: 'lord', hp: 3, hardRole: 'zhu', isLord: true }), loyal],
	});
	eq(out.intent.type, INTENT.BALANCE, '10.63 内奸中期使用BALANCE');
	eq(out.intent.target, 'loyalA', '10.63 BALANCE压制当前优势侧非主公角色');
	eq(out.intent.priorityTier, PRIORITY_TIER.NORMAL, '10.63 BALANCE不越权为CRITICAL');
}

/* CRITICAL职责可以跨越普通raw utility。 */
{
	const state = {
		roleObjective: 'LORD_SURVIVAL',
		intent: {
			type: INTENT.PROTECT,
			target: 'lord',
			threatTarget: 'fanA',
			priorityTier: PRIORITY_TIER.CRITICAL,
			priorityValue: 100,
		},
	};
	const save = makeActionCandidate({ type: 'card', id: 'tao', target: 'lord', score: 3 });
	const greed = makeActionCandidate({ type: 'card', id: 'shunshou', target: 'unknownB', score: 30 });
	applyStrategicIntentToCandidates([save, greed], state);
	const sorted = [save, greed].sort(compareActionCandidates);
	eq(sorted[0], save, '10.63 CRITICAL保主动作跨越普通高utility动作');
	eq(save.policy.priorityTier, PRIORITY_TIER.CRITICAL, '10.63 对齐PROTECT候选被提升CRITICAL');
	eq(greed.policy.priorityTier, PRIORITY_TIER.NORMAL, '10.63 无关动作保持NORMAL');
	eq(save.score, 3, '10.63 战略层不改写CRITICAL候选raw score');
	eq(greed.score, 30, '10.63 战略层不改写普通候选raw score');
}

/* 普通FOCUS只写alignment，不改priority tier；仍由utility先选。 */
{
	const state = {
		roleObjective: 'PRESSURE_LORD',
		intent: { type: INTENT.FOCUS, target: 'lord', priorityTier: PRIORITY_TIER.NORMAL, priorityValue: 0 },
	};
	const focus = makeActionCandidate({ type: 'card', id: 'sha', target: 'lord', score: 5 });
	const utility = makeActionCandidate({ type: 'card', id: 'guohe', target: 'other', score: 8 });
	applyStrategicIntentToCandidates([focus, utility], state);
	const sorted = [focus, utility].sort(compareActionCandidates);
	eq(focus.policy.priorityTier, PRIORITY_TIER.NORMAL, '10.63 普通FOCUS不升级priority');
	eq(sorted[0], utility, '10.63 普通FOCUS保持utility-first');
	ok(focus.strategicAlignment && focus.strategicAlignment.level === 'high', '10.63 普通FOCUS仍记录战略对齐解释');
}

/* Intent生命周期：同一回合、关键状态不变则复用；关键fingerprint变化才刷新。 */
{
	const old = makeStrategicStateRecord(null, '1|fan|fan', 'stable', {
		victory: ['KILL_LORD'],
		roleObjective: 'PRESSURE_LORD',
		intent: { type: INTENT.FOCUS, target: 'lord' },
	});
	eq(shouldRefreshStrategicState(old, '1|fan|fan', 'stable', false), false,
		'10.63 同回合关键状态不变时Intent稳定');
	eq(shouldRefreshStrategicState(old, '1|fan|fan', 'lord-critical', false), true,
		'10.63 主公血线等关键状态变化时刷新Intent');
	eq(shouldRefreshStrategicState(old, '2|fan|fan', 'stable', false), true,
		'10.63 新回合刷新Intent');
	eq(shouldRefreshStrategicState(old, '1|fan|fan', 'stable', true), true,
		'10.63 显式force允许刷新Intent');
}

finish('strategic_intent');
