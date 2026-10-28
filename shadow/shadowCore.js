// shadow/shadowCore.js
// Shadow模式：记录团队决策 vs v5集成决策，不接管实际决策

import { setV5Enabled, loadV5All, v5Predict, isV5Ready } from './decodeV5.js?v=41a';
import { isEnemyOf as relIsEnemyOf } from '../score/decision/relations/relations.js?v=41a';   /* ★ PR6-2：shadow 敌我判定接入统一关系系统 */

/* ===== ★ PR6-5：对局归属（matchId/matchResult）——外审 patch 落地 =====
 * 每条 shadow 记录在对局结束时回填 matchId + matchResult(win/lose)，
 * 用于「决策一致度 vs 对局胜率」分析，不依赖 reward。
 * 检测走 _status.over 轮询（不依赖 game.on）；胜负判定兼容 4 种 winner 形态；
 * _status 访问沿用本文件既有的 window 兜底模式（宿主非模块化，window._status 为活引用）。 */
let _currentMatchId = null;
let _matchEndHandled = false;
let _lastOverWinner;

function _pollStatusObj() {
    try { if (typeof _status !== 'undefined' && _status) return _status; } catch (eS1) {}
    try { if (typeof window !== 'undefined' && window._status) return window._status; } catch (eS2) {}
    return null;
}

/* PR5d：内置特征挂载——动态加载特征工程，为决策快照候选自动补挂 130 维特征
   （手机端 engine.js 可能是团队原版、无引擎侧挂载代码；v5 模型输入 130 维，
    features.js 的 f[130..133] 为 fix7 末尾追加段，slice(0,130) 截断语义无损） */
let _EF = null;
let _FEAT_DIM = 134;

const STORAGE_KEY = '__ai_reason_shadow_v5';
let _timer = null;
let _lastKey = '';
let _started = false;
let _shadowGeneration = 0;
export function stopShadowRuntime() {
    _shadowGeneration++; _started = false; DIAG.started = false;
    if (_timer) clearInterval(_timer); _timer = null;
    setV5Enabled(false); flushShadowLog(true); dropExitFlush();
}
const MAX_RECORDS = 300;   /* PR5：localStorage 是主扩展共享池（约5MB 配额），大日志会把主扩展其他 setItem 挤到 QuotaExceeded（被各模块静默吞掉→决策状态异常）。本地只留 300 条调试窗口（约600KB），全量分析数据以服务端 shadowV5 入库为准 */

let _logMem = null;          /* ★ 4.1.2.5：内存日志缓存——读一次常驻，记录/回填只改内存，防抖刷盘 */
let _logDirty = false;
let _flushTimer = null;
let _flushBackoffUntil = 0;  /* ★P2 修复：写盘失败（配额不足）后的退避截止时间，防 5s 一次无限重试 */
let _FLUSH_BACKOFF_MS = 60 * 1000;
let _exitHooked = false;     /* ★P2 修复：退出兜底监听是否已注册（幂等标记，绝不重复挂） */

function loadLog() {
    if (_logMem) return _logMem;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        _logMem = raw ? JSON.parse(raw) : [];
    } catch (e) { _logMem = []; }
    return _logMem;
}

/* ★ 4.1.2.5 防抖写盘：原来每条决策 2 次整包 JSON.parse + 2 次整包 JSON.stringify 同步写 localStorage（约 600KB×4），是对局卡顿与能耗大户之一。现在 5 秒定时、脏了才写。
 * ★P2 修复：写失败不再每 5 秒重试——退避 _FLUSH_BACKOFF_MS（默认 60s）；数据仍在内存，
 *   退避结束或退出兜底时再试，绝不因配额不足陷入高频写盘。 */
function markLogDirty() { _logDirty = true; }

function flushLog(force) {
    /* ★P2 修复：只有"存在未落盘的脏数据"才真正写盘。
     * force 仅用于绕过退避时间（退出兜底要尽力写一次），**不得绕过脏判断**——
     * pagehide 与 beforeunload 连续触发时，第二次不能对已保存的日志再整包同步写一遍。 */
    if (!_logMem || !_logDirty) return;
    if (_logMem.length === 0) return;                        /* 空日志不落盘（清空后不得把键重新建回来） */
    if (!force && Date.now() < _flushBackoffUntil) return;   /* 退避期内普通刷盘直接跳过 */
    while (_logMem.length > MAX_RECORDS) _logMem.shift();
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_logMem));
        _logDirty = false;
        _flushBackoffUntil = 0;
    } catch (e) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_logMem.slice(-MAX_RECORDS))); _logDirty = false; _flushBackoffUntil = 0; }
        catch (e2) { _flushBackoffUntil = Date.now() + _FLUSH_BACKOFF_MS; }
    }
}

