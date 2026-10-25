/*
 * ============================================
 * // Autor: Feisheng Original
 * 交流群: 123456789
 * 本文件记录无名AI扩展的历史会话与近期维护修改
 * 位置：无名AI扩展 /logs/ 日志文件夹
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 无名AI · 会话与近期维护修改日志 =================
 * 记录本次完整会话中从「冠军策略(上下文维度泛化)」到「存储/性能/架构优化」、
 * 「铁索连环修复」「阵营判据统一」「打包与回归验证」的全部分类修改。
 * 每条标注：修改文件、行号、修改内容。
 * 与 score/changelog.js 的版本日志互补：这里聚焦"今天这次会话做了哪些事"。
 */

export const SESSION_CHANGELOG = [
{
    "phase": "2026-10-25 · 斗地主无懈与托管修复",
    "date": "2026-10-25",
    "changes": [
        {
            "file": "score/decision/response/responseWindow.js / score/decision/response/wuxieOptimization.js / score/decision/override/use.js",
            "lines": "新旧无懈的实际响应窗口",
            "desc": "修复关闭 AI 响应、切回手动或换局后，仍沿用上一次无懈判断的问题；关闭“无懈优化”时，也会按当前局面重新判断是否出牌。"
        },
        {
            "file": "score/decision/response/jiedaoResponse.js / score/decision/override/use.js",
            "lines": "借刀材料与卸载流程",
            "desc": "修复借刀杀人通过技能出杀时，选牌可能受到旧判断影响的问题；修复停用扩展后，部分选牌辅助未正确退出的问题。"
        },
        {
            "file": "tools/test-response-lifecycle.mjs / tools/cross-mode-response-host-scenes.mjs / docs/doudizhu/响应窗口后续修复.md",
            "lines": "完整回归与真实跨模式场景",
            "desc": "原有设置保持不变，更新后无需重新配置。"
        }
    ]
},
{
    "phase": "2026-10-23 · 斗地主配合判断修复",
    "date": "2026-10-23",
    "changes": [
        {
            "file": "score/decision/state/cooperativeTrickIntent.js / score/decision/response/wuxieEvaluator.js",
            "lines": "玩家意图凭据与原生回退",
            "desc": "调整队友的无懈判断：正常出牌时手动火攻自己等配合操作，会尽量尊重玩家选择；技能强制用牌和托管另行判断。"
        },
        {
            "file": "score/decision/strategy/cooperationPolicy.js / score/model/net/modelGuard.js",
            "lines": "新增策略的统一启用范围",
            "desc": "这次配合调整用于经典斗地主的休闲、开黑和欢乐玩法，其他玩法保留原来的处理方式。"
        },
        {
            "file": "tools/test-cooperation-scope.mjs / tools/manual-intent-host-scenes.mjs / docs/doudizhu/评论边界修复.md",
            "lines": "回归与真实宿主验证",
            "desc": "原有火攻、铁索、拆顺、无懈等设置继续有效，无需新增配置。"
        }
    ]
},
{
    "phase": "2026-10-21 · 数据上报回执与专项训练诊断",
    "date": "2026-10-21",
    "changes": [
        {
            "file": "score/foundation/cloud/cloudIngest.js / score/foundation/cloud/ingestReceipt.js",
            "lines": "上报响应与结果提示",
            "desc": "新增 ingest-receipt-v1 解析及批次汇总，显示归档、合并池新增、重复、未标记结果数量；兼容没有回执的旧服务，重试回执不重复累计，并保留 HTTP 429 退避标记。回执不代表最终训练资格。"
        },
        {
            "file": "backend/server.py / backend/test_server.py / backend/README.md",
            "lines": "POST / 接收契约",
            "desc": "8787 接收器新增成功回执并保留既有字段；原样请求在当前进程内重放时复用回执，小时归档与合并候选池数量分开统计。补充 HTTP 契约测试和运行／响应说明；跨进程回执持久化仍待后续实现。"
        },
        {
            "file": "score/model/train/modeTraining.js / score/view/dashboard/modeTrainingPanel.js",
            "lines": "专项训练状态与开发者面板",
            "desc": "新增最近一局从捕获、执行、收益确认、有效标签到最终合格的样本漏斗，并展示运行期按类型汇总的采样接受／拒绝原因；训练门槛调整为 4500 条、150 局、训练集 3000 条、整局验证集 450 条及每个适用验证组 150 条。低于门槛不生成新候选，现有模型权重不被本项改写。"
        },
        {
            "file": "backend/ROADMAP.md / CHANGELOG.md / README.md",
            "lines": "维护与发布记录",
            "desc": "补充后端训练闭环分阶段方案、回执限制、验收边界和待发布说明；明确进入合并池不等于训练合格，离线指标不等于真实胜率。"
        },
        {
            "file": "tools/test-ingest-contract.mjs / backend/test_server.py",
            "lines": "契约验证",
            "desc": "Node 客户端回执契约检查通过；Python HTTP 接收契约 2 项通过；后端语法编译及 git diff 空白检查通过。"
        }
    ]
},
{
    "phase": "2026-10-20 · 斗地主配合与锦囊调整",
    "date": "2026-10-20",
    "changes": [
        {
            "file": "score/decision/state/cooperativeTrickIntent.js / score/decision/response/wuxieEvaluator.js",
            "lines": "相关决策入口",
            "desc": "调整农民队友的无懈判断，减少打断玩家手动火攻自己、铁索连环、拆顺和友方决斗等配合的情况。南蛮入侵、万箭齐发仍会考虑队友能否防御，以及是否有致命危险。"
        },
        {
            "file": "score/decision/response/wuxieEvaluator.js",
            "lines": "相关决策入口",
            "desc": "玩家用无懈取消自己的锦囊后，队友不会只因为是配合操作就强行反无懈；进攻被敌人无懈时，仍会判断是否值得恢复。"
        },
        {
            "file": "score/decision/strategy/friendlyStripPlan.js / score/decision/cards/jiedaoEvaluator.js",
            "lines": "相关决策入口",
            "desc": "改进拆队友乐不思蜀、兵粮寸断和受伤白银狮子的选择；借刀杀人能正确区分持刀者和被杀目标。"
        },
        {
            "file": "score/decision/response/responseMaterials.js / score/decision/response/responseMaterialPacking.js",
            "lines": "相关决策入口",
            "desc": "修复决斗中因杀的点数过低而不响应的问题，改善武圣、龙胆、丈八蛇矛等出杀判断，减少有牌却不出的情况。"
        },
        {
            "file": "score/foundation/storage/cache.js / score/decision/state/decisionCache.js",
            "lines": "相关决策入口",
            "desc": "护甲、翻面或技能变化后及时重新判断；五谷丰登的无懈判断会考虑当前剩余牌。"
        },
        {
            "file": "score/decision/strategy/tacticalOptimization.js",
            "lines": "相关决策入口",
            "desc": "手动自火攻时，保留玩家选择展示牌的操作。"
        },
        {
            "file": "js/config/configSchema.js / docs/doudizhu/PR修复与验证.md",
            "lines": "相关决策入口",
            "desc": "火攻、铁索、拆顺、无懈等设置继续有效，打法优化类选项仍在下一局生效。"
        }
    ]
},
 {
 "phase": "铁索独立重铸与提前换牌修复",
 "date": "2026-10-13",
 "changes": [
  {
   "file": "score/decision/cards/tiesuoRecast.js",
   "lines": "all",
   "desc": "铁索使用与重铸优化：新增默认开启的独立选项；适时提前重铸，摸牌后重新安排出牌，保留斩杀与已开始的酒杀机会。"
  },
  {
   "file": "score/decision/cards/tiesuoRecast.js",
   "lines": "all",
   "desc": "重铸执行修复：无名AI通过本体接口完成合法重铸，不依赖界面扩展的重铸交互；选牌与执行绑定同一张铁索，避免漏执行和重复操作。"
  }
 ]
},
 {
 "phase": "v4.0.20 · 维护优化版",
 "date": "2026-10-13",
 "changes": [
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "v4.0.20",
   "desc": "本次集中整理对局记录、数据反馈与策略设置，补充常见卡牌打法优化。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "v4.0.20",
   "desc": "对局记录存储：提供50／100／200局保留选项，增加100MB对局日志容量上限；超过局数或容量时淘汰最旧记录，避免日志持续累积。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "v4.0.20",
   "desc": "满额处理与手动导出：取消日志满额后的自动打包和重复弹窗；保留记录状态、手动导出反馈包及清空入口。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "v4.0.20",
   "desc": "结算战报与保存控制：分别控制结算战报显示和对局记录保存；关闭保存后停止新增历史战报及对局日志，已有记录仍可查看、导出或清空；关闭战报后，斗地主专项效果不再强制弹出。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "v4.0.20",
   "desc": "帮助改进AI：反馈入口并入玩家设置“02 · 对局记录”；云朵按钮显示与自动上传分别控制，默认关闭，支持立即上传、查看上传状态和导出反馈包。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "v4.0.20",
   "desc": "上传提示与数据保留：手动上传结果提示约2秒后自动消失；关闭自动上传后停止后续定时和局末上传，已发出的请求可能继续完成。当前上传成功后保留本地记录与学习数据。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "v4.0.20",
   "desc": "D9策略模块整理：归并为“通用策略优化”和“卡牌打法优化”两个子组；精简卡牌优化选项文案，支持独立三角收放，并修正总开关与子项的显示层级。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "v4.0.20",
   "desc": "火攻与铁索联动"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "v4.0.20",
   "desc": "装备与酒杀顺序：增加古锭刀、酒杀时机和诸葛连弩优化"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "v4.0.20",
   "desc": "拆顺后出杀"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "v4.0.20",
   "desc": "队友判定区救援：增加拆顺队友乐不思蜀、兵粮寸断的优化"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "v4.0.20",
   "desc": "贴兵贴乐"
  }
 ]
},
 {phase:'实验打法优化首版',date:'2026-10-12',changes:[{file:'score/decision/strategy/tacticalOptimization.js',lines:'all',desc:'开发者D9新增默认关闭、逐局捕获配置的实验覆盖；共享火焰传导收益与弃牌成本、无懈收益；空武器栏古锭刀与酒顺序调整。保留原生合法性检查。'}]},
 {phase:'反馈入口合并与折叠修复',date:'2026-10-12',changes:[{file:'js/config/configSchema.js',lines:'player_report',desc:'帮助改进AI并入02对局记录；恢复后续板块编号；同步所有板块的CSS收缩规则。'}]},
 {phase:'帮助改进AI与上传控制',date:'2026-10-12',changes:[{file:'score/foundation/cloud/cloudIngest.js',lines:'cloudFeedback',desc:'独立玩家反馈板块；云朵显示与自动上传分别控制且默认关闭；定时与局末均检查开关；主动上传结果提示2秒，本地学习源数据保留；日志快照读取当前日志库。'}]},
 { phase: '对局记录存储与反馈修复', date: '2026-10-12', changes: [
 {file:'js/config/configSchema.js',lines:'player_report',desc:'玩家对局记录集中提供保留局数、状态、手动反馈导出与清空；50/100/200局，旧不限配置按100局处理。'},
 {file:'score/perception/journal/gameLogStore.js',lines:'recordGame',desc:'保存开关生效；按局数与100MB总量滚动保留并裁剪单局日志；取消满额自动打包和弹窗，手动反馈包使用固定文件名。'},
 {file:'score/decision/engine/engine.js',lines:'showReport',desc:'关闭结算战报后斗地主专项效果也不再强制弹出。'}
 ]},
 {
 "phase": "v4.0.19 · 近期维护汇总",
 "date": "2026-10-08",
 "changes": [
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "真实胜负、执行与训练隔离：统一读取宿主结算；未执行建议、未知结果及无效标签不进入有效训练。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "训练数据持久化：标签回填重新写库；事务完成后才确认保存；写入失败有限重试；满额导出失败保留样本；手动清空同步处理数据库与迟到任务。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "统一对局档案：动作、回合、建议、执行、即时与延迟证据按对局／玩家／事务关联，随阅读日志和可用录像导出；每5局体验评分并入战报。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "规划与实体隔离：短程计划逐步重算，身份关系、目标、缓存和团队广播按玩家实体隔离，同名武将不混用。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "收益评分迁移：多批清理装备、成本、攻击、反馈、连招、时机、AOE、判定、威胁与通用来源的重复写分，保留来源明细与对账；不宣称完整效果EV已完成。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "动作结果学习：按真实执行关联直接成本与收益，补酒后杀、装备／判定公开证据和终局迟到结果；证据不足维持待核对，整局获胜不代表每步正确。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "常规斗地主专项：支持休闲／开黑／欢乐的规则与角色分组，复用公共引擎；采集有效AI动作和本机玩家手动用牌／重铸示范，保留顺序。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "模型训练与存储：候选、启用与回滚版本使用IndexedDB；修复浮点批次训练；按整局留出比较公共基线、当前版及地主／农民分组，验证通过后下一局参与选择。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "实际参与与自动更新：专项模型对同策略级别候选作有界修正，开启后可影响首选；局间自动学习默认关闭，通过检查才保存新版本，失败保留旧版。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "托管与动作候选：补本机托管软接管、出牌窗口归属和主动技能代价检查；铁索使用／重铸分开；MVP及伤害显示等辅助事件从动作说明排除。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "玩家设置与面板：玩家入口精简为四组，复杂策略与训练维护移到开发者；统一原有玻璃风格，修复重叠、越界、双语决策点和窄屏表格，增加两层折叠，预留2v2／身份未开发入口。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "斗地主结算效果：增加玩家简报／开发者诊断及复制，分别展示模型参与、首选变化、最终执行、实际操作、确认收益、合格样本与局间更新；关联当局档案并刷新异步结果。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "性能与加载：有界性能聚合、并发异步计时、存储排队统计、模块链接及面板挂载门禁；手机与真实长局性能仍待验收。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "已定位、待修复：奇策等按钮选择／动态转化技能未进入主动候选比较；现由宿主路径处理，可能偏向摸牌，尚未统一评估拆装备后的攻击机会。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "已观察、待排查：真实档案出现出牌阶段“使用闪”建议，需按真实选择窗口复核候选合法性；尚未宣称修复。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "待优化：结算顶部显示最近一次专项状态，容易被误读为整局状态；“改变后执行”不是所有决策的实际执行次数。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "待验收：实战强度、复杂长期收益归因、玩家整段连招模仿、手机性能和各宿主导入／卸载；离线指标不是胜率。"
  },
  {
   "file": "CHANGELOG.md / logs/versionChangelog.js",
   "lines": "版本汇总",
   "desc": "尚未开发：对决2v2、身份模式专项策略与训练，仅预留入口。"
  }
 ]
},
    /* ===== A. 冠军策略 · 上下文维度泛化 ===== */
    {
        phase: '冠军策略·上下文维度泛化',
        date: '2026-09-26',
        changes: [
            {
                file: 'score/championStrategy.js',
                lines: '19',
                desc: 'VERSION 升到 v4：嵌入主键升维为 (heroId, type, id)，不同英雄的同类型动作独立成嵌入条，互不干扰'
            },
            {
                file: 'score/championStrategy.js',
                lines: '23',
                desc: '新增泛化相似度阈值 SIM_THRESHOLD=0.78；相似度 ≥0.78 才允许跨英雄复用嵌入'
            },
            {
                file: 'score/championStrategy.js',
                lines: '28-33',
                desc: '新增上下文维度索引组：CTX_TARGET_IX(目标段) / CTX_SITUATION_IX(局势段) / CTX_CARD_IX(卡牌段)，合并为 CONTEXT_IX，与 features.js 的 130 维布局对齐，故意排除动作标签/身份等干扰维度'
            },
            {
                file: 'score/championStrategy.js',
                lines: '62-84',
                desc: '嵌入按决策点聚合：外键 = heroId|action(英雄维度隔离)，内层=id；每条嵌入 = f 逐维平均 + TD 平均价值 + 样本数'
            },
            {
                file: 'score/championStrategy.js',
                lines: '*',
                desc: '_cosine 改为仅基于 CONTEXT_IX 维度计算上下文相似度，泛化只取场景维度(目标/局势/卡牌)'
            },
            {
                file: 'score/championStrategy.js',
                lines: '159',
                desc: '_cosine 加入同引用短路：自相似直接返回 1'
            },
            {
                file: 'score/engine.js',
                lines: '*',
                desc: '调用 applyChampionRule 时传入英雄 id(heroId)，支持 (heroId,action,id) 三维主键精确命中'
            },
            {
                file: 'score/modelState.js',
                lines: '*',
                desc: '挂载 champion 容器(recompute/stats)，支持嵌入管理与精确命中入口'
            }
        ]
    },

    /* ===== B. 存储优化 ===== */
    {
        phase: '存储优化',
        date: '2026-09-26',
        changes: [
            {
                file: 'score/trainExport.js',
                lines: '*',
                desc: '修复 IndexedDB 每次记样本都重新 indexedDB.open() 的缺陷(隐藏卡顿源)，改为单例连接 _dbInstance，读写全部复用'
            },
            {
                file: 'score/trainExport.js',
                lines: '*',
                desc: '删除未被引用的 saveSampleAsync 死代码'
            },
            {
                file: 'score/storage.js',
                lines: '1-*',
                desc: '新建中央存储抽象：统一 safeGet/safeSet/getJSON/setJSON，消灭 42 文件里重复的 try/catch'
            },
            {
                file: 'score/storage.js',
                lines: '*',
                desc: '新增 debouncedSet 防抖写，高频 key 合并落盘'
            },
            {
                file: 'score/storage.js',
                lines: '*',
                desc: '新增 setJSONQuotaSafe 配额超限自动降级：写满→裁剪→放弃，绝不打断对局'
            },
            {
                file: 'score/mem.js',
                lines: '*',
                desc: '接入 storage.js 统一读写 + 记忆自动裁剪'
            },
            {
                file: 'score/engine.js',
                lines: '3576-3609',
                desc: 'history 写改用 storage 抽象 + 防抖，合并高刷落盘'
            }
        ]
    },

    /* ===== C. 性能优化 ===== */
    {
        phase: '性能优化',
        date: '2026-09-26',
        changes: [
            {
                file: 'score/cache.js',
                lines: '*',
                desc: '状态指纹增强：新增"牌堆剩余(对数分桶)" + "当前阶段"两个维度，避免返回过时决策'
            },
            {
                file: 'score/cache.js',
                lines: '*',
                desc: '牌堆用分桶(对数分桶)而非精确数，防止每次摸牌都清空缓存导致卡顿回潮'
            }
        ]
    },

    /* ===== D. 架构优化 ===== */
    {
        phase: '架构优化',
        date: '2026-09-26',
        changes: [
            {
                file: 'score/_DOMAIN.md',
                lines: '1-*',
                desc: '新建域映射文档：把 130+ 平铺模块归类为 7 个功能域(core/observe/learn/store/bonus/ui/meta)，附分阶段低风险迁移指南'
            },
            {
                file: 'score/selfHeal.js',
                lines: '*',
                desc: '修复动态 import 把 _DOMAIN.md 误捕获进打包的缺陷；build 侧加 .md→empty loader，确保产物含全部改动'
            }
        ]
    },

    /* ===== E. 铁索连环修复 ===== */
    {
        phase: '铁索连环修复',
        date: '2026-09-26',
        changes: [
            {
                file: 'score/engine.js',
                lines: '2656-2658',
                desc: '修复拼写 bug：原判断 id==="tieshuo" 永远为假，导致铁索永远只连一人(根因)'
            },
            {
                file: 'score/engine.js',
                lines: '2656-2694',
                desc: '目标选择改为动态"逐一连"：不再写死两个目标，用 tsMap 收集所有存活敌方、按目标分降序逐一挑选可连目标(上限6保护)，数量随场景/技能变化可连 3/4/5 个乃至更多'
            },
            {
                file: 'score/aiOverride.js',
                lines: '185',
                desc: '目标修正层由 tname===ba.target 改为数组/单值兼容，让每个铁索目标都能获得选目标加成'
            },
            {
                file: 'score/modelGuard.js',
                lines: '74',
                desc: '新增 _resolveTargets 支持数组 target，红线1(目标存活)不再因数组比对失败而误拦铁索多目标'
            },
            {
                file: 'score/modelGuard.js',
                lines: '146',
                desc: '红线1-4 改为逐目标遍历检查，兼容多目标动作'
            }
        ]
    },

    /* ===== F. 阵营判据统一(打了又救) ===== */
    {
        phase: '阵营判据统一',
        date: '2026-09-26',
        changes: [
            {
                file: 'score/engine.js',
                lines: '2211-2223',
                desc: '修复"回打别阵营濒死又救回来"：桃救援侧原裸用 get.attitude(me,p) 判敌友，与攻击侧 isSameCamp 判据不一致。改为与攻击侧完全一致的 isSameCamp(me,p)(含同款 fallback)，确保同一目标在"能否打"与"是否救"上结论一致'
            },
            {
                file: 'score/modeStrategy.js',
                lines: '892-901',
                desc: '(确认) isEnemy 已带 attitude 兜底：att!==0 用之，否则 fallback 阵营，与服务端对齐'
            }
        ]
    },

    /* ===== G. 打包与回归验证 ===== */
    {
        phase: '打包 / 验证',
        date: '2026-09-26',
        changes: [
            {
                file: 'build/*',
                lines: '*',
                desc: '修复打包链：.md→empty loader，确保 mod 产物含全部源码改动(此前因动态 import 误捕获造成旧文件"假打包成功")'
            },
            {
                file: 'build/test_redline.mjs',
                lines: '*',
                desc: '红线自检新增用例：铁索多目标放行/死目标拦截/反贼拆顺主公/盟友判定区有牌放行/判定区无牌拦截等，回归 19/19 全通过'
            },
            {
                file: '无名AI决策引擎_mod.js',
                lines: '*',
                desc: '最终完整单文件 mod 产物(约 1.574 MB)，含以上全部改动'
            }
        ]
    },

    /* ===== H. 异步后检测 + 数据残留治理 ===== */
    {
        phase: '异步后检测 / 数据残留治理',
        date: '2026-09-26',
        changes: [
            {
                file: 'score/postCheck.js',
                lines: '39-48',
                desc: '新增异步队列状态计数：_queuedTasks(排队/处理中) / _callbacksDone(已回调) / _drained(已结算)，供面板显示'
            },
            {
                file: 'score/postCheck.js',
                lines: '238-251',
                desc: 'postCheckDelayed 改造为"异步算法"：串行 Promise 队列 _taskQueue 逐条处理，替代固定 setTimeout(1500)；维护队列状态计数'
            },
            {
                file: 'score/postCheck.js',
                lines: '253-282',
                desc: '新增轮询式异步 _pollSettle：每 300ms 采样 after 快照，连续 2 次状态不再变化 → 判定实际收益，由真实结算效果驱动而非卡死固定延时；加 POLL_MAX 超时上限防死循环'
            },
            {
                file: 'score/postCheck.js',
                lines: '287-292',
                desc: '新增 postCheckBatch(entries,onResult)：对一批候选动作逐个建快照并异步批量结算，支持"每次决策的多个候选都要后检测"'
            },
            {
                file: 'score/postCheck.js',
                lines: '95-103',
                desc: '目标变化收益按阵营感知：敌人掉血=+3/点、盟友/自己掉血=-3/点；目标濒死/死亡对敌人=大正、误伤盟友=大负；局势存活只对敌人加分'
            },
            {
                file: 'score/postCheck.js',
                lines: '303-331',
                desc: 'postCheckStats 新增队列状态(queued/drained/callbacksDone)；postCheckReset 清理快照池+队列计数，用于局结束清理防跨局残留'
            },
            {
                file: 'score/engine.js',
                lines: '3259-3288',
                desc: '决策后检测从"只检 best"改为 "每轮决策项批量检"：best + 同轮高价值技能候选(type=skill 且分差≤1，上限4)统一入异步队列，每个结算结果 champSettle 回写冠军嵌入'
            },
            {
                file: 'score/engine.js',
                lines: '3686-3689',
                desc: '局结束残留治理：settle() 终局清理段新增 postCheckReset()，清空决策后检测快照池/队列计数，避免跨局数据残留'
            },
            {
                file: 'score/engine.js',
                lines: '4215-4219',
                desc: 'window.__DJSC.postCheck 挂载互补重置别名 reset(=postCheckReset)'
            },
            {
                file: 'score/championStrategy.js',
                lines: '126-150',
                desc: '新增 diffDropped(oldEmb,newEmb)：找出被新嵌入池"替换/淘汰"的旧决策点(hero,action,id,value,count)，供回流入样本库'
            },
            {
                file: 'score/trainExport.js',
                lines: '451-476',
                desc: '新增 recycleChampionSamples(list)：把被冠军策略固化替换掉的旧决策点重新写回样本库(全0特征占位保留决策元信息)，避免训练数据因替换而流失；上限200条保护'
            },
            {
                file: 'score/modelState.js',
                lines: '186-213',
                desc: 'promoteCandidate：固化冠军(recompute)前先记旧嵌入池，固化后 diffDropped 找出被替换决策点，resetAll() 之后用 recycleChampionSamples 回流入样本库(顺序保证不被清空)'
            },
            {
                file: 'score/modelState.js',
                lines: '429-430',
                desc: 'window.__DJSC.recycleChampionSamples 挂载到全局，供固化流程调用'
            },
            {
                file: 'score/decisionDashboard.js',
                lines: '111-122',
                desc: '决策看板顶部新增"异步后检测队列状态"栏：排队数/已结算/回写数/正负收益/残留快照数，队列非空时黄色高亮、残留快照数红色警示'
            }
        ]
    },

    /* ===== I. 异步结算体系（正负分全异步，即时分除外） ===== */
    {
        phase: '异步结算体系',
        date: '2026-09-26',
        changes: [
            {
                file: 'score/decision/postCheck.js',
                lines: '*',
                desc: '决策后检测改为「异步轮询 + 串行队列」：每 300ms 采样快照，连续 2 次状态不再变化（或达上限）才判定实际收益，替代固定延时；新增 postCheckBatch 支持一批候选逐个入队结算'
            },
            {
                file: 'score/decision/postCheck.js',
                lines: '*',
                desc: '新增阵营净收益 campNet：对比结算前后敌我双方总资产（血量/手牌/装备/存活数/判定区），判定一次操作对双方的净影响'
            },
            {
                file: 'score/model/trainExport.js',
                lines: '*',
                desc: 'trainFeedbackSample 用异步实测收益覆盖样本 value_target，并打 fbAsync 标记，确保后续静态/TD 不得再覆盖'
            },
            {
                file: 'score/decision/engine.js',
                lines: '*',
                desc: '每轮决策项批量入队后检测（best + 同轮高价值技能候选），结算结果用于训练样本与冠军价值回写'
            },
            {
                file: 'score/*',
                lines: '*',
                desc: '规定：即时分保留即时结算，其余正负分一律异步后检测'
            }
        ]
    },

    /* ===== J. 冠军策略（只取最强 + 自动回流 + 软接管） ===== */
    {
        phase: '冠军策略·只取最强',
        date: '2026-09-26',
        changes: [
            {
                file: 'score/decision/championStrategy.js',
                lines: '*',
                desc: 'recompute 重写为「每个决策点只保留 value_target 最高的一条样本」；嵌入主键 (heroId,type,id) 英雄维度隔离'
            },
            {
                file: 'score/decision/championStrategy.js',
                lines: '*',
                desc: '新增 diffDropped：找出被新嵌入池替换/淘汰的旧决策点'
            },
            {
                file: 'score/model/trainExport.js',
                lines: '*',
                desc: '新增 recycleChampionSamples：把被替换的旧冠军决策点回流样本库（上限 200 条防撑爆）'
            },
            {
                file: 'score/model/modelState.js',
                lines: '*',
                desc: '新增 autoRecycleChampion：每次训练完成即固化最强冠军，并回流被替换的旧决策点（「每次训练自动进最强冠军老策略回流」）'
            },
            {
                file: 'score/decision/engine.js',
                lines: '*',
                desc: '冠军策略软接管对局策略；以前需要模型决策的点全部改为冠军策略嵌入；非法约束仅限制模型、不限制冠军'
            }
        ]
    },

    /* ===== K. 深度思考（模型只负责思考） ===== */
    {
        phase: '深度思考',
        date: '2026-09-26',
        changes: [
            {
                file: 'score/think/deepThink.js',
                lines: '*',
                desc: 'criticBest：对候选做批判式多源复核（规则分 + 模型置信 − 风险代价）；分差大或已被冠军强锁定则浅思考直通，否则进入深度思考并可推翻当前最优'
            },
            {
                file: 'score/decision/engine.js',
                lines: '*',
                desc: '模型思考模式改为深度思考；模型只负责思考相关，其余成片由子代理（冠军策略/评分引擎/卡牌价值）接管；模型监控全场功能保持不变'
            }
        ]
    },

    /* ===== L. 架构分层重构 ===== */
    {
        phase: '架构分层重构',
        date: '2026-09-26',
        changes: [
            {
                file: 'score/*',
                lines: '*',
                desc: 'score 目录文件按功能域分层（core/model/think/decision/observe/economy/guard/ui/selfcheck/override），并逐处修正外部依赖 import 深度'
            },
            {
                file: 'score/selfcheck/selfHeal.js',
                lines: '*',
                desc: '契约表显式声明 file 字段，修复用 key+".js" 拼路径导致 narrator 等键映射到不存在文件的隐患'
            }
        ]
    },

    /* ===== M. 模型契约与分数统一 ===== */
    {
        phase: '模型契约 / 分数统一',
        date: '2026-09-26',
        changes: [
            {
                file: 'score/model/features.js',
                lines: '*',
                desc: '统一 FEATURE_DIM = 130，特征提取/模型输入/训练样本三处维度一致，消除维度漂移'
            },
            {
                file: 'score/decision/scoreUnify.js',
                lines: '*',
                desc: '分层量化（小分数高精度、大分数低精度）+ 无偏舍入补偿（本次舍掉的小数下次补回）'
            },
            {
                file: 'score/model/modelHotSwap.js',
                lines: '*',
                desc: '热更新升级 V2：复用主训练器并加快照结构校验，修复 96 维输入训练 130 维模型的权重错位'
            }
        ]
    },

    /* ===== N. 连接性治理（唯一挂载总线） ===== */
    {
        phase: '连接性治理',
        date: '2026-09-26',
        changes: [
            {
                file: 'score/core/registry.js',
                lines: '1-*',
                desc: '新建「唯一挂载总线」：bind 为幂等软合并（只补缺失键、绝不写 undefined），提供 mount/ensure/alias，并内置连接契约自检 audit / connAudit，任何跨模块接口缺失即报断链'
            },
            {
                file: 'score/decision/engine.js',
                lines: '*',
                desc: '移除 eval 期启动假壳与两段式硬覆盖，聚合接口统一 reg.bind；修复别名块把 postCheck.before/after/stats/reset 覆盖成 undefined 的缺陷；psychology 补 getState（修复特征 108/109 维恒为 0）；scan 接真实探针'
            },
            {
                file: 'score/index.js',
                lines: '*',
                desc: '模块挂载统一 reg.bind；命名去混淆：replay→replayAnalysis、compare→compareAI、psychology→gameTheory，消除「同名不同源」互相混合'
            },
            {
                file: 'score/model/trainExport.js',
                lines: '*',
                desc: '修复「__DJSC 下模块有的是对象却被当函数调用」——一处抛错导致导出/备份其后整段数据被静默跳过；改为安全取值'
            },
            {
                file: 'score/decision/decisionHook.js',
                lines: '*',
                desc: '统一 decisionHooks（复数）与 decisionHook（单数）双名指向同一模块，避免读取端找不到'
            }
        ]
    },

    /* ============================================================
     * 2026-09-27 会话追加 · 深度连接
     * ============================================================ */
    /* ===== D. 身份信念 → 决策模块 深度连接 ===== */
    {
        phase: '身份信念·决策模块深度连接',
        date: '2026-09-27',
        changes: [
            {
                file: 'score/perception/observer/identity.js',
                lines: '451-470',
                desc: '新增共享信念加权入口 identityBiasOf(me,tgt,weight)：高置信疑似敌人→+weight、疑似队友→-weight、置信不足→0；仅 identity 局非零，其它模式恒 0（零回归），供 threat/技能/卡牌 三处决策统一复用'
            },
            {
                file: 'score/decision/threat/threat.js',
                lines: '18, 407-413',
                desc: '目标评分重构为复用 identityBiasOf，替换原来重复内联的信念加权逻辑，消除 code 重复与偏差'
            },
            {
                file: 'score/decision/skills/skillPlayBrain.js',
                lines: '147-150',
                desc: '敌方技目标选择接入信念加权(+0.6)：高置信疑似敌人优先集火，疑似队友避伤'
            },
            {
                file: 'score/decision/cardplay/cardPlayBrain.js',
                lines: '161-168',
                desc: '输出牌目标选择接入信念加权(+0.5)：对疑似敌人集火、疑似队友避伤'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '29, 1768, 1837',
                desc: '两处 ctx（卡牌/技能）注入 hi:{identityBiasOf}，保持模块纯函数可单测；import identityBiasOf'
            },
            {
                file: 'score/perception/observer/identity.js',
                lines: '271-272',
                desc: '修复 bug：原 otherId===fan/zhong 引用未定义变量，被 catch 静默吞掉导致"被攻击记录"信号从未生效；改为字符串 \'fan\'/\'zhong\''
            }
        ]
    },

    /* ===== E. 归档离线训练回流 ===== */
    {
        phase: '归档离线训练回流',
        date: '2026-09-27',
        changes: [
            {
                file: 'score/model/train/archiveRecycle.js',
                lines: '*',
                desc: '新增模块：扫描战报归档，把胜利局(verdict==win)的决策日志回灌为训练样本，补足"自动导出清空/cleanLowValue 清洗"后的样本缺口，让模型不"失忆"'
            },
            {
                file: 'score/model/train/archiveRecycle.js',
                lines: '47-65',
                desc: 'pickWinnerFeat 特征安全取数：先按 type+id 匹配 winner 候选且维度=130，缺失/维度不符直接跳过，杜绝全0/错位特征混入'
            },
            {
                file: 'score/model/train/archiveRecycle.js',
                lines: '34-44',
                desc: '局级去重：以归档局 ts 为指纹存 localStorage，同局不重复回流；样本级由 pushSample 特征精确去重兜底'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '111, 4146-4148',
                desc: '在归档落库后调用 recycleArchiveSamples()，使本局胜利立即回流，闭合「对局→归档→胜利样本→训练库」链路；受 cfg(\'archiveRecycle\',true) 控制'
            },
            {
                file: 'score/index.js',
                lines: '226',
                desc: '注册 __DJSC.archiveRecycle，供自检面板访问 recycle/recycledCount/resetRecycled'
            }
        ]
    },

    /* ===== F. 面板数据接入修复（反馈：多个状态面板显示全 0） ===== */
    {
        phase: '面板数据接入修复',
        date: '2026-09-27',
        changes: [
            {
                file: 'score/decision/engine/engine.js',
                lines: '3660-3680',
                desc: '接入 replay.record：决策主流程每步把状态/候选/规则/模型/总线喂给决策回放时间轴。此前只有 start/settle 无 record，时间轴 decisions 恒 0'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '1475-1511',
                desc: '新增 _autofeatCtx 场景上下文构造器：把决策关键事实折叠成 autoFeature 布尔特征'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '3677-3680',
                desc: '接入 recordDecisionContext：决策主流程每步记录场景组合，此前只有挂载无调用，自动特征发现总样本恒 0'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '4033-4042',
                desc: '接入 settleDecisionContext：本局胜利回填收益，让重要特征权重能被学习出来，面板维度才有非零'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '4043-4053',
                desc: '接入 learnFromGame：把本局胜负/阵营攻击/残局喂给 softMetrics。此前只有挂载无调用，软指标总学习次数恒 0'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '2456-2462',
                desc: '确认 psychologyBonus / comboChainBonus 已在候选循环内调用（有数据生产）；面板在第 1 轮早期打开显示 0 属正常时机（决策尚未发生），非断线'
            }
        ]
    },

    /* ===== G. 面板数据接入修复·二轮（反馈：游戏中打开回放面板仍全 0） ===== */
    {
        phase: '面板数据接入修复·二轮',
        date: '2026-09-28',
        changes: [
            {
                file: 'score/decision/engine/engine.js',
                lines: '3705-3726',
                desc: '把 replay.record + recordDecisionContext 移出大 try 块（原在 recordDecision 同 try 内，layers/plan 构建任一步抛错即整体被 catch 吞掉，记录从未落库）'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '3719-3720',
                desc: 'replay.record 补传 final 与 intervention 字段，使时间轴渲染"▶ 最终动作"与干预标签（此前为空）'
            },
            {
                file: 'score/perception/replay/decisionReplay.js',
                lines: '200-240',
                desc: 'replayStats() 增加本局实时统计（currentDecisions/currentByIntervention/currentBlocked/currentConflicts/currentBus）；根治"游戏中打开面板恒 0"——原 stats 只统计已归档局，局内 _currentBuffer 不计入'
            },
            {
                file: 'score/view/dashboard/replayPanel.js',
                lines: '13, 69-76',
                desc: '面板新增"本局决策"卡片，决策总数/护栏/冲突/总线改为"归档+本局"合计，游戏中打开即有实时数据'
            },
            {
                file: 'score/view/dashboard/replayPanel.js',
                lines: '114-123',
                desc: '新增"⚡ 本局进行中"实时时间轴：无归档时不再只显示"暂无归档"，直接渲染当前缓冲的决策链'
            }
        ]
    },

    /* ===== H. 状态弹窗统一升级为卡片式面板（用户要求：全部调成决策回放那种卡片） ===== */
    {
        phase: '状态弹窗统一卡片化',
        date: '2026-09-28',
        changes: [
            {
                file: 'score/view/dashboard/stateCards.js',
                lines: '新增文件',
                desc: '新建统一卡片面板渲染器 openStateCardPanel(title, cards, extraHtml)：深色玻璃弹窗 + 顶部一排彩色数值卡片（样式与 replayPanel._card 完全一致），并挂载 window.__DJSC.openStateCardPanel'
            },
            {
                file: 'js/config/config.js',
                lines: '25, 1247-1256',
                desc: '博弈策略状态：alert 纯文本 → 卡片面板（总决策/威慑/意图/压迫/保留）'
            },
            {
                file: 'js/config/config.js',
                lines: '1266-1282',
                desc: '连招链状态：alert → 卡片面板 + 当前手牌连招/已知连招库两个附加段落'
            },
            {
                file: 'js/config/config.js',
                lines: '1292-1300',
                desc: '对手记忆状态：alert → 卡片面板（记录玩家/累计对局/有攻击历史）'
            },
            {
                file: 'js/config/config.js',
                lines: '1310-1318',
                desc: '自动特征发现状态：alert → 卡片面板（总维度/总样本/重要维度）'
            },
            {
                file: 'js/config/config.js',
                lines: '1329-1339',
                desc: '软指标学习状态：alert → 卡片面板（总学习次数 + 四个指标键值卡）'
            },
            {
                file: 'js/config/config.js',
                lines: '1349-1358',
                desc: '决策后检测状态：alert → 卡片面板（总检测/平均收益/正负收益）'
            },
            {
                file: 'js/config/config.js',
                lines: '1368-1378',
                desc: '性能分析状态：alert → 卡片面板 + Top5 耗时阶段列表'
            },
            {
                file: 'js/config/config.js',
                lines: '1388-1394',
                desc: '训练缓冲状态：alert → 卡片面板（当前缓冲 + 导出命令提示）'
            },
            {
                file: 'js/config/config.js',
                lines: '1404-1428',
                desc: '一键全功能状态检测：alert → 卡片面板（8 模块挂载状态 ✅/❌ + 对局状态玩家/身份/血量）'
            },
            {
                file: 'score/view/dashboard/stateCards.js',
                lines: '32-64',
                desc: 'openStateCardPanel 增加 buttons 参数支持（面板底部按钮，延迟绑定 onclick，用于策略进化"强制进化"等交互）'
            },
            {
                file: 'js/config/config.js',
                lines: '767-789',
                desc: '查看样本数：alert → 卡片面板（当前样本数/模型状态/模型就绪）'
            },
            {
                file: 'js/config/config.js',
                lines: '833-849',
                desc: '查看模型状态：alert → 卡片面板（模型状态/阶段局数/就绪/准确率）+ 💡 动态推荐保持学习附加段'
            },
            {
                file: 'js/config/config.js',
                lines: '1106-1134',
                desc: '决策后检测·数据中心：alert → 卡片面板（快照数/回合/总样本）+ 功能说明附加段'
            },
            {
                file: 'js/config/config.js',
                lines: '1136-1153',
                desc: '模型热更新：alert → 卡片面板（样本/候选/A-B进度/晋升/丢弃）'
            },
            {
                file: 'js/config/config.js',
                lines: '1155-1176',
                desc: '公共知识库：alert → 卡片面板（指纹/条目/贡献/采纳）+ Top8 高置信列表'
            },
            {
                file: 'js/config/config.js',
                lines: '1178-1214',
                desc: '策略进化：confirm+alert → 卡片面板（代数/种群/距下次进化）+ 种群排行 + "⚡ 强制进化一代"底部按钮（替代原 confirm）'
            },
            {
                file: 'score/verification/selfCheck.js',
                lines: '599-655',
                desc: '模块自检：openSimplePanel 纯文本 → 卡片面板（通过/失败/已修复/新失败/持续失败卡）+ 分组列表（可滚动），失败降级 openSimplePanel/alert'
            },
            {
                file: 'score/model/net/modelGuard.js',
                lines: '312-381',
                desc: '模型护栏：openSimplePanel 纯文本 → 卡片面板（检查/拦截/拦截率卡）+ 红线统计/冷却/最近拦截/红线类型列表'
            }
        ]
    },

    /* ===== I. 接口数据为 0 修复·三轮（反馈：公共知识库采纳 0 / 策略进化适应度 0% / 后检测快照 0） ===== */
    {
        phase: '接口数据显示为0修复·三轮',
        date: '2026-09-28',
        changes: [
            {
                file: 'score/decision/engine/engine.js',
                lines: '196',
                desc: '公共知识库改为具名导入 applySharedBonus + shareContribute（此前只有 side-effect import，函数从未被调用，采纳/贡献恒 0）'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '3423-3425',
                desc: '接入 applySharedBonus：acts.sort 前应用群体智慧加成（有高置信推荐给对应候选 +≤30% 分，采纳数 +1），闭合"采纳"数据链'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '4007-4019',
                desc: '接入 shareContribute：局结算遍历决策日志，把每个（指纹→选择→真实胜负）写入群体样本，闭合"贡献"数据链'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '4098-4106',
                desc: '策略进化胜负改用真实 _won（此前用"回合分 > 0"误判，得分≈0 时恒判负，适应度永远 0%）'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '4026-4048',
                desc: '多档案 recordResult / 决策回放 verdict 同样改用真实 _won（此前用回合分阈值，胜负归档失真）'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '4104-4110',
                desc: '积分自修改 winSM 改用真实 _won（此前回合分 > 0 误判，输赢标签全反）'
            },
            {
                file: 'js/config/config.js',
                lines: '1114-1133',
                desc: '决策后检测·数据中心面板改为展示累计统计（总检测次数/平均收益/正收益/负收益/回合/队列），替代瞬态"当前快照数"（结算后自然清 0 造成误解）'
            }
        ]
    },

    /* ===== J. 数据导出合并（多类数据 → 1 个文件 + 按钮统一为 1 个） ===== */
    {
        phase: '数据导出合并',
        date: '2026-09-28',
        changes: [
            {
                file: 'score/foundation/io/mergeExport.js',
                lines: '新增文件',
                desc: '新建合并导出模块：buildMergedExport() 把 8 类数据合并为 1 个 JSON 对象（面板全量 exportAll / 训练样本 / 对局日志人+机·仅玩家·仅AI / 公共知识库 / 策略进化 / 决策后检测 / 模型权重元信息 / 全量 localStorage 备份），并带 summary 汇总统计'
            },
            {
                file: 'score/foundation/io/mergeExport.js',
                lines: '*',
                desc: 'mergeExportAndDownload() 生成 1 个文件（无名AI_合并导出_时间戳.json）经 downloadTextFile 下载；依赖尽量走运行时句柄(window.__DJSC)与动态 import，避免加载期循环依赖'
            },
            {
                file: 'score/foundation/io/mergeExport.js',
                lines: '*',
                desc: '模块自挂载 window.__DJSC.mergeExportAndDownload / buildMergedExport'
            },
            {
                file: 'score/foundation/io/mergeExport.js',
                lines: '96-105',
                desc: '对局日志导出补齐第 4 口径：新增 gameLogPairs（人机并列），与 全量/仅玩家/仅AI 四口径齐全'
            },
            {
                file: 'score/foundation/io/mergeExport.js',
                lines: '139-181',
                desc: '新增 ⑥b 客户数据收集模块 playerData：玩家记忆（stats + list 200）+ 风格反馈（smartPanel 总线/面板探针兜底），行为观察·身份推理留索引指向 panels 明细避免文件重复膨胀'
            },
            {
                file: 'score/foundation/io/mergeExport.js',
                lines: '206-228',
                desc: 'summary 新增 gameLogPairs / playerMemoryCount 统计项'
            },
            {
                file: 'js/config/config.js',
                lines: '267-301',
                desc: '导出按钮统一：exportAllData 改为「📦 一键合并导出全部数据（单文件）」，onclick 调用 mergeExportAndDownload（未加载时动态 import mergeExport.js），成功后弹窗展示大小/合并模块数/文件名'
            },
            {
                file: 'js/config/configLayout.js',
                lines: '20-21',
                desc: '按钮合并：数据管理组去掉 exportTrainingData/quickExportAll，对局日志组去掉 exportGameLogs/exportPlayerLogsOnly/exportBotLogsOnly，只保留 exportAllData 一个导出按钮'
            },
            {
                file: 'js/config/configLayout.js',
                lines: '26',
                desc: 'hidden 集合：exportAllData 取消隐藏（成为唯一导出入口）；exportTrainingData/exportGameLogs/exportPlayerLogsOnly/exportBotLogsOnly/quickExportAll 加入隐藏（旧按钮不再渲染，功能并入合并导出）'
            },
            {
                file: 'score/index.js',
                lines: '236',
                desc: 'MODULES_TO_EXPOSE 注册 mergeExport，引擎安装时即加载并挂载 __DJSC.mergeExportAndDownload，按钮无需等首次点击'
            }
        ]
    },
    {
        phase: 'Phase K · 优化（miniPredict缓存 / 合并导入还原 / 扩展点补实现）',
        changes: [
            {
                file: 'score/model/net/mini-model.js',
                lines: '20-40',
                desc: '性能：miniPredict 增加模块级惰性权重缓存 _ensureDequantized()，MINI_W 静态权重只解量化一次，消除每回合重复 deqArr 开销（计算逻辑不变）'
            },
            {
                file: 'score/foundation/io/mergeExport.js',
                lines: '255-321',
                desc: '新增 restoreMergedExport()：从备份 JSON 还原 localStorage。支持①合并导出格式(modules.backup.data)②纯备份格式(无名AI备份/_restoreMap)③裸露 key→value（只筛无名AI/djsc 前缀键），绝不触碰其他扩展数据；挂载 __DJSC.restoreMergedExport'
            },
            {
                file: 'score/view/panel/panel.js',
                lines: '4353-4372',
                desc: 'importAll() 优先识别合并导出/备份格式 → 委托 restoreMergedExport 直接还原 localStorage；旧版 decisionLog/strategist 单类格式仍走原路径；importAllFromFile 弹窗字段对齐（imported/skipped）'
            },
            {
                file: 'js/config/config.js',
                lines: '303-322',
                desc: '导入按钮说明更新：importOverwrite 明确支持「还原合并导出文件」，importMerge 注明合并导出文件会直接还原备份'
            },
            {
                file: 'score/foundation/runtime/extensionPoints.js',
                lines: '148-221',
                desc: '扩展点补实现（2→11，就绪 5%→28%）：新增 5 个只读 metric（winRate/avgGain/positiveRate/sharedKnowHow/evolutionProgress，均安全读运行时句柄）、4 个行为中立 strategy（balanced/aggressive/defensive/support）、1 个 modelBackend(local) 委托本地模型、未就绪回退均匀分布'
            },
            {
                file: 'score/decision/skills/skills.js',
                lines: '1890-2199',
                desc: '扩展点补实现（反馈：界面记录不完全、疑似没扫到本体元素）：10 个空占位函数全部改为由已扫描标签派生——buildAutoSkillRules(逐真实技能生成自动策略规则，15s TTL 缓存)/charComboOf(武将主风格+建议)/skillRuleOf/skillBranchesOf(时机·频率·风险·代价→条件分支)/checkBranch/skillStagesOf(前置cost·核心effect·后续after拆解)/skillInteractionOf(团队标签+已知组合)/detectCombo(武将多技能互补组合)/miniFeatures/advice。根因=本体技能已被 skillTagsOf/skillProfileOf 扫到，但展示扩展点返回空导致面板显示「暂无/进入对局后评估」'
            },
            {
                file: 'score/view/panel/panel.js',
                lines: '2449-2464',
                desc: '⑧b2 技能标签区新增「已扫描技能 N 个 + 技能ID清单」展示，直观区分「扫描到了哪些」与「一列只展示 Top」；修复 agg.cost 可能为 undefined 导致该行被 catch 吞掉的问题'
            }
        ]
    },

    /* ===== L. 权重/积分逻辑重构（第一轮：积分自调 + 权重获得激活） ===== */
    {
        phase: '权重/积分逻辑重构·第一轮',
        date: '2026-09-28',
        changes: [
            {
                file: 'score/decision/engine/scoreSelfMod.js',
                lines: '21-64',
                desc: '积分自调重构①：STORE 升级 v2→v3（新增 obs 观察计数），存储键改 djsc_score_selfmod_v3；维度权重表抽成单一 DIM_WEIGHTS 常量（direct/reaction/faction/timing/compose），消除 5 处散落硬编码'
            },
            {
                file: 'score/decision/engine/scoreSelfMod.js',
                lines: '70,107,136,160,194',
                desc: '积分自调重构②：_dimDirect/_dimReaction/_dimFaction/_dimTiming/_computeScore 统一引用 DIM_WEIGHTS 子表'
            },
            {
                file: 'score/decision/engine/scoreSelfMod.js',
                lines: '222-230',
                desc: '积分自调重构③：新增样本数衰减——同一张牌观察越多（obs[id]），单次调整量 ×1/√n（下限 MIN_SAMPLE_DECAY=0.35），抑制早期少数运气局把牌分带偏触顶；resetScoreSelfMod 同步 v3 结构'
            },
            {
                file: 'score/model/train/learningOptimizer.js',
                lines: '109-124',
                desc: '权重获得激活①：课程进度持久化——_totalGames 改为读/写 localStorage(djsc_learn_course_games_v1)，recordGame 写入。此前课程学习纯内存、刷新即归零，永远从「身份判断」重复，课程设计实际失效'
            },
            {
                file: 'score/model/train/learningLoop.js',
                lines: '13-15,54',
                desc: '权重获得激活②：接线 recordGame()——learningLoop.recordGameResult 结束时调用 optimizer.recordGame()，让课程学习阶段随真实对局推进（此前 recordGame 全库无调用者，课程/优先级回放/特征重要性/自适应LR 四件套均为未接线的死区）'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '2000-2054',
                desc: '目标分配重构①：新增 _CARD_PURPOSE（卡牌→用途映射：kill/control/dismantle）、_buildTargetBrainCandidates（供 targetBrain 的候选，pp 字段保留）、_pickCardTargetByPurpose（按用途独立选目标，bestT 兜底）、identityIsLord'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '3317-3326',
                desc: '目标分配重构②：非铁索卡落盘 target 由「统一 bestT」改为「按用途独立最优目标，bestT 兜底」，根治"每回合所有牌都打/辅助唯一全局最优目标"问题'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '2070-2083',
                desc: '目标分配重构③：applyBasicTargetRules 的用途映射由仅 kill 扩展到 control/dismantle，并为每张卡写入各自 target（分散）'
            }
        ]
    },
    /* ===== L. 决策引擎 CPU 热点优化（2026-09-28） ===== */
    {
        phase: '决策引擎 CPU 热点优化',
        date: '2026-09-28',
        changes: [
            {
                file: 'score/decision/engine/engine.js',
                lines: '1363-1420',
                desc: '手牌计数快照缓存：countCardName/hasCardName 由每调用 O(|hand|) 改为按 me.getCards("h") 引用逆转指针快照（prevHand===当前手牌引用）只扫一次，缓存记数表；expectedValue 对 sha/juedou 的重复整手扫描成为常数级'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '1445-1465',
                desc: '边际价值频次缓存：marginalValue 由每张候选牌 O(|hand|) filter 统计，改为按 hand 数组引用缓存一次记数表（_handFreqCache），候选循环内常数级'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '2532-2536',
                desc: '手牌候选循环预取 bestTStyle=styleOf(bestT)：bestT 在循环内不变，由每张牌重复计算 styleOf 改为循环前一次取出，循环内复用'
            }
        ]
    },
    /* ===== M. 连招检测缓存（2026-09-28） ===== */
    {
        phase: '连招检测缓存',
        date: '2026-09-28',
        changes: [
            {
                file: 'score/decision/skills/skills.js',
                lines: '2107-2146',
                desc: 'detectCombo 加 WeakMap 缓存（_COMBO_CACHE）：bestAction 每决策都会调 detectCombo，其内部 aggregateSkillTags 对每个技能做标签聚合；现以 me 为键、me.skills 引用为失效依据，决策内复用结果，杜绝每决策重复 O(技能聚合) 计算'
            }
        ]
    },
    /* ===== M2. 技能聚合/配合/特征全链路缓存（2026-09-28） ===== */
    {
        phase: '技能聚合/配合/特征全链路缓存',
        date: '2026-09-28',
        changes: [
            {
                file: 'score/decision/skills/skills.js',
                lines: '1608-1646',
                desc: 'aggregateSkillTags 加 _AGG_CACHE（WeakMap 以 skills 数组为键）：detectCombo/charCombo/miniFeatures 反正重复遍历 skillTagsOf 聚合；命中返回浅拷贝（top-level 数值键副本）避免下游持引用修改污染共享缓存'
            },
            {
                file: 'score/decision/skills/skills.js',
                lines: '2161-2201',
                desc: '_charCombo 加 _CHAR_COMBO_CACHE（Map 按武将 name 缓存）：lib.character[name] 局内不变，按 name 缓存主风格+建议，避免重复改编组六维评分；上限 2048 防无限增，clearGainCache 中 clear'
            },
            {
                file: 'score/decision/skills/skills.js',
                lines: '2203-2227',
                desc: '_miniFeatures 加 _MINI_CACHE（WeakMap 以 me 为键）：精简特征按玩家对象引用复用，局内同角色只算一次'
            },
            {
                file: 'score/decision/skills/skills.js',
                lines: '1648-1656',
                desc: 'clearGainCache 补充清理 _CHAR_COMBO_CACHE；其余派生缓存均为 WeakMap 靠引用失效+GC自动回收，注明无需手动清'
            }
        ]
    },
    /* ===== N. 货币等量规则 + 单回合线性动量（2026-09-28） ===== */
    {
        phase: '货币等量规则·基础元素 + 单回合线性动量',
        date: '2026-09-28',
        changes: [
            {
                file: 'score/decision/engine/engine.js',
                lines: '706-726',
                desc: '新增货币等量规则 toMoney()：定义基准单位 MONEY_UNIT=1（1货币=1标准收益点）。分区折算 ——|pts|≤8 线性 1:1，8<|pts|≤50 亚线性×0.5，>50 再×0.2 渐压缩并封顶 29 货币。把击杀+999、灌爆≈1003 等单次巨额收益统一压到有界货币值'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '554-566',
                desc: 'give 底层入库统一经 toMoney 折算：round 贡献分/scoreLog 以货币为基准，单次巨额不再主导贡献分、不破坏训练归一化'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '710-751',
                desc: '单回合动量：_updateMomentum 记录当前行动者本回合连续同向收益步数（±MOM_CAP=5），倍率=1+streak*MOM_STEP，clamp[0.7,1.3]。方向判定一律经 toMoney 货币化，单次巨额不翻转方向'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '920-922',
                desc: 'scoreCardUse 出牌后以牌净收益 v.use 驱动 _updateMomentum，随当前回合锁定 _status.currentPhase 对齐'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '3373-3376',
                desc: 'bestAction 候选卡评分收敛期乘 turnMomentum(me)：持续高收益乘胜追击、持续低收益及时止损，作为通用线性倍率不偏科'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '554-567',
                desc: '【货币与积分合并】round 贡献分直接以货币为唯一计量：移除 round 上的 Int8 分层量化（货币已天然有界，旧防溢出量化冗余）。_rawRound 存货币浮点，round 持货币值，量纲全局统一：贡献分→阵营平均→结算→训练回填 全部读货币值'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '139',
                desc: '【合并配套】import 收窄：移除不再使用的 toFloat / unbiasedRound（toInt8 仍保留，用作 bestAction 候选评分内部量化，与贡献分货币无关）'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '473-480',
                desc: '【守恒引擎】新增全局守恒台账 _ledger 总账：守恒不变量 Σ玩家round + ledger = 0 恒成立，每笔 give 自动同步（加分→ledger补亏，扣分→ledger存留）'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '559-622',
                desc: '【守恒引擎】入场投入 + 系统奖池：SEED_FEE=1 入场费（对局开始所有玩家损失一部分货币进奖池），SYSTEM_POOL_RATE=0.3 系统给予总约30%货币由失败阵营产出补偿（不凭空造币）。_initLedger 开局记账、_winningSet 胜方识别、conservationLedger 守恒审计'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '4203-4233',
                desc: '【守恒引擎】结算产出分配：系统奖池按胜负分配给胜方存活玩家，货币产出由游戏失败后的阵营产生（失败方负贡献即产出来源），归属 tag「系统奖池（失败阵营产出·30%）」'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '4234-4241',
                desc: '【守恒引擎】结算守恒审计日志：log.info 打印 玩家Σ / ledger / 守恒偏差 / 系统奖池，供排查守恒不变量'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '4824-4825',
                desc: '【守恒引擎】导出 getConservationLedger() 供面板/调试桥调用'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '4840-4843',
                desc: '【守恒引擎】clearScoreState 清零 _ledger / _poolPromise，避免跨局污染'
            },
            {
                file: 'score/view/panel/panel.js',
                lines: '26,3743',
                desc: '【守恒引擎】面板桥新增 __DJSC.conservation()：可实时查看 玩家Σ / ledger / 守恒偏差 / 入场费 / 系统30%奖池'
            },
            {
                file: 'score/knowledge/exchange/exchange.js',
                lines: '全新建',
                desc: '【动态换算系统·单一货币】新建汇率中枢：FX_DIMS 定义各维度基准价（card/effect/skill/hp/cardCount/risk/psych/tempo），FX_PHASE_COEF 阶段动态系数，fxRate/fxToMoney/fxSnapshot 提供统一换算。所有收益最终折算进 toMoney 唯一货币'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '36-37,691-719',
                desc: '【动态换算系统】导入汇率中枢；新增 cash(char,dim,business,tag) 动态换算记账入口（业务值×动态汇率→货币→round），_stage() 推断 early/middle/late/endgame 阶段供汇率系数'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '945,959,993,1017',
                desc: '【动态换算系统】scoreCardUse 各牌收益改为 cash(...,"card",...)：解除横置/顺判定区/挂起基础分/AOE误伤 统一按牌类型汇率换算成货币'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '608-624',
                desc: '【动态换算系统】conservationLedger 附加 fx 动态汇率快照，面板 __DJSC.conservation() 可查看当前阶段各维度汇率'
            },
            {
                file: 'score/foundation/runtime/plugins.js',
                lines: '全新建',
                desc: '【插件化架构】新建标准插件框架：definePlugin/registerPlugin/installPlugin/uninstallPlugin，声明 id/name/type/依赖/props/onInstall/onUninstall/onStart/onGameEnd 生命周期；依赖检查、props 软合并、状态跟踪、列表/统计、对局生命周期广播'
            },
            {
                file: 'score/plugins/index.js',
                lines: '全新建',
                desc: '【插件化架构】插件索引：集中 import 各插件模块 + loadPlugins/pluginOverview/pluginState；新增功能=新建插件文件+登记1行import'
            },
            {
                file: 'score/plugins/enginePlugin.js',
                lines: '全新建',
                desc: '【插件化架构】核心示范1 引擎插件(djsc.engine)：type=engine，登记引擎生命周期，onGameEnd 调 clearScoreState；真实 hook 仍走 index.js 成熟路径避免双重安装'
            },
            {
                file: 'score/plugins/panelPlugin.js',
                lines: '全新建',
                desc: '【插件化架构】核心示范2 面板插件(djsc.panel)：type=panel，依赖 djsc.engine，props 软合并 __DJSC.panel，onInstall/onUninstall 对称启停调试桥与对话框守卫'
            },
            {
                file: 'score/plugins/skillPlugin.js',
                lines: '全新建',
                desc: '【插件化架构】核心示范3 技能插件(djsc.skills)：type=scorer，props 软合并 __DJSC.skills 接口，onStart 每局重置扫描缓存'
            },
            {
                file: 'score/plugins/cognitionPlugin.js',
                lines: '全新建',
                desc: '【插件化架构】新增功能示范(djsc.cognition)：零依赖只读情报中心，示范如何三步独立贡献能力（definePlugin+注册+登记import）且不改 core'
            },
            {
                file: 'score/index.js',
                lines: '24-26,46-56,302',
                desc: '【插件化架构】加载插件索引+暴露 __DJSC.plugins(list/state/broadcast)；启动记录插件总数，卸载时广播 gameEnd'
            },
            {
                file: 'score/decision/strategy/comboChain.js',
                lines: '26-228,310-345,422-425',
                desc: '【连招学习】内置连招由6条扩至14条（新增火攻消耗/顺借乐连环/借刀杀联动/决斗杀诱因/冰冻乐连锁/无中起手爆发/杀闪逼防/月英集智）；新建学习回路learnChainUse(按胜利+0.15/败-0.1微调权重)+learnedChains/clearLearnedChains，跨局持久化于 djsc_learned_chains_v1；detectChains 合并内置+学习连招，stats 返回 learned/learnedCount'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '200,250-263,4308-4320',
                desc: '【连招学习】导入 learnChainUse/learnedChains/clearLearnedChains 并挂载到 __DJSC.comboChain；训练结算处新增连招学习回填：对本局识别出的连招按胜负 _won 回填权重'
            },
            {
                file: 'score/plugins/skillPlugin.js',
                lines: '16,20-31,39-49',
                desc: '【连招学习】新增 skills.comboReset/learnedChains 接口；onStart 每局调 resetComboChain 重置临时权重并加载持久化学习连招'
            },
            {
                file: 'score/decision/threat/threat.js',
                lines: '103-138',
                desc: '【P1修复】threatOf 曾被注入垃圾代码(引用未定义 getCamp/from/to/result)+第117行 return 1，导致真实威胁计算完全不可达。已清除垃圾并恢复真实计算；runtime 验证满血4/装备0=1.68、残血2/手牌3=1.49，区分度恢复，不再恒1'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '1586-1652',
                desc: '【P2修复·EV概率模型】①八卦阵命中改为 pHit *= (1-bgRate)（原 pHit -= bgRate 低估命中）；②酒杀不再"有酒即必成功"，需同时有杀按0.85折算dmg；③卖血/反击 -3 惩罚乘命中概率 pHit；④残血奖励乘命中折算；⑤决斗 EV 计入"输面自伤"(敌我杀差×0.8×(1-pHit))，不再只算成功收益'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '2026(现4027)',
                desc: '【P2修复】广播攻击牌列表 tiesu->tiesuo（拼写bug，铁索意图广播现可生效）'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '3743-3761',
                desc: '【衔接修复】refineBestWithPlan 返回值带 target 后 engine 同步 bestT/bestTs(score)，使规划目标与最终执行目标一致（此前 killTarget 从未被消费）；护栏 fallback 替换动作后同步 bestTarget 避免字段矛盾'
            },
            {
                file: 'score/decision/strategy/planner.js',
                lines: '56-160',
                desc: '【P2修复·规划器】①不确定伤害按命中折算：杀用 probHasShan、火攻/决斗/AOE约按0.7/0.75/0.8；②资源占用表 take() 避免同一张杀被酒杀与决斗重复计入；③killable 双门槛(期望压线+保底/超额覆盖)避免"假必杀解"；④删除第2步展望与305-308行重复连招奖励(顺手+杀、铁索+杀等不再双加)'
            }
        ]
    },

    /* ===== AB. 暗身份评分倍率（随轮数提升，主公/明置除外） ===== */
    {
        phase: '暗身份评分倍率',
        date: '2026-09-28',
        changes: [
            {
                file: 'score/decision/strategy/modeStrategy.js',
                desc: '【暗身份倍率】DEFAULT_STRATEGY 新增 hiddenIdentity 逐模式配置{enable,multiplier,lateGrowthPerRound,maxMultiplier}，默认 enable:false（明置身份局/模式天然除外）；身份局(identity)开 ×1.12、国战(guozhan)开 ×1.08。另含互斥说明：主公/明置角色不参与'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '3682-3718',
                desc: '【暗身份倍率】engine 在模式加分后统一消费 hiddenIdentity：对"非主公且未明置"的暗身份角色，隐蔽动作评分×倍率；动作指向明身份/明势力目标(暴露自己)→倍率回落1(等效"无意义暴露身份"软惩罚)；倍率随轮数微弱提升(_getRoundNumber)，每轮+lateGrowthPerRound(默认0.004)，封顶maxMultiplier(默认base+0.15)防爆。等价测试5/5通过'
            }
        ]
    },
    {
        phase: '导出栏目归并（玩家/对局 → 导出学习数据）',
        date: '2026-09-28',
        changes: [
            {
                file: 'js/config/config.js',
                lines: '486-519',
                desc: '「导出AI学习数据」升级为统一导出入口：导出训练样本的同时，若对局日志库有数据则一并下载「对局日志(人+机，含玩家操作与AI决策链)」，玩家/AI操作不再单列'
            },
            {
                file: 'js/config/config.js',
                lines: '641-642',
                desc: '删除三个独立导出栏目(按钮)：exportGameLogs(导出全部对局日志)、exportPlayerLogsOnly(只导出玩家操作)、exportBotLogsOnly(只导出AI操作)，功能并入 exportTrainingData'
            },
            {
                file: 'js/config/configLayout.js',
                lines: '20,26',
                desc: '把 exportTrainingData 挂到「七、数据管理」分组并移出 hidden(重新显示为导出入口)；清理 hidden 中已删除的 exportGameLogs/exportPlayerLogsOnly/exportBotLogsOnly'
            }
        ]
    },
    {
        phase: '对局导出全面并入学习数据 + 人机给队友放无懈修复',
        date: '2026-09-28',
        changes: [
            {
                file: 'score/view/panel/panel.js',
                lines: '470-475,3068-3071',
                desc: '面板对局日志区块：删除下载(全量/仅玩家/仅AI/人机并列)/复制/分享按钮，仅保留清空；文字提示导出走主设置「导出AI学习数据」'
            },
            {
                file: 'score/decision/override/respond.js',
                lines: '18-19,80-101,136-147,160',
                desc: '【人机给队友放无懈】_keepWuxie 队友判定由 get.attitude 升级为优先 isSameCamp(AI身份推理，含已阵亡阵营反推)；对"自己/队友被有害锦囊(shunshou/guohe/jiedao/tiesuo等非关键)也保护"；响应ctx携带 isAlly'
            },
            {
                file: 'score/decision/basic/respondBrain.js',
                lines: '71-80,130-133',
                desc: 'vetoRespond(无懈)队友被锦囊→不再因非关键+手少否决；respondPriority(无懈)队友纳入高优(78)。纯函数5/5通过'
            }
        ]
    },
    {
        phase: '主动技能阵营判定接入',
        date: '2026-09-28',
        changes: [
            {
                file: 'score/decision/strategy/modeStrategy.js',
                lines: '16',
                desc: '【主动技能·阵营兜底】import identityOf；让身份模式主动技能(及全部 isSameCamp 判定)能回退到身份推理(含已阵亡阵营反推)，不再只靠显式 player.identity'
            },
            {
                file: 'score/decision/strategy/modeStrategy.js',
                lines: '155-173',
                desc: '【主动技能·阵营兜底】IDENTITY_STRATEGY.isSameCamp 重写：双方显式已知→直接比；一方未知→用 identityOf 推理补足(camp 映射)，推理仍 unknown→保守视敌，推理出内奸→非同阵营。使主动攻击技对"已阵亡反推后判忠"的未明者不再误伤，防御/辅助/救援技只选被判定为同阵营的目标。经等价测试验证 6/6 通过(含主公 vs 反推判忠未明者→同阵营)'
            }
        ]
    },
    {
        phase: '已阵亡阵营反推',
        date: '2026-09-28',
        changes: [
            {
                file: 'score/perception/observer/identity.js',
                lines: '66-126',
                desc: '【已阵亡阵营反推·辅助函数】新增 _allPlayers(含Dead去重)/_countShownRole(已明置含阵亡的某阵营人数)/_campCaps(各阵营上限：OL标准身份局配置表 非主公N→[忠,反,内]；未知人数退化为保守上限、仅内奸唯一生效)'
            },
            {
                file: 'score/perception/observer/identity.js',
                lines: '377-394',
                desc: '【已阵亡阵营反推·核心】_computeBelief 归一化前插入剔除逻辑：某阵营已"现身"(明置或阵亡公开)数量≥上限 → 存活未知者该阵营信念归零(b[r]=0)；自己恰明置该阵营则跳过。依托①内奸恒为1②反贼/忠臣有配置上限，保守(仅达上限才剔、绝不提前)。runtime验证：内奸现身→存活者nei=0；反贼全现身→未明置存活者fan=0；明置反贼自身保留fan=1'
            }
        ]
    },
    {
        phase: '连招库新增数据纳入导出（维度全）',
        date: '2026-09-29',
        changes: [
            {
                file: 'score/decision/strategy/comboChain.js',
                lines: '109-174',
                desc: '【连招库全维度导出/回流】新增 SESSION 局内高分登记(finalizeLearned 按胜负固化)、exportAllChains(内置+新增learned一并导出，维度含 id/name/setup/follow/bonus/learned/times/wins/winRate/source)、importChains(内置不覆盖，learned合并或新增，persist持久化)'
            },
            {
                file: 'js/config/config.js',
                lines: '492-521',
                desc: '【导出学习数据并入连招库】导出入口 exportTrainingData 一并调用 comboChain.exportAll() 生成「无名AI_连招库_时间戳.json(内置+学习，维度全)」；导入入口 importTrainingData 解析 chains/comboChain/learningData 段并调 comboChain.importChains() 回流'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '200,250-266,4300-4320',
                desc: '【连招库接入引擎】导入 finalizeLearned/exportAllChains/importChains 并挂载 __DJSC.comboChain(exportAll/importChains/finalize)；对局结算调用 finalizeLearned(_won) 把本局高分连招固化入库'
            },
            {
                file: 'score/foundation/io/mergeExport.js',
                lines: '197-206',
                desc: '【一键合并导出补连招库】buildMergedExport 新增 modules.comboLibrary(结构化全维度，含新增learned；此前仅靠backup原始字符串)；summary 增加 comboLibraryCount。合并导入仍走 restoreMergedExport 整库还原(djsc_learned_chains_v1 一并带回)'
            }
        ]
    },
    {
        phase: 'AI 负收益样本采集 + 全量导出（不过滤）',
        date: '2026-09-29',
        changes: [
            {
                file: 'score/decision/engine/engine.js',
                lines: '4234-4248',
                desc: '【负收益进样本】此前只记录 best(最高分)动作，负收益动作 100% 丢失(实测负 reward 仅占 0.2%)。现遍历候选动作，把被否决/压负分(score<0)的动作以负数 reward 一并写入样本，每轮至多 3 个，构成正负对照，让模型学到"什么不该做"'
            },
            {
                file: 'score/model/train/trainExport.js',
                lines: '473',
                desc: '【负样本标记】样本 meta 新增 negative 布尔标记(score<0 时 true)，便于导出后离线分析识别负收益样本'
            },
            {
                file: 'score/model/train/trainExport.js',
                lines: '341-347',
                desc: '【全量导出不过滤】exportAsJson 的 minReward 由 -50 改为 -Infinity，不再丢弃任何负收益/低分样本，全部原样导出'
            }
        ]
    },
    {
        phase: '扩展加载失败修复（命名导出对齐）',
        date: '2026-09-29',
        changes: [
            {
                file: 'score/plugins/skillPlugin.js',
                lines: '13-16',
                desc: '【加载失败修复】skillPlugin 原先从 skillScanner.js import scanCharacters，但该函数实际定义于 skills.js，skillScanner.js 仅导出 scanObjectMethod → ES module 缺导出导致扩展整包加载崩溃。改为 scanCharacters 从 skills.js 导入，scanObjectMethod 保留从 skillScanner.js 导入'
            },
            {
                file: 'score/foundation/runtime/plugins.js',
                lines: '171-178',
                desc: '【补全缺导出】新增 pluginOverview()(返回 total/installed/list)，供 cognitionPlugin 调用，避免下一个潜在加载失败点'
            },
            {
                file: 'score/foundation/diag/changelog.js',
                lines: '*',
                desc: '【全量静态校验】对全部 ES module 命名导入做导出对齐扫描，修正后无真实缺失导出(剩余 noname.js 为内核桩、注释里 …/plugins.js 为示例文本，均非问题)；全部 JS node --check 语法通过后重新打包'
            }
        ]
    },
    {
        phase: '濒死救援阵营判定补丁（不再救非队友）',
        date: '2026-09-29',
        changes: [
            {
                file: 'score/decision/override/respond.js',
                lines: '145-160',
                desc: '【救援友敌判据统一】origin 濒死响应 ctx 的 dyingTarget.isAlly 原用 get.attitude(player,tgt)>0，身份未明玩家 attitude=0 导致友敌判定失真。改为复用 isSameCamp(player,tgtgt)（与攻击侧一致的统一阵营判据，含身份推理；身份未知且推理不出时保守返回 false → 视为敌）。配合 vetoRespond 桃分支(dyingTarget.isAlly===false && !mustSave → 否决)，实测可拦截"主公救反贼/内奸"及身份未明非队友'
            }
        ]
    },
    {
        phase: '扩展加载失败修复（可选链 ?. 在旧 WebView 解析报 SyntaxError）',
        date: '2026-09-29',
        changes: [
            {
                file: 'js/content/precontent.js',
                lines: '150,157-158,228,332',
                desc: '【加载失败根因】浏览器报 SyntaxError: Invalid or unexpected token <br/>。根因：precontent.js 与 optimization.js 位于 extension.js 顶层静态 import 链上，大量使用 ES2020 可选链(?.)；运行设备的旧版 WebView 不支持该 token，解析到第一个 ?. 即整包加载失败。将 4 处 ?. 改写为等价兼容写法（lib.skill[skillId]&&…、skill&&skill.ai&&…、get.info(card)&&…、par&&…）。全扩展已将可选链归零'
            },
            {
                file: 'js/content/optimization.js',
                lines: '76,280,538,1904,1913,1921',
                desc: '【同上】改写 optimization.js 中 6 处可选链 ?. 为兼容写法（event.card&&…、viewAs&&…、player.storage…&&…），消除旧 WebView 解析期 SyntaxError'
            }
        ]
    },
    /* ===== Z. 兼容旧版 WebView · 整包加载 SyntaxError 根治 ===== */
    {
        phase: '兼容旧版WebView·加载SyntaxError根治',
        date: '2026-09-29',
        changes: [
            {
                file: 'extension.js',
                lines: '127-154',
                desc: '【加载失败根因2】移除模块顶层 await `await lib.init.promises.json(...)`（Chrome89+/ES2022 才支持）。仅清除可选链 ?. 仍会在该顶层 await 处整包装载失败（旧 WebView 报 SyntaxError: Invalid or unexpected token）。已改为：同步定义 extensionPackage，再用异步 IIFE 内 Promise.resolve().then() 读取 info.json 并合并进 package，全扩展不再依赖任何模块顶层 await。'
            },
            {
                file: '全扩展(核验)',
                lines: '—',
                desc: '核验并归零全部旧 WebView 不支持解析的 token：可选链 ?.、空值合并 ??、逻辑赋值 &&=/||=/??=、数字分隔符 1_000、顶层 await 均归零；acorn ecmaVersion2019/2020/2021 全量218个文件通过解析，仅保留动态 import()（Chrome63+）与 async 函数（Chrome55+），兼容 Chrome63~79 旧 WebView'
            }
        ]
    },
    /* ===== AA. 残局策略细化（不再呆板） ===== */
    {
        phase: '残局策略细化',
        date: '2026-09-29',
        changes: [
            {
                file: 'score/decision/tuning/endgameOpt.js',
                lines: '全文件重写',
                desc: '残局策略由仅按存活人数分 1v1/1v2/2v1 的粗判，细化为覆盖 1v1/1v2/2v1/2v2：新增斩杀线判定（敌人残血优先补刀）、攻击距离可达性、濒死队友优先抢救、1v1 手牌结构（闪/桃/出杀能力）研判；endgameBonus 的牌类加成同步匹配各细分策略（补刀/AOE收尾/AOE慎放/保命/摸距离/集火/救队友）。新增端到端残局攻击倾向 endgameAggression，供策略与加成统一使用。'
            }
        ]
    },
    /* ===== M. 四系统重置 · 暴露/阵营/敌我/收益统一关系系统（2026-09-30） ===== */
    {
        phase: '四系统重置·统一关系系统(Relations)',
        date: '2026-09-30',
        changes: [
            {
                file: 'score/decision/relations/relations.js',
                lines: '全文件新建',
                desc: '新建统一关系系统模块，收口四个耦合系统为全工程唯一权威源：①暴露系统 exposureOf(只记录认知：明暗/已知度/认知来源/推断置信度，不下敌友结论)；②阵营系统 campRelationOf(四态：same/opposite/independent/unknown，内奸/野心家=independent，身份未明=unknown 不推定敌)；③敌我系统 dispositionOf(attitude 三态基线 + 行为推断软翻转，与阵营系统彻底分离)；④收益系统 actionValue(统一收益入口，单调三态强判定：攻击只对真敌正、辅助/救援只对真友正、中性一律负；★杜绝"给敌方摸牌/增益/乱救"病根)。'
            },
            {
                file: 'score/decision/threat/threat.js',
                lines: '109-127',
                desc: '敌我三态 dispositionOf/isAllyOf/isNeutralOf 由原裸读 get.attitude 收敛为委托统一 relations 版本(attitude 基线+行为推断软翻转)，单一权威源，杜绝敌人/中立被误判。'
            },
            {
                file: 'score/decision/override/respond.js',
                lines: '18-20, 73-84, 95-101, 151-157',
                desc: '救援/无懈/濒死友敌判定由 isSameCamp(阵营)统一改为敌我系统 relIsAlly(dispositionOf)：真队友才救、真队友被有害锦囊才保护，敌/中性/身份未明不乱救不乱保(病根之一)。'
            },
            {
                file: 'score/perception/team/team.js',
                lines: '18-28',
                desc: '团队 _isEnemy 由裸 get.attitude+!isSameCamp 兼任敌我，统一改为 relDisposition(me,other)<0(统一敌我系统)，中立不再被当敌。'
            },
            {
                file: 'score/decision/engine/engine.js',
                lines: '50-51, 3320-3330, 3676-3711',
                desc: '引擎全面接入统一关系系统：①导入 relActionValue/relExposureOf 统一入口；②卡牌目标评分"对象匹配"段由 isSameCamp/getCamp 阵营判敌改为 isAllyOf/isEnemyOf 敌我三态；③新增"统一收益方向守卫"：对每个作用于玩家的 act 用 actionValue 强制方向判定(攻击只对真敌/辅助救援只对真友，中性强负、真友攻击/真敌增益强罚)，收口散落各处依赖阵营的目标口径。'
            }
        ]
    },
    {
        phase: 'v4.1.2.8 · 六项针对性修复（扫描/迁移/归档/统计/上传锁/shadow 落盘）',
        date: '2026-10-16',
        changes: [
            {
                file: 'js/update/updateCore.js',
                lines: '716-855',
                desc: 'P1 落盘扫描改为纯函数 classifyArchiveScan（宿主层与自动化测试共用同一实现）：按 paramSpec 的 {key,len,kind} 逐参数核对（元素数与实际字节数分开记，int16 字节=元素×2），数据纪元/网络结构版本/官方记录 sha256 一并校验，五态结论 builtin-only / official-intact / archive-mismatch / params-ok-no-record / damaged；读取失败或契约不可用一律 ok=false + verdict=null，绝不退化成 builtin-only。'
            },
            {
                file: 'js/update/modelUpdate.js',
                lines: '294-330, 617-630, 1015-1034',
                desc: 'P1 宿主层修复：①删除未定义的 readArchive() 调用，改用 weights.js 只读接口的 storageOps.readArchiveStrict()（不吞异常，读不到能被识别）；②paramsDigest/官方记录改读 sha256 字段（原读 rec.digest 恒空）；③训练证据与内置默认摘要抽成 _scanContext，供完整性核验与扫描共用；④scanWeightsOnDisk 移到模块作用域并 export，判定逻辑委托 updateCore，扫描本身不再误报 ok。'
            },
            {
                file: 'js/config/config.js',
                lines: '34-140, 816-828',
                desc: 'P1 配置迁移：原实现只改 lib.config 后调用无参 game.saveConfig()（本体语义为逐键落盘/单参删键，无参等于 delete lib.config[undefined]），标记与删除都没写盘 → 每次启动重跑迁移、玩家设置被反复重置。改为逐键 _persistConfigKey 落盘、全部成功后才写标记、只清理"止血期取值"（useTrainedModel=false / championBoost=3）、写入被拒或重载中不写标记也不留内存。'
            },
            {
                file: 'js/config/config.js',
                lines: '98-140, 816-828',
                desc: 'P1 超大归档改为非破坏性：超过 1MB 只暂停新增归档（开关落盘）+ 一次性提示（提示标记落盘，重启不再打扰），绝不删除历史归档；删除必须由玩家明确确认；新增设置菜单入口「清空战报归档」（clearArchiveWithConsent 二次确认），查看/导出入口保持。'
            },
            {
                file: 'js/config/configSchema.js',
                lines: '24, 193, 325',
                desc: 'P1 归档面板接入：02·对局记录新增 clearArchive 动作项（dangerous，二次确认）及标签/说明映射。'
            },
            {
                file: 'score/foundation/runtime/extensionPoints.js',
                lines: '131-143',
                desc: 'P2 训练样本指标不再把"本地样本数 + 累计已上传数"相加（上传成功后本地样本仍保留，本地数已含已上传数，相加必然重复计数）；指标只报本地保存样本数，标签改为「本地训练样本（本地保存）」。'
            },
            {
                file: 'score/foundation/cloud/cloudIngest.js',
                lines: '551-585',
                desc: 'P2 status() 明确区分三个口径：本地保存样本数（bufferTotal）/ 当前待上传（pendingSamples）/ 历史累计成功上传（uploadedTotal），并新增 sampleCounts 显式暴露，禁止相加冒充去重总数；游标与样本结构保持不变。'
            },
            {
                file: 'score/foundation/cloud/cloudIngest.js',
                lines: '372-382, 392-414, 415-470',
                desc: 'P2 上传任务锁：原实现先置 _uploading=true 再判退避，命中退避直接 return → 锁永不释放，此后自动与手动上传恒返回 busy 直到刷新。改为退避判断前移，主体抽为 _uploadRun，成功/失败/异常/提前返回全部经 _release 统一复位（异常路径另记 lastErr 并可重试）。同处修复限流退避失效：429 错误补 rateLimited 标记（消费端原用 /rate_limit|429/ 匹配中文文案，恒不命中 → 30 分钟退避从未生效）。'
            },
            {
                file: 'shadow/shadowCore.js',
                lines: '34-118, 337-372',
                desc: 'P2 防抖写盘补齐可靠性（保留 5s 脏写性能优化）：①新增 pagehide/beforeunload 同步兜底刷盘（注册/清理幂等，off 时移除）；②写盘失败退避 60s，不再每 5s 无限重试；③空日志不落盘，清空后强制刷盘不会把键建回来；④off 收缩直接落盘，不再经 saveLog 把刚释放的内存缓存用旧日志填回（旧缓存复活）；⑤导出 flushShadowLog/ensureExitFlush/dropExitFlush 与 __shadowLogTest 测试钩子。'
            },
            {
                file: 'extension.js',
                lines: '158-165',
                desc: 'P2 扩展卸载时先 flushShadowLog(true) 并 dropExitFlush()，把 shadow 防抖窗口内未落盘的记录同步写掉（动态 import，模块已加载时同微任务内完成）。'
            },
            {
                file: 'tools/noname-stub-loader.mjs（新增）',
                lines: 'all',
                desc: '测试用宿主桩加载器：把任何指向 noname.js 的 import 换成统一桩模块，使 Node 侧能真实 import 生产模块（含宿主适配层），避免用理想化假对象掩盖宿主接口差异。'
            },
            {
                file: 'tools/test-regressions.mjs（新增）',
                lines: 'all',
                desc: '六项修复的回归测试（68 项行为断言，含五态扫描、读失败不得冒充 builtin-only、迁移逐键落盘/失败不写标记/重启不重跑、超大归档不删除且需确认、三口径统计不相加、上传锁退避与异常路径、shadow 退出刷盘/幂等/清空不复活/配额退避）。运行：node tools/test-regressions.mjs'
            }
        ]
    },
    {
        phase: 'v4.1.2.8 · 四项遗留问题修复（配置写入确认 / 迁移不覆盖玩家设置 / 扫描严格读记录 / shadow 退出刷盘）',
        date: '2026-10-16',
        changes: [
            {
                file: 'js/config/config.js',
                lines: '36-116',
                desc: 'P0 配置写入确认重写：核对本体源码后确认 game.saveConfig(key,value,local,callback) **不返回 Promise**（结尾 save(...).then(callback) 无 return），且 _status.reloading 时直接 return（不落盘/不回调/不改内存）；game.promises.saveConfig 在 reloading 时 return Promise.resolve()（完成≠落盘），底层失败时回调不触发→该 Promise 既不一 resolve 也不 reject。旧实现要求返回 Promise，导致正常写入也被误判"未受理"、迁移标记永远写不进去（每次启动重跑迁移）。现改为：reloading 前置检查 → 优先 promises.saveConfig、缺省走回调形态 → 5s 超时兜底（不无期限等待），完成判据只认宿主回调，绝不用内存 lib.config 推断成功。'
            },
            {
                file: 'js/config/config.js',
                lines: '53-84, 118-127',
                desc: 'P1 迁移改为证据门控：核对版本历史（git log -S championBoost/useTrainedModel）确认止血期措施全部在代码层，不存在"由扩展写入这两个键"的痕迹，单凭数值无法证明取值来源。故本版本不修正任何玩家已保存的配置（CFG_MIGRATION_EVIDENCE 为空表，__cfgMigrationPlan 无证据恒返回空），只记录一次性迁移标记；未配置用户继续吃当前默认值（useTrainedModel=true、championBoost=0）。将来出现可证明来源的强制写入标记时，加一条 {name, forcedValues, evidenceKey} 即可放行，且只清理"与强制写入值完全相同（玩家没再改过）"的键。本条覆盖上一版"只清止血期取值"的清理策略。'
            },
            {
                file: 'js/update/modelUpdate.js',
                lines: '1015-1044',
                desc: 'P2 扫描官方记录改严格读取：scanWeightsOnDisk 不再用宽松 readOfficialRecord()（safeGet 把访问/解析异常吞成 null → 读失败被谎报成"没有官方记录"而给出 builtin-only），改用已有 readOfficialRecordStrict()（仅键不存在才返回 null，访问/解析异常向上抛）+ asOfficialRecord 结构校验；安装/恢复/门禁等既有严格读取路径未改动。'
            },
            {
                file: 'js/update/updateCore.js',
                lines: '717-746',
                desc: 'P2 classifyArchiveScan 新增 officialReadError 入参：官方记录"读取失败 / JSON 损坏 / 结构不合法"一律 ok=false + verdict=null + 明确错误，不得退化成 builtin-only / params-ok-no-record；键确实不存在时仍正常进入无记录态。五态结论、参数长度与字节数区分、数据纪元、SHA-256 校验保持不变。'
            },
            {
                file: 'shadow/shadowCore.js',
                lines: '55-62, 121-125',
                desc: 'P2 退出刷盘去重：flushLog 只在存在未落盘的脏数据时才写盘（force 仅绕过退避时间，不再绕过脏判断），beforeunload 与 pagehide 连续触发时第二次不再对已保存日志重复整包同步写；saveLog 覆盖内存后先标脏再刷盘。5s 防抖、配额失败退避、退出兜底、off 清理与监听幂等均保留。'
            },
            {
                file: 'tools/test-regressions.mjs',
                lines: 'all',
                desc: '宿主桩按本体真实语义重写（saveConfig 返回 undefined + 回调完成信号 + promises 形态 + reloading 静默丢弃 + 存储失败/悬挂不回调），并新增 P0/P1/P2-a/P2-b 用例：写入确认不误判、存储失败/悬挂/重载中都不谎报、中断可重试、玩家已保存设置不被覆盖、真实启动路径自动迁移、官方记录读失败与真缺失分开、连续退出事件只写一次、监听幂等、clear 不复活、off 不重写。回归总数 84 项。运行：node tools/test-regressions.mjs'
            }
        ]
    },
    {
        phase: 'v4.1.2.8 · 扫描官方记录两个边界修复（JSON null 区分 / 摘要完整性）',
        date: '2026-10-16',
        changes: [
            {
                file: 'js/update/modelUpdate.js',
                lines: '268-294',
                desc: 'P2 扫描官方记录读取新增 readOfficialForScan（仅扫描诊断用；安装/恢复/事务继续走 readOfficialRecordStrict，一行未动）：本体 localStorage 的 getItem 对"键不存在"返回 null、对"键存在但内容为空串"返回 \'\'，旧严格读取把空串一并当成不存在，且 JSON.parse(\'null\') === null 也与不存在混淆，导致"键存在但内容 null/空串"被谎报成"没有官方记录"。现在键不存在 → { exists:false }（唯一允许进入无记录态），空串 / JSON null / 非对象（含数组）/ 结构不符 / 摘要非法一律抛错（上层 → ok:false + verdict:null + 明确错误）。'
            },
            {
                file: 'js/update/modelUpdate.js',
                lines: '276-277, 1050-1056',
                desc: 'P2 官方记录摘要完整性校验：asOfficialRecord 原先不校验 sha256，缺少摘要也能通过。扫描侧新增 hasValidSha256（64 位十六进制，比较时统一小写；判据口径与 weightBundle.validateBundle 中 /^[0-9a-f]{64}$/ 一致），摘要缺失 / 类型错误 / 格式错误（长度不足、含非十六进制字符）全部判为不可判定；大写十六进制视为合法。安装事务自身的记录校验逻辑未改动。'
            },
            {
                file: 'tools/test-regressions.mjs',
                lines: 'all',
                desc: '新增两个边界问题的真实生产代码回归（全部经 scanWeightsOnDisk()）：键不存在进入无记录态、JSON null、空字符串、数组、缺失 sha256、旧 digest 字段冒充（视为缺失）、sha256 类型错误、长度不足、非十六进制字符、大写十六进制合法 → official-intact、记录修复后恢复正常五态。回归总数 94 项。运行：node tools/test-regressions.mjs'
            }
        ]
    }
];

