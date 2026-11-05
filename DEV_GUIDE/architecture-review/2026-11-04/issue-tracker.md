# 无名AI问题表归档

归档于独立草稿 PR；以下保留阶段记录，最新状态以文末第五轮和[交接稿](README.md)为准。只归档问题，不创建远端 Issue。历史“未提交/待协议确认”描述的是当时状态。

## 结构迁移期间待处理问题

以下源码路径相对于仓库根目录。位置使用函数名和特征编号定位，避免迁移后行号失效。四组字段不一致已从源码确认；对真实对局和现有模型效果的影响尚未实测，不宣称已造成训练数据污染。

| 编号 / 优先级 | 问题与证据 | 影响与处理阶段 | 验收条件 / 状态 |
| --- | --- | --- | --- |
| B1-F01 / P1 | `score/model/features/features.js:112–113维` 读取 focusCount/protectCount；`score/perception/team/teamBroadcast.js:legacyTeamFeatures.getStatus` 返回 messageCount/hasFocus/hasNeedPeach。 | 缺失字段按 0 进入模型；B4 明确集火/保护的计数含义，不能直接把布尔值改名冒充计数。 | 构造有集火/保护的样本，验证两维及其来源；比较旧模型输入兼容性。**待修复，本轮只登记**。 |
| B1-F02 / P1 | `features.js:114–115维` 读取 r1/r3；`score/decision/strategy/multiturn.js:legacyPlanFeatures.plan` 返回 turns/firstTurn/aggression。 | 两个未来收益维度缺省为 0；B4 先定义收益单位，不能将进攻倾向当作收益。 | 一回合与三回合收益可独立验证；旧样本/权重需评估版本兼容。**待修复**。 |
| B1-F03 / P1 | `features.js:116–117维` 读取 handValue/equipValue；`score/decision/resource/economy.js:legacyEconomyFeatures.evaluate` 返回 cardBalance/damageBalance/efficiency。 | 牌价值维度缺省为 0；B4 确定唯一价值来源并审核归一化，不能用净张数替换价值。 | 已知手牌和装备得到预期特征；历史样本不覆盖，新语义单独评估。**待修复**。 |
| B1-F04 / P1 | `features.js:118–119维` 读取 cognitiveLog.stats 的 confidence/conflicts；引擎装配的 `score/cognition/log/cognitiveLog.js:cognitionStats` 返回 total/byLevel/byLevelRate/byIntervention。 | 正式装配时这两维缺省为 0；B4 区分模型置信度和认知日志统计，再指定权威接口。 | 通过正式装配链验证输出及维度；评估特征版本与重新训练要求。**待修复**。 |
| B1-L01 / P2 | `score/foundation/runtime/plugins.js` 尚无异步安装期间卸载的并发约定。 | 非本批重复安装修复范围；最终生命周期联调前处理。 | 人为阻塞 onInstall 后卸载，验证完成后的安装状态和资源清理。**待专项验证**。 |
| B1-L02 / 验收项 | B1 已过 Node 测试，尚未完成真实游戏中的禁用、重新启用以及执行→反馈全链路。 | B5 宿主联调；Node 通过不能替代游戏验收。 | 记录实际版本、加载/卸载结果及反馈关联结果。**待联调**。 |
| B2-F01 / 撤销误报 | 重新核对 `main@cd3f23f:score/foundation/io/exportAll.js` 和现 `score/view/dashboard/exportPanel.js`，一键导出使用内联顺序调用，从未引用 `_exportAllThree`。 | 原登记的“源码确认缺失定义”不成立。实机点击一键导出生成三个包、五个文件，保存在隔离目录。 | **撤销误报**；未添加不存在的函数。证据见 B5 报告与 sandbox-files。 |

中文审查备注：B1 的职责归位未修正上述输入语义。B2 只迁移职责与引用；不更改特征值、不迁移或清除历史训练数据。上述问题进入 B4 前必须逐项复核；未完成不得标记关闭。

## B3 迁移后的收尾与验收项

