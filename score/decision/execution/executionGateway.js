import { playChoiceWindow } from './decisionWindow.js?v=41a';
/*
 * 无名AI · Execution Gateway
 *
 * Production wrapper：向纯核心注入无名杀宿主、配置、熔断器和 Decision Transaction。
 * 公共执行策略只在 executionGatewayCore.js 定义。
 */

import { game, _status } from '../../foundation/adapt/host.js?v=41a';
import { cfg } from '../../foundation/config/util.js?v=41a';
import { trip, isTripped } from '../override/circuit.js?v=41a';
import {
	stageDecisionTransaction,
	commitDecisionTransaction,
	cancelDecisionTransaction,
	peekDecisionTransaction,
} from '../state/decisionTransaction.js?v=41a';
import { EXECUTION_KINDS, createExecutionGatewayCore } from './executionGatewayCore.js?v=41a';

const gateway = createExecutionGatewayCore({
	config: cfg,
	isTripped: isTripped,
	trip: trip,
	getGameMe: function () { return game.me; },
	getCurrentPhase: function () { return _status.currentPhase; },
	getDecisionWindow: (player, execution) => playChoiceWindow(_status.event, player, execution),
	stageTransaction: stageDecisionTransaction,
	commitTransaction: commitDecisionTransaction,
	cancelTransaction: cancelDecisionTransaction,
	peekTransaction: peekDecisionTransaction,
});

export { EXECUTION_KINDS };

export const executionEligibility = gateway.executionEligibility;
export const isExecutionLayerEnabled = gateway.isExecutionLayerEnabled;
export const markExecutionFailure = gateway.markExecutionFailure;
export const clearExecutionDegrade = gateway.clearExecutionDegrade;
export const markExecutionSentinel = gateway.markExecutionSentinel;
export const clearExecutionSentinel = gateway.clearExecutionSentinel;
export const invokeHost = gateway.invokeHost;
export const invokeObservedHost = gateway.invokeObservedHost;
export const stageExecutionDecision = gateway.stageExecutionDecision;
export const commitExecution = gateway.commitExecution;
export const cancelExecution = gateway.cancelExecution;
export const pendingExecution = gateway.pendingExecution;
export const executionGatewayStats = gateway.executionGatewayStats;
export const resetExecutionGateway = gateway.resetExecutionGateway;
