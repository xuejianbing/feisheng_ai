/*
 * 无名AI · 配置单一真相源
 *
 * 这里统一定义：
 *   - 配置默认值 / 类型 / 可选项
 *   - 玩家 / 开发者设置页归属
 *   - 设置文案与说明
 *   - 隐藏项、危险操作与动作按钮文案
 *
 * config.js 只保留功能回调和原生配置对象外壳；
 * configLayout.js 只负责渲染；
 * score/foundation/config/configSpec.js 从本文件派生兼容接口。
 */

export const CONFIG_SCHEMA_VERSION = 1;

const subsection = (title, description) => ({ kind: 'subsection', title, description });
const protectedStatus = (title, description) => ({ kind: 'status', title, description, locked: true });

export const CONFIG_SECTIONS = [
	{scope:'player',id:'player_basic',title:'01 · 游戏体验',accent:'gold',defaultOpen:true,
	 entries:['decisionScore','aiStrength','adaptiveDifficulty','openConfigPanel']},
	{scope:'player',id:'player_report',title:'02 · 对局记录',accent:'blue',
	 entries:['narrator','showReport','archiveGames','logRetain','recordStatus','openArchivePanel','clearArchive','clearGameLogs',subsection('帮助改进 AI','自愿提供反馈数据；本地记录与学习数据保留。'),'cloudShowButton','cloudAutoUpload','cloudUploadNow','cloudUploadStatus','exportGameFeedback']},
	{scope:'player',id:'player_modes',title:'03 · 模式增强',accent:'blue',
	 entries:[{kind:'subsection',title:'斗地主',fold:'doudizhu'},'hideFarmerTeammateHand','classicDoudizhu','classicModelEnabled','classicEffectReport','openModeLearningProgress',{kind:'endSubsection'},{kind:'subsection',title:'2v2',fold:'versus2v2'},'versusStrategy','versusSeatProtection','versusReserve','openVersusStatus']} ,
	{scope:'player',id:'player_data',title:'04 · 帮助与反馈',accent:'gold',
	 entries:['openPlayerHelp','openUpdateLog']},
	{
		scope: 'developer', id: 'dev_diag', title: 'D1 · 诊断与观测', accent: 'blue',
		entries: ['openBrainDashboard', 'openHealthPanel', 'openSelfCheck', 'openFullMonitor', 'openDecisionDashboard', 'openPanel', 'openReplayPanel', 'profiler', 'openProfilerPanel', 'showLog', 'testDecisionLog'],
	},
	{
		scope: 'developer', id: 'dev_model', title: 'D2 · 模型与学习', accent: 'blue',
		entries: ['useTrainedModel', 'identitySampling', 'showSampleCount', 'showModelStatus', 'autoFixModel', 'openChampionPanel', 'championBoost', 'openSharedPanel', 'decisionFeedback', 'skillFeedback', 'styleFeedback', 'crossGameMemory', 'playerMemory', 'openMemoryPanel'],
	},
	{
		scope: 'developer', id: 'dev_guard', title: 'D3 · 护栏与安全', accent: 'blue',
		entries: [
			protectedStatus('最终合法性校验', '安全边界；不作为普通玩家可关闭功能。'),
			protectedStatus('异常降级保护', '接管层异常时保留回退路径。'),
			'openGuardPanel',
		],
	},
	{
		scope: 'developer', id: 'dev_data', title: 'D4 · 数据与训练管理', accent: 'blue',
		entries: ['exportAllData', 'importTrainingData', 'showTrainStats', 'clearTrainingBuffer', 'clearSamples', 'classicDoudizhuCollect', 'playerDemonstrations', 'modeTrainingCenter'],
	},
	{scope:'developer',id:'dev_strategy',title:'D5 · 策略与接管',accent:'blue',
	 entries:[{kind:'subsection',title:'通用策略优化',fold:'generalStrategy',defaultOpen:false},'hardOverride','broadcastAI','responseAI','comboChain','compareAI','deckAwareness','deckConsumeAllPlayers','enablePlanner','psychologyLayer','openPsychologyMonitor',{kind:'endSubsection'},{kind:'subsection',title:'卡牌打法优化',fold:'tactical',defaultOpen:false},'tacticalOptimization','tacticalFire','tacticalTiesuo','tacticalWuxie','tacticalGuding','tacticalWine','tacticalStrip','tacticalJudgeRescue','tacticalDelay','tacticalCrossbow','tacticalDiagnostics',{kind:'endSubsection'},{kind:'subsection',title:'接管细项',fold:'override',defaultOpen:false},'override_use','override_respond','override_discard','override_compare','openOverridePanel']},
];

