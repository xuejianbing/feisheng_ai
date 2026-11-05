/*
 * ============================================
 * // 作者: 飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 认知日志 ================= */
import { log } from '../../foundation/diag/logger.js';

const MAX = 100;
const LOG = [];
const STATS = { total: 0, byLevel: { high: 0, mid: 0, low: 0, none: 0 }, byIntervention: { model: 0, blend: 0, rule: 0, skip: 0 } };

export function logCognition(entry) {
    try {
        if (!entry) return;
        const rec = {
            ts: Date.now(),
            round: entry.round || 0,
            player: entry.player || '?',
            action: entry.action || '?',
            model: entry.model ? { label: entry.model.label, confidence: entry.model.confidence } : null,
            meta: entry.meta ? { familiarity: entry.meta.familiarity, modulator: entry.meta.modulator, level: entry.meta.level } : null,
            intervention: entry.intervention || 'skip',
            effective: entry.effective || 0,
        };
        LOG.push(rec);
        while (LOG.length > MAX) LOG.shift();

        STATS.total++;
        if (rec.meta && STATS.byLevel[rec.meta.level] !== undefined) STATS.byLevel[rec.meta.level]++;
        if (STATS.byIntervention[rec.intervention] !== undefined) STATS.byIntervention[rec.intervention]++;
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export function getCognitionLog(n) {
    return LOG.slice(-(n || 20)).reverse();
}

export function cognitionStats() {
    try {
        const rate = {};
        Object.keys(STATS.byLevel).forEach(k => {
            rate[k] = STATS.total > 0 ? Math.round(STATS.byLevel[k] / STATS.total * 100) + '%' : '0%';
        });
        return { total: STATS.total, byLevel: Object.assign({}, STATS.byLevel), byLevelRate: rate, byIntervention: Object.assign({}, STATS.byIntervention) };
    } catch (e) { return {}; }
}

export function resetCognitionLog() {
    LOG.length = 0;
    STATS.total = 0;
    Object.keys(STATS.byLevel).forEach(k => STATS.byLevel[k] = 0);
    Object.keys(STATS.byIntervention).forEach(k => STATS.byIntervention[k] = 0);
    log.info('cogLog', '认知日志已复位');
}

if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.cognitionLog = { log: logCognition, recent: getCognitionLog, stats: cognitionStats, reset: resetCognitionLog };
}

/* 旧特征接口：从 missingModules 归位，保留旧字段、状态与计算方式。
 * 与本模块正式算法不等价，暂不互相替换，避免改变已训练模型的输入。 */
/* ================= 5. cognitiveLog - 认知日志 ================= */
const _cognitiveEntries = [];  /* 认知日志 */

export const legacyCognitiveFeatures = {
    /* 记录一次决策 */
    log: function(decision, reasoning, confidence) {
        try {
            _cognitiveEntries.push({
                decision: decision,
                reasoning: reasoning,
                confidence: confidence || 0.5,
                time: Date.now(),
            });
            /* 只保留最近100条 */
            if (_cognitiveEntries.length > 100) _cognitiveEntries.shift();
        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    },

    /* 获取最近日志 */
    recent: function(count) {
        count = count || 10;
        return _cognitiveEntries.slice(-count);
    },

    /* 统计 */
    stats: function() {
        const total = _cognitiveEntries.length;
        const avgConf = total > 0
            ? _cognitiveEntries.reduce((a, b) => a + b.confidence, 0) / total
            : 0;
        return {
            totalEntries: total,
            avgConfidence: avgConf,
            /* ★ 兼容features.js的字段名 */
            confidence: avgConf,           // 模型置信度
            conflicts: Math.floor(total * 0.1),  // 历史冲突次数（估算）
        };
    },
};
