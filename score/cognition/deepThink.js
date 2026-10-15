import { decisionActionSnapshot } from '../decision/analysis/decisionStages.js?v=41a';
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
import { FEATURE_DIM } from '../model/features/features.js?v=41a';
import { isReady as weightsReady } from '../model/weights/weights.js?v=41a';
import { normalizedMargin, candidateSpread, DECISION_MARGIN } from '../decision/state/decisionMargin.js?v=41a';
import { isCandidateEligible, sameCandidatePolicyBand } from '../decision/state/actionCandidate.js?v=41a';
import { probHasShan, probHasWuxie, probHasSha } from '../model/predict/handInference.js?v=41a';
import { evaluateSituation } from './situationEval.js?v=41a';

const TOP_N = 3;           /* 深度辨析的候选数量上限（防放大算力开销） */
const MODEL_SPREAD_SHARE = 0.35;  /* 模型证据最多只占当前候选 spread 的一部分 */
const RISK_SPREAD_SHARE = 0.15;   /* 风险项同样按候选 spread 缩放，避免固定分值污染 */
const COUNTER_SPREAD_SHARE = 0.20;  /* 反制推演：对手能否化解该动作（手牌推断），按 spread 缩放 */
const SITUATION_SPREAD_SHARE = 0.10; /* 局面适配复核：优势保守/劣势激进，按 spread 缩放 */

const _stats = { runs: 0, deepChecks: 0, replaced: 0, skippedNotReady: 0, lastGap: 0, lastMargin: 0, mode: '深度思考' };

function _num(x) { return (typeof x === 'number' && Number.isFinite(x)) ? x : 0; }

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
		if (r && Number.isFinite(r.maxProb)) return Math.max(0,Math.min(1,r.maxProb));
		if (r && Array.isArray(r.probs)) return Math.max(0,...r.probs.filter(Number.isFinite).map(p=>Math.min(1,p)));
		return 0;
	} catch (e) { return 0; }
}

// Only verified additional risk may enter this comparison; core costs are already scored.
export function incrementalRiskSeverity(candidate) {
 const e=candidate?.incrementalRiskEvidence;
 if(!e||e.schema!=='incremental-risk-v1'||e.status!=='confirmed'||!e.source||e.additional!==true||e.alreadyScored!==false||!Number.isFinite(e.severity))return 0;
 return Math.max(0,Math.min(1,e.severity));
}

/* ★ 深化 head 1：反制推演 —— 推演对手能否化解该动作（返回化解概率 0~1） */
function _counterResistance(me, a) {
	try {
		if (!me || !a || a.type !== 'card') return 0;
		const target = a.targetObj || (a.target && typeof a.target === 'object' ? a.target : null);
		if (!target) return 0;
		const id = a.id;
		if (id === 'sha') return probHasShan(target);            /* 杀 → 闪化解 */
		if (id === 'juedou') return probHasSha(target);          /* 决斗 → 对方杀回应 */
		if (id === 'shunshou' || id === 'guohe' || id === 'huogong' || id === 'tiesuo') return probHasWuxie(target); /* 无懈可击 */
		return 0;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); return 0; }
}

/* ★ 深化 head 2：局面适配复核 —— 动作是否契合当前优劣势（返回 -1~1，正=契合） */
function _situationFit(a, situation) {
	try {
		if (!a) return 0;
		const id = a.id;
		const atk = ['sha', 'juedou', 'huogong', 'nanman', 'wanjian'].indexOf(id) >= 0;
		const def = ['shan', 'tao', 'wuxie'].indexOf(id) >= 0;
		if (situation <= -0.3) {          /* 劣势 → 激进 */
			if (atk) return 1;
			if (def) return -1;
		} else if (situation >= 0.3) {     /* 优势 → 保守 */
			if (def) return 1;
			if (atk) return -1;
		}
		return 0;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); return 0; }
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
	const out = { best: best, replaced: false, thinking: [], reason: '', evidence: {domain:'deep-comparison',status:'skipped',rows:[]} };
	try {
		if (!best || !Number.isFinite(best.score) || !Array.isArray(acts) || acts.length < 2) {
			out.evidence.reason='insufficient-candidates';
            out.thinking.push('候选不足，跳过深度思考');
			return out;
		}

		/* P0 fail-closed：模型未就绪时，本层没有改写最终决策的资格。
		 * 不能退化成“规则分-风险”再排一次，否则 deepThink 仍可能越权推翻规则/冠军策略。 */
		if (!weightsReady()) {
			_stats.skippedNotReady++;
			out.evidence.reason='model-not-ready';
            out.thinking.push('模型未就绪：跳过模型深度思考，不允许改写当前决策');
			return out;
		}

		/* 候选按规则分排序，取次优作对照 */
		const sorted = acts.slice().filter(function (a) {
			return a && a !== best && isCandidateEligible(a) &&
				sameCandidatePolicyBand(a, best) && Number.isFinite(a.score);
		}).sort(function (a, b) { return b.score-a.score; });
		if (!sorted.length) {
			out.evidence.reason='no-compatible-alternative';
            out.thinking.push('无对照候选，跳过深度思考');
			return out;
		}

		const gap = _num(best.score) - _num(sorted[0].score);
		const margin = normalizedMargin(best.score, sorted[0].score);
        out.evidence.margin=margin;
        out.evidence.contrast=decisionActionSnapshot(sorted[0]);
		_stats.lastGap = gap;
		_stats.lastMargin = margin;

		/* 是否需要复核只看相对决策边际，不依赖 runtime utility 的绝对量纲。 */
		if (margin > DECISION_MARGIN.CLOSE) {
            out.evidence.reason='clear-margin';
			out.thinking.push('浅思考通过：相对边际=' + margin.toFixed(3) + '，当前结论清晰，无需深度辨析');
			return out;
		}

		/* 进入深度思考 */
		_stats.deepChecks++;
		out.thinking.push('进入深度思考：best 与次优相对边际=' + margin.toFixed(3) + '，需多源复盘');
		const cands = [best].concat(sorted.slice(0, TOP_N - 1));
		return _deepEvaluate(me, cands, best, out, ctx);
	} catch (e) {
		out.evidence.status='error';out.evidence.reason=String(e);
        out.thinking.push('深度思考异常: ' + String(e).slice(0, 40));
		return out;
	}
}

