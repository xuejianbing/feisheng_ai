/*
 * ============================================
 * // 作者：飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */
import { safeGet as _lsGet, safeSet as _lsSet, safeRemove as _lsRemove } from '../../foundation/storage/storage.js';
import { normalizedMargin, DECISION_MARGIN } from '../state/decisionMargin.js';
import { isCandidateEligible, sameCandidatePolicyBand } from '../state/actionCandidate.js';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */

/* ================= 决策点嵌入固定（逐决策点 → 一条最强嵌入） =================
 * 训练后把每个"决策点"(heroId + action + id) 定型为一条嵌入条。
 * ★ 只取最强：每个决策点不再用全部样本逐元素平均，而是每次训练都取其中
 *   value_target(实际结算净收益) 最高的那一条样本，其 130 维特征即为冠军嵌入，
 *   其价值估值即冠军价值。彻底贯彻"每个维度和技能/卡牌单元都是冠军优先"。
 * 运行中引擎以候选动作 (heroId, action, id) 精确命中对应嵌入条，按价值提权/替换。
 * 主键 = (heroId, type, id)：英雄不同、同类型动作互不干扰。
 * 泛化：当当前英雄无精确嵌入时，可用其它英雄同 (type,id) 的嵌入按上下文余弦相似度复用。
 */

const STORE_KEY = 'djsc_champion_v1';
const VERSION = 4;               /* ★ v4：嵌入主键升维为 (heroId, type, id)，支持英雄维度；
                                   *    并新增"英雄间相似度泛化"命中。旧 v3 二维数据作废重建。 */
const MIN_SAMPLES = 5;           /* 一个决策点至少几条样本才认为有效，防噪声 */
const MAX_PER_ACTION = 24;       /* 每类(action)最多保留的决策点嵌入条数，防存储膨胀 */
const SIM_THRESHOLD = 0.78;      /* ★ 泛化相似度阈值：≥0.78 才允许跨英雄复用嵌入 */

/* 冠军策略提权只接受有限正数；0、缺省及无效配置均表示关闭。 */
export function resolveChampionBoost(value) {
    const boost = Number(value);
    return Number.isFinite(boost) && boost > 0 ? boost : 0;
}

/* ★ 上下文维度索引组（与 features.js 的 130 维布局对齐）。
 * 相似度只在这组"场景"维度上计算（目标/局势/卡牌强度），
 * 故意排除动作类型标签(32-35)、英雄身份等，避免相似度虚高导致"乱搬"。 */
const CTX_TARGET_IX   = [42,43,44,45,46,47,80,81,82,83,84,85,87,100,101,102,103,106,107,108,109,120,121,122,123,124,129]; /* 目标段 */
const CTX_SITUATION_IX = [0,1,8,9,10,16,17,18,19,20,64,65,66,67,68,70,71,72,73,74,75,92]; /* 自身/局势/相对强度 */
const CTX_CARD_IX     = [2,3,4,5,6,7,24,25,26,27,88,89,90,91]; /* 卡牌/装备/牌堆 */
const CONTEXT_IX = (function () {
    const set = {};
    const all = CTX_TARGET_IX.concat(CTX_SITUATION_IX).concat(CTX_CARD_IX);
    for (let i = 0; i < all.length; i++) set[all[i]] = 1;
    const out = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
    return out;
})();

let STORE = load();

/* ★ type 索引缓存：按"类型"预聚合同类嵌入条，供 findSimilar 复用，
 *   避免每个候选动作都全量遍历所有英雄×类型的嵌入条（热路径主要开销）。
 *   仅当 STORE._ver 变化（recompute/clear 重建了嵌入集）才重建；
 *   反馈只改 value、不改嵌入集结构，因此不会使索引失效。 */
let _typeIdxCache = null, _typeIdxVer = -1;