| 编号 / 优先级 | 剩余事项及源码位置 | 关闭条件 / 状态 |
| --- | --- | --- |
| B3-A01 / 结构项 | 候选生成现只枚举/去重；skillCandidateScore/cardCandidateScore/equipCandidateScore 返回单候选，candidateValuation 持有估值缓存，scoreEvents 持有真实事件动量。 | 模块连接与状态共享断言通过，旧评分算法不变。**所列结构项已完成；真实宿主验收仍见 B3-V01**。 |
| B3-A02 / 结构项 | 台账归 scoreLedger，宿主钩子归 hostHooks，日志归 decisionRecords/playerActionLog，结算归 gameSettlement，七类观测归 decisionObservations；技能拆成 skillSourceTags/skillProfiles/skillAdvice，显示归 skillPresentation。 | 旧接口与统一清缓存仍可用，主回归通过。**所列结构项已完成；不代表整个项目验收完成**。 |
| B3-V01 / 验收项 | 新主动链、旧宿主十一组技能、护栏面板在 Node 下已检查；实际浏览器加载、动作生效及取消/换局链路未验证。 | B5 真实宿主联调，核对建议→实际执行→同 decisionId 反馈；不以正常函数返回代替生效确认。**待联调**。 |
| B3-D01 / 既有技术债 | 隐藏信息基线中的铁索枚举现位于 `decision/scoring/cardCandidateScore.js`，决斗护栏精确查询位于 `decision/safety/modelGuard.js`。 | 仅更新原技术债路径，仍为原有 8 项的一部分；没有修复、没有新增豁免。**未关闭**。 |

本批校验记录：最终 npm test 通过；首轮 AOE 检查的旧文件调用点断言已随实现路径迁移修正。已通过不代表本表未关闭项已解决。

## B4 结构处理记录

- **已实施并通过 Node 回归**：唯一状态机/候选槽、候选副本训练、快照护栏、冠军回流/局末学习、界面提示/推荐、校准历史分别归位；新旧模型入口函数同一性、完整快照与校准历史共享有断言。
- **数据保护**：沿用 djsc_model_state v2、旧热更迁移逻辑、历史校准键、标签及训练格式；本轮没有执行真实训练、清理真实样本或改写现有权重。
- **B1-F01–F04 继续开放**：读取方仍分别期待计数、未来收益、牌价值、模型置信/冲突数；旧提供方字段不具备同一含义。需要先定义语义和版本兼容，不能直接改字段名或补零冒充修复；本次只做结构，不改变这些输入。
- **B4-V01 / 待联调**：B5 需在真实宿主验证模型加载、手动训练回调、A/B 换入/恢复、晋升/丢弃和面板读取。当前自动化覆盖通过不等于这些界面流程已验收。
- 首轮 B4 加载发现推荐文本迁移范围误选造成语法错误，已恢复正确函数边界并重新通过完整测试。问题已修正，不作为未关闭运行缺陷保留。

## B5 首轮真实宿主联调（2026-11-04）

使用仓库当前本地代码，核心只读映射到独立 localhost 地址；写文件和新训练样本均限定在测试环境。实际 `lib.version` 为 **1.11.7**，不能当作 1.11.6.1 的兼容验收。