export const CONFIG_ITEMS = {
 identitySampling:{compact:true,type:'bool',default:false,label:'身份场样本采集',description:'身份场暂不推理，但采集对局样本用于训练（含阵营胜负字段）。下一局生效。'},
 versusStrategy:{compact:true,type:'bool',default:true,label:'2v2策略增强'},
 versusSeatProtection:{compact:true,type:'bool',default:true,label:'座次配合与队友保护'},
 versusReserve:{compact:true,type:'bool',default:true,label:'关键牌保留'},
 openVersusStatus:{compact:true,type:'action',label:'专项状态',actionLabel:'查看'},
 tacticalOptimization:{compact:true,type:'bool',default:true,label:'启用打法优化覆盖',description:'实验功能，下一局生效；关闭后保持原判断。'},
 tacticalFire:{compact:true,type:'bool',default:true,label:'火攻与铁索联动优化',description:'统一火攻、自伤传导和无懈的收益方向；弃牌同时检查成本。下一局生效。'},
 tacticalTiesuo:{compact:true,type:'bool',default:true,label:'铁索使用与重铸优化',description:'适时提前重铸，摸牌后重新安排出牌；保留斩杀与已开始的酒杀。下一局生效。'},
 tacticalWuxie:{compact:true,type:'bool',default:true,label:'无懈可击使用优化',description:'结合当前目标、救命收益、响应手牌和转化成本判断无懈与反无懈。下一局生效。'},
 tacticalGuding:{compact:true,type:'bool',default:true,label:'古锭刀出牌顺序优化',description:'存在可攻击的空手敌人时优先装备空武器栏中的古锭刀；已装备时按收益考虑酒。下一局生效。'},
 tacticalWine:{compact:true,type:'bool',default:true,label:'酒杀时机优化',description:'空手目标可由酒杀提高斩杀收益时优先酒；下一局生效。'},
 tacticalStrip:{compact:true,type:'bool',default:true,label:'拆顺后出杀优化',description:'优先拆顺可打开出杀距离的+1；已经够到时优先+1，再考虑防具和单张手牌。下一局生效。'},
 tacticalJudgeRescue:{compact:true,type:'bool',default:true,label:'队友判定区救援优化',description:'优先拆顺队友的乐不思蜀、兵粮寸断；结合行动顺序与公开手牌数量判断紧迫程度。下一局生效。'},
 tacticalDelay:{compact:true,type:'bool',default:true,label:'贴兵贴乐优化',description:'统一兵乐目标与顺序，结合公开技能、手牌数量、行动顺序评估控制收益；下一局生效。'},
 tacticalCrossbow:{compact:true,type:'bool',default:true,label:'诸葛连弩连杀优化',description:'空武器栏且有多张有效杀时优先连弩；下一局生效。'},
 tacticalDiagnostics:{compact:true,type:'bool',default:false,label:'输出打法优化诊断',description:'记录 AI 调整出牌、无懈和选牌的原因，遇到异常时可打开，方便排查。下一局生效。'},
	openPlayerHelp:{type:'action',label:'使用说明',description:'查看开关、难度、记录与学习的简明说明。',actionLabel:'查看'},
	exportFeedbackData:{type:'action',label:'导出反馈数据',description:'导出对局、学习数据与设置备份，便于反馈问题。',actionLabel:'导出'},
	openUpdateLog:{type:'action',label:'更新日志',description:'查看各版本的修改记录。',actionLabel:'查看'},
	openModeLearningProgress:{type:'action',label:'查看学习进度',description:'查看记录局数、学习状态和已启用版本。',actionLabel:'查看'},

	decisionScore: {
		type: 'bool', default: true, label: '无名AI总开关',
		description: '无名AI核心决策引擎总开关。',
	},
	aiStrength: {
		type: 'enum', default: '中', label: 'AI强度',
		description: '控制冠军策略对最终决策的影响力；不等同于“模型正确率”。',
		options: {
			'极弱': '极弱（影响力×0·纯规则）',
			'弱': '弱（影响力×0.3·明显放水）',
			'中': '中（影响力×1.0·默认平衡）',
			'强': '强（影响力×1.6·全力）',
			'极强': '极强（影响力×2.0·非“接近完美”）',
		},
	},
	adaptiveDifficulty: {
		type: 'bool', default: false, label: '自适应难度',
		description: '根据近期表现调整AI强度；关闭后保持固定档位。',
	},
	openConfigPanel: { type: 'action', label: '当前配置', description: '查看当前生效的主要配置与运行状态。', actionLabel: '查看' },

	autoIdentityMatch: {
		type: 'bool', default: false, label: '身份自动匹配',
		description: '根据身份模式自动匹配策略档案。',
	},
	broadcastAI: {
		type: 'bool', default: true, label: 'AI协作',
		description: '同阵营AI共享攻击意图与集火方向。',
	},

	responseAI: {
		type: 'bool', default: true, label: '响应与资源策略',
		description: '优化闪、桃、无懈等响应与关键资源保留。',
	},
	comboChain: {
		type: 'bool', default: true, label: '连招与铁索联动',
		description: '识别酒杀、铁索属性伤害、拆防连杀等组合；铁索专项归属锦囊牌。',
	},
	compareAI: {
		type: 'bool', default: true, label: '拼点与选牌优化',
		description: '拼点与选牌优化，降低高点数关键牌被无意义消耗。',
	},
	deckAwareness: {
		type: 'bool', default: true, label: '牌堆感知',
		description: '根据公开信息统计已出现牌，修正牌堆相关概率。',
	},
	deckConsumeAllPlayers: {
		type: 'bool', default: true, label: '公开牌消耗统计',
		description: '把所有玩家公开可见的牌消耗纳入牌堆统计，不读取隐藏手牌内容。',
	},

	enablePlanner: {
		type: 'bool', default: true, label: '多步战术规划',
		description: '多步战术规划与残局推演。',
	},
	psychologyLayer: {
		type: 'bool', default: true, label: '博弈策略层',
		description: '威慑、意图识别、压迫力与策略保留。',
	},
	openPlanPanel: { type: 'action', label: '战术规划面板', description: '查看最近一次真实决策产生的战术计划，不额外重复计算Planner。', actionLabel: '查看' },

	hardOverride: {
		type: 'bool', default: true, label: '无名AI接管层',
		description: '无名AI接管层总开关；异常时仍保留安全降级。',
	},
	override_use: { type: 'bool', default: true, label: '出牌接管', description: '接管出牌阶段相关决策。' },
	override_respond: { type: 'bool', default: true, label: '响应接管', description: '接管响应阶段相关决策。' },
	override_discard: { type: 'bool', default: true, label: '弃牌接管', description: '接管弃牌阶段相关决策。' },
	override_compare: { type: 'bool', default: true, label: '拼点接管', description: '接管拼点阶段相关决策。' },
	openOverridePanel: { type: 'action', label: '接管层状态', description: '查看接管层、熔断与降级状态。', actionLabel: '查看' },

	useTrainedModel: {
		type: 'bool', default: true, label: '启用训练模型',
		description: '允许已就绪模型参与当前支持的复核与学习链路。',
	},
	decisionFeedback: {
		type: 'bool', default: true, label: '决策反馈学习',
		description: '记录目标、阶段、留牌等决策反馈。',
	},
	skillFeedback: {
		type: 'bool', default: true, label: '技能反馈学习',
		description: '根据对局结果修正技能评价。',
	},
	styleFeedback: {
		type: 'bool', default: true, label: '玩家风格学习',
		description: '根据结果修正对手风格标签可信度。',
	},
	crossGameMemory: {
		type: 'bool', default: true, label: '跨局记忆',
		description: '跨局保留可复用的策略记忆。',
	},
	playerMemory: {
		type: 'bool', default: true, label: '玩家长期记忆',
		description: '保留玩家长期行为画像与相关统计。',
	},
	championBoost: {
		type: 'enum', default: '0', label: '冠军策略',
		description: '控制已训练冠军策略对匹配决策点的提权强度。',
		options: {
			'0': '0（关闭冠军策略提权）',
			'3': '3（轻微：冠军动作略优先）',
			'6': '6（明显：冠军动作明显优先）',
			'10': '10（强：倾向固化的最高分决策）',
		},
	},
	openMemoryPanel: { type: 'action', label: '跨局记忆面板', description: '查看跨局记忆与长期画像。', actionLabel: '查看' },

	showReport: { type: 'bool', default: true, label: '结算战报', description: '对局结束后展示图文战报。' },
	archiveGames: { type: 'bool', default: true, label: '战报归档', description: '保存历史战报供后续回看。' },
	narrator: { type: 'bool', default: true, label: '决策解释', description: '把决策信号转换为可读解释。' },
	showLog: { type: 'bool', default: false, label: '积分明细日志', description: '显示积分明细调试日志。' },
	testDecisionLog: {
		type: 'enum', default: '摘要', label: '测试决策日志',
		description: '用于调试与复盘，按行显示推荐动作、候选评分与分差、策略、原因和耗时，角色回合结束显示观测汇总；评分不是胜率。详细模式补充收益、规划和性能信号。关闭仅停止决策分析输出，参考分歧等诊断提示仍可能出现。',
		options: {
			'关闭': '关闭（只保留内部决策回放）',
			'摘要': '摘要（推荐、备选、原因与耗时）',
			'详细': '详细（前3候选+关键策略信号）',
		},
	},
	persist: { type: 'bool', default: false, label: '保存结算历史', description: '保存结算历史到本地存储。' },
	openPanel: { type: 'action', label: '决策积分主面板', description: '打开决策积分主面板。', actionLabel: '查看' },
	openArchivePanel: { type: 'action', label: '战报归档', description: '查看已归档战报。', actionLabel: '查看' },
	clearArchive: { type: 'action', label: '清空战报归档', description: '清空已保存的历史战报归档；删除前二次确认，建议先用「导出反馈数据」备份。', actionLabel: '清空', dangerous: true },
	openFeedbackPanel: { type: 'action', label: '决策回放', description: '回看最近决策与反馈信息。', actionLabel: '查看' },
	openReplayPanel: { type: 'action', label: '决策回放时间轴', description: '查看决策回放时间轴。', actionLabel: '查看' },
	openSmartPanel: { type: 'action', label: '智能可视化', description: '打开智能可视化面板。', actionLabel: '查看' },

	hideFarmerTeammateHand: { compact: true, type: 'bool', default: false, label: '隐藏农民队友手牌', description: '自己是农民时，关闭队友手牌互见；保留手牌张数与正常亮牌。' },
	classicDoudizhu: { type: 'bool', default: true, label: '常规斗地主专项规则', description: '自动识别休闲、开黑、欢乐，沿用公共 AI 并加入专项偏好；修改于下一局生效。' },
	classicDoudizhuCollect: { type: 'bool', default: true, label: '采集常规斗地主专项数据', description: '记录实际执行且收益已确认的专项样本；修改于下一局生效。' },
	playerDemonstrations: {type:'bool',default:true,label:'采集玩家手动出牌示范',description:'在本机常规斗地主出牌阶段记录手动用牌、重铸与顺序；实际收益校验合格的动作进入专项训练，托管及触发动作不算玩家示范。下一局生效。'},
	classicModelEnabled: {type:'bool',default:false,label:'专项模型参与实际选择',description:'启用已保存的专项试用版本，收益预测参与动作比较；无版本或规则不匹配时沿用公共引擎，下一局生效。'},
	classicEffectReport: {type:'bool',default:true,label:'结算显示AI效果',description:'在斗地主结算战报显示玩家简报和开发者诊断；区分模型建议、实际执行、即时收益与局间更新。'},
	modeTrainingCenter: { type: 'action', label: '斗地主专项训练中心', description: '查看地主／农民的数据统计，训练、验证候选模型及导出专项数据。候选验证后可启用试用，下一局参与真实选择。', actionLabel: '打开' },
	exportAllData: { type: 'action', label: '完整数据备份', description: '将主要面板、训练、日志、知识与权重数据合并导出。', actionLabel: '导出' },
	importTrainingData: { type: 'action', label: '导入AI学习数据', description: '导入兼容的训练数据。', actionLabel: '导入' },

	openBrainDashboard: { type: 'action', label: 'AI大脑总览', description: '总览主要AI模块与运行状态。', actionLabel: '查看' },
	openHealthPanel: { type: 'action', label: '引擎健康度', description: '查看引擎健康度。', actionLabel: '查看' },
	openSelfCheck: { type: 'action', label: '模块自检', description: '执行模块自检。', actionLabel: '检测' },
	openFullMonitor: { type: 'action', label: '全功能状态检测', description: '汇总显示主要监控数据。', actionLabel: '检测' },

	openDecisionDashboard: { type: 'action', label: '决策链观测', description: '观察当前决策链关键状态。', actionLabel: '查看' },
	openComparePanel: { type: 'action', label: '决策对比', description: '对比不同策略档案在同一局面的选择。', actionLabel: '查看' },
	openSkillBreakdownPanel: { type: 'action', label: '技能拆解', description: '查看技能拆解与识别结果。', actionLabel: '查看' },

	openPsychologyMonitor: { type: 'action', label: '博弈策略状态', description: '查看博弈策略实时统计。', actionLabel: '查看' },

	profiler: { type: 'bool', default: true, label: '性能分析器', description: '记录决策各阶段耗时，用于定位卡顿。' },
	openProfilerPanel: { type: 'action', label: '性能分析面板', description: '查看性能分析结果。', actionLabel: '查看' },
	openProfilerMonitor: { type: 'action', label: '实时性能指标', description: '查看实时性能指标。', actionLabel: '查看' },
	openComboMonitor: { type: 'action', label: '连招链状态', description: '查看当前识别到的连招组合。', actionLabel: '查看' },

	useResidual: { type: 'bool', default: false, label: '残差学习', description: '模型高级结构选项；普通玩家无需调整。' },
	learningRate: {
		type: 'enum', default: '0.005', label: '学习率',
		description: '模型训练学习率；仅建议测试/训练时调整。',
		options: {
			'0.00005': '0.00005（近冻结，几乎不学）',
			'0.0001': '0.0001（极慢极限）',
			'0.0002': '0.0002（极慢超微）',
			'0.0003': '0.0003（极慢微稳）',
			'0.0004': '0.0004（极慢很稳）',
			'0.0005': '0.0005（极慢稳）',
			'0.0006': '0.0006（很慢稳）',
			'0.0007': '0.0007（很慢偏稳）',
			'0.0008': '0.0008（很慢）',
			'0.0009': '0.0009（慢超稳）',
			'0.001': '0.001（极慢超稳）',
			'0.002': '0.002（很慢很稳）',
			'0.003': '0.003（慢但稳）',
			'0.004': '0.004（偏慢稳定）',
			'0.005': '0.005（平衡推荐）',
			'0.006': '0.006（偏快）',
			'0.007': '0.007（较快）',
			'0.008': '0.008（很快）',
			'0.009': '0.009（非常快）',
			'0.010': '0.010（极快最快）',
		},
	},
	forceTrain: { type: 'action', label: '手动触发训练', description: '使用当前样本手动触发一次训练。', actionLabel: '训练' },
	showSampleCount: { type: 'action', label: '训练样本数量', description: '查看当前训练样本数量。', actionLabel: '查看' },
	showModelStatus: { type: 'action', label: '模型状态', description: '查看模型阶段、准确率与就绪状态。', actionLabel: '查看' },
	autoFixModel: { type: 'action', label: '模型自启动修复', description: '检查模型关键结构并尝试修复异常启动状态。', actionLabel: '修复' },
	openChampionPanel: { type: 'action', label: '冠军策略总览', description: '查看冠军策略嵌入。', actionLabel: '查看' },
	openCalibratorPanel: { type: 'action', label: '决策校准趋势', description: '查看决策校准趋势。', actionLabel: '查看' },
	openHotSwapPanel: { type: 'action', label: '模型热更新', description: '查看候选模型与A/B状态。', actionLabel: '查看' },
	openEvolutionPanel: { type: 'action', label: '策略进化', description: '查看策略进化状态。', actionLabel: '查看' },
	openSharedPanel: { type: 'action', label: '公共知识库', description: '查看公共知识库。', actionLabel: '查看' },

	openGuardPanel: { type: 'action', label: '模型护栏', description: '查看模型护栏与拦截统计。', actionLabel: '查看' },
	openPostCheckPanel: { type: 'action', label: '决策后检测', description: '查看决策后检查结果。', actionLabel: '查看' },
	openPostCheckMonitor: { type: 'action', label: '后置检查实时状态', description: '查看后置检查实时状态。', actionLabel: '查看' },
	openSoftMetricsMonitor: { type: 'action', label: '软指标学习状态', description: '查看软指标参数与统计。', actionLabel: '查看' },

	showTrainStats: { type: 'action', label: '训练统计', description: '查看训练缓冲区统计。', actionLabel: '查看' },
	clearTrainingBuffer: { type: 'action', label: '清空训练缓冲区', description: '清空训练缓冲区；属于维护操作。', actionLabel: '清空', dangerous: true },
	clearSamples: { type: 'action', label: '清空训练样本', description: '清空训练样本；不可恢复。', actionLabel: '清空', dangerous: true },
	importOverwrite: { type: 'action', label: '覆盖导入完整数据', description: '用备份数据覆盖当前本地数据。', actionLabel: '导入', dangerous: true },
	importMerge: { type: 'action', label: '合并导入完整数据', description: '将兼容数据合并到当前本地数据。', actionLabel: '导入' },
	openExportPanel: { type: 'action', label: '数据导出中心', description: '打开完整导出面板。', actionLabel: '查看' },
	quickExportAll: { type: 'action', label: '一键全量导出', description: '快速导出全部支持的数据。', actionLabel: '导出' },
	clearGameLogs: { type: 'action', label: '清空对局日志库', description: '清空扩展保存的对局日志。', actionLabel: '清空', dangerous: true },

	openMemoryMonitor: { type: 'action', label: '对手记忆状态', description: '查看记忆系统实时状态。', actionLabel: '查看' },
	openAutoFeatureMonitor: { type: 'action', label: '自动特征发现状态', description: '查看自动特征统计。', actionLabel: '查看' },
	openTrainBufferMonitor: { type: 'action', label: '训练缓冲状态', description: '查看训练缓冲队列。', actionLabel: '查看' },

	/* 已有功能但当前设置中心默认隐藏：仍登记，避免形成“第二份未知配置”。 */
	openScorePanel: { type: 'action', label: '本局积分面板', description: '打开本局积分面板。', hidden: true },
	openNarratorPanel: { type: 'action', label: '决策解释器面板', description: '打开决策解释器面板。', hidden: true },
	openSkillPanel: { type: 'action', label: '技能矩阵面板', description: '查看技能评分和学习修正数据。', hidden: true },
	openRecommendPanel: { type: 'action', label: '选将推荐面板', description: '查看选将推荐结果。', hidden: true },
	openFeedbackGroup: { type: 'action', label: '问题反馈联系群', description: '旧反馈群入口；设置首页已提供统一QQ群与问卷入口。', hidden: true },
	recordStatus: { type: 'action', label: '记录状态', description: '查看当前日志局数、容量和保存状态。', actionLabel: '刷新' },
	cloudShowButton: { type:'bool', default:true, label:'显示云端上传按钮', description:'显示右侧云朵，点击可手动上传；隐藏按钮不改变自动上传设置。' },
	cloudAutoUpload: { type:'bool', default:true, label:'允许自动上传反馈数据', description:'自愿提供AI训练样本和相关运行数据，用于改进扩展；成功后本地学习数据保留。关闭后停止定时和局末自动上传，已经发出的请求可能继续完成。' },
	cloudUploadNow: { type:'action', label:'立即上传', description:'主动上传新增样本和变更快照，保留本地数据；结果提示约2秒自动消失。', actionLabel:'上传' },
	cloudUploadStatus: { type:'action', label:'上传状态', description:'查看待上传样本、上次结果及上传地址。', actionLabel:'查看' },
	exportGameFeedback: { type: 'action', label: '导出反馈包', description: '手动导出近期操作和AI决策日志；游戏目录内同名反馈包会覆盖。', actionLabel: '导出' },
	logRetain: {
		type: 'enum', default: '100', label: '对局日志保留局数',
		description: '超过局数或100 MB 容量上限时淘汰最旧记录；满额不自动导出或弹窗。',
		options: { '50': '50 局（省空间）', '100': '100 局（推荐）', '200': '200 局（留得多）' },
	},
	qqGroup: {
		type: 'text', default: '1080487560', label: '反馈与交流QQ群', hidden: true,
		description: '统一反馈与交流QQ群号。',
	},
};

