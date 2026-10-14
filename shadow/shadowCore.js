// shadow/shadowCore.js
// Shadow模式：记录团队决策 vs v5集成决策，不接管实际决策

import { loadV5All, v5Predict, isV5Ready } from './decodeV5.js?v=5e5';

/* PR5d：内置特征挂载——动态加载特征工程，为决策快照候选自动补挂 130 维特征
   （手机端 engine.js 可能是团队原版、无引擎侧挂载代码；v5 模型输入 130 维，
    features.js 的 f[130..133] 为 fix7 末尾追加段，slice(0,130) 截断语义无损） */
let _EF = null;
let _FEAT_DIM = 134;

const STORAGE_KEY = '__ai_reason_shadow_v5';
let _timer = null;
let _lastKey = '';
let _started = false;
const MAX_RECORDS = 300;   /* PR5：localStorage 是主扩展共享池（约5MB 配额），大日志会把主扩展其他 setItem 挤到 QuotaExceeded（被各模块静默吞掉→决策状态异常）。本地只留 300 条调试窗口（约600KB），全量分析数据以服务端 shadowV5 入库为准 */

function loadLog() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

function saveLog(log) {
    while (log.length > MAX_RECORDS) log.shift();
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
    } catch (e) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(log.slice(-MAX_RECORDS))); } catch (e2) {}
    }
}

function snapshot(me, target) {
    return {
        meHp: me?.hp || 0,
        meHand: me?.countCards ? me.countCards('h') : 0,
        tHp: target ? (target.hp || 0) : 0,
        tHand: target?.countCards ? target.countCards('h') : 0,
        alive: (game?.players || []).filter(p => p && p.alive !== false).length,
    };
}

function computeGain(before, after, isEnemy) {
    let g = 0;
    if (after.tHp < before.tHp) g += (before.tHp - after.tHp) * 3 * (isEnemy ? 1 : -1);
    if (after.tHand < before.tHand) g += (before.tHand - after.tHand) * 1.5 * (isEnemy ? 1 : -1);
    if (after.meHp < before.meHp) g -= (before.meHp - after.meHp) * 2;
    if (after.alive < before.alive) g += 3 * (isEnemy ? 1 : -1);
    return Math.round(g * 100) / 100;
}

function isEnemyOf(me, target) {
    if (!me || !target) return false;
    try {
        if (me.isEnemy) return me.isEnemy(target);
        if (game?.isEnemy) return game.isEnemy(me, target);
    } catch (e) {}
    return false;
}

function processDecision(candidates, best, me, bestTargetObj) {
    if (!candidates?.length || !best) return;
    if (!isV5Ready()) return;
    
    /* PR5f fix: reward 目标必须是真实玩家对象。_finalResult.target 是 targetKey 字符串(无 hp/countCards)，用它会全 0; 真实对象从 engine 暴露的 _status.djsc_lastBestT 取。 */
    const bestTarget = bestTargetObj || best.targetObj || best._target || null;
    const snapBefore = snapshot(me, bestTarget);
    const isEnemy = isEnemyOf(me, bestTarget);
    
    const decisionId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const record = {
        decisionId,
        ts: Date.now(),
        round: (typeof _status !== 'undefined' && _status?.roundNumber) || 0,
        mode: (typeof _status !== 'undefined' && _status?.mode) || 'unknown',
        player: me?.name1 || me?.name || '?',
        candidates: [],
        teamPick: best.type + ':' + (best.rule || best.id),
        v5Pick: null,
        v5PickS42: null,
        v5PickS456: null,
        reward: null,
    };
    
    let bestEns = -Infinity;
    let bestS42 = -Infinity;
    let bestS456 = -Infinity;
    
    for (const c of candidates) {
        if (!c._feat || c._feat.length < 130) { DIAG.noFeat++; continue; }  /* v2: 130/134 维均接受 */
        const pred = v5Predict(c._feat);
        if (!pred) continue;
        
        record.candidates.push({
            key: c.type + ':' + c.id,
            ruleScore: c.score || 0,
            v5_ensemble: pred.ensemble,
            v5_s42: pred.s42,
            v5_s456: pred.s456,
        });
        
        if (pred.ensemble > bestEns) {
            bestEns = pred.ensemble;
            record.v5Pick = c.type + ':' + c.id;
        }
        if (pred.s42 > bestS42) {
            bestS42 = pred.s42;
            record.v5PickS42 = c.type + ':' + c.id;
        }
        if (pred.s456 > bestS456) {
            bestS456 = pred.s456;
            record.v5PickS456 = c.type + ':' + c.id;
        }
    }
    
    if (!record.candidates.length) { DIAG.emptyPred++; return; }
    
    const log = loadLog();
    log.push(record);
    saveLog(log);
    DIAG.processed++;
    
    setTimeout(() => {
        try {
            const snapAfter = snapshot(me, bestTarget);
            const gain = computeGain(snapBefore, snapAfter, isEnemy);
            const log2 = loadLog();
            const idx = log2.findIndex(r => r.decisionId === decisionId);
            if (idx >= 0) {
                log2[idx].reward = gain;
                saveLog(log2);
            }
        } catch (e) {}
    }, 3000);
}

