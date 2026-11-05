# 无名AI 二次开发指南

> 版本：v3.1β（semver 3.1.1）
> 最后更新：2026-10-02

---

## 📁 目录结构

```
Noname-AI/
├── extension.js            # 扩展入口
├── js/                     # 扩展外壳：bootstrap / config / content / help / shared
├── score/                  # AI 内核（按职责分域）
│   ├── index.js            # ★ 对外入口
│   ├── foundation/         # 宿主适配 / 配置 / 存储 / runtime / 诊断
│   ├── cognition/          # 深度思考 / 元认知 / 推理 / 解释
│   ├── decision/           # engine / evaluator / 策略 / 护栏 / 基础决策
│   ├── knowledge/          # 通用知识与数值表
│   ├── model/              # 130维特征 / v7权重 / 训练 / A-B状态机
│   ├── perception/         # 身份 / 记忆 / 对局日志 / 队友意图 / 回放
│   ├── plugins/            # 插件生命周期接入
│   ├── verification/       # 自检 / 分层验证 / semantic audit
│   ├── view/               # dashboard / panel / report / autoplay
│   └── _DOMAIN.md          # ★ 域结构索引（新增代码前先读）
├── tests/                  # release gate + 行为回归
├── build/                  # semantic audit / defaultWeights 离线训练
└── DEV_GUIDE/              # 本目录
```

> **路径约定**：为便于阅读，下文代码片段中的 `import { x } from './foo.js'` 一律是简写，
> 实际应写 `import { x } from './score/<域>/foo.js'`（跨域用相对路径，例如
> `decision/engine/engine.js` 引用特征模块应使用其真实相对路径）。具体域归属见 `score/_DOMAIN.md`。

---

## 🚫 绝对不能动的地方

### 1. 不要动 give/giveVs/givePair 的签名

```js
// ✅ 正确
give(char, pts, tag);

// ❌ 错误：不要改参数数量或顺序
give(char, pts);        // 少了 tag
give(char, pts, tag, extra);  // 多了参数
```

**为什么**：这三个函数是整个记分系统的入口，改签名会导致所有模块崩。

### 2. 不要动 bestAction 的返回值

```js
// ✅ 正确
return { action: 'useCard', card: card, target: target };
return { action: 'C' };  // 结束回合

// ❌ 错误
return { action: 'use', card: card };  // action 必须是 useCard
```

### 3. 不要动 Int8 值域（全整数值规范）

**所有值都是整数，没有小数**。

```js
// ✅ 正确：用 toInt8() 转换，所有值都是整数
import { toInt8, toFloat } from './scoreUnify.js';
round[k] = toInt8(rawValue);  // 永远是整数，范围 [-127, 127]

// ❌ 错误：直接写浮点
round[k] = 1.234567;  // 溢出！
```

**分层量化算法**：

| 层级 | 浮点范围 | Int8 范围 | 精度 |
|------|---------|----------|------|
| 第一层（小分数） | 0~10 | 0~50 | 0.2 |
| 第二层（中分数） | 10~50 | 50~100 | 0.8 |
| 第三层（大分数） | 50+ | 100~127 | 1.85 |

**叠加时就饱和**：

```js
// give 函数内部逻辑（不要改）
const currentFloat = toFloat(round[k] || 0);  // 反量化当前值
const newFloat = currentFloat + ptsInt;      // 叠加（ptsInt 必须是整数）
round[k] = toInt8(newFloat);                  // 再量化
```

**规则**：
- 所有 `give()` 的 `pts` 参数必须是整数（Math.round）
- 所有 `acts.score` 必须是 Int8（toInt8）
- 所有 `features.f` 必须是 Int8（Int8Array）
- 所有 `weights.W` 必须是 Int8（Int8Array）
- **绝对不能出现小数**

**为什么**：整个系统用 Int8 [-127, 127] 压缩浮点，直接写浮点会溢出。

---

## ✅ 可以安全扩展的地方

### 1. 新增模块

在 `score/<对应域>/` 下新建一个 `.js` 文件（域归属见 `score/_DOMAIN.md`），
然后在 `score/decision/engine.js` 顶部 import。

**模板**：

```js
/* score/<域>/myModule.js */
export function myBonus(ctx) {
    // 你的逻辑
    return 0;  // 返回分值加成
}
```

然后在 `score/decision/engine.js` 里：

```js
import { myBonus } from '../<域>/myModule.js';

// 在评分时加上
s += myBonus(ctx);
```

### 2. 新增配置项

在 `js/config.js` 里加：

```js
myNewOption: {
    name: '🔧 我的新选项',
    init: true,
},
```

然后在代码里用：

```js
if (cfg('myNewOption')) {
    // 选项开启时执行
}
```

### 3. 新增面板按钮

在 `js/panel.js` 的 installDebugBridge 里加：

