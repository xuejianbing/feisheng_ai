/*
 * ============================================
 * // Éditeur: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 风险量化 =================
 * 更精确的风险量化
 * "这次杀有 30% 概率被闪，70% 命中"
 * 现在的 probHasShan 是 0.5，可以改成动态
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js?v=5e5';
// Author: Feisheng Original | License: GPL-3.0
import { probHasShan, probHasWuxie, probHasTao, probHasSha } from '../../model/predict/handInference.js?v=5e5';

/* ================= 风险量化缓存 ================= */
const _riskCache = new Map();
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
		_riskCache.clear();
		_cacheRound = r;
	}
}

function _playerRiskKey(player) {
	try {
		const id = player && (player.playerid || player.name1 || player.name) || '?';
		const hand = player && player.countCards ? Math.max(0, Number(player.countCards('h')) || 0) : 0;
		return String(id) + ':h' + hand;
	} catch (e) {
		return '?';
	}
}

/* ================= 1. 杀的命中率风险量化 =================
 * 返回命中概率 0~1
 */
export function shaHitRate(me, target) {
	try {
		_syncCache();
		const key = 'sha_' + _playerRiskKey(me) + '_' + _playerRiskKey(target);
		if (_riskCache.has(key)) return _riskCache.get(key);

		/* 基础：对手有闪的概率 */
		const pShan = probHasShan(target);

		/* 八卦阵：判定红牌成功概率 */
		let pBagua = 0;
		try {
			if (target.hasEquip && target.hasEquip('bagua')) {
				/* 八卦阵：判定红牌 → 成功当闪 */
				/* 红牌概率约 50% */
				pBagua = 0.5;
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* 综合：被闪/八卦挡掉的概率 */
		const pBlocked = Math.max(pShan, pBagua);

		/* 命中率 = 1 - 被挡概率 */
		const hitRate = 1 - pBlocked;

		_riskCache.set(key, hitRate);
		return hitRate;
	} catch (e) {
		return 0.5;
	}
}

/* ================= 2. 无懈可击风险量化 =================
 * 返回锦囊被无懈的概率
 */
export function wuxieRisk(me, target, cardId) {
	try {
		_syncCache();
		const key = 'wuxie_' + cardId + '_' + _playerRiskKey(me) + '_' + _playerRiskKey(target);
		if (_riskCache.has(key)) return _riskCache.get(key);

		/* 对手有无懈的概率 */
		const pWuxie = probHasWuxie(target);

		/* 如果是延时锦囊 → 队友也可能有无懈 */
		let pTotal = pWuxie;

		_riskCache.set(key, pTotal);
		return pTotal;
	} catch (e) {
		return 0.15;
	}
}

/* Tekijä: Feisheng Original, Kaikki oikeudet pidätetään */
/* ================= 3. 决斗的风险量化 =================
 * 返回决斗胜率
 */
export function duelWinRate(me, target) {
	try {
		_syncCache();
		const key = 'duel_' + _playerRiskKey(me) + '_' + _playerRiskKey(target);
		if (_riskCache.has(key)) return _riskCache.get(key);

		/* 自己手牌是合法已知信息，精确判断；对手使用统一 Hand Belief。
		 * 决斗由目标先响应：目标无杀时发起者立即获利；目标有杀后才轮到自己响应。
		 * 这里只有“至少一张杀”的 belief，无法精确建模多轮杀链，因此双方都能响应时保守按 0.55。 */
		let mySha = 0;
		try { mySha = me.countCards && me.countCards('hs', 'sha') > 0 ? 1 : 0; } catch (e) { mySha = 0; }
		const enemySha = Math.max(0, Math.min(1, Number(probHasSha(target)) || 0));
		const winRate = Math.max(0, Math.min(1,
			(1 - enemySha) + enemySha * (mySha ? 0.55 : 0)
		));

		_riskCache.set(key, winRate);
		return winRate;
	} catch (e) {
		return 0.5;
	}
}

/* ================= 4. 桃的必要性评估 =================
 * 返回现在该不该用桃
 */
export function taoNecessity(me) {
	try {
		const hp = me.hp || 0;
		const maxHp = me.maxHp || 0;

		/* 血量比 */
		const ratio = hp / maxHp;

		if (ratio <= 0.2) {
			return { necessary: true, priority: 0.9, reason: '濒死状态，必须用桃' };
		} else if (ratio <= 0.4) {
			return { necessary: true, priority: 0.7, reason: '低血量，建议用桃' };
		} else if (ratio <= 0.6) {
			return { necessary: false, priority: 0.4, reason: '中血量，可以留桃' };
		} else {
			return { necessary: false, priority: 0.2, reason: '高血量，留桃给队友' };
		}
	} catch (e) {
		return { necessary: false, priority: 0.5, reason: '未知' };
	}
}

/* ================= 5. 综合风险评分 =================
 * 返回风险 0~1（越高越危险）
 */
export function riskScore(me, act) {
	try {
		if (!me || !act) return 0.5;

		let risk = 0.5;

		/* === 杀的风险 === */
		if (act.id === 'sha' && act.target) {
			const hitRate = shaHitRate(me, act.target);
			/* 命中率低 → 风险高 */
			risk = 1 - hitRate;
		}

		/* === 决斗的风险 === */
		if (act.id === 'juedou' && act.target) {
			const winRate = duelWinRate(me, act.target);
			risk = 1 - winRate;
		}

		/* === 锦囊的风险 === */
		if (['shunshou', 'guohe', 'lebu', 'bingliang'].indexOf(act.id) >= 0 && act.target) {
			const wuxieRiskVal = wuxieRisk(me, act.target, act.id);
			risk = wuxieRiskVal;
		}

		return Math.round(risk * 100) / 100;
	} catch (e) {
		return 0.5;
	}
}

/* ================= 6. 风险描述 ================= */
export function describeRisk(risk) {
	try {
		if (risk >= 0.8) return { label: '极高风险', color: 'darkred' };
		if (risk >= 0.6) return { label: '高风险', color: 'red' };
		if (risk >= 0.4) return { label: '中风险', color: 'yellow' };
		if (risk >= 0.2) return { label: '低风险', color: 'lightgreen' };
		return { label: '极低风险', color: 'green' };
	} catch (e) {
		return { label: '未知', color: 'gray' };
	}
}
