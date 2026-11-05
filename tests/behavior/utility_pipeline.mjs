import { ok, eq, finish } from './_harness.mjs';
import {
	makeActionCandidate,
	compareActionCandidates,
} from '../../score/decision/state/actionCandidate.js';
import {
	ensureUtilityVector,
	recordUtilityContribution,
	utilitySnapshot,
} from '../../score/decision/utility/utilityVector.js';
import {
	initializeUtilityPipeline,
	trackUtilityStage,
	finalizeUtilityPipeline,
	utilityParity,
} from '../../score/decision/utility/utilityPipeline.js';
import { utilityDimensionLines, utilitySummaryText } from '../../score/decision/utility/utilityExplain.js';
import { UTILITY_MIGRATION, utilityMigrationSummary } from '../../score/decision/utility/utilityMigration.js';

/* 初始化只观察，不改 canonical score。 */
{
	const a = makeActionCandidate({ type: 'card', id: 'sha', target: 'enemy', score: 10 });
	initializeUtilityPipeline([a]);
	eq(a.score, 10, '10.65 Utility初始化不改candidate.score');
	const v = utilitySnapshot(a);
	eq(v.legacyBase, 10, '10.65 初始化把当前分记录为legacyBase');
	eq(v.shadowUtility, 10, '10.65 无贡献时shadow等于legacyBase');
	eq(v.residual, 0, '10.65 初始化对账残差为0');
	ok(Object.keys(a).indexOf('utilityVector') < 0, '10.65 utilityVector默认不污染候选枚举字段');
}

/* 通用层before/after逐段映射到语义维度，且精确重建canonical。 */
{
	const a = makeActionCandidate({ type: 'card', id: 'sha', target: 'enemy', score: 10 });
	initializeUtilityPipeline([a]);
	trackUtilityStage([a], 'modeStrategy', 'team', function () {
		a.score += 2;
	});
	trackUtilityStage([a], 'resourceMaximize', 'resource', function () {
		a.score += 1.5;
	});
	trackUtilityStage([a], 'lossMinimize', 'risk', function () {
		a.score -= 3;
	});
	finalizeUtilityPipeline([a]);

	const v = utilitySnapshot(a);
	eq(a.score, 10.5, '10.65 Pipeline保持原callback真实分值');
	eq(v.dimensions.team, 2, '10.65 modeStrategy进入team维度');
	eq(v.dimensions.resource, 1.5, '10.65 resourceMaximize进入resource维度');
	eq(v.dimensions.risk, -3, '10.65 lossMinimize进入risk维度');
	eq(v.shadowUtility, 10.5, '10.65 shadow精确重建统一后处理后的canonical');
	eq(v.residual, 0, '10.65 已跟踪通用层残差为0');
	ok(utilityParity(a).ok, '10.65 双轨对账通过');
}

/* legacyResidual 显式承接尚未迁移的规则，不伪装成已分类维度。 */
{
	const a = makeActionCandidate({ type: 'skill', id: 'legacySkill', score: 5 });
	initializeUtilityPipeline([a]);
	trackUtilityStage([a], 'basicRules', 'legacyResidual', function () {
		a.score += 0.75;
	});
	const v = utilitySnapshot(a);
	eq(v.dimensions.legacyResidual, 0.75, '10.65 未迁移规则显式进入legacyResidual');
	eq(v.dimensions.offense, 0, '10.65 未迁移规则不会伪装成offense');
}

/* 未知dimension必须安全回落legacyResidual。 */
{
	const a = makeActionCandidate({ type: 'card', id: 'x', score: 2 });
	ensureUtilityVector(a);
	recordUtilityContribution(a, {
		source: 'unknown-stage',
		dimension: 'not-a-real-dimension',
		before: 2,
		after: 3,
	});
	const v = utilitySnapshot(a);
	eq(v.dimensions.legacyResidual, 1, '10.65 非法维度回落legacyResidual');
}

/* callback异常也只做finally观测，不吞异常、不二次执行。 */
{
	const a = makeActionCandidate({ type: 'card', id: 'x', score: 4 });
	let calls = 0, caught = false;
	try {
		trackUtilityStage([a], 'test-error', 'risk', function () {
			calls++;
			a.score -= 1;
			throw new Error('boom');
		});
	} catch (e) {
		caught = e.message === 'boom';
	}
	eq(calls, 1, '10.65 Utility stage异常不重复执行callback');
	ok(caught, '10.65 Utility stage保持原异常语义');
	eq(utilitySnapshot(a).dimensions.risk, -1, '10.65 异常前已发生改分仍可审计');
}

/* Utility Vector 当前是shadow，不得改变winner。 */
{
	const a = makeActionCandidate({ type: 'card', id: 'a', score: 8 });
	const b = makeActionCandidate({ type: 'card', id: 'b', score: 6 });
	initializeUtilityPipeline([a, b]);
	/* 给b写很高的解释维度，但不修改score。 */
	recordUtilityContribution(b, {
		source: 'explain-only',
		dimension: 'offense',
		before: 6,
		after: 16,
	});
	/* 回到真实canonical，形成明确residual，证明解释向量没有接管排序。 */
	b.score = 6;
	const sorted = [a, b].sort(compareActionCandidates);
	eq(sorted[0], a, '10.65 winner仍由canonical score/policy决定');
	ok(!utilityParity(b).ok, '10.65 shadow与canonical分歧会显式产生parity失败');
}

/* 解释输出必须显示维度与残差语义。 */
{
	const a = makeActionCandidate({ type: 'card', id: 'sha', score: 7 });
	initializeUtilityPipeline([a]);
	trackUtilityStage([a], 'characterPolicy', 'synergy', function () { a.score += 0.7; });
	const snap = utilitySnapshot(a);
	ok(utilityDimensionLines(snap, 8).some(function (x) { return x.indexOf('协同') >= 0; }),
		'10.65 Utility解释展示中文维度');
	ok(utilitySummaryText(snap).indexOf('shadow') >= 0 &&
		utilitySummaryText(snap).indexOf('对账✓') >= 0,
		'10.65 Utility摘要展示shadow与对账状态');
}

/* 迁移地图必须明确canonical仍是legacy-score，禁止伪称已完成全量迁移。 */
{
	const m = utilityMigrationSummary();
	eq(m.canonical, 'legacy-score', '10.65 #39第一阶段canonical明确仍为legacy-score');
	eq(m.shadow, 'utility-vector', '10.65 Utility Vector明确为shadow');
	ok(m.migratedStageCount >= 8, '10.65 至少8个通用后处理阶段进入Utility Vector');
	ok(UTILITY_MIGRATION.legacyBaseFamilies.includes('card-specific-timing'),
		'10.65 专项牌时机明确保留在legacyBase');
	ok(UTILITY_MIGRATION.policyOnly.includes('guard'),
		'10.65 Guard明确属于policy/safety而非utility');
}

finish('utility_pipeline');
