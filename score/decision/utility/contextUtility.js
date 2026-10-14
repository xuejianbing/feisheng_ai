/* 相关上下文估计合并为有界修正，不能把完整估分重复加到EV上。 */
import { applyOwnedUtility } from './utilityPipeline.js?v=5e5';

export function readScopedCardOverride(meta, player, target, now = Date.now()) {
 const ov = meta && meta.__djsc_override;
 if (!ov || !Number.isFinite(ov.score) || !Number.isFinite(ov.ts) || now < ov.ts || now - ov.ts > 1500) return null;
 // 使用实例引用；旧的武将名或无来源信号只留在宿主，不能污染当前候选。
 if (!player || ov.playerRef !== player || ov.targetRef !== target) return null;
 return { score: ov.score, weight: Number.isFinite(ov.weight) ? ov.weight : 1.2, reason: String(ov.reason || '') };
}

export function applyOptimizationEvidence(candidate, override) {
 if (!candidate || candidate.type !== 'card' || !override) return false;
 // result.target是目标视角且量纲不统一；包括已经计入攻击EV的命中率。
 // 当前只记录，等有独立增量和方向契约后才允许写分。
 return applyOwnedUtility(candidate, 'optimizationEvidence', [{ dimension: 'uncertainty', delta: 0,
  note: '宿主完整估分：方向/量纲未统一，仅留作对账，不重复加入EV',
  details: { rawScore: override.score, weight: override.weight, reason: override.reason, scoring: false } }]);
}

export function styleRatio(id, style) {
 if (!style) return 1;
 if (style.tag === 'aggressive' && ['shan','tao','jiu','wuxie','exjiu'].includes(id)) return 1.2;
 if (style.tag === 'vengeful' && ['sha','juedou','huogong','guohe','shunshou'].includes(id)) return 0.85;
 if (style.tag === 'cautious' && ['sha','juedou','huogong'].includes(id)) return 1.1;
 return 1;
}

/* 只合并有效且非中性的估计；未知/关闭模块返回1，不稀释实际信号。
 * 各项共享同一基准，均值代替连乘；负分上的正向提示也应提高分数。
 * 修正不超过原分的25%且不超过1.5，不能把原有负收益反转为正收益。 */
export function applyContextUtility(candidate, source, dimension, signals) {
 if (!candidate || candidate.type !== 'card' || candidate.id === 'tiesuo') return false;
 const base = Number(candidate.utilityBaseScore ?? candidate.score);
 if (!Number.isFinite(base)) return false;
 const active = Object.entries(signals || {}).filter(([, r]) => Number.isFinite(r) && r > 0 && r !== 1);
 const limit = Math.min(Math.abs(base) * 0.25, 1.5);
 const rates = active.map(([name, ratio]) => ({ name, ratio, rate: Math.max(-0.25, Math.min(0.25, ratio - 1)) }));
 const sum = rates.reduce((s, r) => s + r.rate, 0);
 const raw = rates.length ? Math.abs(base) * sum / rates.length : 0;
 const total = Math.max(-limit, Math.min(limit, raw));
 const scale = raw ? total / raw : 1;
 const terms = rates.map(r => ({ dimension, delta: Math.abs(base) * r.rate / rates.length * scale,
  note: r.name, details: { ratio: r.ratio, baseScore: base, estimatorCount: rates.length, aggregation: 'mean', limit } }));
 if (!terms.length) terms.push({ dimension, delta: 0, note: '无有效非中性上下文修正', details: { estimatorCount: 0 } });
 return applyOwnedUtility(candidate, source, terms);
}
