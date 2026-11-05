/* 职责：每次只规划一次，并将规划建议归并到原候选对象。
 * 返回的同一个 decisionPlan 供日志复用，不为显示再次计算。 */
import { mergePlannedCandidate } from '../selection/candidateSelection.js';
import { _status } from '../../foundation/adapt/host.js';
import { refineBestWithPlan, planForDecision } from '../strategy/planner.js';
export function refineCandidatePlan(context) {
let { best, bestT, bestTs, eligibleActs } = context;
const { me, acts } = context;
let decisionPlan = null;
		/* ★ 规划器：每次 bestAction 最多计算一次。
		 * decisionPlan 同时供 winner 改判与后续回放/日志使用，禁止为了 layers.plan 再次规划。 */

		try {
			decisionPlan = planForDecision(me);
			try { _status.djsc_lastDecisionPlan = decisionPlan || null; } catch (ePlanState) {}
			const refined = refineBestWithPlan(me, best, bestT, decisionPlan);
			if (refined && refined !== best) {
				/* Planner 后续仍要经过 Champion / DeepThink / Guard，因此 winner 必须回到
				 * acts 中的 canonical candidate，禁止同一动作以两个不同对象继续参与排序。 */
				const plannedSelection = mergePlannedCandidate(acts, refined);
				best = plannedSelection.best;
				eligibleActs = plannedSelection.eligibleActs;

				try {
					if (best.target && typeof best.target === 'object' &&
						(!bestT || (bestT.name1 || bestT.name) !== (best.target.name1 || best.target.name))) {
						bestT = best.target;
						bestTs = typeof best.score === 'number' ? best.score : bestTs;
					}
				} catch (eSync) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSync); }
			}
		} catch (eP) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eP); }

return { best, bestT, bestTs, eligibleActs, decisionPlan };
}
