/*
 * ============================================
 * // 作者：飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 深度思考 · 模型思考层 =================
 * 职责边界（架构明确定义）：
 *   - 模型只负责与"思考/推演"相关的事：对候选动作做批判性深度复核，产出思维链。
 *   - 其余成片（冠军策略定夺、全场监控、样本训练、身份/威胁推断、执行接管…）
 *     全部由各自的"子代理"模块接管，本层绝不越权覆盖冠军策略的最终定夺。
 *
 * 触发：best 与次优分差很小（分歧大）时才进入深度思考，避免每次决策都消耗算力。
 * 深度思考 = 单一结论的批判性复盘：用"规则分 + 模型置信 − 风险代价"对 top 候选
 *           重新多源聚合，若推翻当前 best 则给出替代与思维链 reason。
 */

/* ★ 特征维度单一来源：直接引用 features.js 导出的 FEATURE_DIM，杜绝散落硬编码导致漂移 */
import { FEATURE_DIM } from '../model/features/features.js';
import { isReady as weightsReady } from '../model/weights/weights.js';
import { normalizedMargin, candidateSpread, DECISION_MARGIN } from '../decision/state/decisionMargin.js';
import { isCandidateEligible, sameCandidatePolicyBand } from '../decision/state/actionCandidate.js';

const TOP_N = 3;           /* 深度辨析的候选数量上限（防放大算力开销） */
const MODEL_SPREAD_SHARE = 0.35;  /* 模型证据最多只占当前候选 spread 的一部分 */
const RISK_SPREAD_SHARE = 0.15;   /* 风险项同样按候选 spread 缩放，避免固定分值污染 */

const _stats = { runs: 0, deepChecks: 0, replaced: 0, skippedNotReady: 0, lastGap: 0, lastMargin: 0, mode: '深度思考' };

function _num(x) { return (typeof x === 'number' && !isNaN(x)) ? x : 0; }

/* ★ 取某候选的模型置信(最大后验概率)，作为"模型思考证据"。只读，不改任何分数。 */
function _modelConfidenceOf(feat) {
	try {
		/* 双保险：即便有人绕过 engine 的 safeModelPredict，也不允许未就绪模型进入深度复核。 */
		if (!weightsReady()) return 0;
		const conf = window.__DJSC && window.__DJSC.confidence;
		if (!conf) return 0;
		const buf = new Int8Array(FEATURE_DIM);
		const src = (feat && typeof feat.length === 'number') ? feat : null;
		if (!src) return 0;
		for (let i = 0; i < FEATURE_DIM && i < src.length; i++) buf[i] = src[i];
		const r = conf(buf);
		if (r && typeof r.maxProb === 'number') return r.maxProb;
		if (r && Array.isArray(r.probs)) return Math.max.apply(null, r.probs) || 0;
		return 0;
	} catch (e) { return 0; }
}

