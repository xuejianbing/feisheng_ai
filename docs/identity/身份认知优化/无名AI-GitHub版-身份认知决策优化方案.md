# 无名AI GitHub 版：身份场认知与决策优化方案

基线：xuejianbing/feisheng_ai，v4.1.2.7，commit `13783eec78f524399ae9078e6a2a14cfedf41b4b`。2026-10-18 已核对远端 HEAD 一致。对象是该 GitHub 版本，不是用户本地 4.0.19。本文是修改设计，尚未修改生产代码。

## 1. 目标、范围与边界

首期限定标准身份场、规则身份配额明确、正常信息权限。支持每个行动者的独立观察视角。身份变化、双内、明忠等变体通过显式规则能力声明支持；规则不明时禁止用猜测配额硬锁身份。国战、斗地主、紫禁/谋攻等不同身份语义不直接套用。

核心目标：合法信息形成可信身份信念；身份信念进入动作价值；推断、执行与结果可追踪。不能以身份命名率或“更早认出反贼”为唯一目标。保留不确定性是正常能力。

五层责任：公开事实 → 行为证据 → 身份信念 → 战术关系/动作价值 → 宿主执行。禁止用当前推断结果决定是否记录原始事实；禁止把疑似身份写回宿主真实 identity。

## 2. 已确认问题和待验证风险

| 编号 | 证据 | 影响 | 优先级 |
|---|---|---|---|
| ID-01 | isLikelyAlly 的主忠分支缺目标为主公的硬事实分支；最小桩复现 false | 忠臣保护/救援可能受到错误中性关系影响；实际动作后果仍需宿主测试 | P0 |
| ID-02 | features 130–133 直接取 tgt.identity | 隐藏身份可绕过认知模块进入模型；是否实际影响动作取决于模型参与路径 | P0 |
| ID-03 | 按牌名记录拆顺为攻击 | 移除主公兵乐可能成为错误敌意证据 | P0 |
| ID-04 | 非负截断后归一化，再平滑并乘槽位先验 | 证据强度丢失；最小桩中攻击证据 0.01 与 1 结果相同 | P0 |
| ID-05 | 逐人独立乘剩余槽位先验 | 不满足整桌身份配额；一反一内时两人反贼概率均为 0.954545 | P1 |
| ID-06 | 引擎伤害观测在“当前判断同阵营”时省略敌意记录 | 记录机制依赖自己的推断，可能形成自我确认；需用真实事件复现 | P1 |
| ID-07 | 用牌、伤害、回复及击杀存在多条观测入口，汇总规则还重复消费同一统计 | 存在相关证据重复放大的风险；不能仅按 hook 数断言必定重复 | P1 |
| ID-08 | 关系三态、模式加分、身份偏置和专项 evaluator 并存 | 概率信息损失、同一身份收益重复计入、未知身份过度保守 | P1 |
| ID-09 | 内奸主要按双方概率人数判断强弱 | 人数不能充分表示有效战力和终局机会 | P2 |

已验证的最小复现调用真实生产 identity.js，宿主与行为输入使用桩，不是完整对局。忠臣对主公：hardIdentityOf={role:zhu,source:public}，isLikelyAlly=false。两名未知、一反一内：无证据时各0.5；等强攻击证据0.01或1时，各反贼0.954545，合计1.90909，虽然仅余一个反贼槽位。小数0.01是合成边界输入，用于验证强度敏感性，不声称正常一张牌会生成该值。

## 3. 目标接口

新增身份视图接口 identityView(observer,target,context)，全部消费者显式传观察者。返回完整四身份概率：

```ts
type IdentityView = {
  observerId: string;
  targetId: string;
  probabilities: { zhu:number; zhong:number; fan:number; nei:number };
  hardRole: 'zhu'|'zhong'|'fan'|'nei'|null;
  source: 'self'|'public'|'constraint'|'inference';
  possibleRoles: string[];
  evidenceRevision: number;
  publicRevision: number;
  ruleVersion: string;
  beliefVersion: string;
  calibrated: boolean;
  diagnostics: { evidenceGroups:number; entropy:number; reasonCodes:string[] };
};
```

