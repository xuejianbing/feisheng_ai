# 无名AI v4.4.3 手机性能专项第二轮补修

状态：2V2 原递归路径已修复，ZIP 解压后的真实宿主 2V2 / 斗地主完整托管通过；待手机实机验收。仍有非递归长任务和持续多局验证限制，不能宣称全部手机卡顿消失。

## 提交与边界

起点 aa919bbcb1e09859e8afa318a8765079318c2f91，分支 codex/mobile-performance-443，工作区核对为干净；没有重建官方 master。官方对照 636b636b862d427d8a8d55a764159238c3029c0d。

本轮运行时最终提交 e4c4e422b8265356bbbbfc442841f9ce758328b7，后续仅测试、脚本、报告和证据。交付最终 HEAD 见安装包旁 FINAL-COMMIT.txt / delivery.json；避免文档自引用提交哈希。没有 push、merge、发布、部署或修改宿主磁盘源码、后端、权重、输入维度、训练标签、Manifest、来源认证。上一轮优化和证据完整保留。

## 递归根因与实证

第一轮证据中的候选阶段 11 秒、44.6 秒长任务并非模型解码的证明。本轮在测试 HTTP 响应中临时增加有界深度计数，并只保存第一次 RangeError 的 stack（Error.stackTraceLimit=100）。生产包不含这些探针。

重复链：

`bestAction → bestActionCore → applyVersusSeatPreferences (seatTacticsRuntime.js:87) → 宿主 Get.effect → _djsc_aiOverride.ai.effect.player → _getBA → bestAction`

座次策略为候选查询宿主原有效果。宿主调用扩展软接管的 effect.player，软接管再要求尚未完成的同一 bestAction；当前结果尚未生成，状态缓存也尚未写入，因此缓存不能阻断此反馈。数百层递归后 RangeError 可在 guardCheck 或其他最先分配栈帧的函数抛出；护栏警告是栈耗尽后的症状。catch 放行/吞异常使外层继续遍历并多次重新陷入此链。

完整原始栈见 round2/qa-before.json、official*.json、qa*.json 及日志。栈里的 URL 行号受原文件 CRCRLF 及测试响应探针影响，以函数链定位，不作为当前源码行号。

固定测试采用 seed=443、四个固定武将 jiakui/dc_sunchen/pe_yangyuhuan/sunlang、固定 side 和测试手牌。后续 controlled 工具显式用宿主 createCard/directgain 构造初始测试牌（花色 spade、点数7），不读取用户存档；对局事件、用牌、目标与结算仍由真实宿主执行。完整牌堆随机消耗受异步初始化影响，不能声称逐次随机事件完全相同；不以不同随机后续对局总时间推导加速比例。

完整CPU Profile以无损gzip保存，raw/gzip校验见cpu-profile-manifest.json。

三版本均实际运行：官方与 aa919bb 都复现同一链并超时；修复版及 ZIP 实际完整结束。正式版本与上一轮 QA 深度分别曾达到 751/692；本轮 controlled 三方初始记录逐项相等，其深度397/652/1，修复版深度1；数量受探针和调度影响，不是人工深度上限。

最小修复：新增 decisionEvaluation.js，对 bestAction 的同步 Evaluate 过程设置作用域并通过 finally 释放。仅软接管 _getBA 在该作用域内不再次调用 bestAction，而让宿主 get.effect/value/order 使用本身的评分。该作用域不是策略开关，不缓存部分结果、不修改玩家/队友关系、不削减搜索深度；正常外部调用和下一次独立决策照常执行。测试核心抛错后 scope 也恢复。

失败证据 round2/reentry-red.log（同一次评估进入8次），修复后 test-2v2-reentry.mjs 通过。测试直接执行生产 bestAction wrapper 和 _getBA，模拟原宿主回调边；原有10组2V2专项继续通过。

## 护栏异常安全降级

guardCheck 的 ok=true 继续只表示检查通过。正常规则否决及其现有 canonical fallback 保持；不改变正常候选判断。

- 玩家缺失：ok=false、status=unavailable、E_GUARD_HOST。
- 计算失败（含 RangeError）：ok=false、status=error、E_GUARD_RUNTIME、errorKind、fallback=null；不伪造安全通过。
- 动作缺失/非法候选仍走原规则否决。
- 引擎遇到 unavailable/error 或护栏集成抛错时撤回本次扩展推荐，返回 null，不 stage/执行危险候选，不为故障构造 end，不记录为规则否决或触发规则冷却。
- 硬接管对无推荐按原 pass 路径退出，宿主使用原生选择和合法性检查。内部作用域阻断同一异常回调链重入；不会再从故障护栏反向请求同一 bestAction。

测试覆盖 RangeError、普通宿主读取异常、玩家缺失、非法动作、正常 end 候选，并执行生产集成片段验证错误返回 null 且没有构造 end。失败/通过日志见 guard-red.log 与测试输出。日志保留运行错误，未静默伪装通过。

## 更新器卸载

extension.uninstall 中错误的 installPolicyModelUpdate 改为 uninstallPolicyModelUpdate。更新器保持签名/摘要/尺寸/meta 验证原流程；新增安装幂等、idle/setTimeout 取消、安装代际、请求 AbortController 集合、fetch 超时句柄清理、异步 manifest/payload 写入前代际检查。

即使浏览器不支持取消 idle、fetch 忽略 abort 或请求已经收到 headers，旧回调也不能继续发下一请求、更新状态、写模型缓存或挂载 API。卸载只删除自己拥有的 API，再安装可重新工作。未改正常热更资格和完整性边界。

test-policy-update-uninstall.mjs 先在旧版因缺失卸载接口失败；修复后覆盖已安排回调卸载后执行不发请求、迟到响应不更新状态、重新安装。原 policy-model-update 22 项通过。