function load() {
    try {
        const raw = _lsGet(STORE_KEY);
        if (raw) {
            const obj = JSON.parse(raw);
            if (obj && obj.v === VERSION && obj.embeds && typeof obj.embeds === 'object') {
                return { embeds: obj.embeds, updatedAt: obj.updatedAt || 0, _ver: obj._ver || 0 };
            }
        }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    return { embeds: {}, updatedAt: 0, _ver: 0 };
}

function persist() {
    try {
        STORE.updatedAt = Date.now();
        _lsSet(STORE_KEY, JSON.stringify(STORE));
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ 从样本重算"逐决策点嵌入条"：
 *  决策点 = (heroId, action, id)。
 *  ★ 只取最强：每个决策点只保留 value_target 最高的那一条样本——其 130 维特征即冠军嵌入，
 *    value_target 即冠军价值。取代旧的"全部样本逐元素平均"，避免弱样本稀释冠军特征。
 *  外层键 = heroId + '|' + action（按英雄+类型分组，英雄不同互不干扰）；内层 = id。
 *  每类只保留前 MAX_PER_ACTION 个 [样本数≥MIN_SAMPLES 且最强样本价值为正] 的决策点作为嵌入条。
 *  value_target（-1..1）取异步后检测的实际结算净收益，越高越利于终局胜。 */
export function recompute(samples) {
    try {
        const src = (samples && samples.length) ? samples : [];
        const group = {};
        for (let i = 0; i < src.length; i++) {
            const s = src[i];
            if (!s || !s.m) continue;
            /* ★ v3.1 分类键优先用 type（skill/card/equip/end），兼容旧字段 action */
            const action = String((s.m && (s.m.type || s.m.action)) || 'unknown');
            /* ★ v4 英雄维度：样本 meta 的 player 即英雄 id */
            const heroId = String((s.m && (s.m.player || s.m.hero)) || '');
            const groupKey = heroId ? (heroId + '|' + action) : action;
            const id = String(s.m.id || '');
            if (!id) continue;
            const vt = (typeof s.value_target === 'number') ? s.value_target : 0;
            const w = (s.count || 1);
            const farr = (s.f && s.f.length) ? s.f : null;
            group[groupKey] = group[groupKey] || {};
            const g = group[groupKey][id] || (group[groupKey][id] = { bestVT: -Infinity, count: 0, hero: heroId, bestF: null });
            g.count += w;
            /* 只保留该决策点中 value_target 最高的一条样本（取最强） */
            if (vt > g.bestVT) { g.bestVT = vt; g.bestF = farr; }
        }

        const embeds = {};
        for (const groupKey in group) {
            if (!Object.prototype.hasOwnProperty.call(group, groupKey)) continue;
            /* 取该类别所有有效决策点，按冠军价值降序，仅保留前 MAX_PER_ACTION */
            const rows = [];
            for (const id in group[groupKey]) {
                if (!Object.prototype.hasOwnProperty.call(group[groupKey], id)) continue;
                const g = group[groupKey][id];
                if (g.count < MIN_SAMPLES) continue;
                if (g.bestVT <= 0) continue;   /* 仅保留冠军价值为正（有决策意义） */
                let emb = null;
                if (g.bestF) emb = g.bestF;    /* 最强样本的原始特征即冠军嵌入 */
                rows.push({ id: id, value: g.bestVT, count: g.count, bestValue: g.bestVT, emb: emb, hero: g.hero });
            }
            rows.sort(function (a, b) { return b.value - a.value; });
            if (rows.length) embeds[groupKey] = rows.slice(0, MAX_PER_ACTION);
        }

        STORE.embeds = embeds;
        STORE._ver = (STORE._ver || 0) + 1;   /* 嵌入集结构变化 → type 索引失效，下次重建 */
        persist();
        return embeds;
    } catch (e) { return STORE.embeds || {}; }
}

/* ★ 读取当前固化的嵌入条： { 'heroId|type': [ {id,value,count,bestValue,emb,hero} ] } */
export function getChampions() { return STORE.embeds || {}; }

/* ★ 强制从 localStorage 重读内存 STORE（用于"面板打开前同步存储"，避免展示空数据）。
 * 返回是否读取到了非空数据；供面板/诊断在打开前调用，消除时序导致的"有数据却显示0"。 */
export function reloadFromStorage() {
    try {
        STORE = load();
        _typeIdxCache = null; _typeIdxVer = -1;
        const eb = STORE.embeds || {};
        const keys = Object.keys(eb);
        return keys.length > 0;
    } catch (e) { return false; }
}

/* ★ 找出被"新嵌入池"替换/淘汰掉的旧决策点：
 * 旧池里有、新池里没有的 (hero, action, id) 列表，供上层回流入样本库，避免被冠军策略固化的替换数据白白流失。 */
export function diffDropped(oldEmb, newEmb) {
    const dropped = [];
    try {
        oldEmb = oldEmb || STORE.embeds || {};
        newEmb = newEmb || {};
        for (const key in oldEmb) {
            if (!Object.prototype.hasOwnProperty.call(oldEmb, key)) continue;
            const oldRows = oldEmb[key] || [];
            const newRows = (newEmb[key] || {});
            const newIds = {};
            for (let j = 0; j < newRows.length; j++) newIds[newRows[j].id] = 1;
            const sep = key.indexOf('|');
            const hero = (sep >= 0) ? key.slice(0, sep) : '';
            const action = (sep >= 0) ? key.slice(sep + 1) : key;
            for (let i = 0; i < oldRows.length; i++) {
                const row = oldRows[i];
                if (!row || newIds[row.id]) continue;   /* 新池仍保留 → 未替换 */
                dropped.push({ hero: row.hero || hero, action: action, id: row.id, value: row.value, count: row.count, emb: row.emb || null });
            }
        }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    return dropped;
}

/* ★ 内部：按 (heroId, type) 取某英雄某类型下的所有嵌入条 */
function _rowsOf(heroId, action) {
    const key = heroId ? (heroId + '|' + action) : action;
    return (STORE.embeds && STORE.embeds[key]) || [];
}

/* ★ 查询某决策类型"当前英雄的冠军"（该类价值最高一条嵌入），无则 null；兼容旧面板 */
export function championOf(action, heroId) {
    try {
        const rows = _rowsOf(heroId || '', action);
        return (rows.length ? rows[0] : null) || null;
    } catch (e) { return null; }
}

/* ★ 按 (heroId, action, id) 精确查某决策点的嵌入条，无则 null */
export function getEmbedding(action, id, heroId) {
    try {
        const rows = _rowsOf(heroId || '', action);
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].id === id) return rows[i];
        }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    return null;
}

/* ★ 结算后反馈回写：把一次实际结算的正负收益折算进该决策点的嵌入价值。
 * 在精确命中(heroId,type,id)时，用小学习率把 value 向真实效果的符号收敛：
 *   正收益 → value 上浮；负收益（如技能错给敌人）→ value 下压。
 * 让模型学到"这类技能这样用是对的/错的"，从而减少"把技能乱用给敌人"。
 * 回写仅针对已固化的嵌入条（count≥MIN_SAMPLES 且 value>0），不新建条目。
 * 返回 true 表示已回写；false 表示无嵌入条可回写。 */
export function feedbackSettle(type, id, heroId, settle) {
    try {
        if (!type || !id) return false;
        /* 门槛：只对确有的嵌入条调整；sign=0(无变化)跳过 */
        if (!settle || settle.sign === 0) return false;
        let row = getEmbedding(type, id, heroId);
        /* 本英雄无精确嵌入 → 试着定位到泛化池里同 (type,id) 的最相近一条 */
        if (!row) {
            const fd = findSimilar(type, id, heroId, settle.emb);
            row = fd ? fd.row : null;
        }
        if (!row) return false;
        /* 学习率：正负反馈按幅度，clamp 到 [-0.06, +0.06] 一次 */
        const lr = Math.max(-0.06, Math.min(0.06, settle.sign * 0.03));
        row.value = Math.max(0.05, row.value + lr);
        row.updatedAt = Date.now();
        persist();
        return true;
    } catch (e) { return false; }
}

/* ★ 余弦相似度（用于英雄间泛化复用）。
 * 仅使用上下文维度索引组 CONTEXT_IX 提取子向量计算，屏蔽动作类型/英雄身份等干扰维度，
 * 确保相似度真实反映"目标/局势/卡牌"场景契合度，避免相似度虚高导致"乱搬"。
 * 任意入参缺省/无嵌入/维度不齐则返回 -1（不相似）。 */
function _cosine(a, b) {
    try {
        if (!a || !b || !Array.isArray(a) || !Array.isArray(b)) return -1;
        if (!a.length || !b.length || a.length !== b.length) return -1;
        /* ★ 短路：同一向量自相似=1，省掉全量点积循环 */
        if (a === b) return 1;
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < CONTEXT_IX.length; i++) {
            const idx = CONTEXT_IX[i];
            if (idx < 0 || idx >= a.length || idx >= b.length) continue;
            const av = a[idx];
            const bv = b[idx];
            dot += av * bv;
            na += av * av;
            nb += bv * bv;
        }
        if (na === 0 || nb === 0) return -1;
        return dot / (Math.sqrt(na) * Math.sqrt(nb));
    } catch (e) { return -1; }
}

/* ★ 按"类型"聚合嵌入条（跨英雄），供 findSimilar 复用；版本不变时结果缓存，避免每次全量遍历 */
function _sameTypeRows(action) {
    try {
        const ver = STORE._ver || 0;
        if (_typeIdxVer !== ver || !_typeIdxCache) {
            const idx = {};
            const eb = STORE.embeds || {};
            for (const key in eb) {
                if (!Object.prototype.hasOwnProperty.call(eb, key)) continue;
                const sep = key.indexOf('|');
                const type = (sep >= 0) ? key.slice(sep + 1) : key;
                (idx[type] = idx[type] || []).push({ key: key, rows: eb[key] || [] });
            }
            _typeIdxCache = idx;
            _typeIdxVer = ver;
        }
        return _typeIdxCache[action] || [];
    } catch (e) { return []; }
}

/* ★ 泛化层：当前英雄 heroId 无精确嵌入时，用它英雄同 (type,id) 的嵌入按上下文余弦相似度复用。
 *  返回 { row, sim }；相似度 < SIM_THRESHOLD 或无候选 → null。
 *  场景参考向量 refEmb 传入，取与当前候选最相似的历史嵌入；缺省 refEmb 时取泛化池价值最高者。
 *  ★ 优化：经 type 索引只扫"同类型"分组，不再全量遍历所有英雄×类型，显著降低决策热路径开销。 */
export function findSimilar(action, id, heroId, refEmb) {
    try {
        const selfKey = heroId ? (heroId + '|' + action) : action;
        const groups = _sameTypeRows(action);
        let bestRow = null, bestSim = -1;
        for (let gi = 0; gi < groups.length; gi++) {
            const g = groups[gi];
            // 跳过自身英雄那一组
            if (g.key === selfKey) continue;
            const rows = g.rows || [];
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (row.id !== id || !(row.value > 0)) continue;
                /* ★ 修复：refEmb 缺失时不做泛化（返回 -1）。
                 * 原 `refEmb || row.emb` 在关闭"使用训练模型"时 refEmb=null，
                 * 自相似短路恒得 1 → 跨英雄嵌入被无条件乱搬。 */
                const sim = row.emb ? _cosine(refEmb, row.emb) : -1;
                if (sim > bestSim) { bestSim = sim; bestRow = row; }
            }
        }
        if (bestRow && bestSim >= SIM_THRESHOLD) return { row: bestRow, sim: bestSim };
        return null;
    } catch (e) { return null; }
}

