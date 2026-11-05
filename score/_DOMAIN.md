# 无名AI · `score/` 分层域结构（现行）

> 本文件是 `score/` 的**物理分层索引**。平铺模块已按「层 → 域 → 模块」三级归位，
> 所有相对 `import` 已按新深度自动重写；对外入口仍唯一：`score/index.js`。
> 设计目标：**上限足够高**——新增功能只在对应「域」里加文件，不用再动目录结构。

## 一、八个顶层（层）

依赖只能**自上而下**（上层可依赖下层，下层禁止反向依赖上层）。

| 层 | 目录 | 职责 | 允许依赖 |
|----|------|------|----------|
| L0 基础设施 | `score/foundation/` | 宿主适配、运行时总线、存储、配置、导出、国际化、诊断 | 无（最底层） |
| L1 静态知识 | `score/knowledge/` | 牌值表、卡牌/武将标签、克制关系、性格模板 | foundation |
| L2 模型与训练 | `score/model/` | 特征契约、权重、网络、训练、预测、校准 | foundation, knowledge |
| L3 认知推理 | `score/cognition/` | 深度思考、元认知、博弈/心理、风险量化、画像 | foundation, knowledge, model |
| L4 决策内核 | `score/decision/` | 引擎、打分、策略、技能、出牌、时机、威胁、护栏、接管、调优 | L0–L3 |
| L5 感知与闭环 | `score/perception/` | 观测、身份、队友、记忆、反馈、统计、归档、对局日志 | L0–L4 |
| L6 展示层 | `score/view/` | 面板、仪表盘、战报、图表、自动演示 | 全部 |
| L7 校验层 | `score/verification/` | 全量自检、就绪度体检、词表审计 | 全部（只读） |

```
score/
├── index.js                     对外唯一入口（extension.js / build-mod.mjs 只引用它）
├── _ARCHITECTURE.md             架构与接入填写指南
├── _DOMAIN.md                   本文件（物理分层索引）
│
├── foundation/                  L0 基础设施（27）
│   ├── adapt/                   host.js compat.js gameProfile.js terms.js  ← 唯一宿主耦合点
│   ├── runtime/                 eventBus.js registry.js extensionPoints.js
│   │                            modules.js missingModules.js globalScanner.js
│   ├── storage/                 storage.js storagePaths.js cache.js
│   ├── config/                  configSpec.js util.js
│   ├── io/                      export.js exportAll.js share.js
│   ├── i18n/                    i18n.js
│   └── diag/                    logger.js health.js selfHeal.js perf.js profiler.js
│                                perfOptimizer.js changelog.js swallow.js
│
├── knowledge/                   L1 静态知识（5）
│   ├── tables/                  value-tables.js elementAccess.js
│   ├── cards/                   cardTags.js
│   ├── counters/                mutualRelations.js
│   └── profiles/                templates.js
│
├── model/                       L2 模型与训练（25）
│   ├── features/                features.js（130 维契约） autoFeature.js
│   ├── weights/                 weights.js defaultWeights.js weightPersist.js
│   ├── net/                     mini-model.js deepValue.js confidence.js
│   │                            modelState.js modelGuard.js modelHotSwap.js
│   ├── train/                   localTrainer.js trainExport.js autoLearn.js
│   │                            learningLoop.js learningOptimizer.js bandit.js
│   │                            evolution.js crossModeTransfer.js
│   ├── predict/                 deckPredict.js deckTopPredict.js handInference.js opponentPredict.js
│   └── calibrate/               decisionCalibrator.js calibratorPanel.js
│
├── cognition/                   L3 认知推理（14）
│   ├── reasoning/               gameTheory.js psychology.js riskQuant.js softMetrics.js
│   ├── explain/                 explain.js decisionNarrator.js
│   ├── profile/                 profile.js profiles.js multiProfile.js
│   ├── log/                     cognitiveLog.js
│   └── (根)                     deepThink.js metaCognition.js situationEval.js moodState.js
│
├── decision/                    L4 决策内核（75）
│   ├── engine/                  engine.js decisionHook.js decisionRegistry.js
│   │                            scoreUnify.js scoreSelfMod.js
│   ├── state/                   actionCandidate.js decisionMargin.js decisionTransaction.js
│   │                            gamePhase.js playerSnapshot.js playerState.js turnStrategicState.js
│   ├── strategy/                strategy.js strategist.js strategyBus.js championStrategy.js
│   │                            counterStrategy.js modeStrategy.js planner.js recommend.js
│   │                            pickRecommend.js comboChain.js treeSearch.js
│   │                            multiturn.js multiTurnPlan.js multiTurnOpt.js
│   ├── skills/                  skills.js skillRules.js skillTags.js skillScanner.js
│   │                            skillCustom.js skillTiming.js
│   ├── cardplay/                cardStrategy.js costCalc.js keepStrategy.js keepStrategyOpt.js
│   │                            discardStrategy.js discardOpt.js passStrategy.js
│   │                            equipReplace.js equipScarcity.js judgeZone.js
│   │                            responseAI.js responseOpt.js viewAs.js
│   ├── resource/                economy.js resourceManage.js resourceTiming.js
│   ├── timing/                  aoe/duel/jiedao/jiu/judge/shandian/shunshou/tao/taoyuan/wugu/wuxie Timing.js
│   ├── threat/                  threat.js
│   ├── safety/                  allyExempt.js guardRecorder.js aiOverride.js optimization.js damageTransfer.js
│   ├── override/                原生 AI 接管层：index.js use.js respond.js discard.js circuit.js compare.js
│   ├── tuning/                  adaptive.js decayOpt.js delayOptimizer.js orderOptimizer.js endgameOpt.js shaTargetOpt.js
│   ├── feedback/                decisionFeedback.js
│   └── analysis/                conflictDetector.js decisionCompare.js postCheck.js
│
├── perception/                  L5 感知与闭环（20）
│   ├── observer/                observer.js identity.js
│   ├── team/                    team.js teammateIntent.js teamBroadcast.js
│   ├── memory/                  mem.js memory.js playerMemory.js deckMemory.js
│   ├── feedback/                feedback.js styleFeedback.js elementFeedback.js
│   ├── stats/                   aiStats.js compareAI.js
│   ├── discover/                autoDiscover.js
│   ├── replay/                  decisionReplay.js replayAnalysis.js
│   ├── archive/                 archive.js
│   ├── knowledge/               sharedKnowledge.js
│   └── journal/                 gameLogStore.js（对局日志自存，突破内核 20 条限制）
│
├── view/                        L6 展示层（13）
│   ├── panel/                   panel.js panelTheme.js smartPanel.js aiTools.js
│   ├── dashboard/               brainDashboard.js decisionDashboard.js championPanel.js
│   │                            comparePanel.js replayPanel.js identityVisual.js
│   ├── report/                  report.js charts.js
│   └── autoplay/                autoplay.js
│
└── verification/                L7 校验层（4）
    ├── verifyAll.js selfCheck.js professionalReadiness.js semanticAudit.js（自动生成）
```

