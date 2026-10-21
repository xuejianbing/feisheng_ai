/*
 * tdValidator.js — TD transition validation.
 * Adjacent samples alone do not prove terminal state.
 */
export const TD_FIELDS = ['state', 'action', 'reward', 'nextState', 'done'];
export const TD_ERROR_CODES = {
  MISSING_STATE: 'missing-state', MISSING_ACTION: 'missing-action',
  MISSING_REWARD: 'missing-reward', MISSING_NEXT_STATE: 'missing-next-state',
  MISSING_DONE: 'missing-done', REWARD_NON_NUMBER: 'reward-non-number',
  REWARD_OUT_OF_RANGE: 'reward-out-of-range', DONE_NON_BOOLEAN: 'done-non-boolean',
  DONE_WITH_NEXT_STATE: 'done-with-next-state',
  NOT_DONE_WITHOUT_NEXT_STATE: 'not-done-without-next-state',
  STATE_DIM_MISMATCH: 'state-dim-mismatch',
};
export const REWARD_HARD_MIN = -100, REWARD_HARD_MAX = 100;
export const REWARD_SOFT_MIN = -10, REWARD_SOFT_MAX = 10;

export function validateTdTransition(t, options = {}) {
  const errors = [], warnings = [];
  const expectedStateDim = options.expectedStateDim ?? 142;  /* 须与 features.js 的 FEATURE_DIM 同步 */
  if (!t) return {valid:false, errors:['null-transition'], warnings:[], fields:{}};
  if (t.state == null) errors.push(TD_ERROR_CODES.MISSING_STATE);
  if (t.action == null) errors.push(TD_ERROR_CODES.MISSING_ACTION);
  if (t.reward == null) errors.push(TD_ERROR_CODES.MISSING_REWARD);
  if (t.done == null) errors.push(TD_ERROR_CODES.MISSING_DONE);
  // Terminal transitions may have no nextState; non-terminal transitions may not.
  if (t.done !== true && t.nextState == null) errors.push(TD_ERROR_CODES.MISSING_NEXT_STATE);
  if (t.reward != null) {
    if (typeof t.reward !== 'number' || !Number.isFinite(t.reward)) errors.push(TD_ERROR_CODES.REWARD_NON_NUMBER);
    else if (t.reward < REWARD_HARD_MIN || t.reward > REWARD_HARD_MAX) errors.push(TD_ERROR_CODES.REWARD_OUT_OF_RANGE);
    else if (t.reward < REWARD_SOFT_MIN || t.reward > REWARD_SOFT_MAX) warnings.push('reward-soft-range-exceeded:' + t.reward);
  }
  if (t.done != null && typeof t.done !== 'boolean') errors.push(TD_ERROR_CODES.DONE_NON_BOOLEAN);
  if (t.done === true && t.nextState != null) warnings.push(TD_ERROR_CODES.DONE_WITH_NEXT_STATE);
  if (t.done === false && t.nextState == null) errors.push(TD_ERROR_CODES.NOT_DONE_WITHOUT_NEXT_STATE);
  if (t.state && typeof t.state.length === 'number' && t.state.length > 0 &&
      expectedStateDim && t.state.length !== expectedStateDim) {
    warnings.push(TD_ERROR_CODES.STATE_DIM_MISMATCH + ':expected=' + expectedStateDim + ':actual=' + t.state.length);
  }
  return {valid:errors.length===0, errors, warnings, fields:{
    hasState:t.state!=null, hasAction:t.action!=null, hasReward:t.reward!=null,
    hasNextState:t.nextState!=null, hasDone:t.done!=null,
  }};
}

export function validateTdBatch(transitions, options = {}) {
  let valid = 0, invalid = 0;
  const errorCounts = {}, warningCounts = {};
  for (const t of transitions || []) {
    const r = validateTdTransition(t, options);
    if (r.valid) valid++; else invalid++;
    for (const e of r.errors) errorCounts[e] = (errorCounts[e] || 0) + 1;
    for (const w of r.warnings) warningCounts[w] = (warningCounts[w] || 0) + 1;
  }
  return {total:(transitions||[]).length, valid, invalid, errorCounts, warningCounts};
}

export function buildTdTransitions(samples) {
  if (!samples || !samples.length) return [];
  const bySession = new Map();
  for (const s of samples) {
    const sid = s?.m?.sessionId || 'unknown';
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(s);
  }
  const transitions = [];
  for (const [sid, group] of bySession) {
    group.sort((a,b) => {
      const ta = a?.m?.turn ?? a?.m?.timestamp ?? 0;
      const tb = b?.m?.turn ?? b?.m?.timestamp ?? 0;
      return ta - tb;
    });
    for (let i=0; i<group.length-1; i++) {
      const cur = group[i], next = group[i+1];
      transitions.push({
        state:cur.f, action:cur.m?.action || cur.m?.type, reward:cur.r,
        nextState:next.f,
        // Do not infer terminal status from being the final adjacent pair.
        done:false, _sessionId:sid, _index:i,
      });
    }
  }
  return transitions;
}
