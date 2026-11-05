# 无名AI 全量盘点与迁移表

> 本文为 B0 盘点及历次迁移记录归档；文件总数与“原工作树状态”是当时快照。最新结论见[交接稿](README.md)，不是整仓逐函数认证。

## 本轮范围

### B5 最新验收状态（2026-11-04，本地未提交）

> 第五轮补充：真实晚完成/晚取消 8 项通过；真实终局后点击“重新开始”，新局 8 名玩家、旧 pending=0。只覆盖标准页面重载；终局原事件等待未返回，同页终局隔离仍待验证（B5-V06）。

> 2026-11-05 更新：B5-F07 已修复；网关 88 项及完整回归通过。真实技能、普通/静默取消及响应隔离 13 项通过。以下各轮为历史记录；换局、长局、训练/A/B、导入还原仍待验，B5 未整体完成。

- 第三轮实机（用户已同意协议）：正常技能内容执行及一次 Commit 通过；不触发通知的 cancel 未设置 `_cancelled`，网关误 Commit，登记 B5-F07/P1。组合测试在取消断言失败后停止；响应、换局不能标为实机通过。本轮只记录修复建议，未继续修改或重试，详见问题表。

- 第二轮专项已修复 B5-F06：旧宿主事件晚完成时会提交/取消后来事务，甚至影响新局。三处确认入口绑定原事务 id，旧回调不能操作新事务。网关 80 项及完整 npm test 通过；真实游戏复验等待测试页 GPLv3 确认，尚未完成。
- 第一轮 3 次 mismatch、1 次 expiry 没有逐条事件记录，不能倒推为 B5-F06。已准备隔离事务追踪和真实技能/响应/取消场景，未运行部分保持待验；没有放宽五秒 TTL。

- B5 首轮实机已进行：仓库扩展加载、重复安装/卸载/重装、面板和一键导出可用；一个真实用牌样本通过同一事务编号回填收益。实际核心为 1.11.7，不是 1.11.6.1。
- 已修复面板卸载删除共享接口、扫描触发 DOM getter、面板样式、护栏缺少宿主导入，以及执行快照遗漏事务编号/宿主导入五组联调问题。主门禁 1899 项及其余六组检查通过。
- B5 **未全部完成**：真实技能/响应/取消/换局、手动训练及 A/B 全流程、导入还原、拒绝匹配的具体原因仍待验。B1-F01–F04 特征语义问题和 B1-L01 异步安装竞争保持开放。
- B2-F01 已核对基线并撤销误报，一键导出没有引用未定义的 `_exportAllThree`。详情及证据见 `issue-tracker.md`、`index.html`。

### B1–B4 历史实施记录（2026-11-04，本地未提交）

下方全量表保留 B0 盘点快照，不能将其中“候选/待确认”误读为最新实施状态；最新归位以本节和 `score/README.md` 为准。

- B1 三项已在本地实施，真实宿主最终联调仍待完成。
- B2 已实施：配置档案 → `foundation/config/profiles.js`；校准面板 → `view/dashboard/calibratorPanel.js`。
- B2 已实施：原 `foundation/io/export.js` 拆为 `bootstrap/dataExport.js`（业务汇总）与 `foundation/io/download.js`（通用下载）。
- B2 已实施：原 `foundation/io/exportAll.js` 拆为 `bootstrap/dataTransfer.js`（数据编排）与 `view/dashboard/exportPanel.js`（界面）；结果通知连接两者，没有反向导入面板。
- B2 已实施：原 `foundation/io/mergeExport.js` → `bootstrap/mergedDataExport.js`，保留 v2 格式，未与其他导出包合并。
- 以上旧路径均保留兼容转出；配置键、样本筛选、数据格式和存储路径不变。
- B3 主动链已本地分段：context（局面/目标）→ generation（候选及原基础估值）→ rules/scoring（规则/公共修正）→ selection（初选/规划/冠军与模型）→ safety（护栏）→ execution/decisionEffects（携带事务）→ 原宿主网关确认 → feedback/executedLearning（学习回填）。详细接口见 `score/decision/CONTRACTS.md`。
- B3 旧宿主规则已拆为 `js/content/legacy/startupSkills.js`、`globalRules.js`、`identityRules.js`；precontent 只保留版本检查、优化初始化和有序注册。
- B3 护栏判断与状态归 `decision/safety/modelGuard.js`，面板归 `view/dashboard/guardPanel.js`；规则价值计算归 `decision/utility/deepValue.js`。原模型路径兼容保留。
- B3 最终 `npm test` 通过，静态引用图未发现导入环。旧隐藏信息技术债 8 项与行为欠账 1 项继续保留，只更新迁移路径；没有新的基线豁免。未做真实游戏联调。
- B3-A01/A02 本轮已完成所列结构拆分：候选枚举与三个单候选估值模块分开；估值缓存、台账、事件记分、宿主钩子、日志、结算、观测和技能源码/画像/战术/显示分别归位。具体路径见 score/README 与 CONTRACTS。旧技能工具 skillTags.js 内容保留，新扫描实现命名为 skillSourceTags.js。
- B4 已落地：唯一生命周期移入 model/state/modelLifecycle.js，候选训练归 model/train/candidateTraining.js，快照校验归 model/weights/modelSnapshot.js，跨域学习归 model/bootstrap，提示/推荐归 view/model，校准历史归 model/calibrate/calibrationHistory.js。net/modelState.js 与 modelHotSwap.js 兼容使用同一状态机。
- 最新校验：完整 npm test 通过（主门禁 1886 项断言），质量基线新增回归 0，静态引用图无导入环。真实宿主与浏览器验收仍归 B5，未完成。
- B4 没有修改特征值、标签、训练数据格式或现有权重。B1-F01–F04 属于需独立定义与数据兼容设计的特征语义问题，继续开放，不作为结构迁移的隐式修改项。
- 验证：一次 `npm test` 通过，包含新增的新旧入口同一性、配置共享与训练包格式检查。未做实际浏览器下载、导入还原或真实游戏联调；不能据此宣称 B5 验收完成。
- 后续问题统一登记在 `issue-tracker.md`：B1-F01–F04 为四组特征语义问题，B1-L01/L02 为并发与宿主验收项；B2-F01 已在 B5 核对后撤销误报。问题不随结构迁移自动关闭。

### 原始盘点范围

git 列出的跟踪文件与未忽略新增文件；全文件逐项登记，代码进行只读内容扫描。包括本地未提交改动。

- 根目录：[仓库根目录]
- 基线：cd3f23f628ed5b41f498d78688d551f3248e4e80
- 总文件：314；代码/脚本：294
- 本轮只读业务源码；未运行游戏或测试，未迁移任何业务文件。
- 未逐函数审查的文件不能因为出现在表里就视为“已认证”。

