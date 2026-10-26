# 训练与导出脚本

离线训练脚本，用于从服务端训练池重训子模型，并导出前端可用的纯 JS 模型。

## 依赖

- Python 3.10+
- `numpy`、`scikit-learn`、`lightgbm`、`m2cgen`

依赖建议装在独立目录，通过 `TRAIN_LIBS_DIR` 指向该目录（脚本会把该目录插入 `sys.path`），避免污染全局环境。

```powershell
pip install numpy scikit-learn lightgbm m2cgen --target .\_pylibs
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `TRAIN_WORK_DIR` | 脚本所在目录 | 工作目录，指标 JSON 输出位置 |
| `TRAIN_LIBS_DIR` | `$TRAIN_WORK_DIR/_pylibs` | 第三方依赖目录 |
| `TRAIN_MODEL_DIR` | `E:\NoNameAI\model` | 模型输出目录 |
| `TRAIN_HUMAN_SHARD_DIR` | `E:\NoNameAI\merged_shards` | 真人已结算样本分片目录 |
| `TRAIN_ABORTED_SHARD_DIR` | `E:\NoNameAI\aborted_shards` | 强退局样本分片目录 |
| `TRAIN_SLOT17_PKL` | `E:\NoNameAI\model\SubModel_Policy_slot17.pkl` | 待导出的 slot17 模型 |

## 脚本

### `P3_Critic_WinLoss_Train.py` — 胜率模型（114 维）

输出 `Critic_WinLoss_v1.pkl`。

口径：仅取 `gameOutcome ∈ {win, lose}` 的真人已结算局；**无终局（强退）行整体剔除**。
特征取原始前 130 维并剔除 `f32~f47`（16 维泄露维），共 114 维。
按 `sessionId` 分组 80/20 切分。LightGBM 二分类，**不做类别加权**，保证输出概率可反映真实胜率基准率。

评估：行级 ROC-AUC / PR-AUC / Brier、局级 ROC-AUC（每局预测概率均值后再判）、最优阈值（Youden J）、校准分桶。

### `P2_Critic_Train.py` — 三池胜率模型（121 维）

输出 `SubModel_Critic_v1.pkl`。

口径：真人胜局（`win`）+ 真人负局（`lose`）+ 强退局（`aborted_shards`，`is_aborted=true`，记为负样本）；AI 池不参与。
特征取原始前 130 维，剔除 9 维泄漏索引（`LEAK_IDX = [0, 17, 53, 64, 65, 68, 70, 71, 81]`）与 `f32~f47`，共 121 维。

与 `P3_Critic_WinLoss_Train.py` 互补：本口径把强退计入负样本，绝对指标天然更低，但更贴近「这局没打好」的业务定义。

### `P2_Human_Slot_Retrain.py` — 17 类动作槽位模型（114 维）

输出 `SubModel_Policy_slot17.pkl`（schema `slot17_human_v2`）。

口径：标签为 `action:id`；高频 `card:*` 标签（≥10,000）原样保留，取前 14 类；装备按槽位合并为 `equip:weapon` / `equip:nonweapon`；其余归 `other`，共 17 类。
特征 114 维，切分与超参与上两个模型一致。

评估：Top-1 / Top-5 / 装备召回。

### `P2_Export_Slot17_JS.py` — 导出前端纯 JS 模型

输入 `SubModel_Policy_slot17.pkl`，输出 `client_policy_model_v2.js` 与 1000 条对拍样本。

导出后**必须做 JS ↔ Python 对拍**：

```powershell
node -e "const M=require('./client_policy_model_v2.js');console.log(M.selfTest())"
```

对拍样本文件 `slot17_consistency_1000.json` 内含每条样本的 Python 侧概率，可直接比对 JS 侧输出。

## 共同约定

- 全部为**全量重训**，无增量续训入口；有新数据后直接重跑即可。
- 训练数据源（`merged_shards/`、`aborted_shards/`）在部署机本地，**不随仓库分发**。
- 训练指标 JSON 落盘在 `TRAIN_WORK_DIR`，不在仓库内复制（仓库 `artifacts/submodels/metrics/` 存的是本轮快照）。
- 离线指标衡量的是历史真人样本上的拟合与泛化能力，**不等于真实胜率提升**，也不代表已接入线上决策路径。
