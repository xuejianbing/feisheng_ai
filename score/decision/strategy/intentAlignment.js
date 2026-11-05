/*
 * 无名AI · Intent Alignment
 *
 * 将统一战略意图投影到候选 policy。
 * 不直接修改 utility score；只在明确 CRITICAL/FORCED 身份职责下提升 priority tier。
 */
import {
	PRIORITY_TIER,
	ensureCandidatePolicy,
	candidatePriorityRank,
	setCandidatePriority,
	candidateTargetValue,
} from '../state/actionCandidate.js';
import { INTENT } from './objectiveCore.js';

const DAMAGE = new Set(['sha', 'juedou', 'huogong', 'nanman', 'wanjian', 'zhujin', 'huosha', 'leisha']);
const CONTROL = new Set(['guohe', 'shunshou', 'lebu', 'bingliang', 'jiedao', 'tiesuo']);
const HEAL = new Set(['tao', 'taoyuan']);
const DEVELOP = new Set(['wuzhong', 'wugu']);

const TIER_RANK = { normal: 0, critical: 1, forced: 2 };

function targetKeys(candidate) {
	const value = candidateTargetValue(candidate);
	if (Array.isArray(value)) return value.map(String);
	if (value == null || value === '') return [];
	return [String(value)];
}

function targets(candidate, key) {
	if (!key) return false;
	return targetKeys(candidate).indexOf(String(key)) >= 0;
}

function alignment(level, value, reason) {
	return { level, value, reason: reason || '' };
}

export function evaluateIntentAlignment(candidate, strategicState) {
	const intent = strategicState && strategicState.intent;
	if (!candidate || !intent) return alignment('neutral', 0, '无战略意图');
	const id = String(candidate.id || '');
	const type = String(candidate.type || 'card');
	const target = intent.target;
	const threat = intent.threatTarget;
	const toTarget = targets(candidate, target);
	const toThreat = targets(candidate, threat);
	const damage = DAMAGE.has(id);
	const control = CONTROL.has(id);
	const heal = HEAL.has(id);

	switch (intent.type) {
		case INTENT.FINISH:
			if (toTarget && damage) return alignment('very_high', 1, '直接推进斩杀目标');
			if (toTarget && control) return alignment('high', 0.82, '控制斩杀目标以扩大窗口');
			if (type === 'skill' && toTarget) return alignment('medium', 0.55, '技能指向斩杀目标，语义待武将画像细化');
			return alignment('low', 0.1, '未直接推进斩杀目标');

		case INTENT.PROTECT:
			if (toTarget && heal) return alignment('very_high', 1, '直接保护关键友方');
			if (toThreat && damage) return alignment('very_high', 0.96, '直接移除关键威胁');
			if (toThreat && control) return alignment('high', 0.86, '控制关键威胁');
			if (id === 'taoyuan') return alignment('medium', 0.55, '全局恢复可能保护关键友方');
			return alignment('low', 0.15, '未直接服务保护目标');

		case INTENT.FOCUS:
			if (toTarget && damage) return alignment('high', 0.9, '攻击当前集火目标');
			if (toTarget && control) return alignment('high', 0.78, '控制当前集火目标');
			if (type === 'skill' && toTarget) return alignment('medium', 0.5, '技能指向当前集火目标');
			return alignment('neutral', 0.25, '与集火目标关系弱');

		case INTENT.BALANCE:
			if (toTarget && (damage || control)) return alignment('high', 0.75, '压制当前优势侧关键角色');
			return alignment('neutral', 0.25, '与平衡场面关系弱');

		case INTENT.SURVIVE:
			if (id === 'tao' && (!targetKeys(candidate).length || toTarget)) return alignment('very_high', 1, '直接提高自身生存');
			if (id === 'jiu') return alignment('high', 0.7, '保留/提高濒危生存能力');
			if (candidate.type === 'end') return alignment('medium', 0.45, '停止额外资源暴露');
			return alignment('neutral', 0.2, '非直接生存动作');

		case INTENT.PRESERVE:
		case INTENT.PASS:
			if (candidate.type === 'end') return alignment('high', 0.7, '保留关键资源与身份信息');
			return alignment('neutral', 0.25, '普通资源投入');

		case INTENT.DEVELOP:
			if (DEVELOP.has(id) || candidate.type === 'equip') return alignment('high', 0.75, '推进发育');
			return alignment('neutral', 0.25, '普通动作');

		case INTENT.CONCEAL:
			if (candidate.type === 'end') return alignment('medium', 0.5, '降低无意义身份暴露');
			return alignment('neutral', 0.2, '保持战略中性');

		default:
			return alignment('neutral', 0, '未定义意图映射');
	}
}

function strongerPriority(candidate, tier, value) {
	const policy = ensureCandidatePolicy(candidate);
	const currentRank = candidatePriorityRank(candidate);
	const nextRank = TIER_RANK[tier] || 0;
	if (nextRank > currentRank) return true;
	if (nextRank < currentRank) return false;
	return Number(value) > Number(policy && policy.priorityValue || 0);
}

export function applyStrategicIntent(candidate, strategicState) {
	if (!candidate || !strategicState || !strategicState.intent) return candidate;
	const intent = strategicState.intent;
	const a = evaluateIntentAlignment(candidate, strategicState);
	candidate.strategicAlignment = {
		intent: intent.type,
		target: intent.target || null,
		threatTarget: intent.threatTarget || null,
		level: a.level,
		value: a.value,
		reason: a.reason,
		roleObjective: strategicState.roleObjective || '',
	};

	/* 只有“明确关键职责 + 高度对齐”才跨越普通 utility 层。
	 * 普通 FOCUS/BALANCE/DEVELOP 只记录 alignment，不抢排序权。 */
	if ((intent.priorityTier === PRIORITY_TIER.CRITICAL || intent.priorityTier === PRIORITY_TIER.FORCED) &&
		(a.level === 'very_high' || a.level === 'high')) {
		const tier = intent.priorityTier;
		const value = (Number(intent.priorityValue) || 0) + Math.round(a.value * 10);
		if (strongerPriority(candidate, tier, value)) {
			setCandidatePriority(candidate, tier, value,
				(intent.type || 'INTENT') + '：' + (a.reason || '战略目标一致'));
		}
	}
	return candidate;
}

export function applyStrategicIntentToCandidates(candidates, strategicState) {
	for (const candidate of (Array.isArray(candidates) ? candidates : [])) {
		applyStrategicIntent(candidate, strategicState);
	}
	return candidates;
}