/* ★ 4.1.2.5 面板瘦身：以下配置/面板不再出现在设置面板（功能代码全部保留，cfg(key) 读取不受影响）。
 * 收敛原则：诊断 Monitor 类合并入口、重复导出导入入口、已停用链路面板（热更/进化/校准）、
 * 古早实验项（残差/学习率——端上训练已停用）、细粒度接管子开关（默认全开无需露出）。 */
const PANEL_HIDDEN_KEYS = [
	'openComparePanel', 'openSkillBreakdownPanel', 'openFeedbackPanel', 'openSmartPanel',
	'openProfilerMonitor', 'openComboMonitor', 'openPlanPanel',
	'useResidual', 'learningRate', 'forceTrain', 'openCalibratorPanel', 'openHotSwapPanel', 'openEvolutionPanel',
	'openPostCheckPanel', 'openPostCheckMonitor', 'openSoftMetricsMonitor',
	'persist', 'importOverwrite', 'importMerge', 'openExportPanel', 'quickExportAll',
	'autoIdentityMatch', 'exportFeedbackData',
	'openMemoryMonitor', 'openAutoFeatureMonitor', 'openTrainBufferMonitor',
];
for (const k of PANEL_HIDDEN_KEYS) { if (CONFIG_ITEMS[k]) CONFIG_ITEMS[k].hidden = true; }

