# 最后一次最小生命周期补修

基线：020fd03f24fada65fed09e789474542998000d25；同分支 codex/mobile-performance-443。最终提交见补丁旁 FINAL-COMMIT.txt。

生产改动仅 extension.js（7行新增、4行删除）：保存 v5 的3秒启动定时器，卸载时先取消并置空；定时器执行时再次检查 _extensionDisposed，防止已经排队的旧回调启动；保留动态 import 完成时已有卸载检查及 shadowCore 加载代际保护。两个更新器使用独立 try/catch，不再让前一个清理异常跳过后一个。

没有修改 AI 策略、2V2递归修复、护栏、模型、训练系统、更新器实现或性能模块。

## 测试

使用测试先行：red.log 在020fd03复现“立即卸载后仍startShadow”和“前一个更新器清理抛错跳过第二个”；green.log 的7项全部通过。

新增工具 test-extension-shadow-lifecycle.mjs 执行生产入口/卸载代码和真实shadowCore，用确定性时钟推进到15秒，覆盖：立即卸载、已排队定时器、迟到import、模型读取中卸载、两个更新器各自抛错、五个隔离VM安装/卸载世代。五个VM并非同一缓存ESM实例；真实同页重装另有宿主检查。

已有45个脚本加新增1个，共46个脚本全部 exit=0，见 ../evidence/lifecycle-final-tests.json 和对应日志。含 regressions94、weights637、v3 25、update22、response-lifecycle45、fingerprint13、2V2专项、护栏、晚恢复竞态、面板、v5精确对拍。

真实Chrome156/宿主1.11.7：

- host-repeat-cycle0/1/2：同页连续3轮重新导入扩展入口（静态依赖共享缓存）、安装、立即卸载、实际等待4.5秒；全部通过。
- host-loading-targeted：真实v5文件请求被测试路由暂缓，加载中卸载，再放行请求并等待4.5秒；通过。
- 上述4轮均：目标模块定时器0、窗口监听器0、卸载后模型更新请求0、shadow.started=false、更新API未残留、页面错误0。
- 完整2V2与斗地主均正常结束，最大bestAction深度1、递归警告0、页面错误0；细节见summary.json。随机局面仅做正确性烟测，不作速度对比。

## 资源检查边界

宿主探针以直接调用方归属检查 extension/shadowCore/modelUpdate/policyModelUpdate 的定时器和窗口监听器，并检查 /update/model/ 更新请求。

早期host-immediate/host-loading使用整条调用栈匹配，将由扩展初始化间接启动的既有elementFeedback 600ms定时器一并纳入；原始失败结果保留，后续改为直接调用方归属。该元素反馈定时器仍存在，不属于本次指定路径，没有扩大修改范围。

加载中卸载时，已经开始的v5两文件读取链可继续读完第二个文件；这不是模型更新请求，也没有重新调用startShadow或开启轮询。没有为本次任务修改模型加载器来强行取消既有读取。

本轮不声称整个扩展的所有异步工作已取消；只验证用户指定生命周期路径。Android实机及第二轮报告中的其他限制保持原状。

## 交付

独立Commit包含入口修复、必要测试及结果。dist/mobile-performance-lifecycle-final/ 提供完整分提交补丁、仅运行时代码补丁、提交号和SHA-256。不push、不merge、不发布。未重新制作安装包（本次未要求）。
