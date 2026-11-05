/* 职责：按既有顺序编排局末记账、记忆、归档、模型与反馈。
 * 一局只结算一次的锁仍由引擎持有；本模块不启动监视器，不复制台账。 */
import { safeGet as _lsGet, safeSet as _lsSet } from '../../foundation/storage/storage.js';
import { game, ui, get, _status } from '../../foundation/adapt/host.js';
import { memSave } from '../../perception/memory/mem.js';
import { getObs } from '../../perception/observer/observer.js';
import { identityOf as _identityOf, identityOfFor as _identityOfFor, beliefOf, beliefOfFor as _beliefOfFor } from '../../perception/observer/identity.js';
import { cfg, keyOf } from '../../foundation/config/util.js';
import { log } from '../../foundation/diag/logger.js';
import { recordTargetOutcome, recordTempoOutcome, recordPlayOutcome, flushDecisionFeedback } from '../feedback/decisionFeedback.js';
import { styleOf } from '../../perception/observer/observer.js';
import { saveStore, mergeOnSettle, storeStats } from '../../perception/memory/memory.js';
import { archiveGame, verdictOf, getArchive } from '../../perception/archive/archive.js';
import { recordGame as recordGameLog } from '../../perception/journal/gameLogStore.js';
import { trainSettleGame } from '../../model/train/trainExport.js';
import { flushFeedback, feedbackCount } from '../../perception/feedback/feedback.js';
import { flushStyleFeedback, recordPlayerTag, saveStyleFeedback } from '../../perception/feedback/styleFeedback.js';
import { autoRegister as globalAutoRegister } from '../../foundation/runtime/globalScanner.js';
import { getJSON as storageGetJSON, setJSONQuotaSafe as storageSetQuota } from '../../foundation/storage/storage.js';
import { promoteHighRegretPoints as promoteRegret } from '../../perception/discover/autoDiscover.js';
import { updateAdaptive } from '../tuning/adaptive.js';
import { showReport } from '../../view/report/report.js';
import { onGameEnd as modelStateOnGameEnd, recordABScore } from '../../model/state/modelLifecycle.js';
import { recordGameResult, autoAdjustWeights } from '../../model/train/learningLoop.js';
import { recycleArchiveSamples } from '../../model/train/archiveRecycle.js';
import { normalizedMargin, DECISION_MARGIN } from '../state/decisionMargin.js';
import { pushSample, bufferSize } from '../../model/train/trainExport.js';
import { settleElementFeedback } from '../../perception/feedback/elementFeedback.js';
import { metaSettleGame } from '../../cognition/metaCognition.js';
import { shareContribute } from '../../perception/knowledge/sharedKnowledge.js';
import { detectChains, finalizeLearned } from '../strategy/comboChain.js';
import { postCheckReset } from '../analysis/postCheck.js';
import { settleDecisionContext } from '../../model/features/autoFeature.js';
import { learnFromGame } from '../../cognition/reasoning/softMetrics.js';
import { round, scoreLog, _poolPromise, SYSTEM_POOL_RATE, _winningSet, conservationLedger, give, displayName, _isAlive, getLedgerRecord as getREC } from '../scoring/scoreLedger.js';
import { _getRoundNumber, _autofeatCtx, getDecisionLog } from '../records/decisionRecords.js';
import { _playerLogs, clearPlayerActionLog } from '../../perception/journal/playerActionLog.js';
export function settleGame() {
	try {
		/* 终局存活奖励：活下来的阵营每人 +3 */
		try {
			(game.players || []).forEach(function (p) {
				if (p && p.alive !== false && (p.hp || 0) > 0) {
					give(p, 3, "存活至终局");
				}
			});
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		/* ★ 守恒引擎 · 结算产出分配：
		 *   系统注入奖池（约30%，入场费基数）在此按胜负分配：
		 *   - 胜利方获得系统奖池；
		 *   - 货币产出由「游戏失败后的阵营」产生——失败方的负贡献即产出来源。
		 *   分配一律经 give 记账，故守恒不变量 Σ玩家 + ledger = 0 自然成立。 */
		try {
			if (_poolPromise > 0) {
				const winSet = _winningSet();
				const aliveWin = winSet.filter(function (p) { return _isAlive(p); });
				if (aliveWin.length) {
					const per = Math.round(_poolPromise * 100 / aliveWin.length) / 100;
					aliveWin.forEach(function (p) {
						give(p, per, "系统奖池（失败阵营产出·" + Math.round(SYSTEM_POOL_RATE * 100) + "%）");
					});
				}
			}
		} catch (eP) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eP); }
		const sum = Math.round(Object.keys(round).reduce(function (s, k) { return s + round[k]; }, 0) * 100) / 100;
		/* ★ 守恒审计：Σ玩家 + ledger 应≈0 */
		try {
			const bl = conservationLedger();
			if (typeof log !== 'undefined' && log.info) {
				log.info('conservation', '守恒对账: 玩家Σ=' + bl.playerSum + ' ledger=' + bl.ledger + ' 偏差=' + bl.balance + '（入场费' + bl.seedFee + '·系统' + Math.round(bl.systemRate * 100) + '%奖池=' + bl.poolPromise + '）');
			}
		} catch (eL) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eL); }
		try { memSave(); } catch (eM2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eM2); }
		/* 跨局记忆：把本局实时风格合并到存储 */
		try {
			(game.players || []).forEach(function (p) {
				if (!p || p === game.me) return;
				try {
					const s = styleOf(p);
					/* 只要观察到任何行为就存（source=live 或 unknown 但有数据） */
					if (!s) return;
					if (s.source !== 'live' && !s.attacks && !s.aids) return;
					mergeOnSettle(p, s);
				} catch (eS) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eS); }
			});
			saveStore();
			try {
				const st = storeStats();
				if (typeof log !== 'undefined' && log.info) {
					log.info('memory', '跨局记忆已更新：' + st.entries + ' 位玩家，' + st.samples + ' 条样本');
				}
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		} catch (eM) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eM); }
		/* ★ 元素反馈合并 */
		try { settleElementFeedback(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		/* ★ 元认知结算 */
		try { metaSettleGame(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		/* ★ 训练样本结算：给本局样本打输赢标签（胜负判定优先 game.winner，回退血量） */
		let _won = false;
		try {
			if (game.winner) _won = (game.winner === (game.me && game.me.identity) || game.winner === 'me');
			else _won = (game.me && game.me.hp || 0) > 0;
		} catch (eW) { _won = (game.me && game.me.hp || 0) > 0; }
		try { trainSettleGame(game.me, _won); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		/* ★ 学习闭环：记录本局胜负 → 胜率统计 → 触发自动调权（此前 recordGameResult 只 import 从未调用，
		 * 胜率恒为 0、autoAdjustWeights 永不生效——闭合闭环后面板/自检才能看到真实胜率） */
		try { recordGameResult(_won); } catch (eL) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eL); }
		/* ★ 连招学习闭环：本局被评估为高分(带动评分)命中过的连招，对局结束按胜负固化入库
		 * （新 id 新增 learned 条目、已有 id 更新权重/胜率；session 评估阶段已累计）。 */
		try {
			const _pNow = game.me || _status.currentPhase;
			if (_pNow) {
				try { detectChains(_pNow, null); } catch (eCP) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCP); }   /* 触达一次，确保前置初始化 */
				const _chRes = finalizeLearned(_won);
				if (_chRes && _chRes.total) log.info('learn', '本局高分连招固化入库 ' + _chRes.done + ' 条（新增 ' + _chRes.fresh + '，胜负=' + _won + '）');
			}
		} catch (eCL) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCL); }
		try {
			if (typeof autoAdjustWeights === 'function') {
				const adj = autoAdjustWeights();
				if (adj && adj.adjusted) log.info('learn', '自动调权建议：' + adj.reason);
			}
		} catch (eA) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eA); }
		/* ★ 公共知识库贡献：把本局每个决策的（局面指纹→选择→输赢）写入群体样本。
		 * 此前 shareContribute 只挂载从未调用，贡献数恒 0。用真实胜负 _won 打标。 */
		try {
			const _dLogC = getDecisionLog();
			for (const _eC of (_dLogC || [])) {
				if (!_eC || !_eC.candidates) continue;
				const _wC = _eC.winner || _eC.candidates[0];
				if (!_wC) continue;
				try {
					shareContribute(game.me, { type: _wC.type, id: _wC.id, target: _wC.target }, { win: _won });
				} catch (eSc) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSc); }
			}
		} catch (eSC) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSC); }
		/* ★ 记录校准快照（每局一次） */
		try {
			if (window.__DJSC.calibHistory && window.__DJSC.calibHistory.record) {
				window.__DJSC.calibHistory.record();
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		/* ★ 多档案：记录本局结果（胜负用真实 _won，此前用回合分误判） */
		try {
			if (window.__DJSC.multiProfile) {
				const cur2 = window.__DJSC.multiProfile.getCurrent();
				const curKey2 = cur2 ? cur2.key : 'balanced';
				window.__DJSC.multiProfile.recordResult(curKey2, _won);
				if (Math.random() < 0.2) {
					window.__DJSC.multiProfile.imitateBest(curKey2);
				}
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		/* ★ 决策回放归档 */
		try {
			if (window.__DJSC && window.__DJSC.replay && window.__DJSC.replay.settle) {
				const me3 = game.me;
				const myKey3 = me3 ? (me3.name1 || me3.name || '?') : '?';
				const myScore3 = (round && round[myKey3]) || 0;
				window.__DJSC.replay.settle({
					verdict: _won ? 'win' : 'lose',
					myScore: myScore3,
				});
			}
		} catch (eR) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eR); }
		/* ★ 自动特征发现：本局胜利回填收益（让重要特征权重能被学习出来，面板才有非零维度）。 */
		try {
			const _meAF = game.me;
			if (_meAF && _won && _autofeatCtx) {
				const _ctxAF = _autofeatCtx(_meAF, { type: 'end', id: 'settle' }, null);
				if (_ctxAF && typeof settleDecisionContext === 'function') {
					settleDecisionContext(_ctxAF, 1, true);
				}
			}
		} catch (eAFS) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eAFS); }
		/* ★ 软指标学习：把本局结果喂给 softMetrics（此前只有挂载无调用，总学习次数恒 0）。 */
		try {
			if (typeof learnFromGame === 'function') {
				const _meSM = game.me;
				learnFromGame({
					win: _won,
					allyAttackCount: (_status && _status.djsc_allyAttackCount) || 0,
					endgame: ((game.players || []).filter(function (p) { return p && p.alive !== false; }).length <= 3),
				});
			}
		} catch (eSM) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSM); }
		/* ★ 权重固化：把校准偏移刻进模型 */
		try {
			if (window.__DJSC && window.__DJSC.weightPersist && window.__DJSC.weightPersist.onSettle) {
				window.__DJSC.weightPersist.onSettle();
			}
		} catch (eWP) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eWP); }
		/* ★ 跨模式自动迁移 */
		try {
			if (window.__DJSC && window.__DJSC.crossMode && window.__DJSC.crossMode.autoPromote) {
				window.__DJSC.crossMode.autoPromote(3);
			}
		} catch (eCM) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCM); }
		/* ★ 模型热更新：回填 A/B 分数 + 定期触发训练 */
		try {
			if (window.__DJSC && window.__DJSC.hotSwap) {
				const meHS = game.me;
				const myKeyHS = meHS ? (meHS.name1 || meHS.name || '?') : '?';
				const myScoreHS = (round && round[myKeyHS]) || 0;
				window.__DJSC.hotSwap.recordScore(myScoreHS);
				const st = window.__DJSC.hotSwap.stats();
				if (!st.hasCandidate && st.samples >= st.MIN_SAMPLES) {
					window.__DJSC.hotSwap.trigger();
				}
			}
		} catch (eHS) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eHS); }
		/* ★ 策略进化：回填本局结果（胜负用真实 _won 判定，此前用回合分>0 误判，适应度恒 0%） */
		try {
			if (window.__DJSC && window.__DJSC.evolution) {
				const bestEV = window.__DJSC.evolution.current ? window.__DJSC.evolution.current() : null;
				if (bestEV) {
					window.__DJSC.evolution.record(bestEV.id, _won);
				}
			}
		} catch (eEV) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eEV); }
		/* ★ 积分自修改：根据本局结果调整积分（胜负用真实 _won） */
		try {
			if (window.__DJSC && window.__DJSC.scoreSelfMod) {
				const meSM = game.me;
				const myKeySM = meSM ? (meSM.name1 || meSM.name || '?') : '?';
				const myScoreSM = (round && round[myKeySM]) || 0;
				const winSM = _won;
				/* 遍历本局使用过的牌，调整积分 */
				const usedCards = (scoreLog || []).filter(function (s) {
					return s && s.tag && s.tag.indexOf('使用') >= 0;
				});
				usedCards.forEach(function (s) {
					const cardId = (s.tag.match(/使用.*?（([^）]+)）/) || [])[1];
					if (cardId) {
						window.__DJSC.scoreSelfMod.observe(cardId, {
							win: winSM,
							hpDelta: myScoreSM,
							handDelta: 0,
						});
					}
				});
			}
		} catch (eSM) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSM); }
		/* ===== 归档本局 ===== */
		try {
			const me = game.me;
			const myKey = me ? (me.name || me.name1 || "?") : "?";
			const myScore = round[myKey] || 0;
			/* ★ P0-1 修复：回填 reward */
			/* ★ P0-1 修复：回填 reward（仅 winner，不污染未选中候选） */
			try {
				const dLog = getDecisionLog();
				let pushed = 0;
				for (const entry of dLog) {
					if (!entry || !entry.candidates) continue;
					const winner = entry.winner || entry.candidates[0];
					if (!winner || !winner._feat) continue;

					/* ★ 先正常记录所有样本，攒到1万条后再自动清洗 */
					pushSample(winner._feat, myScore, {
						round: entry.round || 0,
						player: entry.player || ((me && (me.name || me.name1)) || ''),  /* ★ 英雄id，嵌入主键之一 */
						type: winner.type || '',
						id: winner.id || '',
						score: Math.round(winner.score || 0),
						conf: (winner._conf && !isNaN(winner._conf)) ? winner._conf : 0.3,  /* ★ 存置信度 */
					});
					pushed++;
				}

				/* ★ 样本满3万后自动清洗：只保留高价值（置信度低）的 */
				if (bufferSize() >= 30000) {
					try {
						if (window.__DJSC.trainExport && window.__DJSC.trainExport.cleanLowValue) {
							window.__DJSC.trainExport.cleanLowValue();
						}
					} catch (eClean) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eClean); }
				}
				if (pushed > 0) {
					try { log.info('train', '本局回填 ' + pushed + ' 条样本（仅 winner），累计 ' + bufferSize()); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				}
			} catch (eTrain) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTrain); }
			const q = { crush: 0, normal: 0, close: 0 };
			let dLog = [];
			try {
				dLog = getDecisionLog();
				dLog.forEach(function (e) {
					const c = e.candidates || [];
					if (c.length < 2) { q.normal++; return; }
					const margin = normalizedMargin(c[0].score || 0, c[1].score || 0);
					if (margin >= DECISION_MARGIN.CLEAR) q.crush++;
					else if (margin <= DECISION_MARGIN.CLOSE) q.close++;
					else q.normal++;
				});
			} catch (eQ) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eQ); }
			/* 压缩决策为可持久化结构（每条 ~200 字节，最多 10 条） */
			const compressed = dLog.slice(-10).map(function (e) {
				const L = e.layers || {};
				return {
					round: e.round || 0,
					player: e.player || "?",
					winner: e.winner ? { type: e.winner.type, id: e.winner.id, score: e.winner.score } : null,
					top3: (e.candidates || []).slice(0, 3).map(function (c) {
						return { type: c.type, id: c.id, score: c.score, target: c.target || null };
					}),
					signals: {
						tempo: L.tempo ? L.tempo.stage : null,
						risk: L.risk ? L.risk.label : null,
						teamFocus: (L.team && L.team.focus) || null,
						styleTag: (L.style && L.style.tag) || null,
					},
				};
			});
			const cardCounts = {};
			try {
				const RECx = getREC();
				const ck = RECx.cards || {};
				Object.keys(ck).forEach(function (k) { cardCounts[k] = ck[k]; });
			} catch (eC) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eC); }
			const topCards = Object.keys(cardCounts).sort(function (a, b) { return cardCounts[b] - cardCounts[a]; }).slice(0, 3);
			let mode = "unknown";
			try { mode = (get && get.mode) ? get.mode() : ((_status && _status.mode) || "unknown"); } catch (eM2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eM2); }
			archiveGame({
				ts: Date.now(),
				mode: mode,
				myIdentity: me ? (me.identity || null) : null,
				myScore: Math.round(myScore * 100) / 100,
				playerCount: (game.players || []).length,
				roundCount: _getRoundNumber(),
				decisionSteps: dLog.length,
				quality: q,
				topCards: topCards,
				verdict: verdictOf(myScore),
				decisions: compressed,
				/* ★ 完整日志 */
				logs: dLog,           // AI决策日志（完整）
				playerLogs: _playerLogs,  // ★ 玩家操作日志（实际收集）
			});
			/* ★ 自存完整对局日志：内核录像只留 20 条，这里自己留（局数由 logRetain 配置决定） */
			try {
				recordGameLog({
					ts: Date.now(),
					mode: mode,
					myIdentity: me ? (me.identity || null) : null,
					myScore: Math.round(myScore * 100) / 100,
					verdict: verdictOf(myScore),
					decisions: compressed,
					logs: dLog,
					playerLogs: _playerLogs,
					topCards: topCards,
				});
			} catch (eLogStore) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eLogStore); }
			/* ★ 清空玩家日志，准备下一局 */
			clearPlayerActionLog();
			try { log.info('archive', '本局已保存（共 ' + getArchive().length + ' 局，含 ' + compressed.length + ' 条决策）'); } catch (eL) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eL); }
		} catch (eArch) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eArch); }
		/* ★ 归档离线训练回流：归档落库后扫描胜利局样本回灌训练库（在归档之后调用，
		 *  使本局胜利也能立即回流；不覆盖已有样本，受 cfg('archiveRecycle') 控制） */
		try { recycleArchiveSamples(); } catch (eRecycle) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eRecycle); }
		/* ===== 技能反馈闭环：把本局结果合并到 storage ===== */
		try {
			if (cfg("skillFeedback", true) !== false) {
				flushFeedback(round);
				const fc = feedbackCount();
				try { log.info('feedback', '技能反馈已更新修正系数（累计 ' + fc + ' 个技能）'); } catch (eL) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eL); }
			}
		} catch (eFb2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eFb2); }
		/* ===== 风格反馈闭环 ===== */
		try {
			if (cfg("styleFeedback", true) !== false) {
				flushStyleFeedback();
				for (const p of (game.players || [])) {
					if (!p || p === game.me) continue;
					const s = styleOf(p);
					if (s && s.tag && s.tag !== "unknown") {
						const pk = p.nickname || p.uid || p.name;
						if (pk) recordPlayerTag(pk, s.tag, 1);
					}
				}
				saveStyleFeedback();
				try { log.info('style', '风格反馈已更新标签可信度'); } catch (eL2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eL2); }
			}
		} catch (eSf2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSf2); }
		/* ★ 决策维度反馈回写（target / tempo / play） */
		try {
			if (cfg("decisionFeedback", true) !== false) {
				const me = game.me;
				const myKey = me ? (me.name || me.name1 || "?") : "?";
				const myScore = (round && round[myKey]) || 0;
				const win = myScore > 0;
				(game.players || []).forEach(function (p) {
					if (!p || p === me) return;
					const pk = p.name1 || p.name;
					if (pk) recordTargetOutcome(pk, win);
				});
				try {
					const stage = (function () {
						const r = _getRoundNumber();
						const alive = (game.players || []).filter(function (x) { return x && !x.isDead && !(x.hp <= 0); }).length;
						if (r <= 3) return 'early';
						if (alive <= 4) return 'endgame';
						if (r >= 8) return 'late';
						return 'mid';
					})();
					recordTempoOutcome(stage, win);
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				try {
					const RECx = getREC();
					const ck = (RECx && RECx.cards) || {};
					/* REC.cards 记录的是本局实际使用过的牌，不再伪装成“保留行为”。 */
					Object.keys(ck).forEach(function (k) { recordPlayOutcome(k, win); });
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				flushDecisionFeedback();
				log.info('feedback', '决策维度反馈已更新');
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		/* ★ 自适应难度 */
		try { updateAdaptive(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		/* 延迟弹出战报（避免与本体结算界面冲突） */
		try {
			setTimeout(function () {
				try {
					showReport();
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			}, 3200);
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		if (cfg("persist", true)) {
			try {
				const key = "决策积分引擎_history";
				/* ★ 中央存储抽象：统一读，损坏自动回退空数组 */
				let arr = storageGetJSON(key, []);
				if (!Array.isArray(arr)) arr = [];
				const entry = { t: Date.now(), round: round, sum: sum, log: scoreLog.slice(-60) };
				/* 附上行为观察快照 */
				try {
					const obsSnapshot = getObs();
					const compact = {};
					for (const k in obsSnapshot) {
						const e = obsSnapshot[k];
						if (e.hostile > 0 || e.friendly > 0) {
							compact[k] = { attacks: e.attacks, aids: e.aids, hostile: Math.round(e.hostile * 100) / 100, friendly: Math.round(e.friendly * 100) / 100 };
						}
					}
					entry.obs = compact;
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				/* 附上身份推理快照 */
				try {
					const beliefs = {};
					const observer = game.me || ((_status && _status.currentPhase) || null);
					(game.players || []).forEach(function (p) {
						if (!p) return;
						const publicIdentity = p === game.zhu
							? 'zhu'
							: ((p.identityShown || p.identity === 'mingzhong') ? (p.identity || '?') : '?');
						beliefs[p.name || "?"] = {
							public: publicIdentity,
							inferred: observer ? _identityOfFor(observer, p) : _identityOf(p),
							belief: observer ? _beliefOfFor(observer, p) : beliefOf(p),
						};
					});
					entry.identities = beliefs;
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				arr.push(entry);
				while (arr.length > 100) arr.shift();
				/* ★ 中央存储抽象：带配额降级写入 */
				storageSetQuota(key, arr, function (v) { return (v && Array.isArray(v)) ? v.slice(-50) : v; });
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}
		/* 终局汇总：用带阵营标注的显示名，只打一条日志 */
		try {
			const name2p = {};
			(game.players || []).forEach(function (p) { try { if (p) name2p[keyOf(p)] = p; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
			const parts = Object.keys(round).map(function (k) {
				const p = name2p[k];
				return (p ? displayName(p) : k) + (round[k] > 0 ? "+" : "") + round[k];
			});
			log.info('settle', '总分=' + sum + '（守恒） ' + parts.join("；"));
		} catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
		/* ★ Bandit：本局结果回填给决策点 */
		try {
			const myKey = game.me ? (game.me.name || game.me.name1 || '?') : '?';
			recordGameEnd(round[myKey] || 0);
		} catch (eBandit) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eBandit); }
		/* ★ 模型状态机推进 */
		try {
			modelStateOnGameEnd();
		} catch (eModel) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eModel); }
		/* ★ A/B 测试：记录本局我方归一化分 */
		try {
			const myKey = game.me ? (game.me.name || game.me.name1 || '?') : '?';
			recordABScore(round[myKey] || 0);
		} catch (eAB) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eAB); }
		/* ★ 自动发现：检查后悔值，注册新决策点 */
		try {
			promoteRegret();
		} catch (eDiscover) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eDiscover); }
		/* ★ 全局扫描：每局结束时检查新决策点 */
		try {
			globalAutoRegister();
		} catch (eScan) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eScan); }
		/* ★ 局结束清理：清空决策后检测池/队列计数，避免跨局残留 */
		try {
			postCheckReset();
		} catch (ePcR) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(ePcR); }
		/* ★ 玩家评分反馈：每4-5局弹出一次，让玩家给AI表现打分 */
		try {
			const feedbackKey = "无名AI_playerFeedback";
			const feedbackData = JSON.parse(_lsGet(feedbackKey) || '{"games":0,"scores":[],"skipped":0}');
			feedbackData.games = (feedbackData.games || 0) + 1;
			/* ★ 安全保存：本地存储满时静默降级（P2-31：safeSet 以 false 表达失败，按返回值降级） */
			const _fbTrySave = (function () {
				let saving = false;
				return function () {
					if (saving) return;
					saving = true;
					try {
						if (!_lsSet(feedbackKey, JSON.stringify(feedbackData))) {
							/* 降级：只保留最近5条评分并重置跳过计数，再试一次 */
							if (feedbackData.scores && feedbackData.scores.length > 0) {
								feedbackData.scores = feedbackData.scores.slice(-5);
							}
							feedbackData.skipped = 0;
							_lsSet(feedbackKey, JSON.stringify(feedbackData));
							/* 存储彻底满则本次跳过写入，不打扰玩家 */
						}
					} catch (e) {
						/* 序列化等异常同样不打扰对局 */
					} finally {
						saving = false;
					}
				};
			})();
			/* 每5局触发一次评分 */
			const shouldAsk = (feedbackData.games % 5 === 0);
			if (shouldAsk && cfg("playerFeedback", true) !== false) {
				const me = game.me;
				const myKey = me ? (me.name || me.name1 || "?") : "?";
				const myScore = (round && round[myKey]) || 0;
				const winText = myScore > 0 ? '胜利' : (myScore < 0 ? '失败' : '平局');
				setTimeout(function () {
					try {
						/* 用无名杀原生对话框 */
						const dlg = ui.create.dialog('无名AI 体验反馈');
						dlg.classList.add('fullheight');
						dlg.style.width = 'min(92vw, 480px)';
						dlg.style.left = '4vw';
						/* 内容 */
						const content = document.createElement('div');
						content.style.padding = '16px';
						content.innerHTML =
							'<div style="text-align:center; margin-bottom:16px;">' +
							'<div style="font-size:16px; margin-bottom:8px;">本局结果：<b>' + winText + '</b></div>' +
							'<div style="color:#999; font-size:13px;">你觉得AI的表现怎么样？点选一个分数</div>' +
							'</div>' +
							'<div style="display:flex; justify-content:center; gap:8px; margin-bottom:16px; flex-wrap:wrap;">' +
							[-5,-4,-3,-2,-1,0,1,2,3,4,5].map(function(s) {
								const color = s < 0 ? '#ff6b6b' : (s > 0 ? '#51cf66' : '#ffd43b');
								const label = s < 0 ? s : (s > 0 ? '+' + s : '0');
								return '<button data-score="' + s + '" style="width:40px; height:40px; border-radius:50%; border:2px solid ' + color + '; background:rgba(255,255,255,0.1); color:' + color + '; font-size:14px; cursor:pointer;">' + label + '</button>';
							}).join('') +
							'</div>' +
							'<div style="background:rgba(0,0,0,0.2); border-radius:8px; padding:12px; margin-bottom:16px; font-size:12px; line-height:1.8;">' +
							'<div style="color:#ff6b6b; margin-bottom:4px;">【差评区】</div>' +
							'<div>−5分：完全不会玩，低级错误频发</div>' +
							'<div>−4分：很离谱，决策明显错误</div>' +
							'<div>−3分：较差，经常选错目标/时机</div>' +
							'<div>−2分：一般偏差，偶尔犯傻</div>' +
							'<div>−1分：小问题，基本能打但不聪明</div>' +
							'<div style="color:#ffd43b; margin:6px 0 4px;">【中性区】</div>' +
							'<div>0分：中规中矩，像普通玩家</div>' +
							'<div style="color:#51cf66; margin:6px 0 4px;">【好评区】</div>' +
							'<div>+1分：还不错，决策比较合理</div>' +
							'<div>+2分：良好，思路清晰</div>' +
							'<div>+3分：不错，像会玩的玩家</div>' +
							'<div>+4分：很好，有配合意识</div>' +
							'<div>+5分：非常好，像高手大神</div>' +
							'</div>' +
							'<div style="text-align:center;">' +
							'<button id="skipFeedback" style="padding:8px 24px; border-radius:20px; border:none; background:rgba(255,255,255,0.2); color:#ccc; font-size:14px; cursor:pointer;">跳过本次反馈</button>' +
							'</div>';
						dlg.content.appendChild(content);
						/* 绑定按钮事件 */
						content.querySelectorAll('button[data-score]').forEach(function(btn) {
							btn.onclick = function() {
								const s = parseInt(btn.getAttribute('data-score'));
								feedbackData.scores.push({
									games: feedbackData.games,
									score: s,
									result: winText,
									time: Date.now()
								});
								if (feedbackData.scores.length > 20) feedbackData.scores = feedbackData.scores.slice(-20);
								_fbTrySave();
								dlg.close();
							};
						});
						const skipBtn = content.querySelector('#skipFeedback');
						if (skipBtn) {
							skipBtn.onclick = function() {
								feedbackData.skipped = (feedbackData.skipped || 0) + 1;
								_fbTrySave();
								dlg.close();
							};
						}
					} catch (eDlg) {
						/* 弹窗失败，降级用 prompt */
						const score = window.prompt(
							'【无名AI 体验反馈】\n本局结果：' + winText + '\n' +
							'给AI表现打分（-5到+5，0=跳过）：'
						);
						if (score !== null && score !== '' && parseInt(score) !== 0) {
							const s = parseInt(score);
							if (s >= -5 && s <= 5) {
								feedbackData.scores.push({ games: feedbackData.games, score: s, result: winText, time: Date.now() });
							}
						} else {
							feedbackData.skipped = (feedbackData.skipped || 0) + 1;
						}
						_fbTrySave();
					}
				}, 5000);
			}
			_fbTrySave();
			/* ★ 精度模式：把玩家评分接入模型，调整最近样本权重 */
			try {
				if (feedbackData.scores && feedbackData.scores.length > 0) {
					const latestScore = feedbackData.scores[feedbackData.scores.length - 1].score;
					/* 评分 -5~+5 → 权重倍数 0.5~1.5 */
					const weightMul = 1 + latestScore / 10;
					/* 调整最近20条样本的权重 */
					if (window.__DJSC && window.__DJSC.training && window.__DJSC.training.adjustRecentWeights) {
						window.__DJSC.training.adjustRecentWeights(weightMul, 20);
					}
				}
			} catch (eAdj) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eAdj); }
		} catch (eFeedback) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eFeedback); }
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