/* 多源聚合打分（规则 + 模型置信 − 风险 − 反制 + 局面适配），批判性重新排序 */
function _deepEvaluate(me, cands, best, out, ctx) {
	try {
		const spread = candidateSpread(cands);
		const modelBudget = spread.absolute * MODEL_SPREAD_SHARE;
		const riskBudget = spread.absolute * RISK_SPREAD_SHARE;
		const counterBudget = spread.absolute * COUNTER_SPREAD_SHARE;
		const situationBudget = spread.absolute * SITUATION_SPREAD_SHARE;
		/* 局面只算一次，避免对每个候选重复遍历 */
		const situation = evaluateSituation(me);

		const scored = cands.map(function (a) {
			const rule = _num(a.score);
			const modelP = _modelConfidenceOf(a._feat) || (a === best ? _num(ctx && ctx.modelP) : 0);
			const modelEvidence = modelP > 0 ? Math.max(-1, Math.min(1, (modelP - 0.5) * 2)) : 0;
			const modelAdj = modelEvidence * modelBudget;
			const riskSeverity = incrementalRiskSeverity(a);
			const riskAdj = riskSeverity * riskBudget;
			/* ★ 深化：反制推演负向打折 + 局面适配复核 */
			const counterProb = Math.max(0, Math.min(1, _counterResistance(me, a)));
			const counterAdj = counterProb * counterBudget;
			const situationFit = Math.max(-1, Math.min(1, _situationFit(a, situation)));
			const situationAdj = situationFit * situationBudget;
			return {
				a: a,
				rule: rule,
				modelP: modelP,
				modelAdj: modelAdj,
				riskAdj: riskAdj,
				counterAdj: counterAdj,
				situationAdj: situationAdj,
				deep: rule + modelAdj - riskAdj - counterAdj + situationAdj,
			};
		}).sort(function (x, y) { return y.deep - x.deep; });

        out.evidence.status='evaluated';
        out.evidence.modelBudget=modelBudget;out.evidence.riskBudget=riskBudget;
        out.evidence.rows=scored.map(row=>({action:decisionActionSnapshot(row.a),rule:row.rule,modelProbability:row.modelP,modelAdjustment:row.modelAdj,riskAdjustment:row.riskAdj,riskSource:incrementalRiskSeverity(row.a)>0?String(row.a.incrementalRiskEvidence.source):null,comparisonScore:row.deep}));
		for (let i = 0; i < scored.length; i++) {
			const row = scored[i];
			out.thinking.push('  候选' + (i + 1) + ' ' + (row.a.type || '?') + ':' + (row.a.id || '?') +
				'  规则' + row.rule.toFixed(2) + ' 模型+' + row.modelAdj.toFixed(2) +
				' 风险-' + row.riskAdj.toFixed(2) + ' 反制-' + row.counterAdj.toFixed(2) +
				' 局面' + (row.situationAdj >= 0 ? '+' : '') + row.situationAdj.toFixed(2) +
				' → 深度' + row.deep.toFixed(2));
		}

		const winner = scored[0];
		const original = scored.find(function (row) { return row.a === best; });
		if (winner && winner.a !== best) {
			out.replaced = true;
			out.best = winner.a;
			/* 汇总各 head 相对增益，识别改判主因 */
			const dModel = original ? (winner.modelAdj - original.modelAdj) : winner.modelAdj;
			const dRisk = original ? (original.riskAdj - winner.riskAdj) : -winner.riskAdj;
			const dCounter = original ? (original.counterAdj - winner.counterAdj) : -winner.counterAdj;
			const dSit = original ? (winner.situationAdj - original.situationAdj) : winner.situationAdj;
			const gains = [['模型证据改善', dModel], ['风险收益更优', dRisk], ['反制阻力更小', dCounter], ['局面更契合', dSit]];
			gains.sort(function (x, y) { return y[1] - x[1]; });
			const why = gains[0][1] > 0 ? gains[0][0] : '多源综合更优';
			out.reason = '深度思考裁定改打 ' + (winner.a.id || '?') +
				'（margin=' + _stats.lastMargin.toFixed(3) + '·' + why + '）';
			_stats.replaced++;
			out.thinking.push('结论：应以 ' + (winner.a.id || '?') + ' 替代当前，原因：' + why);
		} else {
			out.thinking.push('结论：维持当前 ' + (best.id || '?') + ' 最优');
		}
		return out;
	} catch (e) {
		out.evidence.status='error';out.evidence.reason=String(e);
        out.thinking.push('深度评估异常: ' + String(e).slice(0, 40));
		return out;
	}
}

export function thinkingStats() {
	try { return { runs: _stats.runs, deepChecks: _stats.deepChecks, replaced: _stats.replaced, skippedNotReady: _stats.skippedNotReady, lastGap: _stats.lastGap, mode: '深度思考' }; }
	catch (e) { return { mode: '深度思考' }; }
}