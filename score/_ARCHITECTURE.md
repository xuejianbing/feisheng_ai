# 通用卡牌博弈AI决策引擎 · 架构与填写指南

> 本文件是**架构总览**与**接入填写指南**。目标：换游戏 / 换模型 / 加指标时，
> 你只需填一张表或注册一个函数，**内核零改动**。
> 自查就绪度：`__DJSC.proReady.text()`

---

## 一、四层架构总览

| 层 | 目录 | 职责 | 与具体游戏耦合 |
|---|---|---|---|
| 宿主适配层 | `score/foundation/adapt/host.js` | 唯一耦合点：把宿主运行时（配置/对局/界面/查询/内置对手/临时状态）暴露给内核 | **唯一**（可替换） |
| 领域模型层 | `score/foundation/adapt/terms.js`<br>`score/foundation/adapt/gameProfile.js` | 通用语义：攻击/防御/治疗/控制/延时/无效化/增益/补牌；阵营与关系；卡牌 id ↔ 语义映射 | 无 |
| 决策内核层 | `score/decision/`<br>`score/cognition/` `score/perception/` `score/knowledge/` | 感知 → 候选生成 → 逐层打分 → 收敛 → 复核 → 护栏 | 无 |
| 学习闭环层 | `score/model/` | 130 维特征契约、冠军策略、异步后检测、训练与回流、模型热更新 | 无 |

### 耦合现状（自动审计）

| 指标 | 权威来源 |
|---|---|
| 内核 JS 文件数 | `score/verification/semanticAudit.js → AUDIT.files` |
| 宿主耦合点 | **1**（`score/foundation/adapt/host.js`）✅ |
| 已完全语义化文件 | `AUDIT.cleanFiles / AUDIT.files` |
| 仍含游戏专有词表 | `AUDIT.legacyFiles` 个文件 / `AUDIT.hits` 处 |

> **宿主耦合已收敛到 `host.js`**；语义层已建立并作为新增模块的权威来源。
> 历史模块中的牌名/身份/阶段字面量仍在持续下沉。不要在本文手工维护快照数字：
> 运行 `node build/semantic_audit.mjs` 后，以生成的 `score/verification/semanticAudit.js` 为准。

配套：`score/view/`（面板）、`score/verification/`（自检）、`score/foundation/`（宿主适配 / 存储 / 总线 / 诊断）。

### 内核解耦的硬约束

```
grep -rn "noname.js" score/ --include=*.js
```

期望结果：**只命中 `score/foundation/adapt/host.js`**。若命中了别的文件，说明内核越界，需改道 `host.js`。

---

## 二、唯一耦合点：`core/host.js`

导出 6 个对象，构成适配契约：

| 导出 | 含义 |
|---|---|
| `lib` | 宿主配置与元素库 |
| `game` | 对局控制与全局状态 |
| `ui` | 界面渲染 |
| `get` | 查询与翻译工具 |
| `ai` | 内置对手 |
| `_status` | 运行时临时状态 |

**接入新游戏时**：把本文件改为从目标游戏运行时导出上述 6 个对象即可，内核一行都不用动。

---

## 三、换游戏：只填「游戏档案」

文件：`score/foundation/adapt/gameProfile.js`

| 字段 | 填什么 | 例（当前实现） |
|---|---|---|
| `id` | 档案唯一标识 | `noname` |
| `name` | 游戏名 | `无名杀` |
| `engine` | 引擎名 | `无名杀运行时` |
| `semanticIds.attack` | 攻击类卡牌 id 表 | `{sha:1, juedou:1, huogong:1, …}` |
| `semanticIds.defense` | 防御类 | `{shan:1}` |
| `semanticIds.heal` | 治疗类 | `{tao:1}` |
| `semanticIds.control` | 控制/掠夺类 | `{guohe:1, shunshou:1, …}` |
| `semanticIds.delay` | 延时类 | `{lebu:1, bingliang:1}` |
| `semanticIds.negate` | 无效化类 | `{wuxie:1}` |
| `semanticIds.buff` | 增益类 | `{jiu:1}` |
| `semanticIds.draw` | 补牌类 | **待填** |
| `phases` | 通用阶段 → 实际阶段名 | `{judge:'phaseJudge', …}` |
| `camps` | 阵营语义 → 身份名 | `{self:'自己', ally:'同阵营', …}` |
| `events` | 通用事件 → 实际事件名 | `{turnStart:'phaseBegin', …}` |
| `relationOf` | *(可选)* 关系判定，返回 `same/hostile/neutral/unknown` | `null`（用内核默认） |
| `winCondition` | *(可选)* 胜负判定，返回 `win/lose/ongoing` | `null`（用内核默认） |

