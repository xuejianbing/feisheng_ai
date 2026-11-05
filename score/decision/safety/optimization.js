/*
 * ============================================
 * // Wydawca: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 卡牌优化器 · 覆写信号暴露 =================
 * 作用：hook 各牌的 result.target，在原函数返回后写入 __djsc_override
 * 让 bestAction 能读到 optimization 的精细评分
 */
import { lib, game, ui, get, ai, _status } from '../../foundation/adapt/host.js';
import { log } from '../../foundation/diag/logger.js';
// Auteur: Feisheng Original | Licence: GPL-3.0
import { suitRemaining } from '../../perception/memory/deckMemory.js';
import { lebuEscapeRate, bingliangEscapeRate, shandianHitRate, cardRarity } from '../../model/predict/deckPredict.js';
import { evaluateTaoRescue } from './rescuePolicy.js';
import { isAllyOf, isEnemyOf } from '../relations/relations.js';   /* ★ 指令 05 Stage B：敌我唯一权威源 */
import { idsWithStrategicOperation } from '../../foundation/adapt/terms.js';
import { evaluateRemovalChoice } from '../state/turnStrategicState.js';

/* ================= 桃评分（唯一权威：dying 场景委托 evaluateTaoRescue） =================
 * ★ 修复：不再对「任何濒死目标」无条件 +5（旧代码 `if (dying === target) score = 5.0`）。
 *   dying 场景一律交给 evaluateTaoRescue（self+8 / ally+5 / neutral-3 / enemy-8 / invalid-8），
 *   濒死只提升紧急度，不反转敌我方向。非 dying 保留原有保守评分。 */
function _scoreTao(player, target, dyingTarget, ctx) {
    try {
        if (dyingTarget && dyingTarget === target) {
            return evaluateTaoRescue(player, target, ctx || {}).score;
        }
        if (target === player) return 1.5;
        if (isAllyOf(player, target)) return 1.0;
        return 0;
    } catch (e) { return 0; }
}