const PLAYER_COPY = {
 decisionScore:['无名AI总开关','开启后使用无名AI增强功能。'],
 aiStrength:['AI难度','选择你希望的对局难度。'],
 adaptiveDifficulty:['自动调整难度','根据近期表现调整难度。'],
 openConfigPanel:['查看当前状态','查看主要设置与运行状态。'],
 narrator:['显示对局说明','显示AI动作的简洁说明。'],
 showReport:['显示结算战报','对局结束后查看总结。'],
 archiveGames:['保存对局记录','关闭后停止新增历史战报和对局日志；已有记录可查看、导出或清空。'],
 openArchivePanel:['查看历史对局','查看已保存的战报。'],
 clearArchive:['清空战报归档','清空已保存的历史战报归档（需二次确认）。'],
 classicDoudizhu:['斗地主策略增强','增强常规斗地主的地主与农民策略。'],
 classicModelEnabled:['使用专项模型','已有启用版本时参与出牌选择；下一局生效。'],
};
CONFIG_ITEMS.aiStrength.playerOptions={'极弱':'入门','弱':'轻松','中':'标准（推荐）','强':'挑战','极强':'高难度'};
for(const [key,[playerLabel,playerDescription]] of Object.entries(PLAYER_COPY))Object.assign(CONFIG_ITEMS[key],{playerLabel,playerDescription});

