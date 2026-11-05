/*
 * ============================================
 * // 作者: 飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 玩家状态事实层 · 统一 Player State Snapshot =================
 * 指令 05 · Stage A：Unified Player State Snapshot。
 *
 * 目标：策略层不再猜宿主字段，一律经本模块归一：
 *   存活、hp/maxHp、handCount、横置、判定区、装备区/装备价值、nextToAct、威胁。
 *
 * 收敛的历史分歧（禁止再散落读取）：
 *   - p.isLinked  / p.isChained     → 经 isPlayerLinked（唯一横置入口）
 *   - p.judges                      → judgeCardsOf（真实 getCards('j')）
 *   - p.isJudge / p.isJudged        → hasJudge（由真实判定区推导）
 *   - p.equipVal                    → equipValueOf（由真实装备区推导，不采信宿主猜测字段）
 *   - p.isNextToAct                 → nextToActOf
 *
 * 契约：
 *   - 纯读取，绝不修改 Player；
 *   - 任一字段读取失败一律 fail-safe（返回中性值），绝不抛错；
 *   - buildPlayerSnapshot(null) 返回安全空快照（alive=false，各计数=0）。
 */

import { get } from '../../foundation/adapt/host.js';
import { isPlayerLinked } from './playerState.js';
import { threatOf, probHasShan } from '../threat/threat.js';
import { isAllyOf, isEnemyOf } from '../relations/relations.js';   /* ★ 指令 05 Stage C：敌我关系唯一权威源 */

function _swallow(e) {
	try {
		if (typeof window !== 'undefined' && window.__DJSC && typeof window.__DJSC.swallow === 'function') {
			window.__DJSC.swallow(e);
		}
	} catch (_) { /* swallow 自身失败时不再递归 */ }
}

/* 宿主武器 id 白名单（与既有目标评估口径一致） */
const WEAPON_IDS = ['zhuge', 'fangtian', 'guding', 'qilin', 'qinglong'];

/* ---------- 卡牌名读取（宿主 get.name 优先，普通对象回退 .name） ---------- */
export function cardNameOf(card, player) {
	try {
		if (!card) return '';
		try {
			if (get && typeof get.name === 'function') {
				const n = get.name(card, player);
				if (typeof n === 'string' && n) return n;
			}
		} catch (e) { _swallow(e); }
		if (typeof card === 'string') return card;
		if (typeof card.name === 'string') return card.name;
		if (card.viewAs) {
			if (typeof card.viewAs === 'string') return card.viewAs;
			if (card.viewAs && typeof card.viewAs.name === 'string') return card.viewAs.name;
		}
	} catch (e) { _swallow(e); }
	return '';
}

/* ---------- 判定区事实（唯一入口，不再读 p.judges） ---------- */
export function judgeCardsOf(player) {
	try {
		if (!player) return [];
		if (typeof player.getCards === 'function') {
			const j = player.getCards('j');
			if (Array.isArray(j)) return j;
		}
	} catch (e) { _swallow(e); }
	return [];
}

/* ---------- 装备区事实（唯一入口） ---------- */
export function equipCardsOf(player) {
	try {
		if (!player) return [];
		if (typeof player.getCards === 'function') {
			const e = player.getCards('e');
			if (Array.isArray(e)) return e;
		}
	} catch (e) { _swallow(e); }
	return [];
}

/* 装备价值：由真实装备牌推导（get.equipValue → get.value → 1 兜底）。
 * 绝不读取宿主猜测字段 p.equipVal。 */
export function equipValueOf(player) {
	let sum = 0;
	try {
		const cards = equipCardsOf(player);
		for (const c of cards) {
			let v = 0;
			try { if (get && typeof get.equipValue === 'function') v = get.equipValue(c, player); } catch (e) { _swallow(e); }
			if (!(v > 0)) {
				try { if (get && typeof get.value === 'function') v = get.value(c, player); } catch (e) { _swallow(e); }
			}
			/* 统一转数值：宿主可能返回数字字符串，避免 sum 与字符串拼接 */
			const n = Number(v);
			if (!(n > 0) || !isFinite(n)) sum += 1;
			else sum += n;
		}
	} catch (e) { _swallow(e); }
	return Math.round(sum * 1000) / 1000;
}

/* ---------- 手牌 / 杀 / 即将行动 / 主公 事实 ---------- */
export function handCountOf(player) {
	try {
		if (!player) return 0;
		if (typeof player.countCards === 'function') return player.countCards('h') || 0;
	} catch (e) { _swallow(e); }
	return 0;
}

export function shaCountOf(player) {
	try {
		if (!player) return 0;
		if (typeof player.countCards === 'function') return player.countCards('hs', 'sha') || 0;
	} catch (e) { _swallow(e); }
	return 0;
}

