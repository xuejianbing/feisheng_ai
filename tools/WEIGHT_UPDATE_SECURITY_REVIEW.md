# 无名AI 在线权重更新模块 —— 安全性修复与最终验收报告

- 目标仓库：`https://github.com/zziyoo/feisheng_ai`
- 审查基准：`master` @ `23a7279`（执行前已确认本地 HEAD 即 `23a7279`，工作树干净）
- 工作分支：`ziyoo-master`
- 修复后 HEAD：`b52602b`（另含 `c192fdc`、`7f5da05`）
- 测试命令：`node tools/test-weights.mjs`

---

## 一、P0/P1/P2 逐项核查结论

| 编号 | 结论 | 根因 | 修复文件 |
|---|---|---|---|
| P0-1 备份失败仍安装 | **已确认 · 已修复** | `writeBackup()` 返回值被忽略、异常被 `try/catch` 吞掉，且无读回校验；无论成败都 `step('已备份原有模型')` | `js/update/applyWeights.js`、`js/update/updateCore.js` |
| P0-2 恢复覆盖原备份 | **已确认 · 已修复** | `restoreBackup()` 复用 `applyOfficialBundle()`，后者第 1 步即写 `BACKUP_KEY`，把用户原始备份 A 覆盖为当前官方模型 B；成功后还删除 `BACKUP_KEY` | `js/update/modelUpdate.js`、`js/update/applyWeights.js` |
| P0-3 延迟更新静默覆盖新训练 | **已确认 · 已修复** | `PENDING_KEY` 只存 `latest/bundle/savedAt/reason`，无授权基线摘要；`tryApplyPending()` 不重新校验当前模型是否已变化 | `js/update/modelUpdate.js`、`js/update/updateCore.js` |
| P1-1 并发控制不统一 | **已确认 · 已修复** | `_busy` 仅保护 `downloadAndApply()`，`tryApplyPending()` / `restoreBackup()` 无锁 | `js/update/modelUpdate.js`、`js/update/updateCore.js` |
| P1-2 训练状态检测不全 | **已确认 · 已修复** | `canApplyNow()` 只看 `modelState.getState()` 与 A/B 候选，未检查 `localTrainer.isTraining()` | `js/update/modelUpdate.js`、`js/update/updateCore.js` |
| P1-3 事件总线生命周期 | **已确认（比审查所述更严重）· 已修复** | `game:start` 实际仅在插件 `scan()`（装载时一次）发布；`game:end` 仅在 `uninstallScoreEngine()` 卸载时发布（`score/index.js:369`）——**正常局末根本不触发**，更新器的订阅近乎死代码；且 `busClear()` 会清空订阅 | `js/update/modelUpdate.js`、`extension.js` |
| P1-4 版本记录写入失败 | **已确认 · 已修复** | `writeOfficialRecord()` 无返回值、无读回核对，失败也照报成功 | `js/update/modelUpdate.js`、`js/update/updateCore.js` |
| P1-5 导出工具伪装兼容 | **已确认 · 已修复** | 结构版本/数据纪元不符时仅 `info()` 告警后继续组包 | `tools/export-weights.mjs`、`js/update/updateCore.js` |
| P2-1 损坏 vs 本地训练 | **已确认 · 已修复** | 摘要不同即判 `superseded`（"本地训练成果"），未结合结构有效性与训练证据 | `js/update/modelUpdate.js`、`js/update/updateCore.js` |
| P2-2 下载超时 | **已确认 · 已修复** | `_fetchOnce` 在 `await fetch()` 返回后即 `clearTimeout`，正文读取不受超时保护 | `js/update/modelUpdate.js`、`js/update/updateCore.js` |
| P2-3 体积限制 | **已确认 · 已修复** | 无任何下载体积上限 | `js/update/modelUpdate.js`、`js/update/updateCore.js` |
| P2-4 弹窗降级 | **已确认 · 已修复** | DOM 不可用时 `finish(buttons[0].value)`，等价于用户已点"确认" | `js/update/updateUi.js`、`js/update/modelUpdate.js` |
| P2-5 架构元数据校验 | **已确认 · 已修复** | 仅校验参数/维度/字节长度/SHA-256，未校验 `dtype` 与 `architecture` | `js/update/weightBundle.js`、`js/update/modelUpdate.js` |

### 审查结论存在偏差的两处（已用源码证明）