export function configMeta(key) {
	return CONFIG_ITEMS[key] || null;
}

export function configDefault(key, fallback) {
	const meta = configMeta(key);
	return meta && Object.prototype.hasOwnProperty.call(meta, 'default') ? meta.default : fallback;
}

export function hiddenConfigKeys() {
	return Object.keys(CONFIG_ITEMS).filter(key => CONFIG_ITEMS[key] && CONFIG_ITEMS[key].hidden === true);
}

export function visibleConfigKeys() {
	const out = [];
	for (const section of CONFIG_SECTIONS) {
		for (const entry of section.entries || []) {
			if (typeof entry === 'string' && out.indexOf(entry) < 0) out.push(entry);
		}
	}
	return out;
}

export function schemaConfigKeys() {
	return Object.keys(CONFIG_ITEMS);
}

/* schema 是默认值/枚举项的唯一权威源。
 * config.js 中只保留 callback/function；这里在进入设置布局前注入 init/item/intro。 */
export function applyConfigSchema(source) {
	if (!source || typeof source !== 'object') return source;
	for (const key of Object.keys(CONFIG_ITEMS)) {
		const meta = CONFIG_ITEMS[key];
		const target = source[key];
		if (!target || typeof target !== 'object') continue;
		if (Object.prototype.hasOwnProperty.call(meta, 'default')) target.init = meta.default;
		if (meta.options) target.item = { ...meta.options };
		if (meta.description) target.intro = meta.description;
	}
	return source;
}

