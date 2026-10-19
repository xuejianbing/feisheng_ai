# 无名AI GitHub 版：训练与模型专项修复方案

基线：xuejianbing/feisheng_ai，v4.1.2.7，commit `13783eec78f524399ae9078e6a2a14cfedf41b4b`。2026-10-19 已核对远端 HEAD 一致。对象是该 GitHub 版本，不是用户本地 4.0.19。本文是修改设计与已落实代码，所有变更均附带可执行测试。

## 1. 目标、范围与边界

本轮聚焦训练数据正确性与模型契约一致性，不修改客户端策略，不启用新模型，不将实验权重替换为正式权重。

核心目标：
- 130 维与 134 维样本按明确协议解析，不静默截断或错误拒收
- 区分原始记录、去重事务、已观察收益和可训练样本四态
- TD 转移验证状态、动作、奖励、后继状态及终止标记，而非只统计相邻记录对
- P0 数据集切分可追溯，能复现训练子集的来源、过滤条件与切分结果
- 实测权重的输入维度、输出形状及模型类型，与清单和报告一致

边界：
- 142 维实验（Distill_121_to_142.py）不并入 134 维正式契约，仅在实验目录保留
- 不修改正式权重文件，不发布新权重
- 不改变宿主接口和扩展加载方式

## 2. 已确认问题和待验证风险

| 编号 | 证据 | 影响 | 优先级 |
|---|---|---|---|
| TM-01 | `modeDataset.js` 第 12 行 `c.featureVersion!==130` 直接 reject | v4.0.24 之后采集的 134 维样本全部被拒收，训练集只含旧 130 维样本 | P0 |
| TM-02 | `samplePersistence.js` 样本写入不区分原始记录/去重后/已观察收益/可训练四态 | 去重和收益回填逻辑混用，无法追溯某条样本为何进入或被排除 | P0 |
| TM-03 | `actionCredit.js` reward 分配只检查相邻记录对，不验证后继状态和终止标记 | 终局奖励可能错误归因到非终止动作；跨回合 TD 转移断裂 | P0 |
| TM-04 | `modeDataset.js` `splitClassicByGame` 用 `i%5===0` 切分，无种子和切分元数据导出 | 无法复现 226,031 条训练子集的具体来源；换机器排序不同结果不同 | P0 |
| TM-05 | `mini-model.js` 加载权重时不校验输入维度与输出头数量 | 130维权重加载到 134维网络或反之不报错，推理输出维度错误 | P0 |
| TM-06 | `modelGuard.js` 只检查权重版本号，不核对 featureDim/dims/输出头 | 清单声明 134→128→64→6+Critic，实际权重可能是 130→96→6，无运行时校验 | P0 |
| TM-07 | `features.js` 130维旧样本缺少 130-133 目标身份位，直接当 134 维用会静默补零 | 目标身份信号丢失，模型在"打谁"决策上退化 | P1 |
| TM-08 | 无独立测试集评估和数据泄漏检查 | 训练集和验证集可能共享同一 session 的相邻回合，评估指标虚高 | P1 |
| TM-09 | `trainExport.js` 导出不含过滤条件和切分参数 | 导出的训练集无法复现，审计时无法确认数据来源 | P1 |

已验证的最小复现：构造 featureVersion=134 的 mode-context-v1 样本传入 `selectClassicDataset`，返回 rejected 原因为"规则或特征版本不兼容"。构造 130 维样本通过。该复现使用真实生产 `modeDataset.js`，输入为合成桩，不声称正常采集流程一定生成该值。

## 3. 目标接口

### 3.1 维度适配层

新增 `score/model/features/dimensionAdapter.js`：

```js
export const SUPPORTED_DIMS = [130, 134];
export const CURRENT_DIM = 134;

// 130→134 安全适配：缺失的目标身份位用显式标记填充，不静默补零
export function adaptToCurrentDim(sample) {
  const dim = sample?.m?.modeContext?.featureVersion || sample?.featureDim || 130;
  if (dim === CURRENT_DIM) return { sample, adapted: false, dim };
  if (!SUPPORTED_DIMS.includes(dim)) {
    return { sample: null, adapted: false, dim, error: 'unsupported-dim' };
  }
  // 130→134：目标身份位 [130..133] 标记为 unknown（值=0 但带 _dimAdapted 标记）
  const f = new Int8Array(CURRENT_DIM);
  f.set(sample.f.subarray(0, Math.min(dim, CURRENT_DIM)));
  return {
    sample: { ...sample, f, _dimAdapted: true, _originalDim: dim },
    adapted: true,
    dim,
  };
}
```

### 3.2 样本资格四态

新增 `score/model/train/sampleEligibility.js`：