/* ★ 引擎调用：逐决策点嵌入替换规则链（主键=英雄+类型+动作，含英雄间泛化）。
 * 命中判定：先精确命中当前英雄嵌入；若不中，再尝试泛化（相似英雄同动作高相似嵌入）。
 * 命中后按该决策点的 TD 价值把提权/替换强度缩放，价值越高越优先采用。
 *
 * 精确层规则链（任一失败即回退，绝不破坏引擎）：
 *  R1 启用判定：boost>0 且已固化嵌入条。
 *  R2 英雄锚定：只对当前英雄 heroId 的嵌入条生效。
 *  R3 决策点命中：候选 acts 中存在 id 与嵌入 id 完全一致的动作（精确命中）。
 *  R4 模糊判定：原最优 best 与次优的 normalized margin 足够接近时才允许替换。
 *  R5 价值校验：该决策点平均价值必须为正（value>0）。
 *  R6 提权：对命中的动作加 boost ×（0.5 + value）。
 *  R7 候选替换：强化后该动作成为最优且 gap 达标 → 替换 best。
 *  R8 兜底：异常安全返回原 best。
 *
 * 泛化层（精确层未命中时，英雄间相似度复用）：
 *  G1 当前英雄无精确嵌入 → 收集它英雄同 (type,id) 的嵌入。
 *  G2 相似度：context 余弦 sim = cos(refEmb, emb)。
 *  G3 阈值：sim ≥ SIM_THRESHOLD 才允许复用。
 *  G4 价值筛选：value>0。
 *  G5 线性加权：score += boost ×（0.35 + 0.65×sim）×（0.5 + value）。
 *  G6 替换判定：同 R4/R7，仅在相对边际接近时才替换。
 *  G7 兜底：无 ≥阈值邻居则不放权。
 */
