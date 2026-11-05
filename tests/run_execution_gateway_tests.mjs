import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	EXECUTION_KINDS,
	createExecutionGatewayCore,
} from '../score/decision/execution/executionGatewayCore.js';
import {
	createDecisionTransaction,
	stageDecisionTransaction,
	commitDecisionTransaction,
	cancelDecisionTransaction,
	resetDecisionTransactionStats,
	peekDecisionTransaction,
} from '../score/decision/state/decisionTransaction.js';

let currentPhase = null;
const gateway = createExecutionGatewayCore({
	config: function (_key, fallback) { return fallback; },
	isTripped: function () { return false; },
	trip: function () {},
	getGameMe: function () { return null; },
	getCurrentPhase: function () { return currentPhase; },
	stageTransaction: stageDecisionTransaction,
	commitTransaction: commitDecisionTransaction,
	cancelTransaction: cancelDecisionTransaction,
	peekTransaction: peekDecisionTransaction,
});

const {
	executionEligibility,
	invokeHost,
	invokeObservedHost,
	stageExecutionDecision,
	commitExecution,
	confirmExecutionFromHostEvent,
	cancelExecution,
	executionGatewayStats,
	resetExecutionGateway,
} = gateway;

let pass = 0;
const fails = [];
function ok(cond, name, extra) {
	if (cond) { pass++; process.stdout.write('.'); }
	else { fails.push(name + (extra ? ' >> ' + extra : '')); process.stdout.write('F'); }
}
function eq(a, b, name) { ok(a === b, name, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

resetExecutionGateway();
resetDecisionTransactionStats();

const player = {};
const event = {};
let gate = executionEligibility('use', player, event, {
	requireHardOverride: false,
	checkCircuit: false,
});
ok(gate.ok, '10.61 Gateway允许普通AI执行请求');

gate = executionEligibility('respond', player, { __sentinel: true }, {
	requireHardOverride: false,
	checkCircuit: false,
	sentinel: '__sentinel',
});
eq(gate.ok, false, '10.61 Gateway统一拒绝已接管哨兵事件');
eq(gate.reason, 'already-overridden', '10.61 哨兵拒绝原因稳定');

gate = executionEligibility('discard', player, event, {
	requireHardOverride: false,
	checkCircuit: false,
	extraGuard: () => 'test-guard',
});
eq(gate.reason, 'test-guard', '10.61 Gateway支持场景专属额外守卫');

/* 监督调用：无论结果如何，宿主只调用一次。 */
let observedCalls = 0;
const observed = invokeObservedHost({
	orig: function () { observedCalls++; return { event: 'native' }; },
	thisArg: player,
	args: [],
	decisionPoint: 'chooseTarget',
});
ok(observed.ok, '10.61 observer宿主调用成功');
eq(observedCalls, 1, '10.61 observer绝不重复执行宿主');
eq(observed.result.event, 'native', '10.61 observer保持宿主原结果');

/* 主执行成功：prepare 生效，cleanupOnSuccess=true 时恢复。 */
let hostCalls = 0;
let prepared = false;
let cleaned = false;
const success = invokeHost({
	kind: EXECUTION_KINDS.USE,
	player,
	orig: function () { hostCalls++; return 'ok'; },
	thisArg: player,
	args: [],
	prepare: function () {
		prepared = true;
		return function () { cleaned = true; };
	},
	cleanupOnSuccess: true,
});
ok(success.ok && prepared && cleaned, '10.61 Gateway统一prepare/cleanup成功路径');
eq(hostCalls, 1, '10.61 正常Host调用只执行一次');

/* 主执行异常：先清理，但绝不在同一事件第二次调用宿主。
 * fallback 的含义是该层进入 degrade/circuit，后续事件退回原生。 */
hostCalls = 0;
cleaned = false;
const recovered = invokeHost({
	kind: EXECUTION_KINDS.COMPARE,
	player,
	orig: function () {
		hostCalls++;
		throw new Error('boom');
	},
	thisArg: player,
	args: [],
	prepare: function () {
		return function () { cleaned = true; };
	},
	failureReason: 'test failure',
});
eq(recovered.fallback, true, '10.61 Host异常进入统一降级');
eq(recovered.reason, 'degraded-next-call', '10.61 当前事件不重入宿主');
eq(hostCalls, 1, '10.61 异常路径宿主仍最多调用一次');
ok(cleaned, '10.61 降级前先恢复临时宿主改写');

const degradedGate = executionEligibility('compare', player, event, {
	requireHardOverride: false,
	checkCircuit: false,
});
eq(degradedGate.reason, 'degraded', '10.61 Host异常后后续事件进入短时降级');

/* Transaction Stage/Commit/Cancel 统一经 Gateway。 */
let committed = 0;
const tx = createDecisionTransaction(
	{ type: 'card', id: 'sha', target: '敌A' },
	function () { committed++; },
	{ ttl: 5000 }
);
const decision = {};
Object.defineProperty(decision, '__djscTransaction', { value: tx, enumerable: false });
ok(!!stageExecutionDecision(player, decision, 'use'), '10.61 Gateway统一Stage事务');
eq(peekDecisionTransaction(player).id, tx.id, '10.61 Stage后pending正确');
const commit = commitExecution(player, { type: 'card', id: 'sha', target: '敌A' });
ok(commit.ok, '10.61 Gateway统一Commit事务');
eq(committed, 1, '10.61 Commit副作用只执行一次');

/* P1：函数正常返回不等于动作实际生效；只有完成且未取消的宿主 GameEvent 才可 Commit。 */
const txConfirmed = createDecisionTransaction({ type: 'card', id: 'sha', target: '敌A' }, function () { committed++; });
const decisionConfirmed = {};
Object.defineProperty(decisionConfirmed, '__djscTransaction', { value: txConfirmed, enumerable: false });
stageExecutionDecision(player, decisionConfirmed, 'use');
const plainReturn = await confirmExecutionFromHostEvent(player,
	{ type: 'card', id: 'sha', target: '敌A' }, { ok: true }, { eventName: 'useCard' });
eq(plainReturn.reason, 'host-event-unconfirmed', 'P1 普通函数返回不能证明游戏动作生效');
eq(committed, 1, 'P1 无完成事件时不得Commit');

const completedEvent = {
	name: 'useCard', player: player, finished: false, _cancelled: false,
	then: function (resolve) { this.finished = true; resolve(); },
};
const confirmed = await confirmExecutionFromHostEvent(player,
	{ type: 'card', id: 'sha', target: '敌A' }, completedEvent, { eventName: 'useCard' });
ok(confirmed.ok, 'P1 完成且未取消的匹配GameEvent可以Commit');
eq(committed, 2, 'P1 完成事件只Commit一次');

const txCancelled = createDecisionTransaction({ type: 'card', id: 'tao' }, function () { committed++; });
const decisionCancelled = {};
Object.defineProperty(decisionCancelled, '__djscTransaction', { value: txCancelled, enumerable: false });
stageExecutionDecision(player, decisionCancelled, 'use');
const cancelledEvent = {
	name: 'useCard', player: player, finished: false, _cancelled: false,
	then: function (resolve) { this.finished = true; this._cancelled = true; resolve(); },
};
const cancelled = await confirmExecutionFromHostEvent(player,
	{ type: 'card', id: 'tao' }, cancelledEvent, { eventName: 'useCard' });
eq(cancelled.reason, 'host-event-cancelled', 'P1 已取消GameEvent不得Commit');
eq(committed, 2, 'P1 取消动作不产生学习副作用');

const txEnd = createDecisionTransaction({ type: 'end', id: 'end' }, function () { committed++; });
const decisionEnd = {};
Object.defineProperty(decisionEnd, '__djscTransaction', { value: txEnd, enumerable: false });
stageExecutionDecision(player, decisionEnd, 'use');
const stillUsedCard = {
	name: 'chooseToUse', player: player, finished: false, result: { bool: true },
	then: function (resolve) { this.finished = true; resolve(); },
};
const notEnded = await confirmExecutionFromHostEvent(player,
	{ type: 'end', id: 'end' }, stillUsedCard,
	{ eventName: 'chooseToUse', verify: event => event.result?.bool === false });
eq(notEnded.reason, 'host-event-evidence-mismatch', 'P1 chooseToUse仍使用了动作时不得确认结束回合');
eq(committed, 2, 'P1 结束回合证据不匹配不Commit');
const endedEvent = {
	name: 'chooseToUse', player: player, finished: false, result: { bool: false },
	then: function (resolve) { this.finished = true; resolve(); },
};
const ended = await confirmExecutionFromHostEvent(player,
	{ type: 'end', id: 'end' }, endedEvent,
	{ eventName: 'chooseToUse', verify: event => event.result?.bool === false });
ok(ended.ok, 'P1 chooseToUse完成且result.bool=false时确认结束选择');
eq(committed, 3, 'P1 结束回合只Commit一次');

const tx2 = createDecisionTransaction({ type: 'card', id: 'tao' }, function () {});
const decision2 = {};
Object.defineProperty(decision2, '__djscTransaction', { value: tx2, enumerable: false });
stageExecutionDecision(player, decision2, 'soft');
ok(cancelExecution(player, 'test-cancel', 'soft'), '10.61 Gateway统一Cancel事务');
eq(peekDecisionTransaction(player), null, '10.61 Cancel后无pending事务');

const stats = executionGatewayStats();
ok(stats.hostCalls >= 3, '10.61 Gateway集中记录Host调用统计');
ok(stats.staged >= 2 && stats.committed >= 1 && stats.cancelled >= 1,
	'10.61 Gateway集中记录事务生命周期统计');

/* 静态架构门禁：公共执行职责不能再散回各模块。 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const useSrc = readFileSync(join(root, 'score/decision/override/use.js'), 'utf8');
const respondSrc = readFileSync(join(root, 'score/decision/override/respond.js'), 'utf8');
const discardSrc = readFileSync(join(root, 'score/decision/override/discard.js'), 'utf8');
const compareSrc = readFileSync(join(root, 'score/decision/override/compare.js'), 'utf8');
const softSrc = readFileSync(join(root, 'score/decision/safety/aiOverride.js'), 'utf8');
const engineSrc = readFileSync(join(root, 'score/decision/execution/hostHooks.js'), 'utf8');
const hookSrc = readFileSync(join(root, 'score/decision/engine/decisionHook.js'), 'utf8');
const indexSrc = readFileSync(join(root, 'score/decision/override/index.js'), 'utf8');

const useCardHook = engineSrc.slice(engineSrc.indexOf('/* 1) useCard'), engineSrc.indexOf('/* 2) 效果钩子'));
ok(useCardHook.includes('confirmExecutionFromHostEvent(me,'),
	'P1 useCard必须等待宿主GameEvent完成确认');
ok(!useCardHook.includes('commitExecution(me,'),
	'P1 useCard不得在宿主函数正常返回时直接Commit');
ok(useCardHook.indexOf('captureExecutionSnapshot(') >= 0 &&
	useCardHook.indexOf('captureExecutionSnapshot(') < useCardHook.indexOf('invokeObservedHost('),
	'P1 useCard收益快照必须建立在宿主事件启动前');
const skillHook = engineSrc.slice(engineSrc.indexOf('/* 技能日志不代表技能已执行'), engineSrc.indexOf('/* ★ 单独监听 respond'));
ok(skillHook.includes('proto.useSkill = function'),
	'P1 技能事务必须挂接真实useSkill事件');
ok(skillHook.includes("confirmExecutionFromHostEvent(me,") && skillHook.includes("eventName: 'useSkill'"),
	'P1 useSkill必须等待宿主GameEvent完成确认');
ok(!skillHook.includes('commitExecution(me,'),
	'P1 logSkill/useSkill正常返回不得直接Commit');
ok(skillHook.indexOf('captureExecutionSnapshot(') >= 0 &&
	skillHook.indexOf('captureExecutionSnapshot(') < skillHook.indexOf('invokeObservedHost('),
	'P1 useSkill收益快照必须建立在宿主事件启动前');
const learningHook = readFileSync(join(root, 'score/decision/feedback/executedLearning.js'), 'utf8');
ok(learningHook.includes('postCheckDelayed(') && !learningHook.includes('postCheckBatch('),
	'P1 Commit后必须消费执行前快照，不能重新建立动作后快照');
const endHook = useSrc.slice(useSrc.indexOf('/* ============ ★ 硬接管 A'), useSrc.indexOf('/* ============ ★ 硬接管 B'));
ok(/confirmExecutionFromHostEvent\(\s*player,/.test(endHook),
	'P1 结束回合必须等待chooseToUse完成结果');
ok(!endHook.includes('commitExecution(player,'),
	'P1 chooseToUse正常返回不得直接Commit结束回合');

for (const [name, src] of [
	['use', useSrc], ['respond', respondSrc], ['discard', discardSrc], ['compare', compareSrc],
]) {
	ok(src.includes("executionGateway.js"), '10.61 ' + name + ' 接管接入Execution Gateway');
	ok(!src.includes('const DEGRADED = new Map()'), '10.61 ' + name + ' 不再私有维护degrade状态');
	ok(!src.includes("import { trip, isTripped }"), '10.61 ' + name + ' 不再直接维护熔断调用');
}

ok(softSrc.includes('stageExecutionDecision') && !softSrc.includes('stageDecisionTransaction'),
	'10.61 soft override事务Stage只走Gateway');
ok(engineSrc.includes('confirmExecutionFromHostEvent') && !engineSrc.includes('commitDecisionTransaction'),
	'10.61 card/skill真实Commit只走Gateway');
ok(engineSrc.includes('invokeObservedHost') &&
	!/catch\s*\([^)]*\)\s*\{\s*try\s*\{\s*return\s+[A-Za-z_$][\w$]*\.apply\(this,\s*args\)/.test(engineSrc),
	'10.61 use/respond/effect/die等宿主观测Hook不再异常后重复执行');
ok(indexSrc.includes('isExecutionLayerEnabled') &&
	!indexSrc.includes("cfg('hardOverride'") &&
	!indexSrc.includes("isTripped('use')"),
	'10.61 接管层启停资格只由Gateway解释');
ok(hookSrc.includes('invokeObservedHost') &&
	!hookSrc.includes('if (!_checkLegality(this, name, result, args)) {\n                        return orig.apply'),
	'10.61 decisionHook变为单次调用监督员，不因检查失败重跑宿主');

/* B5：旧事件晚完成时，只能确认自己绑定的事务，不能串写后来动作或新局。 */
for (const outcome of ['finished', 'cancelled', 'rejected', 'new-game']) {
	resetDecisionTransactionStats();
	let oldWrites = 0, newWrites = 0, finish;
	const oldTx = createDecisionTransaction({ type: 'skill', id: 'test_skill' }, () => { oldWrites++; });
	stageDecisionTransaction(player, oldTx);
	const deferred = new Promise((resolve, reject) => { finish = outcome === 'rejected' ? reject : resolve; });
	deferred.name = 'useSkill'; deferred.player = player; deferred.finished = false;
	const confirmation = confirmExecutionFromHostEvent(player,
		{ type: 'skill', id: 'test_skill' }, deferred, { eventName: 'useSkill', transactionId: oldTx.id });
	if (outcome === 'new-game') resetDecisionTransactionStats();
	const newTx = createDecisionTransaction({ type: 'skill', id: 'test_skill' }, () => { newWrites++; });
	stageDecisionTransaction(player, newTx);
	deferred.finished = true;
	deferred._cancelled = outcome === 'cancelled';
	finish(outcome === 'rejected' ? new Error('B5 old event rejected') : undefined);
	const result = await confirmation;
	eq(result.ok, false, 'B5 ' + outcome + '：旧事件不得提交后来事务');
	eq(oldWrites + newWrites, 0, 'B5 ' + outcome + '：旧事件不得产生学习写入');
	eq(peekDecisionTransaction(player)?.id, newTx.id, 'B5 ' + outcome + '：新事务必须保留');
	eq(cancelExecution(player, 'old-end-callback', 'end', oldTx.id), false,
		'B5 ' + outcome + '：旧结束回调也不能取消新事务');
}

/* B5：宿主函数内部已产生下一事务时，仍不能用旧事件确认下一事务。 */
const capturedBeforeHost = createDecisionTransaction({ type: 'skill', id: 'same_skill' }, () => { throw new Error('old commit'); });
stageDecisionTransaction(player, capturedBeforeHost);
const newerBeforeConfirm = createDecisionTransaction({ type: 'skill', id: 'same_skill' }, () => { throw new Error('new commit'); });
stageDecisionTransaction(player, newerBeforeConfirm);
const staleAtEntry = await confirmExecutionFromHostEvent(player, { type: 'skill', id: 'same_skill' },
	completedEvent, { eventName: 'useCard', transactionId: capturedBeforeHost.id });
eq(staleAtEntry.reason, 'transaction-changed', 'B5 宿主调用前捕获的 id 优先于确认入口当前 pending');
eq(peekDecisionTransaction(player)?.id, newerBeforeConfirm.id, 'B5 入口已换事务时保留新事务');

/* B5：不改 TTL，使用固定时钟验证超时只丢弃旧事务，不学习、不冒充执行。 */
const originalNow = Date.now;
try {
	let clock = 100000;
	Date.now = () => clock;
	let writes = 0;
	const expiring = createDecisionTransaction({ type: 'skill', id: 'late_skill' }, () => { writes++; });
	stageDecisionTransaction(player, expiring);
	const lateEvent = { name: 'useSkill', player, finished: false,
		then(resolve) { clock += 5001; this.finished = true; resolve(); } };
	const late = await confirmExecutionFromHostEvent(player, { type: 'skill', id: 'late_skill' }, lateEvent,
		{ eventName: 'useSkill', transactionId: expiring.id });
	eq(late.ok, false, 'B5 超过五秒的事件不能提交过期事务');
	eq(expiring.state, 'expired', 'B5 超时事务明确标记 expired');
	eq(writes, 0, 'B5 超时无学习副作用');
} finally { Date.now = originalNow; }

/* B5-F07：核心 cancel 的 notrigger 参数只抑制通知，不代表动作执行成功。 */
{
	let writes = 0, contentRuns = 0;
	const cancelArgs = [];
	const nativePrototype = {
		cancel(...args) {
			cancelArgs.push({ receiver: this, args });
			if (!args[2]) this._cancelled = true;
			this.finished = true;
			return 'native-cancel-result';
		},
	};
	const nativeEvent = Object.assign(Object.create(nativePrototype), {
		name: 'useSkill', player, finished: false,
		then(resolve) { if (!this.finished) { contentRuns++; this.finished = true; } resolve(); },
	});
	const cancelledTx = createDecisionTransaction({ type: 'skill', id: 'silent_cancel' }, () => { writes++; });
	stageDecisionTransaction(player, cancelledTx);
	const confirming = confirmExecutionFromHostEvent(player, { type: 'skill', id: 'silent_cancel' },
		nativeEvent, { eventName: 'useSkill', transactionId: cancelledTx.id });
	eq(nativeEvent.cancel(true, null, 'notrigger'), 'native-cancel-result', 'B5-F07 保持宿主 cancel 返回值');
	const result = await confirming;
	eq(result.reason, 'host-event-cancelled', 'B5-F07 静默取消不得当作完成动作');
	eq(cancelledTx.state, 'cancelled', 'B5-F07 只取消原事务');
	eq(writes, 0, 'B5-F07 静默取消不产生 Commit 副作用');
	eq(contentRuns, 0, 'B5-F07 静默取消不执行技能内容');
	eq(nativeEvent._cancelled, undefined, 'B5-F07 不替宿主改写取消通知标记');
	ok(cancelArgs[0].receiver === nativeEvent && cancelArgs[0].args[2] === 'notrigger', 'B5-F07 保持 cancel 的 this 和参数');
	ok(!Object.hasOwn(nativeEvent, 'cancel') && nativeEvent.cancel === nativePrototype.cancel, 'B5-F07 完成后恢复原继承方法');
}

process.stdout.write('\n');
if (fails.length) {
	console.error('\n❌ #35 execution gateway contract failed: ' + fails.length + ' / ' + (pass + fails.length));
	for (const f of fails) console.error('  FAIL ' + f);
	process.exitCode = 1;
} else {
	console.log('\n✅ #35 execution gateway contract passed: ' + pass + ' assertions');
}
