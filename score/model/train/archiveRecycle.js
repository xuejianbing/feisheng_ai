/*
 * ============================================
 * // 作者: 飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 归档离线训练回流 =================
 * 只接收执行事务及实际事件窗口收益；胜局/败局一视同仁。
 * 旧档案无观测证据时保留档案，不伪造训练标签。
 */
import { pushSample, bufferSize, getSamples } from './trainExport.js?v=41a';
import { getArchive } from '../../perception/archive/archive.js?v=41a';
import { FEATURE_DIM } from '../features/features.js?v=41a';   /* ★ 特征维度单一来源（130） */
import { cfg } from '../../foundation/config/util.js?v=41a';
import { log } from '../../foundation/diag/logger.js?v=41a';
import { safeGet as _lsGet, safeSet as _lsSet, safeRemove as _lsRemove } from '../../foundation/storage/storage.js?v=41a';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */

const RECYCLE_KEY = 'djsc_archive_recycled_ts_v1';
const MAX_RECYCLED = 10;   /* 与归档 MAX_GAMES 对齐，最多记住 30 局的指纹 */

function loadRecycled() {
	try {
		const raw = _lsGet(RECYCLE_KEY);
		const arr = raw ? JSON.parse(raw) : [];
		return Array.isArray(arr) ? arr : [];
	} catch (e) { return []; }
}

function saveRecycled(list) {
	try { _lsSet(RECYCLE_KEY, JSON.stringify(list.slice(-MAX_RECYCLED))); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 只回流已提交且有事务级观测的记录；胜负不决定动作好坏。 */
export function recycleArchiveSamples() {
    if (cfg('archiveRecycle', true) === false) return { recycled: 0, skipped: 0, scanned: 0 };
    let recycled = 0, skipped = 0, scanned = 0;
    const done = new Set(loadRecycled());
    const known = new Set((getSamples() || []).map(s => s.m?.transactionId).filter(Boolean));
    for (const g of getArchive() || []) {
        if (!g || done.has(g.ts)) { skipped++; continue; }
        scanned++;
        let complete = true;
        for (const e of Array.isArray(g.logs) ? g.logs : []) {
            const outcome = e?.actionOutcome, w = e?.winner;
            if (e?.executionState !== 'committed' || !e.transactionId || !e.actorId || !w ||
                outcome?.transactionId !== e.transactionId || outcome.actorId !== e.actorId ||
                outcome.status !== 'observed' || !Number.isFinite(outcome.reward) || outcome.id !== w.id) { skipped++; continue; }
            if (known.has(e.transactionId)) continue;
            const candidate = Array.isArray(w._feat) ? w : (e.candidates || []).find(c =>
                c.type === w.type && c.id === w.id && JSON.stringify(c.target) === JSON.stringify(w.target));
            const feat = candidate?._feat;
            if (!Array.isArray(feat) || feat.length !== FEATURE_DIM || !feat.every(Number.isFinite)) { skipped++; continue; }
            const r = Math.max(-147, Math.min(147, Math.round(outcome.reward * 12)));
            const accepted = pushSample(feat, r, {
                player: e.player || '?', actorId: e.actorId, action: w.type, id: w.id, score: w.score,
                source: 'archive', sessionId: 'archive_' + g.ts, transactionId: e.transactionId,
                target: outcome.target || null, executionState: 'committed', rewardSchema: 'action-outcome-v1',
                rewardStatus: 'observed', observedReward: outcome.reward, recycledFrom: g.ts,
                creditAllocation: outcome.creditAllocation || null,
                actionOutcome: { attribution: outcome.attribution, normalization: 12, deltas: outcome.deltas || [] },
                gameOutcome: g.verdict || 'unknown',
                modeContext: e.modeContext || null,
                observedValueTarget: Math.max(-1, Math.min(1, outcome.reward / 12)), conf: .3,
            });
            if (!accepted) { complete = false; break; }
            known.add(e.transactionId); recycled++;
        }
        if (complete) done.add(g.ts);
    }
    saveRecycled([...done]);
    if (recycled) log.info('train', '归档回流 ' + recycled + ' 条已执行观测样本（累计 ' + bufferSize() + ' 条）');
    return { recycled, skipped, scanned };
}

/* 查询已回流局数（面板/自检用） */
export function recycledCount() {
	try { return loadRecycled().length; } catch (e) { return 0; }
}

/* 清空回流指纹（调试/重来用） */
export function resetRecycled() {
	try { _lsRemove(RECYCLE_KEY); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
