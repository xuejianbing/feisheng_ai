/*
 * modelContract.js
 * 训练与模型专项修复 · 批次B
 * 模型输入输出契约校验
 *
 * 关键规则：
 * - 正式契约：输入134维 → 128 → 64 → 6动作输出头 + Critic价值头
 * - 旧130维模型只在明确声明的旧语义环境中使用
 * - 142维实验模型不进入正式契约
 * - 权重加载前必须校验，不匹配时拒绝加载
 */

export const FORMAL_CONTRACT = {
  featureDim: 134,
  hiddenDims: [128, 64],
  actionOutputs: 6,
  criticOutputs: 1,
  weightType: 'int8',
  version: 7,
};

export const LEGACY_CONTRACT = {
  featureDim: 130,
  hiddenDims: [128, 64],
  actionOutputs: 6,
  criticOutputs: 1,
  weightType: 'int8',
  version: 6,
};

export const EXPERIMENTAL_DIMS = [142, 150];

/**
 * 从权重对象中推断实际契约
 * 支持多种权重存储格式
 */
export function inferContractFromWeights(weights) {
  if (!weights) return { error: 'null-weights' };

  // 格式1：{ dims: [134,128,64,6], featureDim: 134 }
  if (weights.dims && Array.isArray(weights.dims)) {
    const dims = weights.dims;
    return {
      featureDim: weights.featureDim || dims[0],
      hiddenDims: dims.slice(1, -1),
      actionOutputs: dims[dims.length - 1],
      criticOutputs: weights.hasCritic ? 1 : 0,
      version: weights.version || weights.VERSION || null,
    };
  }

  // 格式2：{ W: [layers], featureDim }
  if (weights.W && Array.isArray(weights.W)) {
    const layers = weights.W;
    const featureDim = weights.featureDim || (layers[0] && layers[0].length) || 0;
    const actionOutputs = layers[layers.length - 1] && layers[layers.length - 1].length;
    return {
      featureDim,
      hiddenDims: layers.slice(0, -1).map((l) => l.length),
      actionOutputs,
      criticOutputs: weights.criticW ? 1 : 0,
      version: weights.version || null,
    };
  }

  // 格式3：manifest 格式
  if (weights.featureDim && weights.outputDim) {
    return {
      featureDim: weights.featureDim,
      hiddenDims: weights.hiddenDims || [],
      actionOutputs: weights.outputDim,
      criticOutputs: weights.hasCritic ? 1 : 0,
      version: weights.version || null,
    };
  }

  return { error: 'unrecognized-weight-format' };
}

/**
 * 校验权重是否符合正式契约
 * 返回 { ok, expected, actual, mismatches, reason }
 */
export function verifyModelContract(weights, expectedContract = FORMAL_CONTRACT) {
  const actual = inferContractFromWeights(weights);
  if (actual.error) {
    return { ok: false, expected: expectedContract, actual, mismatches: [actual.error], reason: actual.error };
  }

  const mismatches = [];

  if (actual.featureDim !== expectedContract.featureDim) {
    mismatches.push('featureDim: expected=' + expectedContract.featureDim + ' actual=' + actual.featureDim);
  }
  if (actual.actionOutputs !== expectedContract.actionOutputs) {
    mismatches.push('actionOutputs: expected=' + expectedContract.actionOutputs + ' actual=' + actual.actionOutputs);
  }
  if (expectedContract.criticOutputs > 0 && actual.criticOutputs !== expectedContract.criticOutputs) {
    mismatches.push('criticOutputs: expected=' + expectedContract.criticOutputs + ' actual=' + actual.criticOutputs);
  }

  // 检查是否为实验维度
  if (EXPERIMENTAL_DIMS.includes(actual.featureDim)) {
    mismatches.push('experimental-dim:' + actual.featureDim + '-not-formal-contract');
  }

  return {
    ok: mismatches.length === 0,
    expected: expectedContract,
    actual,
    mismatches,
    reason: mismatches.length ? mismatches.join('; ') : null,
  };
}

/**
 * 判断权重是否为旧130维合法模型（可在旧语义环境使用）
 */
export function isLegacy130Model(weights) {
  const actual = inferContractFromWeights(weights);
  if (actual.error) return false;
  return actual.featureDim === 130 && actual.actionOutputs === 6;
}

/**
 * 判断权重是否为实验模型（不允许进入正式路径）
 */
export function isExperimentalModel(weights) {
  const actual = inferContractFromWeights(weights);
  if (actual.error) return false;
  return EXPERIMENTAL_DIMS.includes(actual.featureDim);
}

/**
 * 契约校验摘要（用于日志和面板显示）
 */
export function contractSummary(weights) {
  const actual = inferContractFromWeights(weights);
  if (actual.error) return '无法识别权重格式';
  return (
    '输入' + actual.featureDim + '维 → ' +
    (actual.hiddenDims.length ? actual.hiddenDims.join('→') + '→' : '') +
    actual.actionOutputs + '动作' +
    (actual.criticOutputs ? '+Critic' : '') +
    (actual.version ? ' v' + actual.version : '')
  );
}