| 编号 / 优先级 | 已证实原因、修复位置 | 验证与状态 |
| --- | --- | --- |
| B5-F01 / P1 | `view/panel/panel.js:uninstallDebugBridge` 删除整个 `window.__DJSC`，丢失其他模块注册的面板和校准别名。改为仅恢复本桥拥有且未被后来写入覆盖的成员。 | 实机重复安装不重复包装、卸载恢复原方法、重装成功；重装后四个面板入口及 `calibrator.stats` 均存在。Node 覆盖共享对象及后来写入保留。**已修复本次复现**。 |
| B5-F02 / P2 | `foundation/runtime/globalScanner.js:scanPlayerPrototype` 扫描时执行 DOM getter，触发 Illegal invocation 后返回空列表。改读属性描述符并跳过访问器。 | Node 验证 getter 未执行；真实宿主扫描从 0 恢复到 510 个方法。**已修复**。 |
| B5-F03 / P2 | 校准和导出面板未应用已有面板定位规则，被核心全局 div 样式挤成竖排。`view/dashboard/calibratorPanel.js` 使用 styleUtilityPanel，`exportPanel.js` 使用 openUtilityHtml。 | 实机两个面板可读、可关闭；一键导出实际生成文件。**已修复本次复现**。 |
| B5-F04 / P1 | `decision/safety/modelGuard.js` 使用 game 却未从 host 导入；异常被捕获后将合法目标当成缺失。补齐已有宿主适配导入。 | 修复前 44 次检查全因 TARGET_MISSING 拦截；新对局修复后 16 次检查、0 次拦截。Node 在无全局 game 时验证有效目标。**已修复本次复现**。 |
| B5-F05 / P1 | `decision/execution/hostHooks.js` 的用牌/技能执行前快照遗漏事务 id；`decision/analysis/postCheck.js` 使用 game/_status 却未导入，快照为空。统一调用 `decisionEffects.js:captureExecutionSnapshot` 传 tx.id，并补齐宿主导入。 | Node 从真实快照入口走到 postCheckAfter，验证幂等快照和相同 id；独立新对局 1 次 Commit、1 条 source=real 样本、1 次反馈回填，样本 id=dtx_mw2r8afx_5、fbAsync=true、commitErrors=0。**已修复本次复现，不代表所有动作类型覆盖**。 |
| B5-V01 / 待验证 | 首轮真实测试已覆盖加载、重启、校准/导出面板、一个真实用牌样本的执行→反馈。 | B1-L02/B3-V01 **部分完成**；技能、响应、取消、换局及长局仍需专项证据。最终观察 mismatched=3、expired=1：未看到错误 Commit，但拒绝的具体动作原因尚未逐条追踪，不能宣称全部匹配正确。 |
| B5-V02 / 待验证 | B4-V01 的真实手动训练、A/B 换入/恢复、晋升/丢弃及导入还原。 | **未完成，保持开放**。Node 生命周期断言不能替代实机结果。 |
| B5-V03 / P2 待确认 | 测试核心 1.11.7 的 writeFile 输出文件名未带界面显示的扩展名；测试文件列表暂未合并沙箱写入目录。 | 仅确认文件实际写入；后者为测试服务局限。尚未确认前者对目标版本导入的影响，不改正式导出格式。 |

最终 npm test 通过：主门禁 **1899** 项，AOE 31、追踪 24、事务 33、配置 130、网关 59、质量 57 项断言通过。既有隐藏信息欠账 8 项、行为欠账 1 项不变；B1-F01–F04 和 B1-L01 继续开放。测试地址旧模块缓存曾导致一次缺少新导出的加载错误；更换全新 origin 后消失，不记为当前源码错误。

原始记录：`evidence/runtime-excerpts.jsonl`。可读报告：`index.html`。未修改游戏本体、正式安装扩展或原有训练数据，未提交、推送或创建 PR。

## B5 第二轮：动作关联与换局专项

| 编号 / 优先级 | 证据与影响 | 最小修复与验收状态 |
| --- | --- | --- |
| B5-F06 / P1 | `executionGatewayCore.js:confirmExecutionFromHostEvent` 在 await 结束后提交/取消“玩家当前 pending”，没有绑定启动时事务。同玩家旧技能事件未完成时换成同名新事务，旧完成事件会写入新事务；旧取消/拒绝会删除新事务。reset 后新局也可复现。新增测试修复前 **8/71 断言失败**，不是从计数猜测。 | 入口捕获事务 id，await 完成或拒绝后重新核对；用牌/技能/结束选择三个调用点显式传原 id；异步取消支持按 id 限定。修复后网关 **80 项通过**，覆盖旧事件完成、取消、拒绝、换局、入口已被替换、过期及旧结束回调。**代码修复及自动回归完成，真实游戏复验待完成**。 |
| B5-V04 / 证据限制 | 第一轮只存聚合状态，没有每次不匹配的推荐动作/实际动作或过期时间。无法还原此前 3 次 mismatch 和 1 次 expiry 的逐条原因；B5-F06 是独立复现的风险，不能声称就是那四次的原因。 | 隔离服务新增仅作用于 HTTP 响应的事务观察包装，记录 expected/actual/id/age/reason；不改磁盘事务实现和游戏本体。新实机追踪尚未开始，页面首次启动需用户接受 GPLv3 协议。 |
| B5-V05 / 待实机 | 真实 Player.useSkill / respond / 取消事件的受控场景已备好，回调只计数，不伪造训练样本。 | **尚未执行**；不把脚本存在当作验证通过。GPLv3 确认前保持暂停。自然选牌、完整训练链及换局还需要实机证据。 |

