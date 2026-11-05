/*
 * ============================================
 * // Wydawca: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ============================================
 * ★ 全局缓存层（减少重复计算，解决卡顿发烫）
 * ============================================ */
/* ★ 指令 04：显式导入宿主，消除「隐式全局在非浏览器环境静默失效」。 */
import { game, get, ui, _status } from '../adapt/host.js';

const _cache = new Map();
const _cacheTime = new Map();
const DEFAULT_TTL = 100; // 100ms缓存

/**
 * 获取缓存
 */
export function cacheGet(key, ttl = DEFAULT_TTL) {
    if (!_cache.has(key)) return null;
    const age = Date.now() - _cacheTime.get(key);
    if (age > ttl) {
        _cache.delete(key);
        _cacheTime.delete(key);
        return null;
    }
    return _cache.get(key);
}

/**
 * 设置缓存
 */
export function cacheSet(key, value) {
    _cache.set(key, value);
    _cacheTime.set(key, Date.now());
}

/**
 * 清空所有缓存
 */
export function cacheClear() {
    _cache.clear();
    _cacheTime.clear();
}

/**
 * 缓存统计
 */
export function cacheStats() {
    return {
/* Author: Feisheng Original, All rights reserved */
        size: _cache.size,
        keys: Array.from(_cache.keys()).slice(0, 10)
    };
}

/* ============================================
 * ★ 事件驱动：游戏状态变化时才清缓存
 * ============================================ */

let _lastStateKey = '';