概率最大值、熵、证据数分别记录，不合成含义不明的 confidence。calibrated=false 时 UI 称“推断权重”，不标榜校准概率。unknown 是无法可靠命名身份的状态，不是第五种身份。

硬事实来源只允许：自身身份、对观察者合法公开的身份、可靠规则配额的唯一逻辑解。当前版本不做跨局角色继承。玩家风格可保留，上一局是反贼不能增加下一局反贼先验。

缓存键至少包含 sessionId、observerId、观察者私有信息版本、公开事实版本、证据版本、规则版本。行动价值缓存另包含局面状态和动作版本。不要仅用回合、武将名或四舍五入后的最大概率。

## 4. 阶段 A：硬事实、可见性与兼容修复

### A1 硬关系修复

在身份规则层集中定义主公与忠臣的同阵营关系，补齐忠臣→主公；内奸不可直接按固定队友处理。保留自己与自己的关系语义，避免改变调用方约定。测试主忠双向、反反、公开反对主忠、主内残局等。规则阵营与“本次是否值得帮助”仍分开。

### A2 封闭信息旁路

逐项审计 target.identity、宿主 get.attitude/rawAttitude、阵营推断和训练特征。区分合法自身读取与隐藏目标读取。正常身份认知模块只能消费统一视图。

不能只禁止目标真实身份，却让 get.effect 经宿主态度重新带入真实身份。为首批支持的动作建立显式 observer-aware 效果适配；保留宿主合法性、技能效果规则，但其阵营加权须在可控边界重算。不用全局猴补丁替换 get.attitude，避免影响其他模式和扩展。

暂未完成语义分解的宿主回退标记 host-semantics-fallback，统计实际使用次数，不宣称整条决策链已满足正常信息权限。

### A3 规则不一致处理

剩余槽位必须满足：非负、总槽位等于未确定人数、公开身份不超出配额。当前“有槽位才扣减”会掩盖超额事实；新增一致性检查。异常时保留公开/自身硬事实，关闭配额硬推断，报告 rule-inventory-inconsistent，不凭经验公式强行清零某身份。

### A4 模型特征迁移

立即停止把隐藏真实身份输入当前模型。过渡阶段对受影响的身份模型路径暂停参与并明示原因，保留规则决策；不要把新语义悄悄交给旧权重。

建议新特征 schema 同时包含身份概率、硬事实来源/是否已知、缺失标记。维度可重新设计，不把“维度不变”当作兼容。升级 featureSchema、dataEpoch、model compatibility、样本 gen 指纹和服务端过滤。旧权重只在其明确支持的旧语义环境中使用；其他模式是否兼容逐项声明。

交付与门禁：硬关系测试、隐藏真值替换测试、同名不同实体测试、缓存刷新测试和兼容矩阵通过。此批不改变主要身份行为权重和内奸战略。

## 5. 阶段 B：证据流水线

保留不可变的公开事件账本，另生成有版本的证据。原始日志不能被当前 ally/enemy 结论过滤。

```ts
type IdentityEvidence = {
  sessionId:string; eventId:string; rootActionId:string;
  actorId:string; targetIds:string[];
  decisionIndex:number; publicStateRef:string;
  actionKind:string; actualPublicDeltas:object;
  agency:'chosen'|'forced'|'collateral'|'unknown';
  semantics:'harm'|'benefit'|'mixed'|'unknown';
  opportunity:'observed'|'estimated'|'unknown';
  publicTargetRoleAtTime:string|null;
  evidenceVersion:string; reasonCodes:string[];
};
```

首批语义支持：主动单目标伤害、救援主公、拆除明确负面判定、无懈的实际保护关系。无懈必须看取消链和最终效果，不能按“用了无懈”直接算帮助。

用牌是选择证据，伤害是结果证据；二者按同一 rootActionId 合成联合证据或明确的条件增量。击杀不再无条件成为第三次独立加分。eventId 幂等，重复回调不能累加。

