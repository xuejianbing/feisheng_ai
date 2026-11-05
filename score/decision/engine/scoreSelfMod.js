/*
 * ============================================
 * // 作者：飛昇原創
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 积分自修改器（多维度版） =================
 * 多维度评估每次出牌的效果，自动调整积分：
 *   ① 直接收益：HP变化 / 手牌变化 / 装备变化
 *   ② 局势收益：用牌前后优势差
 *   ③ 对手反应：对手付出的代价（无懈/闪/桃/掉血）
 *   ④ 阵营收益：对己方的贡献 / 对敌方的打击
 *   ⑤ 时机收益：用牌时机是否合理
 * 综合以上 5 个维度，计算综合收益，再调整积分。
 */
import { log } from '../../foundation/diag/logger.js';
import { safeGet as _lsGet, safeSet as _lsSet, safeRemove as _lsRemove } from '../../foundation/storage/storage.js';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */

const STORE_KEY = 'djsc_score_selfmod_v3';
const MAX_ADJUST_PER_RULE = 0.5;
const MAX_TOTAL_ADJUST = 0.5;

/* ★ 统一维度权重表：单一事实来源，避免散落硬编码 */
const DIM_WEIGHTS = {
    /* _dimDirect 内部小项 */
    direct: { hp: 0.4, hand: 0.3, equip: 0.2, damage: 0.1 },
    /* _dimReaction 内部小项 */
    reaction: { wuxie: 0.3, shan: 0.2, tao: 0.2, lostHp: 0.3 },
    /* _dimFaction 内部小项 */
    faction: { allyBenefit: 0.5, enemyHarm: 0.3, selfHarm: -0.2 },
    /* _dimTiming 内部小项 */
    timing: { early: 0.2, keyMoment: 0.5, late: -0.3 },
    /* _computeScore 合成主权重 */
    compose: { direct: 0.3, situation: 0.25, reaction: 0.2, faction: 0.15, timing: 0.1 },
};
/* 样本衰减下限：观察 1 次时单次调整降到该比例，抑制早期噪声带偏 */
const MIN_SAMPLE_DECAY = 0.35;

let STORE = {
    v: 3,
    overrides: {},
    obs: {}, /* cardId → 观察次数，供样本数衰减 */
    stats: {
        total: 0,
        successes: 0,
        failures: 0,
        byDimension: { direct: 0, situation: 0, reaction: 0, faction: 0, timing: 0 },
    },
};
let _loaded = false;

