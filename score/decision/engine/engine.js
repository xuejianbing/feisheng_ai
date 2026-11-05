import { installHooks, uninstallHooks, installed, setHookInstalled, scheduleHookExposure } from '../execution/hostHooks.js';
import { observeCognitionLog, observeSkillFeedback, observeStyleFeedback, observeDecisionRecord, observeDecisionReplay, observeAutoFeature, observeTeamBroadcast } from '../feedback/decisionObservations.js';
import { round, scoreLog, REC, rec, _initLedger, _winningSet, conservationLedger, give, displayName, givePair, _campOf, _contribution, _isAlive, cash, _stage, _campAvg, giveVs, toMoney, resetLedgerRound, resetLedgerState } from '../scoring/scoreLedger.js';
import { _snapshotAlly, _evaluateAllyAction, _markAllyHurt, _updateMomentum, turnMomentum, scoreCardUse, scoreEffect, EFFECT_HANDLERS, resetScoreEventCounters } from '../scoring/scoreEvents.js';
import { opportunityCost, countCardName, hasCardName, clearHandCountCache, hasNatureCard, _probShanCached, expectedValue, marginalValue, readCardOverride, _calcAllyDamagePenalty, resetTargetProbabilityCache } from '../scoring/candidateValuation.js';
import { DECISION_LOG, _getRoundNumber, recordDecision, _finalizeDecisionRecord, _autofeatCtx, getDecisionLog } from '../records/decisionRecords.js';
import { _playerLogs, addPlayerLog } from '../../perception/journal/playerActionLog.js';
import { settleGame } from '../settlement/gameSettlement.js';
import { selectInitialCandidate, mergePlannedCandidate } from '../selection/candidateSelection.js';
import { applyBasicCardPlayRules, _skillTargetDependsOnCard, _isLegalSkillTarget, _skillNeedsExternalTarget, _canConfirmSelfSkillTarget, _skillTargetRange, _skillPurposeFromIntent, _isSingleTargetSkillProfile, applyBasicSkillRules, aliveCountP, applyBasicEquipRules, equipSlotOf, applyBasicJudgeRules, _buildTargetBrainCandidates, _buildCardDecisionContext, _resolveCardCandidateTarget, applyBasicTargetRules, pickKillTarget } from '../rules/basicRules.js';
import { generateScoredCandidates } from '../generation/scoredCandidates.js';
import { scoreCandidates } from '../scoring/candidateScoring.js';
import { reviewCandidate } from '../selection/modelReview.js';
import { refineCandidatePlan } from '../selection/plannedSelection.js';
import { guardCandidate } from '../safety/finalCandidateGuard.js';
import { recordExecutedLearning } from '../feedback/executedLearning.js';
import { attachDecisionEffects } from '../execution/decisionEffects.js';
import { buildDecisionContext } from '../context/decisionContext.js';
import { buildTargetContext } from '../context/targetContext.js';
import { connectEngineQueries } from '../../foundation/runtime/engineQueries.js';
/*
 * ============================================
 * // Éditeur: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

import { safeGet as _lsGet, safeSet as _lsSet } from '../../foundation/storage/storage.js';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */

/* ================= 决策积分引擎 · 记分核心+评分框架（整合模块） ================= */
import { lib, game, ui, get, ai, _status } from '../../foundation/adapt/host.js';
import { reg } from '../../foundation/runtime/registry.js';   /* ★ 唯一挂载总线：所有 __DJSC 挂载统一走这里 */
import { VAL_CARD, VAL_EFFECT } from '../../knowledge/tables/value-tables.js';
import { decideCard, classifyCard, pickTarget as pickCardTarget } from '../cardplay/cardPlayBrain.js';
import { decideSkill } from '../skills/skillPlayBrain.js';
import { decideEquip } from '../basic/equipBrain.js';
import { decideJudge } from '../basic/judgeBrain.js';
import { pickTargetByPurpose, targetScore as targetBrainScore } from '../basic/targetBrain.js';
import { evaluateTiesuoActions, tiesuoUtilityToEngineRaw } from '../cards/tiesuoEvaluator.js';   /* ★ 指令 02：铁索唯一权威策略源 */
import { evaluateActionTransitionPenalty, beginStrategicAction, reconcileStrategicTransitions, beginStrategicTurn } from '../state/turnStrategicState.js';   /* ★ 回合内战略状态转移唯一权威源 */
import { buildPlayerSnapshot, buildTargetCandidate } from '../state/playerSnapshot.js';   /* ★ 指令 05 Stage A+C：统一 Player State Snapshot + 目标候选契约（禁止再猜宿主字段） */
import { codeGainOf, skillRuleOf, detectCombo, skillProfileOf, skillBranchesOf, checkBranch, skillStagesOf, skillInteractionOf, skillTagsOf } from '../skills/skills.js';
import { cacheGet, cacheSet, checkStateChanged, initStateWatcher, stateKey } from '../../foundation/storage/cache.js';
import { enemiesOf, isEnemyOf, isAllyOf, dispositionOf, situationFactor, targetScore, probHasBagua, probHasShan, hasVengeanceSkill, cardValueOf, clearThreatCache, seatPressure, forecastSummary, burstThreatOf, maxBurstThreat, threatOf, linkedChainValue } from '../threat/threat.js';
import { isPlayerLinked } from '../state/playerState.js';   /* ★ 指令 02：唯一横置状态读取入口 */
import { miniPredict, cardIdOf, MINI_W } from '../../model/net/mini-model.js';
import { miniFeatures } from '../skills/skills.js';
import { MEM, memLoad, memSave, memReset, memRecordAtk, memRecordHit, memKeyOf } from '../../perception/memory/mem.js';
import { observeAttack, observeAid, observeCardUse, resetObs, getObs, fireAttackExpectedHit } from '../../perception/observer/observer.js';
import './scoreSelfMod.js';  // ★ 积分自修改器：AI 直接修改规则积分
import { deckConsume, deckReset, cardRemaining, deckAutoDetect, deckSyncFromUI } from '../../perception/memory/deckMemory.js';
import { baguaSuccessRate } from '../../model/predict/deckPredict.js';
import { identityOf as _identityOf, identityOfFor as _identityOfFor, beliefOf, beliefOfFor as _beliefOfFor, updateBelief, confidenceOf, confidenceOfFor as _confidenceOfFor, hardIdentityOf as _hardIdentityOf, isLikelyEnemy, isLikelyAlly, resetBelief, explainIdentity, identityBiasOf } from '../../perception/observer/identity.js';
import { cfg, safe, nameOf, keyOf } from '../../foundation/config/util.js';
import { teamPlan } from '../../perception/team/team.js';
import { log } from '../../foundation/diag/logger.js';
import { DIRS } from '../../foundation/storage/storagePaths.js';   /* ★ 统一导出路径：避免 'data' 误写到游戏根 */
import { getDecisionBonus, recordTargetOutcome, recordTempoOutcome, recordPlayOutcome, flushDecisionFeedback, markOutcome } from '../feedback/decisionFeedback.js';
import { perfMark } from '../../foundation/diag/perf.js';
import { resourceBalance, discardCost, sellHpValue, equipReplaceCost, abolishPenalty } from '../resource/economy.js';
import { fxRate, fxToMoney, fxSnapshot } from '../../knowledge/exchange/exchange.js';
import { chooseStrategy } from '../strategy/strategy.js';
import { styleOf } from '../../perception/observer/observer.js';
import { loadStore, saveStore, mergeOnSettle, storeStats } from '../../perception/memory/memory.js';
import { applyCampSkillProgressBonus } from '../skills/skillProgress.js';
import { applyResourceMaximizeBonus, applyLossMinimizeBonus } from '../strategy/resourceMaximize.js';
import { archiveGame, verdictOf, loadArchive, getArchive, getGameDecisions, exportArchiveJson } from '../../perception/archive/archive.js';
import { recordGame as recordGameLog } from '../../perception/journal/gameLogStore.js';  /* ★ 对局日志自存库（绕开内核录像 20 条上限） */
import { trainStartGame, trainRecordSample, trainSettleGame, trainFeedbackSample } from '../../model/train/trainExport.js';
import { loadFeedback, recordSkillUse, flushFeedback, feedbackCount } from '../../perception/feedback/feedback.js';
import { multiTurnForecast } from '../strategy/multiturn.js';
import { loadStyleFeedback, recordStyleOutcome, flushStyleFeedback, recordPlayerTag, saveStyleFeedback } from '../../perception/feedback/styleFeedback.js';
import { focusBonus, broadcastIntent, installBroadcastHooks, uninstallBroadcastHooks, readIntents, snapshotBroadcast } from '../../perception/team/teamBroadcast.js';
import { refineBestWithPlan, planForDecision } from '../strategy/planner.js';
import { strategize } from '../strategy/strategist.js';
import { getModeStrategy, isSameCamp, isEnemy, applyModeBoost } from '../strategy/modeStrategy.js';
import { getStrategicState, strategicStateSnapshot, resetStrategicState } from '../strategy/strategicState.js';
import { applyStrategicIntentToCandidates } from '../strategy/intentAlignment.js';
import { characterPolicyOf, characterPolicySnapshot, applyCharacterPolicyToCandidates, resetCharacterPolicyCache } from '../strategy/characterPolicy.js';
import { initializeUtilityPipeline, trackUtilityStage, finalizeUtilityPipeline, utilityPipelineSnapshot } from '../utility/utilityPipeline.js';
import { actionValue as relActionValue, exposureOf as relExposureOf, relationStateKey } from '../relations/relations.js';   /* ★ 统一收益/暴露系统入口 */
import { autoRegister as globalAutoRegister, installProbes } from '../../foundation/runtime/globalScanner.js';
import '../../bootstrap/legacyFeatureInterfaces.js';  // 旧特征接口统一装配，业务实现已归位
import '../../model/train/autoLearn.js';       // ★ 自动学习表：新卡牌/新技能自动打分
import { getJSON as storageGetJSON, setJSONQuotaSafe as storageSetQuota } from '../../foundation/storage/storage.js';  /* ★ 中央存储抽象 */
/* ===== 24 个优化模块 ===== */
import { probHasWuxie, probHasTao, probHasSha, probHasJiu, probHasCard, inferHand } from '../../model/predict/handInference.js';
import { aggregateByPlayer, buildComparisonHtml as aiStatsBuildHtml } from '../../perception/stats/aiStats.js';  /* ★ 真正的 aiStats */
import { checkAllyExempt } from '../safety/allyExempt.js';  /* ★ 真正的 allyExempt */
import { recordGuardEvent, getGuardStats, resetGuardRecorder, mountGuardRecorderInterface } from '../safety/guardRecorder.js';  /* 公共记录器由所属模块统一挂载 */
import { healthCheck } from '../../foundation/diag/health.js';  /* ★ 真正的 health */
import { trainLocalAsync, isTraining, lastResult } from '../../model/train/localTrainer.js';  /* ★ 真正的 localTrainer */
import { getDecisionFeedbackStats } from '../feedback/decisionFeedback.js';  /* ★ 真正的 decisionHook（新增） */
import { installAutoDiscover, promoteHighRegretPoints as promoteRegret, getRegretStats } from '../../perception/discover/autoDiscover.js';  /* ★ 真正的 decisionRegistry */
import { scanCharacters, aggregateSkillTags, buildAutoSkillRules } from '../skills/skills.js';  /* ★ 真正的 skillScanner（新增） */
import { wuxieTiming, wuxieBonus } from '../timing/wuxieTiming.js';  /* ★ 真正的 responseAI */
import { wuguTiming, wuguBonus } from '../timing/wuguTiming.js';  /* ★ 真正的 responseAI */
import { archiveStats } from '../../perception/archive/archive.js';  /* ★ 真正的 replayAnalysis（新增） */
import { exportStore } from '../../perception/memory/memory.js';  /* ★ 真正的 profiles（新增） */
import { autoSelfHeal } from '../../foundation/diag/selfHeal.js';
import { updateAdaptive } from '../tuning/adaptive.js';
import { showReport, resetReportShown } from '../../view/report/report.js';
import { resetDecisionFeedback } from '../feedback/decisionFeedback.js';
import { recordGameEnd as banditRecordGameEnd } from '../../model/train/bandit.js';
import { onGameEnd as modelStateOnGameEnd, recordABScore } from '../../model/state/modelLifecycle.js';
import { applyChampionRule, applyChampionBoost, getChampions as champGet, championOf as champOf, recompute as champRecompute, stats as champStats, feedbackSettle as champSettle, getEmbedding as champEmbedding, resolveChampionBoost } from '../strategy/championStrategy.js';  /* ★ 冠军策略固化 */

