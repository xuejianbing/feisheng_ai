# 无名AI 更新日志（CHANGELOG）

> **当前版本：v4.0.13-test（semver 4.0.13-test）｜发布日期：2026-10-05｜支持本体最低版本：1.11.1**
> 版本号唯一权威源：[js/config/version.js](js/config/version.js)（info.json / package.json 与之保持一致）。
> **当前模型契约（P2-36）：FEATURE_DIM = 130，网络 130 → 128 (GELU+LayerNorm) → 64 (GELU+LayerNorm) → 6 + Critic。**
> 下方 48 / 96 维相关条目均为历史版本记录，不代表当前契约；旧 48/96 维权重与训练数据不兼容，会被拒收。
> **状态：架构测试版。测试阶段以 P0/P1 回归修复为主，暂不继续叠加新的 AI 功能。**

---

## v4.0.13-test 统一收益向量与双轨评分（2026-10-05）

> 本版本不直接替换现有 canonical score，而是先建立可解释、可对账的 Utility Vector，并把通用后处理层逐步迁移进去。

### Unified Utility Pipeline

新增：

- `utilityVector.js`：统一收益向量契约；
- `utilityPipeline.js`：before/after 双轨观测与对账；
- `utilityExplain.js`：玩家可读的收益维度解释；
- `utilityMigration.js`：明确记录已迁移/未迁移评分层。

Utility 维度：

- offense
- control
- resource
- survival
- team
- tempo
- future
- synergy
- risk
- resourceCost
- opportunityCost
- uncertainty
- legacyResidual

### 双轨原则

当前正式决策仍使用：

`candidate.score`

Utility Vector 仅做 shadow：

`legacyBase + tracked semantic contributions = shadowUtility`

并与 canonical score 对账得到 `residual`。

- residual = 0：当前已跟踪层完全对账；
- residual ≠ 0：说明还有后置模型/Champion/DeepThink等未进入 Utility Vector；
- 不允许用 shadowUtility 替换 winner，避免 #39 在迁移阶段偷偷改变 AI 行为。

### 第一批已迁移通用层

- modeStrategy → team
- identityExposure → uncertainty
- actionDirectionGuard → team
- sharedKnowledge → team
- campSkillProgress → future
- resourceMaximize → resource
- lossMinimize → risk
- Character Policy → synergy

Basic rules 若产生分值变化，暂时进入 `legacyResidual`。

### 明确保留在 legacyBase

第一版不重写：

- 基础牌/技能/目标 EV；
- optimization；
- psychology / memory；
- comboChain；
- 手牌概率推断；
- 桃/无懈/铁索/兵乐拆顺等专项 timing/evaluator；
- AOE / 判定 / 装备时机；
- deepValue；
- 救援专项；
- threat / forecast；
- feedback / momentum；
- 铁索唯一 evaluator；
- 装备替换。

这些模块后续按语义逐批迁移，而不是一次性改写。

### Policy / Safety 保持独立

以下不是 Utility：

- #37 Strategic Intent；
- candidate eligible / veto / priority tier；
- Planner policy band；
- Guard。

胜利职责和安全红线不能重新退化成普通加减分。

### 可观测性

详细 Decision Trace 新增：

- legacyBase
- 已迁移 Utility 维度
- shadow utility
- residual / 对账状态

Top-N quality snapshot 同步保存 Utility Vector。

### 安装包修复

- 测试发布 ZIP 改为**无名杀可直接导入格式**：`info.json / extension.js` 位于 ZIP 根目录，不再额外包一层“无名AI/”目录。
- 发布审计新增设置中心契约：必须包含 `config.js / configLayout.js / configSchema.js / AIjinjiang.css`，并检查“玩家选项 / 开发者选项”及 8 个玩家分区、8 个开发者分区。
- 标准 ESM 扩展导入后需要**完全重启无名杀**，重启后才会加载 `extension.js` 的完整 config 设置中心。

### 质量门禁

新增 `utility_pipeline` 固定行为场景与 `utility` 质量维度，锁定：

- 初始化/观测不得修改 score；
- 通用阶段 before/after 精确映射；
- 非法/未迁移维度进入 legacyResidual；
- callback 异常不得重复执行；
- canonical winner 仍由 legacy score / policy 决定；
- Utility Vector 不得接管排序；
- 迁移地图必须明确专项策略尚未完成迁移。

## v4.0.12-test 武将策略画像与资源燃料（2026-10-05）

> 本版本解决“知道武将有哪些技能，但没有形成稳定打法”的结构问题。#37 负责回答“为了什么赢”，#38 负责回答“这个武将适合怎样完成目标”。

### Character Policy Profile

新增：

- `characterPolicyCore.js`：纯函数聚合技能语义，生成武将画像；
- `characterPolicy.js`：复用现有 `skillTagsOf / skillProfileOf`，自动适配本体与扩展武将；
- 不建立“武将名 → 固定规则”名单，避免只对少量官方武将生效。

第一版画像维度：

- offense：持续进攻能力；
- burst：爆发/限定窗口；
- control：控制与资源破坏；
- support：团队增益；
- sustain：回复/防御/复活；
- resource：摸牌与资源获取；
- conversion：视为/转化；
- sacrifice：主动卖血/自损成本；
- combo：连招与牌转化协同；
- damageBenefit：受伤后正收益。

画像归类：

`ASSAULT / BURST / CONTROL / SUPPORT / SUSTAIN / RESOURCE / CONVERSION / SACRIFICE / HYBRID`

### 决策边界

Character Policy 只影响 **NORMAL 层 utility**：

- 不修改 eligible；
- 不修改 veto；
- 不修改 priority tier；
- 不允许跨越 #37 的 CRITICAL/FORCED 身份职责；
- Guard 仍保留最终否决权。

候选软修正采用有界相对增量，避免角色画像成为新的“评分霸权”。

### 资源燃料

画像同时进入留牌 / 弃牌链：

- 进攻/爆发型更重视【杀】【酒】；
- 控制型更重视控制锦囊；
- 支援/续航型更重视【桃】【无懈】；
- 转化/连招型保留更多可转化资源；
- 卖血收益型仅在安全血线提高换血容忍，低血仍强制降低自损倾向。

原有武圣/龙胆/倾国等明确转换留牌规则继续保留，Character Policy 作为扩展武将也能工作的通用层补充。

### Champion 行动者修复

修复 Champion 接管中 heroId 使用 `game.me` 的问题。

此前多人/托管/AI 决策时，当前行动者可能不是本机玩家，导致其它 AI 错用本机英雄的冠军嵌入。

现在统一使用当前实际决策者 `me`。

### 可观测性与质量门禁

- Decision Trace 显示武将主画像、副画像与本动作画像修正；
- Top-N quality snapshot 保存 `characterAlignment`；
- 新增 `character` 质量维度；
- 新增固定 `character_policy` 行为场景；
- 自动门禁确认 Character Policy 先于 Strategic Intent 生效，且不能写 priority/veto。

本版本不改身份推断、Planner 搜索算法、Guard，也不进入 #39 的完整 Utility Vector 重构。

## v4.0.11-test 统一目标与战略意图（2026-10-05）

> 本版本开始真正提高 AI 的“角色意识”：先确定胜利目标、身份职责与当前回合意图，再让候选 utility 在正确战略方向内比较。

### Unified Objective

新增纯核心与宿主适配层：

- `objectiveCore.js`：Victory Objective / Role Objective / Identity Risk / Strategic Intent 纯逻辑；
- `objective.js`：只用公开事实、observer-specific identity posterior 与行动者自身私有信息构造上下文；
- `strategicStateCore.js` / `strategicState.js`：回合级 Intent 生命周期；
- `intentAlignment.js`：候选与 Intent 对齐，不直接改 raw score。

身份局第一版规则：

- 主公：生存临界优先 SURVIVE；明确反贼斩杀窗口 FINISH；
- 忠臣：主公1血时进入 LORD_SURVIVAL / PROTECT；无可信反贼时 PRESERVE_INFORMATION；
- 反贼：主公明确斩杀窗口进入 FINISH_LORD，否则保持 FOCUS；
- 内奸：身份固定、stance动态；中期 BALANCE / CONCEAL，最终主内残局进入 FINAL_DUEL；
- 敌方身份槽位已归零的 unknown 进入 PROTECTED_UNKNOWN，不作为普通集火目标。

