# 无名AI 4.4.4 决策审查

- AI-002 保留宿主过滤器的参数、接收者和异常语义，避免重复调用。
- AI-003 桃护栏按字段所有权恢复，清理后停用残留策略包装。
- ARCH-001 屏蔽身份局不兼容推理，显式标记预测失败，移除旧候选概率回退。DeepThink 保留非模型复核，分类置信度仅供诊断。
- ARCH-002 身份局普通杀仅在 opponentContext 计算一次风格贡献。
- 普通杀诊断默认关闭，使用有界缓冲。开发者可通过 window.__DJSC.shaTraceEnabled 开启，首次记录后读取 shaTraceSnapshot()。

在独立无名杀 1.11.5 宿主中，普通启动确认加载 4.4.4。一次离线身份局观测到四次扩展选中与执行计数。逐动作、DeepThink 阶段与结算尚未按同一 ID 对账。后续冷启动曾在 CDP 连接前退出，日志包含缓存访问失败，退出原因待查。

AI-001 原生选目标回调及 AI-004 候选归属、同名聚合和友方硬过滤仍待审查。

运行隔离回归：node --test choose-to-use-guards.test.cjs sha-decision-trace.test.cjs deep-think-compat.test.cjs
