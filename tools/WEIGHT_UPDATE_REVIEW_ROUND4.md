# 无名AI 在线权重更新 —— 第四轮事务安全修复与验收报告

- 目标仓库：`https://github.com/zziyoo/feisheng_ai`
- 审查基准：`master@5f5feda`（执行前已确认本地 HEAD 即 `5f5feda`，工作树干净）
- Commit：批次 A `b2229d9`（P0）、批次 B 见文末（P1/P2）
- 测试命令：`node tools/test-weights.mjs`

---

## 一、四项问题确认结果与根因

| 编号 | 结论 | 根因（源码证据） | 修复文件 |
|---|---|---|---|
| **P0-1** 备份轮换/版本记录失败时恢复错误历史模型 | **已确认 · 已修复** | `_rollbackToBackup()` 从 `storageOps.readBackup()`（**长期** `BACKUP_KEY`）取回滚数据；且轮换失败仍返回 `ok:true`。当"当前模型 A → 目标 B"、轮换失败（长期备份仍是历史 X）、随后官方记录写入失败 → 回滚错误地恢复 X 而非 A | `js/update/applyWeights.js`、`js/update/modelUpdate.js`、`js/update/updateCore.js` |
| **P0-2** 重新授权期间使用旧模型备份 | **已确认 · 已修复** | `applyOfficialBundle()` 先取快照并写暂存备份，**再** await 异步 `confirmBeforeWrite()`；用户重新授权后仍复用最初生成的旧快照/旧备份，导致"实际覆盖 B 却只备份了 A" | `js/update/applyWeights.js`、`js/update/modelUpdate.js` |
| **P1** 恢复备份后官方记录删除失败仍提示成功 | **已确认 · 已修复** | `restoreBackup()` 恢复成功后执行 `removeKey(OFFICIAL_KEY)` **不检查返回值、不读回验证**，直接提示"已还原" | `js/update/modelUpdate.js`、`js/update/updateCore.js` |
| **P2** 待生效 `userAuthorized` 未被强制验证 | **已确认 · 已修复** | `evaluatePending()` 只把 `userAuthorized` 写入记录（`buildPendingRecord`），**从未读取校验**；异常/残留/人为构造的未授权记录可直接进入安装流程 | `js/update/updateCore.js` |

四项全部确认存在，无"原本不存在"项。

---

## 二、关键调用路径

### P0-1 事务一致性
```
applyOfficialBundle(install)
  → 生成 txId；取基线快照；写暂存备份(djsc_weights_backup_staging_v1, 含 txId) + 读回逐项核对
  → 写事务日志 phase=prepared
  →（最终复核返回 rebaseline 时 → 丢弃旧基线并重取快照/重写校验暂存备份）
  → 写权重（部分修改检出 → 回滚本次基线）
  → 落盘/读回/在线/前向校验；写事务日志 phase=weights-written
  → commitRecord：官方记录写入+读回核验；失败 → 回滚模型 + revertRecord 恢复旧记录   【必要提交步骤 1】
  → 写事务日志 phase=record-committed
  → 长期备份轮换（从**本事务暂存备份**写入 BACKUP_KEY + 读回核验）
      失败 → 回滚本次更新前模型 + revertRecord，返回 ok:false            【必要提交步骤 2】
  → 写事务日志 phase=backup-rotated
  → 清理暂存备份 + 事务日志 → 成功
```
- **回滚只使用本次事务的内存快照 / 暂存备份**（带 `txId` 校验），绝不读取可能属于历史事务的长期备份。
- 崩溃恢复 `recoverInterruptedTransaction({storageOps, getBridge, contract})`：
  `prepared`→清理；`weights-written`→用本事务暂存备份回滚；`record-committed`→补做轮换；
  `backup-rotated`→清理；`needsManual`/暂存不匹配→保留全部数据并阻止继续安装。
- 已修复恢复模式误清安装事务暂存备份/日志的问题（两者归属安装事务）。