/* 读取卡牌名的容错工具（宿主 get.name 优先，普通对象回退 .name） */
function _cacheCardName(card, player) {
    try {
        if (!card) return '';
        try {
            if (get && typeof get.name === 'function') {
                const n = get.name(card, player);
                if (typeof n === 'string' && n) return n;
            }
        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        if (typeof card.name === 'string') return card.name;
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    return '';
}

/**
 * 生成当前游戏状态指纹
 * 优化：纳入更多关键状态维度，避免缓存返回过时决策。
 */
function makeStateKey() {
    try {
        const current = (_status && _status.currentPhase) || ((typeof game !== 'undefined' && game.me) ? game.me : null);
        if (!current) return 'no_player';

        const parts = [];
        const currentKey = String(current.playerid || current.name1 || current.name || '?');
        parts.push('C:' + currentKey);

        /* 决策者自己的手牌可以精确读取；不读取其他玩家隐藏手牌内容，只记录公开手牌数。 */
        try {
            const ownHand = typeof current.getCards === 'function' ? (current.getCards('h') || []) : [];
            const ownSig = ownHand.map(function (card) {
                const name = _cacheCardName(card, current);
                let suit = '', number = '', nature = '';
                try { suit = get && typeof get.suit === 'function' ? (get.suit(card, current) || '') : (card.suit || ''); } catch (e) {}
                try { number = get && typeof get.number === 'function' ? (get.number(card, current) || '') : (card.number || ''); } catch (e) {}
                try { nature = get && typeof get.nature === 'function' ? (get.nature(card, current) || '') : (card.nature || ''); } catch (e) {}
                return name + ':' + suit + ':' + number + ':' + nature;
            }).sort().join(',');
            parts.push('H:' + ownSig);
        } catch (eOwn) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eOwn); }

        /* 本回合使用计数同样属于决策状态。
         * 典型例子：一次性/限次技能使用后可能不改手牌或 HP，但下一次 phaseUse 已不能再次使用。
         * 这里只读取当前决策者自己的公开运行状态，不涉及其他玩家隐藏信息。 */
        try {
            if (typeof current.getStat === 'function') {
                function statSig(obj) {
                    if (!obj || typeof obj !== 'object') return '';
                    return Object.keys(obj).sort().map(function (key) {
                        const v = obj[key];
                        if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
                            return key + '=' + String(v);
                        }
                        return '';
                    }).filter(Boolean).join(',');
                }
                const cardStat = current.getStat('card');
                const skillStat = current.getStat('skill');
                parts.push('USE:C=' + statSig(cardStat) + ':S=' + statSig(skillStat));
            }
        } catch (eStat) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eStat); }

        /* 所有存活角色仅使用公开/可观察状态：血量、手牌数量、横置、判定区、装备区。
         * 不读取其他玩家隐藏手牌牌名，避免缓存层引入信息泄漏。 */
        try {
            const players = (game && Array.isArray(game.players)) ? game.players : [];
            for (const p of players) {
                if (!p || p.alive === false) continue;
                const pk = String(p.playerid || p.name1 || p.name || p.name2 || '?');
                let handCount = 0, linked = 0, jn = '', en = '';
                try { handCount = typeof p.countCards === 'function' ? (p.countCards('h') || 0) : 0; } catch (e) {}
                try {
                    linked = (typeof p.isLinked === 'function' ? p.isLinked() : (p.isLinked || p.isChained)) ? 1 : 0;
                } catch (e) {}
                try {
                    if (typeof p.getCards === 'function') {
                        const jc = p.getCards('j') || [];
                        const ec = p.getCards('e') || [];
                        jn = jc.map(function (card) { return _cacheCardName(card, p); }).sort().join(',');
                        en = ec.map(function (card) { return _cacheCardName(card, p); }).sort().join(',');
                    }
                } catch (eInner) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eInner); }
                parts.push('P:' + pk + ':' + (p.hp || 0) + ':' + (p.maxHp || 0) + ':' + handCount + ':' + linked + ':J=' + jn + ':E=' + en);
            }
        } catch (ePlayers) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(ePlayers); }

        /* 牌堆只按数量级分桶，避免普通摸牌造成过度失效。 */
        try {
            const pile = game && (game.cardPile || (typeof ui !== 'undefined' && ui.cardPile));
            let len = 0;
            if (pile) {
                if (Array.isArray(pile)) len = pile.length;
                else if (pile.childNodes) len = pile.childNodes.length;
            }
            if (len > 0) {
                const bucket = Math.max(1, Math.round(Math.log2(len || 2)));
                parts.push('D:' + bucket);
            }
        } catch (ePile) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(ePile); }

        /* 当前事件窗口属于 decision identity：同一玩家在不同 choose/use/respond 窗口不能复用旧 bestAction。 */
        try {
            const ev = _status && _status.event;
            if (ev) {
                const evName = String(ev.name || ev.type || '');
                const evType = String(ev.type || '');
                const evSkill = String(ev.skill || '');
                const evStep = (typeof ev.step === 'number' || typeof ev.step === 'string') ? String(ev.step) : '';
                const playerKey = ev.player ? String(ev.player.playerid || ev.player.name1 || ev.player.name || '') : '';
                const sourceKey = ev.source ? String(ev.source.playerid || ev.source.name1 || ev.source.name || '') : '';
                const targetKey = ev.target ? String(ev.target.playerid || ev.target.name1 || ev.target.name || '') : '';
                let targetsKey = '';
                try {
                    if (Array.isArray(ev.targets)) {
                        targetsKey = ev.targets.map(function (p) {
                            return p ? String(p.playerid || p.name1 || p.name || '') : '';
                        }).filter(Boolean).sort().join(',');
                    }
                } catch (e) {}
                let cardKey = '';
                try { cardKey = ev.card ? _cacheCardName(ev.card, current) : ''; } catch (e) {}
                let parentName = '';
                try {
                    const parent = typeof ev.getParent === 'function' ? ev.getParent() : ev.parent;
                    parentName = parent ? String(parent.name || parent.type || '') : '';
                } catch (e) {}
                parts.push('EV:' + evName + ':' + evType + ':' + evSkill + ':' + evStep + ':' +
                    playerKey + ':' + sourceKey + ':' + targetKey + ':' + targetsKey + ':' + cardKey + ':' + parentName);
            }
        } catch (eEvent) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eEvent); }

        try {
            const round = (_status && typeof _status.roundNumber === 'number')
                ? _status.roundNumber
                : (game && typeof game.roundNumber === 'number' ? game.roundNumber : 0);
            parts.push('R:' + round);
        } catch (eRound) {}

        return parts.join('|');
    } catch (e) {
        return 'error_' + Date.now();
    }
}

export function stateKey() {
    return makeStateKey();
}

/**
 * 检查状态是否变化，变化了才清缓存
 */
export function checkStateChanged() {
    const key = makeStateKey();
    if (key !== _lastStateKey) {
        _lastStateKey = key;
        cacheClear();  // 状态变了才清缓存
        return true;   // 标记为已变化
    }
    return false;  // 状态没变，保留缓存
}

/**
 * 初始化状态监听
 */
export function initStateWatcher() {
    _lastStateKey = makeStateKey();
    console.log('[cache] ✅ 事件驱动缓存已启动：状态变化时才重算');
}
