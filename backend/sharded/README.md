# 分片式接收服务（线上部署版）

本目录是**线上实际运行的 8787 接收服务**，与上一级目录的 `server.py`（仓库原始单文件版）是两套实现。

| | `backend/server.py` | `backend/sharded/server_sharded.py` |
| --- | --- | --- |
| 结构 | 单文件 | 单文件（分片式） |
| 合并池 | 单一 `merged_samples.json` | 多分片 `merged_shards/shard_*.json`，清单在 `merged_samples.json` |
| 落盘方式 | 全量重写 | 分片增量，避免单文件过大 |
| 去重索引 | 进程内存 | **SQLite**（`dedup.sqlite`），重启不丢 |
| 请求回执 | 进程内缓存 | **SQLite** 持久化，重启后仍可返回原回执 |
| shadow 游标 | 进程内存 | **SQLite** 持久化 |

## 为什么要 SQLite

改造前，去重哈希、请求回执与 shadow 游标只存在于进程内存中，**服务重启即丢**：
重启后同样的样本会被当作新样本重新入库，合并池出现重复数据。

改造后引入 `dedup.sqlite`（Python 标准库 `sqlite3`，无第三方依赖），三张表：

| 表 | 主键 | 内容 |
| --- | --- | --- |
| `sample_hashes` | `sha` | 样本 sha256，用于样本级去重 |
| `request_receipts` | 请求哈希 | 请求体哈希 → 原回执，用于请求级幂等 |
| `shadow_ids` | `decisionId` | shadow 采样已见 ID |

**设计取舍**：样本本体仍存分片 JSON，**不迁入 SQLite**。20 万级存量样本的迁移风险远大于收益，因此只把「索引态」入库，样本数据流保持不变。启动时从分片幂等灌库（`INSERT OR IGNORE`，重复执行安全）。

## 配置

全部通过环境变量覆盖，均有默认值：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `INGEST_BASE_DIR` | `E:\NoNameAI` | 数据根目录（聚合目录、分片、SQLite 库所在处） |

运行期产物（均在 `INGEST_BASE_DIR` 下，**不纳入 Git**）：
`aggregate/`、`merged_shards/`、`merged_samples.json`、`dedup.sqlite`、`shadow_seen_ids.json`、`post_requests.log`、`ip_blacklist.json`。

## 启动

```powershell
$env:INGEST_BASE_DIR = 'E:\NoNameAI'
python backend/sharded/server_sharded.py
```

服务监听 `0.0.0.0:8787`，限流为每 IP 每小时 12 次。

## 进程托管注意事项

服务需要**长期常驻**。若由受控执行环境（自动化会话、容器任务）启动，进程会随会话结束被回收，**不能作为托管方式**。请使用系统级托管：

- Windows 计划任务（登录触发），或
- 服务管理器 / 进程守护器。

启动后应确认端口处于 LISTEN 状态：

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen
```

## 与 `backend/server.py` 的关系

两者接口兼容（`POST /` 上报、`GET /` 状态、`/update/*` 分发），但**数据目录布局不同**，切换实现时需要迁移或重建合并池，不能直接混用同一数据目录。

本目录代码从线上部署版本同步而来，其中 SQLite 持久化为 2026-10-22 的改造项；改造细节与验证记录见 `docs/training/开发者日志_子模型重训与后端持久化_20261024.md`。
