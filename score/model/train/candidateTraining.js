/* 职责：在候选副本上训练并还原在线权重/优化器；不持有候选槽或 A/B 状态。 */
import { log } from '../../foundation/diag/logger.js';
import { scoreToLabel, normalizeLabelIndex } from './labelPolicy.js';
import { NET, _snapshotWeights, _snapshotComplete } from '../weights/modelSnapshot.js';
function _swallow(e) { try { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } catch (_) {} }
async function _trainOnSnapshot(snapshot, te, wm) {
    try {
        if (!wm || typeof wm.trainOne !== 'function' || typeof wm.__applySnapshot !== 'function') return;
        const samples = te.getSamples ? te.getSamples() : (te.drain ? te.drain() : []);
        if (!samples || !samples.length) return;

        const live = _snapshotWeights(wm);
        const liveMom = (wm.__getMoments ? wm.__getMoments() : null);
        if (!_snapshotComplete(live) || !_snapshotComplete(snapshot)) {
            log.warn('hotswap', '快照结构与主网络(130→128→64→6)不符，跳过候选训练以避免权重错位');
            return;
        }

        wm.__applySnapshot(snapshot);          /* 换入候选副本（已通过形状校验） */
        const EPOCHS = 3;
        for (let ep = 0; ep < EPOCHS; ep++) {
            for (const s of samples) {
                const feats = s.f || s.features;
                if (!feats || feats.length !== NET.I) continue;

                /* reward score 与已编码 label 明确分流：
                 * - s.r 是 reward，必须走统一 scoreToLabel；
                 * - s.label 仅在明确为 0..5 / A..F 时作为兼容输入。
                 * 禁止再用同一个函数猜测“这个数字到底是 reward 还是 label”。 */
                const labelIdx = (typeof s.r === 'number')
                    ? scoreToLabel(s.r)
                    : normalizeLabelIndex(s.label);
                if (labelIdx === null) continue;
                try { wm.trainOne(feats, labelIdx); } catch (e) { _swallow(e); }
            }
        }
        const trained = _snapshotWeights(wm);
        wm.__applySnapshot(live);              /* 还原在线权重（候选只在副本上训练） */
        if (liveMom && wm.__setMoments) { try { wm.__setMoments(liveMom); } catch (e) { _swallow(e); } }
        Object.assign(snapshot, trained);       /* 候选=训练后参数 */
        if (!_snapshotComplete(snapshot)) log.warn('hotswap', '候选快照不完整，放弃晋升资格');
    } catch (e) { _swallow(e); }
}


export { _trainOnSnapshot };