### Strategic Intent

第一版 Intent：

`SURVIVE / PROTECT / FINISH / FOCUS / CONTROL / DISRUPT / DEVELOP / SETUP / BURST / PRESERVE / BALANCE / CONCEAL / PASS`

核心约束：

- Intent 不直接修改 candidate.score；
- 普通 FOCUS / BALANCE / DEVELOP 只写战略对齐解释，仍然 utility-first；
- 只有明确 CRITICAL/FORCED 身份职责且候选高度对齐时，才提升 candidate policy tier；
- Planner 继续使用既有 sameCandidatePolicyBand，不能用普通规划结果跨越关键身份职责；
- Guard 保持最终否决权。

### Intent Lifecycle

- 同一回合、关键状态不变时复用 Intent；
- 主公/自身血线、存活人数、身份后验、目标状态、进攻资源等关键 fingerprint 变化时允许刷新；
- 新回合自动刷新；
- 目标不是“锁死一回合”，而是稳定但可失效重算。

### 决策解释与质量门禁

- 决策记录保存 roleObjective / intent / target / reasons；
- 摘要/详细 Decision Trace 显示当前战略；
- Top-N quality snapshot 增加 strategicAlignment；
- #36 质量基线新增 `strategy` 维度和固定 strategic_intent 行为场景。

本版本不引入武将画像、技能燃料、完整 Utility Vector 或 Planner V2；这些仍分别留给 #38～#40。

## v4.0.10-test AI决策质量基线（2026-10-04）

> 本版本不调整 AI 候选评分、身份推断、Planner、Guard 或卡牌策略；目标是建立后续角色质量优化的可测量基线。

### Decision Quality Baseline

- 新增 `score/verification/decisionQuality.js`，提供纯观测的 Top-N 候选快照、候选解释、质量维度聚合与基线报告。
- 新增固定质量场景目录 `tests/quality/scenarios.mjs`，首批复用现有真实行为回归：
  - 桃救援关系边界；
  - 铁索连环状态转换；
  - 兵乐拆顺回合一致性；
  - 无懈响应；
  - 判定区控制；
  - 全局锦囊；
  - 借刀杀人。
- 质量维度首批覆盖：identity / allySafety / resource / cardStrategy / tactics / consistency / response / team / control。
- “verifiedRate”只表示**当前已覆盖回归场景正确率**，明确禁止把它宣传成 AI 总实力分。

### 机器可读行为测试

- `tests/behavior/_harness.mjs` 增加可选 JSON 输出。
- 原有行为测试仍可独立运行；质量 runner 可以读取每条断言而不是只看进程退出码。
- 新增 `tests/run_decision_quality_tests.mjs`，统一执行质量场景并生成维度报告。

### 隐藏信息基线

- 新增静态隐藏信息审计，检查决策 / 模型 / 认知层对明显对手别名进行精确隐藏手牌读取。
- 当前已知债务显式登记，而不是为了“100分”隐藏问题。
- 基线共识别 **8 条历史隐藏信息债务**：涉及 `engine` 铁索属性威胁、Planner 的 AOE/救援、旧 `strategyBus` 反制、`threat` 爆发威胁与 `modelGuard` 决斗红线。
- 本版只登记这些历史问题，不改变决策语义；后续质量 PR 应逐步替换为公开事实 / 概率推断。
- 从本版开始：**已知债务可以被修复，但不得新增同类读取**；新增隐藏信息读取直接阻断 CI。

### Top-N 解释契约

- Top-N 快照固定保存最终 winner、去重候选、score、reason、eligible、priority tier/value/reason。
- 质量观测模块只读取候选，不得修改 score、policy 或排序结果。

## v4.0.9-test 统一执行网关（2026-10-04）

> 本版本不改变 AI 评分与卡牌策略，重点统一“决策结果如何进入无名杀宿主执行”的公共边界。

### Execution Gateway

- 新增 `score/decision/execution/executionGateway.js`。
- use / respond / discard / compare 的公共执行职责统一收敛：
  - 人类本机 / 联机玩家排除；
  - hardOverride 与分层开关；
  - 熔断状态；
  - 5 秒降级窗口；
  - 事件哨兵；
  - Host 单次调用与异常后的后续事件降级 fallback；
  - Decision Transaction Stage / Commit / Cancel；
  - 统一执行统计。
- 各接管模块继续保留自己的策略算法，不把桃、无懈、弃牌估值或拼点逻辑塞进 Gateway。

### 事务边界继续收敛

- soft override 的 Stage 改为 `stageExecutionDecision()`。
- card / skill 真实执行 Commit 改为 `commitExecution()`。
- hard override 的 end-turn Commit 与 cancel 同样通过 Gateway。
- 接管层启停状态由 `isExecutionLayerEnabled()` 统一解释，不再由四个模块各自读取配置和熔断器。

### 宿主单次调用原则

- `decisionHook` 明确降级为“监督员”：只观察一次真实宿主调用，不再因为合法性/红线检查失败而重复执行同一个 choose 事件。
- engine 的 useCard / respond / effect / logSkill / die 观测 Hook 改为单次宿主调用。
- 修复旧逻辑中“第一次宿主调用已产生部分副作用，异常后又调用第二次”的重复执行风险；当前事件一旦 Host 抛错不再重入，清理临时改写并让后续事件通过 degrade/circuit 回退原生。

### 兼容原则

本版本不修改：
- bestAction 候选评分；
- 身份推断；
- Planner 深度/预算；
- Guard；
- 桃 / 无懈 / 铁索 / 兵乐拆顺等专项策略。

新增 `tests/run_execution_gateway_tests.mjs`，用于阻止接管模块重新私有维护 degrade / circuit / transaction，及阻止宿主调用重复执行。

## v4.0.8-test 配置单一真相源（2026-10-04）

> 本版本只收敛配置架构，不修改 AI 评分、身份推断、Planner、Guard 或卡牌专项策略。

### Config Schema

- 新增 `js/config/configSchema.js`，成为配置默认值、类型、枚举项、玩家/开发者归属、板块顺序、标签与说明的唯一权威源。
- 玩家设置与开发者设置的 8+8 板块改由 Schema 生成；`configLayout.js` 不再维护第二份 groups / explanations。
- 卡牌策略的“基本牌 / 锦囊牌 / 装备牌 / 其他”层级也进入 Schema；铁索继续归属锦囊牌。
- 锁定状态（隐藏信息隔离、关系判断边界、最终合法性校验、异常降级保护）继续以不可关闭状态展示。

### 默认值与兼容层

- `config.js` 不再写 `init` / `item`，只保留功能回调与宿主配置对象外壳；默认值和枚举项由 Schema 注入。
- `score/foundation/config/configSpec.js` 改为 Schema 兼容适配层，不再维护旧默认值、旧群号或未接线“伪配置”。
- 运行时 `cfg()` 在宿主配置缺失时统一回退 Schema 默认值。
- QQ群号统一从 Schema 读取，默认值固定为 **1080487560**。
- 冠军策略默认值以实际游戏设置为准保持 **0（关闭）**，不再与旧 ConfigSpec 的 6 冲突。

### 配置审计门禁

新增 `tests/run_config_schema_tests.mjs`，自动检查：

- section / key 重复；
- 布局引用不存在的配置；
- 非隐藏配置未进入布局；
- enum 默认值不在 options；
- `config.js` 出现未登记 Schema 的真实设置/动作；
- Schema 引用不存在的 `config.js` 功能；
- `config.js` 重新写入 `init` / `item`；
- ConfigSpec 默认值与 Schema 漂移；
- 运行时 cfg 默认值未回退 Schema。

未接线实验位不再作为 active/pending 配置展示；真正接线后必须先登记 Schema 才能进入设置系统。

## v4.0.7-test 决策事务化（2026-10-04）