function ensureFlushTimer() {
    if (_flushTimer) return;
    ensureExitFlush();
    _flushTimer = setInterval(() => { try { flushLog(false); } catch (eF) {} }, 5000);
}

/* ---------- 退出兜底（★P2 修复） ----------
 * 防抖窗口内的记录在"关页面 / 刷新 / 后台回收"时会随内存一起丢，
 * 因此挂一次性同步刷盘监听；注册与清理都幂等（_exitHooked 标记）。 */
function _flushOnExit() { try { flushLog(true); } catch (e) {} }

export function ensureExitFlush() {
    if (_exitHooked || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return false;
    _exitHooked = true;
    try { window.addEventListener('pagehide', _flushOnExit); } catch (e1) {}
    try { window.addEventListener('beforeunload', _flushOnExit); } catch (e2) {}
    return true;
}

export function dropExitFlush() {
    if (!_exitHooked) return false;
    _exitHooked = false;
    try { window.removeEventListener('pagehide', _flushOnExit); } catch (e1) {}
    try { window.removeEventListener('beforeunload', _flushOnExit); } catch (e2) {}
    return true;
}

/* 供扩展卸载 / 外部收口调用：尽力同步写掉未落盘的记录 */
export function flushShadowLog(force) { try { flushLog(force !== false); } catch (e) {} }

/* 测试钩子（与 weights.js 的 __ 约定一致）：只读写状态，不改变生产路径 */
export function __shadowLogTest() {
    return {
        markDirty: () => markLogDirty(),
        push: rec => { loadLog().push(rec); markLogDirty(); },   /* 等价于一条决策写入（追加 + 脏标记） */
        setBackoffMs: ms => { _FLUSH_BACKOFF_MS = Number(ms) || 0; },
        clearBackoff: () => { _flushBackoffUntil = 0; },
        flush: force => flushLog(force !== false),
        state: () => ({
            dirty: _logDirty, hasMem: !!_logMem, timer: !!_flushTimer,
            hooked: _exitHooked, backoffUntil: _flushBackoffUntil,
            memLen: _logMem ? _logMem.length : -1,
        }),
        peek: () => (_logMem ? _logMem.slice() : null),
    };
}

/* 兼容旧调用（off 收缩/全量替换场景）：覆盖内存并立即刷盘（替换后的内容即为待落盘数据 → 先标脏） */
function saveLog(log) {
    _logMem = log;
    _logDirty = true;
    flushLog(true);
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
    /* ★ PR6-2 修复：此前用 me.isEnemy / game.isEnemy——无名杀宿主不存在这两个 API，
       函数恒返回 false → 敌人掉血被 (isEnemy?1:-1) 乘成负收益，shadowV5 reward 全负。
       现优先复用决策引擎统一关系系统（dispositionOf：身份模式/国战/宿主 attitude 三态），
       与引擎 30+ 模块的敌我判定完全一致；get.attitude 作二级兜底。 */
    try {
        if (typeof relIsEnemyOf === 'function') return relIsEnemyOf(me, target) === true;
    } catch (eRel) {}
    try {
        if (typeof get !== 'undefined' && get && typeof get.attitude === 'function') {
            return get.attitude(me, target) < 0;
        }
    } catch (eAtt) {}
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
    if (log.length > MAX_RECORDS) log.shift();
    markLogDirty();   /* ★ 4.1.2.5：内存追加+脏标记，5s 防抖刷盘 */
    DIAG.processed++;

    setTimeout(() => {
        try {
            const snapAfter = snapshot(me, bestTarget);
            const gain = computeGain(snapBefore, snapAfter, isEnemy);
            const log2 = loadLog();
            const idx = log2.findIndex(r => r.decisionId === decisionId);
            if (idx >= 0) {
                log2[idx].reward = gain;
                markLogDirty();   /* ★ 4.1.2.5：内存回填+脏标记，不再整包重写 */
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
    const generation = ++_shadowGeneration;
    try { if (localStorage.getItem(OFF_KEY)) { _started = false; console.log('[Shadow] 已通过 shadow(\'off\') 关闭'); return; } } catch (eOff) {}
    setV5Enabled(true);
    DIAG.started = true;
    ensureFlushTimer();   /* ★ 4.1.2.5：防抖刷盘定时器（5s，脏了才写） */

    try {
        await loadV5All();
        console.log('[Shadow] v5集成模型加载完成');
    } catch (e) {
        console.error('[Shadow] v5加载失败:', e);
        return;
    }

    if (generation !== _shadowGeneration || !_started) return;

    /* PR5d：加载特征工程（绝对路径，手机端已验证可 import） */
    try {
        const fm = await import('/extension/无名AI/score/model/features/features.js');
        if (fm && typeof fm.extractFeatures === 'function') {
            _EF = fm.extractFeatures;
            _FEAT_DIM = fm.FEATURE_DIM || 134;
            console.log('[Shadow] 特征工程加载完成, FEATURE_DIM=' + _FEAT_DIM);
        }
    } catch (eFeat) { DIAG.err(eFeat); }

    if (generation !== _shadowGeneration || !_started) return;
    _timer = setInterval(() => {
        try { if (localStorage.getItem(OFF_KEY)) { clearInterval(_timer); _timer = null; _started = false; return; } } catch (eOff2) {}
        DIAG.polls++;

        /* ★ PR6-5：对局生命周期（以 gameStarted 识别新局，避免主菜单期误开 ID） */
        try {
            _ensureOverWrap();
            const MS = _pollStatusObj();
            const mStarted = !!(MS && MS.gameStarted);
            const mOver = !!(MS && MS.over);
            if (!_currentMatchId && mStarted && !mOver) {
                _currentMatchId = _genMatchId();
                _matchEndHandled = false;
                _lastOverWinner = undefined;
                try { console.log('[Shadow] 新对局开始: ' + _currentMatchId); } catch (eL1) {}
            } else if (_currentMatchId && mOver && !_matchEndHandled) {
                _onMatchEnd();
            }
        } catch (eMatch) {}

        try {
            const S = (typeof _status !== 'undefined' && _status) || {};   /* ★ 4.0.24：typeof 防御——可选链不保护未声明标识符，启动窗口会 ReferenceError */
            const cands = S.djsc_lastCandidates || [];
            const best = S.djsc_lastBest;
            if (cands.length) { DIAG.withCands++; DIAG.lastCandLen = cands.length; if (best) DIAG.withBest++; }
            if (!cands.length || !best) return;
            
            const me = S.currentPhase || game?.me;
            if (!me) return;
            DIAG.withMe++;

            /* ★ PR5d 特征补提已移除（4.1.2.5）：引擎侧已为前 15 个候选提取特征（engine.js 20ms 限时段），轮询侧重复提取纯浪费；>15 的候选与引擎行为对齐不参与 v5 对比 */
            if (false && _EF) {
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
    }, 2000);  /* ★ 4.1.2.5：轮询 500ms→2000ms（决策密集期仍无损：候选带 key 去重，2000ms 内的同一决策不会重复记录；后台空转的 localStorage 读减 4 倍） */
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
        _logMem = []; _logDirty = false;   /* ★ 4.1.2.5：同步清内存缓存 */
        _flushBackoffUntil = 0;            /* ★P2：清空即视为存储可用，解除写盘退避 */
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
        stopShadowRuntime();
        try { localStorage.setItem(OFF_KEY, '1'); } catch (e) {}
        if (_timer) { clearInterval(_timer); _timer = null; }
        _started = false; _lastKey = '';
        if (_flushTimer) { clearInterval(_flushTimer); _flushTimer = null; }   /* ★ 4.1.2.5：off 时停刷盘定时器并释放内存缓存 */
        try { flushLog(true); } catch (eF0) {}
        /* PR5b：off 时同步收缩本地日志到 MAX_RECORDS，立即释放共享配额
           （从旧版 2000 条上限升级来的场景：不清缩的话配额挤占在 off 后依旧存在）
           ★P2 修复：直接落盘收缩结果，不再走 saveLog —— saveLog 会把刚释放的内存缓存
           用同一份旧日志重新填回（旧缓存复活），后续任何强制刷盘都可能把已清空的日志写回去。 */
        let shrunk = false;
        try {
            if (log.length > MAX_RECORDS) {
                try { localStorage.setItem(STORAGE_KEY, JSON.stringify(log.slice(-MAX_RECORDS))); shrunk = true; } catch (eTrim0) {}
            }
        } catch (eTrim) {}
        _logMem = null; _logDirty = false; _flushBackoffUntil = 0;
        dropExitFlush();   /* 停止退出兜底：off 之后不得再有任何写盘路径 */
        if (shrunk) return { ok: true, msg: 'v5 shadow 已关闭，本地日志已收缩到 ' + MAX_RECORDS + ' 条（配额已释放）。恢复：shadow(\'on\') 后下一局生效' };
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


/* ===== ★ PR6-5：对局归属三函数 ===== */
function _genMatchId() {
    const d = new Date();
    const p = (n, l) => { n = String(n); while (n.length < (l || 2)) n = '0' + n; return n; };
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '_' + Math.random().toString(36).slice(2, 6);
}

function _ensureOverWrap() {
    /* PR6-5b: wrap game.over to capture the winner argument (pass-through, guarded) */
    try {
        if (typeof game === 'undefined' || !game || game.__djsc_over_wrapped) return;
        const orig = game.over;
        if (typeof orig !== 'function') return;
        game.over = function (winner) {
            try { _lastOverWinner = winner; } catch (eCap) {}
            return orig.apply(this, arguments);
        };
        game.__djsc_over_wrapped = true;
    } catch (eWrap) {}
}

function _judgeWin() {
    try {
        const me = (typeof game !== 'undefined' && game && game.me) || null;
        if (me && typeof me.isWin === 'function') {
            const w = me.isWin();
            if (w === true) return 'win';
            if (w === false) return 'lose';
        }
        const S = _pollStatusObj();
        let winner = null;
        /* PR6-5b: captured game.over winner first (real-device: _status.over=true but winner not persisted) */
        if (_lastOverWinner !== undefined && _lastOverWinner !== null) winner = _lastOverWinner;
        if ((winner === null || winner === true) && S && S.over && S.over !== true) winner = (S.over.winner !== undefined) ? S.over.winner : S.over;
        if ((winner === null || winner === true) && typeof game !== 'undefined' && game && game.winner !== undefined) winner = game.winner;
        if (winner == null || winner === true) return 'unknown';
        if (winner === false) return 'lose';
        const zhMap = { '主公': 'zhu', '忠臣': 'zhong', '反贼': 'fan', '内奸': 'nei', '主': 'zhu', '忠': 'zhong' };
        const mySideOf = () => {
            const idOf = String((me && me.identity) || '');
            return (idOf === 'zhu' || idOf === 'zhong') ? ['zhu', 'zhong'] : (idOf ? [idOf] : []);
        };
        let list = null;
        if (Array.isArray(winner)) {
            const strs = winner.filter(x => typeof x === 'string');
            if (strs.length && strs.length === winner.length) {
                if (!me) return 'unknown';
                const mySide = mySideOf();
                const norm = strs.map(x => zhMap[x] || String(x).toLowerCase());
                return norm.some(k => mySide.indexOf(k) >= 0) ? 'win' : 'lose';
            }
            list = winner;
        } else if (winner && typeof winner === 'object' && winner.name !== undefined) {
            list = [winner];
        }
        if (list && list.length && me) {
            const inList = list.some(p => p === me || (p && p.name && p.name === me.name));
            return inList ? 'win' : 'lose';
        }
        if (typeof winner === 'string' && me) {
            const mySide = mySideOf();
            const wNorm = zhMap[winner] || winner.toLowerCase();
            return mySide.indexOf(wNorm) >= 0 ? 'win' : 'lose';
        }
    } catch (eW) { try { DIAG.err(eW); } catch (eW2) {} }
    return 'unknown';
}


function _onMatchEnd() {
    try {
        const result = _judgeWin();
        const log = loadLog();
        let changed = 0;
        for (let i = 0; i < log.length; i++) {
            if (log[i] && !log[i].matchId) { log[i].matchId = _currentMatchId; log[i].matchResult = result; changed++; }
        }
        if (changed) saveLog(log);
        try { console.log('[Shadow] 对局结束: ' + _currentMatchId + ' result=' + result + ' 回填' + changed + '条'); } catch (eL2) {}
    } catch (eM) { try { DIAG.err(eM); } catch (eM2) {} }
    _currentMatchId = null;
    _matchEndHandled = true;
}