## 顺序

|批次|内容|边界|前置|
|---|---|---|---|
|B0|固定本次快照与保护范围|本轮完成文件清单、哈希、现有路径、读取方和待确认项；模型权重、数据格式、资源、测试先原位保留。|无|
|B1|先解决启动和读取负责人|固定生命周期/插件分工；梳理补全模块真实来源；解除引擎与健康检查、战报的相互导入。|B0|
|B2|归位可以独立移动的职责|配置档案、校准面板、全量导出编排；保留配置键与原入口，静态/动态/注册/测试路径一并迁移。|B1；独立文件可提前准备，不先执行|
|B3|按完整决策链拆核心|生成、评分、策略协调、复核、执行确认分开；响应、弃牌、拼点有各自入口，公共动作契约复用。|B1；需要的 B2 项|
|B4|整理模型整体结构|特征、预测、参与决策、训练样本、权重分区；modelState 的 DOM 提示与跨域编排移出，保留参数和存储格式。|B1 与 B3 的交接约定|
|B5|整合界面、说明与兼容层|面板按已确定接口读取；统一模块清单/文档；旧路径确认全部读取方后再决定是否保留；全链路联调。|B2、B3、B4|

## 已核对结构问题

### F0 引擎、健康检查、战报互相导入

已确认模块引用环；尚未证明实际调用死循环或启动故障。

B1 先确定记录/状态读取接口的负责人，再接回健康检查与战报。

- score/decision/engine/engine.js:74 — healthCheck 静态导入
- score/foundation/diag/health.js:12 — getInstalled 静态导入
- score/view/report/report.js:15 — getRound/getScoreLog/getDecisionLog 导入

### F1 底层基础设施反向收集业务数据

搬动基础目录会牵动引擎和业务；必须区分通用工具与业务编排。

B1 先核对缺失模块替代来源，B2 再迁移导出编排。

- score/foundation/io/export.js:15 — from '../../decision/engine/engine.js'
- score/foundation/runtime/missingModules.js:22 — export const opponentPredict

### F2 模型状态、训练、记忆和界面仍混在一起

模型目录不能一次性搬家；先分离状态、训练编排、提示界面和规则评分。

B4 与 B3 按交接契约分段迁移，不改模型参数。

- score/model/net/modelState.js:52 — function showToast
- score/model/net/modelState.js:41 — from '../../decision/strategy/championStrategy.js'
- score/model/net/deepValue.js:10 — from '../../decision/relations/relations.js'

### F3 总引擎和旧宿主入口仍承担多个环节

单独整理目录仍无法清楚定位生成、评分、改判、执行与反馈。

B3 按完整主动出牌链拆分，再覆盖其他类型。

- score/decision/engine/engine.js:待定位 — export function bestAction
- js/content/precontent.js:171 — gjcx_neiAi

### F4 配置档案与武将画像放在同一目录

同名近似但职责不同，不能把 profiles.js 当作画像算法。

B2 移配置档案到配置域，保留其存储键。

- score/cognition/profile/profiles.js:35 — export function buildSnapshot
- score/cognition/profile/profile.js:13 — CHAR_PROFILE_OVERRIDE

### F5 文档的单向分层描述不等于当前依赖

不能把旧文档的“已经解耦”直接当作认证结果；直接宿主导入与传递宿主依赖也不能混为一谈。

B5 在迁移完成后按实测依赖更新文档。

- score/_DOMAIN.md:9 — 依赖只能
- score/_ARCHITECTURE.md:13 — 唯一耦合点
- score/decision/safety/allyExempt.js:15 — from '../../../js/shared/utils.js'

### F6 安装编排与插件登记是两种角色

看起来都提到安装不等于重复执行；不能直接合并或同时调用两套安装。

B1 固定负责人：生命周期安装，插件声明依赖；将来迁移需整套切换。

- score/plugins/enginePlugin.js:12 — 真实 hook 安装仍由
- score/bootstrap/lifecycle.js:51 — installHooks();

## 所有文件的处理表

目标是候选方案；“条件迁移/先拆/待确认”不是允许现在直接搬走。