const OFF_KEY = '__ai_reason_shadow_off';   /* PR5：一键开关（写 '1' 关闭），console: __AI_REASON.cmd.shadow('off'|'on') */
/* PR5c.1 诊断：全链路计数与错误缓存（控制台看不到 console 输出的环境用 shadow('diag') 查询） */
const DIAG = {
    started: false, polls: 0, withCands: 0, withBest: 0, withMe: 0,
    noFeat: 0, emptyPred: 0, processed: 0, featPatch: 0, lastCandLen: 0, errors: [],
    err(m) { const s = String((m && m.message) || m).slice(0, 140); if (this.errors[this.errors.length - 1] === s) return; this.errors.push(s); if (this.errors.length > 10) this.errors.splice(0, this.errors.length - 10); }
};
try { (window.__AI_REASON = window.__AI_REASON || {}).v5Diag = DIAG; } catch (eDiag) {}
export async function startShadow() {
    if (_started) return;
    _started = true;
    try { if (localStorage.getItem(OFF_KEY)) { _started = false; console.log('[Shadow] 已通过 shadow(\'off\') 关闭'); return; } } catch (eOff) {}
    DIAG.started = true;
    
    try {
        await loadV5All();
        console.log('[Shadow] v5集成模型加载完成');
    } catch (e) {
        console.error('[Shadow] v5加载失败:', e);
        return;
    }

    /* PR5d：加载特征工程（绝对路径，手机端已验证可 import） */
    try {
        const fm = await import('/extension/无名AI/score/model/features/features.js');
        if (fm && typeof fm.extractFeatures === 'function') {
            _EF = fm.extractFeatures;
            _FEAT_DIM = fm.FEATURE_DIM || 134;
            console.log('[Shadow] 特征工程加载完成, FEATURE_DIM=' + _FEAT_DIM);
        }
    } catch (eFeat) { DIAG.err(eFeat); }

    _timer = setInterval(() => {
        try { if (localStorage.getItem(OFF_KEY)) { clearInterval(_timer); _timer = null; _started = false; return; } } catch (eOff2) {}
        DIAG.polls++;

        try {
            const S = (typeof _status !== 'undefined' && _status) || {};   /* ★ 4.1.0：typeof 防御——可选链不保护未声明标识符，启动窗口会 ReferenceError */
            const cands = S.djsc_lastCandidates || [];
            const best = S.djsc_lastBest;
            if (cands.length) { DIAG.withCands++; DIAG.lastCandLen = cands.length; if (best) DIAG.withBest++; }
            if (!cands.length || !best) return;
            
            const me = S.currentPhase || game?.me;
            if (!me) return;
            DIAG.withMe++;

            /* PR5d：为无特征候选补挂 130 维（对齐 v5 模型输入维度） */
            if (_EF) {
                let _np = 0;
                try {
                    const alive = (game.players || []).filter(p => p && p.alive !== false);
                    const ctx = { bestT: S.djsc_lastBestT || null, bestTs: S.djsc_lastBestTs || 0, isEnemy: false, focusTarget: null };
                    const buf = new Int8Array(_FEAT_DIM || 134);
                    for (let i = 0; i < cands.length && i < 15; i++) {
                        if (cands[i]._feat) continue;
                        cands[i]._feat = Array.from(_EF(me, cands[i], ctx, buf, alive)).slice(0, 130);
                        _np++;
                    }
                    if (_np) DIAG.featPatch += _np;
                } catch (eFP) { DIAG.err(eFP); }
            }

            const key = cands.map(c => c.type + ':' + c.id).join('|') + '#' + best.type + ':' + (best.rule || best.id);
            if (key === _lastKey) return;
            _lastKey = key;
            
            processDecision(cands, best, me, S.djsc_lastBestT);
        } catch (ePoll) { DIAG.err(ePoll); }
    }, 500);
}

