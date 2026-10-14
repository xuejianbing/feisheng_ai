import { applyOwnedUtility } from '../utility/utilityPipeline.js?v=5e5';
import { decisionActionSnapshot } from '../analysis/decisionStages.js?v=5e5';
/*
 * ============================================
 * // 作者：飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */
import { trainingLabelOf } from '../../model/train/labelPolicy.js?v=5e5';
import { safeGet as _lsGet, safeSet as _lsSet, safeRemove as _lsRemove } from '../../foundation/storage/storage.js?v=5e5';
import { normalizedMargin, DECISION_MARGIN } from '../state/decisionMargin.js?v=5e5';
import { isCandidateEligible, sameCandidatePolicyBand } from '../state/actionCandidate.js?v=5e5';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */

/* 冠军经验 v5：只统计可追查的执行结果，最高值仅供复盘。
 * 默认 shadow：新估计不改变实际选择，旧最高值池仅保留展示。
 * active 必须由调用方显式启用，仍服从原策略带与接近边际。 */
const STORE_KEY = 'djsc_champion_v1';
const VERSION = 5;
const MIN_SAMPLES = 5;
const MIN_SESSIONS = 3;
const MAX_OBSERVATIONS = 2048; // 统计保留窗口，不代表全部历史
const SHRINK_PRIOR = 5;
const MAX_BONUS = 0.5;
const MAX_PER_ACTION = 24;       /* 每类(action)最多保留的决策点嵌入条数，防存储膨胀 */
const SIM_THRESHOLD = 0.78;      /* ★ 泛化相似度阈值：≥0.78 才允许跨英雄复用嵌入 */

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

let STORE;

/* ★ type 索引缓存：按"类型"预聚合同类嵌入条，供 findSimilar 复用，
 *   避免每个候选动作都全量遍历所有英雄×类型的嵌入条（热路径主要开销）。
 *   仅当 STORE._ver 变化（recompute/clear 重建了嵌入集）才重建；
 *   反馈只改 value、不改嵌入集结构，因此不会使索引失效。 */
let _typeIdxCache = null, _typeIdxVer = -1;

