/* 职责：候选动作的预期收益、机会成本、边际价值及其缓存。
 * 所有估值读取同一缓存；每次决策按原位置刷新目标概率，不执行动作。 */
import { lib, game, get } from '../../foundation/adapt/host.js';
import { VAL_CARD } from '../../knowledge/tables/value-tables.js';
import { probHasBagua, probHasShan, hasVengeanceSkill } from '../threat/threat.js';
import { baguaSuccessRate } from '../../model/predict/deckPredict.js';
function opportunityCost(id, econ) {
	const OC = { shan: 1.5, tao: 1.5, wuxie: 1.5, jiu: 0.8, sha: 0.3, guohe: 0.4, shunshou: 0.4, wuzhong: 0.2, tiesuo: 0.2, lebu: 0.3, bingliang: 0.3, nanman: 0.4, wanjian: 0.4, juedou: 0.4, huogong: 0.4 };
	let base = OC[id] !== undefined ? OC[id] : 0.3;
	if (econ) {
		if (econ.handCount <= 2) base *= 1.6;
		else if (econ.handCount <= 4) base *= 1.2;
		if (econ.hpRatio < 0.3 && (id === "shan" || id === "tao" || id === "wuxie")) base *= 1.3;
	}
	return Math.round(base * 100) / 100;
}
/* ★ 手牌计数快照缓存：countCardName / hasCardName 在单次决策循环里会被
 *   同一玩家多次调用（expectedValue 对 sha 查 jiu、对 juedou 查 sha），
 *   每次都 me.getCards("h") 重扫整手牌。加入逆转指针快照（prevHand === 当前手牌引用）
 *   只扫一次，避免 ×候选数 的重复扫描（性能/能耗优化）。
 *   WeakMap 以 me 为键，玩家对象死亡/换局即释放，无跨局内存残留。 */
const _handCountCache = new WeakMap();
const _handFreqCache = new WeakMap();   /* 边际频次缓存：key 为手牌 id 数组引用 → { id: count } */
function countCardName(me, id) {
	try {
		let snapshot = _handCountCache.get(me);
		const h = me.getCards ? me.getCards("h") : null;
		if (!h) return 0;
		if (!snapshot || snapshot.prevHand !== h) {
			const m = {};
			for (let i = 0; i < h.length; i++) {
				const c = h[i];
				if (!c) continue;
				const n = c.name || "";
				if (n) m[n] = (m[n] || 0) + 1;
			}
			snapshot = { prevHand: h, counts: m };
			_handCountCache.set(me, snapshot);
		}
		return snapshot.counts[id] || 0;
	} catch (e) { return 0; }
}
function hasCardName(me, id) { try { return countCardName(me, id) > 0; } catch (e) { return false; } }
/* ★ 重置手牌缓存（详情：牌堆变化等原因确认手牌引用已失效时统一定点失效，
 *   避免极端情况下持 stale 快照；正常路径靠 prevHand 引用自动失效，无额外开销） */