/* ===== 2026-09-30 第二轮·同类 bug 扫描修复 =====
 * 病根：技能 act 从不带目标；且收益方向守卫顺序错位，技能方向判定恒空转。
 * ① engine.applyBasicSkillRules：decideSkill 的 targetIndex 解析成真实目标写回 a.target/a.targetObj/a.purpose，
 *    并按技能类别映射 purpose（attack/control→敌向，defense/aux→友向）供收益守卫强判方向。
 * ② engine 救援/留牌判定改用敌我系统 isAllyOf 替代 isSameCamp（×3：桃博弈3096、酒救援3203、留牌3648），
 *    身份未明真队友不再被"保守视敌"漏救。
 * ③ 收益方向守卫(actionValue)整体移至所有 applyBasicXxxRules 之后执行，使技能目标也能过方向强判。
 * ④ skillPlayBrain.vetoSkill 控制技"可控制敌"由 !isAlly 改为仅 isEnemy，中性(身份未明)不盲控。
 */

/* 若需在游戏内 console 查看，可调用:
 *   import { SESSION_CHANGELOG } from './sessionChangelog.js?v=41a';
 *   console.table(SESSION_CHANGELOG.map(x => ({ phase: x.phase, count: x.changes.length })));
 */
if (typeof window !== 'undefined') {
    try {
        window.__SESSION_CHANGELOG__ = SESSION_CHANGELOG;
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