### 填写方式

```js
/* 方式一：完整替换（复制 EMPTY_PROFILE 填完传入） */
__DJSC.profile.setProfile({ /* …完整档案… */ });

/* 方式二：局部覆盖（只改想改的字段，其余沿用当前档案） */
__DJSC.profile.setProfile({
    name: '某卡牌游戏',
    semanticIds: { attack: { attack_card: 1 }, defense: { dodge_card: 1 } },
});
```

### 两条设计约定

1. **引用稳定性**：`terms.js` 里的集合对象**原地更新、永不替换**，所以特征模块可以在加载期安全持有引用，热替换档案不会导致引用失效。
2. **特征槽位 = 语义并集**：`featureBuckets` 决定 130 维中「攻/防/控/延时」四槽的取值来源。默认 `def = 防御 ∪ 治疗 ∪ 无效化 ∪ 增益`，与该槽位历史行为完全一致（已回归验证，特征零漂移）。

---

## 四、八类专业级扩展点

文件：`score/foundation/runtime/extensionPoints.js`　自查：`__DJSC.extPoints.readiness()`

| 扩展点 | 目标数 | 契约 | 用途 |
|---|---|---|---|
| `scorer` | 12 | `fn(cand, ctx) => number` | 自定义加/减分规则，返回分值增量 |
| `featureBlock` | 8 | `fn(state, ctx) => number[]`（附 `dims`） | 向特征契约追加特征块 |
| `guardRule` | 7 | `fn(action, ctx) => null \| {block, reason}` | 合法性红线，非空即否决 |
| `strategy` | 4 | `fn(ctx) => object` | 攻/防/辅助等宏观策略 |
| `modelBackend` | 1 | `fn(features) => number[]` | 本地/远程/集成模型统一入口 |
| `metric` | 6 | `fn(trace) => number` | 胜率/收益/命中率等评估量 |
| `host` | 1 | `install(host)` | 宿主运行时注入点 |
| `gameProfile` | 1 | `setProfile(p)` | 游戏档案 |

**未注册时一律走内置默认实现**，所以注册表可以为空，不影响对局。

### 注册示例

```js
/* 注册一个评估指标 */
__DJSC.extPoints.register('metric', 'myWinRate',
    function (trace) { return trace && trace.win ? 1 : 0; },
    { label: '我的胜率' });

/* 注册一条护栏规则：禁止对同阵营使用攻击牌 */
__DJSC.extPoints.register('guardRule', 'noAllyAttack',
    function (action, ctx) {
        if (action.kind === 'attack' && ctx.targetRelation === 'same') {
            return { block: true, reason: '同阵营不攻击' };
        }
        return null;
    },
    { label: '禁攻同阵营' });

/* 查询 */
__DJSC.extPoints.list('metric');      // 已注册条目
__DJSC.extPoints.getImpl('metric','myWinRate');
__DJSC.extPoints.unregister('metric','myWinRate');
```

---

## 五、配置规格表

文件：`score/foundation/config/configSpec.js`　自查：`__DJSC.configSpec.readiness()`

- `status: 'active'` —— 已接入，改值立即生效（当前 **30 项**）
- `status: 'pending'` —— 专业级预留位，未接入前不生效（当前 **6 项**）
- `schema()` 按分组返回，可直接驱动面板自动渲染表单；`validate(obj)` 做枚举/范围校验。

待填预留位：

| key | 用途 |
|---|---|
| `gameProfileId` | 接入新游戏时填档案 id |
| `modelBackend` | `local` / `remote` / `ensemble` |
| `modelBackendUrl` | 远程/集成推理端点 |
| `evalBenchmark` | 标准对局回放集路径（离线回归） |
| `telemetryEndpoint` | 决策链路耗时/命中率上报端点 |
| `featureBlockDims` | 扩展特征块的维度登记 |

---

## 六、就绪度自检

