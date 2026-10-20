/*
 * sampleEligibility.js
 * 训练与模型专项修复 · 批次A
 * 样本资格四态分离：RAW → DEDUPED → OBSERVED → TRAINABLE
 *
 * 解决问题：此前去重、收益回填和资格校验混用，无法追溯某条样本
 * 为何进入或被排除训练集。
 */

export const SAMPLE_STATES = {
  RAW: 'raw',              // 原始记录，刚采集，未去重
  DEDUPED: 'deduped',      // 去重后，同一事务只保留一条
  OBSERVED: 'observed',    // 已观察收益回填（r0/reward已写入）
  TRAINABLE: 'trainable',  // 通过全部资格校验，可进入训练
  REJECTED: 'rejected',    // 被拒绝，带原因
};

export const REJECT_REASONS = {
  NULL_SAMPLE: 'null-sample',
  NO_MODE_CONTEXT: 'no-mode-context',
  SCHEMA_MISMATCH: 'schema-mismatch',
  NOT_CAPTURED: 'not-captured',
  WRONG_MODE: 'wrong-mode',
  COLLECTION_DISABLED: 'collection-disabled',
  ROLE_UNKNOWN: 'role-unknown',
  RULE_VERSION_MISMATCH: 'rule-version-mismatch',
  FEATURE_DIM_UNSUPPORTED: 'feature-dim-unsupported',
  CHAMPION_INELIGIBLE: 'champion-ineligible',
  TRANSACTION_CONFLICT: 'transaction-conflict',
  TD_INVALID: 'td-invalid',
  REWARD_MISSING: 'reward-missing',
};

/**
 * 对单条样本做资格分类，返回状态和原因
 * 不修改样本本身，只做判断
 */
export function classifySample(sample, championEligibilityFn) {
  if (!sample) {
    return { state: SAMPLE_STATES.REJECTED, reason: REJECT_REASONS.NULL_SAMPLE };
  }

  const m = sample.m;
  const c = m?.modeContext;

  // 基础结构校验
  if (!c) return { state: SAMPLE_STATES.REJECTED, reason: REJECT_REASONS.NO_MODE_CONTEXT };
  if (c.schema !== 'mode-context-v1') return { state: SAMPLE_STATES.REJECTED, reason: REJECT_REASONS.SCHEMA_MISMATCH };
  if (c.captured !== true) return { state: SAMPLE_STATES.REJECTED, reason: REJECT_REASONS.NOT_CAPTURED };

  // 模式校验
  if (c.group !== 'doudizhu-classic' || c.mode !== 'doudizhu') {
    return { state: SAMPLE_STATES.REJECTED, reason: REJECT_REASONS.WRONG_MODE };
  }
  if (!['normal', 'kaihei', 'huanle'].includes(c.submode)) {
    return { state: SAMPLE_STATES.REJECTED, reason: REJECT_REASONS.WRONG_MODE };
  }

  if (!c.collect) return { state: SAMPLE_STATES.REJECTED, reason: REJECT_REASONS.COLLECTION_DISABLED };
  if (!['landlord', 'farmer'].includes(c.role)) return { state: SAMPLE_STATES.REJECTED, reason: REJECT_REASONS.ROLE_UNKNOWN };

  // 规则版本
  if (!c.ruleKey || c.ruleVersion !== 1) {
    return { state: SAMPLE_STATES.REJECTED, reason: REJECT_REASONS.RULE_VERSION_MISMATCH };
  }

  // 特征维度（由 dimensionAdapter 统一判断，这里只检查是否在支持列表）
  const featureDim = sample.f?.length || sample.featureDim || c.featureVersion || 0;
  if (![130, 134].includes(featureDim)) {
    return { state: SAMPLE_STATES.REJECTED, reason: REJECT_REASONS.FEATURE_DIM_UNSUPPORTED };
  }

  // Champion 资格（注入函数，便于测试）
  if (typeof championEligibilityFn === 'function') {
    const champReason = championEligibilityFn(sample);
    if (champReason) return { state: SAMPLE_STATES.REJECTED, reason: REJECT_REASONS.CHAMPION_INELIGIBLE + ':' + champReason };
  }

  // 收益回填检查
  const hasReward = sample.r !== undefined && sample.r !== null;
  const hasObserved = sample._observed === true || sample._rewardBackfilled === true;

  if (!hasReward && !hasObserved) {
    return { state: SAMPLE_STATES.RAW, reason: null };
  }

  // 通过全部校验
  return { state: SAMPLE_STATES.TRAINABLE, reason: null };
}

/**
 * 严格判断是否可训练
 */
export function isTrainable(sample, championEligibilityFn) {
  const r = classifySample(sample, championEligibilityFn);
  return r.state === SAMPLE_STATES.TRAINABLE;
}

/**
 * 批量分类，返回各状态计数
 */
export function classifyBatch(samples, championEligibilityFn) {
  const counts = {};
  const reasonCounts = {};
  for (const s of samples || []) {
    const r = classifySample(s, championEligibilityFn);
    counts[r.state] = (counts[r.state] || 0) + 1;
    if (r.reason) reasonCounts[r.reason] = (reasonCounts[r.reason] || 0) + 1;
  }
  return { counts, reasonCounts, total: (samples || []).length };
}

/**
 * 给样本打上状态标记（修改样本对象）
 */
export function stampEligibility(sample, state, reason) {
  if (!sample) return sample;
  sample._eligibilityState = state;
  sample._eligibilityReason = reason || null;
  sample._eligibilityCheckedAt = Date.now();
  return sample;
}