function _load() {
    try {
        if (_loaded) return;
        const raw = _lsGet(STORE_KEY);
        if (raw) {
            const obj = JSON.parse(raw);
            if (obj && obj.v === 3) STORE = obj;
        }
        _loaded = true;
    } catch (e) { _loaded = true; }
}
function _save() {
    try { _lsSet(STORE_KEY, JSON.stringify(STORE)); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= 维度 1：直接收益 ================= */
function _dimDirect(outcome) {
    /* 返回 -1 ~ 1 */
    let score = 0;
    const weights = DIM_WEIGHTS.direct;

    /* HP 变化 */
    if (outcome.hpDelta !== undefined) {
        score += outcome.hpDelta * weights.hp;
    }

    /* 手牌变化 */
    if (outcome.handDelta !== undefined) {
        score += outcome.handDelta * 0.5 * weights.hand;
    }

    /* 装备变化 */
    if (outcome.equipDelta !== undefined) {
        score += outcome.equipDelta * weights.equip;
    }

    /* 造成伤害 */
    if (outcome.damageDealt !== undefined) {
        score += outcome.damageDealt * weights.damage;
    }

    return Math.max(-1, Math.min(1, score));
}

/* ================= 维度 2：局势收益 ================= */
function _dimSituation(beforeSituation, afterSituation) {
    /* 返回 -1 ~ 1 */
    if (beforeSituation === undefined || afterSituation === undefined) return 0;
    const delta = afterSituation - beforeSituation;
    return Math.max(-1, Math.min(1, delta));
}

/* ================= 维度 3：对手反应 ================= */
function _dimReaction(outcome) {
    /* 返回 -1 ~ 1 */
    let score = 0;
    const weights = DIM_WEIGHTS.reaction;

    /* 对手用了无懈 → 说明威胁大 */
    if (outcome.opponentWuxie) {
        score += 1 * weights.wuxie;
    }

    /* 对手用了闪 → 说明这张牌有威胁 */
    if (outcome.opponentShan) {
        score += 0.8 * weights.shan;
    }

    /* 对手用了桃 → 说明这张牌打疼了 */
    if (outcome.opponentTao) {
        score += 0.9 * weights.tao;
    }

    /* 对手掉血了 → 直接收益 */
    if (outcome.opponentLostHp !== undefined) {
        score += outcome.opponentLostHp * weights.lostHp;
    }

    return Math.max(-1, Math.min(1, score));
}

/* ================= 维度 4：阵营收益 ================= */
function _dimFaction(outcome) {
    /* 返回 -1 ~ 1 */
    let score = 0;
    const weights = DIM_WEIGHTS.faction;

    /* 对队友有帮助 */
    if (outcome.allyBenefit !== undefined) {
        score += outcome.allyBenefit * weights.allyBenefit;
    }

    /* 对敌人造成伤害 */
    if (outcome.enemyHarm !== undefined) {
        score += outcome.enemyHarm * weights.enemyHarm;
    }

    /* 自己受损 */
    if (outcome.selfHarm !== undefined) {
        score += outcome.selfHarm * weights.selfHarm;
    }

    return Math.max(-1, Math.min(1, score));
}

/* ================= 维度 5：时机收益 ================= */
function _dimTiming(outcome) {
    /* 返回 -1 ~ 1 */
    let score = 0;
    const weights = DIM_WEIGHTS.timing;

    /* 用得早（回合前期） */
    if (outcome.timing === 'early') {
        score += weights.early;
    }

    /* 关键时刻（击杀/救队友） */
    if (outcome.keyMoment) {
        score += weights.keyMoment;
    }

    /* 用得太晚（已经结束了） */
    if (outcome.timing === 'late') {
        score += weights.late;
    }

    return Math.max(-1, Math.min(1, score));
}

/* ================= 综合计算 ================= */
function _computeScore(beforeSituation, afterSituation, outcome) {
    const dims = {
        direct: _dimDirect(outcome),
        situation: _dimSituation(beforeSituation, afterSituation),
        reaction: _dimReaction(outcome),
        faction: _dimFaction(outcome),
        timing: _dimTiming(outcome),
    };

    /* 加权平均 */
    const weights = DIM_WEIGHTS.compose;
    let total = 0;
    let totalW = 0;
    Object.keys(dims).forEach(function (k) {
        total += dims[k] * weights[k];
        totalW += weights[k];
    });

    const avg = total / totalW;
    return { score: avg, dims: dims };
}

/* ================= 获取某张牌的当前积分（基础 + 自修改） ================= */
export function getCardScore(id, baseScore) {
    try {
        _load();
        const ov = STORE.overrides[id];
        if (!ov) return baseScore;
        return Math.round(baseScore * (1 + ov) * 100) / 100;
    } catch (e) { return baseScore; }
}

/* ================= 观察一次使用结果，多维度调整积分 ================= */
export function observeCardUse(id, beforeSituation, afterSituation, outcome) {
    try {
        _load();
        STORE.stats.total++;

        const result = _computeScore(beforeSituation, afterSituation, outcome);
        const score = result.score;

        /* 样本数衰减：同一张牌观察越多，单次调整越收敛，抑制早期噪声带偏 */
        STORE.obs[id] = (STORE.obs[id] || 0) + 1;
        const decay = Math.max(MIN_SAMPLE_DECAY, 1 / Math.sqrt(STORE.obs[id]));

        /* 综合得分 → 调整量：score ∈ [-1, 1] → adjust ∈ [-0.2, 0.2]，再乘样本衰减 */
        let adjust = score * 0.2 * decay;

        /* 单次调整限制 */
        adjust = Math.max(-MAX_ADJUST_PER_RULE, Math.min(MAX_ADJUST_PER_RULE, adjust));

        /* 应用到 override */
        const cur = STORE.overrides[id] || 0;
        let newVal = cur + adjust;

        /* 累计调整限制 */
        newVal = Math.max(-MAX_TOTAL_ADJUST, Math.min(MAX_TOTAL_ADJUST, newVal));

        STORE.overrides[id] = Math.round(newVal * 1000) / 1000;
        STORE.stats.successes++;

        /* 记录各维度统计 */
        Object.keys(result.dims).forEach(function (k) {
            STORE.stats.byDimension[k] = (STORE.stats.byDimension[k] || 0) + Math.round(result.dims[k] * 100) / 100;
        });

        _save();

        log.info('scoreSelfMod', id + ' 积分调整：' + (cur > 0 ? '+' : '') +
                 cur.toFixed(3) + ' → ' + newVal.toFixed(3) +
                 '（综合分 ' + score.toFixed(2) +
                 '，直接 ' + result.dims.direct.toFixed(2) +
                 '，局势 ' + result.dims.situation.toFixed(2) +
                 '，对手 ' + result.dims.reaction.toFixed(2) +
                 '，阵营 ' + result.dims.faction.toFixed(2) +
                 '，时机 ' + result.dims.timing.toFixed(2) + '）');
    } catch (e) {
        STORE.stats.failures++;
        _save();
    }
}

/* ================= 兼容旧接口（单维度） ================= */
export function observeCardUseSimple(id, outcome) {
    /* 兼容旧调用：只传 outcome，不传局势 */
    return observeCardUse(id, undefined, undefined, outcome);
}

/* ================= 获取所有调整 ================= */
export function listOverrides() {
    _load();
    return Object.keys(STORE.overrides).map(function (id) {
        return {
            id: id,
            adjust: STORE.overrides[id],
            percent: Math.round(STORE.overrides[id] * 100) + '%',
        };
    }).sort(function (a, b) { return b.adjust - a.adjust; });
}

/* ================= 手动调整 ================= */
export function manualAdjust(id, adjust) {
    try {
        _load();
        const cur = STORE.overrides[id] || 0;
        let newVal = cur + adjust;
        newVal = Math.max(-MAX_TOTAL_ADJUST, Math.min(MAX_TOTAL_ADJUST, newVal));
        STORE.overrides[id] = Math.round(newVal * 1000) / 1000;
        _save();
        log.info('scoreSelfMod', '手动调整 ' + id + '：' + cur.toFixed(3) + ' → ' + newVal.toFixed(3));
        return STORE.overrides[id];
    } catch (e) { return null; }
}

/* ================= 重置单个 ================= */
export function resetOverride(id) {
    try {
        _load();
        delete STORE.overrides[id];
        _save();
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= 统计 ================= */
export function scoreSelfModStats() {
    _load();
    return {
        overrides: Object.keys(STORE.overrides).length,
        total: STORE.stats.total,
        successes: STORE.stats.successes,
        failures: STORE.stats.failures,
        byDimension: Object.assign({}, STORE.stats.byDimension),
        list: listOverrides(),
    };
}

export function resetScoreSelfMod() {
    STORE = {
        v: 3,
        overrides: {},
        obs: {},
        stats: { total: 0, successes: 0, failures: 0, byDimension: {} },
    };
    try { _lsRemove(STORE_KEY); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    log.info('scoreSelfMod', '积分自修改器已复位');
}

/* ================= 挂载 ================= */
if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.scoreSelfMod = {
        getScore: getCardScore,
        observe: observeCardUse,
        observeSimple: observeCardUseSimple,
        manualAdjust: manualAdjust,
        reset: resetOverride,
        list: listOverrides,
        stats: scoreSelfModStats,
        resetAll: resetScoreSelfMod,
    };
}
_load();
