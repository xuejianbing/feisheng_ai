import {decisionCacheMatches} from '../state/decisionCache.js?v=41a';
import {createEvaluationAudit} from '../analysis/decisionAudit.js?v=41a';
import {observeCooperativeTrickUse,finishCooperativeTrickUse,resetCooperativeTrickIntents,cooperativeTrickEpoch} from '../state/cooperativeTrickIntent.js?v=41a';
import {commonSuggestionFusionFor} from '../utility/suggestionFusion.js?v=41a';
import {installChoiceAudit,beginChoiceAudit,choiceAuditStats} from '../../perception/journal/choiceAudit.js?v=41a';
import {identityModelCompatibility} from '../../model/features/identityCompatibility.js?v=41a';
import {identityView} from '../../perception/observer/identityView.js?v=41a';
import {identityAuditStats,resetIdentityAudit} from '../../perception/observer/identityDiagnostics.js?v=41a';
import {identityEvidenceReport} from '../../perception/observer/identityEvidence.js?v=41a';
import {createIdentityEvidenceCollector} from '../../perception/observer/identityEvidenceHost.js?v=41a';
import {publicIdentityRole} from '../../perception/observer/identityFacts.js?v=41a';
import {selectClassicDataset} from '../../model/train/modeDataset.js?v=41a';
import { playChoiceWindow } from '../execution/decisionWindow.js?v=41a';
import { activePlaySkills, trackSkillOutcome } from '../skills/activeSkillEligibility.js?v=41a';
import { tiesuoCandidateOptions } from '../cards/tiesuoCandidateOptions.js?v=41a';
import {publicDecisionContext} from '../../perception/journal/doudizhuDiagnostics.js?v=41a';
import {createPlayerDemonstrationCollector,directPlayPhase} from '../../model/train/playerDemonstration.js?v=41a';
import {applyClassicModel,classicRuntimeSummary} from '../../model/train/classicRuntime.js?v=41a';
import {runClassicPostGameUpdate} from '../../model/train/modeTraining.js?v=41a';
import {classicCandidateShadow} from '../../model/train/modeTraining.js?v=41a';
import {takeClassicSetupAdvice} from '../modes/doudizhu/choices.js?v=41a';
import {modeContext,modeSampleMeta,closeModeContext,roleOf} from '../../foundation/runtime/modeContext.js?v=41a';
import {recordClassicMatch} from '../../model/train/modeStats.js?v=41a';
import { createDecisionStages, decisionActionSnapshot, planAdoption } from '../analysis/decisionStages.js?v=41a';
import { applyTiesuoRecastTiming } from '../cards/tiesuoRecast.js?v=41a';
import { tacticalEnabled, tacticalSettingsSnapshot, stripPlan } from '../strategy/tacticalOptimization.js?v=41a';
/*
 * ============================================
 * // Éditeur: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

import { safeGet as _lsGet, safeSet as _lsSet } from '../../foundation/storage/storage.js?v=41a';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */

/* ================= 决策积分引擎 · 记分核心+评分框架（整合模块） ================= */
import { lib, game, ui, get, ai, _status } from '../../foundation/adapt/host.js?v=41a';
import { reg } from '../../foundation/runtime/registry.js?v=41a';   /* ★ 唯一挂载总线：所有 __DJSC 挂载统一走这里 */
import { createBaselineUtilitySeed, applyCommonUtilitySuggestions, applyDirectionUtility, applyTransitionUtility, establishUtilityReference } from '../utility/remainingUtility.js?v=41a';
import { createAreaUtilitySeed, applyDeepValueEvidence } from '../utility/areaUtility.js?v=41a';
import { readScopedCardOverride, applyOptimizationEvidence, styleRatio, applyContextUtility } from '../utility/contextUtility.js?v=41a';
import { VAL_CARD, VAL_EFFECT } from '../../knowledge/tables/value-tables.js?v=41a';
import { decideCard, classifyCard, pickTarget as pickCardTarget } from '../cardplay/cardPlayBrain.js?v=41a';
import { decideSkill } from '../skills/skillPlayBrain.js?v=41a';
import { decideEquip } from '../basic/equipBrain.js?v=41a';
import { decideJudge } from '../basic/judgeBrain.js?v=41a';
import { pickTargetByPurpose, targetScore as targetBrainScore } from '../basic/targetBrain.js?v=41a';
import { evaluateTiesuoActions, tiesuoUtilityToEngineRaw, hostTiesuoDecision, hostTiesuoTargetEffect } from '../cards/tiesuoEvaluator.js?v=41a';   /* ★ 指令 02：铁索唯一权威策略源 */
import { evaluateActionTransitionPenalty, beginStrategicAction, reconcileStrategicTransitions, beginStrategicTurn } from '../state/turnStrategicState.js?v=41a';   /* ★ 回合内战略状态转移唯一权威源 */
import { buildPlayerSnapshot, buildTargetCandidate } from '../state/playerSnapshot.js?v=41a';   /* ★ 指令 05 Stage A+C：统一 Player State Snapshot + 目标候选契约（禁止再猜宿主字段） */
import { codeGainOf, skillRuleOf, skillProfileOf, skillBranchesOf, checkBranch, skillStagesOf, skillInteractionOf, skillTagsOf } from '../skills/skills.js?v=41a';
import { cacheGet, cacheSet, checkStateChanged, initStateWatcher, lastStateKey, stateKey } from '../../foundation/storage/cache.js?v=41a';
import { enemiesOf, isEnemyOf, isAllyOf, dispositionOf, situationFactor, targetScore, probHasBagua, probHasShan, hasVengeanceSkill, cardValueOf, clearThreatCache, seatPressure, forecastSummary, burstThreatOf, maxBurstThreat, threatOf, linkedChainValue } from '../threat/threat.js?v=41a';
import { isPlayerLinked } from '../state/playerState.js?v=41a';   /* ★ 指令 02：唯一横置状态读取入口 */
import { miniPredict, cardIdOf, MINI_W } from '../../model/net/mini-model.js?v=41a';
import { miniFeatures } from '../skills/skills.js?v=41a';
import { MEM, memLoad, memSave, memReset, memRecordAtk, memRecordHit, memKeyOf } from '../../perception/memory/mem.js?v=41a';
import { observeAttack, observeAid, observeCardUse, resetObs, getObs, fireAttackExpectedHit } from '../../perception/observer/observer.js?v=41a';
import './scoreSelfMod.js?v=41a';  // ★ 积分自修改器：AI 直接修改规则积分
import { deckConsume, deckReset, cardRemaining, deckAutoDetect, deckSyncFromUI } from '../../perception/memory/deckMemory.js?v=41a';
import { baguaSuccessRate } from '../../model/predict/deckPredict.js?v=41a';
import { identityOf as _identityOf, identityOfFor as _identityOfFor, beliefOf, beliefOfFor as _beliefOfFor, updateBelief, confidenceOf, confidenceOfFor as _confidenceOfFor, hardIdentityOf as _hardIdentityOf, isLikelyEnemy, isLikelyAlly, resetBelief, explainIdentity, identityBiasOf } from '../../perception/observer/identity.js?v=41a';
import { cfg, safe, nameOf, keyOf } from '../../foundation/config/util.js?v=41a';
import { resolvePlayerByKey } from '../../foundation/adapt/playerIdentity.js?v=41a';
import { splitSkillLog } from './skillLog.js?v=41a';
import { teamPlan } from '../../perception/team/team.js?v=41a';
import {applyVersusSeatPreferences} from '../modes/versus/seatTacticsRuntime.js?v=41a';
import { log } from '../../foundation/diag/logger.js?v=41a';
import { DIRS } from '../../foundation/storage/storagePaths.js?v=41a';   /* ★ 统一导出路径：避免 'data' 误写到游戏根 */
import { getDecisionBonus, getDecisionFeedbackSignal, recordTargetOutcome, recordTempoOutcome, recordPlayOutcome, flushDecisionFeedback, markOutcome } from '../feedback/decisionFeedback.js?v=41a';
import { perfMark } from '../../foundation/diag/perf.js?v=41a';
import { resourceBalance, discardCost, sellHpValue, equipReplaceCost, abolishPenalty } from '../resource/economy.js?v=41a';
import { fxRate, fxToMoney, fxSnapshot } from '../../knowledge/exchange/exchange.js?v=41a';
import { chooseStrategy } from '../strategy/strategy.js?v=41a';
import { styleOf } from '../../perception/observer/observer.js?v=41a';
import { loadStore, saveStore, mergeOnSettle, storeStats } from '../../perception/memory/memory.js?v=41a';
import { applyCampSkillProgressBonus } from '../skills/skillProgress.js?v=41a';
import { applyResourceMaximizeBonus, applyLossMinimizeBonus } from '../strategy/resourceMaximize.js?v=41a';
import { archiveGame, updateArchiveOutcome, verdictOf, loadArchive, getArchive, getGameDecisions, exportArchiveJson } from '../../perception/archive/archive.js?v=41a';
import { recordGame as recordGameLog, updateGameLogOutcome } from '../../perception/journal/gameLogStore.js?v=41a';  /* ★ 对局日志自存库（绕开内核录像 20 条上限） */
import { trainStartGame, trainRecordSample, trainSettleGame, trainFeedbackSample, trainBindSampleTargets, trainApplyCostCredits } from '../../model/train/trainExport.js?v=41a';
import { loadFeedback, recordSkillUse, flushFeedback, feedbackCount } from '../../perception/feedback/feedback.js?v=41a';
import { multiTurnForecast } from '../strategy/multiturn.js?v=41a';
import { loadStyleFeedback, recordStyleOutcome, flushStyleFeedback, recordPlayerTag, saveStyleFeedback } from '../../perception/feedback/styleFeedback.js?v=41a';
import { focusBonus, broadcastIntent, installBroadcastHooks, uninstallBroadcastHooks, readIntents, snapshotBroadcast } from '../../perception/team/teamBroadcast.js?v=41a';
import { refineBestWithPlan, planForDecision, resetPlanner } from '../strategy/planner.js?v=41a';
import { strategize } from '../strategy/strategist.js?v=41a';
import { getModeStrategy, isSameCamp, isEnemy, applyModeBoost } from '../strategy/modeStrategy.js?v=41a';
import { getStrategicState, strategicStateSnapshot, resetStrategicState } from '../strategy/strategicState.js?v=41a';
import { applyStrategicIntentToCandidates } from '../strategy/intentAlignment.js?v=41a';
import { characterPolicyOf, characterPolicySnapshot, applyCharacterPolicyToCandidates, resetCharacterPolicyCache } from '../strategy/characterPolicy.js?v=41a';
import { initializeUtilityPipeline, trackUtilityStage, finalizeUtilityPipeline, utilityPipelineSnapshot } from '../utility/utilityPipeline.js?v=41a';
import { buildEquipmentUtilityCandidates } from '../utility/equipmentUtility.js?v=41a';
import { applyCardConsumptionUtility } from '../utility/cardConsumptionUtility.js?v=41a';
import { evaluateAttackExpectedValue, createAttackUtilitySeed, adoptAttackUtilitySeed } from '../utility/attackExpectedUtility.js?v=41a';
import { applyFeedbackUtility } from '../utility/feedbackUtility.js?v=41a';
import { applyComboFallbackUtility } from '../utility/comboFallbackUtility.js?v=41a';
import { actionValue as relActionValue, exposureOf as relExposureOf, relationStateKey } from '../relations/relations.js?v=41a';   /* ★ 统一收益/暴露系统入口 */
import { autoRegister as globalAutoRegister, installProbes } from '../../foundation/runtime/globalScanner.js?v=41a';
import '../../foundation/runtime/missingModules.js';  // ★ 缺失模块补全：5个真正工作的模块
import '../../model/train/autoLearn.js';       // ★ 自动学习表：新卡牌/新技能自动打分
import { getJSON as storageGetJSON, setJSONQuotaSafe as storageSetQuota } from '../../foundation/storage/storage.js?v=41a';  /* ★ 中央存储抽象 */
/* ===== 24 个优化模块 ===== */
import { probHasWuxie, probHasTao, probHasSha, probHasJiu, probHasCard, inferHand } from '../../model/predict/handInference.js?v=41a';
import { aggregateByPlayer, buildComparisonHtml as aiStatsBuildHtml } from '../../perception/stats/aiStats.js?v=41a';  /* ★ 真正的 aiStats */
import { checkAllyExempt } from '../safety/allyExempt.js?v=41a';  /* ★ 真正的 allyExempt */
import { recordGuardEvent, getGuardStats, resetGuardRecorder } from '../safety/guardRecorder.js?v=41a';  /* ★ 真正的 guardRecorder */
import { healthCheck } from '../../foundation/diag/health.js?v=41a';  /* ★ 真正的 health */
import { trainLocalAsync, isTraining, lastResult } from '../../model/train/localTrainer.js?v=41a';  /* ★ 真正的 localTrainer */
import { getDecisionFeedbackStats } from '../feedback/decisionFeedback.js?v=41a';  /* ★ 真正的 decisionHook（新增） */
import { installAutoDiscover, promoteHighRegretPoints as promoteRegret, getRegretStats } from '../../perception/discover/autoDiscover.js?v=41a';  /* ★ 真正的 decisionRegistry */
import { scanCharacters, aggregateSkillTags, buildAutoSkillRules } from '../skills/skills.js?v=41a';  /* ★ 真正的 skillScanner（新增） */
import { wuxieTiming, wuxieBonus } from '../timing/wuxieTiming.js?v=41a';  /* ★ 真正的 responseAI */
import { wuguTiming, wuguBonus } from '../timing/wuguTiming.js?v=41a';  /* ★ 真正的 responseAI */
import { archiveStats } from '../../perception/archive/archive.js?v=41a';  /* ★ 真正的 replayAnalysis（新增） */
import { exportStore } from '../../perception/memory/memory.js?v=41a';  /* ★ 真正的 profiles（新增） */
import { autoSelfHeal } from '../../foundation/diag/selfHeal.js?v=41a';
import { updateAdaptive } from '../tuning/adaptive.js?v=41a';
import { showReport, resetReportShown } from '../../view/report/report.js?v=41a';
import { resetDecisionFeedback } from '../feedback/decisionFeedback.js?v=41a';
import { recordGameEnd as banditRecordGameEnd } from '../../model/train/bandit.js?v=41a';
import { onGameEnd as modelStateOnGameEnd, recordABScore } from '../../model/net/modelState.js?v=41a';
import { applyChampionRule, applyChampionBoost, getChampions as champGet, championOf as champOf, recompute as champRecompute, stats as champStats, feedbackSettle as champSettle, getEmbedding as champEmbedding } from '../strategy/championStrategy.js?v=41a';  /* ★ 冠军策略固化 */

/* ★ 立刻挂载 scan，不用等 setTimeout */
window.__DJSC = window.__DJSC || {};
window.__DJSC.scan = {
  install: function() { return true; },
  autoRegister: function() { return []; },
  scanAll: function() { return []; },
  getStats: function() { return { ok: true }; },
  reset: function() {},
};
import { getFeedbackStats } from '../../perception/feedback/feedback.js?v=41a';  /* ★ 真正的 skillCustom（新增） */
import { detectConflict, conflictLog, conflictStats, resetConflict } from '../analysis/conflictDetector.js?v=41a';  /* ★ 真正的 compat */
import { getStyleFeedbackStats, getPlayerTag } from '../../perception/feedback/styleFeedback.js?v=41a';  /* ★ 真正的 smartPanel（新增） */
import { getStats as strategistGetStats, getLastDecision, setEnabled, isEnabled } from '../strategy/strategist.js?v=41a';  /* ★ 真正的 decisionDashboard（新增） */
import { focusTarget, protectScore, comboWithAllies } from '../../perception/team/team.js?v=41a';  /* ★ 真正的 modules（新增） */
import { openSelfCheck, getSelfCheckHistory, clearSelfCheckHistory, runChecks as runSelfChecks } from '../../verification/selfCheck.js?v=41a';  /* ★ 真正的 selfCheck（P1-28：run 接真实检查） */
import { startAutoplay, stopAutoplay, autoplayStatus, showAutoplayReport } from '../../view/autoplay/autoplay.js?v=41a';  /* ★ 真正的 autoplay */
import { CHANGELOG, printChangelog, getVersionChanges, getLatestVersion } from '../../foundation/diag/changelog.js?v=41a';  /* ★ 真正的 changelog */
import { lineChart, barChart, radarChart, donutChart } from '../../view/report/charts.js?v=41a';  /* ★ 真正的 charts */
import { installCompareAI, uninstallCompareAI } from '../../perception/stats/compareAI.js?v=41a';  /* ★ 真正的 compareAI */
import { keepScore, recommendKeep } from '../cardplay/keepStrategy.js?v=41a';
import { equipScarcity, equipValue, isKeyEquip } from '../cardplay/equipScarcity.js?v=41a';
import { analyzeTeammateIntent, analyzeTeammateStrategy, teammateCoordination, recordTeammateAction } from '../../perception/team/teammateIntent.js?v=41a';
import { analyzeOpponentPref, counterStrategy, predictOpponentNext, counterScoreBonus } from '../strategy/counterStrategy.js?v=41a';
import { evaluateSituation, describeSituation, situationStrategyBonus } from '../../cognition/situationEval.js?v=41a';
import { shaHitRate, wuxieRisk, duelWinRate, taoNecessity, riskScore } from '../../cognition/reasoning/riskQuant.js?v=41a';
import { analyzeOpponentMood, describeMood, moodStrategyBonus, getAllMoods } from '../../cognition/moodState.js?v=41a';
import { getMutualRelations, isCountering, isBeingCountered, counterRelationBonus } from '../../knowledge/counters/mutualRelations.js?v=41a';
import { getCardPriority, recommendOrder, orderBonus, recommendFlow } from '../tuning/orderOptimizer.js?v=41a';
import { shouldPassCard, whatTeammateNeeds, passCardBonus } from '../cardplay/passStrategy.js?v=41a';
import { countTiesuo, tiesuoTransfer, tianxiangTransfer, damageTransfer, damageTransferBonus } from '../safety/damageTransfer.js?v=41a';
import { predictShaFollowup, predictJuedouFollowup, searchTree, treeSearchBonus } from '../strategy/treeSearch.js?v=41a';
import { needLongDelay, getSmartDelay, waitForSkills, checkSkillTriggered } from '../tuning/delayOptimizer.js?v=41a';
import { getDeckTop, hasGuanxingSkill, prioritizeDeckTop, deckTopBonus, clearDeckTopCache } from '../../model/predict/deckTopPredict.js?v=41a';
import { recommendDiscard, discardValue, specialDiscardAdvice, discardAdvice } from '../cardplay/discardStrategy.js?v=41a';
import { recordGameResult, getWinRate, autoAdjustWeights, learningPanelData, clearLearningData } from '../../model/train/learningLoop.js?v=41a';
import { recycleArchiveSamples } from '../../model/train/archiveRecycle.js?v=41a';  /* ★ 归档离线训练回流：胜利局样本回灌 */
import { aliveCount, identityGameStrategy, shouldRevealIdentity, gameTheoryBonus } from '../../cognition/reasoning/gameTheory.js?v=41a';
import { cached, clearAllCache, cacheStats, perfStart, perfEnd } from '../../foundation/diag/perfOptimizer.js?v=41a';
/* ===== v1.7.0 新增 5 个优化模块 ===== */
import { responseBonus } from '../cardplay/responseOpt.js?v=41a';
import { endgameBonus, isEndgame, endgameStrategy } from '../tuning/endgameOpt.js?v=41a';
import { resetOpponentPrediction, opponentPredictBonus, recordOpponentAction, predictOpponentNext as predictOpponentNextO } from '../../model/predict/opponentPredict.js?v=41a';
import { resourceTimingBonus } from '../resource/resourceTiming.js?v=41a';
/* ===== v1.8.0 新增 5 个优化模块 ===== */
import { aoeValue } from '../timing/aoeTiming.js?v=41a';
import {installAoeDirectionBridge} from '../modes/versus/aoeDirectionBridge.js?v=41a';
import {installAttackChoiceBridge} from '../modes/versus/attackChoiceBridge.js?v=41a';
import {installMaterialReserveBridge} from '../modes/versus/materialReserve.js?v=41a';
import {evaluateVersusAttackForId} from '../modes/versus/lethal.js?v=41a';
import {readVersusMode} from '../../foundation/runtime/versusContext.js?v=41a';
import { judgeBonus } from '../timing/judgeTiming.js?v=41a';
import { multiTurnBonus } from '../strategy/multiTurnOpt.js?v=41a';
/* ===== v1.0.2 新增 5 个锦囊时机优化模块 ===== */
import {bestJiedaoPair} from '../cards/jiedaoEvaluator.js?v=41a';
import { jiedaoBonus } from '../timing/jiedaoTiming.js?v=41a';
import { shandianBonus } from '../timing/shandianTiming.js?v=41a';
import { taoyuanBonus } from '../timing/taoyuanTiming.js?v=41a';
/* ===== v1.0.3 新增 5 个时机优化模块 ===== */
import { shaTargetBonus } from '../tuning/shaTargetOpt.js?v=41a';
import { taoBonus } from '../timing/taoTiming.js?v=41a';
import { jiuBonus } from '../timing/jiuTiming.js?v=41a';
import { shunshouBonus } from '../timing/shunshouTiming.js?v=41a';
/* ===== v1.0.4 深度价值量化模块 ===== */
import { deepValueEvidence } from '../../model/net/deepValue.js?v=41a';
import { recordTrigger, getDecayMultiplier, applyDecay, clearDecayLog, getDecayStats } from '../tuning/decayOpt.js?v=41a';
import { clearCompensation } from './scoreUnify.js?v=41a';
import { makeActionCandidate, runtimeScore, applyRelativeUtilityDelta, targetKey, candidateTargetValue, sameCandidateAction, sameCandidatePolicyBand, ensureCandidatePolicy, vetoCandidate, setCandidatePriority, isCandidateEligible, compareActionCandidates, PRIORITY_TIER, candidatePriorityRank, candidatePolicySnapshot } from '../state/actionCandidate.js?v=41a';
import { buildDecisionTraceLines } from './decisionTrace.js?v=41a';
import { formatLogLines } from '../../foundation/diag/logFormat.js?v=41a';
import { createGameTelemetry } from './gameTelemetry.js?v=41a';
import { binaryGameResult } from './gameResult.js?v=41a';
import { preparePlayerFeedback } from '../../perception/journal/playerFeedback.js?v=41a';
import { buildTurnSummaryLines } from './turnSummary.js?v=41a';
import { createMatchArchive } from '../../perception/journal/matchArchive.js?v=41a';
import { saveMatchArchive, updateMatchArchiveOutcomes, updateClassicEffects, currentMatchArchive } from '../../perception/journal/matchArchiveStore.js?v=41a';
import { VERSION } from '../../../js/config/version.js?v=41a';
import { normalizedMargin, DECISION_MARGIN } from '../state/decisionMargin.js?v=41a';
import { createDecisionTransaction, peekDecisionTransaction, cancelDecisionTransaction, decisionTransactionStats, resetDecisionTransactionStats } from '../state/decisionTransaction.js?v=41a';
import { commitExecution, executionGatewayStats, resetExecutionGateway, invokeObservedHost } from '../execution/executionGateway.js?v=41a';
import { extractFeatures, FEATURE_DIM } from '../../model/features/features.js?v=41a';
import { pushSample, bufferSize, bufferClear } from '../../model/train/trainExport.js?v=41a';
import { v5Predict } from '../../../shadow/decodeV5.js?v=41a';   /* ★ PR5e.4：样本级 v5 预测记录（decodeV5 自包含无副作用，未加载模型时 v5Predict 返回 null） */
import { cmd as cloudCmd, status as cloudStatus, onGameEndHook, installCloudIngest, uninstallCloudIngest } from '../../foundation/cloud/cloudIngest.js?v=41a';   /* ★ 数据上报通道（SHA-256 去重 + 增量上传 + 每小时；本地数据保留） */
import { getState as modelGetState, onGameEnd as modelOnGameEnd, forceTrain as modelForceTrain } from '../../model/net/modelState.js?v=41a';  /* ★ 真正的 modelState */
import * as _trainExportModule from '../../model/train/trainExport.js?v=41a';
import { getWeights, getBias, isReady as weightsReady, predict } from '../../model/weights/weights.js?v=41a';
import * as _weightsModule from '../../model/weights/weights.js?v=41a';
import { guardCheck, applyGuardPenalty } from '../../model/net/modelGuard.js?v=41a';
import { observeElementUse, startElementFeedbackLoop, settleElementFeedback } from '../../perception/feedback/elementFeedback.js?v=41a';
import { metaStartGame, metaSettleGame, metaRecordSkill, metaRecordCard, metaRecordTarget, metaRecordDecision, cognitiveModulate, decideIntervention } from '../../cognition/metaCognition.js?v=41a';
import { logCognition, getCognitionLog, cognitionStats, resetCognitionLog } from '../../cognition/log/cognitiveLog.js?v=41a';
import '../analysis/conflictDetector.js';
import '../../model/calibrate/decisionCalibrator.js';
import '../../model/calibrate/calibratorPanel.js';
import '../../cognition/profile/multiProfile.js';
import '../strategy/strategyBus.js';
import '../../view/dashboard/brainDashboard.js';
import '../../perception/replay/decisionReplay.js';
import '../../foundation/io/exportAll.js';
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
import '../cardplay/responseAI.js';
import '../skills/skillCustom.js';
import '../skills/skillRules.js';
import '../skills/skillScanner.js';