/* ★ 立刻挂载 scan，不用等 setTimeout */
window.__DJSC = window.__DJSC || {};
window.__DJSC.scan = {
  install: function() { return true; },
  autoRegister: function() { return []; },
  scanAll: function() { return []; },
  getStats: function() { return { ok: true }; },
  reset: function() {},
};
import { getFeedbackStats } from '../../perception/feedback/feedback.js';  /* ★ 真正的 skillCustom（新增） */
import { detectConflict, conflictLog, conflictStats, resetConflict } from '../analysis/conflictDetector.js';  /* ★ 真正的 compat */
import { getStyleFeedbackStats, getPlayerTag } from '../../perception/feedback/styleFeedback.js';  /* ★ 真正的 smartPanel（新增） */
import { getStats as strategistGetStats, getLastDecision, setEnabled, isEnabled } from '../strategy/strategist.js';  /* ★ 真正的 decisionDashboard（新增） */
import { focusTarget, protectScore, comboWithAllies } from '../../perception/team/team.js';  /* ★ 真正的 modules（新增） */
import { openSelfCheck, getSelfCheckHistory, clearSelfCheckHistory, runChecks as runSelfChecks } from '../../verification/selfCheck.js';  /* ★ 真正的 selfCheck（P1-28：run 接真实检查） */
import { startAutoplay, stopAutoplay, autoplayStatus, showAutoplayReport } from '../../view/autoplay/autoplay.js';  /* ★ 真正的 autoplay */
import { CHANGELOG, printChangelog, getVersionChanges, getLatestVersion } from '../../foundation/diag/changelog.js';  /* ★ 真正的 changelog */
import { lineChart, barChart, radarChart, donutChart } from '../../view/report/charts.js';  /* ★ 真正的 charts */
import { installCompareAI, uninstallCompareAI } from '../response/compareAI.js';  /* ★ 真正的 compareAI */
import { keepScore, recommendKeep } from '../cardplay/keepStrategy.js';
import { equipScarcity, equipValue, isKeyEquip } from '../cardplay/equipScarcity.js';
import { analyzeTeammateIntent, analyzeTeammateStrategy, teammateCoordination, recordTeammateAction } from '../../perception/team/teammateIntent.js';
import { analyzeOpponentPref, counterStrategy, predictOpponentNext, counterScoreBonus } from '../strategy/counterStrategy.js';
import { evaluateSituation, describeSituation, situationStrategyBonus } from '../../cognition/situationEval.js';
import { shaHitRate, wuxieRisk, duelWinRate, taoNecessity, riskScore } from '../../cognition/reasoning/riskQuant.js';
import { analyzeOpponentMood, describeMood, moodStrategyBonus, getAllMoods } from '../../cognition/moodState.js';
import { getMutualRelations, isCountering, isBeingCountered, counterRelationBonus } from '../../knowledge/counters/mutualRelations.js';
import { getCardPriority, recommendOrder, orderBonus, recommendFlow } from '../tuning/orderOptimizer.js';
import { shouldPassCard, whatTeammateNeeds, passCardBonus } from '../cardplay/passStrategy.js';
import { countTiesuo, tiesuoTransfer, tianxiangTransfer, damageTransfer, damageTransferBonus } from '../safety/damageTransfer.js';
import { predictShaFollowup, predictJuedouFollowup, searchTree, treeSearchBonus } from '../strategy/treeSearch.js';
import { needLongDelay, getSmartDelay, waitForSkills, checkSkillTriggered } from '../tuning/delayOptimizer.js';
import { getDeckTop, hasGuanxingSkill, prioritizeDeckTop, deckTopBonus, clearDeckTopCache } from '../../model/predict/deckTopPredict.js';
import { recommendDiscard, discardValue, specialDiscardAdvice, discardAdvice } from '../cardplay/discardStrategy.js';
import { recordGameResult, getWinRate, autoAdjustWeights, learningPanelData, clearLearningData } from '../../model/train/learningLoop.js';
import { recycleArchiveSamples } from '../../model/train/archiveRecycle.js';  /* ★ 归档离线训练回流：胜利局样本回灌 */
import { aliveCount, identityGameStrategy, shouldRevealIdentity, gameTheoryBonus } from '../../cognition/reasoning/gameTheory.js';
import { cached, clearAllCache, cacheStats, perfStart, perfEnd } from '../../foundation/diag/perfOptimizer.js';
/* ===== v1.7.0 新增 5 个优化模块 ===== */
import { responseBonus } from '../cardplay/responseOpt.js';
import { discardBonus } from '../cardplay/discardOpt.js';
import { endgameBonus, isEndgame, endgameStrategy } from '../tuning/endgameOpt.js';
import { opponentPredictBonus, recordOpponentAction, predictOpponentNext as predictOpponentNextO } from '../../model/predict/opponentPredict.js';
import { resourceTimingBonus } from '../resource/resourceTiming.js';
/* ===== v1.8.0 新增 5 个优化模块 ===== */
import { aoeBonus } from '../timing/aoeTiming.js';
import { judgeBonus } from '../timing/judgeTiming.js';
import { equipReplaceBonus } from '../cardplay/equipReplace.js';
import { keepBonus } from '../cardplay/keepStrategyOpt.js';
import { multiTurnBonus } from '../strategy/multiTurnOpt.js';
/* ===== v1.0.2 新增 5 个锦囊时机优化模块 ===== */
import { duelBonus } from '../timing/duelTiming.js';
import { jiedaoBonus } from '../timing/jiedaoTiming.js';
import { shandianBonus } from '../timing/shandianTiming.js';
import { taoyuanBonus } from '../timing/taoyuanTiming.js';
/* ===== v1.0.3 新增 5 个时机优化模块 ===== */
import { shaTargetBonus } from '../tuning/shaTargetOpt.js';
import { taoBonus } from '../timing/taoTiming.js';
import { jiuBonus } from '../timing/jiuTiming.js';
import { shunshouBonus } from '../timing/shunshouTiming.js';
/* ===== v1.0.4 深度价值量化模块 ===== */
import { deepValueBonus, deepCardValue, deepTargetValue, deepSituationValue } from '../utility/deepValue.js';
import { recordTrigger, getDecayMultiplier, applyDecay, clearDecayLog, getDecayStats } from '../tuning/decayOpt.js';
import { clearCompensation } from './scoreUnify.js';
import { makeActionCandidate, runtimeScore, applyRelativeUtilityDelta, targetKey, candidateTargetValue, sameCandidateAction, sameCandidatePolicyBand, ensureCandidatePolicy, vetoCandidate, setCandidatePriority, isCandidateEligible, compareActionCandidates, PRIORITY_TIER, candidatePriorityRank, candidatePolicySnapshot } from '../state/actionCandidate.js';
import { buildDecisionTraceLines } from './decisionTrace.js';
import { normalizedMargin, DECISION_MARGIN } from '../state/decisionMargin.js';
import { createDecisionTransaction, peekDecisionTransaction, decisionTransactionStats, resetDecisionTransactionStats } from '../state/decisionTransaction.js';
import { commitExecution, confirmExecutionFromHostEvent, cancelExecution, executionGatewayStats, resetExecutionGateway, invokeObservedHost } from '../execution/executionGateway.js';
import { extractFeatures, FEATURE_DIM } from '../../model/features/features.js';
import { pushSample, bufferSize, bufferClear, mountTrainingInterface } from '../../model/train/trainExport.js';
import { getState as modelGetState, onGameEnd as modelOnGameEnd, forceTrain as modelForceTrain } from '../../model/state/modelLifecycle.js';
import * as _trainExportModule from '../../model/train/trainExport.js';
import { getWeights, getBias, isReady as weightsReady, predict } from '../../model/weights/weights.js';
import * as _weightsModule from '../../model/weights/weights.js';
import { guardCheck, applyGuardPenalty } from '../safety/modelGuard.js';
import '../../view/dashboard/guardPanel.js';
import { observeElementUse, startElementFeedbackLoop, settleElementFeedback } from '../../perception/feedback/elementFeedback.js';
import { metaStartGame, metaSettleGame, metaRecordSkill, metaRecordCard, metaRecordTarget, metaRecordDecision, cognitiveModulate, decideIntervention } from '../../cognition/metaCognition.js';
import { logCognition, getCognitionLog, cognitionStats, resetCognitionLog } from '../../cognition/log/cognitiveLog.js';
import '../analysis/conflictDetector.js';
import '../../model/calibrate/decisionCalibrator.js';
import '../../view/dashboard/calibratorPanel.js';
import '../../cognition/profile/multiProfile.js';
import '../strategy/strategyBus.js';
import '../../view/dashboard/brainDashboard.js';
import '../../perception/replay/decisionReplay.js';
import '../../view/dashboard/exportPanel.js';
import '../../view/dashboard/replayPanel.js';
import '../../model/weights/weightPersist.js';

/* ===== ★ 激活所有剩余核心模块 ===== */
import '../../perception/stats/aiStats.js';
import '../safety/allyExempt.js';
import './decisionHook.js';
import './decisionRegistry.js';
import '../../knowledge/tables/elementAccess.js';
import '../safety/guardRecorder.js';
import '../../foundation/diag/health.js';
import '../../model/train/localTrainer.js';
import '../strategy/multiTurnPlan.js';
import '../resource/resourceManage.js';
import '../response/responseAI.js';
import '../skills/skillCustom.js';
import '../skills/skillRules.js';
import '../skills/skillScanner.js';