> 本版本不调整候选评分、身份判断、Planner、卡牌优先级或 Guard 规则；重点修复“AI 被询问一次，就提前写入学习/日志/广播”的架构污染。

### Evaluate → Stage → Commit

- `bestAction()` 的训练样本、Decision Trace、Replay、AutoFeature、团队广播、技能反馈、风格反馈、模型校准等副作用改为 deferred effect。
- Evaluate 阶段只返回决策结果和不可枚举的 `__djscTransaction`，不直接提交学习数据。
- 软接管 `aiOverride` 与硬接管 `chooseToUse` 只负责 Stage 待执行事务。
- 宿主真正调用 `Player.useCard` 后才 Commit 对应 card/equip 事务。
- 宿主真正进入 `logSkill` 后才 Commit 对应 skill 事务。
- 硬接管明确执行“结束回合”短路时提交 end 事务。

### 防污染规则

- 实际动作与推荐动作 id 不一致：事务标记 mismatch 并丢弃，不训练推荐动作。
- 同牌但实际目标不同：同样 mismatch，不把不同目标冒充为同一决策。
- 不同事件类型不会互相误取消，例如 card 内部触发 skill 日志不会冲掉 card 事务。
- 同一事务只允许 Commit 一次；重复宿主事件不会重复训练。
- 待提交事务默认 5 秒过期，避免跨决策残留。

### 回归门禁

- 新增 `tests/run_decision_transaction_tests.mjs`，覆盖 Evaluate 零副作用、Stage 幂等、mismatch、target mismatch、Commit once、cancel 与统计。
- Decision Trace 契约同步改为“Commit 后写入”，不再把单纯候选评估当成已执行决策。

---

## v4.0.6-test 设置中心重构（2026-10-04）

> 本版本只重构游戏内设置与项目展示，不改变现有 AI 候选评分、身份推断、Planner、Guard 或最终执行语义。

### 玩家 / 开发者双入口

- 设置页顶部新增 **玩家选项 / 开发者选项** 两个入口。
- 玩家选项按基础、身份与目标、卡牌策略、战术协作、原生AI接管、学习记忆、战报回放、数据反馈分组。
- 开发者选项按运行状态、决策链诊断、身份与信息审计、Planner性能、模型训练、Guard安全、数据存储、实验监控分组。
- 沿用原配置键和保存逻辑，避免界面迁移造成配置失效。

### 卡牌策略结构

- 卡牌策略固定按 **基本牌 / 锦囊牌 / 装备牌 / 其他** 四类展开。
- 铁索连环归入 **锦囊牌**。
- 本版只展示已经真实接线的配置项；装备等尚未独立接线的能力使用说明文本，不新增“看起来能开关但实际无效”的死开关。

### 团队与反馈

- 设置首页新增开发团队卡片。
- 团队信息统一为：飞升、WeiqiaoCode（微雀qiao）、小小王同志。
- 反馈与交流QQ群统一为 **1080487560**。
- CONTRIBUTOR / info / 扩展内群号同步更新。

### 视觉规范

- 保留原有深色半透明、灰银圆角、淡金标题、浅蓝信息的无名AI风格。
- 玩家入口使用淡金强调，开发者入口使用浅蓝强调。
- 正常状态使用绿色，提醒使用金黄色，异常/危险使用淡红色。
- 强制安全边界改为锁定状态展示，不伪装成可关闭开关。

## v4.0.5-test 决策性能专项（2026-10-04）

> 针对玩家反馈的 20 秒级 AI 等待进行第一轮低风险性能优化。本版本优先消除已确认的重复计算与失效缓存问题，不降低搜索深度、不关闭 Planner、不减少 Guard/身份判断。

### Planner 单次计算

- 每次 `bestAction()` 最多执行一次 Planner。
- Planner 改判、决策日志与战术规划面板复用同一份 `decisionPlan`。
- 战术规划面板只读取最近一次真实决策产生的 plan，不再为了显示 UI 额外触发 Planner。

### 真正的 Planner 时间预算

- 原 `PLAN_TIMEOUT=350ms` 仅在全部计算结束后检查，无法阻止实际长时间阻塞。
- 新增 cooperative deadline，并传递到：
  - 敌人遍历
  - 残局击杀序列
  - 普通候选展望
- 一旦预算耗尽，Planner 放弃本轮改判并保留基础 canonical best，不产生半成品候选。

### State-key 决策缓存

- 旧缓存仅依赖 100ms TTL；现在改为 **state fingerprint + 1.2s 安全 TTL**。
- 指纹纳入：
  - 当前行动者
  - 决策者自己的实际手牌
  - 全员公开 HP / maxHP / 手牌数量 / 横置 / 判定区 / 装备区
  - 当前事件 name/type/skill/step/player/source/target/targets/card/parent
  - 本回合出牌/技能使用次数
  - 回合
  - 敌我关系 fingerprint
- 对手只读取公开手牌数量，**不读取隐藏手牌内容**。
- 任一关键状态变化立即失效缓存。

### 分阶段性能诊断

`bestAction` 现在额外记录：

- preflight
- context
- targets
- candidates
- planner
- model
- observability
- guard
- telemetry

详细测试日志和决策回放会按耗时显示热点，例如：

`planner=7428ms｜candidates=531ms｜telemetry=472ms`

便于下一轮性能优化直接针对真实热点。

### 非关键持久化与单次决策复用

- AutoFeature 的内存统计仍同步更新；`JSON.stringify + localStorage` 写盘改为 500ms 合并延后，避免每个决策点同步持久化阻塞主线程。
- 敌友关系查询新增仅存活于一次 `bestAction()` 的局部 memo；cache miss 仍委托既有 `isEnemyOf / isAllyOf`，不改变三态关系算法，也不跨决策复用。
- 训练样本、异步后检测等具有严格时间窗口语义的流程仍保持原有边界，不做整体异步化。

---

## v4.0.4-test 测试决策日志与耗时观测（2026-10-04）

> 针对实战测试反馈增加玩家可见的决策轨迹，并把每次 bestAction 的完整墙钟耗时写入决策记录。该版本不修改候选评分、策略优先级、目标选择或实际执行结果。

### 测试决策日志

- 新增 **测试决策日志：关闭 / 摘要 / 详细**。
- 测试版默认使用 **摘要**，每次正式决策在左侧对局日志显示：最终动作、目标、分数、次选、分差、原因与决策耗时。
- 详细模式额外显示前 3 候选与阶段、风险、集火、趋势等关键策略信号。
- 500 ms 内相同决策做去重，避免宿主短时间重复查询造成刷屏。
- 决策日志只消费已经生成的候选和最终结果，不参与评分、排序或执行。

### 性能观测

- 最终决策记录新增 `elapsedMs`，覆盖完整 bestAction 墙钟耗时。
- `>= 1000 ms` 标记为“慢”，`>= 5000 ms` 标记为“严重慢”。
- 最终返回结果增加只读诊断字段 `decisionMs`，便于确认玩家体感等待是否来自无名AI计算。
- 决策回放面板同步显示最终目标、次选和本次决策耗时。

### 下一步

- 本版先采集真实慢决策证据，不直接降低 planner 深度或删除策略模块。
- 根据 4.0.4-test 的耗时记录和 Profiler 热点，再单独处理性能问题，避免以牺牲决策质量换取表面速度。

---

## v4.0.3-test 扩展身份与测试入口修复（2026-10-04）

> 修复测试包可以加载，但扩展菜单被本体识别成 `UnknownAI` 空占位页，导致完整配置按钮和决策观察入口无法从扩展设置页恢复的问题。本次不修改 AI 决策策略。

### 扩展身份契约

- **统一扩展名称**：目录 `无名AI/`、`info.json.name` 与 `extension.js` 的扩展名统一为 `无名AI`。
- **兼容旧失败状态**：如果此前坏包曾让本体自动关闭 `extension_无名AI_enable`，更新后扩展页会正确显示“无名AI”，用户可重新开启并重启。
- **新增发布阻断**：Release audit 会比较包目录名、`info.json.name` 与 `extension.js` 名称，不一致直接禁止发布。

### 测试可观测性门禁

发布前强制确认以下关键入口仍存在并正确挂载：

