import {
	createDecisionTransaction,
	stageDecisionTransaction,
	peekDecisionTransaction,
	commitDecisionTransaction,
	cancelDecisionTransaction,
	decisionTransactionStats,
	resetDecisionTransactionStats,
} from '../score/decision/state/decisionTransaction.js';

let pass = 0;
const fails = [];
function ok(cond, name, extra) {
	if (cond) { pass++; process.stdout.write('.'); }
	else { fails.push(name + (extra ? ' >> ' + extra : '')); process.stdout.write('F'); }
}
function eq(a, b, name) { ok(a === b, name, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

resetDecisionTransactionStats();

const player = {};
let committed = 0;
let lastActual = null;

const tx1 = createDecisionTransaction(
	{ type: 'card', id: 'sha', target: '敌A' },
	function (actual) { committed++; lastActual = actual; },
	{ meta: { case: 'exact' } }
);
eq(tx1.state, 'evaluated', '10.59 create 只生成 evaluated，不自动提交');
eq(committed, 0, '10.59 Evaluate 阶段副作用为 0');

stageDecisionTransaction(player, tx1);
eq(peekDecisionTransaction(player).id, tx1.id, '10.59 stage 后存在 pending 事务');
eq(committed, 0, '10.59 Stage 阶段仍不执行副作用');

/* 不同宿主事件类型不应误伤，例如 card 内部先触发 logSkill。 */
const differentType = commitDecisionTransaction(player, { type: 'skill', id: 'foo' });
eq(differentType.reason, 'different-type', '10.59 不同类型事件不取消 card 事务');
eq(peekDecisionTransaction(player).id, tx1.id, '10.59 different-type 后 pending 仍保留');

/* 同类型但动作不同，说明宿主实际没有执行推荐动作：事务必须作废。 */
const mismatch = commitDecisionTransaction(player, { type: 'card', id: 'shan', target: '敌A' });
eq(mismatch.reason, 'id-mismatch', '10.59 实际动作不同则 mismatch');
eq(peekDecisionTransaction(player), null, '10.59 mismatch 后 pending 清除');
eq(committed, 0, '10.59 mismatch 不产生学习/日志副作用');

const tx2 = createDecisionTransaction(
	{ type: 'card', id: 'sha', target: '敌A' },
	function (actual) { committed++; lastActual = actual; }
);
stageDecisionTransaction(player, tx2);
stageDecisionTransaction(player, tx2); // 幂等重复 stage
const exact = commitDecisionTransaction(player, { type: 'card', id: 'sha', target: '敌A' });
eq(exact.ok, true, '10.59 推荐动作真实执行后 commit 成功');
eq(committed, 1, '10.59 commit 回调只执行一次');
eq(lastActual.id, 'sha', '10.59 commit 收到真实动作');
eq(peekDecisionTransaction(player), null, '10.59 commit 后 pending 清除');

const again = commitDecisionTransaction(player, { type: 'card', id: 'sha', target: '敌A' });
eq(again.reason, 'no-pending', '10.59 同一事务不可重复提交');
eq(committed, 1, '10.59 重复宿主事件不会重复学习');

/* engine 缓存可能再次返回同一结果对象：已提交事务绝不能复活。 */
eq(stageDecisionTransaction(player, tx2), null, '10.59 committed 事务不可重新 stage');
eq(tx2.state, 'committed', '10.59 committed 终态不会被 TTL/stage 改写');
eq(peekDecisionTransaction(player), null, '10.59 committed 事务不会重新进入 pending');

const tx3 = createDecisionTransaction(
	{ type: 'card', id: 'guohe', target: '敌B' },
	function () { committed++; }
);
stageDecisionTransaction(player, tx3);
const targetMismatch = commitDecisionTransaction(player, { type: 'card', id: 'guohe', target: '敌C' });
eq(targetMismatch.reason, 'target-mismatch', '10.59 同牌不同目标不冒充同一决策');
eq(committed, 1, '10.59 目标不匹配不执行副作用');

const tx4 = createDecisionTransaction({ type: 'skill', id: 'skill_x', target: null }, function () { committed++; });
stageDecisionTransaction(player, tx4);
eq(cancelDecisionTransaction(player, 'host-fallback'), true, '10.59 宿主 fallback 可显式取消事务');
eq(peekDecisionTransaction(player), null, '10.59 cancel 后 pending 清除');
eq(committed, 1, '10.59 cancel 不执行副作用');

const stats = decisionTransactionStats();
ok(stats.evaluated >= 4, '10.59 stats 记录 evaluated');
ok(stats.staged >= 4, '10.59 stats 记录 staged');
eq(stats.committed, 1, '10.59 stats 只计真实 commit');
ok(stats.mismatched >= 2, '10.59 stats 记录 mismatch');
ok(stats.cancelled >= 1, '10.59 stats 记录 cancel');

/* 新事务会替换旧 pending，旧事务明确标记 superseded。 */
const tx5 = createDecisionTransaction({ type: 'card', id: 'sha' }, function () {});
const tx6 = createDecisionTransaction({ type: 'card', id: 'tao' }, function () {});
stageDecisionTransaction(player, tx5);
stageDecisionTransaction(player, tx6);
eq(tx5.state, 'superseded', '10.59 新评估事务替换旧 pending');
eq(peekDecisionTransaction(player).id, tx6.id, '10.59 pending 指向最新事务');

/* 生命周期重置不仅清统计，也必须清跨局 pending。 */
resetDecisionTransactionStats();
eq(peekDecisionTransaction(player), null, '10.59 reset 清除跨局 pending');
const resetStats = decisionTransactionStats();
eq(resetStats.evaluated, 0, '10.59 reset 清零事务统计');
eq(resetStats.committed, 0, '10.59 reset 清零 commit 统计');

process.stdout.write('\n');
if (fails.length) {
	console.error('\n❌ #33 decision transaction contract failed: ' + fails.length + ' / ' + (pass + fails.length));
	for (const f of fails) console.error('  FAIL ' + f);
	process.exitCode = 1;
} else {
	console.log('\n✅ #33 decision transaction contract passed: ' + pass + ' assertions');
}
