# 无名AI · 模型权重在线更新协议（服务端 / 工作台对接契约）

> 本文件面向 `data.feiqiaoai.uno` 的维护者与外部工作台。
> 客户端实现见 `js/update/`，权重包格式与校验口径的唯一权威定义是 `js/update/weightBundle.js`。
> 导出与校验工具：`tools/export-weights.mjs`。

## 一、背景与分工

| 项目 | 内容 |
|---|---|
| 更新目标 | **只更新 AI 模型权重参数数据**，不在游戏内下载/解压/覆盖扩展文件 |
| 整包发布 | 仍由工作台原来的流程生成 ZIP，由开发者在交流群分发；本协议不改变它 |
| 新旧判据 | **模型权重版本 `releaseSeq`**（单调递增整数），与扩展版本无关 |
| 扩展版本用途 | 仅用于「兼容性」判断（`requiresExtension` 区间） |
| 服务端要求 | **只需静态托管两个文件，无需任何服务端逻辑** |

> ⚠ 不得改动或删除现有的 `/update/check` 与 `/update/download`：
> 旧 α 系列客户端仍在轮询 `/update/check`，贸然改动会破坏旧用户更新链路。

## 二、服务端需要提供的文件

| 用途 | 地址 | 说明 |
|---|---|---|
| 清单 | `/update/model/manifest.json` | 单一入口，客户端只请求它 |
| 权重包 | `/update/model/<不可变文件名>` | 内容寻址文件名，旧文件请保留不删 |

`/update/model/manifest.json` 必须返回 JSON（Content-Type: `application/json`）。
**若该地址暂时不存在或返回其它内容，客户端会判定为「协议未启用」并安全降级**——扩展与现有模型照常使用，不会报错、不会反复提示。

## 三、清单（manifest.json）结构