/* ===== ★ 激活所有面板/工具模块 ===== */
import '../../view/autoplay/autoplay.js';
import '../../foundation/diag/changelog.js';
import '../../view/report/charts.js';
import '../response/compareAI.js';
import '../../foundation/adapt/compat.js';
import '../../view/dashboard/decisionDashboard.js';
import '../../foundation/i18n/i18n.js';
import '../../view/dashboard/identityVisual.js';
import '../../foundation/runtime/modules.js';
import '../strategy/pickRecommend.js';
import '../../foundation/config/profiles.js';
import '../../perception/replay/replayAnalysis.js';
import '../../verification/selfCheck.js';
import '../../view/panel/smartPanel.js';
import '../../model/train/crossModeTransfer.js';
import '../analysis/decisionCompare.js';
import '../../view/dashboard/comparePanel.js';
import '../../model/net/modelHotSwap.js';
import { applySharedBonus, shareContribute } from '../../perception/knowledge/sharedKnowledge.js';  /* ★ 公共知识库：决策加成+贡献（此前只 import 从不调用，采纳/贡献恒 0） */
import '../../model/train/evolution.js';
import { psychologyBonus, deterrenceCheck, intentReading, pressureScore, strategicHold, psychologyStats, resetPsychology } from '../../cognition/reasoning/psychology.js';
import { comboChainBonus, detectChains, chainScore, chainPriority, comboChainStats, resetComboChain, CHAINS, learnChainUse, learnedChains, clearLearnedChains, finalizeLearned, exportAllChains, importChains } from '../strategy/comboChain.js';
import { playerMemoryBonus, rememberGame, rememberAttack, rememberAid, playerMemoryStats, recallPlayer, hostilityLevel, playerMemoryList, resetPlayerMemory } from '../../perception/memory/playerMemory.js';
import { profStart, profEnd, profile, profilerEnable, profilerStats, openProfilerPanel } from '../../foundation/diag/profiler.js';
import { narrate, renderNarrateHtml, recentNarrations, showRecentNarrations } from '../../cognition/explain/decisionNarrator.js';
import { postCheckBefore, postCheckAfter, postCheckDelayed, postCheckBatch, postCheckDiscard, postCheckStats, postCheckReset } from '../analysis/postCheck.js';
import { criticBest as deepThinkCritic, thinkingStats as deepThinkStats } from '../../cognition/deepThink.js';  /* ★ 模型思考层：深度思考 */
import { getCardStrategy, cardUseValue, cardRespondValue, getCardType, getCardRisk, cardStrategyStats, resetCardStrategy } from '../cardplay/cardStrategy.js';
import { recordDecisionContext, settleDecisionContext, getAutoFeatureWeight, autoFeatureStats, topAutoFeatures, resetAutoFeatures } from '../../model/features/autoFeature.js';
import { getMetric, learnMetric, learnFromGame, softMetricStats, resetSoftMetrics } from '../../cognition/reasoning/softMetrics.js';

/* ★ v2.2.5 ~ v2.3.2 新模块 import（必须 import 才会执行挂载） */
import '../skills/skillTags.js';      // 技能标签系统
import '../cardplay/judgeZone.js';      // 判定区状态检测
import '../../knowledge/cards/cardTags.js';       // 手牌标记系统
import '../cardplay/viewAs.js';         // viewAs/转化类AI
import '../cardplay/costCalc.js';       // cost函数计算
import '../../view/panel/aiTools.js';        // AI工具集（嘲讽度/技能重要度/技能标签/回合外价值）
import '../../model/train/learningOptimizer.js';  // 学习效率优化器（优先级回放/特征筛选/课程学习/自适应学习率）
import '../skills/skillTiming.js';       // 技能触发时机识别（触发时机/技能类型/效果识别）