/* ★ 风险代价：自身血线越低，卡牌类动作越应下调（保守），防暴毙。 */
function _riskPenalty(me, a) {
	let p = 0;
	try {
		if (!me || !a) return 0;
		const hp = _num(me.hp), max = _num(me.maxHp) || 1;
		if (a.type === 'card' && hp <= 2) {
			p = 0.5 * (3 - hp);   /* 2血-0.5、1血-1.0 */
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return p;
}

/* ================= 深度思考入口 =================
 * @param me     决策者
 * @param acts   候选动作数组
 * @param best   当前最优（已被规则/冠军子代理选出）
 * @param ctx    { modelP } 可选：已算好的 best 模型置信，省一次前向
 * @return { best, replaced, thinking:[], reason }
 */
/* eslint no-unused-vars: off */
export function criticBest(me, acts, best, ctx) {
	_stats.runs++;
	const out = { best: best, replaced: false, thinking: [], reason: '' };
	try {
		if (!best || !Array.isArray(acts) || acts.length < 2) {
			out.thinking.push('候选不足，跳过深度思考');
			return out;
		}

		/* P0 fail-closed：模型未就绪时，本层没有改写最终决策的资格。
		 * 不能退化成“规则分-风险”再排一次，否则 deepThink 仍可能越权推翻规则/冠军策略。 */
		if (!weightsReady()) {
			_stats.skippedNotReady++;
			out.thinking.push('模型未就绪：跳过模型深度思考，不允许改写当前决策');
			return out;
		}

		/* 候选按规则分排序，取次优作对照 */
		const sorted = acts.slice().filter(function (a) {
			return a && a !== best && isCandidateEligible(a) &&
				sameCandidatePolicyBand(a, best) && typeof a.score === 'number';
		}).sort(function (a, b) { return (b.score || -Infinity) - (a.score || -Infinity); });
		if (!sorted.length) {
			out.thinking.push('无对照候选，跳过深度思考');
			return out;
		}

		const gap = _num(best.score) - _num(sorted[0].score);
		const margin = normalizedMargin(best.score, sorted[0].score);
		_stats.lastGap = gap;
		_stats.lastMargin = margin;

		/* 是否需要复核只看相对决策边际，不依赖 runtime utility 的绝对量纲。 */
		if (margin > DECISION_MARGIN.CLOSE) {
			out.thinking.push('浅思考通过：相对边际=' + margin.toFixed(3) + '，当前结论清晰，无需深度辨析');
			return out;
		}

		/* 进入深度思考 */
		_stats.deepChecks++;
		out.thinking.push('进入深度思考：best 与次优相对边际=' + margin.toFixed(3) + '，需多源复盘');
		const cands = [best].concat(sorted.slice(0, TOP_N - 1));
		return _deepEvaluate(me, cands, best, out, ctx);
	} catch (e) {
		out.thinking.push('深度思考异常: ' + String(e).slice(0, 40));
		return out;
	}
}

/* 多源聚合打分（规则 + 模型置信 − 风险），批判性重新排序 */
function _deepEvaluate(me, cands, best, out, ctx) {
	try {
		const spread = candidateSpread(cands);
		const modelBudget = spread.absolute * MODEL_SPREAD_SHARE;
		const riskBudget = spread.absolute * RISK_SPREAD_SHARE;

		const scored = cands.map(function (a) {
			const rule = _num(a.score);
			const modelP = _modelConfidenceOf(a._feat) || (a === best ? _num(ctx && ctx.modelP) : 0);
			const modelEvidence = modelP > 0 ? Math.max(-1, Math.min(1, (modelP - 0.5) * 2)) : 0;
			const modelAdj = modelEvidence * modelBudget;
			const riskSeverity = Math.max(0, Math.min(1, _riskPenalty(me, a)));
			const riskAdj = riskSeverity * riskBudget;
			return {
				a: a,
				rule: rule,
				modelP: modelP,
				modelAdj: modelAdj,
				riskAdj: riskAdj,
				deep: rule + modelAdj - riskAdj,
			};
		}).sort(function (x, y) { return y.deep - x.deep; });

		for (let i = 0; i < scored.length; i++) {
			const row = scored[i];
			out.thinking.push('  候选' + (i + 1) + ' ' + (row.a.type || '?') + ':' + (row.a.id || '?') +
				'  规则' + row.rule.toFixed(2) + ' 模型调整' + row.modelAdj.toFixed(2) +
				' 风险-' + row.riskAdj.toFixed(2) + ' → 深度' + row.deep.toFixed(2));
		}

		const winner = scored[0];
		const original = scored.find(function (row) { return row.a === best; });
		if (winner && winner.a !== best) {
			out.replaced = true;
			out.best = winner.a;
			const modelGain = original ? (winner.modelAdj - original.modelAdj) : winner.modelAdj;
			const riskGain = original ? (original.riskAdj - winner.riskAdj) : -winner.riskAdj;
			const why = modelGain > riskGain ? '模型证据改善' : '风险收益更优';
			out.reason = '深度思考裁定改打 ' + (winner.a.id || '?') +
				'（margin=' + _stats.lastMargin.toFixed(3) + '·' + why + '）';
			_stats.replaced++;
			out.thinking.push('结论：应以 ' + (winner.a.id || '?') + ' 替代当前，原因：' + why);
		} else {
			out.thinking.push('结论：维持当前 ' + (best.id || '?') + ' 最优');
		}
		return out;
	} catch (e) {
		out.thinking.push('深度评估异常: ' + String(e).slice(0, 40));
		return out;
	}
}

export function thinkingStats() {
	try { return { runs: _stats.runs, deepChecks: _stats.deepChecks, replaced: _stats.replaced, skippedNotReady: _stats.skippedNotReady, lastGap: _stats.lastGap, mode: '深度思考' }; }
	catch (e) { return { mode: '深度思考' }; }
}