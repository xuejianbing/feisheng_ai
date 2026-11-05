# Noname-AI（无名AI）｜通用卡牌博弈决策引擎

> 面向无名杀的 AI 决策扩展。项目在规则决策基础上整合状态感知、关系判断、行为策略、模型推理、学习校准、回放诊断与自动测试。

## 项目定位

本仓库基于 **飞升** 原版无名AI持续维护，重点处理实际对局中的 AI 决策错误、策略一致性、模块稳定性与可测试性。

- **原作者 / Original Author：飞升**
- **当前维护者 / Current Maintainer：WeiqiaoCode（微雀qiao）**
- **当前版本：v3.1β（semver 3.1.1）**
- **许可证：GPL-3.0**
- **上游游戏项目：[无名杀 / libnoname/noname](https://github.com/libnoname/noname)**

完整贡献者信息见 [CONTRIBUTORS.md](CONTRIBUTORS.md)，版本历史见 [CHANGELOG.md](CHANGELOG.md)，当前维护计划见 [TODO.md](TODO.md)。

## 这个项目目前包含什么

| 模块 | 作用 |
|---|---|
| **决策系统** | 出牌、响应、弃牌、目标选择、装备、判定、技能、资源与时机决策 |
| **关系与状态层** | 统一玩家状态快照、敌我关系、威胁与动作效用 |
| **特殊牌 Evaluator** | 铁索连环、借刀杀人、桃园结义、五谷丰登等专项策略 |
| **安全护栏** | 对明显错误动作进行保护，例如敌方濒死时误出桃 |
| **模型系统** | 130维特征 → 128 → 64 → 6 标签 + Critic 价值头 |
| **学习与校准** | localTrainer、自动学习、校准器、A/B 模型状态机、策略进化 |
| **感知与记忆** | 身份观察、玩家/牌堆记忆、对手预测、团队意图与对局日志 |
| **可视化工具** | AI 大脑总览、校准趋势、决策回放、决策对比、自检面板 |
| **测试与验证** | 单元/契约测试、行为回归测试、分层自检与语义审计 |

## v3.1β 重点改进

当前版本重点收敛“同一局面只有一套事实解释、同一种最终决策只有一个权威策略”，近期已覆盖：

- **桃救援**：阻止 AI 在敌方/中性角色濒死时错误使用【桃】。
- **铁索连环**：按全局横置状态评估单目标、双目标与重铸，而不是固定选两个目标。
- **无懈可击 / 判定区 / 拆顺逻辑**：加强敌我方向和状态收益的一致性。
- **特殊锦囊**：为借刀杀人、桃园结义、五谷丰登等建立独立 evaluator。
- **状态与关系收敛**：统一 player snapshot、relations 与 action utility，减少多套并行规则。
- **工程稳定性**：完善 hook 生命周期、缓存失效、异常诊断和行为回归测试。

详细变更请查看 [CHANGELOG.md](CHANGELOG.md)。

## 当前模型契约

> **FEATURE_DIM = 130；网络 130 → 128（GELU + LayerNorm）→ 64（GELU + LayerNorm）→ 6 标签 + Critic 价值头；权重 Int8（SCALE=128）／偏置 Int16；权重快照 VERSION=7。**

旧 48 / 96 维模型与训练数据与当前契约不兼容，载入时会被版本/维度校验拒收。

---

## 一、快速开始

### 1.1 安装

1. 当前仓库尚未发布正式 GitHub Release；请从仓库下载源码或使用后续发布的 Release 包
2. 将扩展文件放入无名杀扩展目录
3. 重载扩展即可

### 1.2 验证安装

打开无名杀控制台（F12），跑：

```javascript
// 自检所有模块
(function () {
  const D = window.__DJSC;
  const lines = [];
  const checks = [
    ['weights', 'object'], ['features', 'function'], ['engine', 'function'],
    ['calibrator', 'object'], ['metaCognition', 'object'],
    ['cognitionLog', 'object'], ['conflict', 'object'],
    ['multiProfile', 'object'], ['strategyBus', 'object'],
    ['modelGuard', 'object'], ['elementFB', 'object'],
    ['weightPersist', 'object'], ['crossMode', 'object'],
    ['compare', 'object'], ['hotSwap', 'object'],
    ['shared', 'object'], ['evolution', 'object'],
  ];
  checks.forEach(function ([k, t]) {
    const v = D[k];
    const ok = t === 'object' ? (v && typeof v === 'object') : typeof v === t;
    lines.push((ok ? '✅' : '❌') + ' ' + k);
  });
  alert(lines.join('\n'));
})();
```

### 1.3 打开面板

| 面板 | 控制台调用 | 配置面板按钮 |
|---|---|---|
| AI 大脑总览 | `window.__DJSC.openBrainDashboard()` | 🧠 打开 · AI 大脑总览 |
| 校准趋势 | `window.__DJSC.openCalibratorPanel()` | 📈 打开 · 决策校准趋势 |
| 决策回放 | `window.__DJSC.openReplayPanel()` | 🎬 打开 · 决策回放时间轴 |
| 决策对比 | `window.__DJSC.openComparePanel()` | ⚖️ 打开 · 决策对比模式 |
| 模型热更新 | `window.__DJSC.hotSwap.stats()` | 🔥 打开 · 模型热更新 |
| 公共知识库 | `window.__DJSC.shared.stats()` | 🤝 打开 · 公共知识库 |
| 策略进化 | `window.__DJSC.evolution.stats()` | 🧬 打开 · 策略进化 |
| 模块自检 | `window.__DJSC.openSelfCheck()` | 🔍 打开 · 模块自检面板 |

---

## 二、系统架构

### 2.1 整体闭环

```
┌─────────────────────────────────────────────────────────┐
│                    AI 大脑（当前运行形态）                │
├─────────────────────────────────────────────────────────┤
│  感知层：状态 / 关系 / 牌堆 / 身份 / 对手与团队意图      │
│  规则层：候选生成 + 规则评分 + 专项 evaluator             │
│  主策略：Champion Strategy 对同类型候选提权/替换           │
│  模型层：v7 模型用于置信度、校准、训练观测与条件式复核      │
│          （模型未 ready 时 fail-closed，不得影响最终动作） │
│  深思层：deepThink 仅在模型 ready 且满足触发条件时复核     │
│  护栏层：modelGuard 在执行前做最终红线检查                 │
│  学习层：样本记录 / TD value_target / A-B Candidate        │
│  观测层：日志 / 冲突 / 回放 / 对比 / 自检 / Dashboard      │
└─────────────────────────────────────────────────────────┘
```

> 当前代码中，模型逐动作直接加权已关闭（`wModel = 0`），`strategyBus` 的模型仲裁接管也处于停用状态。模型具备合法 v7 权重并处于 ready 状态时，仍可参与置信度、校准与 `deepThink` 条件式复核；未 ready 时由 readiness guard 直接跳过。

### 2.2 决策流程

```
枚举候选动作
    ↓
规则评分 + 专项 evaluator
    ↓
先得到规则 best
    ↓
Champion Strategy（当前主要学习接管层）
    ↓
模型 ready ?
    ├─ 否 → 跳过模型改写
    └─ 是 → 置信度/校准/冲突观测 + deepThink 条件式复核
    ↓
modelGuard 最终护栏
    ↓
输出最终动作
    ↓
记录样本 / 回放 / 诊断
    ↓
局结束 → TD/异步反馈 → Candidate A/B → 持久化与统计
```

---

## 三、模块文档

### 3.1 核心模块

#### features.js — 特征提取（130维，FEATURE_DIM）

```javascript
// 维度分配（权威清单以 features.js 内的 DIM_NAMES / 段注释为准）
0-47   基础局面特征（血量/手牌/装备/敌人等，沿用初代布局）
48-95  时序特征 + AI 自我状态 + 相对强度 + 元认知干预 + 概率/牌堆/全局校准
96-129 技能标签/身份/阶段等扩展特征（含少量预留位）

// 使用
const f = new Int8Array(130);
window.__DJSC.extractFeatures(me, act, ctx, f);
```

#### weights.js — 多层网络（130→128→64→6 + Critic）

```javascript
// 结构：GELU 激活 + 每层 LayerNorm；"残差"为并联可训练线性投影（非 identity shortcut）
// 量化：权重 Int8（SCALE=128）／偏置 Int16；快照契约 VERSION=7
// 接口
getWeights() / getBias()   // 旧接口兼容
predict(features)           // 推理
__getW1() / __getB1()      // 隐藏层权重（供热更新）
__getW2() / __getB2()      // 输出层权重（供热更新）
__applySnapshot(snapshot)   // 热替换权重（维度/类型/版本校验，fail-closed）
saveWeights()               // 保存到本地存储（中央存储抽象，配额安全）
```

#### engine.js — 决策引擎

```javascript
// 核心函数
bestAction(me)              // 主决策入口
rulesDecide(me, acts)       // 规则打分
modelDecision(me, acts)     // 模型预测
settle()                    // 局结算（自动归档+校准+热更新+进化）
```

### 3.2 学习模块

#### metaCognition.js — 6维元认知

```javascript
// 6维架构
元素认知 35% / 模式认知 15% / 局面类型 15%
目标认知 10% / 局势认知 15% / 时间压力 10%

// 输出
{
  familiarity: 0~1,      // 熟悉度
  modulator: 0.5~1.0,    // 调制因子
  level: 'high'|'mid'|'low',
  intervention: 'model'|'blend'|'rule'|'skip'
}
```

#### decisionCalibrator.js — 自动校准

```javascript
// 偏移维度
{ atk, def, wAtkCard, wDefCard, modelTrust }

// 规则
单次调整 ≤ 0.03
累计偏差 ≤ 0.3
学习率衰减 0.95

// 接口
weights()          // 获取当前偏移
reset()            // 归零
stats()            // 统计信息
```

#### multiProfile.js — 多档案协同

```javascript
// 预置档案
均衡型 / 激进型 / 保守型 / 守护型 / 独狼型

// 融合规则
每 3 局融合一次
胜率 < 0.4 降权 0.5
胜率 > 0.6 升权 1.5
低胜率可模仿高胜率（70%自己+30%最优）

// 接口
effectiveShift()   // 获取当前有效偏移
recordResult(key, win)
imitateBest(key)
list()             // 所有档案
stats()            // 统计
```

### 3.3 决策模块

#### strategyBus.js — 策略总线

```javascript
// 触发条件
规则和模型都高置信（>0.55）但结论不同

// 仲裁方式
分差 > 5 → 直接选高分
调用 planner 走 2 步预测
简化版：检查目标是否有反制手段

// 接口
arbitrate(ruleBest, modelPick, me, candidates)
stats()
```

#### modelGuard.js — 模型护栏

```javascript
// 8条红线
打队友 / 过度出牌 / 自残 / 无意义装备等

// 冷却
30分钟

// 接口
check(action, me)
status()
```

### 3.4 观测模块

#### cognitiveLog.js — 认知日志

```javascript
// 记录内容
每次决策的完整链路
干预级别 / 模型置信 / 规则打分

// 接口
log(entry)
stats()
```

#### conflictDetector.js — 认知冲突检测

```javascript
// 检测
规则 vs 模型的决策分歧

// 接口
detect(ruleBest, modelPick)
stats()
```

### 3.5 进化模块

#### weightPersist.js — 权重持久化

```javascript
// 原理
把校准偏移固化进输出层偏置 B2
atk>0 → B2[D]（进攻标签）增加
def>0 → B2[C]（保守标签）增加
modelTrust>0 → 所有 B2 减小

// 触发
每局结束消化一次，消化后 shift 归零

// 接口
digest(shift, weightsModule)
onSettle()
stats()
```

#### crossModeTransfer.js — 跨模式迁移

```javascript
// 分层
global 层：技能/卡牌通用
modes 层：身份/国战/斗地主专精

// 读写规则
读取：当前模式 > 全局
写入：按 kind 自动分层
skill/card → global
character/identity/faction → mode

// 自动提升
某元素在 ≥3 个模式都出现 → 提升为全局

// 接口
read(kind, id)
write(kind, id, patch)
promote(kind, id, threshold)
autoPromote(threshold)
```

#### evolution.js — 策略进化

```javascript
// 遗传算法
种群大小：8
精英保留：Top 2
杂交：Top 40% 两两混合，单点交叉
变异：15% 概率随机扰动 ±0.08
淘汰：Bottom 20%
进化间隔：每 5 局

// 接口
record(genomeId, win)
current()          // 获取当前最优基因组
stats()
forceEvolve()
```

#### modelState.js — 统一 A/B 状态机（§8：modelHotSwap 已并入，原文件为兼容外壳）

```javascript
// 状态流转（单一真相源，原 modelState/modelHotSwap 双状态机已合并）
STABLE → trainCandidate() → CANDIDATE → evaluate() → PROMOTE / DISCARD → STABLE
// 不变式：STABLE 时无候选；CANDIDATE 时 stable 快照不动、每局明确分组；
//         PROMOTE 换入候选并持久化；DISCARD 还原稳定模型。

// 流程
攒够 300 样本 → 触发训练（手动 forceTrain / 自动 triggerHotTrain 共用同一候选槽）
训练结果存为"候选模型"（快照含 w1..pr2 全参数，经 MODEL_SCHEMA 结构护栏校验）
候选跑 20 局 A/B 测试（每局交替分组，候选局真实换入候选权重）
胜率超过旧模型 5% → 自动替换
否则丢弃

// 接口（window.__DJSC.hotSwap.* 保持兼容，由 modelHotSwap.js 外壳挂载）
trigger()          // 手动触发训练
recordScore(score)
gameStart()        // 开局分组
promote()          // 手动晋升
discard()          // 手动丢弃
stats()
```

#### sharedKnowledge.js — 协同学习

```javascript
// 局面指纹
血量段 + 手牌段 + 敌人 HP 段 + 集火状态

// 群体智慧
每个指纹下记录"选择→胜率"
高置信（≥3样本）→ 给候选加分

// 接口
contribute(me, action, outcome)
recommend(me, ctx)
applyBonus(me, acts, ctx)
stats()
list(n)
```

---

## 四、开发者规范

### 4.1 代码风格

```javascript
// 1. 所有模块统一挂载到 window.__DJSC
window.__DJSC = window.__DJSC || {};
window.__DJSC.xxx = { ... };

// 2. 所有导出函数都必须 try-catch 包裹
export function xxx() {
    try {
        // 逻辑
    } catch (e) {
        // 静默失败，不影响游戏
    }
}

// 3. 业务模块不得直接读写 localStorage，统一走中央 storage 抽象
import { safeGet, safeSet, getJSON, setJSONQuotaSafe } from './foundation/storage/storage.js';

// 4. 变量命名
// 私有变量：_xxx（下划线开头）
// 公开接口：xxx（无下划线）
// 常量：XXX（全大写）

// 5. 注释规范
// 文件头：说明模块用途、原理、触发条件
// 关键逻辑：说明为什么这么做
// 函数：说明参数、返回值、副作用
```

### 4.2 新增模块规范

```javascript
// 1. 文件位置按职责进入 foundation / cognition / decision / model / perception / view 等域
//    具体归属以 score/_DOMAIN.md 为准

// 2. 诊断统一使用 foundation/diag；持久化统一使用 foundation/storage
import { log } from './foundation/diag/logger.js';
import { getJSON, setJSONQuotaSafe } from './foundation/storage/storage.js';

// 3. 对外接口优先通过 registry / plugin 生命周期统一挂载，避免直接覆盖 window.__DJSC
//    兼容旧接口时也必须采用幂等软合并，禁止 window.__DJSC = { ... } 覆盖全局

// 4. 只有确实需要跨局保存的数据才建立 STORAGE_KEY；业务层不得直接 localStorage
const STORE_KEY = 'djsc_xxx_v1';

// 5. 可观测模块应提供 stats()；只有存在可重置状态时才提供 reset()
export function stats() { ... }

// 6. 新模块应接入对应 plugin / index / runtime 生命周期，不再默认要求塞进 engine.js

// 7. 新增关键模块后同步自检/契约测试；行为修复优先增加 regression test
```

### 4.3 面板开发规范

```javascript
// 1. 统一用全屏遮罩（不用 ui.create.dialog）
function _openFullscreenPanel(title, html) {
    // 关闭旧面板
    if (window.__DJSC_PANEL) {
        window.__DJSC_PANEL.remove();
        window.__DJSC_PANEL = null;
    }
    // 创建全屏面板
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; ...';
    // 挂到 document.body
    document.body.appendChild(panel);
    window.__DJSC_PANEL = panel;
}

// 2. 统一颜色
// 背景：#0a1018
// 面板：#14243c
// 主文字：#dbe7f5
// 标题：#9ad8ff
// 成功：#7fe3a0
// 警告：#ffd479
// 错误：#ff9c9c

// 3. 必须有关闭按钮
const closeBtn = document.createElement('div');
closeBtn.textContent = '✕ 关闭';
closeBtn.addEventListener('click', () => {
    panel.remove();
    window.__DJSC_PANEL = null;
});
```

### 4.4 特征系统规范

```javascript
// 1. 不新增维度，只填充预留位；扩容必须同步升 FEATURE_DIM 与权重快照 VERSION
// 130维固定，预留位见 features.js 段注释（DIM_NAMES 中标"预留"的下标）

// 2. Int8 范围 [-127, 127]
// 量化函数：q(v) = Math.round(v * 127)

// 3. 时序特征需要归一化
// 例如：f[62] = q(熟悉度)  // 0~1 → 0~127

// 4. 新增特征必须在 features.js 注释说明维度分配
```

### 4.5 权重系统规范

```javascript
// 1. Int8 权重量化，SCALE = 128（偏置为 Int16）
// 实际值 = int8_value / SCALE

// 2. 权重经中央存储抽象保存：djsc_weights_v3（业务层不得直调 localStorage）

// 3. 热更新用 __applySnapshot(snapshot)
// snapshot 必须与当前契约同构：v=7、130/128/64/6、Int8 权重 + Int16 偏置（含投影/Critic），否则 fail-closed 拒收

// 4. 权重修改后必须 saveWeights()
```

---

## 五、注意事项（必看）

### 5.1 常见坑

| 坑 | 解决方案 |
|---|---|
| 新建模块后忘记在 engine.js 加 import | 挂载代码不执行 → 自检报 undefined |
| 用 ui.create.dialog 打开面板 | 内容区空白 → 改用全屏遮罩 |
| 静态 import 导致整个 extension.js 加载失败 | 改成在 engine.js 显式 import |
| node --check 抓不到 ESM 顶层裸 return | 用 `node --input-type=module --check < file` |
| 硬拦截 useCard 返回 null 会导致游戏崩溃 | 改成仅日志不拦截 |
| 控制台不支持 console.table | 用纯文本字符串拼接 |
| `window.__DJSC={...}` 直接赋值覆盖其他模块 | 必须用 `Object.assign` 或 `|| {}` |

### 5.2 性能注意

| 项 | 说明 |
|---|---|
| 特征提取 | 每次决策都跑，必须 O(n) 复杂度 |
| 元认知计算 | 轻量，不超过 1ms |
| 校准器观察 | 1500ms 延迟，不阻塞决策 |
| 热更新训练 | 后台异步，不阻塞游戏 |
| 持久化读写 | 统一走中央 storage 抽象；大对象使用配额安全写入 |
| 面板渲染 | 大数据量用虚拟滚动 |

### 5.3 数据持久化

| Key | 内容 | 上限 |
|---|---|---|
| djsc_weights_v3 | 模型权重 | 固定 |
| djsc_element_shadow_v1 | 元素影子表 | 自动清理 |
| djsc_metacog_v1 | 元认知数据 | 自动清理 |
| djsc_calibrator_v1 | 校准器偏移 | 累计 ≤ 0.3 |
| djsc_calib_history_v1 | 校准历史 | 200 条 |
| djsc_multi_profile_v1 | 多档案数据 | 8 个档案 |
| djsc_replay_v1 | 决策回放 | 20 局 × 50 条 |
| djsc_model_state | A/B 模型状态与候选快照 | 1 个候选（旧 `djsc_hotswap_v1` 仅用于一次性迁移） |
| djsc_shared_knowledge_v1 | 公共知识库 | 500 条 |
| djsc_evolution_v1 | 进化种群 | 8 个个体 |

### 5.4 兼容性

| 项 | 说明 |
|---|---|
| 130维特征（当前） | 旧 48/96 维模型与训练数据均不兼容，载入会被维度/版本校验拒收；需清空旧数据 |
| 旧训练数据 | 需执行 `window.__DJSC.trainBufferClear()` |
| 面板系统 | 全屏遮罩版，兼容所有无名杀版本 |
| 本地持久化 | 业务层统一走 `foundation/storage`；底层可落到浏览器本地存储，清理本地站点数据会重置相应状态 |

---

## 六、调试技巧

### 6.1 快速验证

```javascript
// 1. 看所有模块挂载状态
Object.keys(window.__DJSC).forEach(k => console.log(k, typeof window.__DJSC[k]));

// 2. 看校准器偏移
console.log(window.__DJSC.calibrator.weights());

// 3. 看当前元认知
console.log(window.__DJSC.metaCognition.modulate({ type:'card', id:'sha' }, {}));

// 4. 看多档案状态
console.log(window.__DJSC.multiProfile.stats());

// 5. 看进化种群
console.log(window.__DJSC.evolution.stats());
```

### 6.2 清空数据

```javascript
// 清空所有学习数据
window.__DJSC.calibrator.reset();
window.__DJSC.metaCognition.reset();
window.__DJSC.multiProfile.reset();
window.__DJSC.weightPersist.reset();
window.__DJSC.crossMode.reset();
window.__DJSC.compare.reset();
window.__DJSC.hotSwap.reset();
window.__DJSC.shared.reset();
window.__DJSC.evolution.reset();
window.__DJSC.replay.reset();

// 清空训练样本
window.__DJSC.trainBufferClear();

// 清空权重（恢复默认）
localStorage.removeItem('djsc_weights_v3');
```

---

## 七、技术参数速查

| 参数 | 值 |
|---|---|
| 特征维度 | 130 维（FEATURE_DIM） |
| 网络结构 | 130 → 128(GELU+LayerNorm) → 64(GELU+LayerNorm) → 6 + Critic |
| 权重快照版本 | VERSION=7（Int8 权重 / Int16 偏置） |
| Int8 范围 | [-127, 127] |
| 权重 SCALE | 128 |
| 训练样本阈值 | 200（fast=300，slow=1000） |
| 元认知熟悉度分级 | ≥0.7 high，≥0.4 mid，<0.4 low |
| 干预级别权重 | model=0.5 / blend=0.3 / rule=0.1 / skip=0 |
| 护栏冷却 | 30 分钟 |
| 校准器单次调整 | ≤ 0.03 |
| 校准器累计偏差上限 | ≤ 0.3 |
| 校准器学习率衰减 | 0.95 |
| 多档案融合间隔 | 每 3 局 |
| 多档案胜率降权 | <0.4 降权 0.5 |
| 多档案胜率升权 | >0.6 升权 1.5 |
| 权重持久化学习率 | DIGEST_LR=8 |
| 热更新样本阈值 | 300 |
| 热更新 A/B 局数 | 20 |
| 热更新晋升阈值 | 胜率 +5% |
| 进化种群大小 | 8 |
| 进化精英保留 | Top 2 |
| 进化间隔 | 每 5 局 |
| 变异率 | 15% |
| 变异幅度 | ±0.08 |