### P0-2 重新授权安全
- `confirmBeforeWrite` 契约扩展为返回 `{ok, rebaseline}`；`rebaseline` 触发事务内**重建基线**
  （重取运行时快照 → 重写并读回校验暂存备份 → 重新状态复核），上限 2 次，超出即中止。
- 手动安装与待生效安装共用 `evaluatePending` 授权规则与同一重建流程。

### P1 恢复事务
```
restoreBackup()
  → applyOfficialBundle(mode:'restore',
        commitRecord: _clearOfficialRecordVerified(),   // 清除并读回确认不存在
        revertRecord: _restoreOfficialRecord(prevRec))
  → 记录清理失败 → 回滚模型恢复（用本次操作开始前的运行时快照）+ 恢复记录，不提示完整成功
```

### P2 授权强制
- `evaluatePending()`：`pending.userAuthorized !== true` → 返回 `reprompt`（绝不 `apply`）；
  缺失 / `false` / 字符串 `'true'` / 数字 `1` 均不算授权。旧版 v1 记录继续安全丢弃。

---

## 三、组合故障测试

新增/覆盖的关键组合场景（全部断言通过）：

| 组合 | 结果 |
|---|---|
| 旧备份 X + 当前 A + 目标 B：暂存成功、**长期备份轮换失败** | 回滚到 **A**，X 未被覆盖，暂存/日志清理 |
| 长期备份成功、**官方记录失败** | 回滚 A，未轮换长期备份，`revertRecord` 被调用 |
| 官方记录成功、**长期备份失败** | 回滚 A，记录回滚被调用，X 保持 |
| **暂存备份 txId 不匹配 / 摘要错误 / 内容与基线不符** | `verifyStagingForTx` 拒绝使用 |
| 旧长期备份**损坏** | 不影响本次回滚；损坏备份未被用于回滚 |
| 事务日志写入失败 | `journalWritten=false` 如实反馈，事务仍安全 |
| 重启时日志 = `weights-written` | 按本事务暂存备份恢复 A；X 不被覆盖 |
| 重启时日志 = `record-committed` | 只补做轮换，不回滚（权重+记录已一致） |
| 重启时日志 = `prepared` / `backup-rotated` | 仅清理事务数据 |
| 暂存与日志不匹配 / `needsManual` | `action='manual'`，保留全部数据 |
| 恢复中持久化异常（落盘损坏） | 恢复未完成，标记 `needsManual`，暂存保留 |
| A → 确认时训练为 B → 用户拒绝 | 模型保持 B，长期备份/暂存均未动 |
| A → 确认时训练为 B → **重新授权** | 重新取基线；长期备份 = **B**（不是过期 A） |
| 重新授权后模型再次变化（超上限） | 中止并提示"模型反复变化"，未被官方权重覆盖 |
| 恢复成功 + 记录删除失败/抛异常/仍可读回 | 回滚模型恢复与记录，不提示完整成功 |
| 恢复落盘损坏 / 重复点击恢复 | 回滚 / 备份始终完整 |
| 待生效 `userAuthorized` ∈ {true, false, 缺失, 'true', 1} | 仅 `true` 允许 apply |

---

## 四、测试执行结果

```
node tools/test-weights.mjs
==== ALL PASS (420) ====
```

- **断言总数 420，失败 0。** 原有 312 项继续通过，本轮新增 108 项。
- 测试直接调用生产函数：`applyOfficialBundle`、`recoverInterruptedTransaction`、
  `runtimeStateDiff`、`restoreOfficialRecord`、`evaluatePending`、`verifyStagingForTx`、
  `classifyInterruptedTx`、`buildTxJournal`、`generateTxId`、`decodeBackupParams` 等。
- 有 2 项**旧预期按本轮要求更新**（为避免掩盖回归，在此显式声明）：
  原"轮换失败 → 安装仍成功 + 暂存保留"改为"轮换失败 → 判定失败并回滚 + 原恢复点不变 + 清理暂存"，
  依据是"备份轮换属必要提交步骤，任一必要步骤失败不得返回完整成功"。