export function nextToActOf(player) {
	try { return !!(player && player.isNextToAct); } catch (e) { _swallow(e); return false; }
}

export function isLordOf(player) {
	try {
		if (!player) return false;
		const pid = player.identity || player.identity1 || player._identity1 || null;
		return pid === 'zhu' || pid === 'lord' || pid === 'zhugong' || pid === '主公' || player.isLord === true;
	} catch (e) { _swallow(e); return false; }
}

/**
 * 构建统一 Player State Snapshot。
 * @param {*} player 无名杀 Player 对象（可为 null）
 * @returns {Object} 归一化快照（纯数据，绝不修改 Player）
 */
export function buildPlayerSnapshot(player) {
	const snap = {
		ref: player || null,
		name: '',
		alive: false,
		hp: 0,
		maxHp: 0,
		handCount: 0,
		shaCount: 0,
		linked: false,
		judgeCards: [],
		judgeNames: [],
		hasJudge: false,
		equipCards: [],
		equipNames: [],
		equipCount: 0,
		equipVal: 0,
		hasWeapon: false,
		nextToAct: false,
		isLord: false,
		threat: 0,
	};
	try {
		if (!player) return snap;
		snap.name = String(player.name1 || player.name || '?');
		snap.alive = player.alive !== false;
		snap.hp = (typeof player.hp === 'number') ? player.hp : 3;
		snap.maxHp = (typeof player.maxHp === 'number' && player.maxHp) ? player.maxHp : 3;
		snap.handCount = handCountOf(player);
		snap.shaCount = shaCountOf(player);
		snap.linked = isPlayerLinked(player);

		const jc = judgeCardsOf(player);
		snap.judgeCards = jc;
		snap.judgeNames = jc.map(function (c) { return cardNameOf(c, player); }).filter(Boolean);
		snap.hasJudge = jc.length > 0;

		const ec = equipCardsOf(player);
		snap.equipCards = ec;
		snap.equipNames = ec.map(function (c) { return cardNameOf(c, player); }).filter(Boolean);
		snap.equipCount = ec.length;
		snap.equipVal = equipValueOf(player);
		snap.hasWeapon = snap.equipNames.some(function (n) { return WEAPON_IDS.indexOf(n) >= 0; });

		snap.nextToAct = nextToActOf(player);
		snap.isLord = isLordOf(player);
		try {
			const th = threatOf(player);
			snap.threat = (typeof th === 'number' && isFinite(th)) ? th : 0;
		} catch (e) { _swallow(e); }
	} catch (e) { _swallow(e); }
	return snap;
}

/* 供上层批量构建（过滤自己/阵亡由调用方决定） */
export function buildSnapshots(players) {
	try {
		if (!Array.isArray(players)) return [];
		return players.map(function (p) { return buildPlayerSnapshot(p); });
	} catch (e) { _swallow(e); return []; }
}

/* ================= 目标候选数据契约 · buildTargetCandidate =================
 * 指令 05 · Stage C：targetBrain Data Contract。
 * 统一「目标候选」的生产：状态事实（Stage A 快照）+ 敌我关系（Stage B 权威源）+ 闪避概率。
 * basic/targetBrain.js 只消费本契约字段；engine 不再各自手拼（消除字段缺失/口径漂移）。
 *
 * 字段契约（与 targetBrain.js 的消费口径一一对应）：
 *   relation: isAlly / isEnemy（敌我三态，非阵营）
 *   state:    hp / maxHp / threat / handCount / shaCount / shanProb
 *             equipVal / equipCount / judgeCards / isJudge / nextToAct / linked / isLord
 *   retrieval: pp（回取 Player） / ref / name
 */
export function buildTargetCandidate(me, player) {
	try {
		const snap = buildPlayerSnapshot(player);
		if (!snap || snap.alive === false) return null;
		let ally = false, en = false;
		try { ally = isAllyOf(me, player); en = isEnemyOf(me, player); } catch (e) { _swallow(e); }
		return {
			pp: player || null,
			ref: snap.ref,
			name: snap.name,
			isAlly: ally,
			isEnemy: en,
			hp: snap.hp,
			maxHp: snap.maxHp,
			threat: snap.threat,
			handCount: snap.handCount,
			shaCount: snap.shaCount,
			shanProb: probHasShan(me, player),
			equipVal: snap.equipVal,
			equipCount: snap.equipCount,
			judgeCards: snap.judgeCards,
			isJudge: snap.hasJudge,
			nextToAct: snap.nextToAct,
			linked: snap.linked,
			isLord: snap.isLord,
		};
	} catch (e) { _swallow(e); return null; }
}

export default {
	cardNameOf, judgeCardsOf, equipCardsOf, equipValueOf,
	handCountOf, shaCountOf, nextToActOf, isLordOf,
	buildPlayerSnapshot, buildSnapshots, buildTargetCandidate,
};