## 二、前端 `js/`（无名杀扩展外壳，同规则分层）

```
js/
├── bootstrap/   arenaReady.js                    扩展加载引导
├── shared/      utils.js                         宿主对象再导出（lib/game/ui/get/ai/_status）
├── config/      config.js configLayout.js settingsHelp.js changelog.js
│   └── identities/  zhong.js fan.js nei.js zhu.js  身份局配置项
├── content/     content.js precontent.js afunction.js optimization.js
└── help/        help.js
```

## 三、新增代码的落位规则

1. **入口唯一**：外部只 `import './score/index.js'`，禁止直接引用域内文件。
2. **层内聚、层间单向**：新功能放进语义最贴近的「层/域」；禁止 `foundation` 反向依赖任何业务层。
3. **域内平铺、域间显式**：同一域内文件平级存放；跨域引用统一相对路径，如
   `decision/engine/engine.js` → `import ... from '../../model/features/features.js'`。
4. **宿主引用深度**：到无名杀宿主为 `.../noname.js`（由 `foundation/adapt/host.js` 唯一承接）。
5. **暴露新模块**：在 `score/index.js` 的模块表登记，并同步 `foundation/runtime/modules.js`。
6. **上限保障**：若某域文件超过 ~15 个，**只在该域下新增子目录**，不动顶层八层——这是本设计"不用二次重构"的关键。

## 四、回归校验（改动后必跑）

```bash
node /workspace/build/build-mod.mjs    # 期望：✅ 打包完成
node /workspace/build/verify.mjs       # 期望：__DJSC_ENGINE 存在，install/uninstall/bestAction/get 均为 function
node /workspace/build/test_redline.mjs # 期望：红线通过 19/19
node /workspace/build/_verifyjs.mjs    # 期望：200 个文件，失败 1（仅 注释.js 为纯文本笔记）
```

> `noname.js` 为宿主运行时文件，静态可达性校验会将其列为"由 shim 承接"，属预期。
