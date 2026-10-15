# 无名AI 在线权重更新 —— 第三轮安全性修复与 PR 前最终验收报告

- 目标仓库：`https://github.com/zziyoo/feisheng_ai`
- 审查基准：`master@bad63d7`（执行前已确认本地 HEAD 即 `bad63d7`，工作树干净）
- 本轮修复后 HEAD：见文末（Commit Hash）
- 测试命令：`node tools/test-weights.mjs`

---

## 一、7 项问题逐项核验结论

| 编号 | 结论 | 根因（源码证据） | 修复文件 |
|---|---|---|---|
| **P0** 连续对局误放行 | **已确认 · 已修复** | `evaluateApplyGate` 中 `if (inGameKnown === true) return inGame ? 拒绝 : 放行;` **短路在 `hasActiveEvent` 之前**，缓存说"不在对局"就再不看实时信号；且开局状态依赖仅装载时触发一次的 `game:start` | `js/update/updateCore.js`、`js/update/modelUpdate.js` |
| **P1-1** 手动安装缺最终摘要复核 | **已确认 · 已修复** | `confirmBeforeWrite: async () => (await canApplyNow()).ok` 只查状态，未比对"当前模型是否仍是授权时的模型" | `js/update/modelUpdate.js` |
| **P1-2** 写入失败未回滚部分修改 | **已确认 · 已修复** | `restoreModel()` 返回 false/抛异常时直接 `return fail(...)`，未检测是否已写入部分数组 | `js/update/applyWeights.js` |
| **P1-3** 记录回滚失败虚报成功 | **已确认 · 已修复** | `_rollbackToBackup()` 中 `if (r.ok) writeOfficialRecordRaw(prevRec);` —— 忽略写入结果，无读回核验；无旧记录时也不确认新记录已删除 | `js/update/modelUpdate.js`、`js/update/updateCore.js` |
| **P1-4** 损坏存档误判为本地训练 | **已确认 · 已修复** | `hasTrainingEvidence = det.isUserModel && Number(obj.trained \|\| 0) > 0` —— 官方权重安装后 `META.trained` 即官方包 `trained`（可 >0），故官方权重被篡改时会被判为"用户训练成果" | `js/update/updateCore.js`、`js/update/modelUpdate.js` |
| **P2-1** 原备份被过早替换 | **已确认 · 已修复** | 安装流程在最终状态复核**之前**就写单槽 `BACKUP_KEY`；取消/失败已销毁原恢复点 | `js/update/applyWeights.js`、`js/update/modelUpdate.js` |
| **P2-2** 体积限制未覆盖流式读取 | **已确认 · 已修复** | `res.text()` 完成后才检查长度；无 `Content-Length` 时仍会先缓冲过大内容；且用 JS 字符串长度近似字节数 | `js/update/updateCore.js` |

**结论：7 项全部确认存在并已修复，无"原本不存在"项。**

### 顺带纠正上一轮的一处错误修复（重要）

上一轮引入的"可靠局末通道 `game.on('gameOver')`" **是死代码**。源码证据：

- `noname/game/index.js` 的 `class Game` **没有 `on` 方法**，全仓库（`noname/`、`src/`）**从未发布 `gameOver` 事件**；
- `engine.js:1946` 与 `panel.js:4683` 中的 `game.on("gameOver", …)` 同样从不触发（靠 `settleWatch` 轮询兜底）；
- 真实生命周期：新一局 = `game.reload()` → `window.location.reload()`（`noname/game/index.js:4575`），
  故 `_status` 天然"每局一份"；每局开始由 `gameEvent.js:431-443` 发布
  `lib.announce.publish('Noname.Game.Event.GameStart')` 并置 `_status.gameStarted = true`；
  局末由 `game.over()` 置 `_status.over = true`（`_status.over` 是 `pauseManager.over.isStarted` 的 getter）。

本轮已改为：门禁以宿主实时信号 `_status.gameStarted` / `_status.over` 为主，
`lib.announce` 每局开始订阅 + 扩展事件总线 + 待生效看门狗为辅。

---

## 二、修复要点与文件

### P0 —— 对局状态门禁（`updateCore.evaluateApplyGate`）
优先级重排为：模型状态 → 训练状态 → A/B 候选 → **实时 `gameStarted`/`over`** →
**活动事件链兜底** → 缓存 `inGameKnown/inGame`。