function clearHandCountCache(me) { try { if (me) _handCountCache.delete(me); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }
function hasNatureCard(me) {
	try { return !!me.getCards("h", function (c) { return game.hasNature ? (game.hasNature(c, "fire") || game.hasNature(c, "thunder")) : false; }).length; } catch (e) { return false; }
}
let _probShanCache = new WeakMap();   // key: tgt 对象 → { hp, hc, value }（WeakMap 避免强引用玩家对象导致的跨局内存残留）
function _probShanCached(me, tgt) {
	try {
		const hc = tgt.countCards ? tgt.countCards("h") : 0;
		const hit = _probShanCache.get(tgt);
		if (hit && hit.hp === (tgt.hp || 0) && hit.hc === hc) return hit.value;
		const v = probHasShan(me, tgt);
		_probShanCache.set(tgt, { hp: tgt.hp || 0, hc: hc, value: v });
		return v;
	} catch (e) { return probHasShan(me, tgt); }
}
function expectedValue(me, card, tgt) {
	try {
		const id = typeof card === "string" ? card : (card.name || "");
		if (id === "sha") {
			let pHit = 1 - _probShanCached(me, tgt);
			try {
				if (probHasBagua(tgt)) {
					/* ★ 八卦阵是"额外闪避"，正确模型是 未闪成功 且 八卦也未判成成功：
					 *   pHit *= (1 - bgRate)  而非  pHit -= bgRate（后者会低估命中率）。 */
					const bgRate = baguaSuccessRate();
					pHit *= (1 - bgRate);
				}
			} catch (e) {
				if (probHasBagua(tgt)) pHit *= 0.5;
			}
			/* ★ 酒杀不能按"有酒=必成功"：同时要有杀可打、酒才可能喂给这一刀。
			 * 有酒可加伤但非必然，按 0.85 折算"醉杀成功率"，避免过度乐观。 */
			const hasJiu = hasCardName(me, "jiu");
			const hasShaNow = countCardName(me, "sha") >= 1;
			const dmg = 1 + (hasJiu && hasShaNow ? 0.85 : 0);
			const kill = (tgt.hp !== undefined && tgt.hp - dmg <= 0) ? 6 : 0;
			/* ★ 卖血/反击惩罚也需乘命中概率：打不中就不该扣分 */
			let counter = 0;
			try { if (hasVengeanceSkill(tgt)) counter = pHit * -3; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			/* ★ 残血奖励按命中折算 */
			const lowHpBonus = (tgt.hp !== undefined && tgt.hp <= 2 ? 1 : 0) * Math.max(0.05, pHit);
			return Math.round((Math.max(0.03, pHit) * (2 * dmg + kill + counter) + lowHpBonus) * 100) / 100;
		}
		if (id === "juedou") {
			const hc = tgt.countCards ? tgt.countCards("h") : 0;
			const mySha = countCardName(me, "sha");
			/* ★ 决斗 EV 需同时计入"自己失败受伤"：赢面 * 成功收益 + 输面 * 自伤。
			 * 敌人舍得出杀则我方可能一直出到没杀 → 自伤期望。 */
			const pHit = mySha >= hc ? 0.75 : 0.4;
			const kill = (tgt.hp !== undefined && tgt.hp <= 1) ? 6 : 0;
			/* 我方没杀的输面：敌方每有杀则我方受损。粗略：输面 = (1-pHit)，自伤 ≈ 敌我杀差 */
			const selfDmg = Math.max(0, (hc - mySha)) * 0.8 * (1 - pHit);
			const successEV = pHit * (2 + kill);
			/* 输面再按血量剩余折算（血多输面损失小按比例） */
			const failEV = -selfDmg * (tgt.hp !== undefined ? 1 : 1);
			return Math.round((successEV + failEV) * 100) / 100;
		}
		const v = VAL_CARD[id];
		if (!v || !v.use) return 0;
		const baseScore = v.use;
		/* ★ 积分自修改：应用 AI 自学习的调整 */
		try {
			if (window.__DJSC.scoreSelfMod && window.__DJSC.scoreSelfMod.getScore) {
				return window.__DJSC.scoreSelfMod.getScore(id, baseScore);
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		return baseScore;
	} catch (e) { return 0; }
}
function marginalValue(id, handIds) {
	try {
		const v = VAL_CARD[id];
		if (!v || !v.use) return 0;
		/* ★ 手牌频次复用手牌快照缓存（countCardName 同源），避免对每张候选牌
		 *   再做一次 O(|hand|) 的 filter 统计。记数表首次调用时构建并缓存。 */
		let _freq = _handFreqCache.get(handIds);
		if (!_freq) {
			_freq = {};
			for (let i = 0; i < handIds.length; i++) { const x = handIds[i]; if (x) _freq[x] = (_freq[x] || 0) + 1; }
			_handFreqCache.set(handIds, _freq);
		}
		const count = _freq[id] || 0;
		const baseScore = v.use * Math.pow(0.6, count);
		/* ★ 积分自修改：应用 AI 自学习的调整 */
		try {
			if (window.__DJSC.scoreSelfMod && window.__DJSC.scoreSelfMod.getScore) {
				return window.__DJSC.scoreSelfMod.getScore(id, baseScore);
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		return Math.round(baseScore * 100) / 100;
	} catch (e) { return 0; }
}
function readCardOverride(id, player, target) {
    try {
        const cardMeta = lib.card && lib.card[id];
        if (!cardMeta || !cardMeta.__djsc_override) return null;
        const ov = cardMeta.__djsc_override;
        if (typeof ov.score !== 'number') return null;
        /* 过期检查 */
        if (ov.ts && (Date.now() - ov.ts) > 1500) return null;
        /* ★ 校验 player 匹配，避免跨 AI 污染 */
        if (ov.player) {
            const myKey = player.name1 || player.name || '?';
            if (ov.player !== myKey) return null;
        }
        return ov;
    } catch (e) { return null; }
}

/* ================= ★ 友方伤害线性衰减 ================= */
function _calcAllyDamagePenalty(player, target, cardId) {
    try {
        if (!player || !target || player === target) return 0;
        let count = 0;
        try {
            const key = target.name1 || target.name || '?';
            count = (player._djsc_hurtAlly && player._djsc_hurtAlly[key]) || 0;
        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        /* 本次是第 (count+1) 次打这个友方
         *   第 1 次：-0.2
         *   第 2 次：-0.4
         *   第 3 次：-0.6
         *   ...
         *   封顶 -10（避免极端场景）
         */
        const penalty = -0.2 * (count + 1);
        return Math.max(-10, penalty);
    } catch (e) { return 0; }
}

/* 统一动作评分：枚举所有候选动作（技能/卡牌/装备/结束）→ 打分 → 选最高 */

export { opportunityCost, countCardName, hasCardName, clearHandCountCache, hasNatureCard, _probShanCached, expectedValue, marginalValue, readCardOverride, _calcAllyDamagePenalty };
export function resetTargetProbabilityCache() { _probShanCache = new WeakMap(); }
