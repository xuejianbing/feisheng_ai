import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
	topCandidateSnapshot,
	explainTopCandidates,
	aggregateQualityBaseline,
	formatQualityBaseline,
} from '../score/verification/decisionQuality.js';
import { QUALITY_SCENARIOS } from './quality/scenarios.mjs';
import { scanHiddenInfo, compareHiddenInfoBaseline } from './quality/hidden_info_audit.mjs';

let pass = 0;
const fails = [];
function ok(cond, name, extra) {
	if (cond) { pass++; process.stdout.write('.'); }
	else { fails.push(name + (extra ? ' >> ' + extra : '')); process.stdout.write('F'); }
}
function eq(a, b, name) { ok(a === b, name, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const baseline = JSON.parse(readFileSync(join(here, 'quality', 'baseline.json'), 'utf8'));
const engineSource = ['engine/engine.js', 'context/decisionContext.js', 'context/targetContext.js', 'rules/basicRules.js', 'generation/scoredCandidates.js', 'scoring/candidateScoring.js', 'selection/plannedSelection.js', 'selection/modelReview.js', 'safety/finalCandidateGuard.js', 'feedback/executedLearning.js', 'execution/decisionEffects.js', 'scoring/scoreLedger.js', 'scoring/scoreEvents.js', 'scoring/candidateValuation.js', 'scoring/skillCandidateScore.js', 'scoring/cardCandidateScore.js', 'scoring/equipCandidateScore.js', 'records/decisionRecords.js', 'settlement/gameSettlement.js', 'feedback/decisionObservations.js', 'execution/hostHooks.js'].map(file => readFileSync(join(root, 'score/decision', file), 'utf8')).join('\n');
const traceSource = readFileSync(join(root, 'score', 'decision', 'engine', 'decisionTrace.js'), 'utf8');
const characterPolicySource = readFileSync(join(root, 'score', 'decision', 'strategy', 'characterPolicy.js'), 'utf8');
const keepStrategySource = readFileSync(join(root, 'score', 'decision', 'cardplay', 'keepStrategy.js'), 'utf8');
const keepOptSource = readFileSync(join(root, 'score', 'decision', 'cardplay', 'keepStrategyOpt.js'), 'utf8');
const discardOptSource = readFileSync(join(root, 'score', 'decision', 'cardplay', 'discardOpt.js'), 'utf8');
const actionCandidateSource = readFileSync(join(root, 'score', 'decision', 'state', 'actionCandidate.js'), 'utf8');
const utilityPipelineSource = readFileSync(join(root, 'score', 'decision', 'utility', 'utilityPipeline.js'), 'utf8');
const utilityMigrationSource = readFileSync(join(root, 'score', 'decision', 'utility', 'utilityMigration.js'), 'utf8');

function runBehavior(def) {
	const full = join(root, def.file);
	const child = spawnSync(process.execPath, [full], {
		cwd: root,
		encoding: 'utf8',
		env: Object.assign({}, process.env, { DJSC_QUALITY_JSON: '1' }),
	});
	const stdout = String(child.stdout || '');
	const stderr = String(child.stderr || '');
	const line = stdout.split(/\r?\n/).find(function (x) { return x.startsWith('@@DJSC_QUALITY@@'); });
	let parsed = null;
	try { parsed = line ? JSON.parse(line.slice('@@DJSC_QUALITY@@'.length)) : null; } catch (_) {}
	return {
		id: def.id,
		title: def.title,
		status: child.status,
		signal: child.signal,
		cases: parsed && Array.isArray(parsed.cases) ? parsed.cases : [],
		passed: parsed ? parsed.passed : 0,
		failed: parsed ? parsed.failed : 1,
		stdout: stdout,
		stderr: stderr,
	};
}

/* ===== A. 固定行为场景 ===== */
const knownBehaviorDebt = Array.isArray(baseline.knownBehaviorDebt) ? baseline.knownBehaviorDebt : [];
const behaviorDebtKeys = new Set(knownBehaviorDebt.map(function (x) {
	return String(x.suite || '') + '|' + String(x.case || '');
}));
const suiteResults = QUALITY_SCENARIOS.map(runBehavior);
const unexpectedBehaviorFailures = [];
const resolvedBehaviorDebt = [];

for (const result of suiteResults) {
	ok(result.cases.length > 0, '10.62 场景有机器可读断言 ' + result.id);
	const failedCases = result.cases.filter(function (x) { return x && !x.ok; });
	const unexpected = failedCases.filter(function (x) {
		return !behaviorDebtKeys.has(result.id + '|' + String(x.name || ''));
	});
	if (unexpected.length) unexpectedBehaviorFailures.push.apply(unexpectedBehaviorFailures,
		unexpected.map(function (x) { return { suite: result.id, case: x.name, extra: x.extra }; }));
	eq(unexpected.length, 0, '10.62 场景无新增失败 ' + result.id);

	if (result.status !== 0 && failedCases.length === 0) {
		ok(false, '10.62 场景进程异常 ' + result.id, result.stderr || result.stdout.slice(-1200));
	}
}

for (const debt of knownBehaviorDebt) {
	const suite = suiteResults.find(function (x) { return x.id === debt.suite; });
	const stillFailing = !!(suite && suite.cases.some(function (x) {
		return !x.ok && x.name === debt.case;
	}));
	if (!stillFailing) resolvedBehaviorDebt.push(debt);
}

/* ===== B. Top-N 候选解释契约 ===== */
const synthetic = {
	winner: {
		type: 'card', id: 'sha', target: '反贼A', score: 9.4,
		reason: '确定斩杀窗口',
		policy: { eligible: true, priorityTier: 'forced', priorityValue: 100, priorityReason: '确定斩杀' },
	},
	candidates: [
		{ type: 'card', id: 'sha', target: '反贼A', score: 9.4, reason: '重复winner' },
		{ type: 'card', id: 'guohe', target: '反贼B', score: 5.1, reason: '拆除关键装备' },
		{ type: 'end', id: 'end', target: null, score: 1.2, reason: '保留资源' },
	],
};
const top = topCandidateSnapshot(synthetic, 3);
eq(top.length, 3, '10.62 Top-N去重后保留3个候选');
eq(top[0].id, 'sha', '10.62 Top-N第一名必须是最终winner');
eq(top[0].priorityTier, 'forced', '10.62 Top-N保留策略优先级');
ok(explainTopCandidates(synthetic, 3)[0].includes('确定斩杀'),
	'10.62 Top-N解释保留priority/reason');

/* ===== C. 隐藏信息审计：已知债务可见，但不得新增 ===== */
const hiddenFindings = scanHiddenInfo(root);
const hiddenAudit = compareHiddenInfoBaseline(hiddenFindings, baseline);
if (hiddenAudit.unexpected.length) {
	process.stdout.write('\nUnexpected hidden-info findings:\n');
	for (const f of hiddenAudit.unexpected) {
		process.stdout.write('- ' + f.path + ':' + f.line + ' ' + f.excerpt + '\n');
	}
}
eq(hiddenAudit.unexpected.length, 0,
	'10.62 不得新增未登记隐藏信息精确读取');
ok(hiddenAudit.known.length === baseline.knownHiddenInfoDebt.length,
	'10.62 已知隐藏信息债务保持可见且数量稳定',
	'known=' + hiddenAudit.known.length + ' baseline=' + baseline.knownHiddenInfoDebt.length);

/* 已知债务若被修掉是进步，不应失败；这里只明确打印。 */
if (hiddenAudit.resolved.length) {
	process.stdout.write('\n[quality] resolved hidden-info debt: ' +
		hiddenAudit.resolved.map(function (x) { return x.id; }).join(', ') + '\n');
}

/* ===== D. 汇总质量基线 ===== */
const report = aggregateQualityBaseline(suiteResults, QUALITY_SCENARIOS, hiddenAudit);
ok(report.cases > 0, '10.62 基线存在有效行为断言');
eq(unexpectedBehaviorFailures.length, 0, '10.62 已覆盖行为场景不得出现新增回归');
eq(report.hiddenInfo.newFindings, 0, '10.62 隐藏信息技术债不得扩散');

const expectedDimensions = [
	'identity', 'allySafety', 'resource', 'cardStrategy', 'tactics',
	'consistency', 'response', 'team', 'control', 'strategy', 'character', 'utility',
];
for (const dim of expectedDimensions) {
	ok(report.dimensions[dim] && report.dimensions[dim].cases > 0,
		'10.62 质量基线覆盖维度 ' + dim);
}

/* #37 战略层必须真正接入主决策链，但不得直接重写 raw score。 */
ok(engineSource.includes("getStrategicState(me)") &&
	engineSource.includes("applyStrategicIntentToCandidates(acts, strategicState)"),
	'10.62 Unified Objective已接入bestAction候选排序前');
ok(engineSource.indexOf("applyStrategicIntentToCandidates(acts, strategicState)") <
	engineSource.indexOf("acts.sort(compareActionCandidates)"),
	'10.62 Strategic Intent在canonical排序前应用');
ok(traceSource.includes("strategyText(entry.strategy)") && traceSource.includes("战略："),
	'10.62 Decision Trace展示Role Objective与Intent');
ok(engineSource.includes('Strategic Policy Barrier') &&
	engineSource.includes('sameCandidatePolicyBand(strategicTop, best)'),
	'10.62 Champion/DeepThink不得跨越CRITICAL/FORCED战略职责');
ok(engineSource.includes('applyCharacterPolicyToCandidates(me, acts, characterPolicy)'),
	'10.62 Character Policy已接入候选utility链');
ok(engineSource.indexOf('applyCharacterPolicyToCandidates(me, acts, characterPolicy)') <
	engineSource.indexOf('applyStrategicIntentToCandidates(acts, strategicState)'),
	'10.62 武将画像必须先于Strategic Intent生效');
ok(!characterPolicySource.includes('setCandidatePriority') &&
	!characterPolicySource.includes('vetoCandidate'),
	'10.62 Character Policy不得修改priority/veto边界');
ok(engineSource.includes("heroId: (me && (me.name1 || me.name)) || ''") &&
	!engineSource.includes("heroId: (game && game.me"),
	'10.62 Champion heroId必须绑定当前实际行动者');
ok(keepStrategySource.includes('characterFuelKeepBonus') &&
	keepOptSource.includes('characterFuelKeepBonus') &&
	discardOptSource.includes('characterFuelKeepBonus'),
	'10.62 武将资源燃料已接入留牌与弃牌链');
ok(traceSource.includes('武将画像：') && traceSource.includes('characterText(entry.characterPolicy)'),
	'10.62 Decision Trace展示武将画像');
ok(engineSource.includes('initializeUtilityPipeline(acts)') &&
	engineSource.includes("trackUtilityStage(acts, 'modeStrategy', 'team'") &&
	engineSource.includes("trackUtilityStage(acts, 'characterPolicy', 'synergy'") &&
	engineSource.includes('finalizeUtilityPipeline(acts)'),
	'10.62 Unified Utility Pipeline已接入主决策链');
ok(engineSource.indexOf('initializeUtilityPipeline(acts)') <
	engineSource.indexOf("trackUtilityStage(acts, 'modeStrategy', 'team'") &&
	engineSource.indexOf("trackUtilityStage(acts, 'characterPolicy', 'synergy'") <
	engineSource.indexOf('applyStrategicIntentToCandidates(acts, strategicState)'),
	'10.62 Utility迁移阶段位于Strategic Intent之前');
ok(actionCandidateSource.includes('Number(b && b.score)') &&
	actionCandidateSource.includes('Number(a && a.score)') &&
	!actionCandidateSource.includes('shadowUtility'),
	'10.62 canonical排序仍使用legacy score而非shadowUtility');
ok(utilityPipelineSource.includes('trackUtilityStage') &&
	utilityPipelineSource.includes('utilityParity'),
	'10.62 Utility Pipeline提供逐段跟踪与对账');
ok(utilityMigrationSource.includes("canonical: 'legacy-score'") &&
	utilityMigrationSource.includes("shadow: 'utility-vector'") &&
	utilityMigrationSource.includes("'card-specific-timing'"),
	'10.62 Utility迁移边界明确且未伪称专项牌已迁移');
ok(traceSource.includes('收益向量：') && traceSource.includes('utilitySummaryText'),
	'10.62 Decision Trace展示Utility Vector与对账信息');

process.stdout.write('\n\n' + formatQualityBaseline(report) + '\n');
process.stdout.write('known behavior debt: ' + knownBehaviorDebt.length +
	', new regressions=' + unexpectedBehaviorFailures.length +
	', resolved=' + resolvedBehaviorDebt.length + '\n');
if (knownBehaviorDebt.length) {
	process.stdout.write('\nKnown behavior debt:\n');
	for (const d of knownBehaviorDebt) process.stdout.write('- ' + d.suite + ' :: ' + d.case + '\n');
}
if (hiddenAudit.known.length) {
	process.stdout.write('\nKnown hidden-info debt:\n');
	for (const f of hiddenAudit.known) {
		process.stdout.write('- ' + f.path + ':' + f.line + ' ' + f.excerpt + '\n');
	}
}

process.stdout.write('\n');
if (fails.length) {
	console.error('\n❌ #36 decision quality baseline failed: ' + fails.length + ' / ' + (pass + fails.length));
	for (const f of fails) console.error('  FAIL ' + f);
	process.exitCode = 1;
} else {
	console.log('\n✅ #36 decision quality baseline passed: ' + pass + ' contract assertions');
}