## QA 瘦包

上轮5.66MB包误将 artifacts/submodels 归档/训练产物纳入白名单；CHANGELOG 已说明这些资产客户端零引用。运行目录全文检查也没有 artifacts/submodels 引用。它们保留在仓库，未删除。

本轮与官方基本规则一致：assets/css/js/logs/model/score/shadow 和 extension.js、info.json、LICENSE、README.md、CHANGELOG.md。沿用4.4.3瘦包排除的旧 client_policy_model_v2.js，不新增剔除公共或v3/v5模型。两个包使用同样过滤和目录结构。

对照包 388 文件 / 1,837,090 bytes；QA 389 文件 / 约1,841,166 bytes。唯一新增运行文件 decisionEvaluation.js，其他差异是已说明的源码修复；必要 v3/v5 权重和公共模型逐字节与基线一致。精确最终大小、提交和 SHA-256 以 delivery.json 与逐文件清单为准。

静态扫描验证1397条相对模块引用，另结合真实 ZIP 宿主资源加载检查；动态拼接资源不能仅由正则穷尽，因此实际解压托管是必要证据。包内不含 artifacts、用户存档、数据库、Token、后端、补丁或测试日志。

## 实际宿主与性能

Windows x64、Chrome156.0.8078.73、宿主1.11.7；隔离临时浏览器配置，本机只读文件接口，外网被阻断。测试仅在内存 HTTP 响应中暂停首次 phaseLoop 以安装固定测试输入，恢复后运行原宿主事件；没有改宿主磁盘源码来掩盖问题。

1. 官方/aa919bb 的同类固定局面：超时未结束、重复 RangeError；原始官方 controlled 样本候选最大约10932ms，单次决策约10949ms，观测最长任务约22065ms（超过25秒等待阈值是事件循环被同步计算占用，不能准时返回）。详细三版本记录均在 round2/。
2. controlled 修复版补充完整运行 fixed-controlled-full.json：21.33秒、4回合/28次用牌，深度1、递归警告0、页面错误0；initial与官方/aa919bb逐项一致。最初25秒上限的fixed-controlled尝试未结束，原样保留，未作为通过证据。

ZIP 固定局面原速 Profile：20.85秒完整结束，4回合/24次用牌，深度1，递归警告0，页面错误0，扩展资源404为0。最近60个完整计算样本候选最大64ms，决策最大114.2ms；独立长任务探针窗口30条、最大208ms。不能当作全部对局的最坏值。
3. ZIP 6倍 CPU 限速：99.53秒完整2V2，12回合/36次用牌，深度1、递归警告0、页面错误0；末尾50条长任务最大1547ms，最近样本候选最大208ms、决策最大322.2ms，首 wrapper 仍约2569ms。该局初始手牌与原速局不同，不以总耗时比值作加速声明。
4. ZIP 斗地主：28.36秒完整结束，11回合/50次用牌，深度1、递归警告0、页面错误0。
5. Chrome启动 aa919bb 与本轮分别实测一次，见 startup-*.json；未针对本轮改动声称启动加速。上一轮慢数据库解耦、面板懒加载、v3/v5 数值及卸载回归全部保留。

最终干净 ZIP 数据为 zip-fixed-profile.json、zip-2v2-cpu6.json、zip-doudizhu.json。早期 final-2v2/final-doudizhu 两个尝试包含测试 InitScript 过早导入引发的 /noname.js 与 vue 解析错误，已原样保留；修正测试入口后上述 ZIP 场景错误列表为空，不能将早期记录写成零错误。

## 剩余长任务及持续运行限制

原递归长任务已经消失，但6x下仍有秒级任务。继续采集了真实CPU Profile：zip-fixed-profile-cpu.json.gz / profile-summary.json。原速样本除 idle/program 外的热点包含宿主 get/position/itemtype/owner、DOM 查询，以及 deckSyncFromUI（self约132ms，匿名关联函数约120ms）、GC等。它们与原反馈递归是独立压力，尚不能用单一self样本解释6x首决策全部2.57秒；未通过降低策略或跳过检查掩盖。

同一临时上下文重载连续局尝试，第一局完成；第二次启动未到达被测试框架等待的 phaseLoop，工具超时（continuous/reload-series 日志保留）。因此同上下文持续多局内存/监听器增长未验收。多个独立完整局均通过，也不能替代长时间同上下文压力测试。

JS heap 是场景末快照，不是峰值或泄漏证明。两个AI人数场景（2V2四人、斗地主三人）有真实运行，但未覆盖更大AI人数矩阵。Android设备不可用；桌面CPU限速不能冒称手机测试。

## 自动回归与交付

原有40个脚本全部保留；新增重入、护栏故障、更新器卸载、瘦包引用、真实宿主阶段/长任务完整性测试，共45个脚本。最终结果见 evidence/round2-release-tests.json。regressions94、weights637、v3 25、update22、response-lifecycle45、fingerprint13、原有10组2V2均通过；专项持久化/晚恢复竞态、面板懒加载/卸载、v5 13组精确零容差对拍通过。

宿主证据断言也先对旧QA失败记录运行并失败（host-evidence-red.log），再验证ZIP成功场景、深度1、全部8个决策阶段、长任务数据和无缺失扩展资源。

完整补丁 review.patch、仅本轮 round2.patch、分提交 patches、A/B ZIP、SHA256SUMS.txt、逐文件Manifest和安装回退说明在 dist/mobile-performance-443-round2/。ZIP只由已提交目标树生成，每文件hash核验；最终HEAD和包hash见delivery.json。停在源码复审阶段，不push、不merge、不发布、不部署。
