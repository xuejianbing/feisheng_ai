# 权重与收费边界

面向「无名AI 打算收费」这条线，记录仓库侧该怎么处理权重。结论先说：**已经公开的收回不了，能管的是以后。**

## 现状（2026-11-01 核查）

- 仓库 `xuejianbing/feisheng_ai` 是 public，许可 GPL-3.0，HEAD 共 1246 个文件。
- `score/model/weights/defaultWeights.js`（约 69 KB）在仓库里，是训练好的内置权重。
- GPL-3.0 允许任何人复制、修改、再分发甚至转卖，只要保留许可与源码；已经发出去的版本，授权不可撤回。
- 已有 1 个 fork，无法收回。

所以：**v4 及以前的权重按「已公开」处理**，不要再指望它保密。

## 从下一版权重开始

1. 权重文件不再直接提交。
   - 放在本地 `private/weights/defaultWeights.js`（`.gitignore` 已排除 `/private/`）。
   - 同目录放 `manifest.json`：`{ "sha256": "...", "version": "5.0.0-w1", "note": "..." }`。
2. 构建前注入并校验：

   ```bash
   node tools/prepare-private-weights.mjs
   ```

   脚本会把私有权重写到 `score/model/weights/defaultWeights.js`，并用清单里的 sha256 校验，不一致直接失败。
3. 首次切换时把已跟踪的文件移出版本控制（保留本地副本）：

   ```bash
   git rm --cached score/model/weights/defaultWeights.js
   echo "score/model/weights/defaultWeights.js" >> .gitignore
   ```

   注意：这一步会让「克隆后直接跑」失效，队友必须先执行注入脚本。所以放在 v5 分支上做，别在 4.4.x 维护线上动。

## 真正的闸门在更新通道

权重必须随包分发到客户端才能运行，拆仓只能降低「打开 GitHub 就能拿到」的便利，挡不住从安装包里提取。能挡住持续扩散的是下发环节：

- `backend/sharded/server_sharded.py` 的授权闸门（见 [UPDATE_GATE.md](UPDATE_GATE.md)）
- 新权重只通过 `/update/model/...` 下发，开启 `gateModel` 后必须带有效 key
- 客户端侧的授权校验是最后一道：没有 key 就不应用新权重

## 训练数据与代码

- `tools/training`、`tools/training_audit` 是训练流水线，价值不低于权重本身。若要走闭源路线，这两个目录应同步移入私有仓。
- 上报数据不在仓库里（在服务器 `E:\NoNameAI\aggregate`），保持现状即可。