export function shadowCmd(action = 'stats') {
    const log = loadLog();
    
    if (action === 'export') {
        const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'shadow_v5_' + Date.now() + '.json';
        a.click();
        return { ok: true, msg: `已导出 ${log.length} 条记录` };
    }
    
    if (action === 'clear') {
        localStorage.removeItem(STORAGE_KEY);
        return { ok: true, msg: '已清空v5 shadow日志' };
    }

    if (action === 'diag') {
        let offFlag = false;
        try { offFlag = !!localStorage.getItem(OFF_KEY); } catch (eD1) {}
        const S = (typeof _status !== 'undefined' && _status) || {};
        const cands = S.djsc_lastCandidates || [];
        let featInfo = '-';
        try { for (const c of cands) { if (c._feat) { featInfo = c._feat.length; break; } } } catch (eD2) {}
        return { ok: true, off: offFlag, engineHook: typeof _status !== 'undefined' && !!S.djsc_lastCandidates,
            now: { candCount: cands.length, firstFeatLen: featInfo, hasBest: !!S.djsc_lastBest, hasCurrentPhase: !!S.currentPhase, hasGameMe: (typeof game !== 'undefined' && !!game && !!game.me) },
            diag: JSON.parse(JSON.stringify(DIAG)) };
    }

    if (action === 'off') {
        try { localStorage.setItem(OFF_KEY, '1'); } catch (e) {}
        if (_timer) { clearInterval(_timer); _timer = null; }
        _started = false; _lastKey = '';
        /* PR5b：off 时同步收缩本地日志到 MAX_RECORDS，立即释放共享配额
           （从旧版 2000 条上限升级来的场景：不清缩的话配额挤占在 off 后依旧存在） */
        try {
            if (log.length > MAX_RECORDS) {
                saveLog(log.slice(-MAX_RECORDS));
                return { ok: true, msg: 'v5 shadow 已关闭，本地日志已收缩到 ' + MAX_RECORDS + ' 条（配额已释放）。恢复：shadow(\'on\') 后下一局生效' };
            }
        } catch (eTrim) {}
        return { ok: true, msg: 'v5 shadow 已关闭（模型不再加载、不再记录）。恢复：shadow(\'on\') 后下一局生效' };
    }

    if (action === 'on') {
        try { localStorage.removeItem(OFF_KEY); } catch (e) {}
        try { startShadow(); } catch (eOn) {}
        return { ok: true, msg: 'v5 shadow 已启用，重开一局后开始记录' };
    }
    
    const withReward = log.filter(r => r.reward !== null).length;
    const agree = log.filter(r => r.teamPick === r.v5Pick).length;
    
    return {
        ok: true,
        msg: `v5 Shadow: 共${log.length}条, ${withReward}条有收益, 一致率${log.length ? (agree/log.length*100).toFixed(1) : '0.0'}%`,
        total: log.length,
        withReward,
        agreeRate: (log.length ? (agree / log.length * 100).toFixed(1) : '0.0') + '%',
        v5Ready: isV5Ready(),
        diag: { started: DIAG.started, polls: DIAG.polls, withCands: DIAG.withCands, noFeat: DIAG.noFeat, processed: DIAG.processed },
    };
}
