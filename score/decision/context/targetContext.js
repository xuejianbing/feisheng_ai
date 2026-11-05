/* 职责：每次决策构建一次目标分表与全局关注目标。
 * 保留原有集火、风格和收割修正顺序；具体动作仍绑定自己的执行目标。 */
import { game, get } from '../../foundation/adapt/host.js';
import { targetScore } from '../threat/threat.js';
import { styleOf } from '../../perception/observer/observer.js';
import { focusBonus } from '../../perception/team/teamBroadcast.js';
import { pickKillTarget } from '../rules/basicRules.js';
export function buildTargetContext(me, focus, _isEnemyMemo) {
		/* ===== 目标分缓存：每玩家只算一次，供所有卡牌共用 =====
		 * - tsMap：pp 对象 → targetScore 数值
		 * - bestT / bestTs：当前局势下全局最优目标及其分数（与具体卡牌无关）
		 */
		const tsMap = new Map();
		let bestT = null, bestTs = -1;
		let bestT2 = null, bestTs2 = -1;  /* ★ 第二优目标，给多目标卡牌用 */
		try {
			for (const pp of (game.players || [])) {
				if (pp === me) continue;
				try { if (pp.isDead ? pp.isDead() : (pp.hp !== undefined && pp.hp <= 0)) continue; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				/* ★ 友方减免：友方目标分数大幅降低，防止 AI 乱打队友 */
				const isAlly = !_isEnemyMemo(pp);
				let ts = targetScore(me, pp);
				if (isAlly) ts *= 0.1; // 友方分数打1折
				/* C 阶段 clamp：目标分规范值域 [0, 15]。
				 * 防止某些极端场景（多个加成叠加）让单个目标分飙到 30+，
				 * 导致决策被单一目标碾压。 */
				if (ts < 0) ts = 0;
				if (ts > 15) ts = 15;
				tsMap.set(pp, ts);
				if (ts > bestTs) {
					bestTs2 = bestTs;  /* 原来的第一变成第二 */
					bestT2 = bestT;
					bestTs = ts;
					bestT = pp;
				} else if (ts > bestTs2) {
					bestTs2 = ts;
					bestT2 = pp;
				}
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		/* ★ 广播集火：读同阵营广播，给已集火目标加成 */
		try {
			const broadcastBonus = {};
			for (const pp of (game.players || [])) {
				if (pp === me) continue;
				const pk = pp.name1 || pp.name;
				if (!pk) continue;
				broadcastBonus[pk] = focusBonus(me, pk);
			}
			for (const [pp, ts] of tsMap) {
				const pk = pp.name1 || pp.name;
				const bb = broadcastBonus[pk] || 1.0;
				const newTs = ts * bb;
				tsMap.set(pp, newTs);
				if (newTs > bestTs) {
					bestTs = newTs;
					bestT = pp;
				}
			}
		} catch (eB) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eB); }
		/* 集火优先：若队友共同攻击压力最大的敌人与当前最优目标不同，
		 * 且其目标分不低于最优的 70%，则切换为集火目标。 */
		if (focus && focus.target && bestT !== focus.target) {
			const focusTs = tsMap.get(focus.target) || 0;
			if (focusTs >= bestTs * 0.7) {
				bestT = focus.target;
				bestTs = focusTs;
			}
		}
		/* 风格偏好：优先打「激进/均衡」敌人，避开「保守」 */
		try {
			let styleAdjBest = bestT, styleAdjScore = -1;
			for (const [pp, ts] of tsMap) {
				if (pp === me) continue;
				const s = styleOf(pp);
				let mul = 1.0;
				if (s.tag === "aggressive") mul = 1.3;      /* ★ 提高权重：1.15 → 1.3 */
				else if (s.tag === "cautious") mul = 0.75;  /* ★ 提高权重：0.85 → 0.75 */
				else if (s.tag === "vengeful") mul = 0.9;   /* ★ 复仇心重：降低攻击欲望 */
				const adj = ts * mul;
				if (adj > styleAdjScore) { styleAdjScore = adj; styleAdjBest = pp; }
			}
			if (styleAdjBest && styleAdjBest !== bestT) {
				const origTs = tsMap.get(bestT) || 0;
				if (styleAdjScore >= origTs * 0.9) {     /* ★ 降低切换门槛：0.95 → 0.9 */
					bestT = styleAdjBest;
					bestTs = Math.round(styleAdjScore * 100) / 100;
				}
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		/* ★ 动态目标精修（targetBrain，不降权）：
		 *   既有 bestT 是“威胁×风格”的全局最优，这里仅在【存在更优的可收割/高击杀确定率之敌】时切换目标。
		 *   纯动态叠加——不改任何既有权重/乘数；切换后攻击类牌以 bestT 为目标打分（EV/目标加成）更积极，
		 *   并传导给 planner（djsc_lastBestT）与叙述。 */
		try {
			const killT = pickKillTarget(me, tsMap, bestT);
			if (killT && killT !== bestT) {
				bestT = killT;
			}
		} catch (eK) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eK); }

return { tsMap, bestT, bestTs, bestT2, bestTs2 };
}