- 五秒 TTL **未调整**。固定时钟验证超过 TTL 后不会 Commit，不产生学习写入；是否在正常长动作中丢失有效样本仍待真实事件时长证据。
- 数据兼容：样本、标签、存储键和权重格式未改，现有数据未清理或覆盖。旧数据是否曾受到串写影响无法从聚合计数判断，本轮不追溯改写历史样本。
- 第二轮最终 `npm test` 通过：主门禁 1899，AOE 31、追踪 24、事务 33、配置 130、网关 **80**、质量 57。完整日志 `evidence/transaction-regression.log`。
- 仅改执行网关、用牌/技能钩子、结束选择回调及对应网关测试；没有进入模型参数、评分算法或目录重构。

## B5 第三轮：用户同意协议后的实机结果

用户已明确同意在本地测试页面接受 GPLv3；页面继续加载，实际版本仍为 1.11.7。本轮只执行一次受控技能/取消/响应组合场景，取消断言失败后停止，没有修改业务代码或重试。

- **通过的前置检查**：真实 Player.useSkill 返回时 Commit 为 0；事件完成且未取消；测试技能内容确实执行；原事务提交一次。原始记录 `2026-11-04T23:56:08.512Z`：`dtx_mw2rz56d_2`，skill=b5_isolated_probe，ageMs=1995，committed。
- **失败 / B5-F07 / P1**：`host-scenarios.js:35` 对第二个真实事件调用 `cancel(true, null, 'notrigger')`。核心 `noname/library/element/gameEvent.js:625–637` 在第三参数为真时跳过 `_cancelled=true`，但仍 `finish()`；核心自身 `waitNext:283` 也使用此调用。扩展 `executionGatewayCore.js:304–317` 只检查 `_cancelled` 和 finished，无法识别这种取消，实际将第二事务 `dtx_mw2rz6pt_3` 标为 committed（23:56:08.513Z，ageMs=0）。这是受控真实宿主复现，不是已证实自然对局数据污染。
- **测试断言需纠正**：当前第 38 行还要求 `_cancelled=true`，这与核心“不触发通知”的实现不一致。下一次应断言“内容未执行、事务未 Commit、无样本写入”，不能要求核心修改该字段；本轮未修改或重跑测试。
- **未执行**：组合场景在第 38 行停止，后续取消不写入断言、响应测试和换局实机验收均不能标记通过。前一轮 Node 的 80 项通过不覆盖本次真实 cancel 语义。
- **数据边界**：受控事务回调只增加计数，不调用训练记录；本次误 Commit 的受控事务没有生成训练样本。测试技能及 storage 标记已在 finally 恢复，游戏本体未改，已有训练数据未动。

### B5-F07 最小修复建议（待确认实施）

在扩展确认入口、宿主事件启动前，为该事件的 `cancel` 方法增加临时观测：原样转发参数、this 和返回值，只记录“这个事件调用过 cancel”。确认时同时检查该记录与 `_cancelled`；无论是否抑制取消通知，只取消同 id 事务，不 Commit。结束时仅恢复自己设置的包装，不动核心原型。不能用技能历史有无作通用证据：核心对 direct/log=false 技能可不写 useSkill 历史。

