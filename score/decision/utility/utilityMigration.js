/*
 * 无名AI · Utility Migration Map
 *
 * #39 不是一次性删除 legacy score，而是把评分链显式分层。
 * 这里记录哪些层已经进入 Utility Vector，哪些仍在 legacyBase。
 */

export const UTILITY_MIGRATION = Object.freeze({
	schemaVersion: 1,
	canonical: 'owned-utility-with-heuristic-baselines',
	shadow: 'utility-vector',
	canonicalSources: [
		{ source: 'equipReplacement', family: 'equip-replacement', dimensions: ['resource', 'resourceCost', 'risk'] },
		{ source: 'cardConsumption', family: 'card-retention-opportunity-cost', dimensions: ['opportunityCost'] },
		{ source: 'attackExpectedValue', family: 'attack-expected-value-hand-response', dimensions: ['offense', 'risk', 'resourceCost'] },
		{ source: 'decisionFeedback', family: 'feedback-and-momentum', dimensions: ['future'] },
		{ source: 'opponentContext', family: 'psychology-and-memory', dimensions: ['uncertainty'] },
		{ source: 'cardTiming', family: 'card-specific-timing', dimensions: ['future'] },
		{ source: 'areaExpectedValue', family: 'aoe-judge-equip-timing', dimensions: ['offense', 'risk'] },
		{ source: 'judgeTiming', family: 'aoe-judge-equip-timing', dimensions: ['control'] },
		{ source: 'cardBaseline', family: 'base-card-skill-target-ev', dimensions: ['resource'] },
		{ source: 'skillBaseline', family: 'base-card-skill-target-ev', dimensions: ['resource'] },
		{ source: 'fireExpectedValue', family: 'hand-inference-specialized-timing', dimensions: ['offense'] },
		{ source: 'tiesuoEvaluator', family: 'tiesuo-authoritative-evaluator', dimensions: ['control'] },
		{ source: 'threatForecast', family: 'threat-and-forecast', dimensions: ['risk'] },
		{ source: 'strategicTransition', family: 'card-specific-timing', dimensions: ['opportunityCost'] },
		{ source: 'actionDirectionGuard', family: 'target-direction-policy', dimensions: ['team'] },
		{ source: 'commonContext', family: 'common-context-suggestions', dimensions: ['team', 'future', 'resource', 'risk', 'synergy'] },
		{ source: 'versusSeatTempo', family: 'versus-seat-opportunity', dimensions: ['tempo'] },
		{ source: 'comboFallback', family: 'combo-chain', dimensions: ['synergy'] },
	],
	// 旧观察层已改为同基准建议/方向上限；无事件依据的身份隐蔽奖励退出评分。
	migratedStages: [],
	commonSuggestionSources: ['modeStrategy', 'sharedKnowledge', 'campSkillProgress', 'resourceMaximize', 'lossMinimize', 'characterPolicy'],
	retiredStageSources: ['identityExposure'],
	legacyBaseFamilies: [],
	partiallyMigratedFamilies: [],
	reviewedFamilies: ['base-card-skill-target-ev', 'optimization-overrides', 'psychology-and-memory', 'hand-inference-specialized-timing', 'card-specific-timing', 'aoe-judge-equip-timing', 'deep-value', 'rescue-special-cases', 'threat-and-forecast', 'tiesuo-authoritative-evaluator'],
	// 清理现有评分来源不等于完成所有卡牌/武将效果的期望收益模拟。
	approximateBaselines: ['cardBaseline', 'skillBaseline'],
	evidenceOnlySources: ['optimizationEvidence', 'deepValueEvidence'],
	responsePolicySources: ['taoRescuePolicy'],
	policyOnly: [
		'basic-card-skill-equip-judge-policy',
		'strategic-intent',
		'planner-policy-band',
		'guard',
	],
	postUtilityScoreSources: ['championPreference'],
	postUtilityDecision: [
		'modelIntervention',
		'champion',
		'deepThink',
	],
});

export function utilityMigrationSummary() {
	return {
		schemaVersion: UTILITY_MIGRATION.schemaVersion,
		canonical: UTILITY_MIGRATION.canonical,
		shadow: UTILITY_MIGRATION.shadow,
		migratedStageCount: UTILITY_MIGRATION.commonSuggestionSources.length + 1,
		ownedSourceCount: UTILITY_MIGRATION.canonicalSources.length,
		evidenceOnlySourceCount: UTILITY_MIGRATION.evidenceOnlySources.length,
		responsePolicySourceCount: UTILITY_MIGRATION.responsePolicySources.length,
		observedStageCount: UTILITY_MIGRATION.migratedStages.length,
		reviewedFamilyCount: UTILITY_MIGRATION.reviewedFamilies.length,
		retiredStageCount: UTILITY_MIGRATION.retiredStageSources.length,
		legacyFamilyCount: UTILITY_MIGRATION.legacyBaseFamilies.length,
		partiallyMigratedFamilyCount: UTILITY_MIGRATION.partiallyMigratedFamilies.length,
		policyOnlyCount: UTILITY_MIGRATION.policyOnly.length,
		postUtilityScoreSourceCount: UTILITY_MIGRATION.postUtilityScoreSources.length,
		postUtilityDecisionCount: UTILITY_MIGRATION.postUtilityDecision.length,
	};
}
