/*
 * tdValidator.js
 * 训练与模型专项修复 · 批次A
 * TD 转移五字段校验：state / action / reward / nextState / done
 *
 * 解决问题：此前 reward 分配只检查相邻记录对，不验证后继状态
 * 和终止标记，导致终局奖励可能错误归因到非终止动作。
 */

export const TD_FIELDS = ['state', 'action', 'reward', 'nextState', 'done'];

export const TD_ERROR_CODES = {
  MISSING_STATE: 'missing-state',
  MISSING_ACTION: 'missing-action',
  MISSING_REWARD: 'missing-reward',
  MISSING_NEXT_STATE: 'missing-next-state',
  MISSING_DONE: 'missing-done',
  REWARD_NON_NUMBER: 'reward-non-number',
  REWARD_OUT_OF_RANGE: 'reward-out-of-range',
  DONE_NON_BOOLEAN: 'done-non-boolean',
  DONE_WITH_NEXT_STATE: 'done-with-next-state',
  NOT_DONE_WITHOUT_NEXT_STATE: 'not-done-without-next-state',
  STATE_DIM_MISMATCH: 'state-dim-mismatch',
};

// reward 合理范围：单步奖励通常在 [-10, 10]，终局奖励在 [-1, 1]
// 超出范围标记为可疑但不直接拒绝（由调用方决定）
export const REWARD_HARD_MIN = -100;
export const REWARD_HARD_MAX = 100;
export const REWARD_SOFT_MIN = -10;
export const REWARD_SOFT_MAX = 10;

/**
 * 校验单条 TD 转移
 * 返回 { valid, errors, warnings, fields }
 */
export function validateTdTransition(t, options = {}) {
  const errors = [];
  const warnings = [];
  const expectedStateDim = options.expectedStateDim || 134;

  if (!t) {
    return { valid: false, errors: ['null-transition'], warnings: [], fields: {} };
  }

  // 五字段存在性
  if (t.state === undefined || t.state === null) {
    errors.push(TD_ERROR_CODES.MISSING_STATE);
  }
  if (t.action === undefined || t.action === null) {
    errors.push(TD_ERROR_CODES.MISSING_ACTION);
  }
  if (t.reward === undefined || t.reward === null) {
    errors.push(TD_ERROR_CODES.MISSING_REWARD);
  }
  if (t.nextState === undefined || t.nextState === null) {
    errors.push(TD_ERROR_CODES.MISSING_NEXT_STATE);
  }
  if (t.done === undefined || t.done === null) {
    errors.push(TD_ERROR_CODES.MISSING_DONE);
  }

  // reward 类型和范围
  if (t.reward !== undefined && t.reward !== null) {
    if (typeof t.reward !== 'number' || isNaN(t.reward)) {
      errors.push(TD_ERROR_CODES.REWARD_NON_NUMBER);
    } else if (t.reward < REWARD_HARD_MIN || t.reward > REWARD_HARD_MAX) {
      errors.push(TD_ERROR_CODES.REWARD_OUT_OF_RANGE);
    } else if (t.reward < REWARD_SOFT_MIN || t.reward > REWARD_SOFT_MAX) {
      warnings.push('reward-soft-range-exceeded:' + t.reward);
    }
  }

  // done 类型
  if (t.done !== undefined && t.done !== null && typeof t.done !== 'boolean') {
    errors.push(TD_ERROR_CODES.DONE_NON_BOOLEAN);
  }

  // done 与 nextState 一致性
  if (t.done === true && t.nextState !== null && t.nextState !== undefined) {
    // done=true 时 nextState 应为 null（终止状态无后继）
    // 但有些实现会存最后一个状态，这里只警告
    warnings.push(TD_ERROR_CODES.DONE_WITH_NEXT_STATE);
  }
  if (t.done === false && (t.nextState === null || t.nextState === undefined)) {
    errors.push(TD_ERROR_CODES.NOT_DONE_WITHOUT_NEXT_STATE);
  }

  // 状态维度校验（如果状态是数组）
  if (t.state && t.state.length && expectedStateDim) {
    if (t.state.length !== expectedStateDim) {
      warnings.push(TD_ERROR_CODES.STATE_DIM_MISMATCH + ':expected=' + expectedStateDim + ':actual=' + t.state.length);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    fields: {
      hasState: !!(t.state),
      hasAction: !!(t.action !== undefined),
      hasReward: !!(t.reward !== undefined),
      hasNextState: !!(t.nextState !== undefined),
      hasDone: !!(t.done !== undefined),
    },
  };
}

/**
 * 批量校验，返回统计
 */
export function validateTdBatch(transitions, options = {}) {
  let valid = 0, invalid = 0;
  const errorCounts = {};
  const warningCounts = {};

  for (const t of transitions || []) {
    const r = validateTdTransition(t, options);
    if (r.valid) valid++; else invalid++;
    for (const e of r.errors) errorCounts[e] = (errorCounts[e] || 0) + 1;
    for (const w of r.warnings) warningCounts[w] = (warningCounts[w] || 0) + 1;
  }

  return {
    total: (transitions || []).length,
    valid,
    invalid,
    errorCounts,
    warningCounts,
  };
}

/**
 * 从样本序列构建 TD 转移对
 * 同一 session 内按回合排序，相邻样本构成 (state, action, reward, nextState, done)
 */
export function buildTdTransitions(samples) {
  if (!samples || !samples.length) return [];

  // 按 session 分组
  const bySession = new Map();
  for (const s of samples) {
    const sid = s?.m?.sessionId || 'unknown';
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(s);
  }

  const transitions = [];
  for (const [sid, group] of bySession) {
    // 按回合/时间排序
    group.sort((a, b) => {
      const ta = a?.m?.turn || a?.m?.timestamp || 0;
      const tb = b?.m?.turn || b?.m?.timestamp || 0;
      return ta - tb;
    });

    for (let i = 0; i < group.length - 1; i++) {
      const cur = group[i];
      const next = group[i + 1];
      const isLast = i === group.length - 2;
      transitions.push({
        state: cur.f,
        action: cur.m?.action || cur.m?.type,
        reward: cur.r,
        nextState: next.f,
        done: isLast, // 简化：每组最后一对标记为 done
        _sessionId: sid,
        _index: i,
      });
    }
  }

  return transitions;
}
