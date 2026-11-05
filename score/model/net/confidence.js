/*
 * ============================================
 * // Éditeur: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 置信度评估 ================= */
import { forward, softmax, isReady, LABELS } from '../weights/weights.js';  /* ★ LABELS：标签语义单一来源，杜绝硬编码 A-F 数组漂移 */

const HIGH_CONF = 0.3;
const MID_CONF  = 0.6;

export function confidenceOf(probs) {
    try {
        if (!probs || !probs.length) return 0;
        let entropy = 0;
        for (let i = 0; i < probs.length; i++) {
            const p = probs[i];
            if (p > 1e-9) entropy -= p * Math.log(p);
        }
        const maxEntropy = Math.log(probs.length);
        return maxEntropy > 0 ? 1 - entropy / maxEntropy : 1;
    } catch (e) { return 0; }
}

export function evaluateConfidence(features) {
    try {
        if (!isReady()) return { level: 'none', confidence: 0, action: 'skip', probs: null, label: null };
        const logits = forward(features);
        if (!logits) return { level: 'none', confidence: 0, action: 'skip', probs: null, label: null };
        const probs = softmax(logits);
        const conf = confidenceOf(probs);
        /* 最大概率下标 = 模型推荐标签 */
        let maxIdx = 0, maxP = 0;
        for (let i = 0; i < probs.length; i++) if (probs[i] > maxP) { maxP = probs[i]; maxIdx = i; }
        let level = 'low', action = 'rule';
        if (conf >= 1 - HIGH_CONF) { level = 'high'; action = 'model'; }
        else if (conf >= 1 - MID_CONF) { level = 'mid'; action = 'blend'; }
        return {
            level, action,
            confidence: Math.round(conf * 1000) / 1000,
            label: LABELS[maxIdx],   /* ★ 标签语义取自 weights.LABELS 单一来源 */
            probs: Array.from(probs),
        };
    } catch (e) {
        return { level: 'none', confidence: 0, action: 'skip', probs: null, label: null };
    }
}

export function blendScore(ruleScore, modelScore, conf) {
    const w = Math.max(0.1, Math.min(0.7, conf));
    return ruleScore * (1 - w) + modelScore * w;
}

if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    /* ★ 接口统一：单一权威 confidence 由 engine/weights 的 predict(最大概率) 挂载，
     * 本模块绝不覆盖；熵置信版本改挂独立名 evaluateConfidence，供需要时调用。 */
    if (!window.__DJSC.confidence) {
        window.__DJSC.confidence = evaluateConfidence;
    }
    window.__DJSC.evaluateConfidence = evaluateConfidence;
    window.__DJSC.confidenceOf = confidenceOf;
    window.__DJSC.blendScore = blendScore;
}
