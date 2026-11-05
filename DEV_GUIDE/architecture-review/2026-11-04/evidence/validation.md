# 验证证据摘要

## 第五轮：真实晚结算与页面重开

实机核心仍为 1.11.7。`late-scenarios.js` 使用真实 Player.useSkill，技能内容等待受控 gate；新事务已 stage 后再放行或取消旧事件。两类场景 8 项通过，writes=0，新 pending 保留，原 cancel 恢复。原始检查点与重开结果见 [late-runtime-excerpts.jsonl](late-runtime-excerpts.jsonl)。

真实 game.over 进入胜利/结算界面，旧事件等待未返回，该终局回调场景未完成。随后实际点击“重新开始”并选新角色：players=8、over=false、oldPending=0、pass=true。上一局外部检查点见 [restart-prior.json](restart-prior.json)；它明确 terminalCompleted=false，不伪装成完整终局验收。

归档脚本随后增加终局等待 2 秒后的未完成记录，避免未来挂起；本轮没有重跑该新分支，未把它列为已验证。业务源码未变，Node 上轮 88 项/完整回归为历史结果，本轮不重复运行。

## 2026-11-05 最新复验

B5-F07 修复前新增测试 3/88 断言失败；修复后网关 88 项通过，完整 npm test 通过，其他断言数不变。日志：[cancel-fix-regression.log](cancel-fix-regression.log)。下方 80 项及失败场景均为上轮历史证据。

00:09:09.957Z，核心 1.11.7 的 host-scenarios：13/13 检查通过，commits=1，samplesBefore=1、samplesAfter=1，errors=[]。覆盖真实正常技能、普通取消、静默取消、原方法恢复、respond 完成且不冒充主动动作、受控事务无训练样本。两类取消 id 为 dtx_mw2sfxhi_5 / dtx_mw2sfxhi_6，均取消原事务。原始结果已追加到 runtime-excerpts.jsonl。

这是受控宿主场景，并非自然对局全部行为。换局、长局、真实训练/A/B 和导入还原仍未完成，不将 B5 整体标为通过。

## 自动化：最后一次已完成的回归

命令：`npm test`。本次 PR 整理未重复执行。

| 检查 | 结果 |
| --- | --- |
| 主门禁 | 1899 项通过 |
| phase / AOE | 31 项通过 |
| 决策追踪 | 24 项通过 |
| 决策事务 | 33 项通过 |
| 配置契约 | 130 项通过 |
| 执行网关 | 80 项通过 |
| 决策质量 | 57 项通过 |

完整输出见 [transaction-regression.log](transaction-regression.log)。已登记行为欠账 1 项、隐藏信息欠账 8 项保留，不能将通过率解读为 AI 强度分数。

B5-F06 回归修复前 8/71 断言失败：旧事件完成/取消/拒绝或跨局后会操作新事务。修复后 80 项通过，新增覆盖原编号绑定、旧结束回调及固定时钟过期。

## 实机：1.11.7 核心

原始关键记录：[runtime-excerpts.jsonl](runtime-excerpts.jsonl)。选取与本稿结论直接相关的条目，不包含训练文件或权重包。

1. 23:35:20.190Z，真实用牌样本 `dtx_mw2r8afx_5`，source=real，feedbackApplied=true。一个样本的成功不等于全部链路验收。
2. 23:56:08.512Z，受控真实技能 `b5_isolated_probe`，事务 `dtx_mw2rz56d_2`，1995ms 后 committed。测试此前已检查函数返回不提交、内容执行及对应事务一次提交。
3. 23:56:08.513Z，同技能取消场景事务 `dtx_mw2rz6pt_3`，调用 cancel(true, null, 'notrigger') 后仍 committed，ageMs=0。
4. 23:56:08.514Z，取消断言失败，组合测试停止。脚本后半的响应及后续换局实机未执行。

脚本见 [host-scenarios.js](host-scenarios.js)。这是隔离测试地址中的真实 Player / GameEvent + 受控事务回调，不能把它称为自然 AI 选牌或完整训练链。回调只计数，不写训练样本。

失败断言还包含“_cancelled 必须为 true”的错误假设；核心对不触发通知的取消并无此保证。但提交日志独立证明网关确实提交了该取消事务。修复测试时应核对内容、事务和样本结果，而非强制核心设置字段。

## 尚不能回答的问题

- 原第一轮 3 次不匹配、1 次过期没有每次动作明细，无法还原原因。
- 1.11.6.1 未完成同等实机验证；目录名不作为版本证据。
- 真实响应、换局、长局、手动训练、A/B 全流程和导入还原未全部完成。
- B5-F07 尚未修复；此前 Node 绿色不覆盖本次核心 cancel 语义。
- 旧训练数据是否曾受串写影响未证实，本轮未追溯修改。
