# 第六批 D4：合成输入隔离、技术验证与质量资格关闭

本实现没有生产发布模式，也不启动 HTTP 模型发布 API。所有新训练候选强制 `purpose=synthetic-flow-only`、`productionEligible=false`；verified 表示独立推理与测试证据完整，不表示实战质量通过。隔离发布库只能是 `isolated-test`。不得将本流程用于真实玩家训练池。

## 受支持契约与历史入口

新增适配器复用客户端 `createIsolatedModelSession` 和实际 `trainBatch`，没有复制或更改优化器。支持 version7、134→128→64、6分类 Actor 与 tanh Critic；隐藏层 GELU→LayerNorm，epsilon=1e-8，线性缩放128，两个可选并联投影由明确 useResidual 控制。浮点快照采用既有 float32-v1，权重/偏置及全部 Adam 一/二阶矩均保留，不量化、不填补旧模型权重。MODEL_SCHEMA 的 int8/int16 是公共存档默认类型，float32-v1 是既有专项隔离快照格式，两者不得混淆。

特征顺序沿用 features.js：0–31状态、32–47动作、48–63时序、64–79相对强度、80–95概率/牌堆、96–119扩展、120–124卡牌概率、125–129技能标签、130–133合法已知目标身份。文件哈希绑定实际客户端实现。旧130维仅按第五批A/B补四个缺失槽并保留标记；142维不进入训练。身份场当前既定停用/兼容规则不改变。

标签由客户端真实 labelPolicy 产生。独立 Python 验证同一阈值：r≥80 A、≥30 B、≥0 C、≥-30 D、≥-80 E，否则 F。r=clamp(round(observedReward×12),-147,147)，value=clamp(observedReward/12,-1,1)；终局标签独立，不拿终局胜负替换动作收益。温度8的分类概率用于交叉熵/校准，不称为胜率。优化器为客户端既有 float mini-batch AdamW（beta1=.9、beta2=.99、标签平滑.05及原梯度/衰减规则），学习率按每epoch×(1-.15×epoch)，本轮不调整任何系数。

训练初始化为固定LCG种子的全新float参数、零动量，不继承历史预训练权重。seed、batchSize≤32、epochs1..5、learningRate≤.002、useResidual显式记录。训练参数SHA可复现；候选ID和生成时间独立，不要求整份Manifest时间/ID相同。

历史入口仍阻断：P0_Baseline_Train为130/121维LightGBM复合动作分类；P0_Step3_Train为LightGBM动作多分类；P1_Mode_Models_Train/P1_Policy_v2_Train为114维模式/动作LightGBM；Train_SubModel_Policy为130维动作LightGBM。它们不是本次6档收益Actor/Critic。规则蒸馏、历史权重生成、v5独立影子模型均不转换、不启用。原18个危险入口继续在读取数据前报错。

## 数据与运行

export_dataset/train 只接受 synthetic_isolation.SyntheticInbox：它自行在操作系统临时目录新建随机目录、独立认证库和全新 inbox，没有接收数据库路径的构造参数。过程内能力按对象身份登记，并在每次导出/训练前核对目录、数据库、认证库的文件身份和 symlink。训练输入还必须是该对象在本进程导出的数据集路径/文件身份。复制 test-only/synthetic 字段不能获得能力。

SyntheticInbox 仅接收由固定合成生成器可逐字段重建的记录：占位 actor/hero/enemy、固定 reward/label/deltas，固定特征族（默认或32个确定性向量）、有限维度与测试上下文；等待/终局/修订使用同一模板。未知玩家字段、真实特征向量、其他元数据或 envelope 被拒绝，不依赖自报 synthetic=true。合成上传仍走原 SourceAuthority 和 DurableInbox，不改 B 的来源规则。

CLI 的 --inbox/--auth-db/--public-endpoint 已变为明确拒绝的旧参数，拒绝发生在打开路径之前。--test-only 只是确认用途，不能证明隔离。CLI 自建数据源、生成32个合成 session，然后导出/训练；--dataset 必须是全新输出文件，不读取此前传入的数据集。以下两条命令各自生成新的合成来源，不复用外部数据库：

```powershell
python training/trusted_trainer.py --test-only --dataset <NEW_SYNTHETIC_JSON> --export-only --seed 17
python training/trusted_trainer.py --test-only --dataset <ANOTHER_NEW_SYNTHETIC_JSON> --client <CLIENT_ROOT> --output <NEW_CANDIDATE_DIR> --seed 17 --epochs 1 --batch-size 32 --learning-rate 0.0005
```

Python 集成测试可创建 SyntheticInbox、调用其固定生成器 seed()，并在同一进程 export/train/validate。train 操作的内部 worker 同样要求该能力，且逐条核对合成内容。验证/发布的只读 live-view 复核继续保留原恢复契约；它不授予训练能力。

此边界阻止误把已有生产路径/玩家数据送入测试优化器，不是能抵御同账户任意代码、monkeypatch、管理员或恶意文件系统竞争的 OS 沙箱。Windows 临时目录继承当前用户权限，不能声称独立服务账户或 ACL 已部署。生产进程必须使用独立账户/ACL或容器隔离、不给测试账户生产读取权限；本轮不部署该外部权限。正式训练仍未开放，不存在公开绕过开关。

数据资格、修订归并、整局分区及 Manifest 规则沿用 v5，输出使用独占创建，原始样本和旧候选不覆盖。无生产注册/HTTP发布入口。

