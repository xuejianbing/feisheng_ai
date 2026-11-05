/*
 * 无名AI · Utility Migration Map
 *
 * #39 不是一次性删除 legacy score，而是把评分链显式分层。
 * 这里记录哪些层已经进入 Utility Vector，哪些仍在 legacyBase。
 */

export const UTILITY_MIGRATION = Object.freeze({
	schemaVersion: 1,
	canonical: 'legacy-score',
	shadow: 'utility-vector',
	migratedStages: [
		{ source: 'modeStrategy', dimension: 'team' },
		{ source: 'identityExposure', dimension: 'uncertainty' },
		{ source: 'actionDirectionGuard', dimension: 'team' },
		{ source: 'sharedKnowledge', dimension: 'team' },
		{ source: 'campSkillProgress', dimension: 'future' },
		{ source: 'resourceMaximize', dimension: 'resource' },
		{ source: 'lossMinimize', dimension: 'risk' },
		{ source: 'characterPolicy', dimension: 'synergy' },
	],
	legacyBaseFamilies: [
		'base-card-skill-target-ev',
		'optimization-overrides',
		'psychology-and-memory',
		'combo-chain',
		'hand-inference',
		'card-specific-timing',
		'aoe-judge-equip-timing',
		'deep-value',
		'rescue-special-cases',
		'threat-and-forecast',
		'feedback-and-momentum',
		'tiesuo-authoritative-evaluator',
		'equip-replacement',
	],
	policyOnly: [
		'basic-card-skill-equip-judge-policy',
		'strategic-intent',
		'planner-policy-band',
		'guard',
	],
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
		migratedStageCount: UTILITY_MIGRATION.migratedStages.length,
		legacyFamilyCount: UTILITY_MIGRATION.legacyBaseFamilies.length,
		policyOnlyCount: UTILITY_MIGRATION.policyOnly.length,
		postUtilityDecisionCount: UTILITY_MIGRATION.postUtilityDecision.length,
	};
}