不能因当前认定友方而丢弃攻击事实；应记录并解释为可能误伤、被迫或协作。相反行为也不能因先前认定敌方而被忽略。

负证据如“没有救援”“没有攻击主公”首期关闭；之后只有明确机会信息才启用，并对未知手牌积分而非偷看。没有牌、没有距离、被控制都不能作为同等反证。

目标后来公开时，可以在当前时点利用新增信息重新解释旧行为，但必须保留原时点可见信息，历史评测不可倒灌未来身份。将当时判断与当前重算分开。

交付：事件→语义→证据的对账报告及拒收原因统计。验收场景包括拆主公兵乐、拆主公装备、被迫攻击、AOE波及、反无懈、自救、酒杀、重复回调。

## 6. 阶段 C：信念估计与全桌约束

### C1 有证据强度的估计

移除无数据支持的座位/距离身份先验。随机身份分配时先验来自可靠配额；座位、距离、武将、手牌数、回合顺序应进入行为解释，因为它们影响机会。

先建立可解释的对数证据模型：

`logWeight_i(r) = logPrior_i(r) + Σ_g beta_g * evidence_g(i,r)`

每个 g 为去重后的根事件或相关证据组。beta_g 与证据幅度有界，参数离线确定后冻结测试。此式在证据贡献未经似然估计与校准时属于评分模型，不能声称严格贝叶斯后验。单纯把旧加分改成 softmax 不能解决证据语义错误。

首期不做自动在线权重学习，不因新证据冲突就硬切身份。身份固定、行为策略可变；保持早期事实，按事件当时局势解释，不能简单按时间把所有旧证据遗忘。

### C2 配额联合推断

在合法配额下枚举/动态规划身份分配。若首版只使用每位玩家的局部角色分数，可用：

`P(R_1...R_n | E) ∝ 1[配额合法] * exp(Σ_i score_i(R_i))`

这是具有配额约束的条件评分模型，局部因子是近似假设。不要先给每人乘一次槽位先验，再在联合分配中重复计算同一配额先验。

从联合分配求边缘概率，满足每人概率和为1、每身份期望人数等于剩余配额、公开事实不变。一般人数有限，可以精确枚举或使用配额动态规划；设计算预算与确定性降级。超预算退回配额一致的先验或明确标记近似结果，不静默输出伪高置信。

二阶行为关系先只依赖公开身份或冻结的上一轮信念；不要在一次更新中相互反复放大。后续有成对因子时需要重新评估推断复杂度与校准。

### C3 校准与可解释性

校准数据与训练、最终测试按对局隔离。报告 Brier、log loss、可靠性图、置信分箱样本量和按角色/回合分组表现。硬事实与软推断分开评测，否则大量公开身份会掩盖推断错误。

解释展示前几项支持/反对证据及配额影响，而不是只显示“疑似反贼95%”。

## 7. 阶段 D：动作价值与本体接入

保留旧 dispositionOf 作为兼容输出；新动作评估直接消费身份分布。先试点普通单目标杀，覆盖其候选、目标评分和实际宿主桥接，再扩展桃、拆顺、无懈。不要一次改全部 evaluator。

`Q(a|I)=Σ_r P(r|I) * Q(a|I,r)` 仅适合其他身份影响可被吸收的单目标近似。AOE、团队协作及击杀奖励等涉及多个角色时，使用联合身份分配加权，不能把互相排斥身份当作独立概率相乘。

每个 Q(a|I,r) 包括行动资源成本、预期伤害/控制、救援可能、己方风险与终局条件；第一版仍是校准过的启发式效用，不冒充胜率。比较基准包含保留资源/结束出牌。

避免“60%反贼就必须打”的统一阈值：攻击、救援和斩杀的误判成本不同。明确胜负条件可以作为硬约束；不能把所有不确定目标都硬否决。