- `openScorePanel`
- `openFeedbackPanel`
- `openPlanPanel`
- `openHealthPanel`
- `openDecisionDashboard`
- `openSelfCheck`

同时检查 `js/config/config.js` 已接入 `extensionPackage.config`，避免再次出现“扩展能加载但设置按钮缺失”的测试盲区。

---

## v4.0.2-test 发布包依赖修复（2026-10-04）

> 修复 v4.0.1-test Release ZIP 遗漏运行时 `logs/` 依赖，导致 `js/config/changelog.js` 无法解析、扩展入口加载失败的问题。该问题属于发布包完整性错误，不涉及 AI 决策逻辑。

### 发布包修复

- **恢复运行时 `logs/` 目录**：`logs/今日修改日志.js` 与 `logs/WORK_TRAIL.js` 被 `js/config/changelog.js` 直接 import，现正式纳入测试包。
- **新增 Release dependency audit**：打包阶段扫描包内 JS 模块的相对静态 `import/export` 与字面量 `import()`，目标文件缺失或越出扩展根目录时直接阻断发布。
- **新增关键运行时文件契约**：`extension.js`、`info.json`、`js/config/changelog.js`、两份 `logs/*.js` 必须实际存在于待发布目录。
- **ZIP 结构校验同步更新**：`logs/` 不再被误判为开发目录；仍排除 `.github/`、`tests/`、`build/`、`DEV_GUIDE/`。
- **发布文件名改用 ASCII**：测试资产统一为 `UnknownAI_<version>.zip`，避免中文文件名在 GitHub/下载链路中被截断或重写。

### 兼容说明

- `v4.0.1-test` 已知为不可用发布包，不建议继续测试。
- 本版本作为第一份可用于真实游戏加载验证的 4.0 测试候选版。

---

## v4.0.1-test 架构测试候选版（2026-10-04）

> 该版本用于验证 3.x 后期至当前累计的底层决策架构重构。重点不是继续增加规则，而是确认统一状态、敌我关系、动作评分、技能事务、身份推理、残局与特殊牌 evaluator 在真实对局中的整体稳定性和行为一致性。

### 状态、关系与身份信息边界

- **World-state / Relations 收敛**：关系变化、身份明置与行为证据变化会主动使旧决策缓存失效，避免沿用过期敌我结论。
- **身份配额推理**：区分 hard fact、逻辑可能身份和动态 stance；已知身份数量达到模式配额后，未明身份的候选空间会相应收缩。
- **信息边界加固**：身份推理和策略层只允许使用公开/可推断信息，避免通过宿主内部字段直接获取不该知道的隐藏事实。

### 动作候选、评分与策略层

- **Action Candidate 契约统一**：候选动作的类型、目标与执行身份保持一致，避免评分的是 A、最终执行成 B。
- **Utility / Policy Priority 分离**：动作收益与“必须优先执行”的策略权限分开；普通高分不会冒充强制动作。
- **Decision Margin / Policy Band 收敛**：统一“明显更优 / 同档候选”的比较语义，减少不同模块各自定义阈值。
- **评分方向修复**：保留价值只作为机会成本，不再反向提高出牌欲望；play feedback 与 keep feedback 分开。
- **Delta / Multiplier 契约统一**：相对增量与倍率不再混用，正增量在正负 utility 上都保持“提高收益”的方向一致性。

### 技能决策内核

- **通用技能目标决策**：技能目标、选牌与联合选择统一进入可比较的候选体系。
- **多阶段技能事务**：前一步已经选择的目标/牌会作为事务上下文传递到后续步骤，避免技能中途丢失意图后重新乱选。
- **Host bridge 对齐**：宿主侧实际选择结果与内核候选保持同一语义，减少技能 evaluator 与最终执行分叉。

### 战略连续性与特殊牌

- **Strategic Transition Ledger V2**：战略状态的创建/解除以真实公开状态变化确认，不再因为“计划执行”就提前假定状态已经改变。
- **桃 / 铁索 / 无懈 / 判定牌**：继续使用单一权威 evaluator，旧的并行最终 policy 已逐步退役。
- **回合内动作一致性**：加入自我抵消惩罚与状态 freshness，降低“刚兵乐又自己拆顺”等互相打架的连续动作。
- **AOE 单一评估入口**：南蛮/万箭只根据公开手牌数量、公开装备、公开血线、行为概率和牌堆记忆估算，不再精确读取对手隐藏杀/闪。

### 残局与多轮规划

- **统一 game phase**：`alive <= 4` 作为残局事实优先于轮次阶段；early / mid / late / endgame 不再由多个模块各自重新定义。
- **残局职责分离**：阶段层不再默认“全力进攻”；斩杀、保命、1v2、生存、救援等具体策略由 endgame evaluator 负责。
- **Multi-turn 收敛**：多轮规划消费统一 phase，残局不再重复给“杀 / 桃”做泛化倍率。

### 测试门禁

- 现有 release gate：**1296 项断言**。
- v4.0.1-test 新增并保留 phase/AOE contract：**31 项断言**。
- 当前自动化门禁合计：**1327 项功能 / 契约断言**，覆盖模型、训练、插件生命周期、桃、铁索、无懈、回合一致性、状态/关系契约、身份边界、技能事务、动作评分、残局与 AOE 等。
- 自动化门禁只负责防止已知契约回归；v4.0.1-test 的主要目的仍是进入真实对局进行冒烟、专项和完整局测试。

---

## v3.1β 整体架构稳定化（2026-10-02）

> 对应《05_DeepSeek4_整体架构稳定化指令》与《无名AI3.1_整体问题审计与修复路线总结》。
> 唯一目标：逐步收敛为 `Game State → Unified Snapshot → Unified Relations → Card/Response Evaluators → Unified Action Utility → bestAction → Override/Native AI`，同一局面只有一套事实解释、同一种最终决策只有一个权威策略。

### Stage A–C：状态事实 / 关系 / targetBrain 数据契约收敛

- **A·Unified Player State Snapshot**：统一 `alive/hp/maxHp/handCount/linked/judgeCards/equipCards/equipValue/nextToAct/threat`，收敛 `isLinked()/isLinked/isChained/judges/isJudge/isJudged/equipVal` 等碎片读取（见 `score/decision/state/`）。
- **B·Relations Single Source of Truth**：审计 `score/decision/**` 中 `get.attitude()`、身份直读与 `isAllyOf/isEnemyOf/dispositionOf`，最终 policy 决策统一走 `relations.js`。
- **C·targetBrain Data Contract**：形成唯一 `buildPlayerSnapshot()`/`buildTargetCandidate()`，确保 `handCount/equipValue/judgeCards/nextToAct/linked/relation/threat` 真实且更新。

### Stage D：Action Semantics / State Transition Utility

- **动作语义唯一源 `inferPurpose`**：`attack / control / dismantle / state / heal / gain / generic` 七类粗分类；把「过河拆桥/顺手牵羊」从 control 拆分独立为 `dismantle`，覆盖「过河拆队友乐」「顺手解队友负面判定区」反例。
- **收益系统 `actionValue` / 方向评分 `directionScore`**：对拆除类动作区分「拆敌人 / 拆队友负面判定区（正收益） / 拆队友好牌（仍负）」；新增 `_hasNegativeJudge` 识别乐不思蜀/兵粮寸断/闪电等负面延时牌。
- **铁索（`state`）/ 闪电（`generic`）归位**：铁索最终策略交由 `tiesuoEvaluator` 唯一权威；闪电为自用、`judgeBrain` 唯一决定。

### Stage E：Behavior Regression Suite

- 新增 `tests/behavior/`：`tao_rescue.mjs`、`tiesuo.mjs`、`wuxie.mjs`、`judge_control.mjs`、`turn_consistency.mjs`、`jiedao.mjs`、`global_tricks.mjs`，加之 `_harness.mjs` 统一断言底座；以后行为 bug 先写 failing behavior test。

### Stage F：特殊牌 Evaluator

