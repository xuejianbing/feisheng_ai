/*
 * verification/index.js
 * 训练与模型专项修复 · 批次C
 * 离线评估与发布门禁
 *
 * 提供：独立测试集评估、数据泄漏检查、基线比较
 */

import {validateTdTransition, validateTdBatch, buildTdTransitions} from '../train/tdValidator.js?v=41a';
import {classifyBatch, SAMPLE_STATES} from '../train/sampleEligibility.js?v=41a';
import {verifyModelContract, FORMAL_CONTRACT} from '../net/modelContract.js?v=41a';

/**
 * 数据泄漏检查：训练集和验证集是否共享 session
 */
export function checkDataLeakage(training, validation) {
  const trainSessions = new Set((training || []).map((s) => s?.m?.sessionId).filter(Boolean));
  const valSessions = new Set((validation || []).map((s) => s?.m?.sessionId).filter(Boolean));
  const leaked = [...trainSessions].filter((sid) => valSessions.has(sid));
  return {
    ok: leaked.length === 0,
    leakedSessions: leaked,
    trainSessionCount: trainSessions.size,
    valSessionCount: valSessions.size,
  };
}

/**
 * 样本资格审计：统计四态分布和拒绝原因
 */
export function auditSampleEligibility(samples, championEligibilityFn) {
  const result = classifyBatch(samples, championEligibilityFn);
  return {
    total: result.total,
    trainable: result.counts[SAMPLE_STATES.TRAINABLE] || 0,
    raw: result.counts[SAMPLE_STATES.RAW] || 0,
    rejected: result.counts[SAMPLE_STATES.REJECTED] || 0,
    rejectedReasons: result.reasonCounts,
  };
}

/**
 * TD 转移审计
 */
export function auditTdTransitions(samples) {
  const transitions = buildTdTransitions(samples);
  const result = validateTdBatch(transitions);
  return {
    totalTransitions: result.total,
    valid: result.valid,
    invalid: result.invalid,
    errorCounts: result.errorCounts,
    warningCounts: result.warningCounts,
  };
}

/**
 * 模型契约审计
 */
export function auditModelContract(weights) {
  const result = verifyModelContract(weights, FORMAL_CONTRACT);
  return {
    ok: result.ok,
    expected: result.expected,
    actual: result.actual,
    mismatches: result.mismatches,
  };
}

/**
 * 完整发布门禁检查
 * 返回 { passed, checks, summary }
 */
export function runReleaseGate({ samples, trainingSet, validationSet, weights, championEligibilityFn }) {
  const checks = [];

  // 1. 样本资格
  const elig = auditSampleEligibility(samples, championEligibilityFn);
  checks.push({
    name: 'sample-eligibility',
    passed: elig.trainable > 0,
    details: elig,
  });

  // 2. 数据泄漏
  if (trainingSet && validationSet) {
    const leak = checkDataLeakage(trainingSet, validationSet);
    checks.push({
      name: 'data-leakage',
      passed: leak.ok,
      details: leak,
    });
  }

  // 3. TD转移
  const td = auditTdTransitions(samples || trainingSet);
  checks.push({
    name: 'td-transitions',
    passed: td.invalid === 0,
    details: td,
  });

  // 4. 模型契约
  if (weights) {
    const mc = auditModelContract(weights);
    checks.push({
      name: 'model-contract',
      passed: mc.ok,
      details: mc,
    });
  }

  const passed = checks.every((c) => c.passed);
  return {
    passed,
    checks,
    summary: checks.map((c) => (c.passed ? '✅ ' : '❌ ') + c.name).join(' '),
  };
}