身份收益只允许一个账本来源 identityUtility 写入。逐项迁移 relations、identityBiasOf、modeStrategy.decisionBoost、identityPolicy 和护栏中重复的阵营奖惩；每迁移一项就移除旧贡献，避免新期望分叠加旧敌我分。不要在完整宿主 effect 上再乘一次身份态度。

每次决策记录 beliefRevision、candidateId、身份条件分、汇总分、旧/新首选、宿主实际选项、执行结果及回退原因。软接管推荐不算实际执行。

重要数据隔离：当前 actionOutcome 以 dispositionOf 为阵营符号。推断错了可能形成错误有符号标签，再反过来强化策略。保留原始公开变化、决策时信念和结果身份事实三份记录。赛后真实身份可用于离线标签或评估，不能回灌决策时特征；最终身份未能合法确认则保留未知。升级 rewardSchema，旧伪标签不无条件混入新训练。

## 8. 阶段 E：内奸战略

将身份分布估计与“自己是内奸时如何行动”分别维护。先保留原策略作对照，认知稳定后再升级。

有效战力使用公开血量、手牌数量、装备、技能、横置/翻面/判定状态与座次，并对隐藏响应牌使用合法推断。首期选少量可解释项，避免堆成不可校准总分。

依次检查：是否即将出现自己失败的终局、主公短期死亡风险、最强对手的有效战力、自己进入有利残局的能力。主公短期应存活不等于每步都该帮助主公。强弱差接近时允许保持资源，而非机械两边轮流攻击。

加入立场切换滞回，阈值由固定残局集调定；明确的终局风险立即覆盖滞回。多内/特殊模式未完成规则定义时不套单内策略。

## 9. 文件分工和依赖

所有下列路径相对固定 GitHub commit。

| 负责人 | 主要文件/新增模块 | 交付 | 依赖 |
|---|---|---|---|
| A 架构与规则 | perception/observer/identity.js、decision/relations/relations.js、foundation/adapt/playerIdentity.js；新增 identityFacts/identityView | 硬事实、观察者契约、规则一致性、缓存 | 第一批 |
| B 事件语义 | perception/observer/observer.js、decision/engine/engine.js 观测钩子；新增 identityEvidence | 根事件账本、证据去重、语义分类 | A 的 ID/视图契约 |
| C 概率与数据 | 新增 identityBelief、quotaInference、校准工具 | 配额一致的信念、校准报告 | A、B；可先用合成数据开发 |
| D 决策与接入 | relations、modeStrategy、identityPolicy、identityStance、aiOverride、override/use、response evaluators | 单一身份效用来源、试点动作闭环 | A、C；内奸升级后置 |
| E 模型兼容 | model/features/features.js、训练导出/标签、更新协议 | 特征/数据迁移、旧模型隔离、奖励语义版本 | A、B、D |
| F 独立验证 | 新测试、回放与实验工具 | 冻结测试集、隐藏真值替换、实战对照、性能 | 从第一批开始 |

表内路径省略共同 score/ 前缀。A 负责接口集成。B 负责事实，不负责身份概率；C 负责信念，不替 D 决定攻击；D 不反向修改 B 的原始证据。E 不用训练指标反过来改标签。F 保持冻结测试集独立。

## 10. 建议拆成七个可审查 PR

1. ID-01：主忠硬关系补丁与规则关系测试。范围小，可独立合并。
2. ID-02：身份视图、规则一致性、缓存与隐藏信息边界；受影响旧模型路径暂停参与。
3. ID-03：证据账本和首批四类动作语义；新证据先旁路，旧推断保留对照。
4. ID-04：有强度的角色分数、全桌配额约束及概率评测；新旧信念并排记录。
5. ID-05：普通单目标杀的身份期望效用与完整宿主接入；关闭被替代的旧身份加分。
6. ID-06：桃、拆顺、无懈扩展；新特征与标签契约、模型产物兼容迁移。
7. ID-07：内奸有效战力与残局策略，单独进行胜率对照。

PR编号是建议任务号，不是已创建的 GitHub PR。不要同时合并身份估计、效用权重和内奸策略的大幅变更，否则无法归因。