- **借刀杀人**：`weaponHolder + victim` pair 动作评估（`jiedaoEvaluator.js`），枚举合法 pair 并选最优。
- **桃园结义**：按 `Σ allyHealValue − Σ enemyHealValue` 净治疗效用评估（`taoyuanTiming.js`）。
- **五谷丰登**：综合敌我人数、手牌需求、座次、选牌顺序与公开牌价值评估净效用（`wuguTiming.js`）。

### Stage G：Timing Audit

- 审计 `score/decision/timing/**` 的未显式 import `get/game`、silent fallback、重复最终 policy、未接入模块与 evaluator 冲突逻辑；每个模块标记 `ACTIVE/WRAPPER/LEGACY/DEAD/EXPERIMENTAL`。

### Stage H：Hook Lifecycle

- 收敛 `Player.prototype.*` / `game.*` / `get.*` monkey patch 的 original ref / install flag / install / uninstall / restore 闭环；重点修复 `game.gameDraw`、`proto.phaseBegin`、`game.check`（广播）三处「卸不干净 / 重装失效」缺陷，验证 install→uninstall→install again。

### Stage I：Cache Audit

- 手牌推断缓存 `handInference.js` 新增 `_inferKey`（手牌数精确值 + 牌堆 log2 分桶 `/ _deckBucket`），`probHasShan/probHasWuxie/probHasTao/probHasSha/probHasJiu/probHasEquip/probHasCard` 统一接入。
- 局势评估缓存 `threat.js` 新增 `_aliveFingerprint`（存活玩家血量×手牌聚合指纹），纳入 `situationFactor`/`incomingPressure` 缓存 key，消除 stale cache。

### Stage J：Exception Health

- `diag/swallow.js` 新增 `reportUnexpected/resetUnexpected`（模块/原因/计数/最后发生时间）与 `unexpectedStats`（结构化诊断），统一挂载 `window.__DJSC`。
- `diag/health.js` 汇入「异常健康度」检查项；`extension.js` 面板挂载失败与 `installScoreEngine` 安装失败上报 unexpected，杜绝模块坏掉只表现为「AI 变笨」。

### ✅ 发布门禁

- [tests/run_tests.mjs](tests/run_tests.mjs) 全量 **727 项断言**通过（§10.1 … §10.33）；`tests/behavior/` 7 套行为套件全通过。`node tests/run_tests.mjs` 退出码 0，可接 CI。

---

## v3.1α 铁索连环状态规划修复（2026-10-02）

> 对应《02_DeepSeek4_铁索连环状态规划修复指令》与《无名AI3.1_铁索连环状态规划与重铸决策_实施方案》。
> 唯一目标：把【铁索连环】从"可选两目标的普通锦囊"改造为**对全局横置集合进行最多两次 toggle 的状态优化动作**，建立唯一权威的铁索策略源。
> **关键澄清**：本任务**不是**"铁索必须选两个目标"——单目标 / 双目标 / 重铸三者同等合法，由全局状态效用决定。

### 🔗 唯一权威：Tiesuo Evaluator

- **新增 [tiesuoEvaluator.js](score/decision/cards/tiesuoEvaluator.js)**：铁索最终策略唯一权威源。
  - 纯模拟器 `getCurrentLinkedSet` / `toggleLinkedSet`（对称差 toggle，**不改真实 Player**）。
  - 合法动作枚举 `generateTiesuoActions`：RECAST / 单目标 / 双目标，去重去非法，覆盖 8 人局 37 个候选（1 + 8 + 28），**拒绝 top1/top2 近似**。
  - `evaluateLinkedState`（relation + HP + role）、`scoreTiesuoAction`（ΔU）、`estimateTiesuoRecastValue`、主入口 `evaluateTiesuoActions`。
  - 轻量属性机会 modifier（§11.4）：我方有属性伤害手段 → enemy-linked ×1.15；敌方有属性威胁 → ally-linked 罚分 ×1.15。

### 🧩 状态事实层：唯一横置状态读取入口

- **新增 [playerState.js](score/decision/state/playerState.js)**：导出 `isPlayerLinked(player)`，全库唯一横置状态读取入口。
  - `isLinked` 是函数时调用取值，非函数时才回退 legacy 布尔字段；缺失/非法/抛错一律 **fail-closed 返回 false**。
  - 消除 `!!p.isLinked`（函数对象恒真陷阱）、`!target.isLinked`、`isChained` 与自造 `isLinking`。

### ⚙ 决策内核集成

- **[engine.js](score/decision/engine/engine.js)**：tiesuo 分支改调 `evaluateTiesuoActions`，删除旧 `top1/top2` 与"最多连 6 个"硬编码；`use → targetNames`、`recast → ba.recast=true`（重铸不再伪装成普通 use）；`_finalResult` 显式携带 `target`/`recast`；新增属性机会 modifier（复用 `threat.linkedChainValue`）并传入 evaluator；删除自造 `ctx.isLinking`。
- **[aiOverride.js](score/decision/safety/aiOverride.js)**：新增纯谓词 `isRecastRecommended(ba)`（严格 `recast === true`），在 `aiOrder`/`aiValue`/`useful` 三处加 recast 短路守卫，避免原生 AI 优先"打出铁索"而堵死宿主重铸路径。

### 🧹 legacy 铁索启发收敛（消除第二套最终 policy）

- **[cardPlayBrain.js](score/decision/cardplay/cardPlayBrain.js)**：删除 `canChainEnemies`、`if(id==='tiesuo') return 72/20` 专用优先级、`pickTarget` 中 tiesuo 专用分支与自造 `isLinking` 读取；tiesuo 落回 control 默认（分类/`isAllyUsable` 保留）。
- **[damageTransfer.js](score/decision/safety/damageTransfer.js)**：删除 `tiesuoTiming` / `tiesuoBonus` 两套并行启发式；保留 `countTiesuo`（纯统计）。
- **[optimization.js](js/content/optimization.js)**：火攻横置传导与 `lib.card.tiesuo` 覆写全部改调 `isPlayerLinked`，方向与 evaluator 对齐。
- **[threat.js](score/decision/threat/threat.js)**：`linkedChainValue` 改调 `isPlayerLinked`，并**保留复用**为 evaluator 属性机会 modifier 输入。

### 🩺 统一诊断

- 每次铁索决策写入 `_status.djsc_lastTiesuo`（当前横置集合 / 全部候选与 ΔU / 最终 `{type, targets, score, reason}`），可解释每次单/双/重铸选择。

### ✅ 发布门禁

- [tests/run_tests.mjs](tests/run_tests.mjs) 新增 **§10.13–§10.19** 断言矩阵（状态读取全矩阵、纯模拟器、动作枚举、utility/delta、recast 竞争、engine 集成与决策范例 1–4、aiOverride recast 对齐、legacy 收敛源码守卫），总计 **403 项**全通过（TDD 先红 19/403，后全绿）。

---

## v3.1α 桃救援策略修复（2026-10-02）

> 对应《01_DeepSeek4_桃救援策略修复指令》与《无名AI3.1_敌方濒死误出桃_修复方案》。
> 唯一目标：修复 AI 对**敌方濒死**角色错误使用【桃】的 P0 战术错误，建立唯一权威的救援策略源。

### 🍑 唯一权威：Tao Rescue Policy

- **新增 [rescuePolicy.js](score/decision/safety/rescuePolicy.js)**：导出 `evaluateTaoRescue(player, target, ctx)`，统一裁决"当前是否允许用桃救 target"，返回 `{ allow, relation, disposition, score, reason }`。
  - 不变量：`self → allow`、`ally → allow`、`neutral → block`、`enemy → block`、`invalid/missing → block`。
  - **「濒死」只提升紧急度，绝不反转敌我方向**；`target === player` 特判为自救（绕过 `dispositionOf(me,me)=0` 陷阱）。
  - 关系解析顺序：注入 `ctx.disposition` → `ctx.relations.dispositionOf` → `ctx.attitude` → 默认 `relations.dispositionOf` → `get.attitude` 回退；**任一关系源异常/缺失 → 非 self 一律 fail-closed 拦截**（宁可少救一个未知对象，也不把桃送给敌人）。
  - Score 契约与 `relations.actionValue()` 量级一致：`self +8 / ally +5 / neutral −3 / enemy −8 / invalid −8`。