function emptyStore() { return {v:VERSION,embeds:{},legacyEmbeds:{},observations:[],updatedAt:0,_ver:0,audit:{}}; }
function load() {
    try {
        const obj = JSON.parse(_lsGet(STORE_KEY) || 'null');
        if (obj?.v === VERSION && Array.isArray(obj.observations)) {
            // 从持久化的原始证据重算，不能相信旧的缓存 value。
            const next=emptyStore(); next.legacyEmbeds=obj.legacyEmbeds||{};
            const result=aggregateObservations(obj.observations);
            Object.assign(next,result,{updatedAt:obj.updatedAt||0,_ver:obj._ver||0}); return next;
        }
        const next=emptyStore();
        // 原 persist 未写 v 的旧数据也仅供展示；不能由最高值伪造原始样本。
        if(obj?.embeds && (!obj.v || obj.v===4))next.legacyEmbeds=obj.embeds;
        return next;
    } catch (_) { return emptyStore(); }
}
function persist() {
    STORE.v=VERSION; STORE.updatedAt=Date.now();
    try { return _lsSet(STORE_KEY,JSON.stringify(STORE)) !== false; } catch (_) { return false; }
}
const observationKey = s => s?.m?.sessionId && s.m.actorId && s.m.transactionId ? JSON.stringify([s.m.sessionId,s.m.actorId,s.m.transactionId]) : null;
STORE = load();
export function championSampleEligibility(s) {
    const m=s?.m, outcome=m?.actionOutcome;
    if(!m || m.rewardSchema!=='action-outcome-v1')return 'missing-execution-evidence';
    try { if(trainingLabelOf(s)===null)return 'invalid-training-label'; } catch (_) { return 'invalid-training-label'; }
    if(!m.player || !m.id || !(m.type||m.action))return 'missing-action-identity';
    if(!Array.isArray(s.f)||s.f.length!==130||s.f.some(v=>!Number.isFinite(v)))return 'invalid-context';
    if(!outcome || outcome.normalization!==12 || !Array.isArray(outcome.deltas)||!outcome.deltas.length)return 'missing-result-evidence';
    const fields=['hp','hand','equip','judging','alive','linked','turned','wine'];
    if(outcome.deltas.some(d=>!d?.playerId || ![-1,0,1].includes(d.camp) || fields.some(k=>!Number.isFinite(d[k]))))return 'invalid-result-deltas';
    if(outcome.attribution==='completed-chain-local-cost') {
        if(!m.creditAllocation)return 'missing-credit-ledger';
    } else if(outcome.attribution==='host-event-window') {
        if(outcome.deltas.some(d=>d.judging||d.linked||d.turned||d.wine))return 'unresolved-delayed-effect';
        if(outcome.deltas.some(d=>!d.camp && fields.some(k=>d[k])))return 'unknown-relation';
        const reward=outcome.deltas.reduce((n,d)=>n+d.camp*(d.hp*3+d.hand*1.5+d.equip*1.2-d.judging*2+d.alive*3),0);
        if(Math.abs(reward-m.observedReward)>1e-7)return 'result-reward-mismatch';
    } else return 'unsupported-attribution';
    return null;
}
function compact(s) {
    const m=s.m;
    return JSON.parse(JSON.stringify({f:s.f.slice(),r:s.r??s.reward,value_target:s.value_target,m:{player:m.player,type:m.type||m.action,id:m.id,target:m.target??null,
        rewardSchema:m.rewardSchema,executionState:m.executionState,rewardStatus:m.rewardStatus,sessionId:m.sessionId,
        transactionId:m.transactionId,actorId:m.actorId,observedReward:m.observedReward,actionOutcome:m.actionOutcome,creditAllocation:m.creditAllocation,modeContext:m.modeContext}}));
}
function aggregateObservations(src) {
    const unique=new Map(),conflicts=new Set(),reasons={};let duplicates=0;
    const reject=reason=>{reasons[reason]=(reasons[reason]||0)+1;};
    for(const s of src) {
        const reason=championSampleEligibility(s),key=observationKey(s);
        if(reason){reject(reason);if(key){unique.delete(key);conflicts.add(key);}continue;}
        if(conflicts.has(key)){reject('conflicting-transaction');continue;}
        const row=compact(s),old=unique.get(key);
        if(old) {
            if(JSON.stringify(old)!==JSON.stringify(row)){unique.delete(key);conflicts.add(key);reject('conflicting-transaction');}
            else duplicates++;
        } else unique.set(key,row);
    }
    const observations=[...unique.values()].slice(-MAX_OBSERVATIONS),groups=new Map(),embeds={};
    for(const s of observations) {
        const key=JSON.stringify([s.m.player,s.m.type,s.m.id,s.m.modeContext?.ruleKey||'unscoped',s.m.modeContext?.role||'unknown']);
        if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s);
    }
    for(const rows of groups.values()) {
        const n=rows.length,mean=rows.reduce((sum,r)=>sum+r.value_target,0)/n;
        const variance=n>1?rows.reduce((sum,r)=>sum+(r.value_target-mean)**2,0)/(n-1):0;
        const sessionCount=new Set(rows.map(r=>r.m.sessionId)).size;
        const value=Math.max(-1,Math.min(1,mean*n/(n+SHRINK_PRIOR)-Math.sqrt(variance/n)));
        const emb=Array.from({length:130},(_,i)=>rows.reduce((sum,r)=>sum+r.f[i],0)/n),m=rows[0].m;
        const key=scopedHero(m.player,m.modeContext)+'|'+m.type;
        const reason=n<MIN_SAMPLES?'insufficient-samples':sessionCount<MIN_SESSIONS?'insufficient-sessions':value<=0?'nonpositive-conservative-value':null;
        (embeds[key]||(embeds[key]=[])).push({id:m.id,hero:m.player,count:n,sessionCount,mean,variance,value,bestValue:Math.max(...rows.map(r=>r.value_target)),emb,
            scope:m.modeContext?{ruleKey:m.modeContext.ruleKey,role:m.modeContext.role}:null,schema:'champion-estimate-v5',eligible:!reason,reason,estimator:'shrunk-mean-minus-standard-error'});
    }
    for(const key of Object.keys(embeds))embeds[key]=embeds[key].sort((a,b)=>b.value-a.value).slice(0,MAX_PER_ACTION);
    return {embeds,observations,audit:{accepted:observations.length,duplicates,conflicts:conflicts.size,rejected:reasons,
        evicted:Math.max(0,unique.size-MAX_OBSERVATIONS),window:MAX_OBSERVATIONS,mode:'shadow'}};
}
export function recompute(samples) {
    try {
        // 当前源中的同事务是权威更新；待核对/无效的新状态也撤销先前证据。
        const src=Array.isArray(samples)?samples:[],keys=new Set(src.map(observationKey).filter(Boolean));
        const previous=new Map((STORE.observations||[]).map(s=>[observationKey(s),s]));
        const incoming=src.map(s=>{const old=previous.get(observationKey(s));
            return old && s?.m && [old.m.player,old.m.type,old.m.id].join('|')!==[s.m.player,s.m.type||s.m.action,s.m.id].join('|') ? {...s,trainingEligible:false} : s;});
        const retained=(STORE.observations||[]).filter(s=>!keys.has(observationKey(s)));
        const result=aggregateObservations(retained.concat(incoming));
        Object.assign(STORE,result);STORE._ver=(STORE._ver||0)+1;
        STORE.audit.persisted=persist();return STORE.embeds;
    } catch (_) { return STORE.embeds||{}; }
}
export function championDiagnostics() { return JSON.parse(JSON.stringify({mode:'shadow',audit:STORE.audit,legacyEmbeds:STORE.legacyEmbeds||{}})); }

