/*
 * modeDataset.js
 * 训练与模型专项修复 · 批次B + 批次C
 * 修改点：
 *   1. featureVersion 不再硬编码 ===130，改为支持 [130, 134]
 *   2. 130维样本通过 dimensionAdapter 适配到134维，带 _dimAdapted 标记
 *   3. splitClassicByGame 改用确定性种子哈希，导出切分元数据
 *   4. 样本资格四态分离（通过 sampleEligibility.classifySample）
 */

import {trainingLabelOf} from './labelPolicy.js?v=41a';
import {championSampleEligibility} from '../../decision/strategy/championStrategy.js?v=41a';
import {adaptToCurrentDim, SUPPORTED_DIMS, isAdaptedSample} from '../features/dimensionAdapter.js?v=41a';
import {classifySample, SAMPLE_STATES, stampEligibility} from './sampleEligibility.js?v=41a';

// 切分种子：固定值保证可复现
const DEFAULT_SPLIT_SEED = 20261019;
const DEFAULT_HOLDOUT_RATIO = 0.2;

/**
 * 确定性字符串哈希（用于 session 级切分，不依赖排序）
 */
function _hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function selectClassicDataset(samples) {
  const map = new Map();
  const conflicts = new Set();
  const rejected = {};
  let duplicates = 0;
  let dimAdaptedCount = 0;
  const dimStats = { dim130: 0, dim134: 0, other: 0 };

  const reject = (r) => { rejected[r] = (rejected[r] || 0) + 1; };

  for (const s of samples || []) {
    const m = s?.m;
    const c = m?.modeContext;
    let reason = null;

    if (!c || c.schema !== 'mode-context-v1' || c.captured !== true) {
      reason = '模式来源未知';
    } else if (c.group !== 'doudizhu-classic' || c.mode !== 'doudizhu' || !['normal', 'kaihei', 'huanle'].includes(c.submode)) {
      reason = '非本专项';
    } else if (!c.collect) {
      reason = '采集未开启';
    } else if (!['landlord', 'farmer'].includes(c.role)) {
      reason = '角色未确认';
    } else if (!c.ruleKey || c.ruleVersion !== 1) {
      reason = '规则版本不兼容';
    } else if (!SUPPORTED_DIMS.includes(c.featureVersion)) {
      // ★ 修复：不再硬编码 ===130，134维正式通过
      reason = '特征维度不支持:' + c.featureVersion;
    } else {
      reason = championSampleEligibility(s);
    }

    // 维度统计
    if (c?.featureVersion === 130) dimStats.dim130++;
    else if (c?.featureVersion === 134) dimStats.dim134++;
    else if (c) dimStats.other++;

    if (reason) {
      reject(reason);
      stampEligibility(s, SAMPLE_STATES.REJECTED, reason);
      if (m?.sessionId && m.actorId && m.transactionId) {
        const key = JSON.stringify([m.sessionId, m.actorId, m.transactionId]);
        map.delete(key);
        conflicts.add(key);
      }
      continue;
    }

    // ★ 维度适配：130→134，带标记
    const adapted = adaptToCurrentDim(s);
    if (adapted.error) {
      reject('维度适配失败:' + adapted.error);
      continue;
    }
    const sample = adapted.sample;
    if (adapted.adapted) dimAdaptedCount++;

    const key = JSON.stringify([m.sessionId, m.actorId, m.transactionId]);
    const identity = JSON.stringify({
      f: Array.from(sample.f),
      r: sample.r,
      value: sample.value_target,
      id: m.id,
      type: m.type || m.action,
      target: m.target,
      c,
    });

    if (conflicts.has(key)) {
      reject('事务冲突');
      continue;
    }
    if (map.has(key)) {
      if (map.get(key).identity === identity) {
        duplicates++;
      } else {
        map.delete(key);
        conflicts.add(key);
        reject('事务冲突');
      }
    } else {
      map.set(key, { identity, s: sample });
    }
  }

  const accepted = [...map.values()].map((r) => {
    stampEligibility(r.s, SAMPLE_STATES.TRAINABLE, null);
    return JSON.parse(JSON.stringify(r.s));
  });

  const breakdown = {};
  for (const s of accepted) {
    const c = s.m.modeContext;
    const k = c.submode + '/' + c.role;
    const b = breakdown[k] || (breakdown[k] = { samples: 0, sessions: new Set() });
    b.samples++;
    b.sessions.add(s.m.sessionId);
  }

  return {
    samples: accepted,
    stats: {
      accepted: accepted.length,
      duplicates,
      conflicts: conflicts.size,
      rejected,
      sessions: new Set(accepted.map((s) => s.m.sessionId)).size,
      dimAdaptedCount,
      dimStats,
      breakdown: Object.fromEntries(
        Object.entries(breakdown).map(([k, v]) => [k, { samples: v.samples, sessions: v.sessions.size }])
      ),
    },
  };
}

/**
 * 数据集切分：按 session 级确定性哈希，保证可复现
 * 返回 { training, validation, metadata }
 */
export function splitClassicByGame(samples, options = {}) {
  const seed = options.seed || DEFAULT_SPLIT_SEED;
  const holdoutRatio = options.holdoutRatio || DEFAULT_HOLDOUT_RATIO;

  const sessions = [...new Set(samples.map((s) => s.m.sessionId))].sort();

  // 用 seed xor sessionHash 决定是否进入 holdout
  const holdout = new Set();
  for (const sid of sessions) {
    const h = _hashString(sid + ':' + seed);
    if ((h % 1000) / 1000 < holdoutRatio) {
      holdout.add(sid);
    }
  }

  const training = samples.filter((s) => !holdout.has(s.m.sessionId));
  const validation = samples.filter((s) => holdout.has(s.m.sessionId));

  return {
    training,
    validation,
    metadata: {
      seed,
      holdoutRatio,
      totalSessions: sessions.length,
      holdoutSessions: [...holdout].sort(),
      trainingSessions: sessions.length - holdout.size,
      trainingSamples: training.length,
      validationSamples: validation.length,
      splitMethod: 'session-level-deterministic-hash',
    },
  };
}

export function sampleLabel(s) {
  return trainingLabelOf(s);
}
