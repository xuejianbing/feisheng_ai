# 无名AI v4.4.3 手机端性能专项复审

状态：部分优化已实现，交付源码复审 QA；移动端及全部模式验收尚未完成。真实 2V2 托管未通过，不能宣称“手机卡顿已解决”。

## 基线、工作区和修改边界

- 指定源码基线：`636b636b862d427d8a8d55a764159238c3029c0d`，核对 `VERSION=4.4.3`、BUILD_DATE=2026-10-27。
- 最终运行时代码提交：`00cf19f9939b1654e3b7820224cdc497c9417043`。之后仅提交测试、报告、证据和打包工具；最终交付 HEAD 另写在安装包旁 `FINAL-COMMIT.txt` 和 delivery.json，避免文档自引用提交哈希。
- 分支：`codex/mobile-performance-443`。建议分支 `fix/mobile-performance-4.4.3` 已被另一干净工作树占用，未改写该分支。
- 工作树：`C:/Users/32360/.codex/worktrees/mobile-performance-443-3480/无名AI`。
- 原安装目录位于另一个提交 3edbc6e，已有大量暂存文档；完整保留，没有在那里修改或提交。
- 未 push、merge、发布、改版本、改后端、训练、部署或修改模型权重。浏览器仅使用临时用户上下文和本机只读 HTTP 文件接口；外网请求被拦截。

## 测量方法及证据位置

原始数据、命令和日志都在本目录 `evidence/`；`run-baseline.py` 遍历 tools/test-*.mjs；`chrome-bench.mjs` 提供实际宿主传输及启动测量，`model-bench.mjs` 保存 CDP Trace 和模型微基准。

环境：Windows x64，Chrome 156.0.8078.73，Node 24.14.0，宿主 1.11.7。启动和模型基准通过 CDP `Emulation.setCPUThrottlingRate(rate=6)`；完整托管对局为桌面原速。没有可用 Android/adb，本报告没有真实手机结果。CPU 限速不能模拟 ARM、温控、移动存储和 WebView 调度。

启动对照：同一宿主、空临时浏览器配置、同一扩展版本及模型文件，每次新浏览器/上下文；宿主已初始化并暂停 phaseLoop 后才导入扩展。普通启动各 3 次，慢数据库各 1 次。v5 微基准各 5 次，固定输入和相同 CPU 限速。是冷浏览器缓存，Windows 文件缓存未清理；不声称是冷磁盘。没有热缓存统计或已有真实用户存档性能统计。初次宿主脚本配置缺失导致的失败尝试也保留在 baseline-chrome-1.log，不参与统计。

测量早于运行时代码修改：baseline-tests.json、baseline-model-chrome.json、baseline-trace-*.json 和 mobile-red.log。后续实际宿主基线测量读取另一只读工作树中的原始 636b636 源码，没有用修改版补造基线。

## 启动对照数据

普通冷启动三次（毫秒，原始数据 baseline/final-host-cold*.json）：

- 基线 import：4798.1 / 5649.0 / 5505.7；中位数 5505.7。
- QA import：5005.4 / 4916.2 / 6420.6；中位数 5005.4。波动大，不能据此认定静态导入已提速。
- 基线 content：495.6 / 535.5 / 397.5；中位数 495.6。
- QA content：209.4 / 116.4 / 118.8；中位数 118.8。
- 导入至 content 完成中位数：5903.2 → 5214.8。
- 核心安装 engine:start 至 engine:settle-watch 中位数：57.6 → 56.9；未证明核心安装本身明显加快。
- 测量窗口内扩展资源请求：415 → 408；这是资源请求数，含查询版本差异，并非唯一 ESM 模块数。
- content 后 2.5 秒窗口长任务次数：基线 6/7/6，QA 5/5/6。窗口包含延迟工作，不能只凭次数归因。
- 窗口末 JS heap 中位数约 84.0MB → 86.4MB；没有观察到内存改善。这不是内存峰值，没有持续多局泄漏结论。

慢数据库（indexedDB.open 的成功回调延迟 8500ms，触发生产 8000ms 超时）：

- 基线 content 8383.1ms，总计 12778.3ms；QA content 129.6ms，总计 5653.9ms。
- QA 完成 content 时数据库仍未恢复；不是把 pending 报告成成功。超时与晚到连接关闭另有数据库单测。
- 此处只有单次对照，证明依赖路径被解除，不用于估计设备总体加速比例。

## P1 专项模型恢复

extension.js 不再无条件 await modeModelsReady。modeModelStore 的 classicActiveInfo 在恢复尚未完成或数据库不可用时不暴露活动身份。基础默认权重、hooks 和安全安装顺序保留。

modeTraining 的训练/验证/激活及 durable save/promote/rollback 继续等待 readiness，保持资格、Manifest、版本、质量检查与默认开关。原 revision 守卫保留，恢复快照仅在 revision 未变化时写缓存；同 ID 替换、新保存、新激活不会被晚到读取覆盖。持久化继续以事务完成为成功依据。