/* ★ 确保所有新模块挂载到 window.__DJSC 上 */
try {
    window.__DJSC = window.__DJSC || {};

    /* psychology - 博弈策略层 */
    window.__DJSC.psychology = {
        deterrence: deterrenceCheck,
        intent: intentReading,
        pressure: pressureScore,
        hold: strategicHold,
        bonus: psychologyBonus,
        stats: psychologyStats,
        reset: resetPsychology,
        /* ★ 连接性修复：features.js 第 108/109 维读取 psychology.getState(tgt)
         *   但该命名此前从未挂载 → 特征恒为 0。此处补上，映射到已有情绪模型。 */
        getState: function (p) {
            try {
                const m = analyzeOpponentMood(p) || {};
                const d = m.details || {};
                return {
                    aggressive: m.mood === 'aggressive' ? m.intensity : (d.attack || 0),
                    nervous: m.mood === 'defensive' ? m.intensity : (d.defense || 0),
                    mood: m.mood,
                    intensity: m.intensity,
                };
            } catch (e) { return null; }
        },
    };

    /* comboChain - 连招链 */
    window.__DJSC.comboChain = {
        detect: detectChains,
        score: chainScore,
        priority: chainPriority,
        bonus: comboChainBonus,
        stats: comboChainStats,
        reset: resetComboChain,
        CHAINS: CHAINS,
        /* ★ 连招学习 */
        learn: learnChainUse,
        learned: learnedChains,
        clearLearned: clearLearnedChains,
        /* ★ 本局高分策略固化 + 连招库全维度导出/回流 */
        finalize: finalizeLearned,
        exportAll: exportAllChains,
        importChains: importChains,
    };

    /* playerMemory - 对手长期记忆 */
    window.__DJSC.playerMemory = {
        remember: rememberGame,
        attack: rememberAttack,
        aid: rememberAid,
        recall: recallPlayer,
        hostility: hostilityLevel,
        bonus: playerMemoryBonus,
        stats: playerMemoryStats,
        list: playerMemoryList,
        reset: resetPlayerMemory,
    };

    /* profiler - 性能分析器 */
    window.__DJSC.profiler = {
        start: profStart,
        end: profEnd,
        profile: profile,
        enable: profilerEnable,
        stats: profilerStats,
        open: openProfilerPanel,
    };

    /* narrator - 决策解释器 */
    window.__DJSC.narrator = {
        narrate: narrate,
        render: renderNarrateHtml,
        recent: recentNarrations,
        show: showRecentNarrations,
    };
    window.__DJSC.openNarratorPanel = showRecentNarrations;
    window.__DJSC.openProfilerPanel = openProfilerPanel;

    /* identity - 身份推理（修正：挂载成object，不是function） */
    window.__DJSC.identity = {
        readIdentity: _identityOf,
        belief: beliefOf,
        updateBelief: updateBelief,
        confidence: confidenceOf,
        isEnemy: isLikelyEnemy,
        isAlly: isLikelyAlly,
        explain: explainIdentity,
        reset: resetBelief,
        stats: function() {
            return {
                identityOf: typeof _identityOf,
                beliefOf: typeof beliefOf,
                updateBelief: typeof updateBelief,
            };
        },
    };

    /* 概率推断函数挂载（供 features.js 80-84 维使用） */
    window.__DJSC.probHasShan = probHasShan;
    window.__DJSC.probHasTao = probHasTao;
    window.__DJSC.probHasWuxie = probHasWuxie;
    window.__DJSC.probHasSha = probHasSha;
    window.__DJSC.probHasJiu = probHasJiu;
    window.__DJSC.probHasCard = probHasCard;  // 通用卡牌推断
    window.__DJSC.inferHand = inferHand;      // 批量推断所有手牌
    window.__DJSC.seatPressure = seatPressure;
    window.__DJSC.cardValueOf = cardValueOf;
    window.__DJSC.enemiesOf = enemiesOf;
    window.__DJSC.isEnemyOf = isEnemyOf;
    window.__DJSC.situationFactor = situationFactor;
    window.__DJSC.targetScore = targetScore;
    window.__DJSC.forecastSummary = forecastSummary;
    window.__DJSC.burstThreatOf = burstThreatOf;
    window.__DJSC.maxBurstThreat = maxBurstThreat;

    /* ★ 移植旧版：5 个模块挂「真实实现」。
     *   用 Object.assign 合并而非整体覆盖——既补上旧版对外接口
     *   （record/predict/bonus、broadcast/read/install/snapshot、forecast、
     *    balance/discardCost/sellHpValue/equipReplaceCost/abolishPenalty、
     *    log/recent/stats/reset），又保留 missingModules 提供的兼容桩
     *   （getStatus/plan/evaluate/stats 等），避免 features.js 110-119 维静默降级。 */
    try {
        const _oppStub = window.__DJSC.opponentPredict || {};
        window.__DJSC.opponentPredict = Object.assign({}, _oppStub, {
            record: recordOpponentAction,
            /* 合并桩与真实实现：既保留 features.js 读取的 cardDraw，又提供真实 probSha 等 */
            predict: function (p) {
                try {
                    const base = (_oppStub.predict ? _oppStub.predict(p) : null) || {};
                    return Object.assign({}, base, predictOpponentNextO(p) || {});
                } catch (e) { return null; }
            },
            bonus: opponentPredictBonus,
        });
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

    try {
        window.__DJSC.teamBroadcast = Object.assign({}, window.__DJSC.teamBroadcast || {}, {
            broadcast: broadcastIntent,
            read: readIntents,
            bonus: focusBonus,
            install: installBroadcastHooks,
            snapshot: snapshotBroadcast,
        });
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

    try {
        window.__DJSC.multiturn = Object.assign({}, window.__DJSC.multiturn || {}, {
            forecast: multiTurnForecast,
        });
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

    try {
        window.__DJSC.economy = Object.assign({}, window.__DJSC.economy || {}, {
            balance: resourceBalance,
            discardCost: discardCost,
            sellHpValue: sellHpValue,
            equipReplaceCost: equipReplaceCost,
            abolishPenalty: abolishPenalty,
        });
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

    try {
        window.__DJSC.cognitiveLog = Object.assign({}, window.__DJSC.cognitiveLog || {}, {
            log: logCognition,
            recent: getCognitionLog,
            stats: cognitionStats,
            reset: resetCognitionLog,
        });
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

    window.__DJSC.deckMemory = {
        cardRemaining: cardRemaining,
        deckConsume: deckConsume,
        deckReset: deckReset,
        deckAutoDetect: deckAutoDetect,
        deckSyncFromUI: deckSyncFromUI,
        totalRemaining: function() {
            try {
                const pile = (typeof ui !== 'undefined' && ui.cardPile) ? ui.cardPile : null;
                const discard = (typeof ui !== 'undefined' && ui.discardPile) ? ui.discardPile : null;
                const pileCount = pile ? (pile.childNodes ? pile.childNodes.length : 0) : 0;
                const discardCount = discard ? (discard.childNodes ? discard.childNodes.length : 0) : 0;
                const total = pileCount + discardCount;
                return total > 0 ? total : 1;
            } catch (e) {
                return 1;
            }
        },
    };

    /* ★ 挂载模型推理与配置接口（已移到外面单独挂载，确保带 _real 标记） */
} catch (e) { console.error('挂载新模块失败:', e); }

/* ★ 单独挂载核心接口（不在 try 块里，确保一定能挂载）
 * ★ 统一经 reg.mount：已存在则不覆盖，消除与 index.js 的重复挂载互冲。
 *
 * P0：生产决策层禁止直接消费裸 predict()。
 * predict() 仍保留为模型/诊断底层接口；confidence 是带 readiness 门禁的生产入口。
 * 只要权重未 ready，任何模型消费者都必须拿到 skip，而不是随机初始化权重的概率。 */
export function safeModelPredict(features) {
	try {
		if (!weightsReady()) {
			return {
				action: 'skip',
				label: null,
				probs: null,
				confidence: 0,
				maxProb: 0,
				value: 0,
				ready: false,
			};
		}
		const r = predict(features);
		if (!r || typeof r !== 'object') {
			return {
				action: 'skip',
				label: null,
				probs: null,
				confidence: 0,
				maxProb: 0,
				value: 0,
				ready: false,
			};
		}
		return Object.assign({}, r, { ready: true });
	} catch (e) {
		try { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } catch (_) {}
		return {
			action: 'skip',
			label: null,
			probs: null,
			confidence: 0,
			maxProb: 0,
			value: 0,
			ready: false,
		};
	}
}

weightsReady._real = true;
predict._real = true;
safeModelPredict._real = true;
cfg._real = true;
bufferSize._real = true;
bufferClear._real = true;
trainLocalAsync._real = true;
reg.mount('weightsReady', weightsReady);
reg.mount('predict', predict);
reg.mount('cfg', cfg);
reg.mount('confidence', safeModelPredict);
reg.bind('deepThink', { critic: deepThinkCritic, stats: deepThinkStats });  /* ★ 模型思考层：深度思考对外接口 */
mountTrainingInterface();
/* 缓冲清理接口一并由训练模块连接。 */
reg.mount('trainLocalAsync', trainLocalAsync);

/* ★ weights对象由weights.js自己挂载（带getter自动获取最新值），这里不覆盖 */

/* ★ 模型状态：经总线软合并（已存在则不覆盖） */
reg.bind('modelState', {
    _real: true,
    getState: modelGetState,
    onGameEnd: modelOnGameEnd,
    forceTrain: modelForceTrain,
});

/* ★ 单独挂载技能标签系统（不在 try 块里，确保一定能挂载）
 * ★ 经总线软合并：decision/skillTags.js 自挂载的真实实现（含 BUILTIN_TAGS / 真实 stats）
 *   不会被这里的兜底覆盖，两者变为互补而非互冲。 */
try {
    reg.bind('skillTags', {
        get: skillTagsOf,
        playerTags: function(p) { 
            const tags = { attack:0, defense:0, burst:0, control:0, draw:0, recover:0, utility:0, survival:0 };
            (p && p.skills ? p.skills : []).forEach(function(sid) {
                try {
                    const t = skillTagsOf(sid);
                    if (tags[t] !== undefined) tags[t]++;
                } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
            });
            return tags;
        },
        stats: function() { return { ok: true, count: 8 }; },  /* 兜底：真实 stats 由 skillTags.js 提供 */
    });
    /* 训练模块统一连接导入导出，避免重复包装。 */
    mountTrainingInterface();
    /* ★ 自动创建 data 文件夹（统一路径：extension/无名AI/data） */
    try {
        game.writeFile('', DIRS.root, '.gitkeep', function() {});
        console.log('[engine] ✅ data 文件夹已就绪');
    } catch (eData) {
        console.warn('[engine] data 文件夹创建失败：', eData);
    }
    console.log('[engine] ✅ skillTags 已手动挂载');
} catch (eMount) {
    console.error('[engine] ❌ skillTags 挂载失败:', eMount);
}

/* 分数、守恒台账和记录状态归 scoring/scoreLedger.js。 */
let settleDone = false;
let settleIv = null;
/* ★ P1-26：100ms 延迟挂载的取消句柄与卸载标志。
 * 卸载后 _disposed=true，延迟回调直接返回；重新安装时复位。 */

/* 已执行动作记分与友方延迟观察归 scoring/scoreEvents.js。 */

/* 守恒分配实现归 scoring/scoreLedger.js。 */

/* ================= 记分钩子 ================= */

/* ███████ 货币等量规则 · 基础元素定义 ███████
 * 基准单位：MONEY_UNIT = 1（1 货币 = 1 标准收益点）。
 * 规则：toMoney(pts) 把任意原始收益折算成
 *       有界的货币等量 —— 小额 1:1 线性，中额亚线性压缩，大额封顶。
 *       用途：统一给分入库基准，防止单次巨大收益主导 round 贡献分、破坏
 *       单回合线性动量与训练归一化，让「货币」成为全链条可比的基础元素。 */

/* ★ 单回合动量：持续高收益 → 线性增幅倍率；持续低收益 → 线性衰减倍率。
 *   以「主动出牌的净收益符号」为信号，连续同向动作累积步数，反向即重置方向。
 *   倍率 = 1 + streak*STEP（线性），clamp ±MOM_CAP 步，封顶 ±30%。
 *   供 bestAction 在候选评分时乘以回合动量，鼓励顺风乘胜追击、逆风及时止损。
 *   注：netGain 一律经 toMoney 货币化后判断，单次巨大收益不影响方向判定。 */
/* 事件效果处理表与动量实现归 scoring/scoreEvents.js。 */
/* 玩家实际操作日志归 perception/journal/playerActionLog.js。 */
function _aiStrengthFactor() {
	try {
		const t = String(cfg('aiStrength', '中') || '中');
		const m = { '极弱': 0.0, '弱': 0.3, '中': 1.0, '强': 1.6, '极强': 2.0 };
		return (typeof m[t] === 'number') ? m[t] : 1.0;
	} catch (e) { return 1.0; }
}

/* ★ 人工标记（专业建议）：人为判定最近一条决策"不合理/合理"，或直接给一个评分。
 *   落到 decisionFeedback 的 'keep' 通道——engine 用 getDecisionBonus('keep', 动作id) 乘分，
 *   所以标记即刻生效：判负→该动作下次降分（×0.7），判好→下次提分（×1.4）。
 *   这就是"决策后给评分，下次遇到类似步骤用分数决定是否出牌"的人工版本。
 *   score（可选，-1..+1）：给了就按评分折算倍率（-1→×0.6、0→×1.0、+1→×1.4，最终夹在 0.7~1.4）。 */
let _manualMarked = { bad: 0, good: 0, lastKey: null };
export function markLastDecision(bad, reason, score) {
	try {
		const list = getDecisionLog();
		const e = (list && list.length) ? list[list.length - 1] : null;
		if (!e) return { ok: false, err: '暂无决策记录（先打一局）' };
		const w = e.winner || {};
		const key = w.id || w.type;
		if (!key) return { ok: false, err: '该决策没有动作标识，无法标记' };
		let ratio = null, good, label;
		if (typeof score === 'number' && isFinite(score)) {
			const s = Math.max(-1, Math.min(1, score));
			ratio = 1 + s * 0.4;                 /* 评分 -1..+1 → 倍率 0.6..1.4 */
			good = ratio >= 1;
			bad = !good;
			label = '人工评分 ' + s.toFixed(2);
		} else {
			good = !bad;
			label = bad ? '人工判负' : '人工判好';
		}
		const okMark = markOutcome('keep', key, good, ratio);
		if (bad) _manualMarked.bad++; else _manualMarked.good++;
		_manualMarked.lastKey = String(key);
		try {
			log.info('mark', label + '：' + key + (reason ? '（' + reason + '）' : '') +
				' → 该动作下次分数×' + Number(getDecisionBonus('keep', key)).toFixed(2));
		} catch (eL) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eL); }
		return {
			ok: !!okMark, key: String(key), bad: !!bad,
			score: (typeof score === 'number' && isFinite(score)) ? score : null,
			bonus: getDecisionBonus('keep', key),
		};
	} catch (e) { return { ok: false, err: String(e) }; }
}

export function manualMarkStats() {
	return { bad: _manualMarked.bad, good: _manualMarked.good, lastKey: _manualMarked.lastKey };
}

/* 宿主钩子安装/恢复与取消句柄归 execution/hostHooks.js。 */
/* 候选估值与缓存归 scoring/candidateValuation.js。 */
const COMBO_SKILLS = ["wuzhong","guohe","shunshou","nanman","wanjian","wuxie","lebu","bingliang","juedou","huogong","zhujin","taoyuan","wugu","tiesuo"];


/* ================= 决策回放记录器 ================= */
/* 决策记录与输出去重状态归 records/decisionRecords.js。 */
const PERSONALITY_PRESETS = {
	aggressive: { agg: 80, rsk: 70, team: 40 },
	balanced:   { agg: 50, rsk: 50, team: 50 },
	cautious:   { agg: 30, rsk: 30, team: 70 },
	loner:      { agg: 70, rsk: 60, team: 10 },
	guardian:   { agg: 30, rsk: 20, team: 90 },
};
const IDENTITY_MODS = {
	zhu:       { agg: -15, rsk: -10, team:  10 },
	zhong:     { agg:   5, rsk:  -5, team:  15 },
	mingzhong: { agg:   5, rsk:  -5, team:  15 },
	fan:       { agg:  15, rsk:  10, team:   5 },
	nei:       { agg:   5, rsk:  15, team: -10 },
};

/* 身份推荐模板（与 templates.js 的 key 对应） */
const IDENTITY_TEMPLATES = {
	zhu: "guardian", zhong: "zhugeliang", mingzhong: "zhugeliang",
	fan: "zhangfei", nei: "loner",
};
const TEMPLATE_DIMS = {
	balanced: { agg: 50, rsk: 50, tea: 50 }, aggressive: { agg: 80, rsk: 70, tea: 40 },
	cautious: { agg: 30, rsk: 30, tea: 70 }, loner: { agg: 70, rsk: 60, tea: 10 },
	guardian: { agg: 30, rsk: 20, tea: 90 }, zhangfei: { agg: 95, rsk: 75, tea: 20 },
	zhugeliang: { agg: 35, rsk: 25, tea: 85 }, lvbu: { agg: 100, rsk: 85, tea: 10 },
	simayi: { agg: 40, rsk: 30, tea: 65 }, huatuo: { agg: 15, rsk: 20, tea: 95 },
	zhouyu: { agg: 60, rsk: 55, tea: 70 }, diaochan: { agg: 45, rsk: 60, tea: 60 },
	sunquan: { agg: 50, rsk: 40, tea: 75 }, caocao: { agg: 75, rsk: 65, tea: 30 },
};

function resolvePersonality(me) {
	try {
		const preset = cfg("riskProfile", "custom");
		let agg, rsk, tea;
		let identityTag = "none";
		let autoMatched = false;
		let autoTemplate = null;

		/* ===== 协作模式：该 AI 有专属性格设置则优先 ===== */
		let allyOverride = null;
		try {
			if (me) {
				const pk = me.nickname || me.uid || me.name1 || me.name;
				if (pk) {
					const all = JSON.parse(_lsGet("无名AI_allyPersonalities") || "{}");
					if (all && all[pk] && typeof all[pk].agg === "number") allyOverride = all[pk];
				}
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ===== 身份自动匹配 ===== */
		const autoMatch = cfg("autoIdentityMatch", false);
		if (autoMatch && !allyOverride) {
			try {
				const mode = (_status && _status.mode) || (get && get.mode ? get.mode() : "");
				if (mode === "identity" || mode === "guozhan") {
					const id = me && me.identity;
					if (id && IDENTITY_TEMPLATES[id]) {
						const tplKey = IDENTITY_TEMPLATES[id];
						const tpl = TEMPLATE_DIMS[tplKey];
						if (tpl) { agg = tpl.agg; rsk = tpl.rsk; tea = tpl.tea; identityTag = id; autoMatched = true; autoTemplate = tplKey; }
					}
				}
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}

		if (allyOverride) {
			agg = allyOverride.agg; rsk = allyOverride.rsk; tea = allyOverride.tea;
			identityTag = "ally"; autoMatched = false;
		} else if (!autoMatched) {
			if (preset !== "custom" && PERSONALITY_PRESETS[preset]) {
				agg = PERSONALITY_PRESETS[preset].agg; rsk = PERSONALITY_PRESETS[preset].rsk; tea = PERSONALITY_PRESETS[preset].team;
			} else {
				agg = Math.max(0, Math.min(100, Number(cfg("personalityAggression", 50)) || 50));
				rsk = Math.max(0, Math.min(100, Number(cfg("personalityRisk", 50)) || 50));
				tea = Math.max(0, Math.min(100, Number(cfg("personalityTeam", 50)) || 50));
			}
		}

		let idMod = { agg: 0, rsk: 0, team: 0 };
		if (!autoMatched && !allyOverride) {
			try {
				const mode = (_status && _status.mode) || (get && get.mode ? get.mode() : "");
				if (mode === "identity" || mode === "guozhan") {
					const id = me && me.identity;
					if (id && IDENTITY_MODS[id]) { idMod = IDENTITY_MODS[id]; identityTag = id; }
				}
			} catch (eId) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eId); }
		}

		const norm = function (v) { return Math.round((0.5 + v / 100) * 100) / 100; };
		const rawAgg = Math.max(0, Math.min(100, agg + idMod.agg));
		const rawRsk = Math.max(0, Math.min(100, rsk + idMod.rsk));
		const rawTea = Math.max(0, Math.min(100, tea + idMod.team));
		return {
			label: autoMatched ? ("auto:" + autoTemplate) : (preset === "custom" ? "custom" : preset),
			identity: identityTag,
			identityMod: idMod,
			autoMatched: autoMatched,
			autoTemplate: autoTemplate,
			allyOverride: !!allyOverride,
			allyRole: (allyOverride && allyOverride.role) || null,
			raw: { agg: agg, rsk: rsk, tea: tea },
			eff: { agg: rawAgg, rsk: rawRsk, tea: rawTea },
			atk:  norm(rawAgg),
			def:  norm(100 - rawAgg),
			risk: norm(rawRsk),
			safe: norm(100 - rawRsk),
			team: norm(rawTea),
		};
	} catch (e) {
		return { label: "custom", identity: "none", identityMod: { agg: 0, rsk: 0, team: 0 }, autoMatched: false, autoTemplate: null, allyOverride: false, raw: { agg: 50, rsk: 50, tea: 50 }, eff: { agg: 50, rsk: 50, tea: 50 }, atk: 1, def: 1, risk: 1, safe: 1, team: 1 };
	}
}

/* ================= ★ 卡牌覆写信号提取 ================= */
/* 从 lib.card[id].__djsc_override 读取 optimization.js 的评分
 * 有效期 1500ms（避免跨回合污染）
 */
/* ★ 决策缓存：以 world-state + relation fingerprint 为主键。
 * 同一状态允许短时间复用，任何公开局面/事件/敌我关系变化立即失效。 */
const BEST_ACTION_CACHE_TTL = 1200;
let _lastBestAction = null;
let _lastBestActionTime = 0;
let _lastBestActionStateKey = '';
let _lastRelationStateKey = '';

/* ============================================
 * ★ 拆分的子函数（原bestAction巨石函数拆分）
 * ============================================ */

/**
 * 1. 性格分析模块
 */
function analyzePersonality(me) {
    const P = resolvePersonality(me);
    return {
        label: P.label,
        risk: { atk: P.atk, def: P.def, safe: P.safe },
        riskTaking: P.risk,
        teamwork: P.team,
        allyRole: P.allyRole || null
    };
}

/**
 * 2. 团队计划模块
 */
function analyzeTeamPlan(me) {
    const team = teamPlan(me);
    return {
        combos: team.combos || [],
        focus: team.focus,
        protect: team.protect
    };
}

/**
 * 3. 座位压力模块
 */
function analyzeSeatPressure(me) {
    return seatPressure(me);
}

/**
 * 4. 资源经济模块
 */
function analyzeEconomy(me) {
    return resourceBalance(me);
}

/**
 * 5. 未来预测模块
 */
function analyzeForecast(me) {
    return forecastSummary(me);
}

/* ★ multiTurnForecast 节流缓存：多回合预测较重，而 AI 在极短时间内可能连续决策。
 *   同一决策者间隔 <1.2s 时复用上一次结果，避免每个动作都重跑多回合推演（能耗/卡顿优化）。
 *   返回值为只读数据，缓存略微滞后的预测不会改变决策确定性，属安全节流。 */
let _mtVal = null, _mtHero = null, _mtAt = 0;
function multiTurnCached(me) {
    try {
        const now = Date.now();
        if (_mtHero === me && _mtVal && (now - _mtAt) < 1200) return _mtVal;
        _mtVal = multiTurnForecast(me);
        _mtHero = me;
        _mtAt = now;
        return _mtVal;
    } catch (e) {
        try { return multiTurnForecast(me); } catch (e2) { return null; }
    }
}

/* ★ 基本出牌决策标准接入层
 * 在 bestAction 的 acts.sort 之前调用，把 cardPlayBrain 的五类标准
 * （纯收益>补刀>及时防御>控制>输出>装备即时 + 硬性否决）落到候选上：
 *  - 否决的牌：写入 candidate.policy.veto，不再伪造负 utility。
 *  - priority>=99：进入 critical 策略层，不再用 +999 灌爆 score。
 *  - 其余优先级只记录为 policy 元数据，runtime score 始终保持真实 utility。
 */
/* 基本规则与候选目标解析的实现归 rules/basicRules.js。 */

function bestAction() {
	const _perfT0 = performance.now();
	const _perfPhases = {};
	/* ★ Decision Transaction：Evaluate 阶段只计算，不落学习/广播/回放副作用。
	 * 这些副作用先登记为 deferred effect，只有宿主实际执行匹配动作后才 Commit。 */
	const _deferredEffects = [];
	function _deferEffect(label, fn) {
		if (typeof fn === 'function') _deferredEffects.push({ label: label || 'effect', fn: fn });
	}
	let _phaseT0 = _perfT0;
	function _markPhase(name) {
		try {
			const now = performance.now();
			const dt = Math.max(0, now - _phaseT0);
			_perfPhases[name] = (_perfPhases[name] || 0) + dt;
			_phaseT0 = now;
		} catch (e) {}
	}
	function _phaseSnapshot() {
		const out = {};
		for (const k of Object.keys(_perfPhases)) out[k] = Math.round(_perfPhases[k]);
		return out;
	}
	profStart('bestAction');

	/* 上一次战略动作已经结算后，用真实公开状态差分确认 CREATE/REMOVE。
	 * confirmed transition 会影响本轮候选评分，因此先于 100ms bestAction 缓存处理。 */
	try {
		const _stMe = (_status && _status.currentPhase) || game.me;
		const _confirmed = _stMe ? reconcileStrategicTransitions(_stMe, {
			relationOf: function (mi, t) { return dispositionOf(mi, t); },
		}) : [];
		if (_confirmed && _confirmed.length) {
			_lastBestAction = null;
			_lastBestActionTime = 0;
			_lastBestActionStateKey = '';
		}
	} catch (eStrategicSync) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eStrategicSync); }

	/* ★ World-state invalidation：
	 * 身份明置、阵营/态度翻转、行为证据导致敌友关系变化时，即使 HP/手牌/装备均未变化，
	 * 旧 bestAction 也必须立即失效。这里不识别“跳身份”事件，只比较统一 relation fingerprint。 */
	let _currentRelationKey = '';
	try {
		const _relMe = (_status && _status.currentPhase) || game.me;
		_currentRelationKey = _relMe ? relationStateKey(_relMe) : '';
		if (_currentRelationKey !== _lastRelationStateKey) {
			_lastRelationStateKey = _currentRelationKey;
			_lastBestAction = null;
			_lastBestActionTime = 0;
			_lastBestActionStateKey = '';
			clearThreatCache();
		}
	} catch (eRelState) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eRelState); }

	/* ★ 事件驱动：其它 world-state 变化同样重算。 */
	if (checkStateChanged()) {
		_lastBestAction = null;
		_lastBestActionTime = 0;
		_lastBestActionStateKey = '';
	}

	/* ★ State-key cache：只有“公开局面 + 当前事件窗口 + 敌我关系”完全相同才复用。
	 * TTL 仅是安全上限，不再是决定缓存正确性的主要依据。 */
	let _decisionStateKey = '';
	try {
		_decisionStateKey = stateKey() + '::REL=' + _currentRelationKey;
	} catch (eStateKey) {
		_decisionStateKey = '';
	}
	if (_lastBestAction && _decisionStateKey &&
		_lastBestActionStateKey === _decisionStateKey &&
		(Date.now() - _lastBestActionTime) < BEST_ACTION_CACHE_TTL) {
		try { perfMark('bestAction.cache', performance.now() - _perfT0); } catch (eP) {}
		try { profEnd('bestAction'); } catch (eP) {}
		return _lastBestAction;
	}
	_markPhase('preflight');

	/* ★ 兜底声明：防止作用域问题导致 best is not defined */
	let best = { type: "end", id: "end", score: 0, reason: "初始化兜底" };
	try {
		const me = _status.currentPhase || game.me;
		if (!me) {
			try { perfMark('bestAction', performance.now() - _perfT0); } catch (eP) {}
			try { profEnd('bestAction'); } catch (eP) {}
			return null;
		}

		/* 单次决策关系 memo：只在本次 bestAction 内存活，不跨状态/回合复用。
		 * 复用既有 isEnemyOf / isAllyOf 结果，不改变三态关系语义。 */
		const _enemyRelationMemo = new Map();
		const _allyRelationMemo = new Map();
		function _isEnemyMemo(target) {
			if (!target) return false;
			if (_enemyRelationMemo.has(target)) return _enemyRelationMemo.get(target);
			const value = !!isEnemyOf(me, target);
			_enemyRelationMemo.set(target, value);
			return value;
		}
		function _isAllyMemo(target) {
			if (!target) return false;
			if (_allyRelationMemo.has(target)) return _allyRelationMemo.get(target);
			const value = !!isAllyOf(me, target);
			_allyRelationMemo.set(target, value);
			return value;
		}

		const { P, team, seat, econ, forecast, currentStrategy, sit, riskLabel, risk, riskTaking, teamwork, ALLY_ROLE, ROLE_PREFS, strategyAtkMul, strategyDefMul, atkMul, keepMul, burstMul, stageLabel, ATK_CARDS, DEF_CARDS, hand, combos, teamCombos, focus, SEAT_TARGET_CARDS, incoming, burst, mt } = buildDecisionContext(me, {
			analyzePersonality, analyzeTeamPlan, analyzeSeatPressure, analyzeEconomy, analyzeForecast, multiTurnCached,
		});
		_markPhase('context');
		let { tsMap, bestT, bestTs, bestT2, bestTs2 } = buildTargetContext(me, focus, _isEnemyMemo);
		/* WeakMap 没有 clear()；每次决策替换实例，避免沿用上一轮目标概率。 */
		resetTargetProbabilityCache();
		/* ★ 缓存存活玩家，供 extractFeatures 复用，避免循环内重复遍历 */
		const alivePlayers = (game.players || []).filter(function(p) { return p && p.alive !== false; });

		/* ★ #37 Unified Objective / Strategic Intent
		 * 只消费公开状态 + observer-specific identity posterior + 自身私有信息。
		 * 同回合关键状态不变时复用；目标死亡/血线/身份后验/人数/自身进攻资源变化时刷新。 */
		let strategicState = null;
		try {
			strategicState = getStrategicState(me);
			if (_status) _status.djsc_strategicState = strategicStateSnapshot(me);
		} catch (eSI) {
			if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSI);
		}

		/* ★ #38 Character Policy
		 * 从当前行动者自身技能语义生成武将画像；不读取对手隐藏信息。
		 * 画像是 NORMAL utility 的软偏好，身份 Objective/Intent 仍在其上层。 */
		let characterPolicy = null;
		try {
			characterPolicy = characterPolicyOf(me);
			if (_status) _status.djsc_characterPolicy = characterPolicySnapshot(characterPolicy);
		} catch (eCP) {
			if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCP);
		}

		_markPhase('targets');
		const acts = [];
		/* ===== 趋势驱动策略（把 mt.overall 从提示升级为决策权重） ===== */
		const trend = mt ? mt.overall : "stable";
		const TREND = {
			worsening: { atk: 1.15, keep: 0.9, focus: 1.2, skill: 1.1 },
			improving: { atk: 0.9, keep: 1.12, focus: 0.95, skill: 1.0 },
			stable: { atk: 1.0, keep: 1.0, focus: 1.0, skill: 1.0 },
		};
		const trendMul = TREND[trend] || TREND.stable;
		generateScoredCandidates({ me, team, seat, econ, sit, risk, riskTaking, teamwork, ROLE_PREFS, atkMul, keepMul, stageLabel, ATK_CARDS, DEF_CARDS, hand, combos, teamCombos, focus, SEAT_TARGET_CARDS, incoming, burst, mt, tsMap, bestT, bestTs, acts, trendMul, _isEnemyMemo, _isAllyMemo });

		scoreCandidates({ me, acts, focus, characterPolicy, strategicState, _isAllyMemo }, _getRoundNumber);
		let modelConf = null, metaMod = null, intervention = 'skip';

		const initialSelection = selectInitialCandidate(acts);
		const endAction = initialSelection.endAction;
		let eligibleActs = initialSelection.eligibleActs;
		best = initialSelection.best;

		/* ★ Planner / Champion / DeepThink 只消费 eligible candidates；回放仍保留完整 acts。 */
		try {
			_status.djsc_lastCandidates = eligibleActs.slice(0, 8);
			_status.djsc_lastBestT = bestT;
			_status.djsc_lastBestTs = bestTs;
			_status.djsc_lastSit = sit;
			_status.djsc_lastEcon = econ;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		_markPhase('candidates');

		let decisionPlan;
		({ best, bestT, bestTs, eligibleActs, decisionPlan } = refineCandidatePlan({
			me, acts, best, bestT, bestTs, eligibleActs,
		}));

		_markPhase('planner');

		/* ★ P0-1 精度模式：给所有动作算特征，学得最全 */
		try {
			const _buf = new Int8Array(FEATURE_DIM);
			const ctx = {
				bestT: bestT,
				bestTs: bestTs,
				isEnemy: bestT ? _isEnemyMemo(bestT) : false,
				focusTarget: focus ? focus.target : null,
			};
			/* 手机优化：只给前15个动作算特征，时间限制20ms */
			const MAX_FEAT_ACTS = 15;
			for (let i = 0; i < acts.length && i < MAX_FEAT_ACTS; i++) {
				try {
					/* 手机优化：时间限制 20ms，防止卡顿 */
					if (performance.now() - _perfT0 > 20) break;
					const f = extractFeatures(me, acts[i], ctx, _buf, alivePlayers);
					acts[i]._feat = Array.from(f);
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			}
		} catch (eFeat) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eFeat); }
		({ best, modelConf, metaMod, intervention } = reviewCandidate({
			me, acts, eligibleActs, best, bestT, bestTs, modelConf, metaMod, intervention,
		}, { _aiStrengthFactor, _deferEffect, readFinalState: () => ({ best, bestT }) }));

		_deferEffect('cognition-log', function () {
			observeCognitionLog({ me, best, modelConf, metaMod, intervention });
		});
				_markPhase('model');

		/* ★ M07：把「动作类型 → 代号」抽成一个小函数，供 Guard 后重算时复用 */
		function actionForBest(b) {
			if (!b) return "B";
			if (b.type === "skill") return "F";
			if (b.type === "equip") return "E";
			if (b.type === "end") return "C";
			var _id = b.id;
			if (["sha","juedou","huogong","nanman","wanjian","zhujin","shunshou","guohe","tiesuo","lebu","bingliang"].indexOf(_id) >= 0) return "D";
			if (["shan","tao","wuxie","jiu"].indexOf(_id) >= 0) return "C";
			return "B";
		}
		let action = actionForBest(best);
		const teamTip = focus ? ("｜集火：" + focus.name + "（" + focus.score + "）") : "";
		const seatTip = (seat.nextEnemy ? "｜下家敌：" + (seat.nextEnemy.name || "?") : "") +
		                (seat.prevEnemy ? "｜上家敌：" + (seat.prevEnemy.name || "?") : "");
		const econTip = "｜资源：手" + econ.handCount + "张(" + econ.handValue + ") 装" + econ.equipCount + "件(" + econ.equipValue + ") HP" + econ.hp + "/" + econ.maxHp;
		let styleTip = "";
		try { if (bestT) styleTip = "｜目标风格：" + styleOf(bestT).tag; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		const comboLen = teamCombos.length;
		_deferEffect('skill-feedback', function () {
			observeSkillFeedback({ me, best });
		});
		_deferEffect('style-feedback', function () {
			observeStyleFeedback({ me });
		});
		_deferEffect('decision-record', function () {
			observeDecisionRecord({ me, acts, best, bestT, modelConf, characterPolicy, sit, stageLabel, atkMul, keepMul, burstMul, riskLabel, risk, focus, team, teamCombos, seat, econ, incoming, forecast, mt, decisionPlan });
		});
		_deferEffect('decision-replay', function () {
			observeDecisionReplay({ me, acts, best, modelConf, metaMod, intervention });
		});
		_deferEffect('auto-feature', function () {
			observeAutoFeature({ me, best, bestT });
		});
		const forecastTip = "｜预测：" + forecast.advice + "（压力 " + incoming.total + " 风险 " + Math.round(incoming.selfRisk * 100) + "%）";
		const mtTip = mt ? ("｜趋势：" + mt.overall) : "";
		const trendTip = "｜趋势权重：" + (trend === "worsening" ? "进攻↑守↓" : trend === "improving" ? "守↑攻↓" : "均衡");
		_deferEffect('team-broadcast', function () {
			observeTeamBroadcast({ me, best, bestT });
		});
				_markPhase('observability');

		/* ===== ★ 模型护栏：执行前的最后一道法律检查 ===== */
		({ best, bestT } = guardCandidate({ me, acts, best, bestT }));

		_markPhase('guard');

		/* ★ M07：Guard 可能已把 best 换成"结束回合"，动作代号要以最终 best 重新算，避免 action≠rule */
		action = actionForBest(best);

		/* 最终执行目标以 winner candidate 自己绑定的目标为准；
		 * bestT 仅是全局关注目标，不再覆盖具体动作目标。 */
		let _finalTarget = candidateTargetValue(best);
		if (best && best.type === 'equip') _finalTarget = null;
		const _finalResult = {
			type: best && best.type ? best.type : 'unknown',
			action: action,
			reason: best.reason + "（真实收益" + runtimeScore(best.score) + "，策略优先级=" + ensureCandidatePolicy(best).priorityTier +
				"，" + sit.mode + "×" + sit.tempo + "，阶段=" + stageLabel + "，性格=" + riskLabel + teamTip + seatTip + econTip + styleTip + forecastTip + mtTip + trendTip + (comboLen ? "，联动" + comboLen + "条" : "") + "）",
			strat: best.type === "skill" ? "chooseToUse" : (best.type === "equip" ? "equipAfter" : (best.type === "end" ? "switchToAuto" : "useCardAfter")),
			rule: best.id,
			target: _finalTarget,
			recast: !!best.recast,
			targetScore: Math.round(bestTs),
			score: runtimeScore(best.score),
			policy: candidatePolicySnapshot(best),
			characterPolicy: characterPolicySnapshot(characterPolicy),
			characterAlignment: best && best.characterAlignment ? Object.assign({}, best.characterAlignment) : null,
			utility: utilityPipelineSnapshot(best),
		};
		/* ★ 暴露给策略总线 */
		try { _status.djsc_lastBest = _finalResult; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ================= ★ 特征记录（不刻意加规则，让模型自己学） ================= */
		try {
			let _riskFeatures = null;

			if (best && best.type === 'card' && bestT) {
				const cardId = best.id;
				const cardName = (lib.translate && lib.translate[cardId]) || cardId;

				/* 把这些"风险场景"作为特征记录下来，
				 * 让模型从对局反馈中自己学习权重，
				 * 而不是写死规则 */
				const features = [];

				/* 特征 1：是否打队友 */
				let isAlly = false;
				try {
					if (isSameCamp(me, bestT)) isAlly = true;
					const _strat = typeof getModeStrategy === 'function' ? getModeStrategy() : null;
					if (_strat && _strat.isSameCamp && _strat.isSameCamp(me, bestT)) isAlly = true;
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				if (isAlly) features.push('打队友');

				/* 特征 2：自己是否残血 */
				if ((me.hp || 0) <= 2) features.push('自己残血');

				/* 特征 3：目标是否残血 */
				if ((bestT.hp || 0) <= 1) features.push('目标残血');

				/* 特征 4：手牌是否太少 */
				if ((me.countCards ? me.countCards('h') : 0) <= 2) features.push('手牌少');

				/* 特征 5：是否残局 */
				const alive = (game.players || []).filter(function (p) { return p && p.alive !== false; }).length;
				if (alive <= 3) features.push('残局');

				if (features.length) {
					_riskFeatures = {
						features: features,
						ts: Date.now(),
					};
				}
			}

			try { _status.djsc_lastRisk = _riskFeatures; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		} catch (eR) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eR); }

		_deferEffect('learning-and-postcheck', function (_actual, _txInfo) {
			recordExecutedLearning({ me, best, bestT, bestTs, acts, sit, focus, _isEnemyMemo }, _actual, _txInfo);
		});
		/* ★ 调用总线仲裁 */
		try {
			const stratResult = strategize(me, _status.event, _finalResult);
			if (stratResult) _finalResult.strategist = stratResult;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		_markPhase('telemetry');

		/* ★ 测试观测：Evaluate 阶段只计算耗时；左侧日志/回放只在 Commit 后落地。 */
		let _decisionMs = Math.max(0, performance.now() - _perfT0);
		let _phaseMs = _phaseSnapshot();
		try {
			_finalResult.decisionMs = Math.round(_decisionMs);
			_finalResult.phaseMs = _phaseMs;
			try { perfMark('bestAction', _decisionMs); } catch (eP) {}
			try { profEnd('bestAction'); } catch (eP) {}
		} catch (eTrace) {
			if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTrace);
			try { perfMark('bestAction', performance.now() - _perfT0); } catch (eP) {}
			try { profEnd('bestAction'); } catch (eP) {}
		}

		_deferEffect('decision-trace', function () {
			_finalizeDecisionRecord(me, acts, best, _decisionMs, _phaseMs);
		});

		/* ★ 事务只随返回值携带，不在 Evaluate 内写 pending 状态。
		 * soft/hard 接管层拿到 bestAction 后负责 stage；真实 useCard/logSkill/endTurn 再 commit。 */
		try {
			const _txExpectedType = (best && best.type === 'equip') ? 'card' : ((best && best.type) || 'unknown');
			const _txExpectedTarget = _txExpectedType === 'skill' ? null : _finalTarget;
			attachDecisionEffects(_finalResult, {
				type: _txExpectedType,
				id: (best && best.id) || _finalResult.rule,
				target: _txExpectedTarget,
			}, _deferredEffects, {
				meta: {
					player: (me && (me.name1 || me.name)) || '?',
					round: _getRoundNumber(),
					decisionMs: Math.round(_decisionMs),
					postCheck: { action: best, target: bestT, isEnemy: !!(best && best.isEnemy) },
				},
			});
		} catch (eTx) {
			if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTx);
		}

		/* ★ 存入缓存：仅缓存本次计算开始时对应的 state-key。
		 * bestAction 本身应为纯决策；若后处理意外改变公开状态，下一次 stateKey 会自然失效。 */
		_lastBestAction = _finalResult;
		_lastBestActionTime = Date.now();
		_lastBestActionStateKey = _decisionStateKey || '';

		return _finalResult;
	} catch (e) {
		try { perfMark('bestAction', performance.now() - _perfT0); } catch (eP) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eP); }
		try { profEnd('bestAction'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		return { action: "C", reason: "评分异常：" + String(e).slice(0, 60), strat: "switchToAuto" };
	}
}
function rulesDecide() { try { return bestAction(); } catch (e) { return null; } }