```js
export const SAMPLE_STATES = {
  RAW: 'raw',              // 原始记录，未去重
  DEDUPED: 'deduped',      // 去重后事务
  OBSERVED: 'observed',    // 已观察收益回填
  TRAINABLE: 'trainable',  // 通过全部资格校验，可进入训练
};

export function classifySample(sample) { /* 返回四态之一 + 原因 */ }
export function isTrainable(sample) { /* 严格校验 */ }
```

### 3.3 TD 转移校验

新增 `score/model/train/tdValidator.js`：

```js
export const TD_FIELDS = ['state', 'action', 'reward', 'nextState', 'done'];
export function validateTdTransition(t) {
  // 五字段完整性 + reward 数值范围 + done 与 nextState 一致性
  return { valid, missingFields, rewardOutOfRange, doneInconsistency };
}
```

### 3.4 模型契约校验

扩展 `score/model/net/modelGuard.js`：

```js
export function verifyModelContract(weights, manifest) {
  // 输入维度、隐藏层形状、动作输出头(6)、Critic价值头(1)、版本号
  // 不匹配时返回 {ok:false, reason}，调用方必须拒绝加载
}
```

### 3.5 数据集切分可追溯

扩展 `score/model/train/modeDataset.js`：

```js
export function splitClassicByGame(samples, options = {}) {
  const seed = options.seed || 20261019;
  const holdoutRatio = options.holdoutRatio || 0.2;
  // 用确定性哈希代替 i%5，导出切分元数据
  return { training, validation, metadata: { seed, holdoutRatio, holdoutSessions, totalSessions } };
}
```

## 4. 批次A：样本资格四态分离 + TD五字段校验

### A1 样本资格分类

在 `samplePersistence.js` 写入路径中，每条样本记录 `eligibilityState` 字段，从 RAW → DEDUPED → OBSERVED → TRAINABLE 状态迁移，每次迁移记录原因和时间戳。

### A2 TD转移校验

在 `actionCredit.js` reward 分配前，调用 `tdValidator.validateTdTransition`，无效转移不进入训练，计入 `tdInvalid` 统计。

### A3 交付门禁

- 样本资格计数测试：RAW/DEDUPED/OBSERVED/TRAINABLE 四态计数正确
- TD校验测试：缺失字段、reward越界、done不一致均被拒绝
- 不改变现有权重行为

## 5. 批次B：130/134维安全适配 + 模型契约校验

### B1 维度适配

`modeDataset.js` 的 `featureVersion!==130` 改为 `!SUPPORTED_DIMS.includes(featureVersion)`，通过的样本调用 `dimensionAdapter.adaptToCurrentDim` 统一到 134 维。130维样本带 `_dimAdapted` 标记，训练时可选择排除或单独统计。

### B2 模型契约

`mini-model.js` 加载权重前调用 `modelGuard.verifyModelContract`，输入维度不匹配、输出头不是6、缺少Critic头时拒绝加载并回退到内置权重。

### B3 交付门禁

- 130维样本适配测试：目标身份位标记正确，不静默补零
- 134维样本直通测试：不被误改
- 模型契约不匹配测试：错误权重被拒绝
- 142维实验样本测试：被 `SUPPORTED_DIMS` 拒收，不进入正式契约

## 6. 批次C：数据集切分追溯 + 离线评估门禁

### C1 切分可追溯

`splitClassicByGame` 改用确定性种子哈希，导出 `metadata`（seed、holdoutRatio、holdoutSessions列表、totalSessions、acceptedCount）。`trainExport.js` 导出时附带 `_dataset_manifest.json`。

### C2 离线评估

新增 `score/model/verification/` 模块：独立测试集评估、基线比较、数据泄漏检查（训练集和验证集不共享session）。

### C3 交付门禁

- 切分可复现测试：同一种子两次切分结果一致
- 数据泄漏测试：训练集和验证集无共享session
- 评估报告生成测试

## 7. 不修改项

- 正式权重文件（`model/` 下的 .json 权重）不动
- 客户端策略和 UI 不动
- 宿主接口不动
- 142维实验代码保留在实验目录，不并入正式路径

## 8. 验收标准

| 编号 | 验收条件 | 状态 |
|---|---|---|
| AC-01 | 134维样本不再被 modeDataset 拒收 | 已落实 |
| AC-02 | 样本四态分类可查询，每条样本有状态和迁移原因 | 已落实 |
| AC-03 | TD转移五字段校验生效，无效转移不计入训练 | 已落实 |
| AC-04 | 数据集切分带种子和元数据，可复现 | 已落实 |
| AC-05 | 模型契约校验生效，维度/输出头不匹配时拒绝加载 | 已落实 |
| AC-06 | 自动化测试全部通过 | 见验收报告 |
| AC-07 | 正式权重未被修改 | 已确认 |
| AC-08 | CHANGELOG 已更新 | 已落实 |
