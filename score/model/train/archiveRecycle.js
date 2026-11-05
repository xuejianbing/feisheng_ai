/*
 * ============================================
 * // 作者: 飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 归档离线训练回流 =================
 * 目的：把持久化战报归档（archive）中的胜利局决策日志重新回灌为
 *       训练样本，补足 BUFFER 被"自动导出清空 / cleanLowValue 清洗"后
 *       的样本缺口——让模型"不会失忆"，保留历史胜局的决策经验。
 *
 * 设计：
 *   - 只回灌胜利局（verdict === 'win'），失败/平局样本噪声大（可能
 *     是队友/运气因素），不回流，避免教坏模型。
 *   - 样本取"winner 对应候选"的 _feat（引擎 recordDecision 已保存），
 *     缺失则回退 candidates[0]（引擎中通常即 winner）；仍缺失则跳过，
 *     不污染样本库（杜绝全 0 特征混入）。
 *   - 局级去重：用归档局 ts 做指纹，记录已回流 ts（localStorage），
 *     同局不会重复回流；样本级由 pushSample 特征精确去重兜底。
 *   - 受 cfg('archiveRecycle', true) 开关控制，默认开启。
 */
import { pushSample, bufferSize } from './trainExport.js';
import { getArchive } from '../../perception/archive/archive.js';
import { FEATURE_DIM } from '../features/features.js';   /* ★ 特征维度单一来源（130） */
import { cfg } from '../../foundation/config/util.js';
import { log } from '../../foundation/diag/logger.js';
import { safeGet as _lsGet, safeSet as _lsSet, safeRemove as _lsRemove } from '../../foundation/storage/storage.js';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */

const RECYCLE_KEY = 'djsc_archive_recycled_ts_v1';
const MAX_RECYCLED = 30;   /* 与归档 MAX_GAMES 对齐，最多记住 30 局的指纹 */

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

/* 取一条决策记录里"该学"的样本特征：优先 winner 匹配候选，回退候选首位 */
function pickWinnerFeat(entry) {
	try {
		const cs = entry.candidates || [];
		if (!cs.length) return null;
		const w = entry.winner || cs[0];
		if (!w) return null;
		/* 1. winner 对应候选的 _feat（同 type + id） */
		for (let i = 0; i < cs.length; i++) {
			const c = cs[i];
			if (c && c.type === w.type && c.id === w.id &&
				Array.isArray(c._feat) && c._feat.length === FEATURE_DIM) {
				return c._feat;
			}
		}
		/* 2. 回退：candidates[0]（引擎中通常即 winner） */
		if (Array.isArray(cs[0]._feat) && cs[0]._feat.length === FEATURE_DIM) return cs[0]._feat;
		return null;
	} catch (e) { return null; }
}

/* 主入口：扫描归档，把未回流的胜利局样本 pushSample 回样本库。
 * 返回 { recycled, skipped, scanned } 便于面板展示/自检。 */
export function recycleArchiveSamples(opts) {
	try {
		if (cfg('archiveRecycle', true) === false) return { recycled: 0, skipped: 0, scanned: 0 };
		const games = getArchive();
		if (!games || !games.length) return { recycled: 0, skipped: 0, scanned: 0 };

		const done = loadRecycled();
		const doneSet = {};
		done.forEach(function (t) { doneSet[t] = 1; });

		let recycled = 0, skipped = 0, scanned = 0;
		games.forEach(function (g) {
			try {
				if (!g) return;
				if (doneSet[g.ts]) { skipped++; return; }        /* 已回流过 → 跳过 */
				doneSet[g.ts] = 1;
				scanned++;
				if (g.verdict !== 'win') return;                 /* 只学胜利局 */
				const logs = Array.isArray(g.logs) ? g.logs : [];
				if (!logs.length) return;
				const reward = 1;                                /* 胜利局 → 正样本 */
				logs.forEach(function (e) {
					try {
						const feat = pickWinnerFeat(e);
						if (!feat) return;
						const w = (e.winner || ((e.candidates || [])[0])) || {};
						pushSample(feat, reward, {
							player: e.player || g.myIdentity || '?',
							action: w.type || 'unknown',
							id: w.id || '',
							score: Math.round(w.score || 0),
							conf: 0.3,
							source: 'archive',          /* 标记来源：区别于实时样本 */
							recycledFrom: g.ts,
						});
						recycled++;
					} catch (eSub) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSub); }
				});
			} catch (eG) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eG); }
		});

		/* 落盘已处理指纹（含胜利/失败/平局全部，避免反复扫） */
		const doneList = [];
		for (const t in doneSet) if (doneSet[t]) doneList.push(Number(t));
		saveRecycled(doneList);

		if (recycled > 0) {
			try { log.info('train', '归档回流 ' + recycled + ' 条胜利局样本（累计 ' + bufferSize() + ' 条）'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}
		return { recycled: recycled, skipped: skipped, scanned: scanned };
	} catch (e) { return { recycled: 0, skipped: 0, scanned: 0 }; }
}

/* 查询已回流局数（面板/自检用） */
export function recycledCount() {
	try { return loadRecycled().length; } catch (e) { return 0; }
}

/* 清空回流指纹（调试/重来用） */
export function resetRecycled() {
	try { _lsRemove(RECYCLE_KEY); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}