1. **P1-3 的真实问题比审查描述更严重。** 审查认为"`busClear()` 可能清除更新器订阅"。实际核查：`broadcastStart()`（发 `game:start`）只在 `plugins.js` 的 `scan()` 中调用，而 `scan()` 仅在 `score/plugins/index.js:26` 插件装载时执行一次；`broadcastGameEnd()`（发 `game:end`）只在 `score/index.js:369` 的**卸载**流程中调用。真正的局末通道是 `game.on("gameOver", …)`（`engine.js:1946`、`panel.js:4683`）。因此 `tryApplyPending()` 在正常局末**从未**被触发——这比"订阅被清空"更根本。
2. **P1-2 的专项模型无需阻塞。** 审查提示"检查专项模型训练是否实际修改共享主模型"。核查 `modeTraining.js` / `modeModelStore.js`：专项模型使用独立存储（`djsc_mode_models_v1`）与独立实例，不修改共享主模型，故**有意不阻塞**；而 `localTrainer` 会原地改写共享主模型，**必须阻塞**（已加）。

---

## 二、每项问题的根因与修复文件

见上表"根因""修复文件"两列。核心新增模块：

- **`js/update/updateCore.js`（新增，398 行）**：纯逻辑、无宿主依赖，供生产代码与 Node 测试**共用同一实现**（避免"理想化假对象掩盖宿主差异"）。承载：备份记录构造/校验、待生效记录构造/判定、事务锁、应用闸门、官方记录构造/校验、导出兼容判定、存档完整性分类、下载体积上限、超时安全 fetch。

---

## 三、每批次 Commit Hash

| 批次 | Commit | 内容 |
|---|---|---|
| A | `c192fdc` | P0-1 备份失败仍安装；P0-2 恢复覆盖原备份；P0-3 延迟安装覆盖新训练 |
| B | `7f5da05` | P1-1 事务锁；P1-2 训练状态；P1-3 事件生命周期；P1-4 记录事务一致性；P1-5 导出兼容 |
| C | `b52602b` | P2-1 损坏识别；P2-2 超时；P2-3 体积；P2-4 弹窗降级；P2-5 架构校验 |

---

## 四、自动化测试执行结果

```
node tools/test-weights.mjs
==== ALL PASS (213) ====
```

- **断言总数：213；失败：0。**
- 原有 88 项**全部保留并通过**；新增 125 项。
- 新增分段：备份安全、恢复事务、待生效判定、事务锁、应用闸门、官方记录事务、导出兼容、存档完整性分类、下载超时与体积、弹窗降级安全、模型语义拒绝用例。
- **未验证（如实标记）**：`tools/test-weights.mjs` 中的"导出工具 CLI 冒烟测试"因当前沙箱禁止 spawn 子进程（`EBUSY`）而 **SKIP**，需在常规开发机执行 `node tools/test-weights.mjs` 复验；导出工具的判定逻辑已由纯函数 `evaluateExportCompatibility` 直接覆盖，且手工 CLI 验证通过（见下）。
- 手工 CLI 验证（本次已执行）：`--from-default` 成功；结构版本不符 → 退出码 1；数据纪元过旧 → 退出码 1；`--allow-epoch-migration` 缺 `--migration-note` → 退出码 1；显式迁移 → 成功；`--verify` → 通过。

---

## 五、旧用户模型、备份与训练数据的兼容性结论

| 对象 | 结论 |
|---|---|
| `djsc_weights_v3`（活跃权重存档） | **未改动**，格式与写入路径完全不变 |
| 训练样本 `djsc_ai_db` / 专项模型 `djsc_mode_models_v1` / 候选与统计 | **未触碰** |
| 旧版备份记录（无 `version`/`digest`/`schemaVersion`） | 仍可恢复：按结构（长度/类型）校验；因缺少摘要与结构版本，**不做摘要/版本比对**，并在恢复前提示"备份缺少版本信息"。恢复成功后保留原备份 |
| 旧版待生效记录（v1，无授权基线摘要） | **安全丢弃**并提示"请重新下载安装"，避免在无基线可核对时覆盖用户模型 |
| 旧版官方记录（无 `version` 字段） | 形状校验不变，仍被识别为有效记录 |
| `MODEL_SCHEMA` / `DATA_EPOCH` / 权重协议 | **未修改**（未改动任何版本常量） |
| 内置默认权重 `DEFAULT_WEIGHTS.dv=4 < DATA_EPOCH=5` | 既有不一致保持原样（未修改）；`--from-default` 导出按"当前结构基线模型"可验证处理，无需人工指定纪元 |

---

## 六、更新失败 / 恢复失败时的行为说明

**更新（安装官方权重）失败**
- 备份写入失败 / 抛异常 / 读回失败 / 内容损坏 / 摘要不符 → **在替换任何权重之前即中止**，模型完全未改动，明确提示"已中止（未做任何改动）"，**不谎报已备份**。
- 真正替换前的最终状态复核不通过（对局/训练中）→ 中止，未做任何改动。
- 写入 / 落盘读回 / 在线核对 / 前向自检失败 → 回滚到更新前模型并再次核验在线与存档；未能完全确认时如实告知"请重启后检查"。
- 权重应用成功但**版本记录未持久化** → 回滚旧权重与旧记录，提示"更新未完成"。

