import { playerKey } from '../../foundation/adapt/playerIdentity.js?v=41a';
/*
 * ============================================
 * // Autor: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 对手手牌推断 =================
 * 基于牌堆剩余 + 历史行为，用贝叶斯推断对手手里有什么牌
 * 动态计算 probHasShan / probHasWuxie / probHasTao 等
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js?v=41a';
import { cardRemaining, totalRemaining } from '../../perception/memory/deckMemory.js?v=41a';
import { MEM, memKeyOf } from '../../perception/memory/mem.js?v=41a';
import { styleShanFactor } from '../../perception/observer/observer.js?v=41a';
// Författare: Feisheng Original | Licens: GPL-3.0

/* ================= 推断缓存 ================= */
const _inferCache = new Map();
let _cacheRound = -1;

function _roundKey() {
	try {
		if (_status && typeof _status.roundNumber === "number") return _status.roundNumber;
		if (typeof game === "object" && typeof game.roundNumber === "number") return game.roundNumber;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return 0;
}

function _syncCache() {
	const r = _roundKey();
	if (r !== _cacheRound) {
		_cacheRound = r;
		_inferCache.clear();
	}
}

/* ★ 指令 05 Stage I：缓存 key 纳入 hand revision（手牌数）+ deck revision（牌堆总量分桶）。
 * 旧实现只按 round + player.name + cardId 缓存，同一轮内玩家手牌增减 / 牌堆被消耗后仍返回旧值，
 * 导致 probHasShan/probHasTao 等对手牌推断「过时」（stale cache）。
 * hand 用精确值（便宜），deck 用 log2 分桶（避免每摸一张就失效引发卡顿）。 */
function _deckBucket() {
	try {
		const t = totalRemaining();
		if (typeof t !== 'number' || !isFinite(t)) return 0;
		return t <= 0 ? 0 : Math.max(1, Math.round(Math.log2(t)));
	} catch (e) { return 0; }
}

function _inferKey(prefix, player) {
	try {
		const name = playerKey(player) || '?';
		const hc = (player && typeof player.countCards === 'function') ? player.countCards('h') : 0;
		let evidence = '';
		if (prefix === 'shan') {
			try {
				const k = memKeyOf(player);
				const atk = k ? Number(MEM.atk[k] || 0) : 0;
				const hit = k ? Number(MEM.hit[k] || 0) : 0;
				const sf = Number(styleShanFactor(player) || 1);
				evidence = '_a' + atk + '_x' + hit + '_s' + sf.toFixed(2);
			} catch (e) {}
		}
		return prefix + '_' + name + '_h' + hc + '_d' + _deckBucket() + evidence;
	} catch (e) { return prefix + '_?'; }
}

function _handCount(player) {
	try {
		return player && typeof player.countCards === 'function'
			? Math.max(0, Number(player.countCards('h')) || 0)
			: 0;
	} catch (e) {
		return 0;
	}
}

function _probContains(player, cardId, maxPerCard, fallback) {
	const handCount = _handCount(player);
	if (handCount <= 0) return 0;
	try {
		const remain = Number(cardRemaining(cardId));
		const total = Number(totalRemaining());
		if (!(total > 0) || !Number.isFinite(remain) || remain < 0) {
			return Math.max(0, Math.min(1, Number(fallback) || 0));
		}
		const pPerCard = Math.max(0, Math.min(Number(maxPerCard) || 1, remain / total));
		return Math.max(0, Math.min(1, 1 - Math.pow(1 - pPerCard, handCount)));
	} catch (e) {
		return Math.max(0, Math.min(1, Number(fallback) || 0));
	}
}

function _shanEvidenceAdjusted(player, probability) {
	if (_handCount(player) <= 0) return 0;
	let p = Math.max(0, Math.min(1, Number(probability) || 0));
	try {
		const k = memKeyOf(player);
		const attacks = k ? Number(MEM.atk[k] || 0) : 0;
		const hits = k ? Number(MEM.hit[k] || 0) : 0;
		if (attacks >= 2) {
			const empiricalShan = Math.max(0, Math.min(1, 1 - hits / attacks));
			p = empiricalShan * 0.7 + p * 0.3;
			const hitRate = hits / attacks;
			if (attacks >= 3) {
				if (hitRate <= 0.2) p = Math.min(0.95, p + 0.15);
				else if (hitRate >= 0.8) p = Math.max(0, p - 0.10);
			}
		}
	} catch (e) {}
	try { p *= styleShanFactor(player); } catch (e) {}
	return Math.max(0, Math.min(0.95, Math.round(p * 1000) / 1000));
}

/* ================= 1. 推断对手有闪概率 =================
 * 基础概率 = 牌堆剩余闪数 / 牌堆总剩余
 * 修正：对手手牌数、历史行为、座位位置
 */
export function probHasShan(player) {
	_syncCache();
	const key = _inferKey('shan', player);
	if (_inferCache.has(key)) return _inferCache.get(key);
	const p = _shanEvidenceAdjusted(player, _probContains(player, 'shan', 0.9, 0.5));
	_inferCache.set(key, p);
	return p;
}

/* ================= 2. 推断对手有无懈概率 ================= */
export function probHasWuxie(player) {
	_syncCache();
	const key = _inferKey('wuxie', player);
	if (_inferCache.has(key)) return _inferCache.get(key);
	const p = _probContains(player, 'wuxie', 0.5, 0.15);
	_inferCache.set(key, p);
	return p;
}

/* ================= 3. 推断对手有桃概率 ================= */
export function probHasTao(player) {
	_syncCache();
	const key = _inferKey('tao', player);
	if (_inferCache.has(key)) return _inferCache.get(key);
	const p = _probContains(player, 'tao', 0.5, 0.1);
	_inferCache.set(key, p);
	return p;
}

/* ================= 4. 推断对手有杀概率 ================= */
export function probHasSha(player) {
	_syncCache();
	const key = _inferKey('sha', player);
	if (_inferCache.has(key)) return _inferCache.get(key);
	const p = _probContains(player, 'sha', 0.8, 0.4);
	_inferCache.set(key, p);
	return p;
}

/* ================= 5. 推断对手有酒概率 ================= */
export function probHasJiu(player) {
	_syncCache();
	const key = _inferKey('jiu', player);
	if (_inferCache.has(key)) return _inferCache.get(key);
	const p = _probContains(player, 'jiu', 0.3, 0.05);
	_inferCache.set(key, p);
	return p;
}

/* ================= 6. 推断对手有装备概率 ================= */
export function probHasEquip(player, equipId) {
	_syncCache();
	const key = _inferKey('equip_' + equipId, player);
	if (_inferCache.has(key)) return _inferCache.get(key);
	const p = _probContains(player, equipId, 0.3, 0);
	_inferCache.set(key, p);
	return p;
}

/* ================= 7. 批量推断对手手牌 ================= */
export function inferHand(player) {
	try {
		return {
			shan: probHasShan(player),
			wuxie: probHasWuxie(player),
			tao: probHasTao(player),
			sha: probHasSha(player),
			jiu: probHasJiu(player),
			guohe: probHasCard(player, 'guohe'),
			shunshou: probHasCard(player, 'shunshou'),
			juedou: probHasCard(player, 'juedou'),
			nanman: probHasCard(player, 'nanman'),
			wanjian: probHasCard(player, 'wanjian'),
			lebu: probHasCard(player, 'lebu'),
			bingliang: probHasCard(player, 'bingliang'),
			tiesuo: probHasCard(player, 'tiesuo'),
			wuzhong: probHasCard(player, 'wuzhong'),
			huogong: probHasCard(player, 'huogong'),
		};
	} catch (e) {
		return { shan: 0.5, wuxie: 0.15, tao: 0.1, sha: 0.4, jiu: 0.05 };
	}
}

/* ================= 通用卡牌推断函数 ================= */
export function probHasCard(player, cardId) {
	_syncCache();
	const key = _inferKey(cardId, player);
	if (_inferCache.has(key)) return _inferCache.get(key);
	const maxProb = {
		'guohe': 0.3, 'shunshou': 0.3, 'juedou': 0.2,
		'nanman': 0.1, 'wanjian': 0.1, 'taoyuan': 0.05,
		'wugu': 0.05, 'lebu': 0.2, 'bingliang': 0.2,
		'tiesuo': 0.15, 'wuzhong': 0.3, 'huogong': 0.15,
		'jiedao': 0.15, 'shandian': 0.05,
	};
	const p = _probContains(player, cardId, maxProb[cardId] || 0.2, 0.05);
	_inferCache.set(key, p);
	return p;
}

/* ================= 8. 清空缓存 ================= */
export function clearInferCache() {
	_inferCache.clear();
	_cacheRound = -1;
}
