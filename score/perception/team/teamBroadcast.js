/*
 * ============================================
 * // الناشر: في شينغ الأصلي
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · AI 协作广播 =================
 * 目的：让同阵营 AI 知道彼此的攻击意图，形成集火。
 * 通过 _status.djsc_broadcast 共享（每回合清空）。
 * 不依赖任何业务模块，叶子级。
 */
import { game, _status } from '../../foundation/adapt/host.js';
import { getModeStrategy, isSameCamp } from '../../decision/strategy/modeStrategy.js';

const MAX_AGE = 3000;
const MAX_ENTRIES = 30;

function _ensure() {
	try {
		if (!_status.djsc_broadcast) _status.djsc_broadcast = [];
		if (!Array.isArray(_status.djsc_broadcast)) _status.djsc_broadcast = [];
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return _status.djsc_broadcast;
}

export function broadcastIntent(from, targetName, cardId, score) {
	try {
		if (!from || !targetName) return;
		const arr = _ensure();
		let fromCamp = 'unknown';
		try { fromCamp = getModeStrategy().getCamp(from); } catch (eC) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eC); }
		arr.push({
			from: from.name1 || from.name,
			fromIdentity: from.identity || '',
			fromCamp: fromCamp,
			target: targetName,
			card: cardId || '',
			score: score || 0,
			ts: Date.now(),
		});
		while (arr.length > MAX_ENTRIES) arr.shift();
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export function readIntents(me, targetName) {
	try {
		if (!me || !targetName) return [];
		const arr = _ensure();
		const now = Date.now();
		let myCamp = 'unknown';
		try { myCamp = getModeStrategy().getCamp(me); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		return arr.filter(function (e) {
			if (now - e.ts > MAX_AGE) return false;
			if (e.from === (me.name1 || me.name)) return false;
			if (e.target !== targetName) return false;
			/* ★ 优先用存好的 fromCamp；没有则用 isSameCamp */
			let eCamp = e.fromCamp;
			if (!eCamp) {
				try { eCamp = _campOf(e.fromIdentity); } catch (err) { eCamp = 'unknown'; }
			}
			return eCamp === myCamp;
		});
	} catch (e) { return []; }
}

export function focusBonus(me, targetName) {
	try {
		const intents = readIntents(me, targetName);
		if (!intents.length) return 1.0;
		/* ★ 扩写：集火奖励优化 */
		/* 1. 基础奖励：每个队友的意图 +0.15，上限 +0.6 */
		let bonus = Math.min(0.6, intents.length * 0.15);
		/* 2. 高分意图加权：如果队友的评分很高，说明这个目标确实值得集火 */
		const avgScore = intents.reduce(function (s, e) { return s + (e.score || 0); }, 0) / intents.length;
		if (avgScore >= 8) bonus += 0.2;   /* 高分目标额外加成 */
		else if (avgScore >= 5) bonus += 0.1;
		/* 3. 濒死目标额外加成：如果目标已经残血，集火收益更高 */
		try {
			const target = game.players.find(function (p) {
				return (p.name1 || p.name) === targetName;
			});
			if (target && target.hp !== undefined && target.hp <= 1) {
				bonus += 0.3;   /* 濒死目标额外加成 */
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		return 1.0 + bonus;
	} catch (e) { return 1.0; }
}

function _camp(p) {
	try {
		const id = (p && p.identity) || '';
		return _campOf(id);
	} catch (e) { return 'unknown'; }
}
function _campOf(id) {
	if (id === 'zhu' || id === 'zhong' || id === 'mingzhong') return 'loyal';
	if (id === 'fan') return 'rebel';
	if (id === 'nei') return 'nei';
	return 'unknown';
}

let _hooked = false;
let _origCheck = null;   /* ★ Stage H：保存 game.check 原函数供卸载还原 */
export function installBroadcastHooks() {
	if (_hooked) return;
	try {
		const orig = game.check;
		if (typeof orig !== 'function') return;
		_origCheck = orig;
		game.check = function () {
			try { _ensure().length = 0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			return orig.apply(this, arguments);
		};
		_hooked = true;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ Stage H：卸载广播钩子（还原 game.check），供 engine.uninstallHooks 调用 */
export function uninstallBroadcastHooks() {
	try {
		if (_hooked && _origCheck) {
			game.check = _origCheck;
		}
		_hooked = false;
		_origCheck = null;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 面板/调试用：当前广播快照 */
export function snapshotBroadcast() {
	try {
		return _ensure().slice();
	} catch (e) { return []; }
}

/* 手动清空（面板按钮用） */
export function clearBroadcast() {
	try { _ensure().length = 0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 旧特征接口：从 missingModules 归位，保留旧字段、状态与计算方式。
 * 与本模块正式算法不等价，暂不互相替换，避免改变已训练模型的输入。 */
/* ================= 2. teamBroadcast - 团队广播 ================= */
const _teamMessages = [];  /* 团队消息队列 */

export const legacyTeamFeatures = {
    /* ★ 状态查询接口（兼容features.js调用） */
    getStatus: function(me) {
        try {
            if (!me) return null;
            const myMessages = _teamMessages.filter(m => m.from === me.name);
            return {
                messageCount: myMessages.length,
                hasFocus: myMessages.some(m => m.type === 'focus'),
                hasNeedPeach: myMessages.some(m => m.type === 'need_peach'),
            };
        } catch (e) { return null; }
    },

    /* 发送消息 */
    send: function(type, content) {
        try {
            _teamMessages.push({
                type: type,
                content: content,
                time: Date.now(),
            });
            /* 只保留最近50条 */
            if (_teamMessages.length > 50) _teamMessages.shift();
        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    },

    /* 获取最新消息 */
    latest: function(count) {
        count = count || 5;
        return _teamMessages.slice(-count);
    },

    /* 告诉队友：我需要桃 */
    needPeach: function() {
        this.send('need_peach', '我需要桃救援');
    },

    /* 告诉队友：集火目标 */
    focusTarget: function(playerName) {
        this.send('focus', '集火: ' + playerName);
    },

    /* 统计 */
    stats: function() {
        return {
            totalMessages: _teamMessages.length,
            types: [...new Set(_teamMessages.map(m => m.type))],
        };
    },
};
