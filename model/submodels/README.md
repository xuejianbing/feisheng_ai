# 子模型（SubModel）产物说明

本目录存放基于**服务端训练池**离线训练得到的子模型权重，以及它们的训练与导出脚本。
这些模型与扩展端内置的 `score/model/weights/` 权重是**两套独立体系**，不共用快照契约。

## 目录内容

| 文件 | 类型 | 维度 | 训练口径 |
| --- | --- | --- | --- |
| `SubModel_Policy_slot17.pkl` | LGBMClassifier（17 类） | 114 | 纯真人已结算样本，标签 `action:id` |
| `Critic_WinLoss_v1.pkl` | LGBMClassifier（二分类） | 114 | 真人已结算局，`win=1` / `lose=0` |
| `SubModel_Critic_v1.pkl` | LGBMClassifier（二分类） | 121 | 真人胜局 + 真人负局 + 强退局（强退记为负样本） |

训练脚本位于 `tools/training/`，导出脚本见下文「导出前端 JS」。

## 特征口径

与扩展端内置权重的 `FEATURE_DIM = 134` 不同，子模型统一使用 **114 维**：

```
原始特征 f（130/134/142 维均可）
  → 取前 130 维
  → 剔除 f32 ~ f47（16 维，含时序类泄露特征）
  → 保留 f0 ~ f31 + f48 ~ f129 = 114 维
```

`Critic_WinLoss_v1.pkl` 额外剔除 9 维泄漏索引（`LEAK_IDX = [0, 17, 53, 64, 65, 68, 70, 71, 81]`），得到 121 维。

`SubModel_Policy_slot17.pkl` 的 `feature_keep` 字段记录了实际保留的原始维度下标，消费方应按该字段取值，不要自行假设顺序。

## 训练数据源

- `merged_shards/`：真人已结算局样本池（按小时增量归档后合并分片）。
- `aborted_shards/`：强退局样本池，仅 `SubModel_Critic_v1.pkl` 使用。

数据源位于部署机本地，不随仓库分发。仓库只保留**模型产物 + 训练脚本 + 指标 JSON**。

## 切分与防泄漏

三个模型均使用 `GroupShuffleSplit` 按 `sessionId` 做 80/20 划分，整局不跨训练集与测试集，避免同一局内的状态互相泄漏。

## 导出前端 JS

`SubModel_Policy_slot17.pkl` 可导出为纯 JS（m2cgen，无运行时依赖）：

```powershell
python tools/training/P2_Export_Slot17_JS.py
```

输出 `client_policy_model_v2.js` 与 1000 条对拍样本。对拍验证方式：

```powershell
node -e "const M=require('./client_policy_model_v2.js');console.log(M.selfTest())"
```

导出后必须做 JS ↔ Python 概率对拍（本轮 1000 条样本 Top-1 一致率 100%，最大概率偏差 1.11e-16）。

## 指标

各模型的训练指标落盘在对应脚本目录的 JSON 文件中（`P2_Critic_Train.json`、`P3_Critic_WinLoss.json`、`P2_Human_Slot_Retrain.json`），不在仓库内复制。

> 离线指标（ROC-AUC / Top-1 / 召回）衡量的是**历史真人样本上的拟合与泛化能力**，不等于真实胜率提升，也不代表已接入线上决策路径。

## 消费方式

这些模型当前由云端推理服务加载并用于仲裁，**不是**扩展端 `weightBundle` 快照格式（`v=7`、Int8 权重 + Int16 偏置、`dims=[134,128,64,6]`）。扩展端若要接入，需要单独的下发与校验通道，不能直接塞进 `djsc_weights_v3`。