/* ================= 暴露函数 ================= */
function _exposeOverride(cardId, score, reason, weight, player) {
    try {
        if (!lib.card || !lib.card[cardId]) return;
        lib.card[cardId].__djsc_override = {
            score: score,
            reason: reason || '',
            weight: weight || 1.2,
            player: player ? (player.name1 || player.name || '?') : null,
            ts: Date.now(),
        };
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= Hook 各牌 result.target ================= */
const HOOKED_CARDS = [
    { id: 'wanjian', weight: 1.0, reason: '万箭齐发' },
    { id: 'huogong', weight: 1.2, reason: '火攻' },
    { id: 'tao', weight: 1.5, reason: '桃' },
    { id: 'juedou', weight: 1.2, reason: '决斗' },
    { id: 'shunshou', weight: 1.2, reason: '顺手牵羊' },
    { id: 'guohe', weight: 1.2, reason: '过河拆桥' },
    { id: 'nanman', weight: 1.0, reason: '南蛮入侵' },
    { id: 'sha', weight: 1.2, reason: '杀' },
    { id: 'jiu', weight: 1.0, reason: '酒' },
    { id: 'lebu', weight: 1.0, reason: '乐不思蜀' },
    { id: 'bingliang', weight: 1.0, reason: '兵粮寸断' },
];

function installOptimizationHooks() {
    try {
        HOOKED_CARDS.forEach(function (cfg) {
            const cardMeta = lib.card && lib.card[cfg.id];
            if (!cardMeta) return;
            if (!cardMeta.result) cardMeta.result = {};
            if (cardMeta.result.__djsc_hooked) return;

            const origTarget = cardMeta.result.target;
            if (typeof origTarget !== 'function') return;

            cardMeta.result.target = function (player, target) {
                try {
                    const result = origTarget.call(this, player, target);

                    /* ★ 桃特殊处理：濒死场景走唯一权威策略，只在真有救援价值时给分 */
                    if (cfg.id === 'tao') {
                        const dying = _status.event && _status.event.dying;
                        const score = _scoreTao(player, target, dying, null);
                        _exposeOverride(cfg.id, score, cfg.reason + '.' + (dying === target ? 'dying' : 'normal'), cfg.weight, player);
                        return result;
                    }

                    /* ★ 南蛮/万箭残局阈值 */
                    if (cfg.id === 'nanman' || cfg.id === 'wanjian') {
                        let score = (typeof result === 'number') ? result : 0;

                        /* 藤甲：AOE 无效 */
                        try {
                            let hasTengjia = false;
                            try { hasTengjia = target.hasSkillTag && target.hasSkillTag('tengjia'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                            if (!hasTengjia) {
                                try {
                                    hasTengjia = target.getCards('e').some(function (eq) {
                                        return get.name(eq) === 'tengjia';
                                    });
                                } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                            }
                            if (hasTengjia) {
                                _exposeOverride(cfg.id, 0, cfg.reason + '.tengjia', cfg.weight, player);
                                return 0;
                            }
                        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

                        /* 残局倍率：场上 ≤4 人时，AOE 伤害的边际价值大幅提升 */
                        try {
                            const alive = (game.players || []).filter(function (p) {
                                return p && p.alive !== false;
                            }).length;
                            let threshold = 1.0;
                            if (alive <= 2) threshold = 1.8;
                            else if (alive <= 4) threshold = 1.4;
                            else if (alive <= 6) threshold = 1.15;
                            score = score * threshold;
                        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

                        score = Math.round(score * 100) / 100;
                        _exposeOverride(cfg.id, score, cfg.reason + '.endgame', cfg.weight, player);
                        return score;
                    }

                    /* ★ 乐不思蜀：牌堆感知逃脱率 */
                    if (cfg.id === 'lebu') {
                        let score = (typeof result === 'number') ? result : 0;
                        const escape = lebuEscapeRate();
                        const escapeMul = 1 + (0.25 - escape) * 1.6;
                        score = score * escapeMul;
                        score = Math.round(score * 100) / 100;
                        _exposeOverride(cfg.id, score, cfg.reason + '.逃脱率' + Math.round(escape * 100) + '%', cfg.weight, player);
                        return score;
                    }

                    /* ★ 兵粮寸断：牌堆感知逃脱率 */
                    if (cfg.id === 'bingliang') {
                        let score = (typeof result === 'number') ? result : 0;
                        const escape = bingliangEscapeRate();
                        const escapeMul = 1 + (0.25 - escape) * 1.6;
                        score = score * escapeMul;
                        score = Math.round(score * 100) / 100;
                        _exposeOverride(cfg.id, score, cfg.reason + '.逃脱率' + Math.round(escape * 100) + '%', cfg.weight, player);
                        return score;
                    }

                    /* ★ 闪电：牌堆感知命中率 */
                    if (cfg.id === 'shandian') {
                        let score = (typeof result === 'number') ? result : 0;
                        const hitRate = shandianHitRate();
                        const hitMul = 1 + (hitRate - 0.1) * 3;
                        let resist = 0;
                        try {
                            if (target.hasSkill && (target.hasSkill('guicai') || target.hasSkill('guidao'))) {
                                resist += 0.6;
                            }
                        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                        score = score * Math.max(0.3, 1 - resist) * hitMul;
                        score = Math.round(score * 100) / 100;
                        _exposeOverride(cfg.id, score, cfg.reason + '.命中率' + Math.round(hitRate * 100) + '%', cfg.weight, player);
                        return score;
                    }

                    /* ★ 杀：牌堆感知稀缺度 */
                    if (cfg.id === 'sha') {
                        let score = (typeof result === 'number') ? result : 0;
                        const shaRemain = cardRarity('sha');
                        if (shaRemain < 0.5) {
                            score = score * 1.2;
                        }
                        score = Math.round(score * 100) / 100;
                        _exposeOverride(cfg.id, score, cfg.reason + '.稀缺度' + Math.round(shaRemain * 100) + '%', cfg.weight, player);
                        return score;
                    }

                    /* 写入覆写信号 */
                    if (typeof result === 'number' && result !== 0) {
                        _exposeOverride(cfg.id, result, cfg.reason + '.target', cfg.weight, player);
                    }
                    return result;
                } catch (e) {
                    return origTarget.call(this, player, target);
                }
            };
            cardMeta.result.__origTarget = origTarget;
            cardMeta.result.__djsc_hooked = true;
        });
        log.info('optimization', '已 hook ' + HOOKED_CARDS.length + ' 张牌的 result.target');
        /* ★ 同时 hook shunshou/guohe 的 button 函数 */
        installButtonHooks();
    } catch (e) {
        log.info('optimization', 'hook 失败: ' + String(e).slice(0, 80));
    }
}

function uninstallOptimizationHooks() {
    try {
        HOOKED_CARDS.forEach(function (cfg) {
            const cardMeta = lib.card && lib.card[cfg.id];
            if (!cardMeta || !cardMeta.result) return;
            if (!cardMeta.result.__djsc_hooked) return;
            if (cardMeta.result.__origTarget) {
                cardMeta.result.target = cardMeta.result.__origTarget;
                delete cardMeta.result.__origTarget;
            }
            delete cardMeta.result.__djsc_hooked;
        });
        uninstallButtonHooks();
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= 导出 ================= */
export { installOptimizationHooks, uninstallOptimizationHooks, installButtonHooks, uninstallButtonHooks, _exposeOverride, _scoreTao };

/* ================= ★ 通用 remove-target-card button hook =================
 * 具体卡牌 id 来自 gameProfile.strategicEffects；本层只处理“移除目标卡牌”这一通用 operation。
 */
function installButtonHooks() {
    try {
        const removalIds = idsWithStrategicOperation('remove-target-card');
        let installed = 0;

        removalIds.forEach(function (cardId) {
            const meta = lib.card && lib.card[cardId];
            if (!meta || typeof meta.button !== 'function' || meta.button.__djsc_hooked) return;
            const origButton = meta.button;

            meta.button = function (button) {
                try {
                    const ev = (get && typeof get.event === 'function' && get.event()) || _status.event || {};
                    const player = ev.player || _status.event && _status.event.player;
                    const target = ev.target || _status.event && _status.event.target;
                    const link = button && button.link;
                    const pos = link ? get.position(link) : null;

                    /* 手牌：保持既有“已知牌 + 稀缺花色”逻辑。 */
                    if (pos === 'h' && player && target) {
                        let isKnown = false;
                        try {
                            const known = player.getKnownCards ? player.getKnownCards(target) : [];
                            isKnown = known.indexOf(link) >= 0;
                        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

                        let scarcityBonus = 0;
                        try {
                            const short = { heart:'h', diamond:'d', club:'c', spade:'s' }[link.suit];
                            if (short) {
                                const remain = suitRemaining(short);
                                if (remain <= 3) scarcityBonus = 1.5;
                                else if (remain <= 6) scarcityBonus = 0.8;
                                else if (remain <= 10) scarcityBonus = 0.3;
                            }
                        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

                        if (isEnemyOf(player, target)) return (isKnown ? 3 : 1) + scarcityBonus;
                        return isKnown ? -2 : -1;
                    }

                    /* 判定区：不按牌名写规则，只询问该牌代表的战略状态价值。
                     * 敌方有利状态 → adjustment<0 保护；队友有害状态 → adjustment>0 鼓励解除。 */
                    if (pos === 'j' && player && target && link) {
                        const base = origButton.call(this, button);
                        const choice = evaluateRemovalChoice(player, target, link, {
                            relationOf: function (mi, t) {
                                try { return isAllyOf(mi, t) ? 1 : (isEnemyOf(mi, t) ? -1 : 0); } catch (e) { return 0; }
                            },
                        });
                        const b = (typeof base === 'number' && isFinite(base)) ? base : 0;
                        if (choice && typeof choice.adjustment === 'number' && choice.adjustment !== 0) {
                            return b + choice.adjustment;
                        }
                        return base;
                    }
                } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

                return origButton.call(this, button);
            };

            meta.button.__djsc_hooked = true;
            meta.button.__origButton = origButton;
            installed++;
        });

        log.info('optimization', '已通用 hook remove-target-card button × ' + installed);
    } catch (e) {
        log.info('optimization', 'button hook 失败: ' + String(e).slice(0, 80));
    }
}


/* 通用 remove-target-card button hook 的对称卸载；避免热重载后旧闭包叠加。 */
function uninstallButtonHooks() {
    try {
        const removalIds = idsWithStrategicOperation('remove-target-card');
        removalIds.forEach(function (cardId) {
            const meta = lib.card && lib.card[cardId];
            if (!meta || typeof meta.button !== 'function' || !meta.button.__djsc_hooked) return;
            const orig = meta.button.__origButton;
            if (typeof orig === 'function') meta.button = orig;
        });
    } catch (e) {
        if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e);
    }
}