- 实时信号恒优先于缓存：缓存"不在对局"绝不会放过实时"在对局"。
- `gameStarted === true && over !== true` → 拒绝；`gameStarted && over` → 放行。
- 上局 `over` 残留但本局已开始 → 拒绝（`over` 不得凌驾 `gameStarted`）。
- 菜单/营地（未开局、无活动事件、无缓存）→ 放行，不会永久阻塞非对局界面。
- `modelUpdate._hasActiveEvent()` 要求"活动事件链 + `game.players.length > 0`"，
  避免 `_status.event` 因 `rootEvent` 常驻而误判（这会让玩家在菜单永久无法更新）。
- 所有权重写入前仍执行最终复核（`confirmBeforeWrite`），并叠加 P1-1 的摘要复核。
- 未触碰 `game.over()`、结算流程或引擎事件链。

### P1-1 —— 手动安装最终摘要复核
`downloadAndApply` 用 `buildPendingRecord` 构造授权记录，并在 `confirmBeforeWrite` 中
调用 `evaluatePending`（**与延迟安装同一套授权规则**）：模型变化 → 弹窗重新征询；
已安装/被取代 → 停止；一致 → 继续。

### P1-2 —— 写入失败的部分修改回滚（`applyWeights`）
- 新增 `runtimeStateDiff(live, snapshot, dims)`：比对 10 项参数 + 全部 AdamW 动量/二阶矩 +
  `adamT` + META(trained/accuracy/ready)。
- 写入抛异常/返回 false 时：
  - 未发生任何修改 → 不误报"已回滚"，明确"确认未发生任何变化"；
  - 已发生部分修改 → 立即回滚，并校验参数/优化器/时间步/元数据；
  - 无法确认 → 强制回滚并如实报告风险（绝不提示"旧模型未受影响"）。
- 回滚只用内存快照，绝不触碰用户永久备份；单次失败只回滚一次，避免二次回滚破坏已恢复模型。

### P1-3 —— 版本记录回滚（`updateCore.restoreOfficialRecord` + `combineRollbackStatus`）
- 旧记录写入必须读回核验；无旧记录时必须确认新记录已删除（杜绝"旧权重配新版本记录"）。
- 写入返回 false / 抛异常 / 读回为空 / 读回不一致 → 明确失败。
- `combineRollbackStatus` 区分 `complete` / `partial` / `failed`，UI 分别提示。
- 回滚不完整时：**保留**待生效记录与备份（有恢复价值），置 `hold` 停止自动重试，
  避免存储配额不足时反复重试再次损坏数据。

### P1-4 —— 训练证据判定（`updateCore.computeTrainingEvidence`）
证据来源：① 官方记录中保存的官方训练步数 `trained`（`buildOfficialRecord` 新增该字段）；
② 状态机候选晋升计数 `hotSwapStats().promoted`。
`trained > 0` **不再单独作为依据**；无可靠证据 → 归为 `mismatch`（保守，不自动覆盖，
不删除/重置当前模型），并保留用户手动重新下载官方权重的入口。

### P2-1 —— 备份双槽（暂存 + 长期恢复点）
- 新增 `djsc_weights_backup_staging_v1`（安装事务暂存）；`djsc_weights_backup_v1` 为长期恢复点。
- 流程：写暂存并读回校验 → 应用 → 全部校验通过 → **才**轮换长期恢复点 → 清除暂存。
- 失败/取消/最终复核不通过 → 清除暂存，**长期恢复点完好**。
- 轮换失败 → 不销毁任何数据（原恢复点 + 暂存都保留），如实返回 `backupRotated: false`。
- 旧版单槽备份格式不变，`restoreBackup()` 兼容。

### P2-2 —— 流式下载限额（`updateCore.readBodyLimited`）
- 优先 `res.body.getReader()` 流式读取，**按实际接收字节数**累计，超限立即
  `reader.cancel()` + `ctl.abort()`。
- `TextDecoder(..., { stream: true })` 正确处理跨块切断的多字节 UTF-8。
- 无 `ReadableStream` 的旧环境退回 `res.text()`，并用 `TextEncoder` 计算 **UTF-8 字节数**
  校验（不再用字符串长度冒充字节数），另设 8MB 绝对硬上限。
- 全流程仍处于超时保护内。

---

## 三、自动化测试

```
node tools/test-weights.mjs
==== ALL PASS (312) ====
```

- **断言总数 312，失败 0**；原有 213 项全部保留通过，新增 99 项。
- 新增分段：连续对局状态门禁（P0）、手动安装最终摘要复核（P1-1）、
  写入失败部分修改回滚（P1-2）、版本记录回滚（P1-3）、训练证据判定（P1-4）、
  流式下载体积限制（P2-2），以及备份双槽与恢复点保护（P2-1）。
