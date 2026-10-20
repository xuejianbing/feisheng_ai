/*
 * dimensionAdapter.js
 * 训练与模型专项修复 · 批次B
 * 130/134 维样本安全适配层
 *
 * 关键规则：
 * - SUPPORTED_DIMS 只包含正式契约维度，142 维实验不进入
 * - 130→134 适配时目标身份位 [130..133] 显式标记为 _dimAdapted，不静默补零
 * - 适配后的样本可被训练流程识别并单独统计
 */

export const SUPPORTED_DIMS = [130, 134];
export const CURRENT_DIM = 134;
export const DIM_ADAPTED_MARKER = '_dimAdapted';
export const ORIGINAL_DIM_MARKER = '_originalDim';

/**
 * 判断样本的特征维度
 * 特征数组长度是实际存储维度；元数据只作回退，避免旧版错误元数据
 * 将新维度向量误判为旧维度并清掉新增特征。
 */
export function detectDim(sample) {
  const actualDim = sample?.f?.length;
  if (Number.isInteger(actualDim) && actualDim > 0) return actualDim;
  if (sample && typeof sample.featureDim === 'number') return sample.featureDim;
  const ctx = sample?.m?.modeContext;
  if (ctx && typeof ctx.featureVersion === 'number') return ctx.featureVersion;
  return 130;
}

/**
 * 将样本适配到当前正式维度（134）
 * 返回 { sample, adapted, dim, error }
 * - 已是当前维度：adapted=false，原样返回
 * - 130→134：adapted=true，目标身份位补零并带标记
 * - 不支持的维度（如142）：sample=null，error='unsupported-dim'
 */
export function adaptToCurrentDim(sample) {
  if (!sample) return { sample: null, adapted: false, dim: 0, error: 'null-sample' };

  const dim = detectDim(sample);

  if (dim === CURRENT_DIM) {
    return { sample, adapted: false, dim };
  }

  if (!SUPPORTED_DIMS.includes(dim)) {
    return { sample: null, adapted: false, dim, error: 'unsupported-dim' };
  }

  // 130 → 134：前130维原样复制，后4维（目标身份）初始化为0并带标记
  const srcLen = Math.min(dim, CURRENT_DIM);
  const f = new Int8Array(CURRENT_DIM);
  if (sample.f && sample.f.length >= srcLen) {
    f.set(sample.f.subarray(0, srcLen));
  } else if (Array.isArray(sample.f)) {
    for (let i = 0; i < srcLen && i < sample.f.length; i++) f[i] = sample.f[i] | 0;
  }

  const adapted = {
    ...sample,
    f,
    [DIM_ADAPTED_MARKER]: true,
    [ORIGINAL_DIM_MARKER]: dim,
  };

  return { sample: adapted, adapted: true, dim };
}

/**
 * 批量适配，返回 { samples, adaptedCount, rejectedCount, rejectedReasons }
 */
export function adaptBatch(samples) {
  const result = { samples: [], adaptedCount: 0, rejectedCount: 0, rejectedReasons: {} };
  for (const s of samples || []) {
    const r = adaptToCurrentDim(s);
    if (r.error) {
      result.rejectedCount++;
      result.rejectedReasons[r.error] = (result.rejectedReasons[r.error] || 0) + 1;
    } else {
      result.samples.push(r.sample);
      if (r.adapted) result.adaptedCount++;
    }
  }
  return result;
}

/**
 * 检查样本是否为适配后的130维样本
 */
export function isAdaptedSample(sample) {
  return !!(sample && sample[DIM_ADAPTED_MARKER]);
}