```json
{
  "protocol": "djsc-model-update-v1",
  "modelId": "main-actor-critic",
  "latest": {
    "modelVersion": "w7d5-20261015-01",
    "releaseSeq": 1,
    "schemaVersion": 7,
    "featureDim": 134,
    "dims": [134, 128, 64, 6],
    "dataEpoch": 5,
    "size": 51534,
    "sha256": "72b5e1d777417841d76b2d84830a458ecf504181d0d640ddc7085f03b0c23b4d",
    "url": "/update/model/main-actor-critic-w7d5-20261015-01-72b5e1d7.json",
    "publishedAt": "2026-10-15T03:21:49.681Z",
    "notes": "更新说明（可多行）",
    "requiresExtension": { "min": "4.1", "max": null }
  }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `protocol` | ✅ | 必须是 `djsc-model-update-v1`，否则客户端忽略（安全降级） |
| `modelId` | ✅ | 必须是 `main-actor-critic`（第一期只发布主决策模型） |
| `latest.modelVersion` | ✅ | 人类可读版本号，仅作展示与本地授权判断标识 |
| `latest.releaseSeq` | ✅ | **>=1 的整数，必须严格单调递增**；客户端靠它判新旧 |
| `latest.schemaVersion` | ✅ | 必须等于客户端 `MODEL_SCHEMA.version`（当前 **7**） |
| `latest.featureDim` / `dims` | ✅ | 必须等于客户端契约（当前 **134** / `[134,128,64,6]`） |
| `latest.dataEpoch` | ✅ | **必须 >= 客户端 `DATA_EPOCH`（当前 5）**，否则应用后会被 `loadWeights` 拒载 |
| `latest.size` / `sha256` | ✅ | 由导出脚本计算；客户端下载后会逐字节校验 |
| `latest.url` | ✅ | 权重包地址（可相对，也可绝对 URL） |
| `latest.requiresExtension` | 建议 | `{min, max}` 扩展版本区间；不满足时客户端提示「领取完整安装包」，不做在线替换 |
| `latest.notes` / `publishedAt` | 可选 | 展示用 |

## 四、权重包（bundle）结构

**只允许纯数据 JSON**，不得包含任何 JavaScript 或远程脚本。字段与导出脚本产物一致：

```json
{
  "format": "djsc-weight-bundle-v1",
  "modelId": "main-actor-critic",
  "modelVersion": "w7d5-20261015-01",
  "releaseSeq": 1,
  "schemaVersion": 7,
  "featureDim": 134,
  "dims": [134, 128, 64, 6],
  "dataEpoch": 5,
  "dtype": { "weights": "int8", "biases": "int16" },
  "architecture": { "activation": "gelu", "norm": "layernorm", "residual": true, "critic": true },
  "params": {
    "w1": "<base64 Int8, 134*128>", "b1": "<base64 Int16, 128>",
    "w2": "<base64 Int8, 128*64>",  "b2": "<base64 Int16, 64>",
    "w3": "<base64 Int8, 64*6>",    "b3": "<base64 Int16, 6>",
    "w4": "<base64 Int8, 64>",      "b4": "<base64 Int16, 1>",
    "pr1": "<base64 Int8, 134*128>","pr2": "<base64 Int8, 128*64>"
  },
  "trained": 181832,
  "accuracy": 0.637,
  "size": 51534,
  "sha256": "<64 位小写十六进制>",
  "publishedAt": "2026-10-15T03:21:49.681Z",
  "notes": "更新说明",
  "requiresExtension": { "min": "4.1", "max": null },
  "probe": { "input": [ /* 134 个有限数 */ ], "expectTop": 3 }
}
```

关键约束：

1. **`params` 必须齐备全部 10 项**（含 Critic 头 `w4/b4` 与残差投影 `pr1/pr2`）。缺任何一项客户端一律拒绝，防止「只更新部分网络」造成权重错位。
2. **编码与体积**：权重 Int8、偏置 Int16；`size` = 10 项解码后字节数之和（当前 51534）；`sha256` = 按固定顺序 `w1,b1,w2,b2,w3,b3,w4,b4,pr1,pr2` 串联全部原始字节后的 SHA-256。该口径与语言无关，前后端结果必须一致。
3. **优化器状态（AdamW 动量）不随包传递**：官方权重是「成品」，客户端应用时会清零动量与时间步并重新开始训练。理由：沿用与新权重不匹配的动量会污染后续本地训练。
4. **`probe` 可选**：若提供，客户端应用后会前向一次并核对 `expectTop`；不提供时客户端仍做结构与有限性（无 NaN/Inf）校验。
5. **文件名不可变**：导出脚本产出 `<modelId>-<modelVersion>-<sha256前8位>.json`，避免下载期间文件被覆盖导致元数据与内容不一致。同版本但文件损坏时，客户端可重新下载同一 URL 修复。

## 五、发布规则（务必遵守）

1. `releaseSeq` 严格单调递增；**不要复用**已发布过的 `(releaseSeq, modelVersion, sha256)` 组合。
2. 服务器只需返回 `latest`；如需灰度，可让不同请求返回不同 `latest`，客户端无需改动。
3. **网络结构（`schemaVersion` / `dims`）一旦变更，必须走完整安装包升级扩展**：
   客户端会因结构不匹配拒绝在线替换，并提示用户领取新安装包。
4. 发布新权重**不需要**重新分发完整安装包；只有结构变更或需要兼容新扩展版本时才需要。

## 六、工作台接入步骤（保持原有输入/输出/上传行为不变）

在扩展根目录执行（新增步骤，不影响原打包流程）：

```bash
# 1) 生成权重包 + 清单（输入就是工作台训练结果的存档 JSON）
node tools/export-weights.mjs \
  --input  <训练产物.json> \
  --model-version w7d5-20261015-01 \
  --seq 1 \
  --out dist \
  --ext-min 4.1 \
  --notes "更新说明" \
  --manifest-out dist/manifest.json