/* ★ 读取当前固化的嵌入条： { 'heroId|type': [ {id,value,count,bestValue,emb,hero} ] } */
export function getChampions() { return STORE.embeds || {}; }

/* ★ 强制从 localStorage 重读内存 STORE（用于"面板打开前同步存储"，避免展示空数据）。
 * 返回是否读取到了非空数据；供面板/诊断在打开前调用，消除时序导致的"有数据却显示0"。 */
export function reloadFromStorage() {
    try {
        // 写入失败时磁盘是旧数据，打开面板不得覆盖待重试内存证据。
        if(STORE.audit?.persisted===false)return Object.keys(STORE.embeds||{}).length>0;
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
function scopedHero(hero,c){return c?.ruleKey?hero+'@'+encodeURIComponent(JSON.stringify([c.ruleKey,c.role||'unknown'])):hero;}
function _rowsOf(heroId, action, context=null) {
    const key = heroId ? (scopedHero(heroId,context) + '|' + action) : action;
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
export function getEmbedding(action, id, heroId, context=null) {
    try {
        const rows = _rowsOf(heroId || '', action,context);
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].id === id) return rows[i];
        }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    return null;
}

/* 符号反馈不能重建原始收益与事务，禁止再直接改 value。
 * 可传完整最新样本；按同事务替换后重算，负面结果可以撤销加分。 */
export function feedbackSettle(type,id,heroId,settle) {
    const s=settle?.sample;
    if(!s?.m || s.m.player!==heroId || (s.m.type||s.m.action)!==type || s.m.id!==id || championSampleEligibility(s))return false;
    recompute([s]);return true;
}

/* ★ 余弦相似度（用于英雄间泛化复用）。
 * 仅使用上下文维度索引组 CONTEXT_IX 提取子向量计算，屏蔽动作类型/英雄身份等干扰维度，
 * 确保相似度真实反映"目标/局势/卡牌"场景契合度，避免相似度虚高导致"乱搬"。
 * 任意入参缺省/无嵌入/维度不齐则返回 -1（不相似）。 */
function _cosine(a, b) {
    try {
        if (!a || !b || !Array.isArray(a) || !Array.isArray(b)) return -1;
        if (a.length!==130 || b.length!==130 || a.some(v=>!Number.isFinite(v)) || b.some(v=>!Number.isFinite(v))) return -1;
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
        if (na === 0 || nb === 0 || !Number.isFinite(dot) || !Number.isFinite(na) || !Number.isFinite(nb)) return -1;
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
 *  场景参考向量 refEmb 传入，取与当前候选最相似的历史嵌入；缺省 refEmb 时不复用。
 *  ★ 优化：经 type 索引只扫"同类型"分组，不再全量遍历所有英雄×类型，显著降低决策热路径开销。 */
export function findSimilar(action, id, heroId, refEmb,context=null) {
    try {
        const selfKey = heroId ? (scopedHero(heroId,context) + '|' + action) : action;
        const groups = _sameTypeRows(action);
        let bestRow = null, bestSim = -1;
        for (let gi = 0; gi < groups.length; gi++) {
            const g = groups[gi];
            // 跳过自身英雄那一组
            if (g.key === selfKey) continue;
            const rows = g.rows || [];
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if(context?.ruleKey ? row.scope?.ruleKey!==context.ruleKey || row.scope?.role!==context.role : !!row.scope)continue;
                if (row.id !== id || !row.eligible || !(row.value > 0)) continue;
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

/* 默认旁路比较，不使用旧最高值；active 仅用于显式验收/后续切换。 */
export function applyChampionRule(acts,best,boost,ctx={}) {
    const mode=ctx.championMode==='active'?'active':'shadow';
    const evidence={domain:'learned-preference',schema:'champion-comparison-v5',mode,status:'kept',rows:[],sampleAudit:STORE.audit};
    try {
        const heroId=String(ctx.heroId||''),ranked=(acts||[]).filter(a=>a&&Number.isFinite(a.score)&&isCandidateEligible(a)&&sameCandidatePolicyBand(a,best)).sort((a,b)=>b.score-a.score);
        if(ranked.length<2 || !Number.isFinite(boost) || boost<=0)return {best,replaced:false,hit:0,evidence};
        const margin=normalizedMargin(ranked[0].score,ranked[1].score);evidence.margin=margin;
        const rows=ranked.map(a=>{
            const exact=getEmbedding(a.type,a.id,heroId,ctx.modeContext),generalized=exact?null:findSimilar(a.type,a.id,heroId,a._feat,ctx.modeContext);
            const row=exact||generalized?.row,sim=row?_cosine(a._feat,row.emb):-1;
            const reason=a.utilityVector?.ownedSources?.includes('championPreference')?'already-applied':!row?'missing-estimate':!row.eligible?row.reason:sim<SIM_THRESHOLD?'context-mismatch':null;
            const bonus=reason?0:Math.min(MAX_BONUS,boost*Math.max(0,row.value)*Math.max(0,sim)*(exact?1:0.5));
            const legacy=getLegacyEmbedding(a.type,a.id,heroId);
            return {a,score:a.score+bonus,bonus,similarity:sim,reason,estimate:row?{count:row.count,sessionCount:row.sessionCount,mean:row.mean,variance:row.variance,value:row.value,bestValue:row.bestValue}:null,
                legacyBonus:(legacy?.value??row?.bestValue)>0?boost*(0.5+Math.min(1,legacy?.value??row.bestValue)):0};
        });
        const winner=rows.slice().sort((a,b)=>b.score-a.score)[0];
        const allowed=margin<=DECISION_MARGIN.CLOSE;
        evidence.status=!allowed?'clear-margin':mode==='shadow'?'shadow':'kept';
        evidence.wouldReplace=allowed&&winner.a!==best&&winner.bonus>0;
        evidence.proposed=decisionActionSnapshot(winner.a);
        const oldWinner=rows.slice().sort((a,b)=>(b.a.score+b.legacyBonus)-(a.a.score+a.legacyBonus))[0];
        evidence.legacyProposed=decisionActionSnapshot(oldWinner.a);evidence.legacyWouldReplace=allowed&&oldWinner.a!==best&&oldWinner.legacyBonus>0;
        evidence.rowCount=rows.length;evidence.rowsTruncated=rows.length>32;
        evidence.rows=rows.slice(0,32).map(r=>({action:decisionActionSnapshot(r.a),baseScore:r.a.score,comparisonScore:r.score,bonus:r.bonus,similarity:r.similarity,reason:r.reason,estimate:r.estimate,legacyBonus:r.legacyBonus}));
        if(mode!=='active'||!evidence.wouldReplace)return {best,replaced:false,hit:rows.filter(r=>r.bonus>0).length,margin,evidence};
        const delta=Math.round(winner.score*100)/100-winner.a.score;
        if(delta<=0)return {best,replaced:false,hit:0,evidence};
        applyOwnedUtility(winner.a,'championPreference',[{dimension:'future',delta,note:'保守经验偏好，不代表实际收益',details:{domain:'learned-preference',estimate:winner.estimate,similarity:winner.similarity,margin}}]);
        winner.a._champion=true;evidence.status='replaced';
        return {best:winner.a,replaced:true,hit:rows.filter(r=>r.bonus>0).length,sim:winner.similarity,bonus:delta,margin,evidence};
    } catch(error) { evidence.status='error';evidence.reason=String(error);return {best,replaced:false,hit:0,evidence}; }
}
function getLegacyEmbedding(type,id,hero) { return (STORE.legacyEmbeds?.[hero+'|'+type]||[]).find(r=>r.id===id)||null; }
/* 旧接口不再绕过资格、场景和旁路模式直接写分。 */
export function applyChampionBoost() { return 0; }

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
    return { mode:'shadow', schema:'champion-estimate-v5', window:MAX_OBSERVATIONS, retainedSamples:STORE.observations?.length||0, types: keys.length, decisions: rowCount, samples: samples, embs: embCount, heroes: heroes, heroCount: Object.keys(heroes).length, updatedAt: STORE.updatedAt || 0, embeds: eb };
}

export function clear() {
    try {
        STORE = {...emptyStore(), _ver:(STORE._ver||0)+1};
        _lsRemove(STORE_KEY);
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}