```js
__DJSC.proReady.report()   // 结构化：{ kernel, profile, extension, config, gaps, score }
__DJSC.proReady.text()     // 可读文本，逐项列出「还差什么、去哪填」
```

输出格式示例（具体数字以运行时报告为准）：

```
内核解耦   : ✅ 宿主耦合唯一化（score/foundation/adapt/host.js）
          : ✅ 特征契约 130 维
          : ✅ 语义层已建立并作为权威来源
适配词表   : <AUDIT.cleanRate>% 文件已洁净
──────────────────────────────────────────────
游戏档案   : <profile>
扩展点     : <registered>/<expect>
配置规格   : 已接入 <active> 项 / 预留 <pending> 项
──────────────────────────────────────────────
综合就绪度 : <overall>%
待填清单   : <gaps>
```

`gaps` 里每一条都是**可直接执行的待办**（去哪填、填什么）。

---

## 七、专业级方向与「你只需填什么」

| # | 方向 | 落点 | 你只需填 |
|---|---|---|---|
| 0 | **适配词表下沉**（`AUDIT.legacyFiles / AUDIT.hits → 0`） | `terms.js` 语义查询 | 逐模块替换为 `idsOf/bucketIds/isSemantic/semanticOf`，用 `build/semantic_audit.mjs` 追踪进度 |
| 1 | 适配第 2 款卡牌游戏 | `gameProfile.js` | 一张语义表 + 阶段/阵营/事件名 |
| 2 | 升级模型后端（本地→远程/集成） | `extPoints.modelBackend` | 一个 `predict()` 实现 + `modelBackendUrl` |
| 3 | 特征契约扩展（130 → N） | `extPoints.featureBlock` | `dims` + 一个取特征函数 + `featureBlockDims` |
| 4 | 评分模块插件化 | `extPoints.scorer` | 一个 `fn(cand, ctx)` |
| 5 | 护栏规则外置（可配置红线） | `extPoints.guardRule` | 若干 `fn(action, ctx)` |
| 6 | 离线评估与回归基准 | `extPoints.metric` + `evalBenchmark` | 指标函数 + 基准集路径 |
| 7 | 可观测性 / 遥测 | `telemetryEndpoint` | 端点地址 |
| 8 | 策略包 / 策略市场 | `extPoints.strategy` | 若干 `fn(ctx)` |
| 9 | 自我对弈（self-play） | `extPoints.strategy` + `metric` | 策略实现 + 评估指标 |
| 10 | 多档案共存（同一引擎跑多游戏） | `gameProfile.setProfile(p)` | 各游戏档案各填一份 |

上表 2–9 项的基础设施**已经写好并在运行**，现在缺的只是"具体实现"——填进去即生效。

---

## 八、文件地图（通用架构相关）

```
score/index.js                                  对外唯一入口
score/foundation/adapt/host.js                  宿主适配桥（唯一耦合点）
score/foundation/adapt/terms.js                 通用术语层（8 类语义 + 5 类阵营 + 4 类关系）
score/foundation/adapt/gameProfile.js           游戏档案（换游戏只填这里）
score/foundation/runtime/extensionPoints.js     八类专业级扩展点注册表
score/foundation/runtime/registry.js            挂载总线（幂等软合并 + 连接契约自检）
score/foundation/config/configSpec.js           配置规格表（30 已接入 + 6 预留）
score/verification/semanticAudit.js             适配词表下沉审计（自动生成）
score/verification/professionalReadiness.js     专业级就绪度体检
score/model/features/features.js                130 维特征契约（语义槽位由档案注入）
score/model/weights/defaultWeights.js           内置默认权重（离线训练所得）
score/decision/                                 决策内核（感知→候选→打分→收敛→复核→护栏）
score/perception/journal/gameLogStore.js        对局日志自存（突破内核 20 条限制）
score/model/                                    学习闭环（冠军策略 / 异步后检测 / 训练回流）
```

> 完整分层索引见 [`score/_DOMAIN.md`](_DOMAIN.md)。


> 目标约定：内核只引用**语义**，游戏专有名词全部集中到 `gameProfile.js`。
> 现状：新增模块应遵守该约定；历史模块的词表下沉进度由 `build/semantic_audit.mjs` 自动审计，具体数字以 `score/verification/semanticAudit.js` 为准。