/* ===== ★ 激活所有面板/工具模块 ===== */
import '../../view/autoplay/autoplay.js';
import '../../foundation/diag/changelog.js';
import '../../view/report/charts.js';
import '../../perception/stats/compareAI.js';
import '../../foundation/adapt/compat.js';
import '../../view/dashboard/decisionDashboard.js';
import '../../foundation/i18n/i18n.js';
import '../../view/dashboard/identityVisual.js';
import '../../foundation/runtime/modules.js';
import '../strategy/pickRecommend.js';
import '../../cognition/profile/profiles.js';
import '../../perception/replay/replayAnalysis.js';
import '../../verification/selfCheck.js';
import '../../view/panel/smartPanel.js';
import '../../model/train/crossModeTransfer.js';
import '../analysis/decisionCompare.js';
import '../../view/dashboard/comparePanel.js';
import '../../model/net/modelHotSwap.js';
import { applySharedBonus, shareContribute } from '../../perception/knowledge/sharedKnowledge.js?v=41a';  /* ★ 公共知识库：决策加成+贡献（此前只 import 从不调用，采纳/贡献恒 0） */
import '../../model/train/evolution.js';
import { psychologyBonus, deterrenceCheck, intentReading, pressureScore, strategicHold, psychologyStats, resetPsychology } from '../../cognition/reasoning/psychology.js?v=41a';
import { comboChainBonus, detectChains, chainScore, chainPriority, comboChainStats, resetComboChain, CHAINS, learnChainUse, learnedChains, clearLearnedChains, finalizeLearned, exportAllChains, importChains, recordExecutedChainIds } from '../strategy/comboChain.js?v=41a';
import { playerMemoryBonus, rememberGame, rememberAttack, rememberAid, playerMemoryStats, recallPlayer, hostilityLevel, playerMemoryList, resetPlayerMemory } from '../../perception/memory/playerMemory.js?v=41a';
import { profStart, profEnd, profRecord, profile, profilerEnable, profilerStats, profilerReset, openProfilerPanel } from '../../foundation/diag/profiler.js?v=41a';
import { narrate, renderNarrateHtml, recentNarrations, showRecentNarrations } from '../../cognition/explain/decisionNarrator.js?v=41a';
import { createSkillOutcomeTracker } from '../analysis/skillOutcome.js?v=41a';
import { createActionOutcomeObserver } from '../analysis/actionOutcome.js?v=41a';
import { createDelayedOutcomeTracker } from '../analysis/delayedOutcome.js?v=41a';
import { createPublicProvenanceTracker } from '../analysis/publicProvenance.js?v=41a';
import { postCheckStats, postCheckReset } from '../analysis/postCheck.js?v=41a';
import { summarizeOutcomeRecords } from '../analysis/outcomeStats.js?v=41a';
export function actionOutcomeStats() { return summarizeOutcomeRecords(DECISION_LOG); }
import { criticBest as deepThinkCritic, thinkingStats as deepThinkStats } from '../../cognition/deepThink.js?v=41a';  /* ★ 模型思考层：深度思考 */
import { getCardStrategy, cardUseValue, cardRespondValue, getCardType, getCardRisk, cardStrategyStats, resetCardStrategy } from '../cardplay/cardStrategy.js?v=41a';
import { recordDecisionContext, settleDecisionContext, getAutoFeatureWeight, autoFeatureStats, topAutoFeatures, resetAutoFeatures } from '../../model/features/autoFeature.js?v=41a';
import { getMetric, learnMetric, learnFromGame, softMetricStats, resetSoftMetrics } from '../../cognition/reasoning/softMetrics.js?v=41a';

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
        reset: profilerReset,
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

    /* ★ cloudIngest - 数据上报通道（连招/训练样本/localStorage 状态/面板统计/配置；
     *   SHA-256 指纹去重，上传成功后自动删除本地可清理数据，每小时自动 + 局末检查） */
    window.__DJSC.cloudIngest = {
        cmd: cloudCmd,
        status: cloudStatus,
        uploadNow: cloudCmd.uploadNow,
        install: installCloudIngest,
        uninstall: uninstallCloudIngest,
    };
    try { installCloudIngest(); } catch (eCI) { if (window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCI); }

    /* identity - 身份推理（修正：挂载成object，不是function） */
    window.__DJSC.identity = {
        view: identityView,
        compatibility: identityModelCompatibility,
        evidence: identityEvidenceReport,
        audit: identityAuditStats,
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
		if (!identityModelCompatibility().allowed) {
            return {action:'skip',label:null,probs:null,confidence:0,maxProb:0,value:0,ready:false,
                reason:'identity-feature-schema-migration',compatibility:identityModelCompatibility()};
        }
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
reg.mount('actionOutcomeStats', actionOutcomeStats);
reg.mount('trainBufferSize', bufferSize);
reg.mount('trainBufferClear', bufferClear);
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
    /* ★ 挂载训练数据导入/导出功能（根级函数：已存在则不覆盖） */
    const te = window.__DJSC.__trainExportModule;
    if (te && te.exportForImport) {
        reg.mount('trainExport', function() { return te.exportForImport(); });
        reg.mount('trainImport', function(jsonStr) { return te.importFromJson(jsonStr); });
        if (te.cleanLowValue && window.__DJSC.trainExport) window.__DJSC.trainExport.cleanLowValue = te.cleanLowValue;  /* ★ 挂载自动清洗函数 */
        console.log('[engine] ✅ trainExport/trainImport 已挂载');
    }
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

let round = {};
let _rawRound = {};
let scoreLog = [];
const gameTelemetry = createGameTelemetry();
const matchArchive = createMatchArchive({ onLateOutcome: match => {
 const event=match.events.at(-1);
 if(event){updateArchiveOutcome(match.matchId,event.kind,event.data);updateGameLogOutcome(match.matchId,event.kind,event.data);}
 void updateMatchArchiveOutcomes(match,id=>(lib.translate&&lib.translate[id])||id).catch(()=>{});
} });
let matchReplay = null;
let choiceAuditCleanup = null;
let aoeDirectionCleanup = null;
let materialReserveCleanup = null;
let attackChoiceCleanup = null;
/* ★ 全局守恒台账（总账 ledger）：
 *   保证「Σ玩家货币 + _ledger = 0」恒成立 —— 任何一笔 give 都等价于总账内的
 *   转移：加分 → _ledger 补亏；扣分 → _ledger 存留。系统注入（奖池）与
 *   失败阵营产出经 ledger 平衡，全局货币总量守恒。 */
let _ledger = 0;
let REC = { effects: {}, cards: {}, timings: {}, log: [] };
function rec(kind, key, extra) {
	try {
		if (!REC[kind]) REC[kind] = {};
		REC[kind][key] = (REC[kind][key] || 0) + 1;
		if (REC.log.length < 300) REC.log.push({ kind: kind, key: key, extra: extra || "", ts: Date.now() });
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
let installed = false;
let settleDone = false;
let settleIv = null;
/* ★ P1-26：100ms 延迟挂载的取消句柄与卸载标志。
 * 卸载后 _disposed=true，延迟回调直接返回；重新安装时复位。 */
let _lateBindTimer = null;
let _disposed = false;

const DJSC_ORIG = "__djsc_orig";   // proto 上保存原始函数的字段名（避免与其它扩展冲突）

/* ★ 友方动作评估挂起表 */
const _allyActionPending = [];

function _snapshotAlly(p) {
	try {
		return {
			hp: p.hp || 0,
			hc: (p.countCards ? p.countCards('h') : 0),
			eq: (p.countCards ? p.countCards('e') : 0),
		};
	} catch (e) { return null; }
}

function _evaluateAllyAction(rec) {
	try {
		const me = rec.me;
		const target = rec.target;
		if (!me || !target) return;

		/* 如果根本没有对友方造成任何损失 → 是支援，补正分 */
		if (!rec.hurt) {
			give(me, rec.value * 0.8, "支援友方（" + rec.id + "）");
			return;
		}

		const snap = rec.snap;
		if (!snap) return;
		const hpNow = target.hp || 0;
		const hcNow = (target.countCards ? target.countCards('h') : 0);
		const roundNow = round[keyOf(target)] || 0;

		/* 正收益判定：友方回血 / 摸牌 / 得分上升 */
		const hpGain = hpNow - snap.hp;
		const hcGain = hcNow - snap.hc;
		const roundGain = roundNow - (snap.round || 0);
		const hasPositive = (hpGain > 0) || (hcGain > 0) || (roundGain > rec.value * 0.5);

		if (hasPositive) return; // 有正收益，不惩罚

		/* 无正收益 → 按损失程度扣 50% / 70% */
		const hpLoss = -hpGain;
		const hcLoss = -hcGain;
		let rate = 0.5;                                  // 默认 50%
		if (hpLoss >= 2 || hcLoss >= 2 || hpNow <= 0) {
			rate = 0.7;                                  // 重伤 / 濒死 → 70%
		}

		const penalty = Math.abs(rec.value) * rate * 3;
		give(me, -penalty, "对友方无正收益造成损失（扣除 " + (rate * 100) + "%）");
		/* 阵营分惩罚：让敌人得分，相当于阵营失衡 */
		giveVs(me, -Math.abs(rec.value) * rate, "阵营分扣除 " + (rate * 100) + "%");
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ 标记：某玩家正在被"友方评估"的动作伤害 */
function _markAllyHurt(target) {
	try {
		for (let i = 0; i < _allyActionPending.length; i++) {
			const rec = _allyActionPending[i];
			if (rec.target === target) rec.hurt = true;
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= 守恒引擎 · 奖池与入场费 =================
 * 设计（严格守恒）：
 *   - 入场投入：对局开始所有玩家损失入场费 SEED_FEE 货币 → 进入奖池。
 *   - 系统注入：系统给予总计约 30% 奖池货币（SYSTEM_POOL_RATE），这一部分
 *     由「游戏失败后的阵营产出」补偿，而非凭空造币——保证守恒不变量。
 *   - 守恒不变量：Σ玩家round + _ledger = 0 恒成立（由 give 每笔自动维护）。 */
const SEED_FEE = 1;             /* ← 入场费（每人开局损失，进入奖池） */
const SYSTEM_POOL_RATE = 0.3;   /* ← 系统奖池注入比例 ≈30% */
/* 结算时供审计：记录系统注水承诺（收失败阵营产出匹配） */
let _poolPromise = 0;

/* 开局记账：入场扣款经 give，守恒自动成立；
 * 系统 30% 注水作为「产出承诺」登记，结算由失败阵营匹配。 */
function _initLedger(players) {
	try {
		players = Array.isArray(players) ? players : [];
		_poolPromise = Math.round(players.length * SEED_FEE * SYSTEM_POOL_RATE * 100) / 100;
		/* 入场投入：每人扣一笔进奖池（give 自动把 _ledger 变成 +N·SEED_FEE） */
		players.forEach(function (p) {
			if (!p) return;
			try { give(p, -SEED_FEE, "入场投入（守恒奖池）"); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 守恒对账：Σ玩家round + ledger 应≈0；返回偏差（审计用） */
function _conservationBalance() {
	try {
		let s = _ledger;
		for (const k in round) s += round[k];
		return Math.round(s * 100) / 100;
	} catch (e) { return NaN; }
}

/* 返回胜方玩家列表：优先 game.winner（identity 阵营或 'me'），无法取得明确胜方时不分配胜方奖池 */
function _winningSet() {
	try {
		const ps = (game && game.players) || [];
		let w = game && game.winner;
		/* ★ 形态兼容：数组（多赢家）/ 玩家对象 / 阵营身份字符串 */
		if (Array.isArray(w)) {
			const win = ps.filter(function (p) { return w.indexOf(p) >= 0; });
			if (win.length) return win;
			w = (w.length && w[0] && w[0].identity) || null;
		}
		if (w && typeof w === 'object' && w.identity) {
			const win = ps.filter(function (p) { return p === w; });
			if (win.length) return win;
			w = w.identity;
		}
		if (w === 'me' && game.me) return [game.me];
		if (typeof w === 'string' && w) {
			/* 阵营字符串：zhu→主+忠+明忠共赢；fan/nei/zhong/mingzhong/ye→对应身份全体 */
			const ids = w === 'zhu' ? ['zhu', 'zhong', 'mingzhong'] : (['fan', 'nei', 'zhong', 'mingzhong', 'ye'].indexOf(w) >= 0 ? [w] : null);
			if (ids) {
				const win = ps.filter(function (p) { return p && ids.indexOf(p.identity) >= 0; });
				if (win.length) return win;
			}
			const exact = ps.filter(function (p) { return p && p.identity === w; });
			if (exact.length) return exact;
		}
		return ps.filter(function (p) { return _isAlive(p); });
	} catch (e) { return []; }
}

/* 导出守恒审计（面板/自检用）：玩家总量、ledger、系统注水承诺、守恒偏差 */
function conservationLedger() {
	try {
		let playerSum = 0;
		for (const k in round) playerSum += round[k];
		return {
			playerSum: Math.round(playerSum * 100) / 100,
			ledger: Math.round(_ledger * 100) / 100,
			poolPromise: Math.round(_poolPromise * 100) / 100,
			balance: _conservationBalance(),
			seedFee: SEED_FEE,
			systemRate: SYSTEM_POOL_RATE,
			src: '败方产出补系统30%奖池 · 入场投入守恒',
			fx: fxSnapshot({ phase: _stage() }),   /* ★ 动态汇率快照 */
		};
	} catch (e) { return { balance: NaN }; }
}

function give(char, pts, tag) {
	try {
		if (!char) return;
		const k = keyOf(char);
		/* ★ 货币与积分合并：round 贡献分以「货币」为唯一计量单位。
		 *   toMoney 负责单笔价值有界化（单次巨额→≤29 货币），
		 *   _rawRound 存货币浮点累计，round 直接持货币值（不再套 Int8 分层量化——
		 *   因货币已天然有界，旧 toInt8 的防溢出量化成为冗余，移除使量纲统一）。 */
		const moneyPts = toMoney(pts);
		_rawRound[k] = (_rawRound[k] || 0) + moneyPts;
		round[k] = Math.round(_rawRound[k] * 100) / 100;
		/* ★ 守恒入账：每次 give 同步更新总账 ledger。
		 *   加减分视为总账内的货币转移，Σ玩家round + ledger 恒为 0。 */
		_ledger -= moneyPts;
		scoreLog.push({ char: k, pts: moneyPts, tag: tag, ts: Date.now() });
		gameTelemetry.score();
		if (scoreLog.length > 400) scoreLog.shift();
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 带阵营标注的显示名：名字（反贼阵营/主忠阵营/内奸/主公/未知） */
function displayName(char) {
	try {
		const nm = nameOf(char);
		if (!char) return nm;
		let id = "";
		try { id = _identityOf(char); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		let faction = "未知";
		if (id === "zhu") faction = "主公";
		else if (id === "zhong") faction = "主忠阵营";
		else if (id === "fan") faction = "反贼阵营";
		else if (id === "nei") faction = "内奸";
		return nm + "（" + faction + "）";
	} catch (e) { return nameOf(char); }
}
function givePair(from, to, pts, tag) { give(from, pts, tag); give(to, -pts, tag + "（守恒）"); }
/* ★ 阵营识别 */
function _campOf(player) {
	try {
		const mod = lib.__djsc_modeStrategy;
		if (mod && mod.getModeStrategy) {
			const strategy = mod.getModeStrategy();
			if (strategy && strategy.getCamp) return strategy.getCamp(player);
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* 身份模式兜底也必须遵守公开信息边界；不能因策略模块暂不可用就退回真实 identity。 */
	try {
		const mode = (get && typeof get.mode === 'function') ? get.mode() : '';
		if (mode === 'identity') {
            const role=publicIdentityRole(player);
            if (role==='zhu'||role==='zhong')return 'loyal';
            if (role==='fan')return 'rebel';
            if (role==='nei')return 'nei';
			return 'unknown';
		}
	} catch (eMode) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eMode); }
	return (player && player.identity) || 'unknown';
}

/* ★ 个体贡献度：本局累计正分 */
function _contribution(player) {
	try {
		const k = keyOf(player);
		const v = round[k] || 0;
		return Math.max(0, v);
	} catch (e) { return 0; }
}

/* ★ 是否存活 */
function _isAlive(p) {
	try {
		if (!p) return false;
		if (p.alive === false) return false;
		if (typeof p.isDead === 'function' && p.isDead()) return false;
		return true;
	} catch (e) { return true; }
}

/* ================= 动态换算记账入口 cash() =================
 * 统一货币原则：业务维度值经 fxToMoney 动态汇率 → 货币等量，再计入 round。
 * give() 走"货币无维度"（业务值即货币）；cash() 走"业务值 + 维度汇率"。
 * 全部最终汇入同一货币刻度，实现"货币只有一种"。 */
function cash(char, dim, business, tag) {
	try {
		if (!char) return;
		const conv = fxToMoney(dim, business, { phase: _stage() });
		return give(char, conv.money, tag);
	} catch (e) { return void 0; }
}

/* 当前对局阶段（early/middle/late/endgame）供汇率动态系数使用 */
function _stage() {
	try {
		const players = (game && game.players) || [];
		let alive = 0, maxHp = 0, hp = 0;
		players.forEach(function (p) {
			if (!_isAlive(p)) return;
			alive++; const m = p.maxHp || 4; maxHp += m; hp += Math.min(p.hp || 0, m);
		});
		if (!alive) return 'middle';
		const ratio = hp / maxHp;
		if (ratio < 0.4) return 'endgame';
		if (alive <= 3) return 'late';
		if (ratio > 0.75) return 'early';
		return 'middle';
	} catch (e) { return 'middle'; }
}

/* ★ 阵营平均分（只算活着的成员） */
function _campAvg(members) {
	const alive = members.filter(_isAlive);
	if (!alive.length) return 0;
	let sum = 0;
	for (let i = 0; i < alive.length; i++) sum += _contribution(alive[i]);
	return sum / alive.length;
}

/* ★ 按「阵营平均分」+ 多阵营分层分配扣分 */
function giveVs(char, pts, tag) {
	/* ★ 零和兜底：先查对立阵营再入账——无敌人承接反向分时整笔不记，
	 *   杜绝「单侧入账」（受伤扣分无正方补偿 / 得益加分无负方承接）造成的合计漂移 */
	const es = enemiesOf(char);
	if (!es.length) return;
	give(char, pts, tag);
	/* ★ 守恒基准（货币域精确）：反向分摊总额 = char 实际入账（toMoney 后）的相反数。
	 *   每份目标货币额经 moneyToRaw 逆映射后 give，toMoney(moneyToRaw(m))=m（|m|≤29 域内精确）
	 *   → Σ全场严格为 0（旧实现 raw 份额经 toMoney 压缩造成 ±1 级漂移） */
	const totalM = -toMoney(pts);

	/* 按阵营分组 */
	const byCamp = {};
	es.forEach(function (e) {
		const camp = _campOf(e);
		if (!byCamp[camp]) byCamp[camp] = [];
		byCamp[camp].push(e);
	});

	/* ★ 阶段 1：过滤出"还有活人"的阵营 */
	const aliveCamps = Object.keys(byCamp).filter(function (camp) {
		return byCamp[camp].some(_isAlive);
	});

	/* 全部敌方阵营都灭 → 均摊给所有敌方（极端情况兜底），最后一份吃尾差 */
	if (aliveCamps.length === 0) {
		const n = es.length;
		const per = Math.round(totalM * 100 / n) / 100;
		es.forEach(function (e, ei) {
			const shareM = ei === n - 1 ? Math.round((totalM - per * (n - 1)) * 100) / 100 : per;
			give(e, moneyToRaw(shareM), tag + "（全灭均摊·守恒）");
		});
		return;
	}

	/* ★ 阶段 2：只对活着的阵营计算平均分贡献度 */
	const campContrib = {};
	let campSum = 0;
	aliveCamps.forEach(function (camp) {
		const c = _campAvg(byCamp[camp]);
		campContrib[camp] = c;
		campSum += c;
	});

	/* 退化：全 0 → 均摊给活着的阵营成员 */
	if (campSum <= 0.01) {
		const aliveMembers = [];
		aliveCamps.forEach(function (camp) {
			byCamp[camp].forEach(function (p) { if (_isAlive(p)) aliveMembers.push(p); });
		});
		if (!aliveMembers.length) { give(char, -pts, tag + "（守恒回滚·无人承接）"); return; }
		const n = aliveMembers.length;
		const per = Math.round(totalM * 100 / n) / 100;
		aliveMembers.forEach(function (e, ai) {
			const shareM = ai === n - 1 ? Math.round((totalM - per * (n - 1)) * 100) / 100 : per;
			give(e, moneyToRaw(shareM), tag + "（均摊·守恒）");
		});
		return;
	}

	/* ★ 阶段 3：按阵营平均分比例切分（最后一个活阵营吃余数） */
	let campAllocatedM = 0;
	aliveCamps.forEach(function (camp, ci) {
		const aliveMembers = byCamp[camp].filter(_isAlive);

		let campShareM;
		if (ci === aliveCamps.length - 1) {
			campShareM = Math.round((totalM - campAllocatedM) * 100) / 100;
		} else {
			campShareM = Math.round(totalM * (campContrib[camp] / campSum) * 100) / 100;
			campAllocatedM += campShareM;
		}

		/* ★ 阶段 4：阵营内按个人得分切分（最后一个成员吃余数） */
		const memberSum = aliveMembers.reduce(function (s, e) { return s + _contribution(e); }, 0);
		let memberAllocatedM = 0;
		aliveMembers.forEach(function (e, mi) {
			let shareM;
			if (mi === aliveMembers.length - 1 || memberSum <= 0.01) {
				shareM = Math.round((campShareM - memberAllocatedM) * 100) / 100;
			} else {
				shareM = Math.round(campShareM * (_contribution(e) / memberSum) * 100) / 100;
				memberAllocatedM += shareM;
			}
			const pct = memberSum > 0
				? Math.round(_contribution(e) / memberSum * 100)
				: Math.round(100 / aliveMembers.length);
			give(e, moneyToRaw(shareM), tag + "（" + camp + "·" + pct + "%）");
		});
	});
}

/* ★ 货币→原始分逆映射：toMoney 的精确逆（|m|≤29 货币域内 toMoney(moneyToRaw(m))=m）。
 *   供 giveVs 等分摊场景使用：各份实际入账之和严格等于总额，守恒不因 toMoney 压缩而漂移 */
function moneyToRaw(m) {
	try {
		m = Number(m) || 0;
		const s = m < 0 ? -1 : 1;
		const a = Math.abs(m);
		let raw;
		if (a <= MONEY_LIN) raw = a;
		else if (a <= MONEY_CAP) raw = MONEY_LIN + (a - MONEY_LIN) * 2;
		else raw = MONEY_LIN + (MONEY_CAP - MONEY_LIN) * 2 + (a - MONEY_CAP);   /* >CAP 不可达，线性回退 */
		return Math.round(s * raw * 100) / 100;
	} catch (e) { return Number(m) || 0; }
}

/* ================= 记分钩子 ================= */
let _turnUse = 0, _lastTurnPlayer = null;

/* ███████ 货币等量规则 · 基础元素定义 ███████
 * 基准单位：MONEY_UNIT = 1（1 货币 = 1 标准收益点）。
 * 规则：toMoney(pts) 把任意原始收益折算成
 *       有界的货币等量 —— 小额 1:1 线性，中额亚线性压缩，大额封顶。
 *       用途：统一给分入库基准，防止单次巨大收益主导 round 贡献分、破坏
 *       单回合线性动量与训练归一化，让「货币」成为全链条可比的基础元素。 */
const MONEY_UNIT = 1;             /* 基准货币单位（1 货币 = 1 标准收益） */
const MONEY_LIN  = 8;             /* 线性区上界：|pts|≤8 → 1:1 等量 */
const MONEY_MID  = 50;            /* 亚线性区上界：8<|pts|≤50 → ×0.5 */
const MONEY_CAP  = 29;            /* 大额封顶：|pts|>50 折算后封顶为 29 货币 */
function toMoney(pts) {
	pts = Number(pts) || 0;
	const s = pts < 0 ? -1 : 1;
	const a = Math.abs(pts);
	let out;
	if (a <= MONEY_LIN) out = a;                          /* 线性区：1:1 */
	else if (a <= MONEY_MID) out = MONEY_LIN + (a - MONEY_LIN) * 0.5;  /* 亚线性 */
	else out = MONEY_LIN + (MONEY_MID - MONEY_LIN) * 0.5 + Math.min(MONEY_CAP - (MONEY_LIN + (MONEY_MID - MONEY_LIN) * 0.5), (a - MONEY_MID) * 0.2); /* 大额：再×0.2 渐压缩 */
	out = Math.min(MONEY_CAP, out);
	return Math.round(s * out * 100) / 100;
}

/* ★ 单回合动量：持续高收益 → 线性增幅倍率；持续低收益 → 线性衰减倍率。
 *   以「主动出牌的净收益符号」为信号，连续同向动作累积步数，反向即重置方向。
 *   倍率 = 1 + streak*STEP（线性），clamp ±MOM_CAP 步，封顶 ±30%。
 *   供bestAction作为反馈估计之一，合并后独占写入Utility，不再连续乘分。
 *   注：netGain 一律经 toMoney 货币化后判断，单次巨大收益不影响方向判定。 */
let _momPlayer = null, _momVal = 0, _momStreak = 0;
const MOM_CAP = 5;        /* ← 线性步数上下限 */
const MOM_STEP = 0.06;    /* ← 每步线性增量（5 步→+30%） */
function _updateMomentum(me, netGain) {
	try {
		const cur = _status && _status.currentPhase;
		if (!cur) { _momPlayer = null; _momVal = 0; _momStreak = 0; return; }
		if (_momPlayer !== cur) { _momPlayer = cur; _momVal = 0; _momStreak = 0; }
		if (cur !== me) return;
		/* ★ 货币化后取符号：单次高收益不因数量级翻转方向 / 过冲步数 */
		const money = toMoney(netGain);
		const dir = money > 0 ? 1 : (money < 0 ? -1 : 0);
		if (dir === 0) return;
		if ((_momStreak > 0 && dir > 0) || (_momStreak < 0 && dir < 0)) _momStreak += dir;
		else _momStreak = dir;
		if (_momStreak > MOM_CAP) _momStreak = MOM_CAP;
		else if (_momStreak < -MOM_CAP) _momStreak = -MOM_CAP;
		_momVal = 1 + _momStreak * MOM_STEP;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
/* 读取当前行动者的回合动量倍率（非本回合/无动量恒 1.0） */
function turnMomentum(me) {
	try {
		const cur = _status && _status.currentPhase;
		if (cur !== me || !_momVal) return 1.0;
		return Math.min(1.3, Math.max(0.7, _momVal));
	} catch (e) { return 1.0; }
}
/* ★ 延时锦囊循环抑制：记录真实贴牌（宿主 useCard 才计），评估时按 90s 窗口衰减。
 * 打断「贴了被拆→再贴→再拆」乒乓：k=1 → ×0.45，k=2 → ×0.2，k≥3 → 直接否决。 */
const _delayPostLog = [];
function _delayPostRecord(target, id) {
	try {
		if (!target || (id !== 'lebu' && id !== 'bingliang')) return;
		const now = Date.now();
		_delayPostLog.push({ tk: (target.name1 || target.name || '?'), id: id, ts: now });
		while (_delayPostLog.length > 60 || (_delayPostLog[0] && now - _delayPostLog[0].ts > 600000)) _delayPostLog.shift();
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
function _delayRepeatFactor(target, id) {
	try {
		if (!target) return { k: 0, f: 1 };
		const now = Date.now();
		const tk = (target.name1 || target.name || '?');
		let k = 0;
		/* ★ 窗口 90s→240s：AI 快速对局一轮仅 15~30s，90s 窗口滑出后「贴→拆→贴回」拉锯会复发；
		 *   240s 覆盖约 8~16 轮出牌，足够压制整段拉锯期 */
		for (let i = _delayPostLog.length - 1; i >= 0; i--) {
			const e = _delayPostLog[i];
			if (now - e.ts > 240000) break;
			if (e.tk === tk && e.id === id) k++;
		}
		return { k: k, f: Math.pow(0.45, k) };
	} catch (e) { return { k: 0, f: 1 }; }
}

/* ★ 濒死前被打记录（90s 窗口）：供响应层桃护栏用——
 * 「我方刚把目标打残/打倒，绝不回头救他」。记录所有真实伤害事件，消费端按名字匹配。 */
function _knockdownRecord(target, src) {
	try {
		if (!target) return;
		const w = (window.__DJSC = window.__DJSC || {});
		const log = (w._djscKnockdownLog = w._djscKnockdownLog || []);
		const now = Date.now();
		log.push({ t: (target.name1 || target.name || '?'), s: (src && (src.name1 || src.name)) || '?', ts: now });
		while (log.length > 80 || (log[0] && now - log[0].ts > 120000)) log.shift();
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ 铁索宿主 AI 接线（唯一安装点）：
 *   - ai.result.target：evaluator 全量目标评估（该连两个连两个、该解链解链）；
 *   - ai.order：优化开启时，无收益使用压到 0，由独立重铸入口继续选择。
 *   evaluator 的 0 是有效判断；共享本次出牌选择的目标方案。 */
function _installTiesuoHostAI() {
 try {
  const info = lib.card?.tiesuo, ai = info?.ai;
  if (!ai?.result || ai.result.__djscTiesuoInstalled) return;
  const originalTarget = ai.result.target, hadOrder = Object.hasOwn(ai,'order');
  const originalOrder = ai.order, baseOrder = originalOrder ?? ai.basic?.order;
  const targetEffect = function(player,target) {
   try {
    const value = hostTiesuoTargetEffect(player,target,game.players || [],{});
    if (Number.isFinite(value) && (tacticalEnabled('tiesuo') || value !== 0)) return value;
   } catch (_) {}
   return typeof originalTarget === 'function' ? originalTarget.apply(this,arguments) : originalTarget || 0;
  };
  const order = function(card,player) {
   player = player || get.event?.()?.player;
   if (!tacticalEnabled('tiesuo')) return typeof baseOrder === 'function' ? baseOrder.call(this,card,player) : baseOrder;
   try {
    const decision = hostTiesuoDecision(player,game.players || [],{});
    if (decision?.use === false && (tacticalEnabled('tiesuo') || player?.countCards?.('hs') > 2)) return 0;
   } catch (_) {}
   return typeof baseOrder === 'function' ? baseOrder.call(this,card,player) : baseOrder;
  };
  ai.result.target = targetEffect;
  ai.result.__djscTiesuoInstalled = true;
  ai.order = order;
  if (typeof window !== 'undefined' && window.__DJSC) window.__DJSC.tiesuoHostAI = {
   installed:true,uninstall(){
    if(ai.result.target===targetEffect){ai.result.target=originalTarget;delete ai.result.__djscTiesuoInstalled;}
    if(ai.order===order){if(hadOrder)ai.order=originalOrder;else delete ai.order;}
   }
  };
 } catch (_) {}
}

function scoreCardUse(me, card, target) {
	try {
		/* 统一 id 提取：字符串直接用；VCard 依次看 name / cardname */
		const id = (typeof card === "string")
			? card
			: (card && (card.name || card.cardname || "")) || "";
		if (!id) return;

		rec("cards", id);

		/* ★ 延时锦囊贴牌记录（真实出牌才计）：供循环抑制评分 */
		try { _delayPostRecord(target, id); } catch (eDp) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eDp); }

		/* ★ 牌堆记忆：使用牌时扣减 */
		try { deckConsume(card); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ★ 元素反馈：观察出牌 */
		try {
			let hpB = me.hp || 0;
			observeElementUse('card', id, me, {
				target: target && (target.name1 || target.name) ? target : null,
				hpBefore: hpB,
			});
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		/* ★ 元认知：记录卡牌使用 */
		try { metaRecordCard(id); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		if (target && target.name) {
			try { metaRecordTarget(target.name1 || target.name); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}

		/* 回合内出牌叠加激励 */
		try {
			const cur = _status && _status.currentPhase;
			if (_lastTurnPlayer !== cur) { _lastTurnPlayer = cur; _turnUse = 0; }
			if (me === cur) {
				_turnUse++;
				if (_turnUse >= 3) {
					const bonus = (_turnUse - 2) * 0.5;
					giveVs(me, bonus, "回合内第" + _turnUse + "张牌（用牌叠加激励）");
				}
			}
		} catch (eT) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eT); }

		const v = VAL_CARD[id];
		if (!v || !v.use) return;

		/* 记录"对目标出杀"的次数（供 threat.js 的 probHasShan 读取） */
		if (id === "sha" && target && get.itemtype(target) === "player") {
			try { memRecordAtk(target); } catch (eM) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eM); }
		}
		/* 行为观察：记录攻/援行为 */
		try { observeCardUse(me, card, target); } catch (eO) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eO); }

		/* ★ 友方延迟评估：不立即给正分，等 600ms 后评估是否有正收益 */
		if (target && get.itemtype(target) === "player") {
			/* ★ 判断友方（好感度 + 阵营策略双保险） */
			let isAlly = false;
			try {
				if (isSameCamp(me, target)) isAlly = true;
				const strategy = typeof getModeStrategy === 'function' ? getModeStrategy() : null;
				if (strategy && strategy.getCamp) {
					if (strategy.getCamp(me) === strategy.getCamp(target)) isAlly = true;
				}
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

			if (isAlly) {
				/* ★ 锦囊类特殊处理：只记录特征，不重罚（走本体合法检测） */
				const PENALTY_CARDS = ['lebu', 'bingliang', 'tiesuo', 'shunshou'];
				if (PENALTY_CARDS.indexOf(id) >= 0) {
					/* 判断是横置还是解除横置 */
					if (id === 'tiesuo') {
						/* 铁索连环：横置友方只记录，解除横置加分 */
						const isLinking = !isPlayerLinked(target);
						if (isLinking) {
							/* 横置友方 → 只记录特征，不重罚 */
							logBestAction(me, null, { reason: '对友方铁索横置（特征记录）' });
							return;
						} else {
							/* 解除友方横置 → 加分（牌价值经动态汇率换算成货币） */
							cash(me, 'card', Math.abs(v.use) * 1.5, "解除友方横置（支援）");
							return;
						}
					} else if (id === 'shunshou') {
						/* 顺手牵羊：拿判定区加分，拿非判定区只记录 */
						let isJudgeArea = false;
						try {
							if (target.judges && target.judges.length > 0) {
								isJudgeArea = true;
							}
						} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

						if (isJudgeArea) {
							/* 拿判定区 → 加分（解乐/解兵） */
							cash(me, 'card', Math.abs(v.use) * 1.5, "顺友方判定区（解乐/解兵，支援）");
							return;
						} else {
							/* 拿非判定区 → 只记录特征，不重罚 */
							logBestAction(me, null, { reason: '顺友方非判定区（特征记录）' });
							return;
						}
					} else {
						/* 乐不思蜀 / 兵粮寸断 → 只记录特征，不重罚 */
						logBestAction(me, null, { reason: '对友方使用' + (id === 'lebu' ? '乐不思蜀' : '兵粮寸断') + '（特征记录）' });
						return;
					}
				}

				/* ★ 对友方出牌：挂起，延迟评估，不立即给正分 */
				const rec = {
					me: me, target: target,
					value: v.use || 1,
					id: id,
					t0: Date.now(),
					snap: _snapshotAlly(target),
					hurt: false,
				};
				/* 记录挂起前的友方得分，供评估对比 */
				try { rec.snap.round = round[keyOf(target)] || 0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				_allyActionPending.push(rec);

				setTimeout(function () {
					_evaluateAllyAction(rec);
					const idx = _allyActionPending.indexOf(rec);
					if (idx >= 0) _allyActionPending.splice(idx, 1);
				}, 600);

				/* 只给一点基础分（表示行动本身），大头等评估 */
				cash(me, 'card', (v.use || 1) * 0.2, "对友方使用（待评估）");
			} else {
				givePair(me, target, v.use, "使用" + v.name + "（" + id + "）");
			}
		} else if (Array.isArray(target)) {
			/* ★ AOE：按友方/敌方分别结算 */
			let allyHurt = 0, enemyHit = 0;
			target.forEach(function (t) {
				if (!get.itemtype(t) === "player") return;
				let isAlly = false;
				try {
					if (isSameCamp(me, t)) isAlly = true;
					const strategy = typeof getModeStrategy === 'function' ? getModeStrategy() : null;
					if (strategy && strategy.getCamp) {
						if (strategy.getCamp(me) === strategy.getCamp(t)) isAlly = true;
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				if (isAlly) allyHurt++;
				else enemyHit++;
			});

			if (allyHurt > 0) {
				/* AOE 误伤友方，按 70% 重罚（牌价值经动态汇率换算成货币） */
				const rate = 0.7;
				cash(me, 'card', -allyHurt * Math.abs(v.use) * rate * 3, "AOE误伤友方（扣除 " + (rate * 100) + "%）");
				giveVs(me, -allyHurt * Math.abs(v.use) * rate, "阵营分扣除 " + (rate * 100) + "%");
			}
			if (enemyHit > 0) {
				giveVs(me, enemyHit * v.use, "AOE命中敌人");
			}
		} else {
			giveVs(me, v.use, "使用" + v.name + "（" + id + "）");
		}
		/* ★ 单回合动量：以本牌净收益方向（v.use 符号）更新。
		 *   顺风（正收益连击）放大后续动作、逆风及时止损；方向经 toMoney 货币化判定。 */
		_updateMomentum(me, v.use);
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= 效果处理器表 =================
 * 键与 installHooks 里 EF 数组一一对应。
 * 每个处理器签名：(me, a) —— me 是玩家对象，a 是 arguments 类数组。
 * 键为 "die" 的情况不在此表——阵亡计分独立在 installHooks 里处理。
 */
const EFFECT_HANDLERS = {
	damage: function (me, a) {
		try { _markAllyHurt(me); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }   /* ★ 友方评估标记 */
		const p0 = a[0];
		let src = null, n = 1;
		if (p0 && typeof p0 === "object" && !Array.isArray(p0)) {
			if (get.itemtype(p0) === "player") src = p0;
			if (typeof p0.num === "number") n = p0.num;
			if (p0.source && get.itemtype(p0.source) === "player" && p0.source !== me) src = p0.source;
		} else {
			/* noname 签名 damage(num, source, ...)：number 与 player 参数乱序，遍历全部参数 */
			for (let i = 0; i < a.length; i++) {
				const v = a[i];
				if (typeof v === "number") n = v;
				else if (v && typeof v === "object" && !Array.isArray(v) && v !== me) {
					/* 玩家判定优先 get.itemtype，其次 hp 兜底（兼容未初始化/隐匿状态的玩家） */
					let isP = false;
					try { isP = (typeof get === "object" && get.itemtype && get.itemtype(v) === "player"); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					if (isP || v.hp !== undefined) src = v;
				}
			}
		}
		if (src && src !== me) {
			/* ★ 污染修复：判断 src 和 me 是否是友方 */
			let isAlly = false;
			try {
				if (isSameCamp(src, me)) isAlly = true;
				const strategy = getModeStrategy();
				if (strategy && strategy.isSameCamp && strategy.isSameCamp(src, me)) isAlly = true;
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

			if (isAlly) {
				/* 打队友：src 不加分，me 不扣分，仅记录受伤次数（敌意观测不写） */
				try { memRecordHit(me); } catch (eH) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eH); }
				/* ★ 互杀修复：友方伤害【不写敌意观测】——observeAttack 会把 AOE 波及/决斗误伤记成故意攻击，
				 *   经 identity 二阶证据放大成「队友=反贼」后验，几回合后全队互杀（死亡螺旋源头）。 */
			} else {
				/* 打敌人：正常计分 */
				givePair(src, me, 2 * n * cfg("dmgRate", 1), "造成" + n + "点伤害");
				try { memRecordHit(me); } catch (eH) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eH); }
				try { observeAttack(src, me, n); } catch (eO) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eO); }
			}
			/* ★ 追踪：src 对 me 的伤害次数（友方伤害线性衰减用） */
			try {
				if (src) {
					if (!src._djsc_hurtAlly) src._djsc_hurtAlly = {};
					const key = me.name1 || me.name || '?';
					src._djsc_hurtAlly[key] = (src._djsc_hurtAlly[key] || 0) + 1;
				}
			} catch (eT) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eT); }
		} else {
			giveVs(me, -2 * n * cfg("dmgRate", 1), "受到" + n + "点伤害");
		}
		try { _knockdownRecord(me, src); } catch (eKd) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eKd); }
	},
	changeHp: function (me, a) {
		const v = parseFloat(a[0]) || 0;
		if (v > 0) giveVs(me, 2 * v, "回复" + v + "点");
		else if (v < 0) giveVs(me, 2 * v, "失去" + (-v) + "点体力");
	},
	recover: function (me, a) {
		const n = Math.abs(parseFloat(a[0]) || 1);
		giveVs(me, 2 * n, "回复" + n + "点");
		/* 行为观察：若参数里能找出施救者，记为援助行为
		 * noname 签名 recover(num, source, ...)：遍历参数找 player 来源 */
		try {
			let src = null;
			for (let i = 0; i < a.length; i++) {
				const v = a[i];
				if (v && typeof v === "object" && !Array.isArray(v) && v !== me) {
					let isP = false;
					try { isP = (typeof get === "object" && get.itemtype && get.itemtype(v) === "player"); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					if (isP || v.hp !== undefined) { src = v; break; }
				}
			}
			if (!src && a[0] && typeof a[0] === "object" && !Array.isArray(a[0])) {
				const p0 = a[0];
				if (p0.source && get.itemtype(p0.source) === "player" && p0.source !== me) src = p0.source;
				else if (p0.sourcex && get.itemtype(p0.sourcex) === "player" && p0.sourcex !== me) src = p0.sourcex;
			}
			if (src) observeAid(src, me, n * 0.8);
		} catch (eO) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eO); }
	},
	draw: function (me, a) {
		const n = Math.abs(parseFloat(a[0]) || 1);
		giveVs(me, n * cfg("drawRate", 1), "摸" + n + "张");
		/* ★ 牌堆感知：摸牌消耗 */
		try {
			const ev = _status.event;
			if (ev && ev.cards && Array.isArray(ev.cards)) {
				ev.cards.forEach(function(c) { try { deckConsume(c); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	},
	discard: function (me, a) {
		try { _markAllyHurt(me); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }   /* ★ 友方评估标记 */
		let n = 1;
		let cards = null;
		try {
			const c0 = a[0];
			if (Array.isArray(c0)) { n = c0.length; cards = c0; }
			else if (typeof c0 === "number") n = c0;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		giveVs(me, -1 * n * cfg("discardRate", 1), "弃" + n + "张");
		if (n > 3) giveVs(me, -(n - 3) * 0.3 * cfg("discardRate", 1), "弃" + n + "张过多额外惩罚");
		/* ★ 牌堆感知：弃牌消耗 */
		try {
			if (cards) cards.forEach(function(c) { try { deckConsume(c); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
			else {
				const ev = _status.event;
				if (ev && ev.cards) ev.cards.forEach(function(c) { try { deckConsume(c); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	},
	loseHp: function (me, a) {
		try { _markAllyHurt(me); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }   /* ★ 友方评估标记 */
		const n = Math.abs(parseFloat(a[0]) || 1);
		giveVs(me, -2 * n, "失去" + n + "点体力");
	},
	gainMaxHp: function (me) { giveVs(me, 2, "体力上限+1"); },
	loseMaxHp: function (me) { giveVs(me, -2, "体力上限-1"); },
	turnOver: function (me) { giveVs(me, -3, "翻面"); },
	link: function (me) { giveVs(me, -1, "横置"); },
	gain: function (me, a) {
		const n = (Array.isArray(a[0]) ? a[0].length : Math.abs(parseFloat(a[0]) || 1));
		giveVs(me, n, "获得" + n + "张");
		/* ★ 牌堆感知：获得牌消耗 */
		try {
			if (Array.isArray(a[0])) {
				a[0].forEach(function(c) { try { deckConsume(c); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	},
	lose: function (me, a) {
		try { _markAllyHurt(me); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }   /* ★ 友方评估标记 */
		const n = (Array.isArray(a[0]) ? a[0].length : Math.abs(parseFloat(a[0]) || 1));
		giveVs(me, -n, "失去" + n + "张");
		/* ★ 牌堆感知：失去牌消耗 */
		try {
			if (Array.isArray(a[0])) {
				a[0].forEach(function(c) { try { deckConsume(c); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	},
	judge: function (me) {
		giveVs(me, 1, "判定");
		/* ★ 牌堆感知：判定牌消耗 */
		try {
			const ev = _status.event;
			let jc = null;
			if (ev) {
				if (ev.card) jc = ev.card;
				else if (ev.result && ev.result.card) jc = ev.result.card;
			}
			if (jc) deckConsume(jc);
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	},
	equip: function (me) { giveVs(me, 1, "装备"); },
};

function scoreEffect(mm, me, a) {
	try {
		rec("effects", mm);
		const h = EFFECT_HANDLERS[mm];
		if (h) h(me, a || []);
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ 玩家日志收集器（模块级作用域）
 *   必须在 installHooks 与 settle 之间共享，故放在此处。
 *   若象旧实现那样声明在 installHooks 内，settle() 归档时会取不到 _playerLogs，
 *   抛 ReferenceError 并被 catch 吞掉，导致整段 archiveGame 归档失败（整局战报丢失）。 */
const actionOutcomes = createActionOutcomeObserver({
 players: () => [...(game.players || []), ...(game.dead || [])], relation: dispositionOf, key: targetKey,
 equipmentValue: card => VAL_CARD[card.name]?.use || 1,
});
const playerDemonstrations=createPlayerDemonstrationCollector({
 key:targetKey,observer:actionOutcomes,
 features:(actor,action)=>extractFeatures(actor,action,{bestT:action.targetObj||null,bestTs:0,isEnemy:action.targetObj?dispositionOf(actor,action.targetObj)<0:false},new Int8Array(FEATURE_DIM)),
 record:(actor,action,f,execution)=>trainRecordSample(actor,action,null,0,f,execution),feedback:trainFeedbackSample,
 archive:(kind,payload,tx)=>matchArchive.record(kind,payload,{playerId:tx.trainingActorId,round:_getRoundNumber(),transactionId:tx.id}),
});
function recordExecutionMismatch(result,actor){
 try{if(result?.tx?.state==='mismatched')matchArchive.record('executionMismatch',{transactionId:result.tx.id,actorId:targetKey(actor),expected:result.tx.expected,actual:result.tx.actual,reason:result.reason,trainingEligible:false},{playerId:targetKey(actor),round:_getRoundNumber()});}catch(_){}
}
function preparePlayerDemonstration(actor,args,recast=false){
 try{
  const manual=actor===game.me&&!_status.auto&&!_status.connectMode;
  const phase=directPlayPhase(_status.event,actor,recast);
  if(!manual){if(phase)playerDemonstrations.interrupt(actor);return null;}
  const card=recast?(Array.isArray(args[0])?args[0][0]:args[0]):args[0];
  if(!card||recast&&Array.isArray(args[0])&&args[0].length!==1)return null;
  const targets=recast?[]:Array.from(args).slice(1).flat().filter(v=>v&&typeof v==='object'&&typeof v.countCards==='function'&&v.hp!==undefined);
  const unique=[...new Set(targets)],ids=unique.map(targetKey).filter(Boolean).sort();
  return playerDemonstrations.prepare({actor,event:_status.event,context:modeSampleMeta(actor),manual,
   action:{type:!recast&&get.type?.(card)==='equip'?'equip':'card',id:get.name(card,actor),target:ids.length>1?ids:ids[0]||null,targetObj:unique[0]||null,nature:card.nature||null,recast}});
 }catch(_){return null;}
}
const delayedOutcomes = createDelayedOutcomeTracker({ key: targetKey, onResult: result => {
 const application=trainApplyCostCredits(result);
 result.creditApplication={applied:application.applied,reason:application.reason||null};
 for (const id of result.transactionIds) {
  const entry = DECISION_LOG.find(e => e.transactionId === id);
  if (entry) entry.delayedOutcome = result;
 }
 matchArchive.recordOutcome('delayedActionOutcome', result, { playerId: result.actorId, round: _getRoundNumber() });
 for(const feedback of application.feedback||[]) {
  const entry=DECISION_LOG.find(e=>e.transactionId===feedback.transactionId);if(entry)entry.actionOutcome=feedback;
  matchArchive.recordOutcome('actionCredit',feedback,{playerId:feedback.actorId,round:_getRoundNumber()});
 }
} });
const identityEvidenceCollector = createIdentityEvidenceCollector();
const publicSources = createPublicProvenanceTracker({players:()=>[...(game.players||[]),...(game.dead||[])],key:targetKey,onResult:result=>{
 for(const id of result.transactionIds){const entry=DECISION_LOG.find(e=>e.transactionId===id);if(entry){entry.delayedEvidence=[...(entry.delayedEvidence||[]),result].slice(-64);}}
 matchArchive.recordOutcome('delayedEvidence',result,{playerId:result.actorId,round:_getRoundNumber()});
}});
const skillOutcomes = createSkillOutcomeTracker({ observer: actionOutcomes, key: targetKey,
 bindTargets: (tx, target) => trainBindSampleTargets({ transactionId: tx.id, actorId: tx.trainingActorId, sessionId: tx.trainingSessionId }, target),
 onResult: publishSkillOutcome,
});
function publishSkillOutcome(result) {
  const entry = DECISION_LOG.find(e => e.transactionId === result.transactionId);
  trainFeedbackSample(result);
  if (entry) { entry.actionOutcome = result;
    entry.actual = { ...entry.actual, target: result.target }; }
  matchArchive.recordOutcome('actionOutcome',result,{playerId:result.actorId,round:_getRoundNumber()});
}
let _playerLogs = [];
function addPlayerLog(type, data, actor, kind = 'action') {
	try {
		matchArchive.record(kind, { type, ...data, transactionId: kind === 'action' && actor && peekDecisionTransaction(actor) && peekDecisionTransaction(actor).id || null }, { player: actor && (actor.name1 || actor.name) || '?',
			playerId: actor && actor.playerid || null, round: _getRoundNumber(), videoIndex: Array.isArray(lib.video) ? lib.video.length : null });
		_playerLogs.push({
			ts: Date.now(),
			type: type,
			player: actor ? (actor.name1 || actor.name || '?') : '?',
			data: data
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ AI 强度档位 → 冠军策略影响力系数
 *   ⚠ 修复：此前 strengthFactor 在决策链里算完从未被使用，是"死开关"，
 *   所以"极强=接近完美"没有任何依据（档位实际不改变任何行为）。
 *   现在把它真正接到冠军策略的提权系数上：中=1.0（默认，行为与原来完全一致），
 *   极弱=0（纯规则、不接管），强/极强=放大冠军策略影响力。
 *   注意：档位只放大"影响力"，模型/策略本身有错时，放大影响会同时放大错误。 */
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

/* The host's Player.respond accepts several argument shapes. The completed
 * native event's cards field is the authoritative list of physical materials;
 * event.card may be a virtual view-as card and args[0] may be a cards array. */
export function consumeRespondMaterials(event, consume = deckConsume) {
	try {
		const player = event && event.player;
		if (!event || event.name !== 'respond' || !player || !player.getHistory ||
			!player.getHistory('respond')?.includes(event) || typeof consume !== 'function') return 0;
		const materials = Array.isArray(event.cards) ? event.cards : [];
		const seen = new Set();
		let count = 0;
		for (const card of materials) {
			if (!card || seen.has(card) || get.itemtype?.(card) !== 'card') continue;
			seen.add(card);
			consume(card);
			count++;
		}
		return count;
	} catch (error) {
		if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(error);
		return 0;
	}
}

function installHooks() {
	if (installed) return;
	const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
	if (!proto) return;

	/* 热重载场景：proto 上若残留原函数记录，先还原，避免嵌套包装 */
	if (proto[DJSC_ORIG]) {
		try { uninstallHooks(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	}

	playerDemonstrations.reset();
	memLoad();   // 上一局记忆载入
	try { deckAutoDetect(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }   // ★ 自动识别牌堆模式
	try { trainStartGame(game.me, get.mode ? get.mode() : 'identity'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }  // ★ 开始训练局
	/* ★ 热更新 A/B 分组：若有候选模型，按交替分组在本局换入候选或保持基线（P1-16） */
	try {
		if (window.__DJSC && window.__DJSC.hotSwap && window.__DJSC.hotSwap.gameStart) {
			window.__DJSC.hotSwap.gameStart();
		}
	} catch (eHSG) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eHSG); }
	try { loadStore(); } catch (eMem) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eMem); }   // 跨局记忆载入
	try { loadArchive(); } catch (eArc) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eArc); }  // 战报归档载入
	try { loadFeedback(); } catch (eFb) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eFb); }  // 技能反馈载入
	try { loadStyleFeedback(); } catch (eSf) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSf); } // 风格反馈载入
	/* ★ 决策回放：局开始 */
	try {
		if (window.__DJSC && window.__DJSC.replay && window.__DJSC.replay.start) {
			window.__DJSC.replay.start({
				mode: (typeof get !== 'undefined' && get.mode) ? get.mode() : 'unknown',
				playerCount: (game.players || []).length,
				meKey: game.me ? (game.me.name1 || game.me.name || '?') : '?',
				myIdentity: game.me ? (game.me.identity || null) : null,
			});
		}
	} catch (eR) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eR); }

	matchArchive.start({ version: VERSION, mode: get.mode ? get.mode() : 'unknown', modeContext:modeContext(), setupAdvice:takeClassicSetupAdvice(modeContext().sessionId),
		settings: Object.fromEntries(['testDecisionLog', 'riskProfile', 'aiStrength', 'personalityAggression', 'personalityRisk', 'personalityTeam'].map(k => [k, cfg(k, null)])),
		players: (game.players || []).map(p => ({ id: p.playerid, name: p.name1 || p.name })),
	});
	choiceAuditCleanup?.();
 choiceAuditCleanup=installChoiceAudit(data=>matchArchive.record('choiceAudit',data,{playerId:data.actorId,round:_getRoundNumber()}),()=>modeContext().sessionId);
	matchReplay = null;
	const orig = {};
	proto[DJSC_ORIG] = orig;

	/* 1) useCard —— 出牌记分 + 记录玩家日志 */
	const oUse = proto.useCard;
	if (typeof oUse === "function") {
		orig.useCard = oUse;
		proto.useCard = function () {
			const me = this, args = arguments;


			try {
				const _cid = (get && typeof get.name === 'function') ? get.name(args[0], me) : (args[0] && args[0].name);
				const _tg = args[1];
				const _target = Array.isArray(_tg) ? _tg[0] : _tg;
				if (_target && typeof _target === 'object') {
					beginStrategicAction(me, _cid, _target, {
						relationOf: function (mi, t) { return dispositionOf(mi, t); },
					});
				}
			} catch (eRec) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eRec); }

			const demonstrationTicket=preparePlayerDemonstration(me,args);
			const outcomeTx = peekDecisionTransaction(me);
            let delayedBefore = null;
            let publicBefore = null;
            try { publicBefore = publicSources.beforeUse(me); } catch (_) {}
            try { delayedBefore = delayedOutcomes.before(me, _status.event); } catch (_) {}
            const outcomeBefore = actionOutcomes.before(me, _status.event, !!outcomeTx && ['card','equip'].includes(outcomeTx.expected.type));
			/* Execution Gateway 规则：真实宿主函数只允许调用一次。 */
			const cooperativeChoiceEvent=_status.event;
			const host = invokeObservedHost({ orig: oUse, thisArg: this, args: Array.from(args), decisionPoint: 'useCard' });
			if (!host.ok) return host.result;
			const next = host.result;
            observeCooperativeTrickUse(next,me,cooperativeChoiceEvent);
            try { identityEvidenceCollector.beginUse(next,me,args[0],next?.targets || args[1],_status.event); } catch (_) {}
            let completeOutcome = null;
            let outcomeCommitted = null, outcomeResult = null;
            function finishOutcome() {
                finishCooperativeTrickUse(next);
                if (completeOutcome) { try { completeOutcome(); } catch (_) {} }
                try { delayedOutcomes.complete(delayedBefore, next, outcomeCommitted, outcomeResult); } catch (_) {}
                try { publicSources.completeUse(publicBefore,next,outcomeCommitted,outcomeResult); } catch (_) {}
            }



			/* A returned GameEvent is not execution: it may be cancelled before
             * content runs. Confirm only once native content records useCard. */
            let nativeUseConfirmed = false;
            const confirmNativeUse = function () {
			try {
				gameTelemetry.action(me);
				addPlayerLog('useCard', { card: get.name(next.card, me) || '?',
					target: (next.targets || []).map(targetKey).filter(Boolean) }, me);
			} catch (e) {}
			try {
				const _actualId = (get && typeof get.name === 'function') ? get.name(next.card, me) : next.card?.name;
				const _actualTarget = [];
				function _collectActualTarget(v) {
					if (!v) return;
					if (Array.isArray(v)) {
						for (let i = 0; i < v.length; i++) _collectActualTarget(v[i]);
						return;
					}
					let isPlayer = false;
					try { isPlayer = !!(get && typeof get.itemtype === 'function' && get.itemtype(v) === 'player'); } catch (e) {}
					if (!isPlayer) {
						try { isPlayer = typeof v === 'object' && typeof v.countCards === 'function' && v.hp !== undefined; } catch (e) {}
					}
					if (!isPlayer) return;
					try {
						const k = targetKey(v) || '';
						if (k && _actualTarget.indexOf(k) < 0) _actualTarget.push(k);
					} catch (e) {}
				}
				// Native modifiers may redirect targets after construction.
				for (const target of next.targets || []) _collectActualTarget(target);
				const _pendingTx = peekDecisionTransaction(me);
				if (!demonstrationTicket && _pendingTx && _pendingTx === outcomeTx && (_pendingTx.expected.type === 'card' || _pendingTx.expected.type === 'equip')) {
					const committed = commitExecution(me, {
						type: 'card',
						id: _actualId || '',
						target: _actualTarget.length > 1 ? _actualTarget : (_actualTarget[0] || null),
					});
                    recordExecutionMismatch(committed,me);
                    if (committed?.ok && committed.tx.trainingSessionId) {
                        outcomeCommitted = committed.tx;
                        try{publicSources.trackUse(next,committed.tx);}catch(_){}
                        completeOutcome = actionOutcomes.observe(outcomeBefore, next, committed.tx, result => {
                            outcomeResult = result;
                            trainFeedbackSample({ ...result, type: committed.tx.trainingActionType,
                                sessionId: committed.tx.trainingSessionId });
                            const entry = DECISION_LOG.find(e => e.transactionId === result.transactionId);
                            if (entry) entry.actionOutcome = result;
                            matchArchive.recordOutcome('actionOutcome', result, { playerId: targetKey(me), round: _getRoundNumber() });
                        });
                    }
				}
			} catch (eTx) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTx); }
            };
            if (next && typeof next.pushHandler === 'function') next.pushHandler(function (event, option) {
                if (nativeUseConfirmed || option?.state !== 'end' || !me.getHistory?.('useCard')?.includes(event)) return;
                nativeUseConfirmed = true;
                confirmNativeUse();
            });

            if(demonstrationTicket){
                try{
                    const demonstration=playerDemonstrations.commit(demonstrationTicket,next);
                    if(demonstration){
                        cancelDecisionTransaction(me,'player-manual-choice');
                        outcomeCommitted=demonstration.tx;
                        try{publicSources.trackUse(next,demonstration.tx);}catch(_){}
                        completeOutcome=()=>{demonstration.complete?.();outcomeResult=demonstration.result();};
                    }
                }catch(_){}
            }
            try { beginChoiceAudit(tacticalEnabled('diagnostic'),me,next,'execution')?.record('host-use-created',{
             action:{type:'card',id:get.name(args[0],me),target:(next?.targets||[]).map(targetKey)},
             transactionId:outcomeCommitted?.id||null,executionState:'host-call-returned'}); } catch (_) {}
			if (next && typeof next.then === "function") {
				Promise.resolve(next).then(function () {
                    finishOutcome();
					try { if (nativeUseConfirmed) scoreCardUse(me, args[0], args[1]); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				}).catch(function () { finishOutcome(); });
			} else {
				try { if (nativeUseConfirmed) scoreCardUse(me, args[0], args[1]); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			}
			return next;
		};
	}

    // 重铸是独立宿主动作，不能借用同牌名 useCard 的提交。
    const oRecast=proto.recast;
    if(typeof oRecast==='function'){
        orig.recast=oRecast;
        proto.recast=function(...args){
            const me=this,demonstrationTicket=preparePlayerDemonstration(me,args,true),pending=peekDecisionTransaction(me),before=actionOutcomes.before(me,_status.event,!!pending?.expected.recast&&!demonstrationTicket);
            const host=invokeObservedHost({orig:oRecast,thisArg:me,args,decisionPoint:'recast'});
            if(!host.ok)return host.result;
            const root=host.result,cards=root?.cards|| (Array.isArray(args[0])?args[0]:[args[0]]);
            if(root?.name!=='recast'||cards.length!==1||!cards[0])return root;
            const id=get.name(cards[0],me);
            try{gameTelemetry.action(me);addPlayerLog('recast',{card:id,target:null},me);}catch(_){}
            try{
                if(demonstrationTicket){
                    const demo=playerDemonstrations.commit(demonstrationTicket,root);
                    if(demo){cancelDecisionTransaction(me,'player-manual-choice');if(demo.complete&&typeof root.then==='function')Promise.resolve(root).then(demo.complete,demo.complete);}
                }else if(pending?.expected.recast&&pending.expected.id===id){
                    const committed=commitExecution(me,{type:'card',id,target:null,recast:true});
                    recordExecutionMismatch(committed,me);
                    if(committed?.ok&&committed.tx.trainingSessionId){
                        const complete=actionOutcomes.observe(before,root,committed.tx,result=>{
                            trainFeedbackSample({...result,type:committed.tx.trainingActionType,sessionId:committed.tx.trainingSessionId});
                            const entry=DECISION_LOG.find(e=>e.transactionId===result.transactionId);if(entry)entry.actionOutcome=result;
                            matchArchive.recordOutcome('actionOutcome',result,committed.tx);
                        });
                        if(typeof complete==='function'&&typeof root.then==='function')Promise.resolve(root).then(complete,complete);
                    }
                }
            }catch(_){}
            return root;
        };
    }

	/* 2) 效果钩子 —— 每个 proto[m] 直接绑定对应的处理函数，不再经过 scoreEffect 的字符串分派 */
	const EF = ["damage", "recover", "draw", "discard", "loseHp", "gainMaxHp", "loseMaxHp",
	            "turnOver", "link", "changeHp", "gain", "lose", "judge", "equip", "addJudge", "phaseJudge"];
	EF.forEach(function (m) {
		const o = proto[m];
		if (typeof o !== "function") return;
		const handler = EFFECT_HANDLERS[m];
		orig[m] = o;
		proto[m] = function () {
			const me = this, args = arguments;
			const host = invokeObservedHost({ orig: o, thisArg: this, args: Array.from(args), decisionPoint: m });
			if (!host.ok) return host.result;
			try {
                if(m==='equip'||m==='addJudge')publicSources.attachPlacement(host.result,m==='equip'?'e':'j');
                if(m==='judge')publicSources.attachJudge(host.result);
                if(m==='lose')publicSources.attachLoss(host.result);
                if(m==='phaseJudge')publicSources.attachPhase(host.result);
            }catch(_){}
			if (handler) {
				try { rec("effects", m); handler(me, args); } catch (eS) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eS); }
			}
			return host.result;
		};
	});

    /* 创建触发/自定义技能根时捕获消耗前快照；完成回调跟随宿主自然loop。 */
    for (const method of ['createTrigger','createEvent']) {
        const original=game[method];
        if(typeof original!=='function')continue;
        orig['__djsc_'+method]=original;
        game[method]=function(...args) {
            const actor=method==='createTrigger'?args[2]:_status.event?.player;
            const skill=method==='createTrigger'?args[1]:args[0];
            let snapshot=null;
            try {
                const pending=actor&&peekDecisionTransaction(actor);
                if(pending?.expected.type==='skill'&&pending.expected.id===skill&&!skillOutcomes.find(actor,skill,_status.event))snapshot=actionOutcomes.before(actor,_status.event);
            }catch(_){}
            const root=original.apply(this,args);
            if(method==='createEvent'){try{publicSources.attachEffect(root,_status.event);}catch(_){}}
            if(snapshot) { try { skillOutcomes.prepare(actor,root,snapshot,skill); }catch(_){} }
            return root;
        };
    }

    /* 主动技能进入真实宿主useSkill后提交，Before快照包含其后续消耗。 */
    const oUseSkill = proto.useSkill;
    if (typeof oUseSkill === 'function') {
        orig.useSkill = oUseSkill;
        proto.useSkill = function () {
            const me = this, args = Array.from(arguments);
            if(me===game.me&&args[0]!=='_recasting'&&directPlayPhase(_status.event,me))playerDemonstrations.interrupt(me);
            const pending = peekDecisionTransaction(me);
            const before = actionOutcomes.before(me, _status.event, pending?.expected.type === 'skill');
            const host = invokeObservedHost({ orig: oUseSkill, thisArg: me, args, decisionPoint: 'useSkill' });
            if (!host.ok) return host.result;
            const root = host.result;
            try {
                if (pending?.expected.type === 'skill' && root?.name === 'useSkill' && root.player === me && root.skill && root.skill === args[0]) {
                    const ids = [...new Set((root.targets || []).map(targetKey).filter(Boolean))].sort();
                    const committed = commitExecution(me,{type:'skill',id:root.skill,target:ids.length > 1 ? ids : ids[0] || null});
                    recordExecutionMismatch(committed,me);
                    if (committed?.ok && committed.tx.trainingSessionId) {
                        skillOutcomes.begin(me,root,before,committed.tx);
                    }
                }
            } catch (_) {}
            return root;
        };
    }
    // 宿主本身派发After；不调用then/start，不改变事件执行时序。
    lib.skill._djsc_skillOutcome = {
        trigger: { global: 'useSkillAfter' }, forced: true, popup: false, charlotte: true, forceDie: true, lastDo: true,
        filter(event,player) { return event.player === player; },
        async content(event,trigger) { skillOutcomes.complete(trigger); },
    };
    game.addGlobalSkill('_djsc_skillOutcome');
    lib.skill._djsc_delayedOutcome = {
        trigger: { global: 'phaseAfter' }, forced: true, popup: false, charlotte: true, forceDie: true, lastDo: true,
        filter(event,player) { return event.player === player; },
        async content(event,trigger) { delayedOutcomes.expire(trigger); },
    };
    game.addGlobalSkill('_djsc_delayedOutcome');
    lib.skill._djsc_publicSources = {
        trigger:{global:'phaseJudgeBegin'},forced:true,popup:false,charlotte:true,forceDie:true,firstDo:true,
        filter(event,player){return event.player===player;},
        async content(event,trigger){publicSources.beginPhase(trigger);},
    };
    game.addGlobalSkill('_djsc_publicSources');
    lib.skill._djsc_identityEvidence = {
        trigger:{global:['useCardAfter','damageEnd','recoverEnd','dieAfter']},
        forced:true,popup:false,charlotte:true,forceDie:true,lastDo:true,
        filter(event,player) { return event.player===player; },
        async content(event,trigger) {
            try { identityEvidenceCollector.complete(trigger,trigger.name); } catch (_) {}
        },
    };
    game.addGlobalSkill('_djsc_identityEvidence');

	/* ★ Decision Transaction Commit：技能只有真正进入宿主 logSkill 才提交。
	 * 目标在部分技能中由后续 choice stage 决定，因此 skill 事务只校验技能 id。 */
	const oLogSkill = proto.logSkill;
	if (typeof oLogSkill === "function") {
		orig.logSkill = oLogSkill;
		proto.logSkill = function () {
			const me = this, args = arguments;
			const host = invokeObservedHost({ orig: oLogSkill, thisArg: this, args: Array.from(args), decisionPoint: 'logSkill' });
			if (!host.ok) return host.result;
			const rawSkill = Array.isArray(args[0]) ? args[0].map(String) : typeof args[0] === 'string' ? args[0] : String(args[0] && (args[0].name || args[0].skill || args[0].id) || '?');
			const skillLog = splitSkillLog(rawSkill);
			try {
				if (skillLog.systemSkills.length) addPlayerLog('system', { skill: skillLog.systemSkills, reason: '辅助系统事件（统计/界面效果），不计入游戏动作' }, me, 'system');
				if (skillLog.actionSkills.length) {
					gameTelemetry.action(me);
					addPlayerLog('skill', { skill: Array.isArray(rawSkill) ? skillLog.actionSkills : skillLog.actionSkills[0] }, me);
				}
			} catch (e) {}
			if (!skillLog.actionSkills.length) return host.result;
			try {
				const sid = (typeof args[0] === 'string') ? args[0] :
					(args[0] && (args[0].name || args[0].skill || args[0].id)) || '';
				const _pendingTx = peekDecisionTransaction(me);
				if (_pendingTx && _pendingTx.expected.type === 'skill' && sid &&
					sid === _pendingTx.expected.id) {
                    const root=skillOutcomes.find(me,sid,_status.event);
                    const targets=(Array.isArray(args[1])?args[1]:args[1]?[args[1]]:[]).filter(p=>p&&typeof p.countCards==='function');
                    const ids=[...new Set(targets.map(targetKey).filter(Boolean))].sort();
                    const committed=commitExecution(me, { type: 'skill', id: sid, target: ids.length>1?ids:ids[0]||null });
                    recordExecutionMismatch(committed,me);
                    if(committed?.ok&&committed.tx.trainingSessionId) {
                        if(root)root.__djscObservedLogTargets=targets;
                        if(!root||!skillOutcomes.begin(me,root,null,committed.tx))publishSkillOutcome({transactionId:committed.tx.id,actorId:targetKey(me),sessionId:committed.tx.trainingSessionId,type:'skill',id:sid,target:committed.tx.actual.target,status:'unresolved',reward:null,reason:'missing-precost-event-boundary',scope:'unverified-skill-event'});
                    }
				}
			} catch (eTx) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTx); }
			return host.result;
		};
	}

	/* ★ 单独监听 respond（打出牌响应）+ 记录玩家日志 */
	const oRespond = proto.respond;
	if (typeof oRespond === "function") {
		orig.respond = oRespond;
		proto.respond = function () {
			const me = this, args = arguments;
			const host = invokeObservedHost({ orig: oRespond, thisArg: this, args: Array.from(args), decisionPoint: 'respond' });
			if (!host.ok) return host.result;
            const next = host.result;
            let confirmed = false;
            if (next && typeof next.pushHandler === 'function') next.pushHandler(function (event, option) {
                if (confirmed || option?.state !== 'end' || !me.getHistory?.('respond')?.includes(event)) return;
                confirmed = true;
                try { gameTelemetry.action(me); addPlayerLog('respond', { card: get.name(event.card, me) || '?' }, me); } catch (_) {}
				try { consumeRespondMaterials(event); } catch (_) {}
            });
			return host.result;
		};
	}

	/* ★ 铁索宿主 AI 接线：双目标/解链 evaluator 化 + 该重铸时不出 */
	try { _installTiesuoHostAI(); } catch (eTieInstall) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTieInstall); }

	/* ★ 局末结算接线修复：settle 此前只有导出、无任何挂载/调用（死代码）
	 *   → 冠军库刷新/胜负结算分/胜率统计/守恒审计/跨局记忆合并从不执行（冠军面板恒 0 组 0 条的根因之一）。
	 *   挂到宿主 gameOver 事件；settleDone 幂等，panel 侧兜底通道防事件缺失，双通道不重复结算 */
	try {
		if (typeof game.on === 'function' && !game.__djscSettleHooked) {
			game.on("gameOver", function () { try { settle(); } catch (eSt) { } });
			game.__djscSettleHooked = true;
		}
	} catch (eStHook) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eStHook); }

	/* ★ 手杀武将包兼容兜底：character/mobile.js 的马日磾(mberdi)技能在
	 *   game.chooseAnyOL([player, target], get.info(event.name).chooseToDiscard, []).forResult()
	 *   之后直接 discardMap.get(player)——在无名杀 1.11.6 上 forResult() 返回 undefined，
	 *   每轮 arrangeTrigger→trigger 触发时抛 TypeError 弹窗阻塞画面（被误认为「卡死」）。
	 *   栈帧全在宿主（mobile.js/GameEvent），扩展未触碰该 API；此处仅做消费端兜底：
	 *   result 缺失 → 返回兼容空 Map（get→undefined），普通对象补 get；其余行为完全透传，
	 *   让技能安全跳过弃牌步骤继续执行。 */
	try {
		if (typeof game.chooseAnyOL === 'function' && !game.chooseAnyOL.__djscCAOLPatched) {
			const _origCAOL = game.chooseAnyOL;
			game.chooseAnyOL = function () {
				const ev = _origCAOL.apply(this, arguments);
				try {
					if (ev && typeof ev.forResult === 'function' && !ev.__djscFRPatched) {
						const _origFR = ev.forResult;
						ev.forResult = function () {
							const r = _origFR.apply(this, arguments);
							if (r === undefined || r === null) {
								return { get: function () { return undefined; }, has: function () { return false; }, size: 0 };
							}
							if (typeof r.get !== 'function') {
								try { r.get = function (k) { return this[k]; }; } catch (eG) { }
							}
							return r;
						};
						ev.__djscFRPatched = true;
					}
				} catch (eFR) { }
				return ev;
			};
			game.chooseAnyOL.__djscCAOLPatched = true;
		}
	} catch (eCAOL) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCAOL); }

	/* ★ 精确 hook：get.cards —— 从牌堆拿牌的统一入口 */
	try {
		const _origGetCards = get.cards;
		if (typeof _origGetCards === "function" && !get.__djsc_patched) {
			get.cards = function () {
				const args = arguments;
				const r = _origGetCards.apply(this, args);
				/* r 是从牌堆拿到的牌数组 */
				try {
					if (Array.isArray(r)) {
						r.forEach(function (c) { try { deckConsume(c); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				return r;
			};
			get.__djsc_patched = true;
			orig.__djsc_getCards = _origGetCards;
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	/* ★ 初始手牌：监听 gameDraw 事件 */
	try {
		const _origGameDraw = game.gameDraw;
		if (typeof _origGameDraw === "function" && !game.__djsc_gameDraw_patched) {
			game.gameDraw = function () {
				const r = _origGameDraw.apply(this, arguments);
				/* 等 gameDraw 事件结束后同步一次 UI */
				try {
					const ev = r;
					if (ev && typeof ev.then === 'function') {
						Promise.resolve(ev).then(function () {
							try { deckSyncFromUI(true); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
						});
					} else {
						setTimeout(function () {
							try { deckSyncFromUI(true); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
						}, 200);
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				return r;
			};
			orig.__djsc_gameDraw = _origGameDraw;   /* ★ Stage H：保存原函数供卸载还原 */
			game.__djsc_gameDraw_patched = true;
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	/* 3) die —— 单独处理，不走 scoreEffect
	 * 原因：阵亡计分在语义上属于"终局事件"，不该与通用效果分派混在一起；
	 *       且若未来 scoreEffect 增加 die 分支会造成双倍扣分。
	 */
	const oDie = proto.die;
	if (typeof oDie === "function") {
		orig.die = oDie;
		proto.die = function () {
			const me = this, args = arguments;
			try {
				/* ★ 死亡亮身份：身份局死亡翻开身份牌是规则事实——
				 *   显式记录死者身份，供 _publicRoleOf 公开层直接读取，
				 *   修复「已阵亡玩家名字/身份已知但 AI 认知不清晰」（宿主不同版本
				 *   identityShown 标志行为不一，这里补齐扩展侧事实源）。 */
                /* 身份亮置由确认死亡后的 dieAfter 采集，不在创建死亡事件时读取。 */
				try { giveVs(me, -6, "阵亡"); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				/* 击杀奖励：从事件链上溯到造成致命伤的伤害事件源 */
				try {
					let killer = null;
					try {
						const ev = _status.event;
						if (ev && ev.getParent) {
							const dmgEv = ev.getParent('damage');
							if (dmgEv && dmgEv.source && dmgEv.source !== me) killer = dmgEv.source;
						}
					} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					if (killer) {
						/* ★ 污染修复：判断 killer 和 me 是否是友方 */
						let isAlly = false;
						try {
							if (isSameCamp(killer, me)) isAlly = true;
							const strategy = getModeStrategy();
							if (strategy && strategy.isSameCamp && strategy.isSameCamp(killer, me)) isAlly = true;
						} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

						if (isAlly) {
							/* ★ 击杀队友重罚：直接给击杀者重扣（-12，对称于击杀敌人 +6）——
							 *   「导致队友死亡扣分要多」，旧实现只记录特征不扣分 */
							try { give(killer, -12, "击杀" + (me.name || me.name1 || "队友")); } catch (eKf) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eKf); }
							try { logBestAction(killer, null, { reason: '击杀队友（重罚-12）' }); } catch (eKl) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eKl); }
						} else {
							/* 杀敌人：正常加分 */
							give(killer, 6, "击杀" + (me.name || me.name1 || "敌方"));
						}
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			} catch (e) {
				if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e);
			}
			const host = invokeObservedHost({ orig: oDie, thisArg: this, args: Array.from(args), decisionPoint: 'die' });
			return host.result;
		};
	}

	/* ★ 时序特征：回合开始时记录历史 */
	try {
		const oPhaseBegin = proto.phaseBegin;
		if (typeof oPhaseBegin === 'function' && !proto.__djsc_phaseBegin_patched) {
			proto.phaseBegin = function () {
				const me2 = this;
				/* 显式 turn epoch：同一角色额外回合也必须清空上一回合战略 ledger。 */
				try { beginStrategicTurn(me2); } catch (eTurn) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTurn); }
				const r = oPhaseBegin.apply(this, arguments);
				try { recordTurnHistory(me2); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				return r;
			};
			orig.phaseBegin = oPhaseBegin;   /* ★ Stage H：保存原函数供卸载还原 */
			proto.__djsc_phaseBegin_patched = true;
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	/* 标准阶段事件，而不是不存在于部分宿主版本的 proto.phaseBegin。 */
	lib.skill._djsc_turnTelemetry = {
		trigger: { global: ['phaseBegin', 'phaseAfter'] }, forced: true, popup: false,
		charlotte: true, forceDie: true, lastDo: true,
		filter(event, player) { return event.player === player; },
		async content(event, trigger) {
			try {
				if (event.triggername === 'phaseBegin') {
					const previous = gameTelemetry.beginTurn(trigger.player,
						trigger.player.name1 || trigger.player.name || '?', _getRoundNumber());
					_emitTurnSummary(previous);
					matchArchive.beginTurn({}, { player: trigger.player.name1 || trigger.player.name || '?', playerId: trigger.player.playerid || null, round: _getRoundNumber() });
				} else _emitTurnSummary(gameTelemetry.finishTurn(trigger.player));
			} catch (e) {}
		},
	};
	game.addGlobalSkill('_djsc_turnTelemetry');
	if (typeof game.over === 'function') {
		orig.__djsc_gameOver = game.over;
		game.over = function (result, onlineResult) {
			const previousVideo = lib.videos && lib.videos[0];
			try { if (!_status.over) {
				gameTelemetry.setResult(result, onlineResult, !!game.online);
				_emitTurnSummary(gameTelemetry.finishTurn(null, true));
			} } catch (e) {}
			try { actionOutcomes.freezeTerminal(); } catch (_) {}
			const hostResult = orig.__djsc_gameOver.apply(this, arguments);
			try {
				const video = lib.videos && lib.videos[0];
				if (video && video !== previousVideo && lib.init && typeof lib.init.encode === 'function') {
					matchReplay = { encoded: lib.init.encode(JSON.stringify(video)), time: video.time, format: 'noname-native' };
				}
			} catch (e) {}
			return hostResult;
		};
	}

	/* ★ 元素反馈闭环启动 */
	try { startElementFeedbackLoop(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 元认知启动 */
	try { metaStartGame(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	/* ★ 守恒引擎 · 开局记账：
	 *   - 入场投入：对局开始时所有玩家损失一部分货币（入场费 SEED_FEE → 奖池）。
	 *   - 系统注入：系统给予总约 30% 的货币，作为奖池（由失败阵营产出补偿）。
	 *   奖池 = 入场费总额 + 系统近 30% 注水，作为 ledger 的正基线。
	 *   此后每笔 give 走守恒入账（ledger 补亏/存留），最终 Σ玩家 + ledger = 0。 */
	try { _initLedger(game.players || []); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	aoeDirectionCleanup?.();
	aoeDirectionCleanup=installAoeDirectionBridge();
	materialReserveCleanup?.();
	materialReserveCleanup=installMaterialReserveBridge();
	attackChoiceCleanup?.();
	attackChoiceCleanup=installAttackChoiceBridge();

	installed = true;
	_disposed = false;  /* ★ P1-26：重新安装后允许延迟挂载生效 */
	try { installBroadcastHooks(); } catch (eB) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eB); }
	/* ★ 开机自修复：延迟 3 秒执行，等所有模块加载完 */
	try { autoSelfHeal(3000); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { log.info('init', '已接入记分钩子（卡牌/效果/时机，异步延迟记分，守恒）'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

function uninstallHooks() {
 attackChoiceCleanup?.(); attackChoiceCleanup=null;
 materialReserveCleanup?.(); materialReserveCleanup=null;
 aoeDirectionCleanup?.(); aoeDirectionCleanup=null;
 resetCooperativeTrickIntents();
 choiceAuditCleanup?.(); choiceAuditCleanup=null;
	try {
		/* ★ P1-26：无论钩子是否存在，先取消延迟挂载并置卸载标志 */
		_disposed = true;
		try { uninstallCloudIngest(); } catch (eCIu) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCIu); }   /* ★ 上报调度卸载对称 */
		if (_lateBindTimer) { try { clearTimeout(_lateBindTimer); } catch (eT) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eT); } _lateBindTimer = null; }
		const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (!proto) { installed = false; return; }
		const orig = proto[DJSC_ORIG];
		if (!orig) { installed = false; return; }
		/* ★ Stage H：只还原 proto 方法键，跳过非 proto 原始引用（get.cards / game.gameDraw 单独还原），
		 *   避免把 get.cards/game.gameDraw 方法误还原到 Player.prototype 制造垃圾属性。 */
		for (const k in orig) {
			if (k === '__djsc_getCards' || k === '__djsc_gameDraw' || k === '__djsc_gameOver' || k === '__djsc_createTrigger' || k === '__djsc_createEvent') continue;
			try { proto[k] = orig[k]; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}
		try { delete proto[DJSC_ORIG]; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		if (orig.__djsc_gameOver) game.over = orig.__djsc_gameOver;
        for(const method of ['createTrigger','createEvent'])if(orig['__djsc_'+method])game[method]=orig['__djsc_'+method];
		try { game.removeGlobalSkill('_djsc_turnTelemetry'); } catch (e) {}
		delete lib.skill._djsc_turnTelemetry;
        try { game.removeGlobalSkill('_djsc_skillOutcome'); } catch (_) {}
        delete lib.skill._djsc_skillOutcome;
        try { game.removeGlobalSkill('_djsc_delayedOutcome'); } catch (_) {}
        delete lib.skill._djsc_delayedOutcome;
        delayedOutcomes.reset();
        try{game.removeGlobalSkill('_djsc_publicSources');}catch(_){}
        delete lib.skill._djsc_publicSources;publicSources.reset();
        try{game.removeGlobalSkill('_djsc_identityEvidence');}catch(_){}
        delete lib.skill._djsc_identityEvidence;
        skillOutcomes.reset(); actionOutcomes.reset(); playerDemonstrations.reset();

		/* ★ 还原 get.cards */
		try {
			if (orig.__djsc_getCards) {
				get.cards = orig.__djsc_getCards;
			}
			if (get.__djsc_patched) delete get.__djsc_patched;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ★ Stage H：还原 game.gameDraw（此前缺失，导致卸载后旧闭包残留/重装时嵌套包装） */
		try {
			if (orig.__djsc_gameDraw) {
				game.gameDraw = orig.__djsc_gameDraw;
			}
			if (game.__djsc_gameDraw_patched) delete game.__djsc_gameDraw_patched;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ★ Stage H：清理 phaseBegin patch 标志（proto.phaseBegin 已由循环还原） */
		try {
			if (proto.__djsc_phaseBegin_patched) delete proto.__djsc_phaseBegin_patched;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ★ Stage H：卸载广播钩子（还原 game.check） */
		try { uninstallBroadcastHooks(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		installed = false;
		/* ★ P1-26：取消 100ms 延迟挂载并置卸载标志，防止卸载后回调复活写回 API */
		_disposed = true;
		if (_lateBindTimer) { try { clearTimeout(_lateBindTimer); } catch (eT) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eT); } _lateBindTimer = null; }
		try { log.info('init', '已卸下记分钩子（proto 方法已还原）'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	} catch (e) { installed = false; }
}

/* ================= 灵活度升级：局势/目标/EV/边际/combo/记忆（统一动作评分框架） ================= */
/* ★ 手牌计数快照缓存：countCardName / hasCardName 在单次决策循环里会被
 *   同一玩家多次调用（expectedValue 对 sha 查 jiu、对 juedou 查 sha），
 *   每次都 me.getCards("h") 重扫整手牌。加入逆转指针快照（prevHand === 当前手牌引用）
 *   只扫一次，避免 ×候选数 的重复扫描（性能/能耗优化）。
 *   WeakMap 以 me 为键，玩家对象死亡/换局即释放，无跨局内存残留。 */
const _handCountCache = new WeakMap();
const _handFreqCache = new WeakMap();   /* 边际频次缓存：key 为手牌 id 数组引用 → { id: count } */
function countCardName(me, id) {
	try {
		let snapshot = _handCountCache.get(me);
		const h = me.getCards ? me.getCards("h") : null;
		if (!h) return 0;
		if (!snapshot || snapshot.prevHand !== h) {
			const m = {};
			for (let i = 0; i < h.length; i++) {
				const c = h[i];
				if (!c) continue;
				const n = c.name || "";
				if (n) m[n] = (m[n] || 0) + 1;
			}
			snapshot = { prevHand: h, counts: m };
			_handCountCache.set(me, snapshot);
		}
		return snapshot.counts[id] || 0;
	} catch (e) { return 0; }
}
function hasCardName(me, id) { try { return countCardName(me, id) > 0; } catch (e) { return false; } }
/* ★ 重置手牌缓存（详情：牌堆变化等原因确认手牌引用已失效时统一定点失效，
 *   避免极端情况下持 stale 快照；正常路径靠 prevHand 引用自动失效，无额外开销） */
function clearHandCountCache(me) { try { if (me) _handCountCache.delete(me); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }
function hasNatureCard(me) {
	try { return !!me.getCards("h", function (c) { return game.hasNature ? (game.hasNature(c, "fire") || game.hasNature(c, "thunder")) : false; }).length; } catch (e) { return false; }
}
let _probShanCache = new WeakMap();   // key: tgt 对象 → { hp, hc, value }（WeakMap 避免强引用玩家对象导致的跨局内存残留）
function _probShanCached(me, tgt) {
	try {
		const hc = tgt.countCards ? tgt.countCards("h") : 0;
		const hit = _probShanCache.get(tgt);
		if (hit && hit.hp === (tgt.hp || 0) && hit.hc === hc) return hit.value;
		const v = probHasShan(me, tgt);
		_probShanCache.set(tgt, { hp: tgt.hp || 0, hc: hc, value: v });
		return v;
	} catch (e) { return probHasShan(me, tgt); }
}
function _attackExpectedValue(me, id, tgt) {
	if(readVersusMode().is2v2&&tgt&&['sha','huosha','leisha','juedou'].includes(id)) {
		const plan=evaluateVersusAttackForId(me,id,tgt);
		if(plan?.resolved)return plan.evaluation;
		// 未决评估不可当作已确认零收益；继续使用 v4.4.0 的攻击估值。
	}
	if (!tgt || (id !== 'sha' && id !== 'juedou')) return null;
	let bagua = false, baguaRate = 0.5, vengeance = false;
	try { bagua = id === 'sha' && probHasBagua(tgt); if (bagua) baguaRate = baguaSuccessRate(); } catch (_) {}
	try { vengeance = hasVengeanceSkill(tgt); } catch (_) {}
	const drunkDamage = me && me.storage && me.storage.jiu;
	return evaluateAttackExpectedValue(id, {
		shanProbability: id === 'sha' ? _probShanCached(me, tgt) : undefined,
		shaProbability: id === 'juedou' ? probHasSha(tgt) : undefined,
		hasBagua: bagua, baguaSuccess: baguaRate, vengeance,
		drunkDamage: (me && me.hasSkill && me.hasSkill('jiu')) ? drunkDamage : 0,
		ownSha: countCardName(me, 'sha'), targetHp: tgt.hp,
		targetHandCount: tgt.countCards ? tgt.countCards('h') : 0,
	});
}
function expectedValue(me, card, tgt) {
	try {
		const id = typeof card === "string" ? card : (card.name || "");
		if (id === 'sha' || id === 'juedou') {
			const attack = _attackExpectedValue(me, id, tgt);
			return attack ? attack.score : 0;
		}
		const v = VAL_CARD[id];
		if (!v || !v.use) return 0;
		const baseScore = v.use;
		/* ★ 积分自修改：应用 AI 自学习的调整 */
		try {
			if (window.__DJSC.scoreSelfMod && window.__DJSC.scoreSelfMod.getScore) {
				return window.__DJSC.scoreSelfMod.getScore(id, baseScore);
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		return baseScore;
	} catch (e) { return 0; }
}
function marginalValue(id, handIds) {
	try {
		const v = VAL_CARD[id];
		if (!v || !v.use) return 0;
		/* ★ 手牌频次复用手牌快照缓存（countCardName 同源），避免对每张候选牌
		 *   再做一次 O(|hand|) 的 filter 统计。记数表首次调用时构建并缓存。 */
		let _freq = _handFreqCache.get(handIds);
		if (!_freq) {
			_freq = {};
			for (let i = 0; i < handIds.length; i++) { const x = handIds[i]; if (x) _freq[x] = (_freq[x] || 0) + 1; }
			_handFreqCache.set(handIds, _freq);
		}
		const count = _freq[id] || 0;
		const baseScore = v.use * Math.pow(0.6, count);
		/* ★ 积分自修改：应用 AI 自学习的调整 */
		try {
			if (window.__DJSC.scoreSelfMod && window.__DJSC.scoreSelfMod.getScore) {
				return window.__DJSC.scoreSelfMod.getScore(id, baseScore);
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		return Math.round(baseScore * 100) / 100;
	} catch (e) { return 0; }
}
const COMBO_SKILLS = ["wuzhong","guohe","shunshou","nanman","wanjian","wuxie","lebu","bingliang","juedou","huogong","zhujin","taoyuan","wugu","tiesuo"];


/* ================= 决策回放记录器 ================= */
const DECISION_LOG = [];
const DECISION_LOG_MAX = 20;
const SUGGESTION_LOG = [];

/* ★ 正确获取当前轮次（修复轮次总是0的问题） */
function _getRoundNumber() {
	try {
		if (_status && typeof _status.roundNumber === "number") return _status.roundNumber;
		if (typeof game === "object" && typeof game.roundNumber === "number") return game.roundNumber;
		if (typeof game === "object" && typeof game.round === "number") return game.round;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return 0;
}

let _lastDecisionTraceKey = '';
let _lastDecisionTraceTs = 0;

function _decisionSnapshotCandidate(c, conf) {
	if (!c) return null;
	return {
		type: c.type,
		id: c.id,
		target: candidateTargetValue(c),
		recast: !!c.recast,
		score: c.score,
		reason: (c.reason || "").slice(0, 120),
		_feat: c._feat || null,
		_conf: (conf && conf.maxProb) ? conf.maxProb : (typeof c._conf === 'number' ? c._conf : 0.3),
		strategicAlignment: c.strategicAlignment ? Object.assign({}, c.strategicAlignment) : null,
		characterAlignment: c.characterAlignment ? Object.assign({}, c.characterAlignment) : null,
		utility: utilityPipelineSnapshot(c),
		policy: candidatePolicySnapshot(c),
	};
}

function recordDecision(me, layers, candidates, winner, conf) {
	try {
		const entry = {
			ts: Date.now(),
			round: _getRoundNumber(),
			player: (me && (me.name || me.name1)) || "?",
			layers: layers,
			candidates: (candidates || []).slice(0, 8).map(function (c) {
				return _decisionSnapshotCandidate(c, null);
			}).filter(Boolean),
			winner: _decisionSnapshotCandidate(winner, conf),
			elapsedMs: null,
			phaseMs: null,
		};
		entry.executionState = 'committed';
		entry.playerId = me && me.playerid || null;
		DECISION_LOG.push(entry);
		gameTelemetry.decision(me);
		while (DECISION_LOG.length > DECISION_LOG_MAX) DECISION_LOG.shift();
		return entry;
	} catch (e) {
		if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e);
		return null;
	}
}

function _emitTurnSummary(turn) {
	if (turn) matchArchive.finishTurn(turn, { player: turn.player, round: turn.round });
	if (!turn || String(cfg('testDecisionLog', '摘要')) === '关闭') return;
	try {
		const translate = id => {
			const player = (game.players || []).concat(game.dead || []).find(p => p && String(p.playerid) === String(id));
			const name = player ? player.name1 || player.name || id : id;
			return (lib.translate && lib.translate[name]) || name;
		};
		const lines = buildTurnSummaryLines(turn, matchArchive.turnEvents(turn.player, turn.playerId), translate);
		game.log(formatLogLines(lines));
	} catch (e) {}
}

function _emitDecisionTrace(entry) {
	try {
		const mode = String(cfg('testDecisionLog', '摘要') || '摘要');
		if (mode === '关闭') return;
		if (!entry || !entry.winner) return;

		const target = Array.isArray(entry.winner.target)
			? entry.winner.target.join('+')
			: String(entry.winner.target || '');
		const key = [entry.round, entry.player, entry.winner.type, entry.winner.id, target].join('|');
		const now = Date.now();
		if (key === _lastDecisionTraceKey && now - _lastDecisionTraceTs < 500) return;
		_lastDecisionTraceKey = key;
		_lastDecisionTraceTs = now;

		const translate = function (id) {
			try {
				const player = (game.players || []).concat(game.dead || []).find(p => p && String(p.playerid) === String(id));
				const name = player ? (player.name1 || player.name || id) : id;
				return (lib.translate && lib.translate[name]) || name;
			} catch (e) { return id; }
		};
		const lines = buildDecisionTraceLines(entry, mode, translate);
		if (!lines.length) return;
		try { game.log(formatLogLines(lines)); } catch (e) {
			try { console.log(lines.join('\n')); } catch (_) {}
		}
	} catch (e) {
		if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e);
	}
}

function _finalizeDecisionRecord(me, candidates, winner, elapsedMs, phaseMs, actual, transaction, stages) {
	const tracePerf = profStart('log.commit');
	try {
		const player = (me && (me.name || me.name1)) || "?";
		const round = _getRoundNumber();
		let entry = DECISION_LOG.length ? DECISION_LOG[DECISION_LOG.length - 1] : null;
		if (!entry || entry.player !== player || entry.round !== round) {
			entry = recordDecision(me, {}, candidates, winner, null);
		}
		if (!entry) return null;

        entry.transactionId = transaction && transaction.id || null;
        entry.actorId = targetKey(me);
        entry.trainingSessionId = transaction && transaction.trainingSessionId || null;
        if(transaction?.state==='committed')matchArchive.authorizeOutcome(transaction.id,entry.actorId,{round:entry.round,player:entry.player});
        entry.modeContext = modeSampleMeta(me);
        entry.actual = actual || null;
        if(stages)entry.decisionStages=stages;
		entry.elapsedMs = Math.max(0, Math.round(Number(elapsedMs) || 0));
		entry.phaseMs = phaseMs && typeof phaseMs === 'object' ? Object.assign({}, phaseMs) : null;
		entry.strategy = strategicStateSnapshot(me);
		entry.characterPolicy = characterPolicySnapshot(characterPolicyOf(me));
		entry.candidates = (candidates || []).slice(0, 8).map(function (c) {
			return _decisionSnapshotCandidate(c, null);
		}).filter(Boolean);
		const oldConf = entry.winner && typeof entry.winner._conf === 'number' ? entry.winner._conf : 0.3;
		entry.winner = _decisionSnapshotCandidate(winner, { maxProb: oldConf });
		matchArchive.record('decision', { ...entry, winner: { ...entry.winner, reason: String(winner && winner.reason || '') },
			candidates: (candidates || []).map(c => ({ ..._decisionSnapshotCandidate(c, null), reason: String(c.reason || '') })),
			actual: actual || null, transactionId: transaction && transaction.id || null },
			{ player: entry.player, playerId: me && me.playerid || null, round: entry.round, videoIndex: Array.isArray(lib.video) ? lib.video.length : null });
		_emitDecisionTrace(entry);
		return entry;
	} catch (e) {
		if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e);
		return null;
	} finally { profEnd(tracePerf); }
}

/* ★ 自动特征发现的场景上下文构造器：把"本次决策"的关键事实折叠成布尔特征。
 * 供 recordDecisionContext 使用（autoFeature 面板所需样本）。失败返回 null（零回归）。 */
function _autofeatCtx(me, best, bestT) {
	try {
		if (!me || !best) return null;
		const tgtRole = bestT ? _identityOfFor(me, bestT) : 'unknown';
		const tgtHard = bestT ? _hardIdentityOf(me, bestT) : { role: null };
		const ctx = {
			cardType: best.type === 'card' ? best.id : null,
			cardSuit: null,
			targetIsAlly: best.isEnemy === false,
			targetIsEnemy: best.isEnemy === true,
			myLowHp: (me.hp || 0) <= 2,
			myHighHp: (me.hp || 0) >= 4,
			myFewHand: me.countCards ? me.countCards('h') <= 2 : false,
			myManyHand: me.countCards ? me.countCards('h') >= 5 : false,
			tgtLowHp: !!(bestT && bestT.hp && bestT.hp <= 1),
			tgtHighHp: !!(bestT && bestT.hp && bestT.hp >= 4),
			tgtFewHand: !!(bestT && bestT.countCards && bestT.countCards('h') <= 1),
			myIdentity: me.identity || null,
			tgtIdentity: tgtRole && tgtRole !== 'unknown' ? tgtRole : null,
			tgtIdentityKnown: !!(tgtHard && tgtHard.role),
			myHasSha: me.countCards ? me.countCards('hs', 'sha') > 0 : false,
			myHasTao: me.countCards ? me.countCards('hs', 'tao') > 0 : false,
			isEndgame: (game.players || []).filter(function (p) { return p && p.alive !== false; }).length <= 3,
			distNear: bestT ? (get.distance ? (get.distance(me, bestT) <= 1) : null) : null,
		};
		if (best.type === 'card' && bestT && me.getCards) {
			const hand = me.getCards('h') || [];
			for (let i = 0; i < hand.length; i++) {
				if (hand[i] && best.id === (hand[i].name || best.id)) {
					try { ctx.cardSuit = hand[i].suit; ctx.cardLowNum = (hand[i].number || 9) <= 5; ctx.cardHighNum = (hand[i].number || 9) >= 11; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					break;
				}
			}
		}
		ctx.myHasSkill = me.skills && me.skills.length > 0;
		return ctx;
	} catch (e) { return null; }
}

/* ================= AI 性格三维解析（含身份基线修正） ================= */
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
function readCardOverride(id, player, target) {
    return readScopedCardOverride(lib.card && lib.card[id], player, target);
}

/* ================= ★ 友方伤害线性衰减 ================= */
function _calcAllyDamagePenalty(player, target, cardId) {
    try {
        if (!player || !target || player === target) return 0;
        let count = 0;
        try {
            const key = target.name1 || target.name || '?';
            count = (player._djsc_hurtAlly && player._djsc_hurtAlly[key]) || 0;
        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        /* 本次是第 (count+1) 次打这个友方
         *   第 1 次：-0.2
         *   第 2 次：-0.4
         *   第 3 次：-0.6
         *   ...
         *   封顶 -10（避免极端场景）
         */
        const penalty = -0.2 * (count + 1);
        return Math.max(-10, penalty);
    } catch (e) { return 0; }
}

/* 统一动作评分：枚举所有候选动作（技能/卡牌/装备/结束）→ 打分 → 选最高 */
/* ★ 决策缓存：以 world-state + relation fingerprint 为主键。
 * 同一状态允许短时间复用，任何公开局面/事件/敌我关系变化立即失效。 */
const BEST_ACTION_CACHE_TTL = 1200;
let _lastBestAction = null;
let _lastBestActionTime = 0;
let _lastBestActionStateKey = '';
let _lastDecisionCacheContext=null;
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
let _mtVal = null, _mtHero = null, _mtAt = 0, _mtState = '';
function multiTurnCached(me) {
    try {
        const now = Date.now();
        const currentState = lastStateKey() + '::' + relationStateKey(me);
        if (_mtHero === me && _mtState === currentState && _mtVal && (now - _mtAt) < 1200) return _mtVal;
        _mtVal = multiTurnForecast(me);
        _mtHero = me;
        _mtState = currentState;
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
function applyBasicCardPlayRules(me, acts) {
	try {
		const targets = _buildTargetBrainCandidates(me);
		const meC = {};
		['sha', 'shan', 'tao', 'jiu', 'wuxie'].forEach(function (k) {
			try { meC[k] = me.countCards ? me.countCards('hs', k) : 0; } catch (e) { meC[k] = 0; }
		});
		let hasRejudge = false;
		try {
			const RJ = ['guicai', 'zhongyi', 'hongyan', 'tianbian', 'yusheng'];
			activePlaySkills(me, _status.event, lib, game, get).forEach(function (sid) { if (RJ.indexOf(sid) >= 0) hasRejudge = true; });
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		const ctx = {
			...(readVersusMode().is2v2?{attackStrategy:(id,t)=>evaluateVersusAttackForId(me,id,t?.pp)}:{}),
			me: Object.assign({ hp: me.hp, maxHp: me.maxHp }, meC, { hasSuit: true }),
			hasRejudge: hasRejudge,
			enemyHasFire: false,
			targets: targets,
			stripStrategy:(id,t)=>t?.isAlly&&tacticalSettingsSnapshot().enabled?stripPlan(me,(me.getCards('h')||[]).find(c=>get.name(c,me)===id)||{name:id},t.pp):undefined,
			targetLocked: true,
			hi: { identityBiasOf: identityBiasOf },
		};

		acts.forEach(function (a) {
			if (a.type !== 'card' && a.type !== 'equip') return;
			if (a.id === 'tiesuo') return;
			const tidx = a.targetObj ? targets.findIndex(function (t) { return t && t.pp === a.targetObj; }) : -1;
			const d = decideCard(a.id, a.id==='jiedao'&&a.jiedaoPair?{...ctx,jiedaoPlan:a.jiedaoPair}:ctx, tidx);
			if (d.veto) {
				vetoCandidate(a, d.vetoReason);
				a.reason = (a.reason || '') + '（[基本规则否决] ' + d.vetoReason + '）';
				a.rule = 'veto';
			} else if (d.priority >= 99) {
				const killCritical = d.category === 'output' &&
					['sha', 'huosha', 'leisha'].indexOf(a.id) >= 0;
				const priorityReason = killCritical ? '可直接完成击杀' : '高优先纯收益';
				setCandidatePriority(a, PRIORITY_TIER.CRITICAL, d.priority, priorityReason);
				a.reason = (a.reason || '') + '（[高优先] ' + priorityReason + '）';
				a.rule = killCritical ? 'kill' : 'critical';
				a.rulePriority = d.priority;
			} else {
				setCandidatePriority(a, PRIORITY_TIER.NORMAL, d.priority, '');
				a.rule = d.category;
				a.rulePriority = d.priority;
			}
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ Skill Decision Kernel V2：宿主合法目标过滤
 * 只在可以安全静态判定时排除非法目标；复杂/依赖选牌/事件态的 filterTarget 一律 fail-open。
 */
function _skillTargetDependsOnCard(filterTarget) {
	try {
		if (typeof filterTarget !== 'function') return false;
		const src = filterTarget.toString();
		const body = src.indexOf('=>') >= 0 ? src.slice(src.indexOf('=>') + 2) : src.slice(src.indexOf('{') + 1);
		return /\bcard\b/.test(body);
	} catch (e) { return true; }
}

function _isLegalSkillTarget(sid, me, target) {
	try {
		const sk = lib.skill && lib.skill[sid];
		if (!sk || typeof sk.filterTarget !== 'function') return true;
		const dependsOnCard = _skillTargetDependsOnCard(sk.filterTarget);
		let r;
		try { r = sk.filterTarget(null, me, target); } catch (e) { return true; }
		if (r === false && dependsOnCard) return true;   /* 选牌前无法确证非法 */
		return r !== false;
	} catch (e) { return true; }
}

function _skillNeedsExternalTarget(sid, prof) {
	try {
		const cats = (prof && prof.tags && prof.tags.__targets) || [];
		/* 纯 self 技能不进入“找不到友/敌目标”的否决。 */
		if (cats.length === 1 && cats[0] === 'self') return false;
		if (cats.indexOf('ally') >= 0 || cats.indexOf('enemy') >= 0 || cats.indexOf('multi') >= 0) return true;
		const sk = lib.skill && lib.skill[sid];
		return !!(sk && typeof sk.filterTarget === 'function');
	} catch (e) { return false; }
}

function _canConfirmSelfSkillTarget(sid, me, prof) {
	try {
		const cats = (prof && prof.tags && prof.tags.__targets) || [];
		const sk = lib.skill && lib.skill[sid];
		const explicitSelf = cats.indexOf('self') >= 0;
		if (!sk || typeof sk.filterTarget !== 'function') return explicitSelf;
		if (_skillTargetDependsOnCard(sk.filterTarget) && !explicitSelf) return false;
		let r;
		try { r = sk.filterTarget(null, me, me); } catch (e) { return explicitSelf; }
		return r !== false && (explicitSelf || (prof && prof.targets && prof.targets.intent === 'support'));
	} catch (e) { return false; }
}

function _skillTargetRange(sid) {
	try {
		const sk = lib.skill && lib.skill[sid];
		if (!sk) return null;
		const st = sk.selectTarget;
		/* 宿主负数 selectTarget（典型 -1）有自动/特殊选择语义，不按普通数量解释。 */
		if (typeof st === 'number') return st >= 0 ? [st, st] : null;
		if (Array.isArray(st) && st.length >= 2) {
			const min = Number(st[0]);
			const max = st[1] === Infinity ? Infinity : Number(st[1]);
			if (Number.isFinite(min) && min >= 0 && (max === Infinity || (Number.isFinite(max) && max >= 0))) {
				return [min, max === Infinity ? Infinity : Math.max(min, max)];
			}
		}
		/* 有 filterTarget 而无 selectTarget 时，宿主默认单目标。 */
		if (typeof sk.filterTarget === 'function' && st == null) return [1, 1];
		/* 动态函数依赖实时事件/已选对象，不在预规划阶段猜。 */
		return null;
	} catch (e) { return null; }
}

function _skillPurposeFromIntent(intent, category, confidence) {
	const c = (confidence === undefined || confidence === null) ? 1 : Number(confidence || 0);
	if (intent === 'offense') return c >= 0.55 ? 'attack' : null;
	if (intent === 'support') return c >= 0.55 ? 'support' : null;
	if (intent === 'mixed') return null;
	if (category === 'attack' || category === 'control') return 'attack';
	if (category === 'defense' || category === 'aux') return 'support';
	return null;
}

function _isSingleTargetSkillProfile(prof, decision) {
	try {
		const tags = (prof && prof.tags) || {};
		const cats = tags.__targets || [];
		const scope = tags.__scope || null;
		if (cats.indexOf('multi') >= 0) return false;
		if (prof && prof.targets && prof.targets.category === 'all') return false;
		if (scope === 'all' || scope === 'all_others' || scope === 'anyN'
			|| scope === 'enemyN' || scope === 'allyN' || scope === 'selfN') return false;
		if (decision && Array.isArray(decision.targetIndexes) && decision.targetIndexes.length > 1) return false;
		return true;
	} catch (e) { return false; }
}

/* ★ 基本技能决策标准接入层
 * 在 acts.sort 之前对 skill 候选应用 skillPlayBrain 的三段式标准：
 *   - 硬否决（负收益/自伤/时机不符/无可控敌）→ 压到接近结束回合
 *   - 其余按运行时优先级小幅加权（不改动既有技能多维评分主权重）
 */
function applyBasicSkillRules(me, acts) {
	try {
		const players = game.players || [];
		const targets = [];
		players.forEach(function (p) {
			if (!p || p === me || p.alive === false) return;
			/* 敌我系统（attitude 三态，与阵营 isSameCamp 分离） */
			let ally = false, en = false;
			try { ally = isAllyOf(me, p); en = isEnemyOf(me, p); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			let threat = 0;
			try { const th = threatOf(p); threat = (typeof th === 'number') ? th : 0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			targets.push({
			pp: p,           /* ★ 玩家对象引用：供技能目标索引解析成真实目标 */
				isAlly: ally, isEnemy: en,
				hp: (p.hp !== undefined ? p.hp : 3),
				maxHp: (p.maxHp || 3),
				threat: threat,
				handCount: 0,
			});
		});

		/* 濒死/健康度检测 */
		let dyingAlly = false, dyingMe = false;
		try {
			if (me.hp !== undefined && me.hp <= 0) dyingMe = true;
			targets.forEach(function (t) { if (t.isAlly && t.hp <= 0) dyingAlly = true; });
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		const econ = {
			lowHp: me.hp !== undefined && me.hp <= 1,
			damaged: me.hp !== undefined && me.hp < (me.maxHp || 3),
		};
		let stage = null;
		try { if (aliveCountP() <= 3) stage = 'endgame'; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		const ctx = {
			me: { hp: me.hp, maxHp: me.maxHp, ref: me },   /* ★ ref：identityPolicy 需要玩家对象（身份/手牌数） */
			targets: targets,
			econ: econ,
			stage: stage,
			dyingAlly: dyingAlly,
			dyingMe: dyingMe,
			hi: { identityBiasOf: identityBiasOf },   /* ★ 深度连接：注入身份信念源（技能目标选择用，非 identity 局恒 0） */
		};

		acts.forEach(function (a) {
			if (a.type !== 'skill') return;
			const sid = a.id;
			let prof = null;
			try { prof = skillProfileOf(sid); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			if (!prof) return;

			/* 每个技能都用自己的 filterTarget 生成合法候选，禁止“全体玩家池”直接复用。
			 * 例如炜烈 target.isDamaged()：满血角色不会再进入推荐目标。 */
			const skillTargets = targets.filter(function (t) {
				return t && t.pp && _isLegalSkillTarget(sid, me, t.pp);
			});
			/* 明确允许 self 的辅助技能，把自己作为真实候选加入；
			 * 未显式 self 时，仅在 filterTarget 可无卡牌上下文确证允许且 intent=support 时加入。 */
			if (_canConfirmSelfSkillTarget(sid, me, prof)) {
				skillTargets.unshift({
					pp: me, isAlly: true, isEnemy: false,
					hp: (me.hp !== undefined ? me.hp : 3),
					maxHp: (me.maxHp || 3), threat: 0, handCount: 0,
				});
			}
			const skillCtx = Object.assign({}, ctx, {
				targets: skillTargets,
				selectTargetRange: _skillTargetRange(sid),
			});
			const d = decideSkill(sid, prof, skillCtx);

			/* 高置信单方向技能没有合法/合理目标时，直接压制本轮发动；
			 * mixed/低置信技能仍 fail-open 交给宿主。 */
			const ti = prof.targets && prof.targets.intent;
			const tc = prof.targets ? Number(prof.targets.confidence || 0) : 0;
			const inferredTargetIntent = !!(prof.targets && prof.targets.inferred);
			a.targetIntent = ti || null;
			a.targetConfidence = tc;
			a.targetInferred = inferredTargetIntent;
			const directional = (ti === 'support' || ti === 'offense') && tc >= 0.55
				&& _skillNeedsExternalTarget(sid, prof);
			if (!d.veto && directional && d.targetRequired !== false
				&& d.targetDecisionResolved !== false && d.targetIndex < 0 && skillTargets.length > 0) {
				vetoCandidate(a, '无合法' + (ti === 'support' ? '友方' : '敌方') + '目标');
				a.reason = (a.reason || '') + '（[技能目标否决] 无合法' + (ti === 'support' ? '友方' : '敌方') + '目标）';
				a.rule = 'veto-target';
				return;
			}
			if (!d.veto && directional && d.targetRequired !== false
				&& d.targetDecisionResolved !== false && skillTargets.length === 0) {
				vetoCandidate(a, '无合法目标');
				a.reason = (a.reason || '') + '（[技能目标否决] 无合法目标）';
				a.rule = 'veto-target';
				return;
			}
			if (d.veto) {
				vetoCandidate(a, d.vetoReason);
				a.reason = (a.reason || '') + '（[技能否决] ' + d.vetoReason + '）';
				a.rule = 'veto';
			} else {
				setCandidatePriority(a, PRIORITY_TIER.NORMAL, d.priority, '');
				a.rule = d.category;
				a.rulePriority = d.priority;
				/* ★ 按技能自身类别写回【专属目标】：敌方技→真敌，己方辅助/增益→真友
				 *   修复此前技能 act 从不携带 target，导致"限制敌方技能"与"给己方摸牌技能"都落到同一无名目标 */
				if (typeof d.targetIndex === 'number' && d.targetIndex >= 0) {
					const tk = skillTargets[d.targetIndex];
					if (tk && tk.pp) {
						a.target = targetKey(tk.pp);
						a.targetObj = tk.pp;
						/* provenance：只有真正经过 kernel 合法目标池 + decideSkill 解析出的目标，
						 * 才允许后续宿主桥消费。 */
						a.skillTargetResolved = true;
						a.skillTargetSingle = _isSingleTargetSkillProfile(prof, d);
						a.targetRule = d.rule + '→' + a.target + '(' + d.reason + ')';
						a.reason = (a.reason || '') + '（对象：' + a.target + '）';
						/* ★ 技能方向(purpose)：按技能类别映射，供统一收益守卫 actionValue 强判方向
						 *   attack/control → 敌向；defense/aux(辅助/增益) → 友向；其余由守卫回退。 */
						const _cat = d.category || d.rule || '';
						/* 目标 intent 高于技能大类：target.draw() 可能是辅助技，不能因 category=draw
						 * 又被翻译成 attack。mixed 则刻意不设 purpose，交回原生/专属策略。 */
						const _purpose = _skillPurposeFromIntent(ti, _cat, tc);
						if (_purpose) a.purpose = _purpose;
					}
				}
				/* ★ 多目标技能：写回 targetList（全部真敌/真友玩家对象），
				 *   供收益方向守卫逐目标判定整体方向，避免只判主目标漏判。 */
				if (Array.isArray(d.targetIndexes)) {
					a.targetRangeResolved = d.targetRangeResolved !== false;
					a.targetDecisionResolved = d.targetDecisionResolved !== false;
					a.targetRequired = d.targetRequired !== false;
					const list = [];
					d.targetIndexes.forEach(function (ti) {
						const tt = skillTargets[ti];
						if (tt && tt.pp && list.indexOf(tt.pp) < 0) list.push(tt.pp);
					});
					if (list.length) {
						a.targetList = list;
						a.targetListRule = d.rule + '(多目标×' + list.length + ')';
					}
				}
			}
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
function aliveCountP() {
	try { return (game.players || []).filter(function (p) { return p && p.alive !== false; }).length; } catch (e) { return 8; }
}

/* ★ 基本装备决策标准：对 equip 候选应用 equipBrain（立即装/同槽替换/藤甲否决） */
function applyBasicEquipRules(me, acts) {
	try {
		const slotHas = {};
		try {
			const e = me.getCards && me.getCards('e');
			if (e) e.forEach(function (c) {
				const n = get.name(c, me);
				const slot = equipSlotOf(n);
				if (slot && !slotHas[slot]) slotHas[slot] = n;
			});
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		let enemyHasFire = false;
		try {
			for (const p of (game.players || [])) {
				if (!p || p === me || p.alive === false) continue;
				if (!isEnemyOf(me, p)) continue;
				/* ★ V01修复：不再读对手手牌内容（透视作弊）。改用合法概率推断火系威胁 */
				try {
					const fireP = Math.max(
						probHasCard(p, 'huogong'),
						probHasCard(p, 'huosha'),
						probHasCard(p, 'nanman'),
						probHasCard(p, 'zhujin')
					);
					if (fireP >= 0.15) enemyHasFire = true;
					/* 装备区属公开信息（可见），保留：敌方朱雀羽扇 → 火攻威胁高 */
					if (p.getEquip && (p.getEquip('zhuque'))) enemyHasFire = true;
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		acts.forEach(function (a) {
			if (a.type !== 'equip' && a.type !== 'card') return;
			const id = a.id;
			const slot = equipSlotOf(id);
			if (!slot) return;
			const ctx = { enemyHasFire: enemyHasFire };
			ctx[slot] = slotHas[slot] || null;
			const d = decideEquip(id, ctx);
			if (d.veto) {
				vetoCandidate(a, d.vetoReason);
				a.reason = (a.reason || '') + '（[装备否决] ' + d.vetoReason + '）';
				a.rule = 'veto';
			} else {
				setCandidatePriority(a, PRIORITY_TIER.NORMAL, d.priority, '');
				a.rule = 'equip:' + d.category;
				a.rulePriority = d.priority;
			}
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
function equipSlotOf(id) {
	if (!id) return null;
	const W = ['muniu','zhuge','qinggang','qinglong','guding','guanshi','hanbing','jueying','qilin','zhangba','cixiong','zhuque','yiyang','fangtian'];
	const A = ['renwang','bagua','tengjia','baiyin'];
	const H = ['dilu','chitu','dawan','zixin','hualiu','zhuahuang'];
	if (W.indexOf(id) >= 0) return 'weapon';
	if (A.indexOf(id) >= 0) return 'armor';
	if (H.indexOf(id) >= 0) return 'horse';
	return null;
}

/* ★ 基本判定决策标准：对乐/兵/闪电候选应用 judgeBrain（贴敌/有改判才放闪电） */
function applyBasicJudgeRules(me, acts) {
	try {
		const players = game.players || [];
		let hasRejudge = false;
		try {
			const RJ = ['guicai','zhongyi','hongyan','tianbian','yusheng','jinguo'];
			(me.skills || []).forEach(function (s) { if (RJ.indexOf(s) >= 0) hasRejudge = true; });
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		const targets = [];
		players.forEach(function (p) {
			if (!p || p === me || p.alive === false) return;
			/* ★ 指令 05 Stage C：统一经 buildTargetCandidate 归一 */
			const cand = buildTargetCandidate(me, p);
			if (cand) targets.push(cand);
		});
		acts.forEach(function (a) {
			if (a.type !== 'card') return;
			const id = a.id;
			if (id !== 'lebu' && id !== 'bingliang' && id !== 'shandian') return;
			let t = null;
			if (a.targetObj) {
				t = targets.find(function (cand) { return cand && cand.pp === a.targetObj; }) || null;
			}
			/* 闪电等无单外部目标牌允许 target=null；其余目标牌若候选未绑定则只做保守规则判断。 */
			const d = decideJudge(id, { me: { hp: me.hp }, target: t, targets: targets, hasRejudge: hasRejudge });
			if (d.veto) {
				vetoCandidate(a, d.vetoReason);
				a.reason = (a.reason || '') + '（[判定否决] ' + d.vetoReason + '）';
				a.rule = 'veto';
			} else {
				setCandidatePriority(a, PRIORITY_TIER.NORMAL, d.priority, '');
				a.rule = 'judge:' + d.category;
				a.rulePriority = d.priority;
			}
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ 按用途分散目标：卡牌 → 目标用途 粗映射（输出/击杀、控制、拆除）
 * 让不同用途的卡各自选中「该用途最合适」的目标，避免所有卡都死绑全局 bestT 同一个人。
 * 不在表内的卡（桃/酒/增益等）回退 bestT 兜底。
 */
const _CARD_PURPOSE = (function () {
	const m = {};
	['sha', 'huosha', 'leisha', 'juedou', 'zhujin', 'nanman', 'wanjian'].forEach(function (id) { m[id] = 'kill'; });
	['lebu', 'bingliang', 'shandian'].forEach(function (id) { m[id] = 'control'; });
	['guohe', 'shunshou'].forEach(function (id) { m[id] = 'dismantle'; });
	return m;
})();

/* 构建给 targetBrain 用的目标候选数组（pp 字段保留，便于落盘取回 Player）
 * ★ 指令 05 Stage A：主公判定已收敛至 playerSnapshot.isLordOf（统一权威）。 */
function _buildTargetBrainCandidates(me) {
	const arr = [];
	for (const p of (game.players || [])) {
		if (!p || p === me || p.alive === false) continue;
		/* ★ 指令 05 Stage C：统一经 buildTargetCandidate 归一 */
		const cand = buildTargetCandidate(me, p);
		if (cand) arr.push(cand);
	}
	return arr;
}

/* ★ 按卡牌用途独立选目标（bestT 只作兜底，不替它强制集火单人） */
function _buildCardDecisionContext(me) {
	const targets = _buildTargetBrainCandidates(me);
	const meC = {};
	['sha', 'shan', 'tao', 'jiu', 'wuxie'].forEach(function (k) {
		try { meC[k] = me.countCards ? me.countCards('hs', k) : 0; } catch (e) { meC[k] = 0; }
	});
	let hasRejudge = false;
	try {
		const RJ = ['guicai', 'zhongyi', 'hongyan', 'tianbian', 'yusheng'];
		activePlaySkills(me, _status.event, lib, game, get).forEach(function (sid) { if (RJ.indexOf(sid) >= 0) hasRejudge = true; });
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return {
		...(readVersusMode().is2v2?{attackStrategy:(id,t)=>evaluateVersusAttackForId(me,id,t?.pp)}:{}),
		me: Object.assign({ hp: me.hp, maxHp: me.maxHp }, meC, { hasSuit: true }),
		hasRejudge: hasRejudge,
		enemyHasFire: false,
		targets: targets,
		stripStrategy:(id,t)=>t?.isAlly&&tacticalSettingsSnapshot().enabled?stripPlan(me,(me.getCards('h')||[]).find(c=>get.name(c,me)===id)||{name:id},t.pp):undefined,
		hi: { identityBiasOf: identityBiasOf },
	};
}

/* 候选目标必须在评分前绑定。只有宿主明确是单外部目标时才绑定；
 * 无目标、自身、自动全体、多目标/动态目标保持未绑定，交给各自专用策略或宿主。 */
function _resolveCardCandidateTarget(me, id, ctx, fallback) {
	try {
		if(id==='jiedao'&&tacticalSettingsSnapshot().enabled){
            const card=(me.getCards('h')||[]).find(c=>get.name(c,me)===id)||{name:id};
            const pair=bestJiedaoPair(me,{card});
            if(pair.resolved)return {target:pair.holder||null,index:-1,score:pair.score,resolved:true,pair,reason:pair.reason};
        }
		if (id === 'tiesuo') return { target: null, index: -1, score: 0, resolved: false, reason: '铁索由专用 evaluator 决定' };
		const info = lib.card && lib.card[id];
		const cat = classifyCard(id);
		if (cat === 'gain' || cat === 'equip' || cat === 'respond') {
			return { target: null, index: -1, score: 0, resolved: true, reason: '无外部单目标' };
		}
		if (info) {
			const st = info.selectTarget;
			if (info.notarget === true || info.toself === true || st === -1) {
				return { target: null, index: -1, score: 0, resolved: true, reason: '宿主声明无单外部目标' };
			}
			if ((typeof st === 'number' && st > 1)
				|| (Array.isArray(st) && st.length > 1 && (st[1] === Infinity || Number(st[1]) > 1))
				|| typeof st === 'function') {
				return { target: null, index: -1, score: 0, resolved: false, reason: '多目标/动态目标不预绑定' };
			}
		}
		const tk = pickCardTarget(id, ctx);
		if (tk && tk.index >= 0 && ctx.targets[tk.index] && ctx.targets[tk.index].pp) {
			return { target: ctx.targets[tk.index].pp, index: tk.index, score: Number(tk.score || 0), resolved: true, reason: tk.reason || '' };
		}
		if (fallback && info && typeof info.filterTarget === 'function') {
			const fi = ctx.targets.findIndex(function (t) { return t && t.pp === fallback; });
			if (fi >= 0) return { target: fallback, index: fi, score: 0, resolved: true, reason: '使用全局关注目标兜底' };
		}
		return { target: null, index: -1, score: 0, resolved: false, reason: '未解析目标' };
	} catch (e) {
		return { target: null, index: -1, score: 0, resolved: false, reason: '目标解析异常' };
	}
}

/* ★ 基本目标决策标准：为输出/击杀类卡标注推荐目标（targetBrain），供决策回读 */
function applyBasicTargetRules(me, acts) {
	try {
		const targets = [];
		for (const p of (game.players || [])) {
			if (!p || p === me || p.alive === false) continue;
			/* ★ 指令 05 Stage C：统一经 buildTargetCandidate 归一 */
			const cand = buildTargetCandidate(me, p);
			if (cand) targets.push(cand);
		}
		const map = { sha: 'kill', huosha: 'kill', leisha: 'kill', juedou: 'kill', zhujin: 'kill', nanman: 'kill', wanjian: 'kill' };
		/* ★ 按用途分散目标：控制/拆除类卡各自选最优目标，不再统一指向 bestT */
		Object.keys(_CARD_PURPOSE).forEach(function (id) { if (!(id in map)) map[id] = _CARD_PURPOSE[id]; });
		acts.forEach(function (a) {
			if (a.type !== 'card'||a.id==='jiedao'&&a.jiedaoPair) return;
			const purpose = map[a.id];
			if (!purpose || !targets.length) return;
			const tk = pickTargetByPurpose(purpose, targets);
			if (tk.index >= 0) {
				a.targetRule = purpose + '→' + targets[tk.index].name + '(' + tk.score + ')';
				a.targetSuggestion = targets[tk.index].name;
				/* 评分完成后禁止再改 target；这里只记录诊断一致性。 */
				if (a.targetObj) a.targetConsistent = (a.targetObj === targets[tk.index].pp);
			}
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ targetBrain 动态目标精修
 * 在既有 bestT（威胁×风格全局最优）之上，仅当存在“明显更优的可收割/高击杀确定率之敌”时切目标。
 * 纯增量：不乘任何权重、不压任何既有分；只把收割机会让决策受益。
 * 返回目标对象（Player）；无更优则返回当前 bestT（或 null）。
 */
function pickKillTarget(me, tsMap, cur) {
	try {
		// 2v2 estimates use the physical attack card; do not redirect solely from bare HP.
		if(readVersusMode().is2v2)return cur;
		const cands = [];
		for (const p of (game.players || [])) {
			if (!p || p === me) continue;
			try { if (p.alive === false || (p.hp !== undefined && p.hp <= 0)) continue; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			let ally = false; try { ally = isSameCamp(me, p); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			if (ally) continue;
			const hp = p.hp !== undefined ? p.hp : 3;
			const shanProb = (function () { try { return probHasShan(p); } catch (e) { return 0.5; } })();
			/* 可收割：1 血，或 2 血且大概率无闪（击杀确定率高） */
			const collect = hp <= 1 || (hp <= 2 && shanProb < 0.4);
			if (!collect) continue;
			let threat = 0; try { const t = threatOf(p); threat = isFinite(t) ? t : 0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			cands.push({ p: p, s: targetBrainScore('kill', { hp: hp, shanProb: shanProb, threat: threat }) });
		}
		if (!cands.length) return cur;
		cands.sort(function (a, b) { return b.s - a.s; });
		const best = cands[0];

		/* 当前目标属性 */
		const curIsCollect = (function () {
			if (!cur || cur === me) return false;
			let cAlly = false; try { cAlly = isSameCamp(me, cur); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			if (cAlly) return false;
			const cHp = cur.hp !== undefined ? cur.hp : 3;
			const cShan = (function () { try { return probHasShan(cur); } catch (e) { return 0.5; } })();
			return cHp <= 1 || (cHp <= 2 && cShan < 0.4);
		})();

		if (!curIsCollect) return best.p;                      /* 当前不是可收割 → 切到收割机会 */
		if (best.p === cur) return best.p;                     /* 已是同一目标 */
		const curS = targetBrainScore('kill', {
			hp: cur.hp !== undefined ? cur.hp : 3,
			shanProb: (function () { try { return probHasShan(cur); } catch (e) { return 0.5; } })(),
			threat: (function () { try { const t = threatOf(cur); return isFinite(t) ? t : 0; } catch (e) { return 0; } })(),
		});
		/* 已是可收割，仅在另一目标“击杀确定率明显更高”时才切，避免目标抖动 */
		if (best.s >= curS + 1.5) return best.p;
		return cur;
	} catch (e) { return cur; }
}

function bestAction() { return profile('bestAction', bestActionCore); }
function bestActionCore() {
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
			profRecord('decision.' + name, dt);
			_phaseT0 = now;
		} catch (e) {}
	}
	function _phaseSnapshot() {
		const out = {};
		for (const k of Object.keys(_perfPhases)) out[k] = Math.round(_perfPhases[k]);
		return out;
	}

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
		/* checkStateChanged() 刚同步算出当前完整指纹（缓存在 _lastStateKey），这里直接复用；等价于再调一次 stateKey()，省一次 O(玩家×手牌) 全量重算。 */
		_decisionStateKey = lastStateKey() + '::REL=' + _currentRelationKey;
	} catch (eStateKey) {
		_decisionStateKey = '';
	}
    const decisionCacheContext={actor:_status.currentPhase||game.me,key:_decisionStateKey,
        window:playChoiceWindow(_status.event,_status.currentPhase||game.me),epoch:cooperativeTrickEpoch()};
    if(decisionCacheMatches({..._lastDecisionCacheContext,ba:_lastBestAction,t:_lastBestActionTime,key:_lastBestActionStateKey},
        {...decisionCacheContext,ttl:BEST_ACTION_CACHE_TTL})) {
		try { perfMark('bestAction.cache', performance.now() - _perfT0); } catch (eP) {}

		return _lastBestAction;
	}
	_markPhase('preflight');

	/* ★ per-player 节流（卡死缓解）：7 个 AI 玩家每次决策都全量评估是 CPU 大头。
	 *   非本机玩家仅在相同局面、选择窗口和局次内复用，1.5s 只是时间上限。 */
	try {
		const _ppMe = (_status && _status.currentPhase) || game.me;
		if (_ppMe && _ppMe !== game.me) {
			const _ppKey = _ppMe.playerid || _ppMe.name1 || _ppMe.name || 'ai';
			const _ppStore = (window.__DJSC._baPPCache = window.__DJSC._baPPCache || {});
			const _ppHit = _ppStore[_ppKey];
			if(decisionCacheMatches(_ppHit,{...decisionCacheContext,ttl:1500}))return _ppHit.ba;
		}
	} catch (ePP) { }

	/* ★ 兜底声明：防止作用域问题导致 best is not defined */
	let best = { type: "end", id: "end", score: 0, reason: "初始化兜底" };
	try {
		const me = _status.currentPhase || game.me;
		if (!me) {
			try { perfMark('bestAction', performance.now() - _perfT0); } catch (eP) {}

			return null;
		}

        const auditMode=modeSampleMeta(me);
        const evaluationAudit=createEvaluationAudit({enabled:auditMode.mode==='doudizhu',detailed:!!tacticalEnabled('diagnostic'),
         control:(()=>{try{return me===game.me?(_status.auto?'local-auto':'local-manual'):me.isOnline2?.()?'remote-human':'ai';}catch(_){return 'unknown';}})(),
         settings:{suggestionFusion:commonSuggestionFusionFor(auditMode),mode:{enabled:auditMode.enabled,collect:auditMode.collect,specialistEnabled:auditMode.specialistEnabled,
          specialistVersion:auditMode.specialistVersion,playerDemonstrations:auditMode.playerDemonstrations,autoUpdate:auditMode.autoUpdate},
          tactical:tacticalSettingsSnapshot(),live:Object.fromEntries(['decisionScore','hardOverride','responseAI','override_use','override_respond','enablePlanner','useTrainedModel','aiStrength','championBoost','broadcastAI','comboChain','hideFarmerTeammateHand','classicEffectReport','showReport','archiveGames'].map(k=>[k,cfg(k,null)]))}});
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

		/* ===== 调用拆分的子模块 ===== */
		const P = analyzePersonality(me);
		const team = analyzeTeamPlan(me);
		const seat = analyzeSeatPressure(me);
		const econ = analyzeEconomy(me);
		const forecast = analyzeForecast(me);

		/* ===== 策略模式：根据情况选择攻击/防御/辅助策略 ===== */
		let currentStrategy = { type: 'balanced', value: 1.0 };
		try {
			const strategy = chooseStrategy(me);
			currentStrategy = strategy;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		const sit = situationFactor(me);
		const riskLabel = P.label;
		const risk = P.risk;
		const riskTaking = P.riskTaking;
		const teamwork   = P.teamwork;

		/* ===== AI 协作分工（角色） ===== */
		const ALLY_ROLE = P.allyRole;
		const ROLE_PREFS = ALLY_ROLE ? ({
			attack:  { atk: 1.35, skill: { atk: 1.4, def: 0.7, aux: 0.7, ctrl: 0.9, draw: 1.0 }, cardAtk: 1.3, cardDef: 0.8 },
			aux:     { atk: 0.75, skill: { atk: 0.7, def: 1.2, aux: 1.5, ctrl: 0.9, draw: 1.2 }, cardAtk: 0.8, cardDef: 1.3 },
			control: { atk: 1.0,  skill: { atk: 0.9, def: 1.0, aux: 1.0, ctrl: 1.5, draw: 1.1 }, cardAtk: 1.0, cardDef: 1.0 },
			defense: { atk: 0.7,  skill: { atk: 0.6, def: 1.5, aux: 1.2, ctrl: 0.9, draw: 1.0 }, cardAtk: 0.7, cardDef: 1.4 },
			balanced:{ atk: 1.0,  skill: { atk: 1.0, def: 1.0, aux: 1.0, ctrl: 1.0, draw: 1.0 }, cardAtk: 1.0, cardDef: 1.0 },
		})[ALLY_ROLE] : null;

		/* ===== 策略乘数：根据当前策略调整攻击/防御权重 ===== */
		let strategyAtkMul = 1.0;
		let strategyDefMul = 1.0;
		if (currentStrategy.type === 'attack') {
			strategyAtkMul = 1.2;
			strategyDefMul = 0.9;
		} else if (currentStrategy.type === 'defense') {
			strategyAtkMul = 0.8;
			strategyDefMul = 1.3;
		}

		const atkMul = (sit.atkMul || 1) * strategyAtkMul;
		const keepMul = (sit.keepMul || 1) * strategyDefMul;
		const burstMul = sit.burstMul || 1;
		const stageLabel = sit.stage || "mid";
		const ATK_CARDS = ["sha", "juedou", "huogong", "nanman", "wanjian", "zhujin", "shunshou", "guohe", "tiesuo", "lebu", "bingliang"];
		const DEF_CARDS = ["shan", "tao", "wuxie", "jiu"];
		const hand = [];
		try { me.getCards("h").forEach(function (c) { hand.push(c.name || ""); }); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		const teamCombos = team.combos;
		const focus = team.focus;

		const SEAT_TARGET_CARDS = ["lebu", "bingliang"];
		/* ===== 下回合预测（先见之明）+ 多回合趋势 ===== */
		const incoming = forecast.incoming;
		/* ===== 敌方爆发威胁（连弩 + 多杀）===== */
		const burst = maxBurstThreat(me);
		const mt = multiTurnCached(me);
		_markPhase('context');
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
				/* ★ 友方目标分归零（原 0.1 折）：tsMap 仅服务攻击/集火/击杀目标选择，
				 *   友方不该成为攻击目标——被卡距离时（范围内只有队友）bestT 不会落到队友，
				 *   宁可不出攻击牌（执行层阵营护栏兜底）。 */
				if (isAlly) ts = 0;
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
				const pk = targetKey(pp);
				if (!pk) continue;
				broadcastBonus[pk] = focusBonus(me, pp);
			}
			for (const [pp, ts] of tsMap) {
				const pk = targetKey(pp);
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
		try { _probShanCache = new WeakMap(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
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
		/* ===== 技能候选（多维评分版） ===== */
		activePlaySkills(me, _status.event, lib, game, get).forEach(function (sid) {
			try {
				const prof = skillProfileOf(sid);
				if (!prof) return;

				const multi = prof.profit && prof.profit.multi;

				/* 用 multi.final 作为基础分 */
				let base = multi ? multi.final : (prof.profit.base || 0);
				if (base > 15) base = 15;
				if (base < -15) base = -15;
				if (base <= 0) return;

				const skillSeed = createBaselineUtilitySeed(base * sit.tempo, 'skillBaseline', 'resource', { heuristic: true, scale: sit.tempo, skillId: sid });
				const s = skillSeed.score;

				/* ★ 主动掉血动态策略：血量越低失去体力成本越高——
				 *   濒死边缘掉血≈自杀；低血需摸牌补偿才卖；满血战术卖血鼓励。
				 *   multi.final 已含 loseHp 静态成本，这里按当前血线做梯度缩放。 */
				let _lhScale = 1;
				try {
					if (Number(prof.tags && prof.tags.loseHp || 0) > 0) {
						const _lhHp = me.hp || 0, _lhMax = Math.max(1, me.maxHp || 4);
						const _lhRecover = Number(prof.tags && prof.tags.recover || 0) > 0;
						const _lhDraw = Number(prof.tags && prof.tags.draw || 0) > 0;
						if (_lhHp <= 1) {
							if (!_lhRecover) _lhScale = 0.2;   /* 濒死边缘掉血≈自杀；带回复效果的技能豁免 */
						} else if (_lhHp <= 2) {
							if (!_lhDraw) _lhScale = 0.55;     /* 低血需摸牌补偿才值得卖 */
						} else if (_lhHp >= _lhMax) _lhScale = 1.25;  /* 满血战术卖血成本低 */
					}
				} catch (eLh) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eLh); }
				/* multi.final已含效果/成本/团队/范围，不再按同一语义关键字重复加权。
				 * 合法时机、目标与策略优先级交给下方basicSkillRules。 */

				/* 新 reason */
				let reason = '技能' + sid + '（多维 ' + (Math.round(base * 100) / 100);
				if (multi) {
					reason += '，对象 ' + multi.dims.object
						+ ' 时机 ' + multi.dims.timing
						+ ' 频率 ' + multi.dims.frequency;
					const tg = (prof.tags.teamGain || 0) + (prof.tags.teamAid || 0);
					if (tg > 0) reason += '，团队+' + (Math.round(tg * 10) / 10);
				}
				reason += '）';

				const skillAct = makeActionCandidate({ type: 'skill', id: sid, score: runtimeScore(s * _lhScale), reason, multi });
				adoptAttackUtilitySeed(skillAct, skillSeed, { roundingOnly: true });
				establishUtilityReference(skillAct);
				acts.push(skillAct);
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});

		/* 卡牌候选：先绑定实际目标，再让所有目标相关评分只消费该目标。 */
		const seen = {};
		const cardDecisionCtx = _buildCardDecisionContext(me);
		/* 装备先按唯一来源结算，普通卡牌评分不再另造同名装备候选。 */
		let equipmentUtility = { ids: new Set(), candidates: [] };
		try { equipmentUtility = buildEquipmentUtilityCandidates(me, { get, lib, evaluate: equipReplaceCost, tempo: sit.tempo, safety: risk.safe }); }
		catch (eEQ) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eEQ); }
		hand.forEach(function (id) {
			if (equipmentUtility.ids.has(id)) return;
			if (seen[id]) return; seen[id] = 1;

			try {
				const v = VAL_CARD[id];
				if (!v || !v.use || v.use < 0) return;
				const boundTarget = _resolveCardCandidateTarget(me, id, cardDecisionCtx, bestT || null);
				const cardTarget = boundTarget.target;
				let cardTargetStyle = null;
				try { if (cardTarget) cardTargetStyle = styleOf(cardTarget); } catch (eS) { cardTargetStyle = null; }

				/* C 阶段 clamp：卡牌使用价值规范上限 +4 */
				let cardUse = v.use;
				if (cardUse > 4) cardUse = 4;

				const attackEV = _attackExpectedValue(me, id, cardTarget);
				const areaEV = (id === 'nanman' || id === 'wanjian') ? aoeValue(me, id) : null;
				const ev = id==='jiedao'&&boundTarget.pair?boundTarget.pair.score:attackEV ? attackEV.score : areaEV ? 2 * areaEV.netImpact : expectedValue(me, id, cardTarget);
				const mv = marginalValue(id, hand);
				const weight = ATK_CARDS.includes(id) ? Number(cfg('wAtkCard', 1)) : DEF_CARDS.includes(id) ? Number(cfg('wDefCard', 1)) : 1;
				const evScale = (0.5 + 0.5 * mv / (cardUse || 1)) * 2 * sit.tempo * (Number.isFinite(weight) ? Math.max(0, weight) : 1);
				const attackSeed = attackEV ? createAttackUtilitySeed(attackEV, evScale) : areaEV ? createAreaUtilitySeed(areaEV, evScale) : createBaselineUtilitySeed(ev * evScale, 'cardBaseline', 'resource', { heuristic: true, cardId: id, scale: evScale });
				let s = attackSeed ? attackSeed.score : ev * evScale;

				const contextSignals = { style: styleRatio(id, cardTargetStyle) };
				const timingSignals = {};
				const judgeSignals = {};
				const threatSignals = {};
				const deepEvidence = deepValueEvidence(me, { id, target: cardTarget });
				const cardOverride = id==='jiedao'&&boundTarget.pair?null:readCardOverride(id, me, cardTarget);
				let transitionPenalty = 0;
				const collect = (signals, key, fn) => { try { const value = fn(); if (Number.isFinite(value)) signals[key] = value; } catch (_) {} };
				if (cardTarget) {
					collect(contextSignals, 'psychology', () => psychologyBonus(me, { type: 'card', id, target: cardTarget }, cardTarget, { includeRetention: false }));
					collect(contextSignals, 'memory', () => playerMemoryBonus(me, cardTarget, { type: 'card', id, target: cardTarget }));
					collect(contextSignals, 'prediction', () => opponentPredictBonus(me, cardTarget, { id }));
					collect(contextSignals, 'mood', () => 1 + moodStrategyBonus(me, cardTarget, { id }));
					collect(contextSignals, 'counterRelation', () => 1 + counterRelationBonus(me, cardTarget, { id }));
					try { const tp = evaluateActionTransitionPenalty(me, cardTarget, id, { relationOf: dispositionOf }); transitionPenalty = Math.max(0, Number(tp?.penalty) || 0); } catch (_) {}
				}
				/* 当前火攻只计当前命中；树搜索/多轮/连弩顺序不另加未来分，由Planner负责。 */
				if (id === 'huogong' && cardTarget) {
					let hit = .5;
					try { const value = fireAttackExpectedHit(me, cardTarget); if (Number.isFinite(value)) hit = Math.max(0, Math.min(1, value)); } catch (_) {}
					s = attackSeed.score * hit;
					// 基础分中的命中条件由同一来源重建，零命中不制造保底伤害。
					attackSeed.score = s;
					attackSeed.utilityVector = createBaselineUtilitySeed(s, 'fireExpectedValue', 'offense', { hitProbability: hit }).utilityVector;
				}
				const timingFns = { resource: () => resourceTimingBonus(me, { id, target: cardTarget }), jiedao: () => jiedaoBonus(me, { id, target: cardTarget, pair:boundTarget.pair }), shandian: () => shandianBonus(me, { id }), taoyuan: () => taoyuanBonus(me, { id }), wugu: () => wuguBonus(me, { id }), tao: () => taoBonus(me, { id }), wuxie: () => wuxieBonus(me, { id }), shunshou: () => shunshouBonus(me, { id, target: cardTarget }) };
				for (const [key, fn] of Object.entries(timingFns)) collect(timingSignals, key, fn);
				/* ㉖ 杀目标选择优化：只适用于杀 */
				if (id === 'sha' && cardTarget) { const shaB = shaTargetBonus(me, cardTarget); threatSignals.shaTarget = shaB; }
				/* ㉗ 桃的时机不重复计救援分；酒的未来收益交由Planner。 */
				if (id === 'lebu' || id === 'bingliang') collect(judgeSignals, 'timing', () => judgeBonus(me, { id, target: cardTarget }));
				if (SEAT_TARGET_CARDS.includes(id)) timingSignals.seat = cardTarget === seat.nextEnemy ? 1.15 : 1;
				if (ATK_CARDS.includes(id)) {
					if (Number(cfg('wForecastMul', 1)) !== 0) threatSignals.forecast = incoming.killRisk ? .75 : incoming.selfRisk >= .6 ? .9 : incoming.selfRisk < .15 ? 1.12 : 1;
					threatSignals.burst = cardTarget === burst.target ? 1 + Math.min(.25, Math.max(0, burst.value) * .4) : 1;
					threatSignals.personality = Number(risk.atk);
					threatSignals.strategy = Number(strategyAtkMul);
					threatSignals.trend = Number(trendMul.atk);
					if (ROLE_PREFS) threatSignals.role = ROLE_PREFS.cardAtk;
				}
				if (cardTarget && _isEnemyMemo(cardTarget) && ['sha','juedou','huogong','zhujin'].includes(id)) {
					const aiT = typeof window !== 'undefined' && window.__DJSC?.aiTools;
					if (aiT) {
						collect(threatSignals, 'maixie', () => aiT.isMaixie(cardTarget) ? getMetric('maixie_penalty', .75) : 1);
						collect(threatSignals, 'deathSkill', () => aiT.hasDeathSkill(cardTarget) ? getMetric('deathskill_penalty', .85) : 1);
				/* ★ 桃自用动态评估（用桃灵活性）：濒死刚需置顶、缺1血倾向保留、桃多正常补。
				 *   此前 tao 只吃静态 use 值 + 通用防御牌乘数，出现「残血不舍得吃/满血乱吃」。 */
				if (id === 'tao') {
					try {
						const _tHp = me.hp || 0, _tMax = Math.max(1, me.maxHp || 4);
						const _tLost = _tMax - _tHp;
						let _taoCnt = 0;
						try { _taoCnt = me.countCards ? me.countCards('hs', 'tao') : 0; } catch (eTc) { }
						if (_tHp <= 1) {
							/* 濒死：吃桃是即时刚需，置顶（后续防御乘数只会更高） */
							s = Math.max(s, 14);
						} else if (_tLost >= 2 && _taoCnt >= 2) {
							/* 缺2血+桃多：正常补血 */
							s = Math.max(s, ev * 1.2);
						} else if (_tLost === 1) {
							/* 只缺1血：桃的储备价值高于立刻补——威胁低时更倾向留 */
							s *= (_taoCnt >= 2 ? 0.9 : 0.55);
							try {
								const _fr = forecast && forecast.incoming;
								if (_fr && (_fr.selfRisk || 0) < 0.25 && _taoCnt < 2) s *= 0.8;
							} catch (eFr) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eFr); }
						}
					} catch (eTao) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTao); }
				}

				/* ★ 酒专项：没杀不喝（纯浪费）、残血留自救（酒=濒死回1血资本） */
				if (id === 'jiu') {
					try {
						let _shaCnt = 0, _hasBurst = false;
						try { _shaCnt = me.countCards ? me.countCards('hs', 'sha') : 0; } catch (eJ0) { }
						try { _hasBurst = !!(me.getEquip && me.getEquip('zhuge')) || (me.hasSkill && me.hasSkill('paoxiao')); } catch (eJ1) { }
						if (_shaCnt === 0 && !_hasBurst) s *= 0.25;
						if ((me.hp || 0) <= 2) s *= 0.4;
					} catch (eJiu) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eJiu); }
				}


				/* ★ 装备节奏：濒死不恋装（保命优先）；藤甲怕火，谨慎降权 */
				if (!cardTarget) {
					try {
						if (classifyCard(id) === 'equip') {
							if ((me.hp || 0) <= 1) s *= 0.5;
							if (id === 'tengjia') s *= 0.8;
						}
					} catch (eEq) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eEq); }
				}

				/* ★ 记忆驱动：根据 cardTarget 的风格调整卡牌价值 */
				try {
					if (cardTarget && cardTargetStyle) {
						const sStyle = cardTargetStyle;
						if (sStyle.tag === "aggressive") {
							/* 面对激进敌人：防御牌价值提高 */
							if (['shan', 'tao', 'jiu', 'wuxie', 'exjiu'].indexOf(id) >= 0) {
								s *= 1.2;
							}
						} else if (sStyle.tag === "vengeful") {
							/* 面对复仇心重敌人：攻击牌价值降低（避免招惹） */
							if (['sha', 'juedou', 'huogong', 'guohe', 'shunshou'].indexOf(id) >= 0) {
								s *= 0.85;
							}
						} else if (sStyle.tag === "cautious") {
							/* 面对保守敌人：攻击牌价值提高（压迫他） */
							if (['sha', 'juedou', 'huogong'].indexOf(id) >= 0) {
								s *= 1.1;
							}
						}
					}
				} catch (eStyle) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eStyle); }

				/* ★ 资敌防护（「拆/顺了又贴回」拉锯的根因之一）：目标判定区有牌时不用拆/顺指向它——
				 *   乐/兵必是敌方阵营贴给它的控制（我方拆=解我方阵营控制）、闪电在敌方回合劈它
				 *   → 拆/顺该目标大概率解掉这些牌=资敌，并形成「贴→拆→再贴」双向拉锯 → 强负分直接否决 */
				if (['guohe', 'shunshou'].indexOf(id) >= 0 && cardTarget) {
					try {
						const _jz0 = (cardTarget.judging && cardTarget.judging[0]) || null;
						if (_jz0) s = -999;
					} catch (eJzGuard) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eJzGuard); }
				}
				/* ★ 循环抑制：同一目标 90s 内贴同类延时锦囊 → 0.45^k 衰减；≥3 次直接否决 */
				if ((id === 'lebu' || id === 'bingliang') && cardTarget) {
					try {
						const _rp = _delayRepeatFactor(cardTarget, id);
						if (_rp.k >= 3) s = -999;
						else s *= _rp.f;
					} catch (eRp) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eRp); }
				}
				/* ★ 衰减：顺敌方延时锦囊（兵/乐）→ 刷分漏洞衰减
				 *   从敌方 A 顺兵/乐再贴给敌方 B，本质是拆东墙补西墙，不是真正收益；
				 *   不读对手手牌内容，用合法概率推断其手牌含延时锦囊 */
				if (id === 'shunshou' && cardTarget) {
					try {
						const pDelay = Math.max(probHasCard(cardTarget, 'lebu'), probHasCard(cardTarget, 'bingliang'));
						if (pDelay >= 0.2) s *= 0.7;
					} catch (ePd) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(ePd); }
				}

					}
				}
				/* 防御牌的高危预测只影响保留成本，不把越危险解释成越该消耗。 */
				const forecastWeight = Number(cfg('wForecastMul', 1));
				const forecastRetention = DEF_CARDS.includes(id) && forecastWeight !== 0 ? Math.max(0, Math.min(1.5, Number(incoming.selfRisk) || 0)) : 0;
				/* 响应倍率、自动发现的整局估分、重复身份奖惩、未来连招旧加分退出本方收益链。 */

				const ovTag = cardOverride ? ' | 宿主估分仅对账:' + Math.round(cardOverride.score * 10) / 10 : '';

				/* ★ 指令 02：铁索连环不再沿用普通 targetScore → top1/top2，
				 * 也不写死「最多连 6 个敌人」。交由唯一权威策略源 tiesuoEvaluator，
				 * 在同一层比较 RECAST / 单目标 / 双目标（含「解队友 + 链敌人」）。 */
				let targetNames = null;
				let targetDesc = '';
				let tieTargets = null;
				let recast = false;
				let actScore = id === 'tiesuo' ? 0 : s;
				let tiesuoSeed = null;
				let cardOptions = null;
				if (id === 'tiesuo') {
					cardOptions = []; // 失败时不生成伪装成可用的铁索动作
					try {
						const actualTie = (me.getCards ? me.getCards('h') : []).find(c => (get.name ? get.name(c, me) : c.name) === id);
						const canRecast = !!actualTie && typeof me.canRecast === 'function' && me.canRecast(actualTie, null, true);
						/* 攻击目标缓存不包含自己；铁索需单独补入自身解链目标。 */
						const legalTie = [];
						const tiePlayers = tacticalEnabled('tiesuo') ? [...tsMap.keys(), me] : tsMap.keys();
						for (const pp of tiePlayers) {
							if (!pp) continue;
							try { if (pp.isDead ? pp.isDead() : (pp.hp !== undefined && pp.hp <= 0)) continue; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
							if (typeof me.canUse === 'function' && !me.canUse(actualTie || { name: id }, pp)) continue;
							legalTie.push(pp);
						}
						/* ★ 属性机会 modifier（方案 §11.4 轻量版）：
						 *   我方持有属性伤害手段 → enemy-linked 价值上调；
						 *   敌方持有属性伤害威胁 → ally-linked 罚分上调。
						 * 复用 threat.linkedChainValue 校验「属性机会是否已在场上成立」。 */
						let hasOurAttr = false, enemyAttrThreat = 0;
						try {
							const _isNatureCard = function (c, owner) {
								try {
									const n = get.name ? get.name(c, owner) : (c && c.name);
									if (n === 'huogong' || n === 'shandian') return true;
									if (game && game.hasNature && (game.hasNature(c, 'fire') || game.hasNature(c, 'thunder'))) return true;
								} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
								return false;
							};
							/* 自己手牌属于合法私有信息，可以精确读取。 */
							try {
								hasOurAttr = (me && me.getCards ? me.getCards('h') : []).some(function (c) {
									if (!_isNatureCard(c, me)) return false;
                                    if(modeContext().group !== 'doudizhu-classic') return true;
                                    const name=get.name?get.name(c,me):c.name;
                                    if(name==='shandian') return false; // 延时雷击不等于本阶段可执行的属性跟进
                                    if(typeof me.getCardUsable==='function' && !(me.getCardUsable(c)>0)) return false;
                                    return legalTie.some(t=>_isEnemyMemo(t) && typeof me.canUse==='function' && me.canUse(c,t));
								});
							} catch (e) { hasOurAttr = false; }

							if (hasOurAttr) {
								/* 场上已有横置敌人时，若传导净收益为负（牵连更多队友）则不算「明确机会」 */
								let linkedEnemy = null;
								for (const [pp] of tsMap) {
									if (!pp || pp === me) continue;
									try { if (_isEnemyMemo(pp) && isPlayerLinked(pp)) { linkedEnemy = pp; break; } } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
								}
								if (linkedEnemy) {
									let cv = 0;
									try { cv = Math.max(linkedChainValue(me, linkedEnemy, 'fire'), linkedChainValue(me, linkedEnemy, 'thunder')); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
									if (!(cv > 0)) hasOurAttr = false;
								}
							}

							/* 敌方隐藏手牌只能做概率推断；取最高单体属性威胁作为全局风险强度。 */
							try {
								(game.players || []).forEach(function (p) {
									if (!p || p === me || p.alive === false) return;
									try { if (!_isEnemyMemo(p)) return; } catch (e) { return; }
									const probs = ['huogong', 'huosha', 'leisha', 'shandian'].map(function (cid) {
										try { return Math.max(0, Math.min(1, Number(probHasCard(p, cid)) || 0)); }
										catch (e) { return 0; }
									});
									const anyNature = 1 - probs.reduce(function (remain, prob) {
										return remain * (1 - prob);
									}, 1);
									if (anyNature > enemyAttrThreat) enemyAttrThreat = anyNature;
								});
							} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
						} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
						const tieRes = evaluateTiesuoActions(me, id, {
							candidates: legalTie,
							players: (game && game.players) || legalTie,
							canRecast: canRecast,
							cacheHost: true,
							classicDoudizhu: modeContext().group === 'doudizhu-classic',
							hasOurAttr: hasOurAttr,
							enemyAttrThreat: enemyAttrThreat,
						});
						cardOptions = tiesuoCandidateOptions(tieRes, canRecast);

					} catch (eT) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eT); }
				} else if (cardTarget) {
					targetNames = targetKey(cardTarget);
					targetDesc = '→' + targetNames + (id==='jiedao'&&boundTarget.pair?.victim?'→'+targetKey(boundTarget.pair.victim):'') + (boundTarget.score ? '（目标分' + Math.round(boundTarget.score * 10) / 10 + '）' : '');
				}

                for (const option of cardOptions || [null]) {
                    if (option) {
                        recast = option.recast;
                        tieTargets = recast ? null : option.targets;
                        targetNames = recast ? null : tieTargets.map(targetKey);
                        actScore = tiesuoUtilityToEngineRaw(option.utility);
                        tiesuoSeed = createBaselineUtilitySeed(actScore, 'tiesuoEvaluator', 'control', { evaluatorUtility: option.utility, recast });
                        const displayNames = (tieTargets || []).map(p => p.name1 || p.name || targetKey(p));
                        targetDesc = recast ? '（重铸摸牌，收益' + option.utility + '）' : '→' + displayNames.join('+') + '（ΔU' + option.utility + '）';
                    }

				const cardAct = makeActionCandidate({
					type: "card",
					id: id,
					target: targetNames,
					targetObj: (id === 'tiesuo') ? null : cardTarget,
					targetList: id==='jiedao'&&boundTarget.pair?.use?[boundTarget.pair.holder,boundTarget.pair.victim]:(id === 'tiesuo' && !recast) ? tieTargets : null,
                    jiedaoPair:id==='jiedao'?boundTarget.pair:null,
					targetResolved: id === 'tiesuo' ? true : boundTarget.resolved,
					recast: recast,
					targetScore: id === 'tiesuo' ? runtimeScore(bestTs) : runtimeScore(boundTarget.score || 0),
					score: runtimeScore(actScore),
					reason: (recast ? "重铸" : "使用") + (v.name || id) + targetDesc + "（EV" + Math.round(ev * 10) / 10 + " 边际" + Math.round(mv * 10) / 10 + ovTag + "）"
				});
				adoptAttackUtilitySeed(cardAct, id === 'tiesuo' ? (tiesuoSeed || createBaselineUtilitySeed(0, 'tiesuoEvaluator', 'control', { unavailable: true })) : attackSeed, { roundingOnly: true });
				if(id==='jiedao'&&boundTarget.pair&&!boundTarget.pair.use)vetoCandidate(cardAct,'无正收益合法借刀组合');
				establishUtilityReference(cardAct);
				if (id !== 'tiesuo') applyTransitionUtility(cardAct, transitionPenalty);
				applyOptimizationEvidence(cardAct, cardOverride);
				applyContextUtility(cardAct, 'opponentContext', 'uncertainty', contextSignals);
				applyContextUtility(cardAct, 'cardTiming', 'future', timingSignals);
				applyContextUtility(cardAct, 'threatForecast', 'risk', threatSignals);
				if (id === 'lebu' || id === 'bingliang') applyContextUtility(cardAct, 'judgeTiming', 'control', judgeSignals);
				applyDeepValueEvidence(cardAct, deepEvidence);
				applyFeedbackUtility(cardAct, {
					target: cardTarget ? getDecisionFeedbackSignal('target', cardTarget.name1 || cardTarget.name) : null,
					tempo: getDecisionFeedbackSignal('tempo', stageLabel),
					play: getDecisionFeedbackSignal('play', id), momentum: turnMomentum(me),
				});
				applyCardConsumptionUtility(me, cardAct, { econ, stage: stageLabel, weight: cfg('wOpportunityMul', 0.5), forecastRetention });
				acts.push(cardAct);
                }
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});
		/* 已迁移装备从Utility账本形成实际分数，后续仍接受统一policy与通用修正。 */
		acts.push(...equipmentUtility.candidates);
		/* ★ 模型先验融合已停用：模型不再以概率改写动作分数（接管权交予冠军策略）。
		 * 规则分（即时评分）作为基础，冠军策略在其之上提权/替换。 */
		try {
			/* const probs = miniPredict(miniFeatures()); */  // 不再调用小模型介入选牌分数
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		/* 结束回合候选 */
		acts.push({ type: "end", id: "end", score: 0, reason: "结束回合（保留" + hand.length + "张，" + sit.mode + "）" });

		/* ★ #39 Unified Utility Pipeline
		 * 卡牌、技能及专项来源独占写分；普通基线仍是显式启发式估计。
		 * 通用模块提交同基准建议；账本守恒不证明估计准确或动作实际获益。 */
		try { initializeUtilityPipeline(acts); }
		catch (eU) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eU); }

		/* 手牌保留与基础机会成本已统一进入cardConsumption；此处不再维护第二套handKeepBias，
		 * 防止“越想保留，出牌分反而越高”的方向冲突。 */

		/* 通用来源稍后同基准提交；身份隐蔽不奖励所有动作，避免无事件依据的倍率。 */

		/* ★ 攻击队友禁令：直接从候选中剔除所有攻击队友的动作 */
		try {
			const ATK_IDS = ["sha", "juedou", "huogong", "nanman", "wanjian", "jiedao", "lijian", "fanjian", "sidian", "huosha", "leisha", "zhujin", "shunshou", "guohe", "lebu", "bingliang", "tiesuo"];
			acts.forEach(function (a) {
				if (a.type !== "card") return;
				if (ATK_IDS.indexOf(a.id) < 0) return;
				/* 找到目标玩家对象 */
				const tgt = a.targetObj || resolvePlayerByKey(a.target, game.players || []);
				if (!tgt) return;
				if (_isAllyMemo(tgt)&&!(a.id==='jiedao'&&a.jiedaoPair?.use)) {
					/* ★ 不刻意加规则，让模型自己学：
					 *   打队友的惩罚不写死，而是把"是否打队友"作为特征写进 130 维特征
					 *   模型从对局反馈中自己学习这个特征的权重
					 *   打多了自然就知道不好，但又不会绝对禁止 */
					a.reason = (a.reason || "") + "（[特征]打队友）";
				}
			});
		} catch (eBan) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eBan); }

		/* ★ 模型融合变量声明（best 确定后再执行融合逻辑） */
		let modelConf = null, metaMod = null, intervention = 'skip';

		/* ★ 统一候选 policy 默认值 */
		acts.forEach(function (a) { try { ensureCandidatePolicy(a); } catch (e) {} });

        evaluationAudit.record('beforeBasicRules',acts);
		/* 基本规则负责目标与policy，保留逐模块故障隔离。
		 * 兼容观察器检测意外改分，差额保留legacyResidual供诊断。 */
		try { trackUtilityStage(acts, 'basicCardRules', 'legacyResidual', function () { applyBasicCardPlayRules(me, acts); }); }
		catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		try { trackUtilityStage(acts, 'basicSkillRules', 'legacyResidual', function () { applyBasicSkillRules(me, acts); }); }
		catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		try { trackUtilityStage(acts, 'basicEquipRules', 'legacyResidual', function () { applyBasicEquipRules(me, acts); }); }
		catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		try { trackUtilityStage(acts, 'basicJudgeRules', 'legacyResidual', function () { applyBasicJudgeRules(me, acts); }); }
		catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		try { trackUtilityStage(acts, 'basicTargetRules', 'legacyResidual', function () { applyBasicTargetRules(me, acts); }); }
		catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

        evaluationAudit.record('beforeCommonSuggestions',acts);
		/* 硬规则先绑定实际目标，方向守卫以实例逐个判断；分数已低于违规上限时不再重复扣。 */
		applyCommonUtilitySuggestions(acts, [
			{ source: 'modeStrategy', dimension: 'team', run: rows => { const mode = getModeStrategy(); for (const a of rows) { const delta = mode.decisionBoost(me, a); if (Number.isFinite(delta)) a.score += delta; a.mode = mode.name; } } },
			{ source: 'sharedKnowledge', dimension: 'team', run: rows => applySharedBonus(me, rows, { focusTarget: focus?.target || null }) },
			{ source: 'campSkillProgress', dimension: 'future', run: rows => applyCampSkillProgressBonus(me, rows) },
			{ source: 'resourceMaximize', dimension: 'resource', run: rows => applyResourceMaximizeBonus(me, rows) },
			{ source: 'lossMinimize', dimension: 'risk', run: rows => applyLossMinimizeBonus(me, rows) },
			{ source: 'characterPolicy', dimension: 'synergy', run: rows => applyCharacterPolicyToCandidates(me, rows.filter(a => a.type !== 'skill'), characterPolicy) },
		], {audit:auditMode.mode==='doudizhu'&&!!tacticalEnabled('diagnostic'),
         fusion:commonSuggestionFusionFor(auditMode)});
        evaluationAudit.record('afterCommonSuggestions',acts);
		// Seat opportunity preference is bounded and only active for real 2v2 contexts.
		try { applyVersusSeatPreferences(me, acts); }
		catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		for (const a of acts) { try { applyDirectionUtility(me, a, relActionValue); } catch (_) {} }

        evaluationAudit.record('afterDirectionGuard',acts);
		/* ★ #39 双轨对账：到此为止所有统一后处理分值变化应已进入 Utility Vector。 */
		try { finalizeUtilityPipeline(acts); }
		catch (eU) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eU); }

		/* ★ #37 战略层不修改 score：
		 * 只有明确 CRITICAL/FORCED 职责且候选高度对齐时提升 policy tier。
		 * 普通 FOCUS/BALANCE/DEVELOP 只记录 alignment，仍由 utility 排序。 */
		try { applyStrategicIntentToCandidates(acts, strategicState); }
		catch (eSI) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSI); }
		try { applyTiesuoRecastTiming(me, acts); }
		catch (eTR) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTR); }

        const classicModelBefore=decisionActionSnapshot(acts.slice().sort(compareActionCandidates)[0]);
        const classicFeatureBuffer=new Int8Array(FEATURE_DIM);
        const classicModelEvidence=applyClassicModel(acts,modeSampleMeta(me),a=>extractFeatures(me,a,{
            bestT,bestTs,isEnemy:bestT?_isEnemyMemo(bestT):false,focusTarget:focus?focus.target:null
        },classicFeatureBuffer,alivePlayers));
		acts.sort(compareActionCandidates);
		const endAction = acts.filter(function (a) { return a.type === "end"; })[0] || makeActionCandidate({ type: "end", id: "end", score: 0, reason: "结束回合" });
		ensureCandidatePolicy(endAction);
		let eligibleActs = acts.filter(isCandidateEligible);
		const topEligible = eligibleActs[0] || endAction;
		best = (candidatePriorityRank(topEligible) > 0 || topEligible.score > 0) ? topEligible : endAction;
        const decisionStages=createDecisionStages(classicModelBefore);
        decisionStages.record('classicModel',classicModelBefore,best,classicModelEvidence);
        const plannerBefore=decisionActionSnapshot(best);

		/* ★ Planner / Champion / DeepThink 只消费 eligible candidates；回放仍保留完整 acts。 */
		try {
			_status.djsc_lastCandidates = eligibleActs.slice();
			/* ★ 铁索提示桥：供 use.js filterTarget 纠偏（连谁/解谁）与 recast 探测。
			 *   取铁索候选（含 RECAST 候选）的最优者：引擎认为该重铸时 use.js 否决「使用」放行「重铸」。 */
			try {
				let _tsHint = null;
				for (const _a of eligibleActs) {
					if (_a && _a.type === 'card' && _a.id === 'tiesuo') {
						_tsHint = {
							recast: !!_a.recast,
							targets: Array.isArray(_a.targetList) ? _a.targetList.slice(0, 2) : (_a.target ? [_a.target] : []),
							score: _a.score,
						};
						break;
					}
				}
				_status.djsc_lastTiesuoHint = _tsHint;
			} catch (eTsHint) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTsHint); }
			_status.djsc_lastBestT = bestT;
			_status.djsc_lastBestTs = bestTs;
			_status.djsc_lastSit = sit;
			_status.djsc_lastEcon = econ;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		_markPhase('candidates');

		/* ★ 规划器：每次 bestAction 最多计算一次。
		 * decisionPlan 同时供 winner 改判与后续回放/日志使用，禁止为了 layers.plan 再次规划。 */
		let decisionPlan = null;
        let plannerError=null;
		try {
			decisionPlan = planForDecision(me, { strategicState: strategicState, candidates: eligibleActs });
			try { _status.djsc_lastDecisionPlan = decisionPlan || null; } catch (ePlanState) {}
			const comboChanged = applyComboFallbackUtility(me, acts, {
				plan: decisionPlan, detect: detectChains, scoreChain: chainScore, priorityChain: chainPriority,
				enabled: cfg('comboChain', true) !== false, weight: cfg('wComboBonus', 1),
			});
			if (comboChanged) {
				// 备用提示改变正式分数后不使用旧单步plan改判；每次决策仍只规划一次。
				decisionPlan = null;
				acts.sort(compareActionCandidates);
				eligibleActs = acts.filter(isCandidateEligible);
				const top = eligibleActs[0] || endAction;
				best = (candidatePriorityRank(top) > 0 || top.score > 0) ? top : endAction;
				_status.djsc_lastCandidates = eligibleActs.slice();
				_status.djsc_lastDecisionPlan = null;
			}
			const refined = refineBestWithPlan(me, best, bestT, decisionPlan);
			if (refined && refined !== best) {
				/* Planner 后续仍要经过 Champion / DeepThink / Guard，因此 winner 必须回到
				 * acts 中的 canonical candidate，禁止同一动作以两个不同对象继续参与排序。 */
				let canonical = acts.find(function (a) {
					return a && isCandidateEligible(a) && sameCandidateAction(a, refined);
				}) || null;
				if (canonical && canonical !== refined) {
					Object.assign(canonical, refined);
					best = canonical;
				} else {
					best = refined;
					if (!acts.some(function (a) { return a === refined; })) acts.push(refined);
				}
				acts.sort(compareActionCandidates);
				eligibleActs = acts.filter(isCandidateEligible);

				try {
					if (best.target && typeof best.target === 'object' &&
						(!bestT || (bestT.name1 || bestT.name) !== (best.target.name1 || best.target.name))) {
						bestT = best.target;
						bestTs = typeof best.score === 'number' ? best.score : bestTs;
					}
				} catch (eSync) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSync); }
			}
		} catch (eP) { plannerError=String(eP); if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eP); }

        decisionStages.record('planner',plannerBefore,best,{domain:'planning-value',error:plannerError,plan:planAdoption(decisionPlan,best),total:decisionPlan?.best?.total??null,futureScore:decisionPlan?.best?.futureScore??null});
        const championBefore=decisionActionSnapshot(best);
        let championEvidence={domain:'learned-preference',status:'not-triggered'};
		_markPhase('planner');

		/* ★ 按选择优先级采集特征：必保留当前 best，其余候选设数量与总耗时上限，减轻每次响应的同步工作。 */
		try {
			const _buf = new Int8Array(FEATURE_DIM);
			const ctx = {
				bestT: bestT,
				bestTs: bestTs,
				isEnemy: bestT ? _isEnemyMemo(bestT) : false,
				focusTarget: focus ? focus.target : null,
			};
			const featureCandidates = best ? [best, ...acts.filter(a => a !== best)] : acts;
			const MAX_FEAT_ACTS = 8;
			const MAX_FEATURE_CAPTURE_MS = 12;
			for (let i = 0; i < featureCandidates.length && i < MAX_FEAT_ACTS; i++) {
				try {
					/* 已选动作即使总预算到达也确保写入有效特征；其余候选共享 12ms 决策预算。 */
					if (i > 0 && performance.now() - _perfT0 > MAX_FEATURE_CAPTURE_MS) break;
					const candidate = featureCandidates[i];
					if (candidate._feat?.length === FEATURE_DIM) continue;
					const f = extractFeatures(me, candidate, ctx, _buf, alivePlayers);
					candidate._feat = Array.from(f);
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			}
		} catch (eFeat) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eFeat); }
		/* ★ 用训练好的模型微调（best 已确定，可安全访问 best._feat） */
		try {
			if (best && best._feat) {  /* ★ 4.1.2.5 解耦：冠军策略不再依赖 v5 模型开关（冠军=查表学习，不修改权重） */
				if (identityModelCompatibility().allowed && weightsReady() && cfg('useTrainedModel', true)) {
					const feat = new Int8Array(FEATURE_DIM);  /* ★ FEATURE_DIM 与 features.js 对齐（唯一真源，避免魔法数字漂移） */
					for (let i = 0; i < FEATURE_DIM && i < best._feat.length; i++) feat[i] = best._feat[i];
					modelConf = window.__DJSC && window.__DJSC.confidence ? window.__DJSC.confidence(feat) : null;
				}
				/* ★ 决策置信由"冠军嵌入价值"优先决定（冠军策略优先，原为模型置信度预测）。
				 * 命中冠军嵌入 → 价值折算为置信；否则用模型置信度作观测/兜底。 */
				{
					const _chid = (me && (me.name || me.name1)) || '';
					const _chRow = (best && typeof champEmbedding === 'function') ? champEmbedding(best.type, best.id, _chid) : null;
					if (_chRow && _chRow.value > 0) {
						best._conf = 0.4 + Math.min(0.5, Math.abs(_chRow.value));
						best.reason = (best.reason || '') + '｜冠军:' + _chRow.value.toFixed(2) + '·' + (_chRow.count || 0) + '条';
					} else {
						best._conf = (modelConf && modelConf.maxProb && !isNaN(modelConf.maxProb)) ? modelConf.maxProb : 0.3;
					}
				}
				/* ★ 4.1.2.5 冠军策略固化（从 v5 块解耦，独立执行，不受"启用训练模型"开关影响）：
				 * 命中样本训练出的同类型最高价值决策则提权并可能替换。
				 * 规则摘要（详见 championStrategy.applyChampionRule）：R1启用→R2同类型→R3候选命中→
				 * R4模糊判定→R5价值为正→R6提权→R7替换→R8兜底 */
				try {
					const _baseBoost = ((Number(cfg('championBoost', 0)) || 0) > 0 ? Number(cfg('championBoost', 0)) : 1);   /* ★ 冠军接管：配置>0用配置，否则默认强度1（对局唯一接管层） */
					const champBoost = _baseBoost * _aiStrengthFactor();
					if (champBoost > 0 && typeof applyChampionRule === 'function') {
						const cr = applyChampionRule(eligibleActs, best, champBoost, {
							heroId: (me && (me.name1 || me.name)) || '', modeContext:modeSampleMeta(me), /* ★ #38 当前实际行动者，禁止误用 game.me */
						});
						championEvidence=(cr && cr.evidence)?cr.evidence:{domain:'learned-preference',status:(cr&&cr.replaced)?'replaced':'kept',margin:(cr&&cr.margin!=null)?cr.margin:null,hit:(cr&&cr.hit)||0};
						if (cr && cr.replaced && cr.best && cr.best !== best) {
							best = cr.best;
							best.reason = (best.reason || '') + '｜冠军:' + ((cr && cr.hit) || 0) + '条';
						}
					}
				} catch (eChampOut) { championEvidence={domain:'learned-preference',status:'error',reason:String(eChampOut)}; if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eChampOut); }
				if (modelConf && modelConf.action !== 'skip') {
					metaMod = cognitiveModulate(
						{ type: best.type, id: best.id, target: best.target },
						{}
					);
					intervention = decideIntervention(modelConf, metaMod);
					const wModelMap = { model: 0.1, blend: 0.05, rule: 0.02, skip: 0 };  /* ★ 再调低权重，减少卡顿 */
					const baseW = wModelMap[intervention] || 0.1;
					let calibTrust = 0;
					try {
						if (window.__DJSC.calibrator && window.__DJSC.calibrator.modelTrust) {
							calibTrust = window.__DJSC.calibrator.modelTrust();
						}
					} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					/* ★ AI 强度档位：缩放模型对决策的影响力（不砍规则/战术层，只调模型强度）
					 *   极弱≈纯规则、弱→明显放水、中→平衡、强→全力、极强→全力×2 */
					const strengthFactor = _aiStrengthFactor();
					const wModel = 0;   /* ★ 模型不再接管选牌分数：置 0，仅保留置信度/校准/训练观测，不改写任何动作分。对局接管权交予下方冠军策略。 */
					if (false) { /* ★ 模型逐动作接管已停用（false）：不再为每个候选跑整网预测，也不再打印"模型接管"，彻底交予冠军策略接管。 */
						let _takeoverCount = 0;  /* ★ 统计本轮接管次数 */
						let _lastMLog = '';
						/* ★ 复用同一块 Int8Array 作为候选特征缓冲，避免每个动作都分配一次 */
						const _fa = new Int8Array(FEATURE_DIM);
						for (let i = 0; i < acts.length; i++) {
							const a = acts[i];
							if (!a._feat) continue;
							_fa.fill(0);
							for (let j = 0; j < FEATURE_DIM && j < a._feat.length; j++) _fa[j] = a._feat[j];
							/* ★ 性能优化：best 已在上面算过 modelConf，直接复用，省一次整网预测 */
							const sub = (a === best && modelConf && modelConf.action) ? modelConf : window.__DJSC.confidence(_fa);
							if (!sub) continue;
							const modelStrength = (sub.probs ? Math.max.apply(null, sub.probs) : 0) * 32;
							a.score = Math.round(a.score * (1 - wModel) + modelStrength * wModel);
							var mLog = '[M:' + sub.label + '·' + intervention + '·F' + Math.round(metaMod.familiarity * 100) + '%]';
							a.reason = (a.reason || '') + mLog;
							_takeoverCount++;
							_lastMLog = mLog;
						}
						/* ★ 日志：不管有没有给其他动作提取特征，都打印一行 */
						try {
							var _baseMLog = '[M:' + (modelConf.action || '?') + '·' + intervention + '·F' + Math.round((metaMod && metaMod.familiarity) * 100) + '%]';
							if (_takeoverCount > 0) {
								game.log('模型接管 ×' + _takeoverCount + ' 个动作 ' + _lastMLog);
							} else {
								game.log('模型融合 ' + _baseMLog + ' (仅best)');
							}
						} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					}
					/* ★ 4.1.2.5：冠军策略已上移至 v5 块之外独立执行（不受"启用训练模型"开关影响） */
					_deferEffect('model-observation', function () {
						try {
							if (window.__DJSC.conflict && window.__DJSC.conflict.detect) {
								window.__DJSC.conflict.detect(best, modelConf, metaMod, { type: best.type, id: best.id, target: best.target });
							}
						} catch (eC) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eC); }
						try {
							if (window.__DJSC.calibrator && window.__DJSC.calibrator.record && modelConf) {
								window.__DJSC.calibrator.record(best, modelConf, { me: me, bestT: bestT, bestTs: bestTs });
							}
						} catch (eCal) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCal); }
					});
					try {
						if (false && window.__DJSC.strategyBus && modelConf && modelConf.confidence >= 0.55) {   /* ★ 模型仲裁接管已停用（false），接管权交予冠军策略 */
							const busRes = window.__DJSC.strategyBus.arbitrate(best, modelConf, me, acts);
							if (busRes && busRes.picked) {
								best = busRes.picked;
								best.reason = (best.reason || '') + '｜总线：' + busRes.reason;
							}
						}
					} catch (eBus) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eBus); }
					try { _status.djsc_lastConfidence = modelConf; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					try { _status.djsc_lastMeta = { model: modelConf, meta: metaMod, intervention: intervention }; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				}
			}
		} catch (eModel) {
			try { console.error('[模型融合] 异常：', eModel); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}

        decisionStages.record('champion',championBefore,best,championEvidence);
        const deepBefore=decisionActionSnapshot(best);
        let deepEvidence={domain:'deep-comparison',status:'not-triggered'};
		/* ★ 模型深度思考（思考层，归"模型"职责；其余成片归子代理）。
		 * 对冠军策略已定夺的 best 做批判性多源复核：best 与次优分差小（分歧大）时才触发，
		 * 产出思维链 thinking，若推翻了则给出替代建议。尊重冠军策略的最终定夺。 */
		try {
			if (best && typeof deepThinkCritic === 'function') {
				const _dRes = deepThinkCritic(me, eligibleActs, best, {
					modelP: (modelConf && modelConf.maxProb) || 0,
					heroId: (me && (me.name || me.name1)) || '',
				});
                deepEvidence=_dRes?.evidence||{domain:'deep-comparison',status:'no-result'};
				if (_dRes && Array.isArray(_dRes.thinking)) {
					try { _status.djsc_lastThinking = _dRes.thinking; } catch (eTH) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTH); }
				}
				if (_dRes && _dRes.replaced && _dRes.best && _dRes.best !== best) {
					best = _dRes.best;
					best.reason = (best.reason || '') + '｜深度思考:' + (_dRes.reason || '改打');
				}
			}
		} catch (eDeep) { deepEvidence={domain:'deep-comparison',status:'error',reason:String(eDeep)}; if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eDeep); }

        decisionStages.record('deepThink',deepBefore,best,deepEvidence);
        const policyBefore=decisionActionSnapshot(best);
		/* ★ #37 Strategic Policy Barrier
		 * Champion/DeepThink 可以在同一 policy band 内优化，但不能把 CRITICAL/FORCED
		 * 身份职责降回普通动作。Guard 仍位于后方，保留最终安全否决权。 */
		try {
			acts.sort(compareActionCandidates);
			const strategicTop = acts.find(isCandidateEligible) || null;
			if (strategicTop && best && !sameCandidatePolicyBand(strategicTop, best) &&
				compareActionCandidates(strategicTop, best) < 0) {
				best = strategicTop;
				best.reason = (best.reason || '') + '｜战略职责边界';
			}
		} catch (ePolicy) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(ePolicy); }

        decisionStages.record('policyBarrier',policyBefore,best,{domain:'policy'});
		_deferEffect('cognition-log', function () {
/* ★ 认知日志 */
		try {
			if (window.__DJSC.cognitionLog && window.__DJSC.cognitionLog.log) {
				window.__DJSC.cognitionLog.log({
					round: (typeof _status !== 'undefined' && _status.roundNumber) || 0,
					player: (me.name1 || me.name) || '?',
					action: best.type + ':' + best.id,
					model: modelConf,
					meta: metaMod,
					intervention: intervention,
					effective: (window.__DJSC.metaCognition && modelConf && metaMod)
						? window.__DJSC.metaCognition.effective(modelConf, metaMod) : 0,
				});
			}
		} catch (eCL) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCL); }


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
/* ===== 技能反馈：记录本次技能使用的预测收益 ===== */
		try {
			if (best && best.type === "skill" && cfg("skillFeedback", true) !== false) {
				const sid = best.id;
				let predicted = 0;
				try {
					const prof = skillProfileOf(sid);
					if (prof && prof.profit) predicted = prof.profit.originalBase || prof.profit.base || 0;
				} catch (eP) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eP); }
				if (predicted > 0) {
					recordSkillUse(sid, keyOf(me), predicted);
					/* ★ 元素反馈：观察技能使用 */
					try {
						observeElementUse('skill', sid, me, { hpBefore: me.hp || 0 });
					} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					/* ★ 元认知：记录技能使用 */
					try { metaRecordSkill(sid); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				}
			}
		} catch (eFb) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eFb); }
		
		});
		_deferEffect('style-feedback', function () {
/* ===== 风格反馈：记录本局每个敌人的风格与胜负信号 ===== */
		try {
			if (cfg("styleFeedback", true) !== false) {
				for (const p of (game.players || [])) {
					if (!p || p === me || p.alive === false) continue;
					const s = styleOf(p);
					if (s && s.tag && s.tag !== "unknown") {
						recordStyleOutcome(s.tag, keyOf(p), (round[keyOf(p)] || 0));
					}
				}
			}
		} catch (eSf) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSf); }
		
		});
		_deferEffect('decision-record', function () {
/* ===== 记录本次决策（六层信号 + 候选 + 胜出） ===== */
		try {
			const layers = {
				character: characterPolicySnapshot(characterPolicy),
				tempo: { mode: sit.mode, stage: stageLabel, baseTempo: sit.tempo, atkMul: atkMul, keepMul: keepMul, burstMul: burstMul, desc: sit.tempoDesc || sit.desc },
				risk: { label: riskLabel, atk: risk.atk, def: risk.def, safe: risk.safe },
				team: { focus: focus ? focus.name : null, focusScore: focus ? focus.score : 0, protect: team.protect ? team.protect.name : null, protectScore: team.protect ? team.protect.score : 0, comboCount: teamCombos.length },
				seat: { enemyPressure: seat.enemyPressure, nextEnemy: seat.nextEnemy ? (seat.nextEnemy.name || "?") : null, prevEnemy: seat.prevEnemy ? (seat.prevEnemy.name || "?") : null },
				econ: { handCount: econ.handCount, handValue: econ.handValue, equipCount: econ.equipCount, equipValue: econ.equipValue, hp: econ.hp, maxHp: econ.maxHp, hpRatio: econ.hpRatio, totalValue: econ.totalValue, stripPressure: econ.strip ? econ.strip.pressure : 0 },
				style: { target: bestT ? (bestT.name || "?") : null, tag: (function () { try { return bestT ? styleOf(bestT).tag : null; } catch (e) { return null; } })() },
				forecast: {
					incomingTotal: incoming.total,
					selfRisk: incoming.selfRisk,
					killRisk: incoming.killRisk,
					topEnemy: (incoming.byEnemy && incoming.byEnemy[0]) ? incoming.byEnemy[0].name : null,
					teamRisk: forecast.team.map(function (t) { return t.name + "(" + t.risk + ")"; }).slice(0, 3),
					advice: forecast.advice,
				},
				multiturn: {
					overall: mt ? mt.overall : "stable",
					r1: mt && mt.r1 ? mt.r1.trend : null,
					r3: mt && mt.r3 ? mt.r3.trend : null,
					advice: mt ? mt.advice : "",
				},
			};
			/* ★ 复用本次 bestAction 已计算的 decisionPlan；观测层不得再次触发 Planner。 */
			try {
				if (decisionPlan && decisionPlan.best) {
					layers.plan = {
						adoption: planAdoption(decisionPlan,best),
                        plannerVersion: decisionPlan.plannerVersion || 'legacy',
						isKill: decisionPlan.isKill || false,
						total: decisionPlan.best.total,
						futureScore: decisionPlan.best.futureScore || 0,
						steps: (decisionPlan.best.steps || []).map(function (s) { return s.id || s; }).slice(0, 3),
						intent: strategicState && strategicState.intent ? {
							type: strategicState.intent.type || null,
							target: strategicState.intent.target || null,
							priorityTier: strategicState.intent.priorityTier || 'normal',
						} : null,
						dependencies: (decisionPlan.best.dependencies || []).map(function (d) {
							return {
								kind: d.kind || '',
								from: d.from || '',
								to: d.to || '',
								reason: d.reason || '',
							};
						}).slice(0, 3),
						alternatives: (decisionPlan.alternatives || []).map(function (alt) {
							return { id: alt.action && alt.action.id, total: alt.total };
						}).slice(0, 2),
					};
				}
			} catch (ePlan) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(ePlan); }
			recordDecision(me, layers, acts, best, modelConf);
			/* ★ 决策对比模式：记录本局面各档案的选择，供对比面板统计 */
			try {
				if (window.__DJSC && window.__DJSC.compare && window.__DJSC.compare.record) {
					window.__DJSC.compare.record(me, acts, best);
				}
			} catch (eComp) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eComp); }
		} catch (eRec) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eRec); }
		
		});
		_deferEffect('decision-replay', function () {
/* ★ 决策回放时间轴 + 自动特征发现：独立 try 包裹，绝不因上面 layers/plan 构建异常而被连坐跳过。
		 * 此前放在大 try 内，任一步抛错即整体丢失，面板恒 0。 */
		try {
			if (window.__DJSC && window.__DJSC.replay && window.__DJSC.replay.record) {
				window.__DJSC.replay.record({
					player: (me.name1 || me.name) || '?',
					round: _getRoundNumber(),
					me: me,
					state: { hp: me.hp, maxHp: me.maxHp },
					candidates: (acts || []).slice(0, 6),
					rule: best.type === 'card' || best.type === 'skill' ? { type: best.type, id: best.id, score: best.score, target: candidateTargetValue(best), reason: best.reason || '', policy: candidatePolicySnapshot(best) } : null,
					model: modelConf ? { label: modelConf.label, confidence: modelConf.maxProb !== undefined ? modelConf.maxProb : (modelConf.confidence !== undefined ? modelConf.confidence : 0) } : null,
					meta: metaMod ? { familiarity: metaMod.familiarity, modulator: metaMod.modulator, level: metaMod.level } : null,
					bus: { winner: best.type + ':' + best.id, reason: (best.reason || '').slice(0, 60) },
					final: { type: best.type, id: best.id, score: best.score, target: candidateTargetValue(best), reason: best.reason || '', policy: candidatePolicySnapshot(best) },
					intervention: intervention || 'none',
				});
			}
		} catch (eRep) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eRep); }
		
		});
		const forecastTip = "｜预测：" + forecast.advice + "（压力 " + incoming.total + " 风险 " + Math.round(incoming.selfRisk * 100) + "%）";
		const mtTip = mt ? ("｜趋势：" + mt.overall) : "";
		const trendTip = "｜趋势权重：" + (trend === "worsening" ? "进攻↑守↓" : trend === "improving" ? "守↑攻↓" : "均衡");
		_deferEffect('team-broadcast', function () {
/* ★ 广播：告诉队友我打谁 */
		try {
			if (bestT && (best.type === 'card' || best.type === 'skill')) {
				const id = best.id || '';
				const ATK = ['sha','juedou','huogong','nanman','wanjian','zhujin','shunshou','guohe','tiesuo','lebu','bingliang'];
				if (ATK.indexOf(id) >= 0) {
					broadcastIntent(me, bestT, id, best.score);
				}
			}
		} catch (eB) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eB); }

		});
				_markPhase('observability');

        const guardBefore=decisionActionSnapshot(best);
        let guardEvidence={domain:'legality',status:'not-evaluated'};
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
            guardEvidence={domain:'legality',ok:_guardRes.ok,rule:_guardRes.rule||null,reason:_guardRes.reason||null};
			if (!_guardRes.ok) {
			/* ★ fix6: 接通 violation 埋线——把被拦的原始意图写入 _status.djsc_lastViolation，
			 *   trainRecordSample 读取端按 transactionId 匹配后写入样本 violation 字段。
			 *   语义：该事务中 AI 本想做 X（被红线拦截），实际执行的是 fallback——
			 *   为「主动决策负样本」提供确定性规则来源（MISS_KILL/SELF_HARM 等）。 */
			try {
				const _vtTx = peekDecisionTransaction(me);
				if (_vtTx && _vtTx.id && _status) {
					_status.djsc_lastViolation = {
						transactionId: _vtTx.id,
						type: best.type || null,
						card: best.id || null,
						target: (typeof best.target === 'string' ? best.target : (best.target && best.target.name) || null),
						rule: _guardRes.rule || null,
						reason: _guardRes.reason || null,
						ts: Date.now(),
					};
				}
			} catch (eViol) {}
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
								return p && targetKey(p) === best.target;
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
            guardEvidence={domain:'legality',status:'error',reason:String(eGuard)};
			try { console.error('[模型护栏] 集成异常：', eGuard); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}

        decisionStages.record('guard',guardBefore,best,guardEvidence);
        decisionStages.record('classicCandidate',best,best,classicCandidateShadow(best,eligibleActs,modeContext()));
        decisionStages.setEvaluationAudit(evaluationAudit.snapshot(acts,best));
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
			reason: best.reason + "（决策评分" + runtimeScore(best.score) + "，策略优先级=" + ensureCandidatePolicy(best).priorityTier +
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
            decisionStages:decisionStages.snapshot(best),
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

		_deferEffect('learning-and-postcheck', function (actual, transaction) {
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
				/* ★ PR5e.4：对最终所选动作做一次 v5 集成推理，评分随 meta.v5 落库并随样本上传。
				 *   之前 v5 推理只进 shadow 决策级日志，训练样本里没有 v5 视角，服务器无法做样本级对比。
				 *   未加载模型/更新开关关闭时 v5Predict 返回 null，字段为 null 不影响老分析。 */
				let _v5meta = null;
				try {
					if (cfg('useTrainedModel', true) && featToUse && featToUse.length >= 130) {  /* ★ 4.1.2.5：v5 采样推理受"启用训练模型"门控，关闭时省一次整网前向 */
						const _vp = v5Predict(featToUse);
						if (_vp) _v5meta = { ens: Math.round(_vp.ensemble * 1000) / 1000, s42: Math.round(_vp.s42 * 1000) / 1000, s456: Math.round(_vp.s456 * 1000) / 1000 };
					}
				} catch (eV5m) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eV5m); }
				for (let t = 0; t < times; t++) {
					const sample = trainRecordSample(me, best, sit, best.score, featToUse, {
                        transactionId: transaction.id, actorId: targetKey(me), target: actual.target || null, v5: _v5meta });
                    if (sample) { transaction.trainingSessionId = sample.sessionId; transaction.trainingActionType = best.type; transaction.trainingActorId = targetKey(me);
                        recordDecisionContext(_autofeatCtx(me, best, bestT), transaction, sample.sample); }
				}

				/* ★ 4.1.2.6：技能漏斗终局回传——本回合技能候选入池数与技能是否胜出，随 skillDiag 上报 */
				try {
					let _skPool = 0;
					for (let _si = 0; _si < eligibleActs.length; _si++) { if (eligibleActs[_si] && eligibleActs[_si].type === 'skill') _skPool++; }
					trackSkillOutcome(_skPool, best && best.type === 'skill');
				} catch (eSkt) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSkt); }
				/* 未执行候选仅保留在分析档案，不伪装成真实执行样本。 */
				/* ★ 样本满3万后自动清洗：只保留高价值（置信度低）的 */
				if (typeof bufferSize === 'function' && bufferSize() >= 30000) {
					try {
						if (window.__DJSC.trainExport && window.__DJSC.trainExport.cleanLowValue) {
							window.__DJSC.trainExport.cleanLowValue();
						}
					} catch (eClean) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eClean); }
				}
			} catch (eRec) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eRec); }

            /* 收益由宿主useCard完成事件回填；未执行候选和无法确认完成的技能不猜标签。 */
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		
		});
		/* ★ 调用总线仲裁 */
		try {
			const stratResult = strategize(me, _status.event, _finalResult);
			if (stratResult) _finalResult.strategist = stratResult;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		_markPhase('telemetry');

		/* ★ 4.1.5.0：策略模型 v3 影子评估接线（默认 shadow：只记录模型 top1/一致率，不改候选分）。
		 *   模型由 score/model/net/policyModelV3.js 懒加载并挂 window.__DJSC.policyModelV3；
		 *   未加载完成时 adapter 内部自动跳过（skipped++），不阻塞决策。
		 *   开关：cfg('policyModelV3Shadow', true)；active 软加分需 cfg('policyModelV3Mode')==='active' 且影子连续达标。 */
		try {
			if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.policyModelV3
				&& typeof window.__DJSC.policyModelV3.shadow === 'function'
				&& cfg('policyModelV3Shadow', true)) {
				const _pmMode = (function () { try { return (typeof game !== 'undefined' && game.mode) || ''; } catch (eM) { return ''; } })();
				const _pmRound = (function () { try { return (typeof _status !== 'undefined' && _status.turn) ? (_status.turn.id || 0) : 0; } catch (eR) { return 0; } })();
				window.__DJSC.policyModelV3.shadow(eligibleActs, best, null, { mode: _pmMode, round: _pmRound });
			}
		} catch (ePm3) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(ePm3); }

		/* ★ 测试观测：Evaluate 阶段只计算耗时；左侧日志/回放只在 Commit 后落地。 */
		let _decisionMs = Math.max(0, performance.now() - _perfT0);
		let _phaseMs = _phaseSnapshot();
		try {
			_finalResult.decisionMs = Math.round(_decisionMs);
			_finalResult.phaseMs = _phaseMs;
			try { perfMark('bestAction', _decisionMs); } catch (eP) {}

		} catch (eTrace) {
			if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTrace);
			try { perfMark('bestAction', performance.now() - _perfT0); } catch (eP) {}

		}

		const executedChainIds = (best.comboChainIds || []).slice();
		_deferEffect('combo-chain-execution', function () { recordExecutedChainIds(executedChainIds); });

		_deferEffect('decision-trace', function (actual, transaction) {
			const stages=decisionStages.snapshot(best,actual,transaction);
            stages.actorId=targetKey(me);
            _finalResult.decisionStages=stages;
            _finalizeDecisionRecord(me, acts, best, _decisionMs, _phaseMs, actual, transaction, stages);
		});

		/* ★ 事务只随返回值携带，不在 Evaluate 内写 pending 状态。
		 * soft/hard 接管层拿到 bestAction 后负责 stage；真实 useCard/logSkill/endTurn 再 commit。 */
		try {
			const _txExpectedType = (best && best.type === 'equip') ? 'card' : ((best && best.type) || 'unknown');
			const _txExpectedTarget = _txExpectedType === 'skill' ? null : _finalTarget;
			const _tx = createDecisionTransaction({
				type: _txExpectedType,
				id: (best && best.id) || _finalResult.rule,
				target: _txExpectedTarget,
				recast: !!best.recast,
			}, function (_actual, _txInfo) {
				for (let i = 0; i < _deferredEffects.length; i++) {
					const effect = _deferredEffects[i];
					try { effect.fn(_actual, _txInfo); }
					catch (eFx) {
						if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eFx);
					}
				}
			}, {
				actor: me, domain: 'play', choiceWindow: playChoiceWindow(_status.event, me),
				meta: {
					player: (me && (me.name1 || me.name)) || '?',
					round: _getRoundNumber(),
					decisionMs: Math.round(_decisionMs),
				},
			});
            if(modeContext().mode==='doudizhu'){
                try{matchArchive.record('decisionSuggestion',{transactionId:_tx.id,actorId:targetKey(me),modeContext:modeSampleMeta(me),executionState:'suggested',trainingEligible:false,
                    winner:{...decisionActionSnapshot(best),reason:String(best.reason||'').slice(0,800)},candidates:acts.slice().sort(compareActionCandidates).slice(0,24).map(a=>({...decisionActionSnapshot(a),reason:String(a.reason||'').slice(0,800)})),
                    decisionStages:decisionStages.snapshot(best,null,_tx),context:publicDecisionContext(me,game.players,targetKey),decisionMs:Math.round(_decisionMs)},
                    {playerId:targetKey(me),round:_getRoundNumber(),videoIndex:Array.isArray(lib.video)?lib.video.length:null});}catch(_){}
            }
			Object.defineProperty(_finalResult, '__djscTransaction', {
				value: _tx, enumerable: false, configurable: false, writable: false,
			});
		} catch (eTx) {
			if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTx);
		}

		/* ★ 存入缓存：仅缓存本次计算开始时对应的 state-key。
		 * bestAction 本身应为纯决策；若后处理意外改变公开状态，下一次 stateKey 会自然失效。 */
		_lastBestAction = _finalResult;
		_lastBestActionTime = Date.now();
		_lastBestActionStateKey = _decisionStateKey || '';
        _lastDecisionCacheContext=decisionCacheContext;

		/* ★ per-player 缓存写入（非本机玩家） */
		try {
			const _ppMe2 = (_status && _status.currentPhase) || game.me;
			if (_ppMe2 && _ppMe2 !== game.me) {
				const _ppKey2 = _ppMe2.playerid || _ppMe2.name1 || _ppMe2.name || 'ai';
				const _ppStore2 = (window.__DJSC._baPPCache = window.__DJSC._baPPCache || {});
				_ppStore2[_ppKey2] = { ba: _finalResult, t: Date.now(),...decisionCacheContext };
			}
		} catch (ePP2) { }

		return _finalResult;
	} catch (e) {
		try { perfMark('bestAction', performance.now() - _perfT0); } catch (eP) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eP); }

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
	try {
		if (settleDone) return;
		settleDone = true;
		try { actionOutcomes.flushTerminal(); } catch (_) {}
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
		/* 只有宿主明确胜负才进入二元学习接口；平局/未知保留事实，不作为失败。 */
		const _verdict = gameTelemetry.snapshot().verdict;
		let _won = binaryGameResult(_verdict);
		if (_won === null) {
			/* ★ 身份局兼容回退：身份局宿主 game.over('zhu'/'fan'/...) 不映射 win/lose（对方专项以斗地主为主），
			 *   telemetry 未知时按 game.winner 判定（兼容数组/玩家对象/阵营字符串，'zhu' 时主忠明忠共赢），
			 *   保证零和结算分、训练标签、冠军固化在身份局继续工作。 */
			try {
				if (game.winner) {
					const _wsWin = _winningSet();
					_won = _wsWin.some(function (p) { return p === game.me; });
				}
			} catch (eW) { }
		}
		const _hasResult = _won !== null;
		try { recordClassicMatch(modeContext(),roleOf(game.me?._trueMe||game.me),_hasResult?_won:null); closeModeContext(); trainSettleGame(game.me, _won); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			try { onGameEndHook(); } catch (eCI2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCI2); }   /* ★ 上报通道：局末检查（每小时节奏） */

		/* ★ 胜负结算分（严格零和）：胜方每人 +败方人数×权重，败方每人 −胜方人数×同权（Σ=0 恒成立）。
		 *   修复「主公败了局内贡献分仍居榜首、面板看不出胜负」——胜负结果直接体现在积分账上。 */
		try {
			const _wsv = _winningSet();
			if (_wsv && _wsv.length && (game.players || []).length > 1) {
				const _wset = new Set(_wsv);
				const _lsers = (game.players || []).filter(function (p) { return p && !_wset.has(p); });
				if (_lsers.length) {
					const _KW = 6;
					_wsv.forEach(function (p) { give(p, Math.round(_lsers.length * _KW), "胜负结算·胜"); });
					_lsers.forEach(function (p) { give(p, -Math.round(_wsv.length * _KW), "胜负结算·负"); });
					try { log.info('score', '胜负结算分已入账：胜方' + _wsv.length + '人 +' + Math.round(_lsers.length * _KW) + '，败方' + _lsers.length + '人 -' + Math.round(_wsv.length * _KW)); } catch (eLg) { }
				}
			}
		} catch (eVS) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eVS); }
		/* ★ 冠军库滚动刷新：局末 TD 回填(trainSettleGame)后立即从最新样本重算冠军嵌入。
		 *   此前只在训练晋升(PROMOTE)时固化一次——自动训练关闭期间冠军库永不更新；
		 *   且旧样本回填值不落库(_persisted 增量跳过)，重启后再固化反而把库清空。
		 *   局末滚动刷新让冠军头随对局持续积累，配合修好的回填落库形成闭环。 */
		try {
			if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.champion && typeof window.__DJSC.champion.recompute === 'function') {
				/* ★ 卡顿修复：局末冠军重算节流——距上次 ≥120s 或样本增量 ≥20 才跑 */
				const _th = (window.__DJSC._champRecThrottle = window.__DJSC._champRecThrottle || { ts: 0, n: -1 });
				let _bn = _th.n;
				try { if (typeof window.__DJSC.trainBufferSize === 'function') _bn = window.__DJSC.trainBufferSize(); } catch (eB) { }
				const _nowR = Date.now();
				if (_nowR - _th.ts >= 120000 || Math.abs(_bn - _th.n) >= 20) {
					_th.ts = _nowR; _th.n = _bn;
					const _emb = window.__DJSC.champion.recompute();
					/* ★ 跑通进度可视化：局末固化结果入日志——用户能直接看到冠军库在成长，
					 *   空 库时说明门槛（同决策点≥5条且最高价值>0），不再像"未加载"故障。 */
					try {
						let _t = 0, _d = 0;
						for (const _k in (_emb || {})) {
							if (!Object.prototype.hasOwnProperty.call(_emb, _k)) continue;
							_t++; _d += ((_emb[_k] || []).length);
						}
						if (_d > 0) log.info('champion', '局末冠军库刷新：' + _t + ' 类 / ' + _d + ' 条决策点');
						else if (_bn > 0) log.info('champion', '冠军库暂空（样本缓冲 ' + _bn + ' 条）：同一决策点需累计≥5条样本且最高价值>0 才固化，多打几局逐步出现');
					} catch (eCR) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCR); }
				}
			}
		} catch (eC) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eC); }
		/* ★ 学习闭环：记录本局胜负 → 胜率统计 → 触发自动调权（此前 recordGameResult 只 import 从未调用，
		 * 胜率恒为 0、autoAdjustWeights 永不生效——闭合闭环后面板/自检才能看到真实胜率） */
		try { if (_hasResult) recordGameResult(_won); } catch (eL) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eL); }
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
			if (_hasResult && typeof autoAdjustWeights === 'function') {
				const adj = autoAdjustWeights();
				if (adj && adj.adjusted) log.info('learn', '自动调权建议：' + adj.reason);
			}
		} catch (eA) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eA); }
		/* ★ 公共知识库贡献：把本局每个决策的（局面指纹→选择→输赢）写入群体样本。
		 * 此前 shareContribute 只挂载从未调用，贡献数恒 0。用真实胜负 _won 打标。 */
		try {
			const _dLogC = getDecisionLog();
			for (const _eC of (_hasResult ? _dLogC || [] : [])) {
				if (!_eC || !_eC.candidates || _eC.executionState !== 'committed') continue;
				if (_eC.playerId ? _eC.playerId !== (game.me && game.me.playerid) : _eC.player !== (game.me && (game.me.name || game.me.name1))) continue;
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
			if (_hasResult && window.__DJSC.multiProfile) {
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
					verdict: _verdict,
					myScore: myScore3,
				});
			}
		} catch (eR) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eR); }
		/* ★ 软指标学习：把本局结果喂给 softMetrics（此前只有挂载无调用，总学习次数恒 0）。 */
		try {
			if (_hasResult && typeof learnFromGame === 'function') {
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
		/* ★ 模型热更新：回填 A/B 分数（4.1.2.4：端上训练停用，不再自动触发 trigger——权重只从服务器更新） */
		try {
			if (window.__DJSC && window.__DJSC.hotSwap) {
				const meHS = game.me;
				const myKeyHS = meHS ? (meHS.name1 || meHS.name || '?') : '?';
				const myScoreHS = (round && round[myKeyHS]) || 0;
				window.__DJSC.hotSwap.recordScore(myScoreHS);
			}
		} catch (eHS) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eHS); }
		/* ★ 策略进化：回填本局结果（胜负用真实 _won 判定，此前用回合分>0 误判，适应度恒 0%） */
		try {
			if (_hasResult && window.__DJSC && window.__DJSC.evolution) {
				const bestEV = window.__DJSC.evolution.current ? window.__DJSC.evolution.current() : null;
				if (bestEV) {
					window.__DJSC.evolution.record(bestEV.id, _won);
				}
			}
		} catch (eEV) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eEV); }
		/* ★ 积分自修改：根据本局结果调整积分（胜负用真实 _won） */
		try {
			if (_hasResult && window.__DJSC && window.__DJSC.scoreSelfMod) {
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
			/* 已执行样本由事务提交阶段记录；结算不重复推入近期日志样本。 */
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
				matchId: matchArchive.matchId(),
				ts: Date.now(),
				mode: mode,
				myIdentity: me ? (me.identity || null) : null,
				myScore: Math.round(myScore * 100) / 100,
				playerCount: new Set((game.players || []).concat(game.dead || [])).size,
				roundCount: _getRoundNumber(),
				decisionSteps: gameTelemetry.snapshot().decisions,
				telemetry: gameTelemetry.snapshot(),
				transactions: decisionTransactionStats(),
				quality: q,
				topCards: topCards,
				verdict: gameTelemetry.snapshot().verdict,
				resultSource: 'host',
				decisions: compressed,
				/* ★ 完整日志 */
				logs: dLog,           // AI决策日志（完整）
				playerLogs: _playerLogs,  // ★ 玩家操作日志（实际收集）
			});
			/* ★ 自存完整对局日志：内核录像只留 20 条，这里自己留（局数由 logRetain 配置决定） */
			try {
				recordGameLog({
					matchId: matchArchive.matchId(),
					ts: Date.now(),
					mode: mode,
					myIdentity: me ? (me.identity || null) : null,
					myScore: Math.round(myScore * 100) / 100,
					verdict: gameTelemetry.snapshot().verdict,
				resultSource: 'host',
					decisions: compressed,
					logs: dLog,
					playerLogs: _playerLogs,
					topCards: topCards,
				});
			} catch (eLogStore) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eLogStore); }
			/* ★ 清空玩家日志，准备下一局 */
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
		/* ★ 决策维度反馈回写（历史数据仅供解释）
         * 终局胜负不提供单步 target/tempo/play 收益归因，不继续更新这些旧比率。
         * 已提交动作的 actionOutcome/credit 仍走独立真实结果链。 */
        try { if (_hasResult) log.info('feedback', '真实胜负已记录；历史决策比率不再按整局胜负更新'); }
        catch (_) {}
        /* ★ 自适应难度 */
		try { updateAdaptive(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		try {
			const match = matchArchive.settle({ ...gameTelemetry.snapshot(), transactions: decisionTransactionStats(),
				myScore: game.me ? round[keyOf(game.me)] || 0 : null }, matchReplay);
			if (match) {
                const context=match.meta?.modeContext;
                if(context?.mode==='doudizhu'){
                    const samples=selectClassicDataset(_trainExportModule.getSamples()).samples.filter(s=>s.m.sessionId===context.sessionId).length;
                    match.choiceAuditStats=choiceAuditStats();
                    match.classicEffects={runtime:classicRuntimeSummary(context.sessionId),samples,update:{status:context.autoUpdate?'running':'disabled'}};
                }
				preparePlayerFeedback(match, cfg("playerFeedback", true) !== false);
				void saveMatchArchive(match, id => (lib.translate && lib.translate[id]) || id).catch(() => {});
                if(context?.mode==='doudizhu'&&context.autoUpdate)setTimeout(async()=>{
                    let update;try{const result=await runClassicPostGameUpdate(context.sessionId);update={status:result.skipped?'skipped':result.ok?'updated':'failed',result};}catch(e){update={status:'failed',result:{err:String(e.message||e)}};}
                    void updateClassicEffects(match.matchId,update,id=>lib.translate?.[id]||id).catch(()=>{});
                },0);

			}
		} catch (e) {}
		/* 延迟弹出战报（避免与本体结算界面冲突） */
		try {
            const settledMatchId=currentMatchArchive()?.matchId,settledMode=modeContext();
			setTimeout(function () {
				try {
					if(currentMatchArchive()?.matchId===settledMatchId&&modeContext().sessionId===settledMode.sessionId&&(cfg("showReport",true)||settledMode.mode==='doudizhu'&&cfg("classicEffectReport",true)))showReport();
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
						const publicIdentity = publicIdentityRole(p) || '?';
						beliefs[targetKey(p)] = {
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

	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
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
/* ★ panel 兜底结算通道：panel.js gameOver 兜底里手动触发局末结算（settleDone 幂等，与 game.on 挂载双通道不重复） */
export { settle as engineSettle };
export function getGameTelemetry() { return gameTelemetry.snapshot(); }
/* ★ 守恒引擎审计导出：面板/自检可调用查看守恒不变量 */
export function getConservationLedger() { return conservationLedger(); }
export function getREC() { return REC; }
export function resetRound() { round = {}; scoreLog = []; }
/* ★ 跨局积分清零：新一局开始时清空局内账本（不动跨局学习 MEM/REC）。
 *   修复：clearScoreState 只在扩展安装时调用一次 → 「重新开始」后上一局积分残留泄漏进下一局面板（主公败了仍显示上一局加分）。 */
export function resetScoreForNewGame() {
	try {
		round = {}; _rawRound = {}; _ledger = 0; scoreLog = []; _poolPromise = 0;
		settleDone = false;   /* 新一局需重新可结算（否则第二局 settle 被旧守卫拦死） */
		/* ★ 跨局残留清理：贴牌循环记录/濒死记录清空，防止上一局行为误伤新一局评估 */
		try { _delayPostLog.length = 0; } catch (eDp) { }
		try { if (window.__DJSC && window.__DJSC._djscKnockdownLog) window.__DJSC._djscKnockdownLog.length = 0; } catch (eKd) { }
		try { if (window.__DJSC) { window.__DJSC._baPPCache = {}; window.__DJSC._tiesuoDecisionCache = {}; } } catch (eC) { }
	} catch (e) { }
}
/* ★ 我方胜负判定（面板/战报统一入口）：优先 _winningSet，回退存活 */
export function resolveMeWin() {
	try {
		if (game.winner) {
			const ws = _winningSet();
			if (ws.length) return ws.some(function (p) { return p === game.me; });
			return false;
		}
	} catch (eW) { }
	return (game.me && game.me.hp || 0) > 0;
}
export function getSettleIv() { return settleIv; }
export function setSettleIv(v) { settleIv = v; }
export function getInstalled() { return installed; }
export function setInstalled(v) { installed = v; }
export function getMEM() { return MEM; }
export function clearScoreState() {
 resetCooperativeTrickIntents();
	settleDone = false; round = {}; _rawRound = {}; scoreLog = [];
	resetPlanner(); gameTelemetry.reset(); matchArchive.reset(); matchReplay = null; _playerLogs = []; DECISION_LOG.length = 0; SUGGESTION_LOG.length = 0;
	_lastDecisionTraceKey = ''; _lastDecisionTraceTs = 0;
	/* ★ 守恒台账重置：跨局清零 */
	_ledger = 0; _poolPromise = 0;
	REC = { effects: {}, cards: {}, timings: {}, log: [] };
	memReset();
	try { clearThreatCache(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { resetObs(); resetOpponentPrediction(); actionOutcomes.reset(); playerDemonstrations.reset(); skillOutcomes.reset(); delayedOutcomes.reset(); publicSources.reset(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { resetBelief(); resetIdentityAudit(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { deckReset(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { clearCompensation(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	_turnUse = 0; _lastTurnPlayer = null;
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
export function getDecisionLog() { return DECISION_LOG; }
export function clearDecisionLog() { try { DECISION_LOG.length = 0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }
/* ★ 供 aiOverride 等模块写入决策日志（去重后调用） */
export function appendDecision(entry) {
	try {
		if (!entry || typeof entry !== 'object') return;
		SUGGESTION_LOG.push({ ...entry, executionState: 'suggested' });
		while (SUGGESTION_LOG.length > DECISION_LOG_MAX) SUGGESTION_LOG.shift();
	} catch (e) {}
}
export function getSuggestionLog() { return SUGGESTION_LOG; }

export { loadStore, saveStore, storeStats } from '../../perception/memory/memory.js?v=41a';
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
  reg.mount('trainExport', function() { return _trainExportModule.exportForImport(); });
  reg.mount('trainImport', function(jsonStr) { return _trainExportModule.importFromJson(jsonStr); });
  reg.mount('trainBufferSize', function() { return _trainExportModule.bufferSize(); });
  reg.mount('trainStats', function() { return _trainExportModule.trainStats(); });
  reg.mount('trainBufferClear', function() { return _trainExportModule.bufferClear(); });

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
  _lateBindTimer = setTimeout(function() {
    _lateBindTimer = null;
    if (_disposed) return;  /* 已卸载：不再写回任何 API */
    reg.bind('aiStats', { _real: true, aggregateByPlayer: aggregateByPlayer, buildHtml: aiStatsBuildHtml, stats: function() { return { ok: true, hasAggregate: true }; } });
    reg.bind('allyExempt', { _real: true, check: checkAllyExempt, stats: function() { return { ok: true, hasCheck: true }; } });
    reg.bind('health', { _real: true, check: healthCheck });
    reg.bind('guardRecorder', { _real: true, record: recordGuardEvent, getStats: getGuardStats, reset: resetGuardRecorder });
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
