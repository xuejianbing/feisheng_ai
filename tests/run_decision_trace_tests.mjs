import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let pass = 0;
const fails = [];
function ok(cond, name, extra) {
	if (cond) { pass++; process.stdout.write('.'); }
	else { fails.push(name + (extra ? ' >> ' + extra : '')); process.stdout.write('F'); }
}
function eq(a, b, name) { ok(a === b, name, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const trace = await import(pathToFileURL(join(root, 'score', 'decision', 'engine', 'decisionTrace.js')).href + '?test=4.0.4');

eq(trace.decisionLatencyBand(999).level, 'normal', '10.53 999ms 仍为正常');
eq(trace.decisionLatencyBand(1000).level, 'slow', '10.53 1000ms 标记慢');
eq(trace.decisionLatencyBand(4999).level, 'slow', '10.53 4999ms 仍为慢');
eq(trace.decisionLatencyBand(5000).level, 'severe', '10.53 5000ms 标记严重慢');

const entry = {
	player: '测试武将',
	round: 3,
	elapsedMs: 20341,
	winner: { type:'card', id:'sha', target:'SP刘备', score:8.42, reason:'当前最高收益目标' },
	candidates: [
		{ type:'card', id:'sha', target:'SP刘备', score:8.42, reason:'当前最高收益目标' },
		{ type:'card', id:'guohe', target:'曹操', score:5.17, reason:'拆除资源' },
		{ type:'card', id:'lebu', target:'孙权', score:4.63, reason:'控制收益' },
	],
	layers: {
		tempo: { stage:'mid' },
		risk: { label:'medium' },
		team: { focus:'SP刘备' },
		multiturn: { overall:'stable' },
	},
	phaseMs: {
		planner: 7428,
		candidates: 531,
		telemetry: 472,
		targets: 126,
		context: 42,
	},
};
const tr = id => ({ sha:'杀', guohe:'过河拆桥', lebu:'乐不思蜀' }[id] || id);

eq(trace.buildDecisionTraceLines(entry, '关闭', tr).length, 0,
	'10.53 关闭模式不输出左侧决策日志');

const summary = trace.buildDecisionTraceLines(entry, '摘要', tr);
eq(summary.length, 1, '10.53 摘要模式只输出一行，避免刷屏');
ok(summary[0].includes('杀→SP刘备') && summary[0].includes('过河拆桥→曹操'),
	'10.53 摘要同时显示最终与次选');
ok(summary[0].includes('20341ms') && summary[0].includes('严重慢'),
	'10.53 摘要直接暴露严重慢决策');
ok(summary[0].includes('差:+3.25'),
	'10.53 摘要显示最终与次选分差');

const detail = trace.buildDecisionTraceLines(entry, '详细', tr);
ok(detail.length >= 4, '10.53 详细模式提供多行决策路径');
ok(detail.some(x => x.includes('候选：') && x.includes('1.杀→SP刘备') && x.includes('2.过河拆桥→曹操')),
	'10.53 详细模式列出前三候选');
ok(detail.some(x => x.includes('阶段=mid') && x.includes('风险=medium') && x.includes('集火=SP刘备')),
	'10.53 详细模式显示关键策略信号');
ok(detail.some(x => x.includes('性能：') && x.includes('planner=7428ms') && x.includes('candidates=531ms')),
	'10.53 详细模式显示按耗时排序的性能热点');

const engine = readFileSync(join(root, 'score', 'decision', 'engine', 'engine.js'), 'utf8') +
    readFileSync(join(root, 'score/decision/execution/decisionEffects.js'), 'utf8') +
    readFileSync(join(root, 'score/decision/records/decisionRecords.js'), 'utf8');
const config = readFileSync(join(root, 'js', 'config', 'config.js'), 'utf8');
const schema = await import(pathToFileURL(join(root, 'js', 'config', 'configSchema.js')).href + '?test=4.0.8');
const panel = readFileSync(join(root, 'score', 'view', 'panel', 'panel.js'), 'utf8');

ok(config.includes("testDecisionLog:") && schema.CONFIG_ITEMS.testDecisionLog.default === '摘要',
	'10.53 测试版默认开启摘要决策日志（默认值来自Schema）');
ok(schema.CONFIG_SECTIONS.some(s => s.id === 'player_report' && s.entries.includes('testDecisionLog')) &&
	schema.CONFIG_ITEMS.testDecisionLog.description.includes('测试版决策可观测性'),
	'10.53 决策日志由Schema归入战报与回放分组');
ok(engine.includes("cfg('testDecisionLog', '摘要')"),
	'10.53 engine 只通过配置开关决定是否显示测试日志');
ok(engine.includes("_deferEffect('decision-trace'") &&
	engine.includes('_finalizeDecisionRecord(me, acts, best, _decisionMs, _phaseMs)'),
	'10.53 决策日志延迟到真实 Commit 后写入');
ok(engine.includes('_finalResult.decisionMs = Math.round(_decisionMs)'),
	'10.53 最终结果暴露只读 decisionMs 性能诊断');
ok(engine.includes('createDecisionTransaction') && engine.includes('__djscTransaction'),
	'10.53 bestAction 返回不可枚举决策事务，不在 Evaluate 阶段直接学习');
ok(engine.includes("perfMark('bestAction.cache'") && engine.includes("profEnd('bestAction')"),
	'10.53 bestAction 缓存短路也闭合 profiler 计时栈');
ok(engine.indexOf("/* ===== ★ 模型护栏：执行前的最后一道法律检查 ===== */") <
   engine.indexOf("perfMark('bestAction', _decisionMs)"),
	'10.53 正常 bestAction 计时延伸到护栏和后处理之后');
ok(engine.includes('target: candidateTargetValue(c)'),
	'10.53 决策快照保存规范化目标而非对象引用');
ok(panel.includes('决策耗时：') && panel.includes("item.winner.target"),
	'10.53 决策回放面板显示目标和耗时');
ok(!/\.score\s*=/.test(readFileSync(join(root, 'score', 'decision', 'engine', 'decisionTrace.js'), 'utf8')),
	'10.53 decisionTrace 模块不改写候选 score');

process.stdout.write('\n');
if (fails.length) {
	console.error('\n❌ #30 decision trace contract failed: ' + fails.length + ' / ' + (pass + fails.length));
	for (const f of fails) console.error('  FAIL ' + f);
	process.exitCode = 1;
} else {
	console.log('\n✅ #30 decision trace contract passed: ' + pass + ' assertions');
}