### 🔧 三层软评分对齐（去掉"濒死优先于敌我"的 early-return）

- **[optimization.js](score/decision/safety/optimization.js)**：删除 `if (dying && dying === target) score = 5.0;` 的**无条件 +5**，改由 `_scoreTao()` 委托 policy —— 敌方/中性濒死得到**负分**，不再向 bestAction 暴露正救援倾向。
- **[responseAI.js](score/decision/cardplay/responseAI.js)**：`_shouldSaveTao()` 移除 `target.hp <= 0 → return false` 提前返回（该 early-return 直接绕过了敌我判断），濒死场景改由 policy 决定"是否保留桃"。
- **[respond.js](score/decision/override/respond.js)**：`_keepTao()` 移除 `dyingTarget.hp <= 0 → return false` 同型 shortcut，统一走 policy。

### 🛡 chooseToUse 窄范围 Hard Guard（Root Cause D）

- **[use.js](score/decision/override/use.js)**：新增 `_resolveDyingTarget()`（沿已验证事件链 `event.dying → getParent()…` 上溯，最大 6 层、`Set` 防循环引用、**绝不扫描 `game.players` 猜 hp≤0**）与 `_shouldBlockTaoRescue()`（唯一读 policy）。
- 在常规 `_shouldOverride()` **之前**安装"桃救援护栏"：仅包装 `ev.filterCard` 对 `tao` 追加 veto，非桃牌与其余路径完全走原生 filter；护栏异常时保守放行。
- **不删除 `_status.currentPhase !== player` 全局保护**（不扩大 bestAction 接管范围），只为"敌方/中性濒死求桃"建立窄范围例外；allow（self/ally）时仍走原生流程。
- 回合外路径 `currentPhase !== rescuer` 时，敌方濒死 `filterCard(tao) === false`，桃对 AI 不可用。

### 🩺 统一诊断

- 救援拦截/放行统一写入 `_status.djsc_lastResponse`（`kind: 'tao-rescue-block' | 'tao-rescue-allow'`，含 `relation / disposition / reason / target / source / ts`），F12 可直接定位"为什么救/为什么不救"；仅记录标量与目标名，不持有大对象引用。

### ✅ 发布门禁

- [tests/run_tests.mjs](tests/run_tests.mjs) 新增 **§10.12 桃救援策略**断言矩阵（含 self/ally/enemy/neutral/invalid、attitude 回退、disposition=NaN 回退、relation API 失败 fail-closed、1 桃/多桃方向不变、optimization/responseAI/respond/use 四层防线覆盖），总计 **280 项**全通过。

---

## v3.1α 深度系统审查修复（2026-09-30 ～ 2026-10-01）

> 对应《无名AI3.1α 深度系统审查报告》P0（10 项）/ P1（20 项）/ P2（9 项），共 39 项全部闭环。

### 🔧 模型链路（最高优先级）

- Int16 偏置 codec 修复（B1–B4 此前按 Int8 解码，任何 save/load 都几何错位）；load 路径补全 shape/type 校验，失败 fail-closed。
- 内置默认权重（v6 旧契约）与运行时 v7 不一致时**明确拒绝**：不再"显示预训练、实际随机"；诊断可经 `getDefaultDiag()` 查询。v7 离线预训练权重待重新生成（需真实对局样本）。
- 修复 B2/B3 持久化写错网络层；HotSwap 快照补全 Critic 头与残差投影、全部 AdamW 动量；候选训练与 stable 完全隔离，discard/promote 语义闭环。
- 反向传播改为"先算完全部梯度再统一 AdamW 更新"；三套前向（forward / forwardWithValue / forwardFastWithValue）统一为同一几何（GELU + LayerNorm + 残差投影）。
- **修复 `predict()` 恒返回兜底的致命问题**：`softmax` 返回 `Float32Array`，旧代码用 `Array.isArray` 判定恒为 false，导致线上 action 恒为 B、置信度恒 0；兜底均匀分布同步改为严格归一（1/6）。
- `resetWeights()` 失败时不再偷偷随机化在线权重，真正"原样保留、不落盘"。
- 训练数据导入强契约：仅 **130 维且逐项有限数**的样本可入 BUFFER（48/96/129/131 维、NaN、字符串一律拒收并计数）。

### 🔌 插件生命周期 / 自检

- enginePlugin 注册与安装分离；依赖失败可自恢复；卸载清 props / timers / 动态 import / hook patch；延迟注册复活问题修复。
- verifyAll 改为真实 await、按面板独立判定；selfCheck 从空壳改为真检查；modularReady 时序修正。
- eventBus 真正接入业务链路（game:start/end、train:start/done/fail、局末 flush 落盘）。

### 🛠 工程收敛

- 业务层 localStorage 直调（43 文件）全部收敛到中央存储；配额守护分级清理，绝不静默删除权重/战报/记忆。
- 1498 处空 catch 全部接入限流观测器（`__DJSC.swallow / swallowStats / resetSwallow`），默认只计数、采样日志，不打断对局。
- 版本号单一权威源 [js/config/version.js](js/config/version.js)；语义审计快照改由 `build/semantic_audit.mjs` 生成。
- 删除假 Worker（从未被调用、只模拟损失），本地训练改分片协程让出主线程。
- **新增发布门禁**：[tests/run_tests.mjs](tests/run_tests.mjs)（`node tests/run_tests.mjs`，零依赖，203 项断言覆盖报告 §10.1~10.9，含反向传播逐层有限差分核验、首步更新方向验证、插件生命周期全段；§10.10 自检面板须游戏内控制台验证；失败退出码 1，可接 CI）。

### 🧬 A/B 状态机合并（报告 §7/§8）

- **§8：modelState.js 与 modelHotSwap.js 双状态机（重复真相源）已合并为单一 A/B 状态机**，本体在 [modelState.js](score/model/net/modelState.js)：`STABLE → trainCandidate() → CANDIDATE → evaluate() → PROMOTE / DISCARD → STABLE`，每状态带不变式（STABLE 无候选；CANDIDATE 每局 `hotGameStart` 明确分组、局末精确还原；PROMOTE 换入候选并持久化、清分组备份不还原；DISCARD 还原稳定模型）。
- 手动 `forceTrain` 与自动 `triggerHotTrain` 共用**同一候选槽、同一分组、同一评估口径**（实战胜率差 ≥5% 晋升，可经配置 `modelPromoteGap` 调整）；原 modelState 的"训练准确率 vs 基线准确率"伪评估已废弃，统一为真实 A/B 分组分数。
- 统一持久化到单一存储键 `djsc_model_state`（v2），原 `djsc_hotswap_v1` 存档一次性迁移（候选/计数保留）后删除；候选跨会话存活自动恢复 A/B。
- **modelHotSwap.js 降级为兼容外壳**：导出签名（`triggerHotTrain/hotGameStart/hotRecordABScore/hotSwapStats/resetHotSwap/forcePromote/forceDiscard`）与 `window.__DJSC.hotSwap.*` 挂载保持不变，全部委托 modelState.js；引擎、配置面板、selfCheck、发布门禁零改动。
- **§7：weights.js 落地单一模型契约 `MODEL_SCHEMA`**（version/featureDim/dims/dtype/architecture），`DIM_CHECK` 与 A/B 快照结构护栏（NET）统一由它派生，消除手写维度。
- 门禁新增 4 条 §8 不变式断言（state 流转、统一存储键写入、legacy 键迁移删除），总计 203 项。

### 🧭 自检系统四层拆分（报告 §9）

- **新增 [layers.js](score/verification/layers.js) 四层统一自检**，解决"检查真实功能"与"检查有没有一个函数名"混层问题：
  - **L1 加载契约** —— 8 个关键模块 import 成功 + 导出 shape/type 逐项核对 + `MODEL_SCHEMA` 契约形状（version/featureDim/dims/dtype/architecture）；
  - **L2 运行时连接契约** —— 委托 `registry.audit()`（CONTRACT 权威）+ `__DJSC` 关键命名空间 + 插件 disabled 状态 + `modularReady`；
  - **L3 功能 smoke** —— 真实调用：`forward(zeros130)` 6 维全 finite、`predict` probs 归一（Σ≈1）、三套前向同几何、中央存储 encode→decode 精确 roundtrip（临时键即写即删）、A/B 状态机合法态、eventBus 真实业务订阅（≥3）；
  - **L4 实战行为验证** —— 目标选择/响应/弃牌/拼点/回合结束/异常模式 6 项，显式标注 manual、**永远不计入失败**，只能真实对局确认。
