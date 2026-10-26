# 第五批 C 离线训练与安全切换（源码包 v5）

新增离线流程以 MODEL-PIPELINE.md 为准：可信训练视图、真实客户端隔离优化器、独立Python验证、模型Manifest、仅test-only的质量门禁及事务发布/回滚。没有生产发布模式；合成候选不得作为正式质量合格模型。server目录全部继承已验收B-v4，不修改认证、修订、资格及上传协议。模型schema仍version7，源码包v5不代表模型版本变更。

## 继承的第五批 B Endpoint补修 v4

v4新增服务端必填INGEST_PUBLIC_ENDPOINT及签发/认证/prepared恢复的统一Endpoint校验，详见SOURCE-AUTH.md。没有默认生产地址；本地HTTP必须显式允许且仅loopback。客户端不改，后端仍仅交付离线审查源码。

当前入口与安全策略以 **SOURCE-AUTH.md** 为准：来源声明不再授予任何训练权限，可信来源必须由管理员本地签发独立凭证。v2原始归档缺少授权侧表时隔离，不修改或删除原文。本包未部署、未迁移生产、未训练。

以下保留v2历史说明；其中仅凭source声明或离线source映射形成可信训练记录的描述已被v3授权规则替代。持久化、资格和修订算法本身未重写。

## v2历史说明（来源权限规则已替代）

基线是开发者提供的 `无名AI_完整后端_20261022.zip` 内 `server/ops/training` 的 56 个 Python 文件；本目录不是新的 Git 仓库。原接收入口 `server/server_sharded.py` 的 SHA-256 为 `68fed938bc1aa4fe22249e521d5ab80941866410f4dcc1343d31cb3abd59baa7`。完整原包、数据、部署配置、密钥和模型均不在本源码包内。

本包没有部署、迁移生产数据或训练模型。原推理 API 与旧运维脚本保持原样，不属于本轮启动入口，勿将它们当作已验收的生产迁移工具。18 个绕过资格规则的旧训练/数据准备/策略导出脚本现在会在读取数据前报 `E_LEGACY_TRAINING_BLOCKED`。没有环境变量后门；需要另行审查的真实训练适配器后才能启用。

## 测试

Python 3.11+、Node.js；跨语言测试需要第五批 A 的客户端源码。所有测试使用合成数据、临时目录、127.0.0.1 随机端口。

```powershell
$env:CLIENT_ROOT = '客户端仓库的绝对路径'
python -m unittest discover -s tests -v
python tests/scenario_evidence.py '显式指定的隔离证据输出目录'
```

`server/trusted_dataset.py --source <隔离旧归档目录> --output <全新独立目录> --dry-run` 仅演练，不写输入。默认缺少来源身份的旧数据隔离；Python `migrate(source=...)` 的来源映射必须有独立可审核证据，示例测试只用虚构来源。先不要在生产数据上执行。

本轮接收入口要求显式 `INGEST_BASE_DIR`，默认绑定 127.0.0.1，继承端口 8787。离线 HTTP 测试直接创建随机端口实例，不启动上述固定端口。原更新 GET 路由保留，不更改更新内容；生产绑定与代理配置尚待独立部署复审。

## 协议与真实性边界

新请求可显式声明 `source:{schema:'ingest-source-v1',domain,instanceId}`，`instanceId` 应由客户端持久化。它是来源声明，不是鉴权证明。当前第五批 A 客户端 v2 请求尚无该字段：可以得到可靠原始归档回执，但缺少来源证据的记录不入可信训练视图；没有修改客户端上传代码，也不宣称已经联调部署。

`sample-revision-v1` 的完整事务 logicalId 为 `tx:` 加 JSON 数组 `[sessionId,actorId,transactionId]`。revision 是不可信传输令牌；服务器重算业务指纹并校验逻辑身份。忽略 sync/本地确认等运维字段后，同事务同业务升级重传不增加版本；合法补全选一个有效训练版本；非法修订或冲突证据隔离整事务。

接收顺序是 FULL SQLite 准备（完整原文 BLOB）→ 原文文件 fsync/原子更名 → FULL SQLite 索引及回执同事务提交 → 200。Windows 不支持目录 fsync 时，SQLite 原文副本用于重建文件。失败无内存成功兜底。重复请求回原回执，附属快照随整个原文归档，不提供逐字段训练确认。

v1 回执的 mergedNewSamples 明确表示“带来源命名空间的修订索引新增”，不表示合格训练数量；qualifiedSamples=null。真实资格数量在离线训练视图及 Manifest，旧池不自动改写。限流仍每 IP 每小时 12 次，重复请求也消耗额度，429 增加可被浏览器读取的 Retry-After。

Manifest 使用独立、明确声明的 server-canonical-json-v1，并不声称与全部 ECMAScript 浮点编码逐字相同。generatedAt 是展示元数据，不参与 contentHash。模型绑定核对整个模型文件哈希、数据集哈希及同候选/同数据集验证记录，不证明外部训练实际发生或其质量。未提供获准的当前 134 维后端训练器，因此旧训练入口保持阻断。

保留风险：客户端来源身份协议待联调；来源声明不等于认证；实体对局跨热重载连续性未知；历史权重留出暴露未知；生产历史数据映射/迁移、真实断电和实际磁盘满、生产负载容量均未验收。
