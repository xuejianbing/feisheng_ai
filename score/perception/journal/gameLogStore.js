/*
 * ============================================
 * // Éditeur: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 对局日志自存库 =================
 * 目的：内核自带的"录像"只保留最近 20 条，扩展无法改动内核代码。
 *   本模块把每局结束时的完整日志快照存进自己的库，保留局数由配置项 logRetain 决定
 *   （50 / 100 / 200 / 0=不限），从而绕开内核 20 条上限。
 *
 * 存储内容（全部是本扩展自己产生的数据，不依赖内核私有接口）：
 *   decisions   —— AI 决策链（含分数/理由），即"机"的操作
 *   logs        —— AI 决策日志
 *   playerLogs  —— 玩家（人）的实际操作，即"人"的操作
 *   topCards    —— 出牌统计
 *   verdict     —— 胜负结论
 *
 * 导出三种口径，专门服务于"人机分离训练 / 人当基准"的诉求：
 *   exportAllJson()     整库（人 + 机）
 *   exportPlayersJson() 只含人的操作（人当实验值/基准）
 *   exportBotsJson()    只含机的操作
 *   exportPairsJson()   同一局里人机并列（同尺度对标）
 */
import { VERSION_SEMVER } from '../../../js/config/version.js?v=5e5';
import { journalStorage } from '../../foundation/storage/journalStorage.js?v=5e5';
import { cfg } from '../../foundation/config/util.js?v=5e5';
import { log } from '../../foundation/diag/logger.js?v=5e5';
import { getJSON, setJSONQuotaSafe, safeRemove } from '../../foundation/storage/storage.js?v=5e5';
import { writeData, fileOf } from '../../foundation/storage/storagePaths.js?v=5e5';  /* ★ 统一导出路径 + 手机端兜底下载 */

const KEY = 'djsc_game_logs_v1';
const VERSION = 1;
const DEFAULT_CAP = 100;