- **未验证（如实标记）**：导出工具 CLI 冒烟测试因沙箱禁止 spawn 子进程（`EBUSY`）标记 **SKIP**
  （判定逻辑已由纯函数覆盖，本轮手工 CLI 复验通过）。

---

## 五、兼容性结论

| 对象 | 结论 |
|---|---|
| `djsc_weights_v3`（活跃权重存档） | 未改动 |
| `djsc_weights_backup_v1`（旧版单槽备份） | 格式不变，`restoreBackup()` 继续可用；旧记录无 `txId` 仍按结构/摘要校验 |
| 新增 `djsc_weights_backup_staging_v1`、`djsc_model_update_tx_v1` | 纯新增私有键，旧版无感 |
| 旧官方记录（无 `trained` 字段） | 形状校验不变；训练证据保守回退为"无证据 → mismatch" |
| 旧版待生效记录（v1） | 继续安全丢弃并提示重新下载 |
| `MODEL_SCHEMA` / `DATA_EPOCH` / 权重协议 | 未修改（未改任何版本常量） |
| 训练样本 / A/B 候选 / 统计 / 专项模型 | 未触碰 |
| `score/` 下任何模块、工作台打包/上传/发布 | 未改动 |

---

## 六、尚未进行的测试（未宣称已验证）

| 项目 | 状态 |
|---|---|
| 常规开发机 `node tools/test-weights.mjs`（含 CLI 冒烟） | **未验证**（沙箱禁 spawn，已 SKIP） |
| Windows 客户端：真实安装失败/取消/崩溃后重启恢复 | **未验证** |
| Android WebView：`ReadableStream` / `TextDecoder`、`localStorage` 配额不足 | **未验证** |
| 浏览器：流式下载、超时、I/O 中断 | **未验证** |
| 服务器端到端（权重包托管 + 下载应用） | **未验证** |
| 训练器在授权确认期间真实晋升共享主模型的时序（用假对象模拟） | **未验证**（真机） |

> 本报告不宣称"多键写入具备数据库级原子性"；崩溃恢复基于"单键阶段日志 + 事务暂存备份 + 读回校验"，
> 无法自动恢复时一律保留恢复数据并阻止继续安装。

---

## 七、最终验收底线对照

| 底线 | 达成 |
|---|---|
| 回滚永远恢复本次事务开始时的模型 | ✅ 只用本次事务快照/暂存备份（txId + 摘要双重校验），绝不读长期备份 |
| 用户授权覆盖的模型必须与实际备份的模型相同 | ✅ `rebaseline` 重建基线（重取快照 + 重写并校验暂存备份），上限 2 次 |
| 恢复备份后不得留下不匹配的官方版本记录并虚报成功 | ✅ 记录清除属于同一恢复事务，清除+读回核验失败即回滚模型恢复 |
| 未经授权的待生效任务绝不能自动应用 | ✅ `userAuthorized !== true` 一律 reprompt |
| 安装失败、取消、崩溃均不应破坏原有长期备份 | ✅ 双槽 + 仅成功后轮换；崩溃按阶段恢复，无法恢复则保留数据并阻止安装 |
| 不影响既有 AI 引擎和工作台发布流程 | ✅ 未改动 `score/` 任何模块与打包/上传/发布 |

---

## 八、是否具备提交正式 PR 的条件

**具备。** 四项问题全部确认并修复，每项均有直接调用生产函数的自动化测试；改动仅限
`js/update/*`、`tools/*`；未改动 `MODEL_SCHEMA` / `DATA_EPOCH` / 既有存档格式 / `score/` 任何模块；
原有 312 项测试继续通过，累计 420 项全通过。

建议在 PR 描述中注明第六节的未验证项（真机、服务器端到端、CLI 冒烟）。
