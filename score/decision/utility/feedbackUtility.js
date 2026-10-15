import { applyOwnedUtility } from './utilityPipeline.js?v=41a';

/* 历史 target/tempo/play 胜负比率缺少已执行动作归因，仅作为诊断证据。
 * 当前回合动量独立计分；倍率>1提高负分候选，<1降低。 */
export function applyFeedbackUtility(candidate, { target, tempo, play, momentum = 1 } = {}) {
	if (!candidate || candidate.type !== 'card') return null;
	if (candidate.utilityVector?.ownedSources?.includes('decisionFeedback')) return { applied: false };
	const entries = [['target', target], ['tempo', tempo], ['play', play]];
	const active = entries.filter(([, s]) => s?.available && Number.isFinite(s.ratio));
	// Legacy target/tempo/play ratios have no committed-action attribution. Evidence only.
	const ratios = [];
	if (Number.isFinite(momentum) && momentum !== 1) ratios.push(Math.max(0.7, Math.min(1.3, momentum)));
	const ratio = ratios.length ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : 1;
	const delta = Math.abs(candidate.score) * (ratio - 1);
	const details = { ratio, estimatorCount: ratios.length, momentum: Number.isFinite(momentum) ? momentum : 1, aggregation: 'momentum-only', legacyScoring: false, legacyEstimatorCount: active.length,
		targetAvailable: active.some(([key]) => key === 'target'), tempoAvailable: active.some(([key]) => key === 'tempo'), playAvailable: active.some(([key]) => key === 'play'),
		targetRatio: Number.isFinite(target?.ratio) ? target.ratio : 1, tempoRatio: Number.isFinite(tempo?.ratio) ? tempo.ratio : 1, playRatio: Number.isFinite(play?.ratio) ? play.ratio : 1 };
	return { applied: applyOwnedUtility(candidate, 'decisionFeedback', [{ dimension: 'future', delta, note: '历史胜负反馈仅留证据；当前回合动量独立计分', details }]), ratio, delta };
}