export function validateSchema() {
	const errors = [];
	const sectionIds = new Set();
	const visible = new Set();

	for (const section of CONFIG_SECTIONS) {
		if (!section || !section.id) {
			errors.push('section 缺少 id');
			continue;
		}
		if (sectionIds.has(section.id)) errors.push('重复 section: ' + section.id);
		sectionIds.add(section.id);
		if (section.scope !== 'player' && section.scope !== 'developer') {
			errors.push('section scope 非法: ' + section.id);
		}
		for (const entry of section.entries || []) {
			if (typeof entry !== 'string') continue;
			if (!CONFIG_ITEMS[entry]) errors.push('布局引用未登记配置: ' + entry);
			if (visible.has(entry)) errors.push('配置重复出现在布局: ' + entry);
			visible.add(entry);
		}
	}

	for (const key of Object.keys(CONFIG_ITEMS)) {
		const meta = CONFIG_ITEMS[key];
		if (!meta || !meta.type) errors.push('配置缺少 type: ' + key);
		if (!meta.label) errors.push('配置缺少 label: ' + key);
		if (meta.type === 'enum') {
			if (!meta.options || !Object.keys(meta.options).length) errors.push('枚举缺少 options: ' + key);
			if (Object.prototype.hasOwnProperty.call(meta, 'default') && !Object.prototype.hasOwnProperty.call(meta.options || {}, String(meta.default))) {
				errors.push('枚举默认值不在 options: ' + key + '=' + meta.default);
			}
		}
		if (meta.type !== 'action' && !Object.prototype.hasOwnProperty.call(meta, 'default')) {
			errors.push('可配置项缺少 default: ' + key);
		}
		if (meta.hidden !== true && !visible.has(key)) errors.push('非隐藏配置未进入布局: ' + key);
	}

	return { ok: errors.length === 0, errors };
}

export function validateConfigSource(source) {
	const errors = [];
	if (!source || typeof source !== 'object') return { ok: false, errors: ['config source 非对象'] };

	const sectionHeading = key => /Bd$/.test(key) || key === 'djscBd';
	const reserved = new Set(['updateLog']);

	for (const key of schemaConfigKeys()) {
		if (!source[key]) errors.push('schema 配置在 config.js 中不存在: ' + key);
	}

	for (const key of Object.keys(source)) {
		if (sectionHeading(key) || reserved.has(key)) continue;
		if (!CONFIG_ITEMS[key]) errors.push('config.js 存在未登记配置: ' + key);
	}

	for (const key of Object.keys(CONFIG_ITEMS)) {
		const meta = CONFIG_ITEMS[key];
		const entry = source[key];
		if (!entry) continue;
		if (Object.prototype.hasOwnProperty.call(meta, 'default') && entry.init !== meta.default) {
			errors.push('默认值未由 schema 生效: ' + key);
		}
		if (meta.options) {
			const a = JSON.stringify(entry.item || {});
			const b = JSON.stringify(meta.options);
			if (a !== b) errors.push('枚举项未由 schema 生效: ' + key);
		}
	}

	return { ok: errors.length === 0, errors };
}
