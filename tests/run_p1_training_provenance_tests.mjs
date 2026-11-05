import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const engine = readFileSync(new URL('score/decision/engine/engine.js', root), 'utf8');
const sampleBlock = engine.slice(engine.indexOf('/* ★ 训练样本人样'), engine.indexOf('/* ★ 决策后检测'));
const postCheckBlock = engine.slice(engine.indexOf('/* ★ 决策后检测'), engine.indexOf('/* ★ 事务只随返回值携带'));
const failures = [];
function check(condition, name) { if (!condition) failures.push(name); }

check(/trainRecordSample\(me,\s*best,/.test(sampleBlock), '已提交动作仍写训练样本');
check(!/trainRecordSample\(me,\s*aN,/.test(sampleBlock), '未执行负分候选不得写入真实样本');
check(!/action:\s*a,/.test(postCheckBlock), '未执行候选不得进入结算回填队列');
if (failures.length) {
	console.error('FAIL ' + failures.join('\nFAIL '));
	process.exitCode = 1;
} else console.log('P1 training provenance: 3 checks passed');
