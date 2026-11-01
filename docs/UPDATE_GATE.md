# 更新通道授权闸门

给 `backend/sharded/server_sharded.py` 加的付费边界：**控制「谁能拿到更新包」，不控制「谁能看版本号」**。

## 设计原则

1. **默认关闭**。`enforce: false` 时行为与改动前完全一致，现有 4.4.x 客户端无感知。
2. **热生效**。改 `update/gate.json`、`update/keys.json` 后下一个请求即生效，不用重启进程。
3. **按版本划线**。只有 `目标版本 >= enforceFromVersion` 才要求密钥，低版本永远放行，避免把老用户卡死。
4. **只存哈希**。`keys.json` 里只有 key 的 sha256，泄库也拿不到可用密钥。
5. **清单始终可读**。`manifest.json`、`policy_manifest.json`、`latest.json` 不受闸门影响，客户端仍能判断版本。

## 配置

`<BASE_DIR>/update/gate.json`：

```json
{
  "enforce": false,
  "enforceFromVersion": "5.0.0",
  "gateStaticZip": true,
  "gateModel": false
}
```

| 字段 | 含义 |
|---|---|
| `enforce` | 总开关。`false` 时一切照旧 |
| `enforceFromVersion` | 从哪个版本开始要密钥；低于它一律放行 |
| `gateStaticZip` | 是否同时拦 `/update/xxx.zip` 直链（建议 `true`，否则可绕开 `/update/download`） |
| `gateModel` | 是否拦权重数据包（`manifest.json` 除外）。客户端要支持带 key 才能开 |

`<BASE_DIR>/update/keys.json`：

```json
{
  "keys": [
    {
      "id": "k3f9a1",
      "sha256": "<key 的 sha256>",
      "note": "首批内测",
      "expires": "2028-01-01",
      "revoked": false
    }
  ]
}
```

`expires` 为空表示永久；`revoked: true` 立即失效。

## 签发与吊销

```bash
python make_update_key.py --note "渠道A" --expires 2028-01-01
python make_update_key.py --revoke k3f9a1
```

命令只在标准输出打印一次明文 key，服务端只留 sha256。

## 客户端怎么带 key

三种都认，任选其一：

```
GET /update/download?key=<key>
GET /update/download   Header: X-Update-Key: <key>
GET /update/download   Header: Authorization: Bearer <key>
```

未带或无效返回：

```json
HTTP 403
{"error": "update_license_required", "detail": "该版本的更新包需要授权密钥；请携带 key 参数或 X-Update-Key 头。"}
```

## 上线顺序

1. 保持 `enforce: false`，先发一版带 key 逻辑的客户端（`5.0.0` 起）。
2. 确认新客户端能读到 key 并成功下载。
3. 再把 `enforce` 改成 `true`、`enforceFromVersion` 对齐该版本。
4. 老版本（4.4.x）不受影响，继续免费更新到最后一版。

## 已验证

离线单测 17 项（`tests` 里的临时脚本，未入库）：无网关放行、低于下限放行、达到下限无 key 拦截、query/header/Bearer 三种带法通过、错误 key、过期、吊销、改配置热生效、`gateModel` 开关。生产实例回环实测：`enforce=true` 时无 key 403、带 key 200、`/update/check` 仍 200；改回 `false` 后立即恢复 200。