每局 beginModeContext 固定 modelStorage 与 specialistVersion。若该局在恢复前开始，本局继续公共模型；恢复完成不会中途换模型，下一局按原资格规则选恢复版本。未额外重复 installHooks。卸载发生在原 content 的 await 期间时，恢复后也不会重新安装引擎。

单测覆盖：延迟恢复、活动身份等待、同 ID 新保存与激活、损坏记录、durable save 等待、提升前守卫、回滚和失败写入保留旧活动版本；实际 modeModelDB 覆盖无 IndexedDB、blocked/retry、事务完成、超时及晚到连接关闭。fixture 中网络尺寸缩小以隔离存储编排，不能当作真实大存档性能数据。

## P1 模块分类及面板

A 类：engine、宿主事件接管、choice/response/override、安全护栏、必要插件及存储保护，保持原顺序；不改变同步 namespace API 为 Promise。

B 类：score/index.js 的诊断 namespace 批量暴露与相关自检仍保留。源码中不少导入与决策模块共用依赖、带自挂载副作用，当前没有充分证明可以安全推迟全部约 40 个模块。此方向没有强制修改，也没有把未做的加载拆分写成收益。

C 类：panelLoader 的全部 25 个面板入口改为按操作加载；同一模块路径共享加载 Promise，首次调用返回可等待结果，已有实现的同步调用仍同步返回；重复调用不重复 import。旧 eager mountPanels 调用契约保持，扩展显式 opt in lazy。panelsReady 表示入口注册完成，panelLoadStatus.mode='lazy'，各行 state=idle/loading/ready/error/disposed，loaded 是实际完成懒加载的入口数；不要把注册完成当作所有代码已载入。

首次打开显示加载提示，失败显示错误；失败加载不会自动无限重试。dispose 使旧回调失效并清理提示；晚到模块的自注册也不能覆盖热重载的新代入口。源码复审发现的两条竞态已各自补 red→green 测试。

实际 Champion 面板在 6x Chrome 中首次打开 74.3ms，再次 8.8ms，单次样本，其他面板尚未做完整真实 UI 矩阵。panel.js 已处于基础引擎静态依赖图内，本轮没有去除该静态依赖，因此不会声称启动完全不解析界面代码。

## P1 v3/v5 模型

v5：共享一个加载 Promise，并发两次加载从 4 次模型读取降为 2 次；加载成功后不再次分配同样的参数数组。反量化按 16384 元素有界分批并让出任务，Float32 写入、乘法顺序和 forward 数学保持不变。未引入 Worker。加载失败保留明确失败，不进入自动解析循环；恢复边界是刷新页面，off/on 不会清除失败 Promise。

shadow：关闭后禁止样本级 v5 推理；加载中关闭或卸载后不能启动轮询，退出清理同时停止刷盘定时器；延迟 reward 回填检查代际，不会在卸载后重建刷盘任务。保留原默认开关与影子用途。

v3：idle 回调执行时检查 mode=off 及 policyModelV3Shadow=false（active 模式仍可预加载），关闭状态不启动后台模型；之后开启时由实际 shadow/apply/预测入口触发一次加载，未就绪仍走原安全降级；再次关闭抑制推理。显式 startLoading 仍为诊断/手动加载 API。未改 client_policy_model_v3.js 权重或数学计算。

模型微基准中位数（毫秒）：

- v5 load：68.5 → 71.8，没有总加载提速结论；分批任务的代价包括调度等待。
- 首次预测：19.7 → 17.4；连续 100 次同步预测：103.4 → 93.8。forward 没有改写，不将这些差异归因于算法优化。
- 原始文件读取和 JSON.parse 分别在每次 read 记录中；宿主原 promises.json 无法拆分时诊断明确记为 read-json；decode 单独记 v5:decode。
- Trace 中连续 100 次同步预测仍产生长任务；本轮没有消除此压力。

v5 使用 13 组固定 130/134 维输入，s42/s456/ensemble 与修改前保存的 golden 精确相等（零容差），并检查 null、短输入、NaN 的原行为和关闭/不可用降级。v5 公开接口仅输出两个种子 value 和 ensemble，没有策略向量/TopK 接口，不伪造该项。v3 原有 25 项和 update 22 项覆盖概率、TopK/缓存重建对拍，按原容差通过。模型文件与权重 SHA 在 QA 清单中，可与基线直接核对。

## P2 决策和诊断

没有削减搜索深度、关闭策略、改变缓存 TTL、跳过合法性检查或改训练标签。未修改候选计算/Planner 数学。当前证据不足以安全复用跨事务 v5 forward，未引入输入身份不明确的缓存。

