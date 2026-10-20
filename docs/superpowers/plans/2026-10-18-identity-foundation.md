# 身份认知第一批修复 Implementation Plan

> 执行：本会话按任务直接实施，逐项以生产模块回归测试验证。

**Goal:** 完成用户方案第 12 节规定的第一轮交付，修复主忠硬关系、身份可见性、规则一致性和缓存边界，冻结后续概率改造基线。

**Architecture:** 公开事实集中到 identityFacts；identityView 包装兼容推断，保留现有行为权重。独立公开事件账本记录实际结果与语义，首批旁路运行，不反向改变旧推断。身份场旧模型、冠军偏好及采样暂停，防止新语义交给旧权重。

**Tech Stack:** 原生 JavaScript ES modules、Node 内置断言、现有 noname-stub-loader。

**Spec:** 用户提供 `C:/Users/32360/Downloads/无名AI-GitHub版-身份认知决策优化方案.md`，基线 13783ee；执行范围为第 12 节第一轮。

## Global Constraints

- 标准身份场单内规则；双内、明忠、身份变化和未知配额显式降级，保留合法公开/自身事实。
- 不训练新模型，不部署新证据权重，不修改内奸战略，不宣称胜率改善或概率已校准。
- 不修改宿主态度函数；未分解的宿主效果调用必须带回退诊断。
- 使用 playerid/对象临时 ID；不同观察者的私有身份互相隔离；重开清空会话。

## Tasks

- [x] 1. 复现主忠、公开敌人和自身关系；集中硬阵营关系，补忠→主。
  - 测试 `node tools/test-identity.mjs`，先失败再修复；自身处置仍为 0，内奸不固定组队。
- [x] 2. 新增 identityFacts/identityView，规则能力声明、负槽位和总量一致性检查；公开/私有/证据/规则/会话版本参与缓存失效。
  - 覆盖隐藏身份替换及禁止读取、同名实体、同回合亮身份、规则更新、重开局、不同观察者。
- [x] 3. 特征改用合法硬事实；暂停身份场旧模型及其采样、冠军偏好；面板共用身份视图。记录宿主语义回退的实际调用数。
  - 覆盖旧模型暂停原因、特征隐藏真值替换、非身份模式兼容声明、面板即时刷新。
- [x] 4. 增加不可变公开事件账本、根动作分组、eventId 幂等和首批语义样本；接入宿主完成事件，独立于当前敌友判断。
  - 覆盖伤害、救主、拆兵乐/装备、强制/AOE、自救、无懈取消链、重复回调、酒杀/击杀根分组。
- [x] 5. 冻结原最小复现作为后续阶段基线，记录未完成的强度丢失/人数不守恒问题；更新审计与验证说明。
  - 完整运行 `node tools/test-identity.mjs`、`node tools/test-regressions.mjs`、`node tools/test-weights.mjs`、`git diff --check`。

## Review Focus

- 隐藏目标 identity getter 必须不被认知/特征读取，包括 mingzhong 探测。
- 宿主完成回调必须遵守自然事件循环，不主动启动 thenable。
- 可见性标记与 session reset 不允许旧局死亡事实继承。
- 身份采样暂停必须同时覆盖低层 pushSample 和正常 trainRecordSample。
- 未支持的无懈语义与隐藏弃牌只能记 unknown，不能捏造帮助/敌意。

## Execution notes

- 原有测试基线：test-regressions 94/94；test-weights 637/637。
- 直接在用户安装目录的独立分支 `codex/identity-foundation` 修改，便于本地游戏加载验证。
- 最终测试：test-identity 41/41、test-regressions 94/94、test-weights 637/637；23 个 JS/MJS 文件语法检查通过；git diff --check 通过。
- 独立审查的两项问题已完成 RED→GREEN：真实 chooseToUse 出牌/救援链主动性、非身份模式旧特征语义兼容。未遗留审查提出的 Critical/Important 项，无 Minor 项。
- 自查补修并 RED→GREEN：暗主公不能在关系暴露层公开；正常生命周期的视图与账本会话号一致；新证据旁路时视图 diagnostics.evidenceGroups 明确为 0。
- 审查未覆盖的原有信息旁路及本批边界详见 `docs/identity/更新日志.md`。本批不作为“整条决策链已满足正常信息权限”的发布认证；代价是旧强度与人数守恒缺陷仍会影响软身份推断，实际动作级隔离仍需后续门禁。