## 独立验证与模型Manifest

model_contract.py 独立实现实际GELU、float32中间缓冲、LayerNorm、投影及Critic；训练仍仅使用JS优化器。Python/Node/真实宿主对照容差1e-5，来自float32中间舍入与平台数学函数，未做量化格式转换。缺参数、非有限值、错误形状/精度/配置均拒绝。

validate(candidate,inbox,client,baseline=None) 生成 validation.json 与 verified.json。记录分类准确率、温度8交叉熵、10箱ECE、value MSE、模式/角色分组、推理耗时及参数缓冲字节数。缓冲字节数不冒充进程峰值RSS；无样本用None，验证/留出分区缺失拒绝。结构完整仅是第一层。reference 必须另外通过 check_verified 的独立前向/验证报告绑定，结构完整但未验证直接 E_REFERENCE_NOT_VERIFIED。技术合成 reference 只可进入 technicalComparison；该比较沿用不退化与每组≥150规则，不授予质量资格。qualityPassed 始终 false，independentQualityQualified/authorizedStableBaseline 始终 false；有技术对照时 quality.status=insufficient-qualification，无对照为 not-assessed。首次模型 initial_quality_gate 明确要求可信独立评估来源、预先审定的质量策略及授权稳定基线登记，当前无外部可信评估提供者，返回 E_INDEPENDENT_QUALITY_REQUIRED。不能用任意绝对准确率或可自报 JSON 填补。

manifest.json绑定模型文件全部参数/动量、架构、配置、数据集Manifest与文件哈希、实际训练行数、只读分区、种子、客户端/后端训练代码哈希。verified.json另绑定原manifest文件SHA及验证报告SHA；报告绑定候选、模型、数据、基线。生成时间仅元数据，哈希仅证明内容一致性，既不提供签名也不证明外部训练真的发生。任何模型或数据变化都需重新训练/验证，不复用同ID旧证明。验证使用已核对SHA的固定快照，不能在读取与异步推理间借用替换权重。

export_client_shadow 仅为确认为经典斗地主范围的数据生成原生classic-candidate-v1快照，携带完整服务器Manifest/哈希；显式quality.ok=false，不能伪造客户端经典datasetManifest或质量证明。真实客户端原激活门禁保持有效。其他模式可做隔离前向诊断，没有得到经典专项的安装/激活权限。

## 隔离发布与回滚

Python API：

```python
from model_release import initialize, ReleaseStore, ShadowSession
key = initialize(NEW_TEMP_STORE, test_only=True)  # 不打印/公开此本地能力
store = ReleaseStore(NEW_TEMP_STORE, key, temporary_inbox, CLIENT_ROOT)
candidate = store.stage(VERIFIED_SYNTHETIC_CANDIDATE)['candidateId']
receipt = store.activate(candidate, store.status()['revision'], 'unique-frozen-operation-id')
active = store.resolve()
prediction = store.predict([0] * 134)
store.rollback(store.status()['revision'], 'unique-rollback-operation-id')
```

状态：draft→trained→verified（技术证据）→staged→active→retired；错误为rejected或rolled-back。该库仅支持合成流程切换：只有已独立技术验证 reference 的 technicalComparison 两分区按原规则通过，才给 isolatedFlowPassed；这和 qualityPassed 分离。未比较/退化/分组不足仍拒绝；激活对照的基线参数和网络配置须与当前活动版本一致。生产资格始终False。上传Bearer不授权本地发布：新隔离库生成独立随机操作能力，哈希保存在store.json，秘密仅operator.key；OS权限仍是信任边界，Windows需另配ACL，不声称硬件身份或防御恶意本机管理员。

先fsync完整不可变版本文件，再FULL/WAL SQLite保存完整文件副本与绑定，最后同一事务切current/previous和操作回执。切换前使用真实客户端推理探针，并在异步等待后、实际提交前再查参数/Manifest/数据。版本指针CAS，两个并发发布只能一个成功。发布/回滚丢响应可用同一冻结operation-id重试；回滚目标只在新操作中解析，不能按已交换previous重新执行。原版本及所有证据保留。

进程在文件准备/提交前中断：旧指针继续可用，匹配的部分文件可续写，冲突文件不覆盖。提交后响应丢失：返回已保存回执，不重复切换。current损坏退previous；previous也无效则返回public-default-required，调用方继续已验收公共默认模型，不使用损坏候选、不重新训练、不清理学习数据。首次真实输入推理失败可回滚；回滚写盘失败时仍能返回上一份有效预测并明确rollbackPersisted=false。

ShadowSession只读固定一局sessionId及版本身份，返回稳定/候选分歧和各自耗时，可单独关闭；候选异常只返回稳定预测，不接入正式选择排序。它是离线验证接口，不是玩家灰度开关。实际客户端影子缓存另按保存记录所有权失效，防止同ID替换继续读取旧会话。

## 保留限制

历史默认公共权重没有可靠训练Manifest，无法证明新的评估行从未接触过这些权重；没有补造历史证据。实体对局跨热重载session连续性仍未证明。新本地测试不能证明真实生产质量、实战胜率、正式更新服务器兼容、真实断电/磁盘失效或生产ACL。任何未来正式发布都必须先取得可信数据、独立质量依据及另行部署审查；本包没有可绕过的production开关。
