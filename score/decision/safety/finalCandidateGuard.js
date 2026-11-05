/* 职责：最终动作安全检查，保留否决权；不提交动作或记录反馈。
 * fallback 的目标以候选自身绑定为准，不用全局目标覆盖。 */
import { game } from '../../foundation/adapt/host.js';
import { makeActionCandidate, ensureCandidatePolicy, PRIORITY_TIER } from '../state/actionCandidate.js';
import { guardCheck, applyGuardPenalty } from './modelGuard.js';
export function guardCandidate({ me, acts, best: initialBest, bestT: initialTarget }) {
let best = initialBest, bestT = initialTarget;
		/* ===== ★ 模型护栏：执行前的最后一道法律检查 ===== */
		try {
			const _killCand = (function () {
				for (const a of acts) {
					const p = ensureCandidatePolicy(a);
					if (p && p.eligible !== false && p.priorityTier === PRIORITY_TIER.FORCED &&
						p.priorityReason && p.priorityReason.indexOf('击杀') >= 0) return a;
				}
				return null;
			})();
			const _guardCtx = { bestT: bestT, allCandidates: acts, killAvailable: _killCand };
			const _guardRes = guardCheck(me, best, _guardCtx);
			if (!_guardRes.ok) {
				/* 触碰红线：用兜底动作替换 */
				if (_guardRes.fallback) {
					best = _guardRes.fallback;
					/* 护栏 fallback 已经是 canonical candidate，禁止再按相同 id 改写目标。
					 * 这里只同步 bestT 供后续日志/特征使用。 */
					try {
						if (best.targetObj) {
							bestT = best.targetObj;
						} else if (best.target && !Array.isArray(best.target)) {
							bestT = (game.players || []).find(function (p) {
								return p && (p.name1 || p.name || '') === best.target;
							}) || bestT;
						}
					} catch (eSyncT) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSyncT); }
				} else {
					best = makeActionCandidate({ type: 'end', id: 'end', score: 0, reason: '护栏拦截降级：' + _guardRes.reason });
				}
				applyGuardPenalty('chooseToUse', _guardRes.rule);
				best.reason = (best.reason || '') + '（🛡️护栏：' + _guardRes.reason + '）';
			}
		} catch (eGuard) {
			try { console.error('[模型护栏] 集成异常：', eGuard); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}

return { best, bestT };
}