|当前文件|当前板块|处理|目标|原因|批次/风险|证据程度|已发现的读取位置数|
|---|---|---|---|---|---|---|---|
|.github/workflows/release-test.yml|根目录入口与资源|保留资源/规范|.github/workflows/release-test.yml|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|.github/workflows/tests.yml|根目录入口与资源|保留资源/规范|.github/workflows/tests.yml|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|CHANGELOG.md|根目录入口与资源|保留资源/规范|CHANGELOG.md|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|CONTRIBUTORS.md|根目录入口与资源|保留资源/规范|CONTRIBUTORS.md|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|DEV_GUIDE/01_架构概览.md|根目录入口与资源|保留资源/规范|DEV_GUIDE/01_架构概览.md|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|DEV_GUIDE/02_模块开发指南.md|根目录入口与资源|保留资源/规范|DEV_GUIDE/02_模块开发指南.md|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|DEV_GUIDE/README.md|根目录入口与资源|保留资源/规范|DEV_GUIDE/README.md|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|LICENSE|根目录入口与资源|保留资源/规范|LICENSE|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|README.md|根目录入口与资源|保留资源/规范|README.md|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|TODO.md|根目录入口与资源|保留资源/规范|TODO.md|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|assets/qrcode.png|根目录入口与资源|保留资源/规范|assets/qrcode.png|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|build/semantic_audit.mjs|构建工具|暂保留：按现有职责归属复审|build/semantic_audit.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|build/train_default_weights.mjs|构建工具|暂保留：按现有职责归属复审|build/train_default_weights.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|build/verify_release_package.mjs|构建工具|暂保留：按现有职责归属复审|build/verify_release_package.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|css/AIjinjiang.css|根目录入口与资源|保留资源/规范|css/AIjinjiang.css|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|data/.gitkeep|根目录入口与资源|保留资源/规范|data/.gitkeep|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|extension.js|根目录入口与资源|暂保留：按现有职责归属复审|extension.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|info.json|根目录入口与资源|保留资源/规范|info.json|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|js/bootstrap/arenaReady.js|扩展外壳|暂保留：按现有职责归属复审|js/bootstrap/arenaReady.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|js/bootstrap/extensionLifecycle.js|扩展外壳|暂保留：按现有职责归属复审|js/bootstrap/extensionLifecycle.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|js/bootstrap/publicInterface.js|扩展外壳|暂保留：按现有职责归属复审|js/bootstrap/publicInterface.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|js/config/changelog.js|扩展外壳|暂保留：按现有职责归属复审|js/config/changelog.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|js/config/config.js|扩展外壳|暂保留：按现有职责归属复审|js/config/config.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|6|
|js/config/configLayout.js|扩展外壳|暂保留：按现有职责归属复审|js/config/configLayout.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|js/config/configSchema.js|扩展外壳|暂保留：按现有职责归属复审|js/config/configSchema.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|6|
|js/config/identities/fan.js|扩展外壳|暂保留：按现有职责归属复审|js/config/identities/fan.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|js/config/identities/nei.js|扩展外壳|暂保留：按现有职责归属复审|js/config/identities/nei.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|js/config/identities/zhong.js|扩展外壳|暂保留：按现有职责归属复审|js/config/identities/zhong.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|js/config/identities/zhu.js|扩展外壳|暂保留：按现有职责归属复审|js/config/identities/zhu.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|js/config/initialize.js|扩展外壳|暂保留：按现有职责归属复审|js/config/initialize.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|js/config/settingsHelp.js|扩展外壳|暂保留：按现有职责归属复审|js/config/settingsHelp.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|js/config/version.js|扩展外壳|暂保留：按现有职责归属复审|js/config/version.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|6|
|js/content/afunction.js|扩展外壳|暂保留：按现有职责归属复审|js/content/afunction.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|js/content/content.js|扩展外壳|暂保留：按现有职责归属复审|js/content/content.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|js/content/optimization.js|扩展外壳|拆分后归位|按卡牌策略与钩子职责归入 decision；旧入口兼容|与 decision/safety/optimization.js 名称重叠，不能未经行为对照就删除或合并。|B3/高|已读部分实现与调用|2|
|js/content/precontent.js|扩展外壳|拆分后归位|保留宿主 precontent 入口；技能注册和策略分别归位|宿主入口内含多种 AI 全局技能和身份策略；需保持事件注册顺序。|B3/高|已读关键实现|2|
|js/help/help.js|扩展外壳|暂保留：按现有职责归属复审|js/help/help.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|js/shared/utils.js|扩展外壳|暂保留：按现有职责归属复审|js/shared/utils.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|10|
|logs/WORK_TRAIL.js|历史记录|暂保留：按现有职责归属复审|logs/WORK_TRAIL.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|logs/今日修改日志.js|历史记录|暂保留：按现有职责归属复审|logs/今日修改日志.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|package.json|根目录入口与资源|保留资源/规范|package.json|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|score/README.md|对外入口与模块说明|保留资源/规范|score/README.md|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|score/_ARCHITECTURE.md|对外入口与模块说明|后续更新文档|score/_ARCHITECTURE.md|旧分层、数量和运行命令与当前状态存在差异；本轮记录差异，不覆盖原文。|B5/低|已读关键实现|0|
|score/_DOMAIN.md|对外入口与模块说明|后续更新文档|score/_DOMAIN.md|旧分层、数量和运行命令与当前状态存在差异；本轮记录差异，不覆盖原文。|B5/低|已读关键实现|0|
|score/bootstrap/lifecycle.js|启动管理|暂保留：按现有职责归属复审|score/bootstrap/lifecycle.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/bootstrap/moduleExposure.js|启动管理|暂保留：按现有职责归属复审|score/bootstrap/moduleExposure.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/cognition/deepThink.js|认知推理|保留并审查|暂保留 cognition；由 strategy 编排消费|深度思考不是训练器；应先明确改判权限与输入输出，避免为了目录整齐移入网络层。|B3/高|已核对调用与权限约束|1|
|score/cognition/explain/decisionNarrator.js|认知推理|暂保留：按现有职责归属复审|score/cognition/explain/decisionNarrator.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/cognition/explain/explain.js|认知推理|暂保留：按现有职责归属复审|score/cognition/explain/explain.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/cognition/log/cognitiveLog.js|认知推理|暂保留：按现有职责归属复审|score/cognition/log/cognitiveLog.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/cognition/metaCognition.js|认知推理|暂保留：按现有职责归属复审|score/cognition/metaCognition.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/cognition/moodState.js|认知推理|暂保留：按现有职责归属复审|score/cognition/moodState.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/cognition/profile/multiProfile.js|认知推理|暂保留：按现有职责归属复审|score/cognition/profile/multiProfile.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/cognition/profile/profile.js|认知推理|保留并审查|保留；静态覆盖表是否移入 knowledge 后续决定|通过技能标签计算武将画像，和 profiles.js 的配置档案不是同一职责。|B2/中|已读关键实现|1|
|score/cognition/profile/profiles.js|认知推理|整文件迁移候选|score/foundation/config/profiles.js|内容是配置档案快照、保存、切换，不是武将认知画像；保留既有存储键。|B2/中|已读关键实现|3|
|score/cognition/reasoning/gameTheory.js|认知推理|暂保留：按现有职责归属复审|score/cognition/reasoning/gameTheory.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/cognition/reasoning/psychology.js|认知推理|暂保留：按现有职责归属复审|score/cognition/reasoning/psychology.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/cognition/reasoning/riskQuant.js|认知推理|暂保留：按现有职责归属复审|score/cognition/reasoning/riskQuant.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/cognition/reasoning/softMetrics.js|认知推理|暂保留：按现有职责归属复审|score/cognition/reasoning/softMetrics.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/cognition/situationEval.js|认知推理|暂保留：按现有职责归属复审|score/cognition/situationEval.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/decision/CONTRACTS.md|动作决策|保留资源/规范|score/decision/CONTRACTS.md|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|score/decision/analysis/conflictDetector.js|动作决策|暂保留：按现有职责归属复审|score/decision/analysis/conflictDetector.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/decision/analysis/decisionCompare.js|动作决策|暂保留：按现有职责归属复审|score/decision/analysis/decisionCompare.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/analysis/postCheck.js|动作决策|暂保留：按现有职责归属复审|score/decision/analysis/postCheck.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/decision/basic/discardBrain.js|动作决策|暂保留：按现有职责归属复审|score/decision/basic/discardBrain.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/basic/equipBrain.js|动作决策|暂保留：按现有职责归属复审|score/decision/basic/equipBrain.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/basic/judgeBrain.js|动作决策|暂保留：按现有职责归属复审|score/decision/basic/judgeBrain.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/basic/respondBrain.js|动作决策|暂保留：按现有职责归属复审|score/decision/basic/respondBrain.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/basic/targetBrain.js|动作决策|暂保留：按现有职责归属复审|score/decision/basic/targetBrain.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/cardplay/cardPlayBrain.js|动作决策|暂保留：按现有职责归属复审|score/decision/cardplay/cardPlayBrain.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/decision/cardplay/cardStrategy.js|动作决策|暂保留：按现有职责归属复审|score/decision/cardplay/cardStrategy.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/cardplay/costCalc.js|动作决策|暂保留：按现有职责归属复审|score/decision/cardplay/costCalc.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/cardplay/discardOpt.js|动作决策|暂保留：按现有职责归属复审|score/decision/cardplay/discardOpt.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/cardplay/discardStrategy.js|动作决策|暂保留：按现有职责归属复审|score/decision/cardplay/discardStrategy.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/cardplay/equipReplace.js|动作决策|暂保留：按现有职责归属复审|score/decision/cardplay/equipReplace.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/cardplay/equipScarcity.js|动作决策|暂保留：按现有职责归属复审|score/decision/cardplay/equipScarcity.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/cardplay/judgeZone.js|动作决策|暂保留：按现有职责归属复审|score/decision/cardplay/judgeZone.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/cardplay/keepStrategy.js|动作决策|暂保留：按现有职责归属复审|score/decision/cardplay/keepStrategy.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/decision/cardplay/keepStrategyOpt.js|动作决策|暂保留：按现有职责归属复审|score/decision/cardplay/keepStrategyOpt.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/cardplay/passStrategy.js|动作决策|暂保留：按现有职责归属复审|score/decision/cardplay/passStrategy.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/cardplay/responseAI.js|动作决策|已迁移：保留兼容转发|score/decision/response/responseAI.js|旧入口不再保存独立实现；未确认所有外部调用前不删除。|已完成/低|已实现并有回归测试|1|
|score/decision/cardplay/responseOpt.js|动作决策|暂保留：按现有职责归属复审|score/decision/cardplay/responseOpt.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/cardplay/viewAs.js|动作决策|暂保留：按现有职责归属复审|score/decision/cardplay/viewAs.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/cards/jiedaoEvaluator.js|动作决策|暂保留：按现有职责归属复审|score/decision/cards/jiedaoEvaluator.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/cards/tiesuoEvaluator.js|动作决策|暂保留：按现有职责归属复审|score/decision/cards/tiesuoEvaluator.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/engine/decisionHook.js|动作决策|暂保留：按现有职责归属复审|score/decision/engine/decisionHook.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/decision/engine/decisionRegistry.js|动作决策|暂保留：按现有职责归属复审|score/decision/engine/decisionRegistry.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|7|
|score/decision/engine/decisionTrace.js|动作决策|暂保留：按现有职责归属复审|score/decision/engine/decisionTrace.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/engine/engine.js|动作决策|拆分后归位|保留入口；拆入 decision/context、generation、strategy 及既有 execution/feedback|同一文件集中了宿主钩子、动作生成、评分、策略、模型复查、记录与结算；先确定完整交接再拆。|B3/高|已读关键实现|15|
|score/decision/engine/scoreSelfMod.js|动作决策|暂保留：按现有职责归属复审|score/decision/engine/scoreSelfMod.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/engine/scoreUnify.js|动作决策|暂保留：按现有职责归属复审|score/decision/engine/scoreUnify.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/execution/executionGateway.js|动作决策|暂保留：按现有职责归属复审|score/decision/execution/executionGateway.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|9|
|score/decision/execution/executionGatewayCore.js|动作决策|暂保留：按现有职责归属复审|score/decision/execution/executionGatewayCore.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/feedback/decisionFeedback.js|动作决策|暂保留：按现有职责归属复审|score/decision/feedback/decisionFeedback.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|8|
|score/decision/override/circuit.js|动作决策|暂保留：按现有职责归属复审|score/decision/override/circuit.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/decision/override/compare.js|动作决策|暂保留：按现有职责归属复审|score/decision/override/compare.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/override/discard.js|动作决策|暂保留：按现有职责归属复审|score/decision/override/discard.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/decision/override/index.js|动作决策|暂保留：按现有职责归属复审|score/decision/override/index.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/decision/override/respond.js|动作决策|暂保留：按现有职责归属复审|score/decision/override/respond.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|5|
|score/decision/override/use.js|动作决策|暂保留：按现有职责归属复审|score/decision/override/use.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/decision/relations/relations.js|动作决策|暂保留：按现有职责归属复审|score/decision/relations/relations.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|45|
|score/decision/resource/economy.js|动作决策|暂保留：按现有职责归属复审|score/decision/resource/economy.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/decision/resource/resourceManage.js|动作决策|暂保留：按现有职责归属复审|score/decision/resource/resourceManage.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/resource/resourceTiming.js|动作决策|暂保留：按现有职责归属复审|score/decision/resource/resourceTiming.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/response/compareAI.js|动作决策|暂保留：按现有职责归属复审|score/decision/response/compareAI.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|7|
|score/decision/response/responseAI.js|动作决策|暂保留：按现有职责归属复审|score/decision/response/responseAI.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/decision/response/wuxieEvaluator.js|动作决策|暂保留：按现有职责归属复审|score/decision/response/wuxieEvaluator.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|6|
|score/decision/safety/aiOverride.js|动作决策|暂保留：按现有职责归属复审|score/decision/safety/aiOverride.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/decision/safety/allyExempt.js|动作决策|暂保留：按现有职责归属复审|score/decision/safety/allyExempt.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|5|
|score/decision/safety/damageTransfer.js|动作决策|暂保留：按现有职责归属复审|score/decision/safety/damageTransfer.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/safety/guardRecorder.js|动作决策|暂保留：按现有职责归属复审|score/decision/safety/guardRecorder.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|5|
|score/decision/safety/optimization.js|动作决策|暂保留：按现有职责归属复审|score/decision/safety/optimization.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/safety/rescuePolicy.js|动作决策|暂保留：按现有职责归属复审|score/decision/safety/rescuePolicy.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|5|
|score/decision/safety/targetDiagnostics.js|动作决策|暂保留：按现有职责归属复审|score/decision/safety/targetDiagnostics.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/selection/candidateSelection.js|动作决策|暂保留：按现有职责归属复审|score/decision/selection/candidateSelection.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/decision/skills/skillCardChoiceBrain.js|动作决策|暂保留：按现有职责归属复审|score/decision/skills/skillCardChoiceBrain.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/skills/skillChoiceTransaction.js|动作决策|暂保留：按现有职责归属复审|score/decision/skills/skillChoiceTransaction.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/skills/skillCustom.js|动作决策|暂保留：按现有职责归属复审|score/decision/skills/skillCustom.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/skills/skillPlayBrain.js|动作决策|暂保留：按现有职责归属复审|score/decision/skills/skillPlayBrain.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/skills/skillProgress.js|动作决策|暂保留：按现有职责归属复审|score/decision/skills/skillProgress.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/skills/skillRules.js|动作决策|暂保留：按现有职责归属复审|score/decision/skills/skillRules.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/decision/skills/skillScanner.js|动作决策|暂保留：按现有职责归属复审|score/decision/skills/skillScanner.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|5|
|score/decision/skills/skillTags.js|动作决策|暂保留：按现有职责归属复审|score/decision/skills/skillTags.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/skills/skillTiming.js|动作决策|暂保留：按现有职责归属复审|score/decision/skills/skillTiming.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/skills/skills.js|动作决策|拆分后归位|保持旧入口；扫描、规则、标签和展示逐项归位|2421 行同时包含技能扫描、画像、收益推导和 render* 展示函数；不能仅按文件名当成单一技能规则。|B3/高|已核对关键实现与引用|20|
|score/decision/state/actionCandidate.js|动作决策|暂保留：按现有职责归属复审|score/decision/state/actionCandidate.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|11|
|score/decision/state/candidateSelection.js|动作决策|已迁移：保留兼容转发|score/decision/selection/candidateSelection.js|旧入口不再保存独立实现；未确认所有外部调用前不删除。|已完成/低|已实现并有回归测试|1|
|score/decision/state/decisionMargin.js|动作决策|暂保留：按现有职责归属复审|score/decision/state/decisionMargin.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|6|
|score/decision/state/decisionTransaction.js|动作决策|暂保留：按现有职责归属复审|score/decision/state/decisionTransaction.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/decision/state/gamePhase.js|动作决策|暂保留：按现有职责归属复审|score/decision/state/gamePhase.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/decision/state/playerSnapshot.js|动作决策|暂保留：按现有职责归属复审|score/decision/state/playerSnapshot.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/state/playerState.js|动作决策|暂保留：按现有职责归属复审|score/decision/state/playerState.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|8|
|score/decision/state/turnStrategicState.js|动作决策|暂保留：按现有职责归属复审|score/decision/state/turnStrategicState.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/strategy/championStrategy.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/championStrategy.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/decision/strategy/characterPolicy.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/characterPolicy.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/decision/strategy/characterPolicyCore.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/characterPolicyCore.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/strategy/comboChain.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/comboChain.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|7|
|score/decision/strategy/counterStrategy.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/counterStrategy.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/decision/strategy/identityStance.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/identityStance.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/decision/strategy/intentAlignment.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/intentAlignment.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/strategy/modeStrategy.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/modeStrategy.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|8|
|score/decision/strategy/multiTurnOpt.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/multiTurnOpt.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/strategy/multiTurnPlan.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/multiTurnPlan.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/decision/strategy/multiturn.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/multiturn.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/decision/strategy/objective.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/objective.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/strategy/objectiveCore.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/objectiveCore.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/decision/strategy/pickRecommend.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/pickRecommend.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/decision/strategy/planner.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/planner.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|7|
|score/decision/strategy/recommend.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/recommend.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/strategy/resourceMaximize.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/resourceMaximize.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/strategy/strategicState.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/strategicState.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/strategy/strategicStateCore.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/strategicStateCore.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/strategy/strategist.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/strategist.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|7|
|score/decision/strategy/strategy.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/strategy.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/strategy/strategyBus.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/strategyBus.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/strategy/treeSearch.js|动作决策|暂保留：按现有职责归属复审|score/decision/strategy/treeSearch.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/threat/threat.js|动作决策|暂保留：按现有职责归属复审|score/decision/threat/threat.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|12|
|score/decision/timing/aoeTiming.js|动作决策|暂保留：按现有职责归属复审|score/decision/timing/aoeTiming.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/timing/duelTiming.js|动作决策|暂保留：按现有职责归属复审|score/decision/timing/duelTiming.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/timing/jiedaoTiming.js|动作决策|暂保留：按现有职责归属复审|score/decision/timing/jiedaoTiming.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/timing/jiuTiming.js|动作决策|暂保留：按现有职责归属复审|score/decision/timing/jiuTiming.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/timing/judgeTiming.js|动作决策|暂保留：按现有职责归属复审|score/decision/timing/judgeTiming.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/timing/shandianTiming.js|动作决策|暂保留：按现有职责归属复审|score/decision/timing/shandianTiming.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/timing/shunshouTiming.js|动作决策|暂保留：按现有职责归属复审|score/decision/timing/shunshouTiming.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/timing/taoTiming.js|动作决策|暂保留：按现有职责归属复审|score/decision/timing/taoTiming.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/timing/taoyuanTiming.js|动作决策|暂保留：按现有职责归属复审|score/decision/timing/taoyuanTiming.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/timing/wuguTiming.js|动作决策|暂保留：按现有职责归属复审|score/decision/timing/wuguTiming.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/timing/wuxieTiming.js|动作决策|暂保留：按现有职责归属复审|score/decision/timing/wuxieTiming.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/tuning/adaptive.js|动作决策|暂保留：按现有职责归属复审|score/decision/tuning/adaptive.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|5|
|score/decision/tuning/decayOpt.js|动作决策|暂保留：按现有职责归属复审|score/decision/tuning/decayOpt.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/tuning/delayOptimizer.js|动作决策|暂保留：按现有职责归属复审|score/decision/tuning/delayOptimizer.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/tuning/endgameOpt.js|动作决策|暂保留：按现有职责归属复审|score/decision/tuning/endgameOpt.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/decision/tuning/orderOptimizer.js|动作决策|暂保留：按现有职责归属复审|score/decision/tuning/orderOptimizer.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/tuning/shaTargetOpt.js|动作决策|暂保留：按现有职责归属复审|score/decision/tuning/shaTargetOpt.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/utility/utilityExplain.js|动作决策|暂保留：按现有职责归属复审|score/decision/utility/utilityExplain.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/utility/utilityMigration.js|动作决策|暂保留：按现有职责归属复审|score/decision/utility/utilityMigration.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/decision/utility/utilityPipeline.js|动作决策|暂保留：按现有职责归属复审|score/decision/utility/utilityPipeline.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/decision/utility/utilityVector.js|动作决策|暂保留：按现有职责归属复审|score/decision/utility/utilityVector.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/foundation/adapt/compat.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/adapt/compat.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/foundation/adapt/gameProfile.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/adapt/gameProfile.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/foundation/adapt/host.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/adapt/host.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|115|
|score/foundation/adapt/terms.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/adapt/terms.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|6|
|score/foundation/config/configSpec.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/config/configSpec.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/foundation/config/util.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/config/util.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|25|
|score/foundation/diag/changelog.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/diag/changelog.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/foundation/diag/health.js|公共基础设施|拆分后归位|候选目标 score/bootstrap/diagnostics.js；诊断工具留 foundation|反向引用 engine.getInstalled，参与已核对的循环引用；先明确状态查询负责人，再解除相互导入。|B1/高|已核对关键实现与引用|4|
|score/foundation/diag/logger.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/diag/logger.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|62|
|score/foundation/diag/perf.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/diag/perf.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/foundation/diag/perfOptimizer.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/diag/perfOptimizer.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/foundation/diag/profiler.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/diag/profiler.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/foundation/diag/selfHeal.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/diag/selfHeal.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/foundation/diag/swallow.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/diag/swallow.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/foundation/i18n/i18n.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/i18n/i18n.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/foundation/io/export.js|公共基础设施|条件迁移|候选目标 score/bootstrap/dataExport.js；序列化工具才留 foundation|直接收集引擎、策略、观察、记忆等业务数据，不属于无业务依赖的底层工具。|B2/高|已读关键实现|4|
|score/foundation/io/exportAll.js|公共基础设施|先确认职责再拆|候选目标 score/bootstrap/dataTransfer.js；界面归 view|全量导入导出需要协调多种业务数据；须区分编排、格式转换和交互。|B2/高|待逐函数确认|2|
|score/foundation/io/mergeExport.js|公共基础设施|待确认|与全量导出一起确定归属，不先合并实现|名称相近不足以证明重复；需比较数据格式、调用入口和兼容约定。|B2/中|仅完成引用盘点|4|
|score/foundation/io/share.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/io/share.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/foundation/runtime/eventBus.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/runtime/eventBus.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|6|
|score/foundation/runtime/extensionPoints.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/runtime/extensionPoints.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/foundation/runtime/globalScanner.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/runtime/globalScanner.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/foundation/runtime/missingModules.js|公共基础设施|拆分后归位|各实现迁入所属业务模块；旧文件仅按需兼容|基础目录内实现了对手预测、团队广播、多回合规划、经济与认知日志；存在第二实现来源风险。|B1/高|已读关键实现|1|
|score/foundation/runtime/modules.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/runtime/modules.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/foundation/runtime/plugins.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/runtime/plugins.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|8|
|score/foundation/runtime/registry.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/runtime/registry.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|8|
|score/foundation/storage/cache.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/storage/cache.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/foundation/storage/quotaGuard.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/storage/quotaGuard.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/foundation/storage/storage.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/storage/storage.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|49|
|score/foundation/storage/storagePaths.js|公共基础设施|暂保留：按现有职责归属复审|score/foundation/storage/storagePaths.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|7|
|score/index.js|对外入口与模块说明|暂保留：按现有职责归属复审|score/index.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/knowledge/cards/cardTags.js|静态知识|暂保留：按现有职责归属复审|score/knowledge/cards/cardTags.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/knowledge/counters/mutualRelations.js|静态知识|暂保留：按现有职责归属复审|score/knowledge/counters/mutualRelations.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/knowledge/exchange/exchange.js|静态知识|暂保留：按现有职责归属复审|score/knowledge/exchange/exchange.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/knowledge/profiles/templates.js|静态知识|暂保留：按现有职责归属复审|score/knowledge/profiles/templates.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/knowledge/tables/elementAccess.js|静态知识|暂保留：按现有职责归属复审|score/knowledge/tables/elementAccess.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/knowledge/tables/value-tables.js|静态知识|暂保留：按现有职责归属复审|score/knowledge/tables/value-tables.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|6|
|score/model/calibrate/calibratorPanel.js|模型与学习|整文件迁移候选|score/view/dashboard/calibratorPanel.js|校准面板属于展示，算法继续留在 model/calibrate。迁移前核对所有动态入口。|B2/中|待完整函数复核|2|
|score/model/calibrate/decisionCalibrator.js|模型与学习|暂保留：按现有职责归属复审|score/model/calibrate/decisionCalibrator.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/model/features/autoFeature.js|模型与学习|暂保留：按现有职责归属复审|score/model/features/autoFeature.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/model/features/features.js|模型与学习|暂保留：按现有职责归属复审|score/model/features/features.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|12|
|score/model/net/confidence.js|模型与学习|暂保留：按现有职责归属复审|score/model/net/confidence.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/model/net/deepValue.js|模型与学习|条件迁移|候选目标 decision/utility/deepValue.js；静态表是否下沉 knowledge 单独决定|主要内容是规则价值表和价值计算，并引用敌友关系；不是通用神经网络实现。|B3/中|已读关键实现|2|
|score/model/net/mini-model.js|模型与学习|暂保留：按现有职责归属复审|score/model/net/mini-model.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/model/net/modelGuard.js|模型与学习|先确认职责再拆|候选目标 decision/safety/modelGuard.js；展示部分进入 view|属于动作安全复核，但夹带模型状态与展示；不能整文件直接移动。|B3/高|待逐函数确认|6|
|score/model/net/modelHotSwap.js|模型与学习|保留兼容入口|保留原位兼容，未来随 modelState 拆分更新转发|源码说明已合并到 modelState；不可误当成第二套模型状态直接删除。|B4/中|已核对关键实现与引用|2|
|score/model/net/modelState.js|模型与学习|拆分后归位|保留模型状态核心；提示迁入 view；训练与跨域编排迁入 model/bootstrap|同一模块包含模型状态、训练调度、冠军策略、记忆更新及 DOM 提示。|B4/高|已读关键实现|6|
|score/model/predict/deckPredict.js|模型与学习|暂保留：按现有职责归属复审|score/model/predict/deckPredict.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/model/predict/deckTopPredict.js|模型与学习|暂保留：按现有职责归属复审|score/model/predict/deckTopPredict.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/model/predict/handInference.js|模型与学习|暂保留：按现有职责归属复审|score/model/predict/handInference.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|6|
|score/model/predict/opponentPredict.js|模型与学习|暂保留：按现有职责归属复审|score/model/predict/opponentPredict.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/model/train/archiveRecycle.js|模型与学习|暂保留：按现有职责归属复审|score/model/train/archiveRecycle.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/model/train/autoLearn.js|模型与学习|暂保留：按现有职责归属复审|score/model/train/autoLearn.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/model/train/bandit.js|模型与学习|暂保留：按现有职责归属复审|score/model/train/bandit.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|5|
|score/model/train/crossModeTransfer.js|模型与学习|暂保留：按现有职责归属复审|score/model/train/crossModeTransfer.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/model/train/evolution.js|模型与学习|暂保留：按现有职责归属复审|score/model/train/evolution.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/model/train/labelPolicy.js|模型与学习|暂保留：按现有职责归属复审|score/model/train/labelPolicy.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/model/train/learningLoop.js|模型与学习|暂保留：按现有职责归属复审|score/model/train/learningLoop.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/model/train/learningOptimizer.js|模型与学习|暂保留：按现有职责归属复审|score/model/train/learningOptimizer.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/model/train/localTrainer.js|模型与学习|暂保留：按现有职责归属复审|score/model/train/localTrainer.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/model/train/trainExport.js|模型与学习|暂保留：按现有职责归属复审|score/model/train/trainExport.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|17|
|score/model/weights/defaultWeights.js|模型与学习|保留|原位保留|模型参数资产，不格式化、不改变参数或训练格式。|B0/低|资源保护规则|1|
|score/model/weights/weightPersist.js|模型与学习|暂保留：按现有职责归属复审|score/model/weights/weightPersist.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/model/weights/weights.js|模型与学习|暂保留：按现有职责归属复审|score/model/weights/weights.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|16|
|score/perception/archive/archive.js|观察与记忆|暂保留：按现有职责归属复审|score/perception/archive/archive.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|11|
|score/perception/discover/autoDiscover.js|观察与记忆|暂保留：按现有职责归属复审|score/perception/discover/autoDiscover.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|6|
|score/perception/feedback/elementFeedback.js|观察与记忆|暂保留：按现有职责归属复审|score/perception/feedback/elementFeedback.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/perception/feedback/feedback.js|观察与记忆|暂保留：按现有职责归属复审|score/perception/feedback/feedback.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|6|
|score/perception/feedback/styleFeedback.js|观察与记忆|暂保留：按现有职责归属复审|score/perception/feedback/styleFeedback.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|7|
|score/perception/journal/gameLogStore.js|观察与记忆|暂保留：按现有职责归属复审|score/perception/journal/gameLogStore.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/perception/knowledge/sharedKnowledge.js|观察与记忆|暂保留：按现有职责归属复审|score/perception/knowledge/sharedKnowledge.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/perception/memory/deckMemory.js|观察与记忆|暂保留：按现有职责归属复审|score/perception/memory/deckMemory.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|15|
|score/perception/memory/mem.js|观察与记忆|暂保留：按现有职责归属复审|score/perception/memory/mem.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/perception/memory/memory.js|观察与记忆|暂保留：按现有职责归属复审|score/perception/memory/memory.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|9|
|score/perception/memory/playerMemory.js|观察与记忆|暂保留：按现有职责归属复审|score/perception/memory/playerMemory.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/perception/observer/identity.js|观察与记忆|暂保留：按现有职责归属复审|score/perception/observer/identity.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|14|
|score/perception/observer/observer.js|观察与记忆|暂保留：按现有职责归属复审|score/perception/observer/observer.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|10|
|score/perception/replay/decisionReplay.js|观察与记忆|暂保留：按现有职责归属复审|score/perception/replay/decisionReplay.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/perception/replay/replayAnalysis.js|观察与记忆|暂保留：按现有职责归属复审|score/perception/replay/replayAnalysis.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/perception/stats/aiStats.js|观察与记忆|暂保留：按现有职责归属复审|score/perception/stats/aiStats.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/perception/stats/compareAI.js|观察与记忆|已迁移：保留兼容转发|score/decision/response/compareAI.js|旧入口不再保存独立实现；未确认所有外部调用前不删除。|已完成/低|已实现并有回归测试|1|
|score/perception/team/team.js|观察与记忆|条件迁移|候选目标 score/decision/strategy/teamCoordination.js|实际计算集火、保护等策略收益，并消费威胁与敌友判断；不能仅称为观察。|B3/中|已读关键实现|4|
|score/perception/team/teamBroadcast.js|观察与记忆|待确认|区分观察记录、意图发布与宿主钩子后再定|不得因为位于 team 目录就整组搬迁。|B3/中|仅完成引用盘点|2|
|score/perception/team/teammateIntent.js|观察与记忆|保留并审查|优先保留 perception/team|队友意图读取与推断可留观察侧，需与执行策略分开。|B3/中|仅完成引用盘点|2|
|score/plugins/cognitionPlugin.js|插件装配|暂保留：按现有职责归属复审|score/plugins/cognitionPlugin.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/plugins/enginePlugin.js|插件装配|暂保留：按现有职责归属复审|score/plugins/enginePlugin.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/plugins/index.js|插件装配|暂保留：按现有职责归属复审|score/plugins/index.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/plugins/panelPlugin.js|插件装配|暂保留：按现有职责归属复审|score/plugins/panelPlugin.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/plugins/skillPlugin.js|插件装配|暂保留：按现有职责归属复审|score/plugins/skillPlugin.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/verification/decisionQuality.js|扩展自检|暂保留：按现有职责归属复审|score/verification/decisionQuality.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/verification/layers.js|扩展自检|暂保留：按现有职责归属复审|score/verification/layers.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/verification/professionalReadiness.js|扩展自检|暂保留：按现有职责归属复审|score/verification/professionalReadiness.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/verification/selfCheck.js|扩展自检|暂保留：按现有职责归属复审|score/verification/selfCheck.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|8|
|score/verification/semanticAudit.js|扩展自检|暂保留：按现有职责归属复审|score/verification/semanticAudit.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/verification/verifyAll.js|扩展自检|暂保留：按现有职责归属复审|score/verification/verifyAll.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/view/autoplay/autoplay.js|界面展示|暂保留：按现有职责归属复审|score/view/autoplay/autoplay.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|6|
|score/view/bootstrap/panels.js|界面展示|暂保留：按现有职责归属复审|score/view/bootstrap/panels.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/view/bootstrap/systemButtons.js|界面展示|暂保留：按现有职责归属复审|score/view/bootstrap/systemButtons.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/view/dashboard/brainDashboard.js|界面展示|暂保留：按现有职责归属复审|score/view/dashboard/brainDashboard.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/view/dashboard/championPanel.js|界面展示|暂保留：按现有职责归属复审|score/view/dashboard/championPanel.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|score/view/dashboard/comparePanel.js|界面展示|暂保留：按现有职责归属复审|score/view/dashboard/comparePanel.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/view/dashboard/decisionDashboard.js|界面展示|暂保留：按现有职责归属复审|score/view/dashboard/decisionDashboard.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/view/dashboard/identityVisual.js|界面展示|暂保留：按现有职责归属复审|score/view/dashboard/identityVisual.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/view/dashboard/replayPanel.js|界面展示|暂保留：按现有职责归属复审|score/view/dashboard/replayPanel.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|3|
|score/view/dashboard/stateCards.js|界面展示|暂保留：按现有职责归属复审|score/view/dashboard/stateCards.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/view/panel/aiTools.js|界面展示|暂保留：按现有职责归属复审|score/view/panel/aiTools.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|2|
|score/view/panel/panel.js|界面展示|拆分后归位|保留稳定入口；按设置、诊断、记忆、模型等已有职责分组|4714 行；先盘点面板导出与调用方，界面读取统一接口后再拆，避免重复初始化。|B5/高|已核对关键实现与引用|16|
|score/view/panel/panelTheme.js|界面展示|暂保留：按现有职责归属复审|score/view/panel/panelTheme.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|8|
|score/view/panel/smartPanel.js|界面展示|暂保留：按现有职责归属复审|score/view/panel/smartPanel.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|4|
|score/view/report/charts.js|界面展示|暂保留：按现有职责归属复审|score/view/report/charts.js|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|5|
|score/view/report/report.js|界面展示|保留并解除相互依赖|目录保留；改为消费独立记录读取接口|引擎直接引用战报，战报又直接读取引擎的对局与评分记录。先提取记录读取 seam，再接展示。|B1/高|已核对关键实现与引用|5|
|tests/behavior/_harness.mjs|开发测试|暂保留：按现有职责归属复审|tests/behavior/_harness.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|12|
|tests/behavior/champion_boost.mjs|开发测试|暂保留：按现有职责归属复审|tests/behavior/champion_boost.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/behavior/character_policy.mjs|开发测试|暂保留：按现有职责归属复审|tests/behavior/character_policy.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/behavior/decision_feedback_identity.mjs|开发测试|暂保留：按现有职责归属复审|tests/behavior/decision_feedback_identity.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/behavior/global_tricks.mjs|开发测试|暂保留：按现有职责归属复审|tests/behavior/global_tricks.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/behavior/jiedao.mjs|开发测试|暂保留：按现有职责归属复审|tests/behavior/jiedao.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/behavior/judge_control.mjs|开发测试|暂保留：按现有职责归属复审|tests/behavior/judge_control.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/behavior/strategic_intent.mjs|开发测试|暂保留：按现有职责归属复审|tests/behavior/strategic_intent.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/behavior/tao_rescue.mjs|开发测试|暂保留：按现有职责归属复审|tests/behavior/tao_rescue.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/behavior/tiesuo.mjs|开发测试|暂保留：按现有职责归属复审|tests/behavior/tiesuo.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/behavior/turn_consistency.mjs|开发测试|暂保留：按现有职责归属复审|tests/behavior/turn_consistency.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/behavior/utility_pipeline.mjs|开发测试|暂保留：按现有职责归属复审|tests/behavior/utility_pipeline.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/behavior/wuxie.mjs|开发测试|暂保留：按现有职责归属复审|tests/behavior/wuxie.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/quality/baseline.json|开发测试|保留资源/规范|tests/quality/baseline.json|资源、说明或配置文件，迁移代码时检查关联路径，不自动改变。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/quality/hidden_info_audit.mjs|开发测试|暂保留：按现有职责归属复审|tests/quality/hidden_info_audit.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|tests/quality/scenarios.mjs|开发测试|暂保留：按现有职责归属复审|tests/quality/scenarios.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|1|
|tests/run_config_schema_tests.mjs|开发测试|暂保留：按现有职责归属复审|tests/run_config_schema_tests.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/run_decision_quality_tests.mjs|开发测试|暂保留：按现有职责归属复审|tests/run_decision_quality_tests.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/run_decision_trace_tests.mjs|开发测试|暂保留：按现有职责归属复审|tests/run_decision_trace_tests.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/run_decision_transaction_tests.mjs|开发测试|暂保留：按现有职责归属复审|tests/run_decision_transaction_tests.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/run_execution_gateway_tests.mjs|开发测试|暂保留：按现有职责归属复审|tests/run_execution_gateway_tests.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/run_noname_host_contract_tests.mjs|开发测试|暂保留：按现有职责归属复审|tests/run_noname_host_contract_tests.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/run_p1_training_provenance_tests.mjs|开发测试|暂保留：按现有职责归属复审|tests/run_p1_training_provenance_tests.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/run_phase_aoe_tests.mjs|开发测试|暂保留：按现有职责归属复审|tests/run_phase_aoe_tests.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|
|tests/run_tests.mjs|开发测试|暂保留：按现有职责归属复审|tests/run_tests.mjs|已完成文件内容与字面量依赖扫描；无充分证据支持立即迁移，不能视为已通过职责审查。|B0/待确认|自动盘点，未逐函数认证|0|