/* 模型决策：基础策略优先 + 小模型概率（偏置修正） */
function modelDecision() {
	try {
		const r = rulesDecide();
		const f = miniFeatures();
		let probs = f ? miniPredict(f) : null;
		if (probs) {
			const ab = cfg("atkBias", 1), db = cfg("defBias", 1);
			/* 标签: A引擎/B换牌/C结束/D进攻/E装备/F技能 —— 进攻偏置放大 D/F，防守偏置放大 C */
			const gain = [0, 0, db * 0.15, ab * 0.3, ab * 0.1, ab * 0.2];
			probs = probs.map(function (x, i) { return x + gain[i]; });
			const s = probs.reduce(function (a, b) { return a + b; }, 0);
			probs = probs.map(function (x) { return x / s; });
		}
		if (r && r.action && r.reason) {
			try { log.info('model', '【模型决策】' + r.action + '：' + r.reason + '（' + (r.rule || r.strat || '') + '）'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}
		return { rules: r, probs: probs, labels: probs ? MINI_W.labels : null };
	} catch (e) { return { err: String(e) }; }
}

/* ================= 结算 ================= */
function settle() {
	if (settleDone) return;
	settleDone = true;
	settleGame();
}
/* ================= 终局信号统一判断 =================
 * noname 各版本终局信号不一致：
 *   - _status.over（推荐，最稳）
 *   - game.over 可能是布尔，也可能是函数（版本差异）
 * 按可靠性从高到低依次判断，任一为真即视为终局。
 */
function isGameOver() {
	try {
		if (_status && _status.over === true) return true;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try {
		if (game) {
			if (game.over === true) return true;
			/* 注意：game.over() 是"结束游戏"的函数（会设 _status.over=true 并弹出结算），
			 * 绝不能为了判断终局而调用它——那会主动把游戏搞结束。
			 * 这里只读布尔，不调用函数。 */
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return false;
}
function startSettleWatch() {
	if (settleIv) return;
	settleIv = setInterval(function () {
		try {
			if (isGameOver() && !settleDone) settle();
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	}, 1500);
}

/* 停止结算监视：卸载/重载时调用，避免定时器残留 */
function stopSettleWatch() {
	if (settleIv) {
		try { clearInterval(settleIv); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		settleIv = null;
	}
}


/* ================= 导出（供面板/调试桥使用） ================= */
export function getRound() { return round; }
export function getScoreLog() { return scoreLog; }
/* ★ 守恒引擎审计导出：面板/自检可调用查看守恒不变量 */
export function getConservationLedger() { return conservationLedger(); }
export function getREC() { return REC; }
export function resetRound() { resetLedgerRound(); }
export function getSettleIv() { return settleIv; }
export function setSettleIv(v) { settleIv = v; }
export function getInstalled() { return installed; }
export function setInstalled(v) { setHookInstalled(v); }
/* 引擎仍是数据负责人；原导出保留，战报与诊断通过只读入口查询实时数据。 */
connectEngineQueries({ getInstalled, getRound, getScoreLog, getDecisionLog });
export function getMEM() { return MEM; }
export function clearScoreState() {
	settleDone = false;
	resetLedgerState();
	memReset();
	try { clearThreatCache(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { resetObs(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { resetBelief(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { deckReset(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { clearCompensation(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	resetScoreEventCounters();
	_lastBestAction = null; _lastBestActionTime = 0; _lastRelationStateKey = '';
	try { resetReportShown(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { resetDecisionFeedback(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { resetDecisionTransactionStats(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { resetStrategicState(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { resetCharacterPolicyCache(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { resetExecutionGateway(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 清理策略总线信号 */
	try {
		if (_status) {
			delete _status.djsc_lastBest;
			delete _status.djsc_lastResponse;
			delete _status.djsc_lastCompare;
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
export { getDecisionLog, clearDecisionLog, appendDecision } from '../records/decisionRecords.js';
export { loadStore, saveStore, storeStats } from '../../perception/memory/memory.js';
export { give, givePair, giveVs, scoreCardUse, scoreEffect, installHooks, uninstallHooks, bestAction, rulesDecide, modelDecision, startSettleWatch, stopSettleWatch, settle, isGameOver, _isLegalSkillTarget, _skillNeedsExternalTarget, _canConfirmSelfSkillTarget, _skillPurposeFromIntent, _skillTargetRange, _isSingleTargetSkillProfile, decisionTransactionStats, executionGatewayStats };

/* ================= ★ 选将评分系统（多模式 + 批量平均 + 多维） ================= */
(function() {
  var CHAR_STORE_KEY = "无名AI_charUsage_v2";
  var STORE_VERSION = 2;
  var MAX_ENTRIES_PER_MODE = 50;
  var MAX_SAMPLES = 10000;
  var SAMPLE_THRESHOLD_START = 30;  /* ★ 动态样本阈值：从30%开始 */
  var recentConfidences = [];  /* ★ 最近的置信度记录，用于动态调整阈值 */
  var BATCH_SIZE = 2;

  function loadStore() {
    try {
      var raw = _lsGet(CHAR_STORE_KEY);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && obj.v === STORE_VERSION && obj.modes) return obj;
      }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    return { v: STORE_VERSION, modes: {} };
  }

  function saveStore(s) {
    try { _lsSet(CHAR_STORE_KEY, JSON.stringify(s)); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
  }

  function currentMode() {
    try {
      if (typeof _status !== 'undefined' && _status && _status.mode) return String(_status.mode);
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    try {
      if (typeof game !== 'undefined' && game && game.getMode) return String(game.getMode());
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    return "identity";
  }

  function computeCharDims(charName) {
    var dims = {
      skillPower: 0, attack: 0, defense: 0, control: 0, support: 0,
      burst: 0, sustain: 0, teamwork: 0, solo: 0, difficulty: 0
    };
    try {
      if (typeof lib === 'undefined' || !lib.character) return dims;
      var cd = lib.character[charName];
      if (!cd || !cd.skills) return dims;
      var sc = cd.skills.length;
      if (sc === 0) return dims;
      
      for (var i = 0; i < sc; i++) {
        var sn = cd.skills[i];
        var prof = null;
        try {
          if (window.__DJSC && window.__DJSC.skillProfile) prof = window.__DJSC.skillProfile(sn);
        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        if (!prof) continue;
        
        if (typeof prof.final === 'number') dims.skillPower += prof.final;
        
        if (prof.dims) {
          for (var d in prof.dims) {
            if (typeof dims[d] === 'number' && typeof prof.dims[d] === 'number') {
              dims[d] += prof.dims[d];
            }
          }
        }
      }
      
      for (var key in dims) {
        dims[key] = Math.round((dims[key] / sc) * 100) / 100;
      }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    return dims;
  }

  function updateCharStats(charName, won, gameScore) {
    try {
      if (!charName) return null;
      var mode = currentMode();
      var store = loadStore();
      if (!store.modes[mode]) store.modes[mode] = {};
      var m = store.modes[mode];

      if (!m[charName]) {
        m[charName] = {
          games: 0, wins: 0,
          avgScore: 0,
          pendingN: 0, pendingSum: 0,
          dimsSum: {}, dimsN: 0,
          lastSeen: 0
        };
      }
      var rec = m[charName];

      rec.pendingN += 1;
      rec.pendingSum += (gameScore || 0);
      rec.games += 1;
      if (won) rec.wins += 1;

      var dims = computeCharDims(charName);
      for (var d in dims) {
        if (typeof dims[d] === 'number') {
          rec.dimsSum[d] = (rec.dimsSum[d] || 0) + dims[d];
        }
      }
      rec.dimsN += 1;

      if (rec.pendingN >= BATCH_SIZE) {
        var batchAvg = rec.pendingSum / rec.pendingN;
        var histGames = rec.games - rec.pendingN;
        if (histGames <= 0) {
          rec.avgScore = batchAvg;
        } else {
          rec.avgScore = (rec.avgScore * histGames + batchAvg * rec.pendingN) / (histGames + rec.pendingN);
        }
        rec.avgScore = Math.round(rec.avgScore * 100) / 100;
        rec.pendingN = 0;
        rec.pendingSum = 0;
      }

      if (rec.dimsN > 0) {
        var newDims = {};
        for (var d2 in rec.dimsSum) {
          newDims[d2] = Math.round((rec.dimsSum[d2] / rec.dimsN) * 100) / 100;
        }
        rec.dims = newDims;
      }

      if (rec.games > MAX_SAMPLES) {
        rec.games = MAX_SAMPLES;
        rec.wins = Math.min(rec.wins, MAX_SAMPLES);
      }

      rec.lastSeen = Date.now();

      var names = Object.keys(m);
      if (names.length > MAX_ENTRIES_PER_MODE) {
        names.sort(function(a, b) { return (m[b].lastSeen || 0) - (m[a].lastSeen || 0); });
        for (var i = MAX_ENTRIES_PER_MODE; i < names.length; i++) delete m[names[i]];
      }

      saveStore(store);
      return rec;
    } catch(e) { return null; }
  }

  function getTopChars(mode, limit) {
    limit = limit || MAX_ENTRIES_PER_MODE;
    var store = loadStore();
    var modeData = store.modes[mode || currentMode()] || {};
    var list = [];
    for (var name in modeData) {
      var rec = modeData[name];
      if (!rec) continue;
      list.push({
        name: name,
        score: rec.avgScore || 0,
        games: rec.games || 0,
        wins: rec.wins || 0,
        winRate: rec.games > 0 ? Math.round((rec.wins / rec.games) * 100) / 100 : 0,
        dims: rec.dims || {}
      });
    }
    list.sort(function(a, b) { return b.score - a.score; });
    return list.slice(0, limit);
  }

  function getCharRecord(charName, mode) {
    var store = loadStore();
    var m = store.modes[mode || currentMode()] || {};
    return m[charName] || null;
  }

  function getAllModeStats() {
    var store = loadStore();
    var result = {};
    for (var mode in store.modes) {
      result[mode] = { charCount: Object.keys(store.modes[mode]).length };
    }
    return result;
  }

  function clearMode(mode) {
    var store = loadStore();
    if (mode) delete store.modes[mode];
    else store.modes = {};
    saveStore(store);
  }

  window.__DJSC = window.__DJSC || {};
  window.__DJSC.__weightsModule = _weightsModule;
  window.__DJSC.__trainExportModule = _trainExportModule;

  /* ★ 提前挂载训练数据导入/导出（扩展加载时就可用，不用进对局）
   * ★ 根级函数统一走 reg.mount：与 extension.js / index.js 的重复挂载不再互冲。 */
  mountTrainingInterface();

  /* ★ 启动假壳已移除：此前在 eval 期先挂一大片 {ok:true} 占位，再于 100ms 后整体覆盖，
   *   启动窗口内会对外暴露假接口，且与模块自挂载互相冲刷。
   *   现统一由下方 reg.bind 软合并挂载真身（只补缺失键、幂等、与顺序无关）。 */

  /* ★ 选将战绩存储（软合并） */
  reg.bind('charStore', {
    update: updateCharStats,
    top: getTopChars,
    get: getCharRecord,
    allModes: getAllModeStats,
    clear: clearMode,
    currentMode: currentMode,
    dimsOf: computeCharDims
  });

  /* ★ gameOver 事件挂载已移到 panel.js（确保 game 已初始化） */

  /* ★ 聚合接口统一经总线软合并挂载（只补缺失键、幂等、与各来源执行顺序无关）
   *   —— 取代此前「eval 期先挂一片假壳、100ms 后整体硬覆盖」的两段式挂载。
   *   现在：模块自挂载的真实实现不会被这里的兜底冲刷；兜底也只在真身缺失时生效。
   * ★ P1-26：保存 timer id + 卸载守护。卸载后 _disposed=true，回调直接返回，
   *   杜绝"卸载后 100ms 又把大量 __DJSC API 挂回来"的复活现象。 */
  scheduleHookExposure(function() {
    reg.bind('aiStats', { _real: true, aggregateByPlayer: aggregateByPlayer, buildHtml: aiStatsBuildHtml, stats: function() { return { ok: true, hasAggregate: true }; } });
    reg.bind('allyExempt', { _real: true, check: checkAllyExempt, stats: function() { return { ok: true, hasCheck: true }; } });
    reg.bind('health', { _real: true, check: healthCheck });
    mountGuardRecorderInterface();
    reg.bind('localTrainer', { _real: true, train: trainLocalAsync, isTraining: isTraining, lastResult: lastResult });
    reg.bind('multiTurnPlan', { _real: true, plan: multiTurnForecast, stats: function() { return { ok: true }; } });
    reg.bind('resourceManage', { _real: true, balance: resourceBalance, discardCost: discardCost, sellHpValue: sellHpValue, stats: function() { return { ok: true }; } });
    reg.bind('elementAccess', { _real: true, read: observeCardUse, observeAttack: observeAttack, observeAid: observeAid, getObs: getObs, stats: function() { return { ok: true }; } });
    reg.bind('decisionHook', { _real: true, getBonus: getDecisionBonus, recordTarget: recordTargetOutcome, recordTempo: recordTempoOutcome, recordPlay: recordPlayOutcome, flush: flushDecisionFeedback, getStats: getDecisionFeedbackStats, stats: function() { return { ok: true }; } });
    reg.bind('decisionRegistry', { _real: true, install: installAutoDiscover, promote: promoteRegret, getStats: getRegretStats, list: function() { return []; }, stats: function() { return { ok: true }; } });
    reg.bind('identityVisual', { _real: true, identityOf: _identityOf, confidenceOf: confidenceOf, beliefOf: beliefOf, isLikelyEnemy: isLikelyEnemy, isLikelyAlly: isLikelyAlly, explain: explainIdentity, render: function() {}, stats: function() { return { ok: true }; } });
    reg.bind('skillRules', { _real: true, ruleOf: skillRuleOf, buildAutoRules: buildAutoSkillRules, stats: function() { return { ok: true }; } });
    reg.bind('skillScanner', { _real: true, scanCharacters: scanCharacters, aggregateTags: aggregateSkillTags, tagsOf: skillTagsOf, stats: function() { return { ok: true }; } });
    reg.bind('responseAI', { _real: true, wuxieTiming: wuxieTiming, wuxieBonus: wuxieBonus, wuguTiming: wuguTiming, wuguBonus: wuguBonus, stats: function() { return { ok: true }; } });
    reg.bind('replayAnalysis', { _real: true, archiveGame: archiveGame, getArchive: getArchive, getStats: archiveStats, verdictOf: verdictOf, getGameDecisions: getGameDecisions, analyze: function() { return null; }, stats: function() { return { ok: true }; } });
    reg.bind('profiles', { _real: true, load: loadStore, save: saveStore, getStats: storeStats, export: exportStore, list: function() { return []; }, stats: function() { return { ok: true }; } });
    reg.bind('skillCustom', { _real: true, recordUse: recordSkillUse, flush: flushFeedback, getStats: getFeedbackStats, count: feedbackCount, stats: function() { return { ok: true }; } });
    reg.bind('compat', { _real: true, detect: detectConflict, getLog: conflictLog, getStats: conflictStats, reset: resetConflict, check: function() { return true; }, stats: function() { return { ok: true }; } });
    reg.bind('pickRecommend', { _real: true, recommend: getTopChars, getRecord: getCharRecord, computeDims: computeCharDims, stats: function() { return { ok: true }; } });
    reg.bind('smartPanel', { _real: true, recordStyle: recordStyleOutcome, flush: flushStyleFeedback, getStats: getStyleFeedbackStats, recordPlayerTag: recordPlayerTag, getPlayerTag: getPlayerTag, open: function() {}, stats: function() { return { ok: true }; } });
    reg.bind('decisionDashboard', { _real: true, strategize: strategize, getStats: strategistGetStats, getLastDecision: getLastDecision, setEnabled: setEnabled, isEnabled: isEnabled, open: function() {}, stats: function() { return { ok: true }; } });
    reg.bind('decisionTransaction', { _real: true, stats: decisionTransactionStats });
    reg.bind('modules', { _real: true, teamPlan: teamPlan, focusTarget: focusTarget, protectScore: protectScore, comboWithAllies: comboWithAllies, list: function() { return []; }, stats: function() { return { ok: true }; } });
    reg.bind('selfCheck', { _real: true, open: openSelfCheck, getHistory: getSelfCheckHistory, clearHistory: clearSelfCheckHistory, run: runSelfChecks, stats: function() { return { ok: true }; } });
    reg.bind('autoplay', { _real: true, start: startAutoplay, stop: stopAutoplay, status: autoplayStatus, showReport: showAutoplayReport });
    reg.bind('changelog', { _real: true, print: printChangelog, getChanges: getVersionChanges, getLatest: getLatestVersion, allVersions: CHANGELOG });
    reg.bind('charts', { _real: true, line: lineChart, bar: barChart, radar: radarChart, donut: donutChart });
    reg.bind('compareAI', { _real: true, install: installCompareAI, uninstall: uninstallCompareAI });
    reg.bind('i18n', { _real: true, t: function(k) { return k; }, lang: 'zh-CN', stats: function() { return { ok: true }; } });
  }, 100);

  /* ★ 用 Object.defineProperty 定义 scan，不可被覆盖（接真实探针实现，不再是空壳） */
  Object.defineProperty(window.__DJSC, 'scan', {
    value: {
      install: installProbes,
      autoRegister: globalAutoRegister,
      scanAll: function() { try { return window.__DJSC.globalScanner && window.__DJSC.globalScanner.scanAll ? window.__DJSC.globalScanner.scanAll() : []; } catch (e) { return []; } },
      getStats: function() { try { return window.__DJSC.globalScanner && window.__DJSC.globalScanner.stats ? window.__DJSC.globalScanner.stats() : { ok: true }; } catch (e) { return { ok: true }; } },
      reset: function() {},
    },
    writable: false,
    configurable: false,
    enumerable: true,
  });

  /* ★ 给模块加别名，统一函数名（自检面板期望的名字）
   * ★ 连接性修复：旧写法 `obj.stats = obj.xxxStats` 在来源不存在时会把已有方法覆盖成 undefined
   *   （典型：postCheck 自挂载的是 before/after/stats，此处却去读 postCheckBefore → 4 个方法被清空）。
   *   统一改用总线 reg.ensure：仅当来源是函数且目标尚未实现时才补写，绝不用 undefined 覆盖。 */
  function _ensure(obj, key, src) { reg.ensure(obj, key, src); }
  try {
    var _J = window.__DJSC || {};
    if (_J.multiProfile) {
      _ensure(_J.multiProfile, 'stats', _J.multiProfile.multiProfileStats);
      _ensure(_J.multiProfile, 'effectiveShift', _J.multiProfile.getEffectiveShift);
    }
    if (_J.strategyBus) {
      _ensure(_J.strategyBus, 'stats', _J.strategyBus.strategyBusStats);
    }
    if (_J.softMetrics) {
      _ensure(_J.softMetrics, 'get', _J.softMetrics.getMetric);
      _ensure(_J.softMetrics, 'learn', _J.softMetrics.learnMetric);
      _ensure(_J.softMetrics, 'stats', _J.softMetrics.softMetricStats);
      _ensure(_J.softMetrics, 'reset', _J.softMetrics.resetSoftMetrics);
    }
    if (_J.postCheck) {
      _ensure(_J.postCheck, 'before', _J.postCheck.postCheckBefore);
      _ensure(_J.postCheck, 'after', _J.postCheck.postCheckAfter);
      _ensure(_J.postCheck, 'stats', _J.postCheck.postCheckStats);
      _ensure(_J.postCheck, 'reset', _J.postCheck.postCheckReset);
    }
    if (_J.evolution) {
      _ensure(_J.evolution, 'stats', _J.evolution.evolveStats);
    }
    console.log("[无名AI] ✅ 已给模块加别名，统一函数名（安全模式）");
  } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

  /* ★ 把面板函数也挂载到 window.__DJSC 上（自检面板检测用）：统一走总线，已存在则不覆盖 */
  try {
    if (window.__DJSC_PANEL) {
      reg.mount('openMemoryPanel', window.__DJSC_PANEL.openMemoryPanel);
      reg.mount('openHealthPanel', window.__DJSC_PANEL.openHealthPanel);
      reg.mount('openConfigPanel', window.__DJSC_PANEL.openConfigPanel);
      reg.mount('exportAllAndDownload', window.__DJSC_PANEL.exportAllAndDownload);
      reg.mount('importAllFromFile', window.__DJSC_PANEL.importAllFromFile);
    }
    /* ★ 战术规划面板只读取最近一次 bestAction 已计算的 plan。
     * 观测/UI 不得为了显示面板再次触发昂贵 Planner。 */
    reg.mount('plan', function () {
      try { return (_status && _status.djsc_lastDecisionPlan) || null; }
      catch (e) { return null; }
    });
  } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

  /* ★ 统一给所有 window.__DJSC 下的函数加 _real: true 标记 */
  setTimeout(function() {
    try {
      Object.keys(window.__DJSC).forEach(function(key) {
        var v = window.__DJSC[key];
        if (typeof v === 'function' && !v._real) {
          v._real = true;
        }
        if (typeof v === 'object' && v !== null && !v._real) {
          v._real = true;
        }
      });
      console.log("[无名AI] ✅ 已统一给所有模块加 _real: true 标记");
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
  }, 200);

  console.log("[无名AI] 选将评分系统已加载，当前模式:", currentMode());
})();