# 2) 离线复核（可选，失败退出码 1）
node tools/export-weights.mjs --verify dist/main-actor-critic-w7d5-20261015-01-xxxxxxxx.json
```

- 训练产物 JSON 与 `weights.js` 的 `saveWeights()` 存档**同构**：
  `{ v, dv, w1, b1, w2, b2, w3, b3, w4, b4, pr1, pr2, trained, accuracy }`。
  也可用 `--from-default` 直接以扩展内置默认权重作为发布内容（首期可用它打通链路）。
- 上传：把 `dist/<权重包>.json` 放到 `/update/model/`，把 `manifest.json` 放到 `/update/model/manifest.json`。
- **兼容性硬校验（默认拒绝，绝不静默放行）**：
  - 输入结构版本 `v` ≠ 目标 `schemaVersion` → **直接拒绝**（本工具不提供结构迁移，禁止仅改元数据冒充新模型）。
  - 输入数据纪元 `dv` < 目标 `--epoch` → **默认拒绝**；确需发布时显式加
    `--allow-epoch-migration --migration-note "<依据>"`，迁移依据会写入权重包 `epochMigration` 字段供审计。
  - `--from-default` 例外：内置默认权重即当前结构版本的基线模型（仅 `dv` 元数据陈旧），按可验证基线放行。
  - 任何拒绝都以退出码 1 结束且不产出文件。
- `--epoch` 默认 5（当前运行时 `DATA_EPOCH`）。权重包必须携带与运行时一致的
  `dtype`（int8 权重 / int16 偏置）与 `architecture`（gelu / layernorm / residual / critic），
  客户端 `validateBundle` 会强制校验，同维度但语义不符的权重一律拒绝安装。

## 七、客户端行为（供服务端了解影响）

| 情境 | 客户端状态 | 行为 |
|---|---|---|
| 地址不存在 / `protocol` 不符 | `unsupported` | 静默降级，不影响扩展使用 |
| 网络失败 / 超时 | `unreachable` | 有限次重试；失败如实提示，不伪装成已更新 |
| 有更新且扩展版本兼容 | `available` | 用户确认后下载 → 校验 → 安全应用 |
| 新权重要求更高扩展版本 | `needsExtensionUpdate` | 提示领取完整安装包，不强行在线替换 |
| 元数据/内容异常（sha256、维度、纪元等） | `invalid` | 拒绝应用，保留原模型 |
| 已是最新 | `latest` | 手动检查时提示；自动检查静默 |

## 八、待确认 / 未验证事项

- 本协议中的清单地址 `/update/model/manifest.json` 是**新增约定**；当前该地址返回的是服务自身的状态信息：
  `{"status":"ok","service":"wuming-ingest",...}`，客户端据此判定 `unsupported` 并安全降级（已实测）。
- 未在真实服务器上验证「权重包上传 + 客户端下载应用」的完整链路（需要服务端先按本协议托管文件）。
- 探针 `expectTop` 需由工作台用与扩展一致的前向实现计算；本期客户端将其视为可选校验项。

## 九、整包发布兼容性核验清单（不改动现有打包流程）

本期新增文件：`js/update/*.js`（客户端）、`tools/export-weights.mjs`、`tools/test-weights.mjs`、
`tools/MODEL_UPDATE_PROTOCOL.md`。以上**不改变工作台原有的输入 / 输出 / 上传行为**。

### 9.1 已在仓库内静态核验通过（322 个 JS 模块、1097 条相对引用）

| 检查项 | 结果 |
|---|---|
| 相对 `import / export … from / 字面量 import()` 目标是否存在 | 无缺失（唯一被标记项 `shadow/shadowCore.js` 的 `/extension/无名AI/…/features.js` 是**运行时绝对路径**，注释已注明手机端验证可 import，非打包缺陷） |
| 越出扩展根目录的相对引用 | 仅 `js/shared/utils.js` 与 `score/foundation/adapt/host.js` 指向宿主 `noname.js`（**预期的唯一宿主耦合点**，本体中存在） |
| 非相对（裸）说明符 | 仅 `tools/*.mjs` 的 `node:fs / node:path / node:url / node:crypto`（静态审计按「相对引用」扫描，裸说明符不受影响） |
| 关键运行时文件与资源 | `info.json`、`extension.js`、`css/AIjinjiang.css`、`js/config/changelog.js`、`logs/*.js`（3 个）、`model/v5_mixup_s42.json`、`model/v5_mixup_s456.json`、`score/model/weights/defaultWeights.js`、`js/update/modelUpdate.js` 全部存在 |
| ZIP 根结构 | 扩展根目录本身即 ZIP 根（`info.json` / `extension.js` 在根），符合「无名杀可直接导入格式」 |

### 9.2 需要打包侧注意（清单，不是代码改动）

1. `model/*.json`、`logs/*.js` 是通过**运行时路径**（`lib.assetURL` / 绝对路径）加载的，
   静态引用审计**发现不了缺失**，请确认它们始终进包。
2. `tools/` 是构建期工具，**可选**从发布 ZIP 中排除（`.md` 会被打包器的 empty loader 置空，
   `.mjs` 不被游戏加载，保留亦无害）。是否排除由工作台决定，本仓库不做强制。
3. 发布模型权重**不需要**重新分发完整安装包：服务端新增 2 个静态文件即可。
4. **网络结构变更（`schemaVersion` / `dims`）时必须重新分发完整安装包**：
   客户端会因结构不匹配拒绝在线替换，并提示用户领取新安装包。

### 9.3 离线安装与新旧用户兼容

| 场景 | 结论 |
|---|---|
| 全新离线安装、无网络 | `loadWeights()` 无存档 → 载入内置默认权重（`_decodeDefault` 只校验 `v===VERSION`，与数据纪元无关）→ 开箱可用 |
| 安装包默认模型 vs 同次权重元数据 | 一致性由协议约束：权重包 `schemaVersion` 必须等于运行时 `MODEL_SCHEMA.version`（7）、`dims` 必须为 `[134,128,64,6]`、`dtype`/`architecture` 必须与 `MODEL_SCHEMA` 一致、`dataEpoch >= DATA_EPOCH`（当前 5），均由 `validateBundle` 强制校验 |
| 旧用户升级安装包后 | 本地训练成果（`djsc_weights_v3`）与训练样本 / 候选 / 专项模型数据**均不因整包更新而改动**；官方权重记录与备份键独立存在，继续按规则生效 |
| 结构不兼容的新权重 | 客户端拒绝在线替换（`schemaVersion` / `dims` / `architecture` 不符即 `invalid`），只提示领取新安装包 |

> ⚠ 已知既有不一致（**未修改**，遵循"不得为了通过校验随意修改版本常量"）：
> 内置默认权重 `DEFAULT_WEIGHTS.dv = 4`，而运行时 `DATA_EPOCH = 5`。
> 内置默认权重走 `_decodeDefault()`（只校验结构版本，不校验数据纪元），因此离线可用不受影响；
> `--from-default` 导出时，导出脚本将内置默认权重按"当前结构版本的基线模型"处理并统一写入
> 目标纪元（可验证处理），无需人工指定 `--epoch`。历史训练产物的 `dv` 若低于目标纪元，
> 导出脚本**默认拒绝**，须显式 `--allow-epoch-migration --migration-note` 并留下审计依据。

### 9.4 安全与一致性保证（P0/P1/P2 修复后）

| 保证 | 实现 |
|---|---|
| 备份失败绝不替换模型 | 安装前强制"写入**暂存**备份 + 读回逐项核对（参数/摘要/事务标识/结构版本）"，任一步失败即中止且不谎报 |
| 绝不提前销毁用户恢复点 | 暂存备份（`djsc_weights_backup_staging_v1`）与长期恢复点（`djsc_weights_backup_v1`）分离；只有安装**整体成功**后才轮换长期恢复点，失败/取消时原恢复点完好 |
| 回滚只回本次事务的模型 | 每次安装生成唯一 `txId`；暂存备份记录该 `txId`；回滚只用本次事务创建并校验过的内存快照/暂存备份，**绝不读取长期备份**（避免恢复到更早的历史备份） |
| 提交步骤缺一不可 | 官方记录提交与长期备份轮换都是必要提交步骤；任一失败 → 回滚本次更新前的模型 + 回滚版本记录，返回失败而非完整成功 |
| 恢复不覆盖原备份 | 恢复走独立事务（`mode='restore'`），不写任何备份键；恢复与"清除官方记录"同一事务验收，记录清理失败即回滚模型恢复 |
| 崩溃 / 重启可恢复（状态驱动） | 单键事务日志 `djsc_model_update_tx_v1` 记录阶段（prepared / weights-written / record-committed / backup-rotated）+ 基线/目标摘要 + **安装前官方记录快照**；恢复不只看阶段，而是交叉核对**实际**持久化模型摘要、官方记录实际内容、长期备份摘要与本事务暂存备份（txId+基线）后再决定：清理残留 / 回滚（模型+旧记录一并恢复）/ 补做轮换 / 修复记录；无法自动恢复时写入 `needsManual` 保留全部数据并阻止继续安装；恢复完成后读回核验模型、记录与事务状态；**日志读取失败、内容损坏、或键存在但内容不是合法事务日志（{}、null、[]、缺 txId 等合法 JSON）→ 一律视为"无法确认"进入安全阻塞（保留原始日志不改写，存储恢复后仍可正常恢复）；仅当键确实不存在时才是"没有未完成事务"** |
| 待生效不静默覆盖新训练 | 待生效记录含授权基线摘要且**强制校验 `userAuthorized === true`**；生效前比对当前摘要，不一致则重新征询用户 |
| 重新授权重建基线 | 最终复核期间模型变化 → 事务丢弃旧基线并**重新取快照、重写并校验暂存备份**；**用户重新授权后授权基线随新模型同步更新**（手动安装与待生效安装共用 `reauthorizeRecord`），不会拿旧摘要反复弹窗；重复变化超上限即中止（不无限重试） |
| 手动安装同样受授权约束 | 手动安装与待生效安装共用同一套 `evaluatePending` 授权规则与同一重建流程 |
| 回滚状态如实合成 | 完整回滚 = 模型恢复成功 **且** 官方记录恢复成功；任一失败即 `partial`/`failed`（`combineRollbackStatus` 单一合成），`rolledBack`/`rollbackStatus`/`rollbackErrors` 与用户弹窗（`rollbackStatusText`）三者一致，绝不把部分回滚报成完整成功 |
| 记录删除必须读回确认 | 清除官方记录后必须成功读回为空才算删除成功；读回抛异常 / 缺少读取能力 / 删除返回失败或抛异常 → 一律判为未完成（错误信息区分三类情况）；宿主侧用 `getStore()` 直读避开 `safeGet` 吞异常 |
| 事务日志写入门禁 | `prepared` 日志必须写入并读回核验成功才能开始替换权重；`weights-written` 推进失败立即安全回滚中止；`record-committed`/`backup-rotated` 推进失败按实际状态（权重与记录均已读回核验）继续提交并如实标记降级；宿主接入层对 `djsc_model_update_tx_v1` 采用**严格读取 + 结构校验**（读取失败/内容损坏/结构无效抛异常，被恢复与安装门禁采纳为"未确认"），清理顺序为"先删日志（读回核验）再删暂存"，**删除后读回异常亦判未清理**（保留暂存，报 `cleanupPending` 待下次启动安全收尾），防止把完整事务的清理残留误判为需要回滚 |
| 单一更新事务 | 下载安装 / 待生效应用 / 恢复备份 / **启动崩溃恢复**共用同一把事务锁；恢复全程持锁并置 recovering 标志，恢复结束前一切新的模型修改操作（含并发恢复）都被拒绝，杜绝"恢复读取旧事务数据的同时新安装覆盖暂存/日志"的竞态；取锁失败时恢复不改动任何数据、保留日志待下次启动重试 |
| 写入失败不留半成品 | 写入抛异常/返回 false 时比对参数+优化器+时间步+元数据，检出部分修改即回滚并校验；无法确认时如实报告风险 |
| 不误判"用户训练成果" | 训练证据取自官方记录的训练步数基线与候选晋升计数，`trained > 0` 不单独作为依据；无法判定时归为 `mismatch`（不自动覆盖） |
| 下载安全 | 超时覆盖正文读取；优先**流式读取**并按实际接收字节数即时限额（不依赖 Content-Length），另设绝对硬上限 |
| 弹窗降级安全 | DOM 不可用时，破坏性操作默认取消（返回安全值），只读提示才安全降级 |
| 弹窗布局隔离 | 更新弹窗（styledDialog / progressDialog）为纵向 Flex：标题/按钮 `flex:0 0 auto` 恒定可见，正文区 `flex:1 1 auto; min-height:0` 滚动；所有结构节点以 `!important` 覆盖本体全局规则（`div{position:absolute;transition:all .5s}` → `position:static;transition:none`）；尺寸/位置按"实际可视区域 ÷ 实测缩放比"换算（补偿 `ui.updatez()` 的 `body transform:scale`）；同屏至多一个确认弹窗 + 一个进度浮层（新弹窗以安全取消值关闭旧弹窗） |

> 事务原子性说明：localStorage 的多个键**不具备**数据库级原子性。本模块不宣称跨键原子事务，
> 而是通过"单键阶段日志（含基线与目标摘要、安装前官方记录快照）+ 事务暂存备份 + 每步读回校验"
> 实现最小可行的安全恢复；崩溃恢复**以实际持久化状态为准**（日志阶段仅作参考），无法自动恢复时
> 一律**保留**唯一可用的恢复数据并阻止继续安装，交由人工处理。

### 9.5 对局生命周期与"绝不在对局中替换权重"

客户端不依赖宿主 `game.on`（该 API 不存在，`gameOver` 事件亦从不发布——`engine.js`/`panel.js`
中的同名调用均为死代码，靠轮询兜底）。实际使用的可靠信号：

| 信号 | 来源 | 语义 |
|---|---|---|
| `_status.gameStarted` | 宿主 `gameEvent.js` 的 `gameStart` 事件 | 本局已开始（每局由页面重载重置） |
| `_status.over` | 宿主 `game.over()` | 本局已结束 |
| `lib.announce` `'Noname.Game.Event.GameStart'` | 宿主 `Announce` 订阅 | 每局开始通知（客户端用于重置缓存状态） |
| `_status.event` + `game.players.length` | 兜底 | 开局瞬间 / 观察者模式的活动事件链 |

门禁优先级（`updateCore.evaluateApplyGate`）：模型状态 → 训练状态 → A/B 候选 →
**宿主实时 `gameStarted`/`over`** → **活动事件链兜底** → 缓存状态。
实时信号恒优先于缓存信号：缓存说"不在对局"绝不会放过实时说"在对局"。

> 新一局通过 `game.reload()` → `window.location.reload()` 重新加载，因此上述宿主状态天然"每局一份"。
> 卸载时解除 `lib.announce` 订阅、事件总线订阅与定时器，不影响其他模块。


### 9.6 安装事务链路与每步失败的后续行为（第四轮）

| 步骤 | 成功条件 | 失败后的行为 |
|---|---|---|
| 1 未完成事务检查 | 无 `manual` 状态的未完成事务 | 阻止继续安装，提示重启/手动还原；保留全部恢复数据 |
| 2 下载 | 体积上限内、合法 JSON、维度/纪元/结构/语义校验通过、与清单摘要一致 | 抛错，现有模型未受影响 |
| 3 参数校验 | `validateBundle` 全项通过（含 dtype / architecture） | 拒绝安装 |
| 4 用户授权 | 本地训练模型已单独询问；`evaluatePending` 判定 apply | 拒绝或转为待生效；未经授权绝不覆盖 |
| 5 获取最终快照 | 授权复核通过（模型与授权基线一致） | 中止；若期间模型变化 → 重建基线（重取快照 + 重写并校验暂存备份），反复变化超上限即中止 |
| 6 创建备份 | 暂存备份写入 + 读回逐项核对（含 `txId` / 摘要 / 结构版本） | 中止，长期恢复点与原模型均未改动 |
| 6.5 事务日志门禁 | `prepared` 日志写入 + 读回核验成功（含基线与目标摘要、安装前官方记录快照） | 中止（未做任何改动）；没有可靠恢复依据绝不进入权重替换 |
| 7 应用模型 | 写入未抛异常且未返回 false | 检出部分修改即回滚到本次事务基线并校验参数/优化器/时间步/元数据；无法确认时如实报告风险 |
| 8 持久化验证 | 存档读回一致 + 在线内存一致 + 前向有限性/探针通过 | 回滚，清理事务数据 |
| 9 官方记录处理 | 写入（安装）/清除（恢复）后读回核验通过 | 回滚本次更新前模型 + 回滚版本记录；返回 `complete`/`partial`/`failed` 合成状态（不报完整成功） |
| 10 长期备份处理 | 从暂存备份轮换并读回核验通过 | 回滚本次更新前的模型；原长期备份保持不变 |
| 11 事务清理 | 先删日志（读回核验）再删暂存，仅在上游全部核验通过后执行 | 日志删除失败 = 保留暂存，报 `cleanupPending`（下次启动安全收尾）；回滚不完整时保留暂存备份与日志并标记 `needsManual` |
| 12 成功提示 | 上述全部完成 | 提示内容与真实持久化状态一致（`journalDegraded`/`cleanupPending` 如实反馈） |

`weights-written` / `record-committed` / `backup-rotated` 阶段日志推进失败时：前者（模型已改写、尚无可靠恢复信息）立即安全回滚中止；后者（权重与官方记录均已读回核验、实际状态自洽）继续完成提交并标记 `journalDegraded`，崩溃恢复按实际状态收尾。

新增持久化键（均为本模块私有，不触碰既有存档）：

| 键 | 用途 |
|---|---|
| `djsc_weights_backup_staging_v1` | 安装事务暂存备份（含 `txId`） |
| `djsc_model_update_tx_v1` | 安装事务日志（阶段 + 基线/目标摘要 + 安装前官方记录快照；崩溃/重启按实际状态恢复的依据） |