## 单文件迁移清单

迁移目标文件前，在 inventory.json 的对应文件项中查看 incoming（读取方）和 imports（依赖）；同时检查动态表达式、窗口接口、插件 props、事件订阅、文件输出路径和测试源码路径。静态入边为零不等于未使用。

## 已知限制

- 采用轻量词法扫描并排除静态声明的注释/测试字符串噪声；不是完整 JavaScript AST，仍可能漏掉特殊写法。
- 动态表达式 import、全局接口、注入函数和事件总线不能仅凭静态图证明可达。
- 循环分组是扫描图上的结构，不等于实际死循环或已证实启动故障。
- 默认保留行仅完成自动盘点，不代表逐函数审查或专业认证通过。
- 没有运行测试、启动游戏或读取持久化训练数据；文件哈希用于固定本次盘点快照。

## 原工作树状态

\`\`\`
M extension.js
 M js/bootstrap/arenaReady.js
 M js/content/precontent.js
 M score/decision/analysis/postCheck.js
 M score/decision/cardplay/responseAI.js
 M score/decision/engine/engine.js
 M score/decision/execution/executionGateway.js
 M score/decision/execution/executionGatewayCore.js
 M score/decision/override/index.js
 M score/decision/override/use.js
 M score/decision/safety/allyExempt.js
 M score/decision/safety/guardRecorder.js
 M score/decision/strategy/championStrategy.js
 M score/foundation/runtime/modules.js
 M score/index.js
 M score/model/train/trainExport.js
 M score/perception/stats/compareAI.js
 M tests/run_execution_gateway_tests.mjs
 M tests/run_tests.mjs
?? js/bootstrap/extensionLifecycle.js
?? js/bootstrap/publicInterface.js
?? js/config/initialize.js
?? score/README.md
?? score/bootstrap/
?? score/decision/CONTRACTS.md
?? score/decision/response/compareAI.js
?? score/decision/response/responseAI.js
?? score/decision/safety/targetDiagnostics.js
?? score/decision/selection/
?? score/decision/state/candidateSelection.js
?? score/foundation/storage/quotaGuard.js
?? score/view/bootstrap/
?? tests/behavior/champion_boost.mjs
?? tests/behavior/decision_feedback_identity.mjs
?? tests/run_noname_host_contract_tests.mjs
?? tests/run_p1_training_provenance_tests.mjs
\`\`\`