回归应使用真实事件的两类 cancel（普通/不触发通知），分别核对内容执行次数、原事务状态和学习写入；保留 B5-F06 的晚结算/换局保护。样本格式和旧数据不变，不追溯清洗未知历史数据。完成前 B5-F07、B5-V05 和 B5 整体验收保持开放。

## B5 第四轮（2026-11-05）：取消修复与受控宿主复验

- **B5-F07：已修复并关闭本次复现。** `executionGatewayCore.js` 在等待前临时观测单个事件 cancel；参数、this、返回值及宿主取消标记保持原样；最后一个确认者完成后恢复自己拥有的方法。取消、失败仍只处理原事务编号；不修改核心原型。
- 新增网关回归修复前 **3/88 断言失败**，修复后 **88 项通过**；完整 npm test 通过：主门禁 1899、AOE 31、追踪 24、事务 33、配置 130、质量 57。原行为欠账 1 和隐藏信息欠账 8 保留。
- 00:09:09.957Z 的真实核心 1.11.7 受控宿主场景 **13 项全部通过**：正常技能返回不提前 Commit、实际内容执行、一次提交；普通及静默取消不执行内容、不 Commit、恢复 cancel 方法；真实 respond 完成且不误提交主动动作；受控事务不产生训练样本。Commit=1，样本数 1→1，errors=[]。
- 两类取消的事务为 `dtx_mw2sfxhi_5` / `dtx_mw2sfxhi_6`，均记录 host-event-cancelled。测试假设已纠正，不要求静默取消设置 _cancelled；清理仅取消测试自己拥有的 pending，样本断言按测试事务编号过滤自然对局数据。
- **边界**：受控真实 Player/GameEvent + 计数回调，不是自然选牌或完整训练链。B5-V05 的受控技能/取消/响应部分完成；自然场景、换局、长局、训练/A/B、导入还原仍开放，B5 整体不关闭。
- 证据：`evidence/cancel-fix-regression.log`、`evidence/runtime-excerpts.jsonl`；本轮仅修复网关、更新对应测试与文稿，未改模型参数、数据格式、本体或已有训练数据。

## B5 第五轮（2026-11-05）：晚结算与标准重新开始

- **晚完成 / 晚取消实机通过，合计 8 项**：真实 Player.useSkill 在内容中等待，期间同玩家产生同名新事务。旧事件完成或静默取消后，旧事务保持 superseded，writes=0，新 pending 编号保持不变，事件 cancel 方法恢复。案例见 `late-runtime-excerpts.jsonl`：旧 `dtx_mw2sp4se_7`→新 `dtx_mw2sp54t_8`；旧 `dtx_mw2sp54x_9`→新 `dtx_mw2sp5iu_a`。
- **真实标准重开通过**：实际调用 game.over(true)，看到游戏胜利与扩展结算界面；随后点击游戏“重新开始”，重载并选择新角色。00:18:42.184Z：core=1.11.7、over=false、players=8、oldPending=0、pass=true、errors=[]。检查同时排除已记录旧 id 和早于上一局检查时刻创建的 pending。
- **B5-V06 / 待验证**：第三个终局场景的原 GameEvent 等待没有返回，没有取得其完成后的确认结果。没有观测到该受控事务 Commit，但不能由此证明终局回调隔离正确；也不据此认定已发生生产缺陷。重载销毁旧 JS 上下文，不能代替同页复用/继续运行的证明。
- 本轮没有改业务源码或重跑整套 Node 测试。新增晚结算场景和结果证据；实际测试只运行一轮。归档脚本随后给终局等待增加 2 秒记录边界，避免以后无限挂起；**这个有界记录分支本轮未重跑**。当前实机证据来自原脚本，不能称新增超时分支也已验证。
- **B5-O01 / P2 待核查显示**：受控强制结束时，战报出现“合计 26.00（应恒为 0.00）”。只确认界面文字，未核对包含系统池的权威守恒台账；不认定已经发生积分不守恒，也未修改计分。该观察与当前事务验证分开登记。
- 原业务版本与 PR main 均未替换。受控事务回调只计数，未写训练样本；强制结束后的游戏统计/结算只发生在原有隔离地址中。