**恢复备份失败**
- 恢复前校验（参数/结构/摘要/版本兼容）不通过 → **直接拒绝，原备份保持不动**。
- 恢复中途失败 → 回滚到恢复前模型；**原备份未被修改**。
- 恢复成功 → 仅清除官方记录，**保留原备份**，可反复恢复（幂等）。

**延迟任务（待生效）**
- 当前模型与授权基线不一致（期间训练晋升 / 手动恢复 / 重置）→ **重新征询用户**；用户选择保留则安全取消，绝不静默覆盖。
- 该版本已安装 / 被更新版本取代 / 目标已生效 / 结构或纪元不兼容 → 安全跳过。

---

## 七、需要开发者配合的服务器与工作台事项

1. **服务器（未擅自修改、未假定已部署新协议）**：需按 `tools/MODEL_UPDATE_PROTOCOL.md` 静态托管
   `/update/model/manifest.json` 与不可变权重包文件；当前该地址返回服务自身状态 JSON，客户端据此判定
   `unsupported` 并安全降级（已实测）。
2. **权重包新增必填语义字段**：`dtype` 与 `architecture` 现为**强制校验项**（同维度但语义不符将被拒装）。
   用 `tools/export-weights.mjs` 生成的包已自动携带，无需额外操作；**若服务端已有历史包，需重新导出**。
3. **工作台导出行为**：仅新增"兼容性硬校验"（默认拒绝结构/纪元不符）。历史训练产物 `dv` 低于目标纪元时
   需显式 `--allow-epoch-migration --migration-note "<依据>"`。**上传、打包、发布流程未改动。**
4. **整包发布**：保持"完整安装包由原工作台生成、交流群分发"，游戏内只更新模型权重。

---

## 八、仍需进行的真实环境测试（本次未验证，如实标记）

| 环境 | 项目 | 状态 |
|---|---|---|
| 常规开发机 | `node tools/test-weights.mjs`（含导出工具 CLI 冒烟测试） | **未验证**（沙箱禁 spawn，已 SKIP） |
| Windows 无名杀客户端 | 真实下载 → 校验 → 应用 → 重启仍生效；备份/恢复/待生效全链路 | **未验证** |
| Android WebView | 同上；重点验证 `localStorage` 配额、`AbortController` 可用性、弹窗渲染 | **未验证** |
| 浏览器 | `fetch` 跨域/超时、`crypto` 无关（自带 SHA-256） | **未验证** |
| 服务器端到端 | 权重包上传 + 客户端下载应用（需服务端先按协议托管） | **未验证** |
| 故障注入（真机） | 写入失败/断电/配额不足时的备份与回滚 | **未验证** |

> 说明：本报告不宣称"服务器端到端在线更新已验证"。自动化断言覆盖的是可静态验证的纯逻辑与编排分支。

---

## 九、是否具备提交正式 PR 的条件

**具备。** 依据：

- 13 项问题全部确认并修复，每项均有对应自动化测试；
- 三批次独立提交，批次内未修改任务范围外文件（改动仅限 `js/update/*`、`extension.js` 卸载钩子、`tools/*`）；
- 未改动 `MODEL_SCHEMA` / `DATA_EPOCH` / 已有权重协议 / 训练存档格式；
- 未触碰评分、训练、预测等无关功能（`score/` 下除无改动外的模块均未变更）；
- 原有 88 项测试继续通过，累计 213 项全通过；
- 新增保护措施均有对应测试（含故障注入：写入返回 false / 抛异常 / 读回失败 / 内容损坏 / 恢复中途失败 / 重复恢复 / 重启后摘要变化 / 超时 / 体积异常 / JSON 非法 / DOM 不可用等）。

**建议在 PR 描述中注明**：Windows / Android / 浏览器 / 服务器端到端尚未真机验证；导出工具 CLI 冒烟测试需在常规开发机复验。

---

## 最终验收底线对照

| 底线 | 达成 |
|---|---|
| 任何备份失败都不能静默丢失用户训练成果 | ✅ 备份失败即中止、不谎报、模型未改动 |
| 任何未授权的延迟任务都不能覆盖已变化的用户模型 | ✅ 生效前比对授权基线摘要，不一致重新征询 |
| 同一时刻不能存在两个修改主模型的更新事务 | ✅ 统一事务锁 |
| 不能将下载成功、内存应用成功和持久化成功混为一谈 | ✅ 逐层读回核对，记录失败即回滚 |
| 不能因为错误恢复导致备份被覆盖 | ✅ 恢复为独立事务，不写备份，成功也保留 |
| 不允许用修改模型版本常量掩盖结构不兼容 | ✅ 结构/语义不符一律拒绝，未改任何版本常量 |
| 保持完整安装包仍由原工作台生成、交流群分发 | ✅ 未改动打包/上传/发布 |
| 不影响原有 AI 推理和训练功能 | ✅ 未改动 `score/` 任何模块 |
