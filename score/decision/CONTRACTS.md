# 决策环节交接契约

这是现有接口的维护约定，不新增另一套数据模型。下表同时标出尚未统一的部分。

| 环节 | 现有交接内容 | 负责人及限制 |
| --- | --- | --- |
| 宿主问题接入 | 玩家、宿主事件、决策类型 | 目前分散在 engine 与 override；尚未统一成一个请求对象 |
| 动作记录 | type、id、target、targetObj、score、policy | state/actionCandidate.js 定义契约；生成方负责提供合法动作 |
| 动作身份 | 动作类型、动作编号、绑定目标 | sameCandidateAction；不同目标不应合并。现有 targetKey 优先使用武将名，重复武将场景仍需专项核查 |
| 评分 | 浮点 score 与收益分项 | utility 管线；score 不承载“禁止选择”含义，禁止由 policy 表示 |
| 动作初选 | acts → best、eligibleActs、endAction | selection/candidateSelection.js；原地排序，返回原动作对象 |
| 规划建议归并 | acts、refined → best、eligibleActs | 同模块；同一身份复用原对象，不同目标独立保留 |
| 局面与目标汇总 | 当前玩家、分析函数、关系查询 → 权重与目标分表 | context/decisionContext.js、targetContext.js；单次关系 memo 仍由引擎持有 |
| 候选枚举及基础估值 | 局面与目标 → 原 acts 中的候选 | generation/scoredCandidates 枚举/去重；scoring 下三个 CandidateScore 模块计算并返回单候选；原基础评分算法不变 |
| 规则与公共评分修正 | acts、画像、战略职责 → 原候选上的 score/policy | rules/basicRules.js、scoring/candidateScoring.js；规则先于初选，战略职责不伪装为数值分 |
| 规划结果归并 | 当前最佳动作、完整候选 → best、eligibleActs、decisionPlan | selection/plannedSelection.js；每次最多规划一次，日志复用同一结果 |
| 策略与模型复核 | 可用动作、当前最佳动作、上下文 → best 与观测 | selection/modelReview.js；保留原模型就绪和冠军开关条件，Champion→DeepThink→职责屏障顺序不变 |
| 最终安全检查 | best、完整候选、全局目标 → 最终 best 与目标 | safety/finalCandidateGuard.js 调用 safety/modelGuard.js；保留最终否决权 |
| 决策事务 | id、state、expected、createdAt、expiresAt | state/decisionTransaction.js；唯一事务编号由该模块产生，不另建编号 |
| 执行确认 | actual 与宿主事件 → ok、reason、tx | execution/executionGateway.js；函数正常返回不等同于游戏事件已完成 |
| 收益反馈 | decisionId 与动作/目标、收益变化 | analysis/postCheck.js；与事务编号关联，失败或取消不得伪装成真实执行 |
| 训练样本 | 样本元信息中的 decisionId、动作与目标、特征及标签 | model/train/trainExport.js；回填匹配同一 decisionId，已回填样本不重复更新 |

已执行学习的编排归 `feedback/executedLearning.js`；引擎只在原 `learning-and-postcheck` 延迟回调中调用它。
`execution/decisionEffects.js` 只把延迟效果关联到既有事务，不负责 stage、宿主确认或直接 Commit。
模型的延迟观测通过 `readFinalState` 在 Commit 时读取最终 winner，不能捕获护栏改判前的局部动作。
软接管与硬接管继续调用原执行网关，未新增第二条执行通道。

## 交接时必须保持

1. 候选模块可以更新动作记录，但不能因此创建执行反馈。
2. 执行网关负责确认宿主结果；事务模块负责状态迁移。它们不能互相替代。
3. 事务终态不能重新登记；训练回填不能退回按卡名或目标模糊匹配。
4. “结束回合”也要由对应宿主事件确认，不能仅凭建议判作已经执行。
5. 未配置、旧样本和缺少关联编号的数据继续遵守现有兼容策略，本轮不迁移或清空数据。

## 公共接口负责人

| 接口 | 实现负责人 | 挂载方式与当前状态 |
| --- | --- | --- |
| guardRecorder.record/getStats/reset | decision/safety/guardRecorder.js | mountGuardRecorderInterface 经现有 reg.bind 挂载；入口与引擎只调用该函数，不再替换对象 |
| 训练导入、导出、缓冲大小、统计、清理 | model/train/trainExport.js | mountTrainingInterface 统一连接原有函数；入口与引擎不再创建包装函数，保留 trainExport.cleanLowValue |
| checkAllyExempt | decision/safety/allyExempt.js | mountAllyExemptInterface 统一连接正式判断；删除入口内联简化版，提示与决策使用同一函数 |
| 模型护栏 | decision/safety/modelGuard.js | view/dashboard/guardPanel.js 的 mountModelGuardInterface 统一装配；旧 model/net/modelGuard.js 兼容转出 |
| 安装、卸载与异步代际 | bootstrap/lifecycle.js | 唯一状态持有方；对外继续从 score/index.js 使用 |

reg.bind 保留已有成员，只补缺失；它不自动证明已有成员正确，也不自动修复历史残留。
上述契约需通过模块测试与最终宿主联调共同验收，不能把文字约定当作全链路已验证。

## B3 收尾后的状态与调用负责人

| 事项 | 唯一实现及状态归属 |
| --- | --- |
| 分数、分数日志、事件记录及守恒台账 | scoring/scoreLedger.js；engine 旧查询返回实时绑定，不复制 |
| 实际动作效果记分、友方延迟观察、回合动量 | scoring/scoreEvents.js |
| 候选机会成本、边际价值、预期收益和概率缓存 | scoring/candidateValuation.js；按原决策位置刷新目标缓存 |
| 候选枚举/去重与基础估值 | generation/scoredCandidates 枚举；scoring/skillCandidateScore、cardCandidateScore、equipCandidateScore 返回单候选 |
| 宿主 Player 钩子、安装标志及延迟挂载取消句柄 | execution/hostHooks.js；bootstrap/lifecycle 仍负责何时安装/卸载 |
| 决策记录和诊断输出去重 | records/decisionRecords.js；旧公开日志接口继续转出 |
| 玩家原始动作日志 | perception/journal/playerActionLog.js |
| 七类执行后观测 | feedback/decisionObservations.js；Commit 时读取最终变量，不提前固定 winner |
| 局末跨模块编排 | settlement/gameSettlement.js；引擎保留每局只结算一次的锁及监视器 |
| 技能源码标签、画像、战术派生 | skills/skillSourceTags.js、skillProfiles.js、skillAdvice.js；旧 skills.js 组合转出且统一清缓存 |

原有 `skills/skillTags.js` 是另一组既有标签工具，本轮保留其原内容，不与源码扫描缓存强行合并。
模型生命周期与 A/B 候选槽归 `model/state/modelLifecycle.js`；训练副本计算归 `model/train/candidateTraining.js`，快照校验归 `model/weights/modelSnapshot.js`，旧模型状态入口不创建第二份状态。