- 测试直接调用生产函数（`evaluateApplyGate` / `applyOfficialBundle` / `runtimeStateDiff` /
  `restoreOfficialRecord` / `combineRollbackStatus` / `computeTrainingEvidence` /
  `readBodyLimited` / `fetchTextWithLimits` / `classifyIntegrityArchive` / `styledDialog`），
  假对象仅用于故障注入，未替代被审查的安全判断。
- 每条回滚路径同时断言内存参数、持久化存档、优化器/时间步、元数据与备份。
- **未验证（如实标记）**：导出工具 CLI 冒烟测试因沙箱禁止 spawn 子进程（`EBUSY`）标记
  **SKIP**；导出工具的判定逻辑已由纯函数 `evaluateExportCompatibility` 直接覆盖，
  且本轮手工 CLI 复验通过（`--from-default` 成功、`--verify` 通过）。

---

## 四、旧数据兼容性

| 对象 | 结论 |
|---|---|
| `djsc_weights_v3`（活跃权重存档） | 未改动，格式与写入路径不变 |
| `djsc_weights_backup_v1`（旧单槽备份） | 格式不变，`restoreBackup()` 继续可用 |
| 新增 `djsc_weights_backup_staging_v1` | 纯新增键，旧版本无感；不影响既有数据 |
| 旧官方记录（无 `trained` 字段） | 形状校验不变；训练证据判定保守回退为"无证据 → mismatch"，**不会误判为本地训练** |
| 旧版待生效记录（v1） | 安全丢弃并提示重新下载（上一轮已实现） |
| `MODEL_SCHEMA` / `DATA_EPOCH` / 权重协议 | 未修改（未改动任何版本常量） |
| 训练样本 / 候选 / A/B 记录 / 专项模型 | 未触碰 |

---

## 五、失败时的行为（本轮更新）

- **写入失败**：区分"确认未改动 / 已部分修改并回滚 / 无法确认"，绝不虚报完整恢复。
- **版本记录写入失败**：回滚旧权重 + 旧记录；回滚结果分 `complete` / `partial` / `failed` 如实提示。
- **回滚不完整**：保留待生效记录与备份并置 `hold` 停止自动重试；提示重启检查。
- **备份暂存失败**：替换任何权重之前中止，长期恢复点完好。
- **备份轮换失败**：权重已生效，但如实报告"长期备份未轮换（原备份未受影响）"，暂存保留。

---

## 六、未验证风险（需真机/服务器配合）

| 项目 | 状态 |
|---|---|
| 常规开发机 `node tools/test-weights.mjs`（含 CLI 冒烟） | **未验证**（沙箱禁 spawn，已 SKIP） |
| Windows 无名杀客户端：真实对局 → 局末延迟应用 → 连续三局 | **未验证** |
| Android WebView：`ReadableStream` / `TextDecoder` 可用性、`localStorage` 配额 | **未验证** |
| 浏览器：`fetch` 流式读取与超时 | **未验证** |
| 服务器端到端（权重包托管 + 下载应用） | **未验证**（需服务端按协议托管） |
| `lib.announce` 订阅在真实客户端的行为（每局开始触发、卸载解绑） | **未验证**（源码层面已核实 API 与发布点） |

> 本报告不宣称"真机/服务器端到端已验证"。

---

## 七、验收底线对照

| 底线 | 达成 |
|---|---|
| 绝不在进行中的对局替换模型 | ✅ 实时 `gameStarted`/`over` 优先，活动事件链兜底，写入前再复核 |
| 绝不未经重新确认就覆盖已经变化的玩家模型 | ✅ 手动安装与延迟安装共用 `evaluatePending` 授权规则 |
| 任何失败不得破坏用户原有备份 | ✅ 双槽备份，长期恢复点仅成功后轮换 |
| 任何部分回滚不得被报告为完整成功 | ✅ `complete`/`partial`/`failed` 三分，UI 分别提示 |
| 用户本地训练成果始终优先受到保护 | ✅ `mismatch` 保守不覆盖；安装前本地模型单独询问 |
| 整包发布与原有工作台行为保持不变 | ✅ 未改动打包/上传/发布流程与 `score/` 任何模块 |

---

## 八、是否具备提交正式 PR 的条件

**具备。** 7 项问题全部确认并修复，每项均有直接调用生产函数的自动化测试；
改动仅限 `js/update/*`、`tools/*`；未改动 `MODEL_SCHEMA` / `DATA_EPOCH` / 既有存档格式 /
`score/` 下任何模块；原有 213 项测试继续通过，累计 312 项全通过。

建议在 PR 描述中注明第六节的未验证项（真机、服务器端到端、CLI 冒烟）。
