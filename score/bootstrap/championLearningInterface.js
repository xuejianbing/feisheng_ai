/* 职责：连接现有冠军公开接口；算法与训练回流归各自模块。 */
import { recycleChampionSamples } from '../model/train/trainExport.js';
import { champRecomputeFromBuffer } from '../model/bootstrap/championLearning.js';
import { recompute as champRecompute, getChampions as champGet, championOf, getEmbedding as champEmbedding, applyChampionBoost, applyChampionRule, stats as champStats, clear as champClear } from '../decision/strategy/championStrategy.js';
export function mountChampionLearningInterface() {
    if (typeof window === 'undefined') return;
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.champion = {
        recompute: function (samples) {
            try {
                return (samples && samples.length) ? champRecompute(samples) : champRecomputeFromBuffer();
            } catch (e) { return {}; }
        },
        get: champGet,
        of: championOf,
        embedding: champEmbedding,      /* ★ 按 (action,id) 精确取某决策点嵌入条 */
        applyRule: applyChampionRule,
        applyBoost: applyChampionBoost,
        stats: champStats,
        clear: champClear,
    };
    /* ★ 冠军替换数据回流接口（固化冠军时被替换的旧决策点写回样本库） */
    window.__DJSC.recycleChampionSamples = recycleChampionSamples;
}