export function applyChampionRule(acts, best, boost, ctx) {
    try {
        if (!acts || !acts.length || !(boost > 0)) return { best: best, replaced: false, hit: 0, sim: 0 };
        if (!STORE.embeds) return { best: best, replaced: false, hit: 0, sim: 0 };
        const heroId = (ctx && ctx.heroId) ? String(ctx.heroId) : '';

        const policyActs = acts.slice().filter(function (a) {
            return a && isCandidateEligible(a) && sameCandidatePolicyBand(a, best);
        });
        const rankedBase = policyActs.filter(function (a) {
            return typeof a.score === 'number';
        }).sort(function (x, y) {
            return y.score - x.score;
        });
        if (rankedBase.length < 2) return { best: best, replaced: false, hit: 0, sim: 0 };

        const baseMargin = normalizedMargin(rankedBase[0].score, rankedBase[1].score);
        if (baseMargin > DECISION_MARGIN.CLOSE) {
            return { best: best, replaced: false, hit: 0, sim: 0, margin: baseMargin };
        }

        let hitCount = 0, bestSim = 0, appliedSim = false;
        const evaluated = policyActs.map(function (a) {
            if (!a || typeof a.score !== 'number') return { a: a, score: a && a.score || 0, bonus: 0, champion: false, sim: 0 };
            const bridged = Number(boost) || 0;
            let bonus = 0, usedSim = 0;

            const row = getEmbedding(a.type, a.id, heroId);
            if (row && row.value > 0) {
                bonus = bridged * (0.5 + Math.max(0, Math.min(1, row.value)));
            } else {
                const sim = findSimilar(a.type, a.id, heroId, a._feat || null);
                if (sim && sim.row) {
                    bonus = bridged * (0.35 + 0.65 * sim.sim) * (0.5 + Math.max(0, Math.min(1, sim.row.value)));
                    usedSim = sim.sim;
                }
            }

            if (bonus > 0) {
                hitCount++;
                if (usedSim > bestSim) bestSim = usedSim;
                if (usedSim > 0) appliedSim = true;
            }
            return {
                a: a,
                score: a.score + bonus,
                bonus: bonus,
                champion: bonus > 0,
                sim: usedSim,
            };
        });

        if (hitCount === 0) return { best: best, replaced: false, hit: 0, sim: bestSim, margin: baseMargin };

        evaluated.sort(function (x, y) { return y.score - x.score; });
        const winner = evaluated[0];
        if (!winner || !winner.a || winner.a === best || !winner.champion) {
            return { best: best, replaced: false, hit: hitCount, sim: bestSim, generalized: appliedSim, margin: baseMargin };
        }

        /* Champion 只有在确实改判时才提交分数修正；未改判不得污染后续候选。 */
        winner.a.score = Math.round(winner.score * 100) / 100;
        winner.a._champion = true;
        return {
            best: winner.a,
            replaced: true,
            hit: hitCount,
            sim: bestSim,
            generalized: appliedSim,
            margin: baseMargin,
            bonus: Math.round(winner.bonus * 100) / 100,
        };
    } catch (e) {
        return { best: best, replaced: false, hit: 0, sim: 0 };
    }
}