```js
myNewButton: function () {
    alert('我的按钮被点击了');
    return 'ok';
},
```

---

## ⚠️ 容易踩坑的地方

### 1. 阵营判断

```js
// ✅ 正确：用 modeStrategy 的 getCamp
import { getModeStrategy } from './modeStrategy.js';
const strategy = getModeStrategy();
if (strategy.getCamp(me) === strategy.getCamp(target)) {
    // 是队友
}

// ❌ 错误：直接用 get.attitude
if (get.attitude(me, target) > 0) {
    // 是队友（斗地主/国战可能不准！）
}
```

**为什么**：斗地主/国战模式下 get.attitude 可能返回 0（中立），必须用 modeStrategy 的 getCamp。

### 2. 牌堆查询

```js
// ✅ 正确：用 deckMemory 的接口
import { cardRemaining, suitRemaining } from './deckMemory.js';
const shaRemain = cardRemaining('sha');

// ❌ 错误：直接读内部变量
const remain = REMAINING['h|3'];  // REMAINING 是私有变量！
```

### 3. 特征提取

```js
// ✅ 正确：用 extractFeatures
import { extractFeatures } from './features.js';
const f = extractFeatures(me, act, ctx);

// ❌ 错误：手动构造
const f = new Int8Array(130);
f[0] = 127;  // 不得绕过 features.js 的 FEATURE_DIM / DIM_NAMES 契约
```

**为什么**：当前特征契约为 `FEATURE_DIM = 130`。维度、槽位语义和量化方式必须以 `score/model/features/features.js` 为唯一来源；扩容还必须同步升级模型快照契约。

### 4. 训练数据

```js
// ✅ 正确：用 pushSample
import { pushSample } from './trainExport.js';
pushSample(features, reward, meta);

// ❌ 错误：直接操作 BUFFER
BUFFER.push({ f: features, r: reward });  // BUFFER 是私有变量！
```

---

## 🧪 调试技巧

### 1. 查看当前评分

```js
// 控制台输入
window.__DJSC.deckGetMode();  // 查看当前模式
window.__DJSC.deckTotal();    // 查看牌堆剩余
window.__DJSC.trainBufferSize();  // 查看训练样本数
```

### 2. 查看决策记录

```js
// 控制台输入
window.__DJSC.getDecisionLog();  // 查看最近的决策记录
```

### 3. 查看面板

```js
// 控制台输入
window.__DJSC.openSmartPanel();  // 打开智能可视化面板
```

---

## 📊 数据格式

### 1. 训练样本格式

```js
{
    f: [Int8 x 130],  // 特征向量（FEATURE_DIM=130）
    r: Int8,           // reward（-127 ~ 127）
    m: {               // 元数据（可选）
        mode: 'identity',
        round: 5,
    }
}
```

### 2. 权重格式

```js
{
    v: 7,               // MODEL_SCHEMA.version
    dv: 2,              // DATA_EPOCH（训练数据纪元）
    trained: 12345,
    accuracy: 0.62,
    // 多层参数：隐藏层、输出层、投影与 Critic 参数
    // 权重 Int8，偏置 Int16；具体字段以 weights.js 的 MODEL_SCHEMA / snapshot 校验为准
}
```

---

## 🔄 版本更新规则

1. 对外版本遵循仓库当前 semver（现为 3.1.1，对应展示版本 v3.1β）
2. Bug 修复、功能新增和不兼容改动按 semver 语义升级
3. 模型结构、特征维度或快照格式变化时，必须同步升级 `MODEL_SCHEMA.version`，不能只改展示版本

---

## 📝 提交规范

1. 每次更新只发有变化的文件（增量 zip）
2. 每次更新新增对应版本号更新日志文件
3. 改完必须全量 ESM 复检
4. 配置页按钮用斗转星移风格
5. 每个小项目单独做大按钮，竖排排列，不重叠

---

## 🆘 常见问题

### Q: AI 打队友怎么办？

A: 检查 modeStrategy 的 getCamp 是否正确识别了队友。斗地主/国战模式下 get.attitude 可能不准。

### Q: 训练数据为空怎么办？

A: 检查 trainRecordSample 是否被调用。在 bestAction 里加：

```js
try { trainRecordSample(me, best, sit, best.score); } catch (e) {}
```

### Q: 模型准确率很低怎么办？

A: 
1. 样本量不够（需要 ≥200）
2. 特征维度/槽位契约不对（当前必须严格遵循 FEATURE_DIM=130）
3. reward 太稀疏（用边际收益，不要用最终得分）

---

## 📞 联系方式

- 作者：飞升
- 当前维护：WeiqiaoCode（微雀qiao）
- 面板开发：WeiqiaoCode（微雀qiao）、星の语
- 功能开发：夜白
- 内测宣传：小小王同志

---

**记住**：改代码前先读这个文件，改完后先跑控制台测试，确认没问题再提交。