保留 __DJSC.perfReport()，加入：最多 50 条 longTasks、firstDecisionPerf、最近 60 次 numeric decision timings、最多 160 条扩展资源 timing。阶段只保留 preflight/context/targets/candidates/planner/model/observability/guard/telemetry 数字，不保存玩家对象、隐藏手牌或凭证。相邻相同结果对象标记 reusedResult，其调用不重报旧阶段耗时；这不是完整缓存命中统计。日志输出最多 160 次。PerformanceObserver 不支持时安全降级，卸载 disconnect。

ext:start 明确位于静态 ESM 依赖求值之后。宿主没有改动扩展加载器，本轮不能在该点之前插入可靠业务埋点。测试 harness 用 performance.now() 包围 dynamic import 取得完整 import 耗时；资源 timing 仅代表抓取，不能从中精确拆出 parse/evaluate。longTasks 的 precedingMark 仅是时间关联，不是根因证明。

Node 诊断微基准记录 10000 次数字时序耗时约 3.37–6.83ms，见 diagnostic-overhead-node.json；不能换算为手机开销。真实手机诊断开销仍待验证。

控制台获取：`JSON.stringify(window.__DJSC.perfReport(), null, 2)`；查看面板：`window.__DJSC.panelLoadStatus`。DB 状态通过专项训练中心读取，错误保持可见。

## 回归与真实宿主

基线 33 个 tools/test-*.mjs：32 个成功，policy-model-update 因 Node24 将 UMD 当作 ESM 导致测试只读取 default 导出而失败。仅修正测试以同时识别 globalThis.CLIENT_POLICY_V3，生产权重未改。delivery-tests.json：40 个脚本全部 exit=0。

必需原有项目：regressions 94、weights 637、policy-model-v3 25、policy-model-update 22、response-lifecycle 45、state-fingerprint 13，均通过；10 个 2V2 专项脚本也通过。其余原有卡牌/合作/身份/遥测/边界脚本及 7 个新增性能脚本全部执行。Node 自动回归不替代宿主/手机验证。

真实普通斗地主：两个独立临时上下文完整托管完成，分别 9 回合/27 次用牌/224 次 bestAction 调用，以及 12 回合/40 次用牌/437 次调用，页面错误列表均为空。原速首决策 wrapper 分别 72ms/89ms；随机不同局面，不构成同固定局面的 A/B 性能证明。最近阶段数据见 final-autoplay-phases.json。v3 开关后续修正另通过生产 shadow 入口的两种开关回归，不将此前启动数据宣称为后续精确重测。部分旧模块控制台仍报告 get/_status 未定义；没有借此次任务修改这些非阻断路径。

真实 2V2：final-autoplay-2v2.json 记录 180 秒未结束，仅 3 回合/10 次用牌；候选阶段出现约 11 秒计算及大量 Maximum call stack size exceeded 警告，最长长任务约 44.6 秒。此场景明确不通过。基线同配置也在 180 秒超时（2 回合/6 次用牌、8420 次调用），并出现同样的调用栈警告，见 baseline-autoplay-2v2.json/log。随机牌局不同且部分运行窗口重叠，不能用两局差异估算性能改善，但原版也存在该失败。不能因 10 个单测通过就宣称 2V2 手机性能已通过；未定位完整递归根因前不通过跳过策略或护栏来制造提速。

## 未完成和交付限制

- Android 实机、真正已有大型用户存档、所有专项模型 Manifest 组合的宿主实测未完成。
- 多局同一浏览器资源增长、连续热重载内存峰值、全 25 面板真实首次打开矩阵未完成；目前两场普通斗地主是独立上下文，不能当作连续多局泄漏测试。
- 没有热缓存 A/B、固定牌局多次 bestAction 全动作/目标/评分对拍、v3/v5 全开关组合下的完整低性能宿主决策 Trace。
- 静态导入约 5–6 秒仍存在，B 类批量暴露未拆分；不能将全部静态开销归罪于模型。
- 2V2 的递归/候选长任务仍待根因修复，是继续性能验收的阻断项。

因此本交付是可审查的 QA 改动与证据，不是正式发布候选。用户要求的全部性能验收尚未满足。停止在本地源码复审阶段；不 push、不 merge、不正式发布。

## QA 包与复现

`dist/mobile-performance-443/` 含原版与 QA 两个独立 ZIP、逐文件 SHA-256 清单、SHA256SUMS.txt、安装说明、review.patch 和分提交补丁。包内固定根目录为 无名AI，不含用户模型、用户存档、后端、测试或开发日志。两包用相同过滤条件生成；仅按正式 4.4.3 瘦包规则排除未调用的 client_policy_model_v2.js，源文件未删除。

安装说明强调分离宿主副本和浏览器配置做 A/B；不覆盖原版用户存档，不同时装两个同名扩展。完整打包工具 build-delivery.py 会验证 ZIP 内每个文件的 SHA 和模型文件一致性。最终包校验值以 delivery.json/SHA256SUMS.txt 为准。