/* ★ 兼容旧接口：仅加权（按 id 精确命中，无英雄则全局），供其它调用方使用 */
export function applyChampionBoost(acts, boost) {
    try {
        if (!acts || !acts.length || !(boost > 0)) return 0;
        if (!STORE.embeds) return 0;
        let hit = 0;
        for (let i = 0; i < acts.length; i++) {
            const a = acts[i];
            if (!a) continue;
            const row = getEmbedding(a.type, a.id);
            if (row && row.value > 0) {
                a.score = Math.round(((a.score || 0) + boost) * 100) / 100;
                a._champion = true;
                hit++;
            }
        }
        return hit;
    } catch (e) { return 0; }
}

/* ★ 统计信息（含英雄维度）
 *  decisions = 嵌入条条数（= 各决策点数量，每个决策点一条最强冠军嵌入）
 *  samples   = 沉淀的样本总数（各决策点 count 求和） */
export function stats() {
    const eb = STORE.embeds || {};
    const keys = Object.keys(eb);
    let samples = 0, rowCount = 0, embCount = 0;
    const heroes = {};
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const rows = eb[key] || [];
        /* 外层键形如 "hero|type" 或 "type"（无英雄时） */
        const sep = key.indexOf('|');
        if (sep >= 0) {
            const h = key.slice(0, sep);
            heroes[h] = (heroes[h] || 0) + rows.length;
        }
        rowCount += rows.length;
        for (let j = 0; j < rows.length; j++) {
            samples += (rows[j].count || 0);
            if (rows[j].emb) embCount++;
        }
    }
    return { types: keys.length, decisions: rowCount, samples: samples, embs: embCount, heroes: heroes, heroCount: Object.keys(heroes).length, updatedAt: STORE.updatedAt || 0, embeds: eb };
}

export function clear() {
    try {
        STORE = { embeds: {}, updatedAt: 0, _ver: (STORE._ver || 0) + 1 };
        _lsRemove(STORE_KEY);
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