- 调用入口：`__DJSC.verifyLayers()`（结构化）/ `__DJSC.verifyLayersText()`（可读文本）；verifyAll 报告头部新增四层汇总条与"分层"分类行，原分类明细零改动。
- 六套既有自检归位：`registry.audit`→L2 权威；`selfCheck`/`verifyAll` 存在性检查→L1/L2、功能级调用→L3；`health`→L2/L3 运行时环境；`professionalReadiness`/`semanticAudit`→架构就绪度与静态审计（L1 静态侧），保持独立。
- 门禁新增 §10.11 共 20 条断言（L1/L3 Node 下全通过；L2 依赖宿主挂载面只校验结构；L4 必须全 manual），总计 **226 项**。

### 🏋 离线预训练管线（报告 §14C）

- **新增 [build/train_default_weights.mjs](build/train_default_weights.mjs)**：用真实对局导出的 JSONL 样本离线重训 v7 内置默认权重，打通 P0-03 正向闭环。
  - 训练口径与游戏内 localTrainer 完全一致：130 维契约校验（脏样本拒收计数）→ 打乱 → 80/20 划分 → 余弦退火 `trainOneWithValue` → 验证集准确率 → `saveWeights` 序列化（Int8 权重 / Int16 偏置 base64）→ 重写 `defaultWeights.js`。
  - 用法：`node build/train_default_weights.mjs <样本.jsonl> [--epochs N] [--lr 0.02]`，样本需 ≥200 条（游戏内经 `__DJSC.trainExport()` 导出）。
- **门禁 §10.2/§10.3 改为版本自适应**：默认权重 v6（当前）走 fail-closed 分支；重训出 v7 后自动切换正向分支（加载成功、ready=true、reset 确定性恢复出厂、连续两次 hash 一致）。
- **门禁同时充当默认模型质量闸**：§10.5 梯度有限差分探针会拒绝饱和/死梯度模型——样本质量不足时训练脚本会提示但门禁阻止发布，这是设计行为。
- **修复游戏内控制台 `DJSC is not defined`**：扩展全局对象只挂了 `window.__DJSC`，控制台/旧教程裸写 `DJSC.xxx` 直接 ReferenceError；现 `window.DJSC` 指向同一对象作为兼容别名（extension.js）。

### 🛡 数据隔离（新旧版本数据不互相污染）

- **样本层统一清洗闸**（[trainExport.js](score/model/train/trainExport.js) `_sanitizeSample`）：旧版本样本存在 reward 写入 bug（reward 恒 ~100，与 meta.score 完全脱节）。以 `meta.score`（±147 裁剪前原始评分）为权威值，`|reward − clamp(round(score))| > 1` 即判旧版污染并自动修复，无依据且非法的样本丢弃。三个入口全部接管：IndexedDB 启动加载、localStorage 回退加载、手动导入旧导出文件；导入返回新增 `repairedReward` 字段报告修复条数。
- **权重层数据纪元**（weights.js `DATA_EPOCH = 2`）：客户设备上"旧版本自己打 + 手动训练"得到的权重参数本身已被污染标签训歪，v7 版本号只能挡结构不兼容、挡不住"结构对但标签脏"。现 `saveWeights` 统一写入 `dv=2`；凡 v7 存档缺 `dv` 标记且 `trained > 0`，`loadWeights` 一律拒载并回退内置默认权重（日志明确提示）。内置默认权重 `trained=0` 不受影响。

---

## v3.1α / 3.1.0（2026-09-26）

### 📦 架构分层（`score/` 域化重构）

- **165 个平铺模块 → 11 个功能域子目录**：`core / model / think / decision / economy / timing / observe / guard / optimize / ui / selfcheck`
- **唯一对外入口不变**：`score/index.js` 保持原位，`extension.js`、`js/config.js`、`build-mod.mjs` 对分层透明
- **619 处相对 `import` 按新深度重写**；跨域引用改为相对路径，宿主引用统一为 `../../../../noname.js`
- **域结构索引**：`score/_DOMAIN.md` 重写为权威清单 + 依赖规则；`DEV_GUIDE` 目录树同步更新

### 🔧 Bug 修复（本次一并处理）

| 问题 | 影响 | 修复 |
|---|---|---|
| `postCheck.js` 中 `const campDelta` 被重新赋值 | 赋值抛异常 → `gain += campNet*0.5` 永不执行，阵营净收益未并入 gain | 改为 `let campDelta` |
| `selfHeal.js` 用 `key + '.js'` 拼路径动态 import | `narrator` 键映射到不存在的 `narrator.js`，自修复静默失败 | 契约表显式声明 `file` 字段（narrator → decisionNarrator.js） |
| 迁移后 `panel.js` / `allyExempt.js` 跨层引用深度错误 | `./override/index.js`、`../js/utils.js` 失效 | 修正为 `../override/index.js`、`../../js/utils.js` |

---

## v2.5.0（2026-09-23）

### 🔧 Bug 修复（导致扩展加载失败/功能不生效）

| 问题 | 影响 | 修复 |
|---|---|---|
| `trainExport.js` 引用未定义的全局函数 `exportJSONL` | **整个扩展加载崩溃**，弹 ReferenceError | 删除无效的劫持代码，扩展数据通过 `collectExtendedTrainingData()` 单独导出 |
| `allyExempt.js` 错误 import `../../js/utils.js` | 真实加权校验模块加载失败，静默退回硬编码内联桩 | 修正为 `../js/utils.js` |
| 25 个子目录文件、121 处相对 import 路径错误 | 子目录模块化版全部无法加载 | 批量修正：`./core/logger.js` → `../core/logger.js` 等 |

### 📦 架构升级

- **子目录模块化版激活**：通过 `import('./core/index.js')` 递归加载所有子目录模块（300+ 文件），仅注册不重复安装 hook
- **批量暴露 31 个模块到全局 `window.__DJSC`**：供自检面板访问各模块的 stats/getStats 函数
- **活代码文件数**：~154 → 358

### ✅ 自检面板升级

- **功能级自检**：33 个模块逐个调用 `stats()` / `getStats()` / `guardStatus()` 等函数，真正执行并验证返回值
- **模块化版状态检测**：检测子目录版是否已加载
- **allyExempt 真实实现检测**：区分加权实现 vs 内联桩
- **修正断言**：`modelState.getState()` 返回字符串状态名是正常设计，不再误报

---

## v2.0.0（2026-09-22）

### 🔥 核心架构升级：从单层规则 → 多层认知闭环

#### 1. 特征系统升级：48维 → 96维

| 维度段 | 内容 | 状态 |
|---|---|---|
| 0-47 | 基础局面特征（血量/手牌/装备/敌人等） | 保留不动，兼容旧模型 |
| 48-63 | 时序特征 + AI 自我状态（校准偏移 + 元认知熟悉度） | ✅ 新增 |
| 64-79 | 相对强度 + 元认知干预级别 | ✅ 新增 |
| 80-95 | 概率/牌堆/全局校准统计 | ✅ 新增 |

**关键设计**：不新增维度，只填充原来预留的空位，旧模型不用重训也能跑。

---

#### 2. 神经网络升级：单层加权 → 多层感知机

- 网络结构：96 → 64(ReLU) → 6
- Int8 量化 + Base64 存储
- 兼容旧 `getWeights()/getBias()/predict()` 接口
- 新增 `__getW1/__getB1/__getW2/__getB2/__applySnapshot` 接口（供热更新用）

---

#### 3. 元认知系统（6维架构）

