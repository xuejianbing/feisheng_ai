# 数据上报接收服务

无名 AI 的轻量数据接收服务，使用 Python 标准库，无需安装第三方依赖。

## 启动

```powershell
python server.py
```

从 `backend` 目录启动，服务监听 `0.0.0.0:8787`。运行时数据写入同目录下的 `aggregate/`、`merged_samples.json`、`ip_blacklist.json` 和日志文件；这些运行数据不纳入 Git。

服务接收 JSON 样本上报，按 IP 限流，每个请求最多 8 MiB，并对请求结构做校验。公网部署应通过受控的反向代理或隧道提供访问，并单独配置部署凭据和访问策略；不要将本地隧道配置或数据文件提交到仓库。

## 接收回执

成功的 `POST /` 保留原有顶层字段，并新增 `receipt` 对象，供客户端区分“已归档”和“进入带结果标签的合并候选池”。例如：

```json
{
  "ok": true,
  "samples": 4,
  "new_unique": 2,
  "deduped_in_batch": 1,
  "rejected_unlabeled": 1,
  "receipt": {
    "schema": "ingest-receipt-v1",
    "receivedSamples": 4,
    "archivedSamples": 4,
    "mergedNewSamples": 2,
    "duplicateSamples": 1,
    "rejectedUnlabeledSamples": 1,
    "mergedPoolTotal": 120,
    "hour": "2026-10-20T12"
  }
}
```

`archivedSamples` 只表示已写入小时原始归档；`mergedNewSamples` 表示进入至少带有一个结果字段的合并候选池，不校验结果值，也不代表训练资格。同一进程内处理完成的原样请求重放时返回 `duplicate_request: true` 和原回执，避免客户端因响应丢失而把同一批次重复计数；跨进程持久化回执仍是后续工作。旧版客户端仍可使用原有顶层字段。

接收回执契约测试：`python -m unittest discover -s backend -p "test_*.py" -v`。