## 11. 测试与发布门禁

逻辑测试：主忠关系、公开身份覆盖、自身私有身份、槽位唯一解/矛盾、同名实体、重开局清空、重复事件幂等、同回合公开身份刷新。

概率测试：无证据配额先验、单弱事件不产生无依据尖峰、冲突证据、证据强度敏感、全桌边缘人数守恒、未知规则降级、对称玩家的对称后验。

对抗信息测试：保持可见信息和证据不变，替换隐藏身份/手牌，覆盖认知、特征、候选分、实际桥接结果。自身身份可变会合法改变观察者判断，应另做视角测试。

事件场景：主公兵乐被拆、主公武器被拆、卖血配合、强制攻击、AOE、反无懈、内奸救主公、无救援机会、同一杀命中/击杀多钩子。

决策场景：高概率敌人但误杀成本极高；低成本攻击与高成本斩杀；关键救主；反贼冲主和救反；主忠内/主反内/主内残局。每例保留可接受动作集合，复杂场景不强造唯一答案。

先设严重错误门禁，再看平均指标。门槛在实验前确定；不承诺未测量的固定胜率提升。使用完整对局分组置信区间，控制对手、规则、角色和座位；随机性可控时做配对实验。报告各身份、阶段和武将组合，不能只报总胜率。

发布次序：单元与性质测试 → 公开历史逐事件回放 → 新旧旁路对比 → 单动作试点 → 标准身份场有限启用 → 扩展动作与变体。旁路只证明建议差异，不证明真实胜率。

性能记录：每次信念更新耗时分位数、内存、事件量、缓存命中、动作阻塞。预算按目标手机测量后设定，不把桌面速度当手机保证。

回滚按模块开关执行，保留原始证据和新版本诊断。回滚不能悄悄恢复有隐藏信息输入的旧模型路径。遇规则冲突保持公开事实和保守回退，提示原因。

## 12. 第一轮明确交付

只完成主忠硬关系修复、身份信息边界审计、标准规则能力声明、首批事件语义样本以及冻结测试基线。不训练新模型，不扩大内奸策略。

通过后才确定证据权重、联合推断和动作期望价值的生产参数。首轮成果应回答：谁知道什么、记录了什么、推断为何变化、哪条实际决策受到影响。

## 源码依据

- [身份推断](https://github.com/xuejianbing/feisheng_ai/blob/13783eec78f524399ae9078e6a2a14cfedf41b4b/score/perception/observer/identity.js)
- [行为观察](https://github.com/xuejianbing/feisheng_ai/blob/13783eec78f524399ae9078e6a2a14cfedf41b4b/score/perception/observer/observer.js)
- [关系与动作评分](https://github.com/xuejianbing/feisheng_ai/blob/13783eec78f524399ae9078e6a2a14cfedf41b4b/score/decision/relations/relations.js)
- [模式策略](https://github.com/xuejianbing/feisheng_ai/blob/13783eec78f524399ae9078e6a2a14cfedf41b4b/score/decision/strategy/modeStrategy.js)
- [内奸立场](https://github.com/xuejianbing/feisheng_ai/blob/13783eec78f524399ae9078e6a2a14cfedf41b4b/score/decision/strategy/identityStance.js)
- [特征提取](https://github.com/xuejianbing/feisheng_ai/blob/13783eec78f524399ae9078e6a2a14cfedf41b4b/score/model/features/features.js)
- [决策引擎](https://github.com/xuejianbing/feisheng_ai/blob/13783eec78f524399ae9078e6a2a14cfedf41b4b/score/decision/engine/engine.js)
- [动作收益观察](https://github.com/xuejianbing/feisheng_ai/blob/13783eec78f524399ae9078e6a2a14cfedf41b4b/score/decision/analysis/actionOutcome.js)
- [效用账本](https://github.com/xuejianbing/feisheng_ai/blob/13783eec78f524399ae9078e6a2a14cfedf41b4b/score/decision/utility/utilityPipeline.js)