/* ★ 全局共享的复制/时间戳小工具（不引业务模块，避免循环） */
function _copyText(text) {
    try {
        if (typeof game !== 'undefined' && game && typeof game.copy === 'function') { game.copy(text); return true; }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text); return true;
        }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    try {
        if (typeof document !== 'undefined') {
            const ta = document.createElement('textarea');
            ta.value = text; document.body.appendChild(ta); ta.select();
            const ok = document.execCommand && document.execCommand('copy');
            document.body.removeChild(ta);
            return !!ok;
        }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    return false;
}
function _ts() {
    const d = new Date();
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

let STORE = null;

/* ★ 单条快照的体积上限（字符数）：日志本身已在上游截尾，这里再兜一层，防单局爆库 */
const MAX_ENTRY_CHARS = 500000;
const MAX_STORE_BYTES = 100 * 1024 * 1024;
const byteSize = value => new TextEncoder().encode(JSON.stringify(value)).length;

function _load() {
    if (STORE) return STORE;
    try {
        const o = journalStorage.initial || getJSON(KEY, null);
        if (o && o.v === VERSION && Array.isArray(o.games)) { STORE = o; _trim(); _save(); return STORE; }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    STORE = { v: VERSION, games: [] };
    return STORE;
}

function _save() {
    try {
        /* 逐条裁剪到体积上限后再落盘 */
        const s = _load();
        _trim();
        for (const g of s.games) {
            g.decisions = (g.decisions || []).slice(-40);
            g.logs = (g.logs || []).slice(-20);
            g.playerLogs = (g.playerLogs || []).slice(-100);
            if (JSON.stringify(g).length > MAX_ENTRY_CHARS) {
                g.truncated = true;
                for (const key of ['logs', 'playerLogs', 'decisions', 'topCards']) {
                    while (g[key].length && JSON.stringify(g).length > MAX_ENTRY_CHARS) g[key].shift();
                }
            }
        }
        let bytes = byteSize(s);
        while (s.games.length && bytes > MAX_STORE_BYTES) {
            s.games.shift();
            bytes = byteSize(s);
        }
        if (!journalStorage.write(s, () => safeRemove(KEY))) {
            // Older environments: respect their smaller actual storage quota.
            while (!setJSONQuotaSafe(KEY, s) && s.games.length > 1) s.games.shift();
        }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* Bounded retention; legacy unlimited values fall back to 100. */
export function retainCap() {
    let n;
    try { n = parseInt(cfg('logRetain', DEFAULT_CAP), 10); } catch (e) { n = DEFAULT_CAP; }
    if (![50, 100, 200].includes(n)) n = DEFAULT_CAP;
    return n;
}

function _trim() {
    const s = _load();
    const cap = retainCap();
    if (cap > 0 && s.games.length > cap) {
        s.games.splice(0, s.games.length - cap);
    }
}

/* ★ 每局结束由 engine 调用：把整局日志快照入库 */
export function recordGame(bundle) {
    try {
        if (!bundle || !cfg('archiveGames', true)) return false;
        const s = _load();
        s.games.push({
            matchId: bundle.matchId || null,
            ts: bundle.ts || Date.now(),
            mode: bundle.mode || 'unknown',
            myIdentity: bundle.myIdentity || null,
            myScore: (typeof bundle.myScore === 'number') ? bundle.myScore : 0,
            verdict: bundle.verdict || 'unknown',
            decisions: Array.isArray(bundle.decisions) ? bundle.decisions : [],
            logs: Array.isArray(bundle.logs) ? bundle.logs : [],
            playerLogs: Array.isArray(bundle.playerLogs) ? bundle.playerLogs : [],
            topCards: Array.isArray(bundle.topCards) ? bundle.topCards : [],
        });
        _trim();
        _save();
        // Reaching the retention cap never exports files or interrupts the player.
        return true;
    } catch (e) {
        try { log.info('gameLog', '日志入库失败：' + e.message); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
        return false;
    }
}

export function listGames() {
    return _load().games.slice();
}
export function updateGameLogOutcome(matchId,kind,data) {
 const field=['actionOutcome','actionCredit'].includes(kind)?'actionOutcome':kind==='delayedActionOutcome'?'delayedOutcome':kind==='delayedEvidence'?'delayedEvidence':null;
 if(!matchId||!field)return false;
 const ids=data.transactionIds||[data.transactionId];let changed=false;
 for(const game of _load().games)if(game.matchId===matchId)for(const entry of game.logs||[])if(ids.includes(entry.transactionId)&&entry.actorId===data.actorId){
  entry[field]=field==='delayedEvidence'?[...(entry[field]||[]).filter(e=>e.evidenceId!==data.evidenceId),data].slice(-64):data;changed=true;
 }
 if(changed)_save();return changed;
}

export function gameCount() { return _load().games.length; }

export function clearGames() {
    try {
        STORE = { v: VERSION, games: [] };
        if (!journalStorage.write(STORE, () => safeRemove(KEY))) setJSONQuotaSafe(KEY, STORE);
        return true;
    } catch (e) { return false; }
}

/* ★ 从一个人的操作日志里抽出"人的操作序列"，供人机分离训练使用 */
function _humanOf(g) {
    return {
        ts: g.ts, mode: g.mode, verdict: g.verdict, myScore: g.myScore,
        ops: (g.playerLogs || []).map(function (l) {
            return { ts: l.ts, type: l.type, player: l.player, data: l.data };
        }),
    };
}

/* ★ 从 AI 决策链里抽出"机的操作序列" */
function _botOf(g) {
    return {
        ts: g.ts, mode: g.mode, verdict: g.verdict, myScore: g.myScore,
        ops: (g.decisions || []).map(function (d) {
            return d && d.best ? { ts: d.ts, action: d.best.action, score: d.best.score, reason: d.best.reason } : d;
        }),
    };
}

export function exportAllJson() {
    try {
        const s = _load();
        return JSON.stringify({ v: VERSION, extensionVersion: VERSION_SEMVER, settings: { logRetain: retainCap(), archiveGames: !!cfg('archiveGames', true), showReport: !!cfg('showReport', true) }, retention: retainCap(), exportedAt: Date.now(), count: s.games.length, games: s.games }, null, 2);
    } catch (e) { return '{}'; }
}

export function exportPlayersJson() {
    try {
        const s = _load();
        const games = s.games.map(_humanOf).filter(function (g) { return g.ops.length > 0; });
        return JSON.stringify({ v: VERSION, kind: 'players_only', exportedAt: Date.now(), count: games.length, games: games }, null, 2);
    } catch (e) { return '{}'; }
}

export function exportBotsJson() {
    try {
        const s = _load();
        const games = s.games.map(_botOf).filter(function (g) { return g.ops.length > 0; });
        return JSON.stringify({ v: VERSION, kind: 'bots_only', exportedAt: Date.now(), count: games.length, games: games }, null, 2);
    } catch (e) { return '{}'; }
}

/* ★ 人机并列：同一局、同一尺度，用于"人当基准、机做对照" */
export function exportPairsJson() {
    try {
        const s = _load();
        const games = s.games.map(function (g) {
            return { ts: g.ts, mode: g.mode, verdict: g.verdict, myScore: g.myScore, human: _humanOf(g), bot: _botOf(g) };
        });
        return JSON.stringify({ v: VERSION, kind: 'human_bot_pairs', exportedAt: Date.now(), count: games.length, games: games }, null, 2);
    } catch (e) { return '{}'; }
}

/* ★ 满额一条龙：对局日志达到保留上限 / 手动触发时，"打包导出 + 一键复制QQ群号"，
 *   与训练样本的 _oneStopShare 体验一致。 */
export function shareGameLogs() {
    try {
        const group = String((cfg('qqGroup', '') || '')).trim();
        const count = gameCount();
        const file = '无名AI_对局反馈包.json';
        const how = writeData('gamelog', file, exportAllJson(), function () {});
        const where = fileOf('gamelog', file);
        let msg = '📦 对局反馈包已请求导出（' + count + ' 局）：\n' + where + '\n包含胜负、玩家操作与AI决策日志。游戏目录中同名文件会覆盖；浏览器下载副本需手动管理。\n\n';
        if (group) {
            msg += '点“确定”复制交流群号（' + group + '），把导出的文件发到群里。';
            let go = true;
            try { go = (typeof confirm === 'function') ? !!confirm(msg) : true; } catch (e) { go = true; }
            if (go) {
                const copied = _copyText(group);
                try {
                    if (typeof alert === 'function') {
                        alert(copied ? ('✅ 群号已复制：' + group + '\n请把导出的文件发到群里。') : ('群号：' + group + '（复制失败，请手动记录）'));
                    }
                } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
            }
        } else {
            msg += '（未配置交流群号：在扩展设置里填写“交流群号”后即可一键复制）';
            try { if (typeof alert === 'function') alert(msg); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        }
        return { ok: how !== 'none', via: how, file: where, count: count };
    } catch (e) { return { ok: false, err: String(e) }; }
}

export function storeStats() {
    try {
        const s = _load();
        let humanOps = 0, botOps = 0, bytes = 0;
        for (let i = 0; i < s.games.length; i++) {
            humanOps += (s.games[i].playerLogs || []).length;
            botOps += (s.games[i].decisions || []).length;
        }
        try { bytes = JSON.stringify(s).length; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        return {
            games: s.games.length,
            cap: retainCap(),
            humanOps: humanOps,
            botOps: botOps,
            kb: Math.round(byteSize(s) / 1024),
            maxKb: MAX_STORE_BYTES / 1024,
            saving: !!cfg('archiveGames', true),
            storage: journalStorage.available ? 'IndexedDB' : '兼容存储（受设备配额限制）',
            error: journalStorage.error || '',
        };
    } catch (e) { return { games: 0, cap: DEFAULT_CAP, humanOps: 0, botOps: 0, kb: 0 }; }
}

if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.gameLogStore = {
        recordGame: recordGame, listGames: listGames, gameCount: gameCount, clearGames: clearGames,
        retainCap: retainCap, storeStats: storeStats,
        exportAllJson: exportAllJson, exportPlayersJson: exportPlayersJson,
        exportBotsJson: exportBotsJson, exportPairsJson: exportPairsJson,
        shareGameLogs: shareGameLogs,
    };
}
