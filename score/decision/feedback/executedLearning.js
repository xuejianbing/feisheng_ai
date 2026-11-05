/* 职责：真实执行确认后的样本记录与收益回填连接。
 * 只能由事务 Commit 延迟回调调用；只记录 winner，沿用 decisionId 精确关联。 */
import { trainRecordSample, trainFeedbackSample } from '../../model/train/trainExport.js';
import { isEnemy } from '../strategy/modeStrategy.js';
import { feedbackSettle as champSettle } from '../strategy/championStrategy.js';
import { focusTarget } from '../../perception/team/team.js';
import { extractFeatures, FEATURE_DIM } from '../../model/features/features.js';
import { bufferSize } from '../../model/train/trainExport.js';
import { postCheckDelayed } from '../analysis/postCheck.js';
export function recordExecutedLearning({ me, best, bestT, bestTs, acts, sit, focus, _isEnemyMemo }, _actual, _txInfo) {

/* ★ 训练数据：记录本次决策样本（带采样权重） */
		try {
			/* ★ 修复：确保 best._feat 有值 */
			let featToUse = best._feat;
			if (!featToUse || !featToUse.length) {
				/* 如果 best._feat 为空，从 acts 里找同 id 的对象 */
				for (let i = 0; i < acts.length; i++) {
					if (acts[i].id === best.id && acts[i].type === best.type && acts[i]._feat) {
						featToUse = acts[i]._feat;
						break;
					}
				}
			}
			/* 如果还是没有，直接调 extractFeatures 补 */
			if (!featToUse || !featToUse.length) {
				try {
					const _fb = new Int8Array(FEATURE_DIM);
					const _fx = extractFeatures(me, best, {
						bestT: bestT,
						bestTs: bestTs,
						isEnemy: bestT ? _isEnemyMemo(bestT) : false,
						focusTarget: focus ? focus.target : null,
					}, _fb);
					featToUse = Array.from(_fx);
				} catch (eFeat) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eFeat); }
			}

			/* ★ 训练样本人样：按置信度重采样次数记录 */
			try {
				const w = window.__DJSC.metaCognition && window.__DJSC.metaCognition.sampleWeight
					? window.__DJSC.metaCognition.sampleWeight({ type: best.type, id: best.id, target: best.target })
					: 1.0;
				const times = Math.max(1, Math.round(w));
				for (let t = 0; t < times; t++) {
					trainRecordSample(me, best, sit, best.score, featToUse, { decisionId: _txInfo && _txInfo.id });
				}

				/* 候选动作的负分仅是决策估值，不是已执行结果；禁止作为真实样本入库。 */
				/* ★ 样本满3万后自动清洗：只保留高价值（置信度低）的 */
				if (typeof bufferSize === 'function' && bufferSize() >= 30000) {
					try {
						if (window.__DJSC.trainExport && window.__DJSC.trainExport.cleanLowValue) {
							window.__DJSC.trainExport.cleanLowValue();
						}
					} catch (eClean) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eClean); }
				}
			} catch (eRec) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eRec); }

			/* 决策后检测只追踪最终选中的动作；候选动作未执行，不能把共享局面变化回填给它们。 */
			try {
				const snapshotKey = _txInfo && _txInfo.meta && _txInfo.meta.postCheckKey;
				if (!snapshotKey) return;
				/* 消费宿主事件启动前的快照；完成事件只负责触发结算。 */
				postCheckDelayed(snapshotKey, me, bestT, function (result) {
					try {
						if (!result || result.sign === 0) return;
						if (typeof trainFeedbackSample !== 'function' || trainFeedbackSample(result) < 1) return;
						const rHero = result.player || ((me && (me.name1 || me.name)) || '');
						if (typeof champSettle === 'function') {
							champSettle(result.type, result.id, rHero, result);
						}
						/* ★ 重构：把异步判定的"正负分"(实测评判)回写进训练样本 value_target。
						 * 即时决策分(静态评分)仍同步驱动本次选牌，此处只取代正负反馈标签。 */
					} catch (eFb) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eFb); }
				});
			} catch (eSettle) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSettle); }
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		

}
