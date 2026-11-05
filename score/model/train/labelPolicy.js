/*
 * ================= 训练标签策略 · 单一真相源 =================
 * 所有训练入口（本地训练 / A-B 候选热训练 / 离线默认权重训练）
 * 必须通过本文件把 reward score 映射到 A-F 标签。
 *
 * 约束：
 *   A >= 80
 *   B 30..79
 *   C 0..29
 *   D -30..-1
 *   E -80..-31
 *   F < -80
 *
 * 禁止在其他训练模块复制阈值，避免 Stable / Candidate / Default 学习不同语义。
 */

export const SCORE_LABELS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F']);
export const SCORE_THRESHOLDS = Object.freeze([80, 30, 0, -30, -80]);
export const SCORE_BOUND = 147;

/**
 * reward score -> 模型标签下标 0..5。
 * 非有限数返回 null，调用方必须跳过该样本。
 */
export function scoreToLabel(score) {
    if (typeof score !== 'number' || !Number.isFinite(score)) return null;

    if (score > SCORE_BOUND) score = SCORE_BOUND;
    else if (score < -SCORE_BOUND) score = -SCORE_BOUND;

    if (score >= SCORE_THRESHOLDS[0]) return 0;  // A 极好
    if (score >= SCORE_THRESHOLDS[1]) return 1;  // B 好
    if (score >= SCORE_THRESHOLDS[2]) return 2;  // C 一般/正收益
    if (score >= SCORE_THRESHOLDS[3]) return 3;  // D 差
    if (score >= SCORE_THRESHOLDS[4]) return 4;  // E 很差
    return 5;                                    // F 极差
}

/**
 * 已编码 label -> 0..5。
 * 仅用于确实已经是标签的兼容数据；绝不能拿 reward score 调这个函数。
 */
export function normalizeLabelIndex(label) {
    if (typeof label === 'number' && Number.isInteger(label) && label >= 0 && label < SCORE_LABELS.length) {
        return label;
    }
    if (typeof label === 'string') {
        const s = label.trim().toUpperCase();
        const byName = SCORE_LABELS.indexOf(s);
        if (byName >= 0) return byName;

        const n = Number(s);
        if (Number.isInteger(n) && n >= 0 && n < SCORE_LABELS.length) return n;
    }
    return null;
}
