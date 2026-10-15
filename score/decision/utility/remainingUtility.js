import { applyOwnedUtility } from './utilityPipeline.js?v=41a';

export function createBaselineUtilitySeed(score, source, dimension, details = {}) {
 if (!Number.isFinite(score)) throw new TypeError('Invalid baseline');
 const seed = { score: 0 };
 applyOwnedUtility(seed, source, [{ dimension, delta: score, note: '独占基础估计，不再次叠加完整估分', details }]);
 return seed;
}

/* 后处理只提交建议，不连续修改已扣成本的分数。每个模块读取同一基准；
 * 同维度相关建议取最强正项与最强负项，替代多次连乘/重复相加。 */
export function applyCommonUtilitySuggestions(candidates, stages) {
 const rows = (candidates || []).filter(a => a && a.type !== 'end' && a.id !== 'tiesuo' && !a.utilityVector?.ownedSources?.includes('commonContext'));
 if (!rows.length) return candidates;
 const proposals = new Map(rows.map(a => [a, []]));
 for (const stage of stages || []) {
  const shadows = rows.map(a => ({ ...a, score: a.utilityBaseScore ?? a.score, targetList: a.targetList?.slice(), policy: a.policy ? { ...a.policy, vetoReasons: [...(a.policy.vetoReasons || [])] } : undefined }));
  try { stage.run(shadows); } catch (_) { for (const candidate of rows) { (candidate.commonUtilityErrors ||= []).push(stage.source); } continue; }
  shadows.forEach((shadow, index) => {
   const original = rows[index], base = Number(original.utilityBaseScore ?? original.score), next = Number(shadow.score);
   if (!Number.isFinite(base) || !Number.isFinite(next)) return;
   // 名称/说明/画像供诊断；目标、policy、动作身份不能通过评分建议偷偷改写。
   for (const key of ['mode', 'characterAlignment']) if (shadow[key] !== undefined) original[key] = shadow[key];
   proposals.get(original).push({ source: stage.source, dimension: stage.dimension, delta: next - base });
  });
 }
 for (const candidate of rows) {
  const groups = new Map();
  for (const p of proposals.get(candidate)) {
   if (!groups.has(p.dimension)) groups.set(p.dimension, []);
   groups.get(p.dimension).push(p);
  }
  const limit = Math.min(Math.abs(candidate.utilityBaseScore ?? candidate.score) * .25, 1.5);
  const terms = [];
  for (const [dimension, list] of groups) {
   const positive = list.reduce((a,b) => b.delta > a.delta ? b : a, { delta: 0, source: '' });
   const negative = list.reduce((a,b) => b.delta < a.delta ? b : a, { delta: 0, source: '' });
   const delta = Math.max(-limit, Math.min(limit, positive.delta + negative.delta));
   terms.push({ dimension, delta, note: '同维度建议取最强正/负项', details: { positiveSource: positive.source, negativeSource: negative.source, positive: positive.delta, negative: negative.delta, estimatorCount: list.length, aggregation: 'extrema', limit } });
  }
  if (candidate.commonUtilityErrors?.length) terms.push({ dimension: 'uncertainty', delta: 0, note: '故障模块建议未采纳', details: { failedSources: candidate.commonUtilityErrors.join(',') } });
  applyOwnedUtility(candidate, 'commonContext', terms);
 }
 return candidates;
}

/* 方向守卫不重复添加已经为负的基础分，更不按武将名解析多目标。 */
export function applyDirectionUtility(me, candidate, evaluate) {
 if (!candidate || candidate.type === 'end' || candidate.id === 'tiesuo') return false;
 const targets = candidate.targetList?.length ? candidate.targetList : candidate.targetObj ? [candidate.targetObj] : candidate.target ? [candidate.target] : [];
 let ceiling = 0;
 for (const target of targets) {
  const val = evaluate(me, { id: candidate.id, type: candidate.type, purpose: candidate.purpose, target, targetObj: typeof target === 'object' ? target : undefined, base: 0 });
  if (Number.isFinite(val) && val < ceiling) ceiling = val;
 }
 const delta = ceiling < 0 ? Math.min(0, ceiling - candidate.score) : 0;
 return applyOwnedUtility(candidate, 'actionDirectionGuard', [{ dimension: 'team', delta, note: '方向违规收益上限', details: { ceiling, aggregation: 'ceiling', targetCount: targets.length } }]);
}

export function applyTransitionUtility(candidate, penalty) {
 if (!Number.isFinite(penalty) || penalty < 0) return false;
 return applyOwnedUtility(candidate, 'strategicTransition', [{ dimension: 'opportunityCost', delta: -penalty, note: '真实状态撤销代价，不猜测目标隐藏手牌', details: { penalty } }]);
}

export function establishUtilityReference(candidate) {
 Object.defineProperty(candidate, 'utilityBaseScore', { value: Number(candidate.score), writable: true, configurable: true, enumerable: false });
 return candidate;
}