| 维度 | 权重 | 说明 |
|---|---|---|
| 元素认知 | 35% | 技能/卡牌熟练度 |
| 模式认知 | 15% | 身份局/国战/斗地主模式熟悉度 |
| 局面类型 | 15% | 开局/中期/残局/优势/劣势 |
| 目标认知 | 10% | 集火目标/保护目标判断 |
| 局势认知 | 15% | 队友/敌人数量与状态 |
| 时间压力 | 10% | 回合剩余时间 |

**输出**：`familiarity`（0~1）+ `modulator`（0.5~1.0）+ `level`（high/mid/low）
**干预级别**：model(w=0.5) / blend(w=0.3) / rule(w=0.1) / skip(w=0)

---

#### 4. 决策校准器（自动校准）

- 每次冲突决策记录 pending，1500ms 后观察真实结果（HP/手牌/分数）
- 判定谁更优，自动微调权重
- 单次调整 ≤ 0.03，累计偏差 ≤ 0.3，学习率衰减 0.95
- 偏移维度：atk / def / wAtkCard / wDefCard / modelTrust

---

#### 5. 多档案协同系统

- 5 个预置档案：均衡型 / 激进型 / 保守型 / 守护型 / 独狼型
- 每 3 局融合一次：胜率 < 0.4 降权 0.5，> 0.6 升权 1.5
- 低胜率档案可模仿高胜率档案（70% 自己 + 30% 最优）
- 有效偏移 = 档案偏移 50% + 全局融合偏移 50%

---

#### 6. 策略总线（冲突仲裁）

- 触发条件：规则和模型都高置信（>0.55）但结论不同
- 仲裁方式：
  - 分差 > 5 → 直接选高分
  - 调用 planner 走 2 步预测
  - 简化版：检查目标是否有闪/桃等反制手段
- 输出：winner(rule/model/planner) + picked(action) + reason

---

#### 7. 模型护栏（红线拦截）

- 8 条红线规则（打队友/过度出牌/自残等）
- 冷却时间 30 分钟（避免反复触发）
- 拦截后自动降级为规则引擎决策

---

#### 8. 元素反馈闭环

- **elementAccess.js**：影子表读写系统，记录每个技能/卡牌的实战表现
- **elementFeedback.js**：500ms 观察 → 自动修正定义
- 跨模式迁移：技能/卡牌走 global 层，身份/阵营走 mode 层
- 自动提升：某元素在 ≥3 个模式都出现 → 提升为全局通用认知

---

#### 9. 认知日志 + 认知冲突检测

- **cognitiveLog.js**：记录每次决策的完整链路（特征→模型→认知→冲突→结果）
- **conflictDetector.js**：检测规则 vs 模型的决策分歧
- 采样权重：元认知熟悉度越低，采样权重越高（重点学习陌生局面）

---

#### 10. 权重持久化（固化进模型）

- 把校准偏移直接写进模型输出层偏置 B2
- atk>0 → B2[D]（进攻标签）增加
- def>0 → B2[C]（保守标签）增加
- modelTrust>0 → 所有 B2 减小（降低模型自信）
- 每局结束消化一次，消化后 shift 归零

---

#### 11. 模型热更新闭环

- 攒够 300 个样本 → 自动触发训练
- 训练结果存为"候选模型"
- 候选跑 20 局 A/B 测试
- 胜率超过旧模型 5% → 自动替换；否则丢弃
- 全程无需重启，运行时热替换权重

---

#### 12. 协同学习（公共知识库）

- 局面指纹：血量段 + 手牌段 + 敌人 HP 段 + 集火状态
- 每个指纹下记录"选择→胜率"
- 高置信（≥3 样本）选择 → 给对应候选加分（群体智慧加成）
- 本地 AI 可选择性采纳

---

#### 13. 策略进化（遗传算法）

- 种群大小：8 个档案
- 每 5 局进化一次
- 精英保留：Top 2 直接进入下一代
- 杂交：Top 40% 两两混合，单点交叉
- 变异：15% 概率随机扰动 ±0.08
- 淘汰：Bottom 20% 移除

---

### 📊 可视化面板系统

| 面板 | 功能 | 入口 |
|---|---|---|
| 🧠 AI 大脑总览 | 校准/认知/冲突/多档案/策略总线/护栏 一屏看完 | `openBrainDashboard()` |
| 📈 校准趋势面板 | 权重偏移柱状图 + 规则胜率曲线 + 冲突次数趋势 | `openCalibratorPanel()` |
| 🎬 决策回放时间轴 | 每次决策的完整链路回放（状态→候选→模型→总线→执行→结果） | `openReplayPanel()` |
| ⚖️ 决策对比模式 | 同一局面下，不同档案的选择对比 + 分歧检测 | `openComparePanel()` |
| 🔥 模型热更新 | 候选模型状态 + A/B 进度 + 晋升历史 | `openHotSwapPanel()` |
| 🤝 公共知识库 | 局面指纹 + 高置信选择 Top 列表 | `openSharedPanel()` |
| 🧬 策略进化 | 种群排行 + 适应度 + 基因组 + 强制进化 | `openEvolutionPanel()` |
| 🔍 模块自检 | 所有模块挂载状态检查 + 历史记录 | `openSelfCheck()` |

---

### 📂 新增文件清单（v2.0 新增 20+ 模块）

```
score/
├── metaCognition.js          # 6维元认知
├── cognitiveLog.js          # 认知日志
├── conflictDetector.js      # 认知冲突检测
├── decisionCalibrator.js    # 决策结果回填+自动校准
├── calibratorPanel.js       # 校准趋势面板
├── multiProfile.js          # 多档案协同
├── strategyBus.js           # 策略总线
├── brainDashboard.js        # AI 大脑总览面板
├── decisionReplay.js        # 决策回放记录
├── replayPanel.js           # 决策回放面板
├── modelGuard.js            # 模型护栏
├── weightPersist.js         # 权重持久化
├── crossModeTransfer.js     # 跨模式迁移
├── decisionCompare.js       # 决策对比
├── comparePanel.js          # 决策对比面板
├── modelHotSwap.js          # 模型热更新
├── sharedKnowledge.js       # 协同学习
├── evolution.js             # 策略进化
├── elementAccess.js         # 影子表读写
├── elementFeedback.js       # 元素反馈闭环
├── confidence.js            # 置信度评估
├── localTrainer.js          # 本地训练器
└── selfCheck.js             # 动态自检
```

---

### 🔧 技术参数速查

| 参数 | 值 |
|---|---|
| 特征维度 | 96 维 |
| 网络结构 | 96 → 64(ReLU) → 6 |
| Int8 范围 | [-127, 127] |
| 分层量化 SCALE | 32 |
| 训练样本阈值 | 200（fast=300，slow=1000） |
| 元认知熟悉度分级 | ≥0.7 high，≥0.4 mid，<0.4 low |
| 干预级别权重 | model=0.5 / blend=0.3 / rule=0.1 / skip=0 |
| 护栏冷却 | 30 分钟 |
| 校准器单次调整 | ≤ 0.03 |
| 校准器累计偏差上限 | ≤ 0.3 |
| 校准器学习率衰减 | 0.95 |
| 多档案融合间隔 | 每 3 局 |
| 多档案胜率降权 | <0.4 降权 0.5 |
| 多档案胜率升权 | >0.6 升权 1.5 |
| 权重持久化学习率 | DIGEST_LR=8 |
| 热更新样本阈值 | 300 |
| 热更新 A/B 局数 | 20 |
| 热更新晋升阈值 | 胜率 +5% |
| 进化种群大小 | 8 |
| 进化精英保留 | Top 2 |
| 进化间隔 | 每 5 局 |
| 变异率 | 15% |
| 变异幅度 | ±0.08 |

---

## v1.x 版本历史（2026-09-19 ~ 2026-09-21）

### v1.1.1
- 24 核心优化模块
- 训练蒸馏闭环
- 决策点自动发现体系
- 模型护栏初版
- 特征升级到 96 维
- 多层网络初版

### v1.1.0
- 元素反馈闭环
- 元认知初版
- 认知日志
- 认知冲突检测
- 决策校准初版

### v1.0.0
- 基础规则打分引擎
- 48 维特征
- 单层加权求和
- 基础面板系统
