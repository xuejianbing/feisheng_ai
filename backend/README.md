# 数据上报接收服务

无名 AI 的轻量数据接收服务，使用 Python 标准库，无需安装第三方依赖。

## 启动

```powershell
python server.py
```

从 `backend` 目录启动，服务监听 `0.0.0.0:8787`。运行时数据写入同目录下的 `aggregate/`、`merged_samples.json`、`ip_blacklist.json` 和日志文件；这些运行数据不纳入 Git。

服务接收 JSON 样本上报，按 IP 限流，每个请求最多 8 MiB，并对请求结构做校验。公网部署应通过受控的反向代理或隧道提供访问，并单独配置部署凭据和访问策略；不要将本地隧道配置或数据文件提交到仓库。
