
/* ===== 水印追踪（隐藏build ID） ===== */
const _fs_build_id = '2w9yg1uo';  // 隐藏的构建ID，用于追踪泄露
// ====================================

// ===== 防伪标识（隐藏） =====
import { VERSION_SEMVER } from './version.js?v=41a';  /* ★ P2-35：内部 semver 也走权威源 */
const _antiPiracy = {
    author: "飞升原创",
    version: VERSION_SEMVER,
    build: Date.now().toString(36),
    checksum: "fs_" + Math.random().toString(36).substring(2, 10)
};
// ========================
/*
 * ============================================
// Auteur: Feisheng Origineel | Licentie: GPL-3.0
 * // Éditeur: Feisheng Original
 * 交流群: 1080487560
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

import { lib, game, ui, get, ai, _status } from '../shared/utils.js?v=41a';
import { openStateCardPanel } from '../../score/view/dashboard/stateCards.js?v=41a';
import { arrangeConfig } from './configLayout.js?v=41a';
import { applyConfigSchema } from './configSchema.js?v=41a';
import { changelog } from './changelog.js?v=41a';
import { VERSION } from './version.js?v=41a';  /* ★ P2-35：版本号唯一权威源，UI 不写死 */
 import { zhong } from './identities/zhong.js?v=41a';
 import { fan } from './identities/fan.js?v=41a';
 import { nei } from './identities/nei.js?v=41a';
import { installFarmerHandVisibility, refreshFarmerHandVisibility } from '../content/farmerHandVisibility.js?v=41a';

/* ★ 4.1.2.7 一次性配置迁移：止血期关闭的训练模型开关随升级恢复默认开启；冠军强度回退旧默认。
   只执行一次（cfgMigratedVer 标记），之后玩家手动改的值不会被覆盖。 */
try {
	if (!lib.config['extension_无名AI_cfgMigratedVer']) {
		lib.config['extension_无名AI_cfgMigratedVer'] = '471';
		delete lib.config['extension_无名AI_useTrainedModel'];
		delete lib.config['extension_决策积分引擎_useTrainedModel'];
		delete lib.config['extension_无名AI_championBoost'];
		delete lib.config['extension_决策积分引擎_championBoost'];
		if (typeof game !== 'undefined' && game && game.saveConfig) game.saveConfig();
	}
} catch (eMig471) {}

/* ★ 4.1.2.7 启动归档自检：无名AI_archive 积累超过 1MB 时自动清理并关闭归档
   （等价玩家控制台命令：清无名AI_archive + archiveGames=false；小于阈值不影响归档功能） */
try {
	var _archLen = ((typeof localStorage !== 'undefined' && localStorage.getItem('无名AI_archive')) || '').length;
	if (_archLen > 1048576) {
		localStorage.removeItem('无名AI_archive');
		lib.config['extension_无名AI_archiveGames'] = false;
		if (typeof game !== 'undefined' && game && game.saveConfig) game.saveConfig();
		if (typeof game !== 'undefined' && game && game.log) game.log('归档数据 ' + (_archLen / 1024).toFixed(1) + 'KB 已自动清理，归档功能已关闭');
	}
} catch (eArchCheck) {}
export let config = {
	hideFarmerTeammateHand: { name: '隐藏农民队友手牌', onclick(value) {
	 game.saveConfig('extension_无名AI_hideFarmerTeammateHand', !!value);
	 installFarmerHandVisibility();
	 refreshFarmerHandVisibility();
	} },
	openPlayerHelp:{name:'使用说明',onclick:function(){
	 openStateCardPanel('无名AI · 使用说明',[],
	 '<h3>开始使用</h3><p>保持无名AI总开关开启，选择适合自己的难度，即可正常开始游戏。策略模块和接管细项在开发者选项中，通常无需逐项调整。</p>'+
	 '<h3>查看记录</h3><p>开启结算战报和保存对局记录后，可在“查看历史对局”回看。对局说明可以随时关闭。</p>'+
	 '<h3>斗地主学习</h3><p>策略增强沿用公共AI并加入斗地主偏好。专项模型需要已有启用版本才能参与选择；开启开关不会自动启用尚未验证的候选。</p>'+
	 '<p>自动学习只在结算后尝试训练，检查通过才更新。数据积累和检查通过不代表每局都会更强。训练、验证和回滚在开发者选项的“斗地主训练管理”。</p>'+
	 '<h3>反馈问题</h3><p>记录出错回合和现象，导出反馈数据后与说明一起反馈。导出文件包含对局、学习数据和设置备份。QQ群与问卷入口保留在设置首页。</p>');return false;
	}},
	exportFeedbackData:{name:'导出反馈数据',onclick:function(){return config.exportAllData.onclick.call(this);}},
	openUpdateLog:{name:'更新日志',onclick:function(){openStateCardPanel('无名AI · 更新日志',[],changelog);return false;}},
	openModeLearningProgress:{name:'查看学习进度',onclick:function(){import('../../score/view/dashboard/modeTrainingPanel.js?v=41a').then(m=>m.openModeLearningProgress()).catch(e=>alert('学习进度加载失败：'+e.message));return false;}},

	/* ===== 主标题 ===== */
	djscBd: { clear: true, name: '<hr aria-hidden="true"><div style="color: #00FFB0; text-align:center; font-size: 16px; padding: 10px;">📊 决策积分引擎 v' + VERSION + '</div>' },

	/* ===== 🎛️ 功能面板按钮（大按钮） ===== */
	panelBd: { clear: true, name: '<hr aria-hidden="true"><div class="djsc-config-section-title">功能面板（点击打开）</div>' },

	openPanel: {
		name: '<button class="djsc-menu-config-btn">📊 打开 · 决策积分主面板</button>',
		onclick: function () {
			try {
				import('../../score/view/panel/panel.js?v=41a').then(function (m) {
					m.openScorePanel();
				}).catch(function (e) { alert('主面板加载失败：' + e.message); });
			} catch (e) {
				alert('打开失败：' + e.message);
			}
			return false;
		}
	},

	openScorePanel: {
		name: '<button class="djsc-menu-config-btn">📈 打开 · 本局积分面板</button>',
		onclick: function () {
			try {
				import('../../score/view/panel/panel.js?v=41a').then(function (m) {
					if (m.openScorePanel) m.openScorePanel();
					else alert('openScorePanel 未就绪');
				}).catch(function (e) { alert('打开失败：' + e.message); });
			} catch (e) {
				alert('打开失败：' + e.message);
			}
			return false;
		}
	},

	openPlanPanel: {
		name: '<button class="djsc-menu-config-btn">🎯 打开 · 战术规划面板</button>',
		onclick: function () {
			try {
				import('../../score/view/panel/panel.js?v=41a').then(function (m) {
					if (m.openPlanPanel) m.openPlanPanel();
					else alert('openPlanPanel 未就绪');
				}).catch(function (e) { alert('打开失败：' + e.message); });
			} catch (e) {
				alert('打开失败：' + e.message);
			}
			return false;
		}
	},

	openFeedbackPanel: {
		name: '<button class="djsc-menu-config-btn">📝 打开 · 决策回放面板</button>',
		onclick: function () {
			try {
				import('../../score/view/panel/panel.js?v=41a').then(function (m) {
					if (m.openFeedbackPanel) m.openFeedbackPanel();
					else alert('openFeedbackPanel 未就绪');
				}).catch(function (e) { alert('打开失败：' + e.message); });
			} catch (e) {
				alert('打开失败：' + e.message);
			}
			return false;
		}
	},

	openArchivePanel: {
		name: '<button class="djsc-menu-config-btn">📁 打开 · 战报归档面板</button>',
		onclick: function () {
			try {
				import('../../score/view/panel/panel.js?v=41a').then(function (m) {
					if (m.openArchivePanel) m.openArchivePanel();
					else alert('openArchivePanel 未就绪');
				}).catch(function (e) { alert('打开失败：' + e.message); });
			} catch (e) {
				alert('打开失败：' + e.message);
			}
			return false;
		}
	},

	openRecommendPanel: {
		name: '<button class="djsc-menu-config-btn">🎮 打开 · 选将推荐面板</button>',
		onclick: function () {
			try {
				import('../../score/view/panel/panel.js?v=41a').then(function (m) {
					if (m.openRecommendPanel) m.openRecommendPanel();
					else alert('openRecommendPanel 未就绪');
				}).catch(function (e) { alert('打开失败：' + e.message); });
			} catch (e) {
				alert('打开失败：' + e.message);
			}
			return false;
		}
	},

	openSmartPanel: {
		name: '<button class="djsc-menu-config-btn">🧠 打开 · 智能可视化面板</button>',
		onclick: function () {
			try {
				import('../../score/view/panel/smartPanel.js?v=41a').then(function (m) {
					if (m.openSmartPanel) m.openSmartPanel();
					else alert('openSmartPanel 未就绪');
				}).catch(function (e) { alert('打开失败：' + e.message); });
			} catch (e) {
				alert('打开失败：' + e.message);
			}
			return false;
		}
	},

	openSkillPanel: {
		name: '<button class="djsc-menu-config-btn">📚 打开 · 技能矩阵面板</button>',
		intro: '查看技能评分和学习修正数据',
		onclick: function () {
			if (_status.djscSkillPanel) return false;
			_status.djscSkillPanel = true;
			try {
				if (window.__DJSC && window.__DJSC.openSkillPanel) {
					window.__DJSC.openSkillPanel();
				} else {
					alert('技能矩阵面板开发中...');
				}
			} catch (e) {
				alert('打开失败：' + e.message);
			}
			return false;
		}
	},

	openSkillBreakdownPanel: {
		name: '<button class="djsc-menu-config-btn">🧩 打开 · 技能拆解面板</button>',
		intro: '代码级识别技能几何效果：分支/多段/联动',
		onclick: function () {
			try {
				import('../../score/view/panel/panel.js?v=41a').then(function (m) {
					if (m.openSkillBreakdownPanel) m.openSkillBreakdownPanel();
					else alert('技能拆解面板未就绪');
				}).catch(function (e) { alert('打开失败：' + e.message); });
			} catch (e) {
				alert('打开失败：' + e.message);
			}
			return false;
		}
	},

	openOverridePanel: {
		name: '<button class="djsc-menu-config-btn">🔧 打开 · 接管层状态面板</button>',
		intro: '查看硬接管/软接管双轨架构运行状态',
		onclick: function () {
			try {
				import('../../score/view/panel/panel.js?v=41a').then(function (m) {
					if (m.openOverridePanel) m.openOverridePanel();
					else alert('openOverridePanel 未就绪');
				}).catch(function (e) { alert('打开失败：' + e.message); });
			} catch (e) {
				alert('打开失败：' + e.message);
			}
			return false;
		}
	},

	openMemoryPanel: {
		name: '<button class="djsc-menu-config-btn">🧠 打开 · 跨局记忆面板</button>',
		onclick: function () {
			if (_status.djscMemoryPanel) return false;
			_status.djscMemoryPanel = true;
			try {
				if (window.__DJSC && window.__DJSC.openMemoryPanel) {
					window.__DJSC.openMemoryPanel();
				} else {
					alert('跨局记忆面板开发中...');
				}
			} catch (e) {
				alert('打开失败：' + e.message);
			}
			return false;
		}
	},

	openHealthPanel: {
		name: '<button class="djsc-menu-config-btn">🩺 打开 · 引擎健康度面板</button>',
		onclick: function () {
			try {
				import('../../score/view/panel/panel.js?v=41a').then(function (m) {
					if (m.openHealthPanel) m.openHealthPanel();
					else alert('openHealthPanel 未就绪');
				}).catch(function (e) { alert('打开失败：' + e.message); });
			} catch (e) {
				alert('打开失败：' + e.message);
			}
			return false;
		}
	},

	openConfigPanel: {
		name: '<button class="djsc-menu-config-btn">⚙️ 打开 · 当前配置面板</button>',
		onclick: function () {
			if (_status.djscConfigPanel) return false;
			_status.djscConfigPanel = true;
			try {
				if (window.__DJSC && window.__DJSC.openConfigPanel) {
					window.__DJSC.openConfigPanel();
				} else {
					alert('配置面板开发中...');
				}
			} catch (e) {
				alert('打开失败：' + e.message);
			}
			return false;
		}
	},

	/* ===== 💬 问题反馈 ===== */
	feedbackBd: { clear: true, name: '<hr aria-hidden="true"><div style="color: #ff9c9c; text-align:center; padding: 8px;">▸ 问题反馈</div>' },

	openFeedbackGroup: {
		name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #ff6b9d, #c44569);">💬 问题反馈联系群</button>',
		intro: '扫描二维码加入QQ群，反馈问题或交流建议',
		onclick: function () {
			try {
				if (window.__DJSC && window.__DJSC.showFeedbackGroup) {
					window.__DJSC.showFeedbackGroup();
				} else {
					alert('问题反馈联系群功能开发中...');
				}
			} catch (e) {
				alert('打开失败：' + e.message);
			}
			return false;
		}
	},

	/* ===== 📦 数据管理 ===== */
	dataBd: { clear: true, name: '<hr aria-hidden="true"><div style="color: #ffd479; text-align:center; padding: 8px;">▸ 数据管理（导出/导入面板数据）</div>' },

	exportAllData: {
		name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #1e90ff, #00bfff);">📦 一键合并导出全部数据（单文件）</button>',
		intro: '面板数据 + 训练样本 + 对局日志 + 公共知识库 + 策略进化 + 决策后检测 + 权重 + 全量备份，合并成 1 个 JSON 文件',
		onclick: function () {
			try {
				const finish = function (result) {
					if (result && result.ok) {
						alert(
							'✅ 合并导出成功！\n\n' +
							'💾 大小：' + result.size + '\n' +
							'📦 已合并 ' + result.moduleCount + ' 类数据：\n' +
							'   ' + result.modules.join(' / ') + '\n' +
							'\n' +
							'📄 生成 1 个文件：' + result.file
						);
					} else {
						alert('导出失败：' + (result && result.err ? result.err : '未知错误'));
					}
				};
				if (window.__DJSC && window.__DJSC.mergeExportAndDownload) {
					window.__DJSC.mergeExportAndDownload().then(finish).catch(function (e) { alert('导出失败：' + e.message); });
				} else {
					/* 合并导出模块未加载 → 动态加载后执行 */
					import('../../score/foundation/io/mergeExport.js?v=41a').then(function (m) {
						m.mergeExportAndDownload().then(finish).catch(function (e) { alert('导出失败：' + e.message); });
					}).catch(function (e) {
						alert('合并导出模块加载失败：' + e.message);
					});
				}
			} catch (e) {
				alert('导出失败：' + e.message);
			}
			return false;
		}
	},

	importOverwrite: {
		name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #ff6b6b, #ee5a5a);">📤 导入数据（还原合并导出文件）</button>',
		intro: '识别「📦 合并导出」文件 → 直接还原全部 localStorage；旧版单类数据 JSON 则覆盖导入',
		onclick: function () {
			try {
				if (window.__DJSC && window.__DJSC.importAllFromFile) {
					window.__DJSC.importAllFromFile('overwrite');
				} else {
					alert('导入功能未就绪');
				}
			} catch (e) {
				alert('导入失败：' + e.message);
			}
			return false;
		}
	},

	importMerge: {
		name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #ffa500, #ff8c00);">📤 导入数据（不覆盖，只追加）</button>',
		intro: '只导入新数据，不覆盖现有的数据（合并导出文件会直接还原备份）',
		onclick: function () {
			try {
				if (window.__DJSC && window.__DJSC.importAllFromFile) {
					window.__DJSC.importAllFromFile('merge');
				} else {
					alert('导入功能未就绪');
				}
			} catch (e) {
				alert('导入失败：' + e.message);
			}
			return false;
		}
	},

	/* ===== ⚙️ 引擎开关与参数 ===== */
	engineBd: { clear: true, name: '<hr aria-hidden="true"><div style="color: #7fe3a0; text-align:center; padding: 8px;">▸ 引擎开关与参数</div>' },

	/* ===== 总开关 ===== */
	decisionScore: { name: '✅ 决策积分引擎总开关'},

	/* ===== 决策模式 ===== */
		/* 🎯 决策模式 */
		/* ⚔️ 进攻倾向 */
		/* 🛡️ 防守倾向 */

	/* ===== 决策权重 ===== */
	weightBd: { clear: true, name: '<div style="color: #9ad8ff; text-align:center; padding: 4px;">▸ 决策权重</div>' },
		/* 📊 进攻牌基础系数 */
		/* 📊 防御牌基础系数 */
		/* 📊 机会成本系数 */
		/* 📊 集火目标加成 */
		/* 📊 座位压力系数 */
		/* 📊 预测修正系数 */
		/* 📊 连招加成系数 */
		/* 📊 高方差卡牌系数 */

	/* ===== AI 增强 ===== */
	aiBd: { clear: true, name: '<div style="color: #9ad8ff; text-align:center; padding: 4px;">▸ AI 增强</div>' },
	decisionFeedback: { 
		name: '📝 决策维度反馈（目标/阶段/留牌三维度学习）', 
		intro: 'AI 会从三个维度评估决策质量：打谁最优、当前阶段该激进还是保守、手牌该留什么弃什么'},
	responseAI: { 
		name: '🛡️ 响应/弃牌 AI 增强（AI 学会留闪/桃/无懈）', 
		intro: 'AI 不再无脑出牌，会根据局势留闪防杀、留桃保命、留无懈防关键锦囊'},
	broadcastAI: { 
		name: '📡 AI 广播协作（同阵营 AI 共享攻击意图形成集火）', 
		intro: '忠臣/反贼AI会互相通气：我要打谁了，你也一起打，形成集火秒杀'},
	compareAI: { 
		name: '🎲 拼点/选牌 AI 微调（保留高点数牌用于拼点）', 
		intro: 'AI 会记住高点数的牌，留着拼点用，而不是随便打出去'},
	adaptiveDifficulty: { 
		name: '📈 自适应难度（AI 根据你的近期战绩自动调整强度）', 
		intro: '你连胜AI就变强，你连败AI就放水，永远让你觉得势均力敌'},
	enablePlanner: { 
		name: '🎯 战术规划器（多步连招 + 残局解）', 
		intro: 'AI 会提前想两步：先出什么、再出什么，怎么连招一套带走；残局会算最优解'},
		/* 🎯 规划深度（1=单步 2=两步展望） */
	psychologyLayer: {
		name: '🧠 博弈策略层（威慑姿态 / 意图识别 / 压迫力 / 策略保留）',
		intro: 'AI 会摆出进攻架势、判断对手是真强还是试探、评估心理压迫价值、保留无用牌作消耗',
	},
	comboChain: {
		name: '🔗 连招链（铁索火攻 / 拆防连杀 / 酒杀斩杀 / AOE顺拆 / 连弩爆发）',
		intro: 'AI 会识别手牌里的连招组合，并按起手优先级执行',
	},
	narrator: {
		name: '💬 决策解释器（自然语言解释每次决策）',
		intro: '把引擎信号翻译成人话：因为…所以…；如果…就会…',
	},
	profiler: {
		name: '⏱️ 性能分析器（记录各阶段耗时）',
		intro: '轻微开销，用于诊断卡顿。默认开，不想要可关',
	},

	/* ===== 接管原生 AI ===== */
	overrideBd: { clear: true, name: '<div style="color: #ff9c9c; text-align:center; padding: 4px;">▸ 接管原生 AI</div>' },
	hardOverride: {
		name: '⚠️ 硬接管层（4 层独立熔断，异常自动降级到软接管）',
		intro: '开启后：<br>① 引擎说"结束回合"→ 立即结束<br>② 引擎选的牌不可用 → 回退原生 AI<br>③ 出牌顺序/目标选择仍由软接管驱动<br>④ 任意层异常 3 次 → 该层自动熔断 30 秒',
	},
	override_use: { name: '⚠️ 硬接管 · 出牌决策（仅做"结束回合"短路）'},
	override_respond: { name: '⚠️ 硬接管 · 响应决策（保留闪/桃/无懈）'},
	override_discard: { name: '⚠️ 硬接管 · 弃牌决策（弃低价值牌）'},
	override_compare: { name: '⚠️ 硬接管 · 拼点决策（按赢率选牌）'},

	/* ===== 分值倍率 ===== */
	rateBd: { clear: true, name: '<div style="color: #9ad8ff; text-align:center; padding: 4px;">▸ 分值倍率</div>' },
		/* 💥 伤害分值倍率（默认2分/点） */
		/* 🎴 摸牌分值倍率（默认1分/张） */
		/* 🗑️ 弃牌惩罚倍率（默认-1.5/张） */

	/* ===== AI 性格 ===== */
	personalityBd: { clear: true, name: '<div style="color: #9ad8ff; text-align:center; padding: 4px;">▸ AI 性格</div>' },
		/* ⚔️ 性格 · 攻守轴（0=保守 50=均衡 100=激进） */
		/* 🎲 性格 · 冒险轴（0=稳健 50=均衡 100=赌徒） */
		/* 🤝 性格 · 团队轴（0=独狼 50=均衡 100=团队） */
		/* 🎭 性格预设（一键覆盖上方三维） */

	/* ===== 记忆/学习 ===== */
	memoryBd: { clear: true, name: '<div style="color: #9ad8ff; text-align:center; padding: 4px;">▸ 记忆/学习</div>' },
	crossGameMemory: {
		name: '🧠 跨局记忆（记住武将打法风格，跨局累积，所有模式生效）',
	},
	skillFeedback: {
		name: '📚 技能矩阵反馈闭环（AI 会随对局自动学习修正技能评分）',
	},
	styleFeedback: {
		name: '🎨 对手风格反馈（用胜负修正风格标签可信度）',
	},
	playerMemory: {
		name: '👤 对手长期记忆（记住每个玩家的身份偏好 / 行为画像 / 仇恨度）',
		intro: 'AI 跨局记住与你交手过的玩家，越玩越懂对方',
	},

	/* ===== 战报/日志 ===== */
	reportBd: { clear: true, name: '<div style="color: #9ad8ff; text-align:center; padding: 4px;">▸ 战报/日志</div>' },
	tacticalOptimization:{name:'启用打法优化覆盖'},
	tacticalFire:{name:'火攻与铁索联动优化'},
	tacticalTiesuo:{name:'铁索使用与重铸优化'},
	tacticalWuxie:{name:'无懈可击使用优化'},
	tacticalGuding:{name:'古锭刀出牌顺序优化'},
	tacticalWine:{name:'酒杀时机优化'},
	tacticalStrip:{name:'拆顺后出杀优化'},
	tacticalJudgeRescue:{name:'队友判定区救援优化'},
	tacticalDelay:{name:'贴兵贴乐优化'},
	tacticalCrossbow:{name:'诸葛连弩连杀优化'},
	tacticalDiagnostics:{name:'输出打法优化诊断'},
	showReport: {
		name: '📊 结算战报（终局后弹出对局图文报告）',
	},
	archiveGames: {
		name: '📁 战报归档（每局保存，最多 30 局）',
	},
	showLog: { name: '📋 对局日志显示积分明细'},
	testDecisionLog: {
		name: '🧪 测试决策日志',
		intro: '用于调试和复盘 AI 为什么推荐某个动作，不参与评分或执行。摘要按行显示推荐动作、综合评分、备选与分差、当前策略、武将打法、推荐原因和耗时；每个角色回合结束还输出观测动作数和分析条数，无分析时给出观测说明。评分用于比较候选，不是胜率；预期收益是收益估计，增量收益表示额外收益，连招规划评分用于比较后续动作路线。详细模式额外显示前3候选、收益维度、规划与性能信号。参考分歧表示规则评分与小模型分类建议不同，分歧本身不会触发接管。关闭仅停止输出决策分析，其他诊断提示仍可能出现。',	},
	persist: { name: '💾 结算保存历史（localStorage）'},

	/* ===== 牌堆感知 ===== */
	deckBd: { clear: true, name: '<div style="color: #9ad8ff; text-align:center; padding: 4px;">▸ 牌堆感知</div>' },
	deckAwareness: {
		name: '🎴 牌堆感知（追踪剩余牌，修正判定/摸牌概率）',
	},
		/* 📊 牌堆预测权重（影响 AOE/判定类卡牌评分） */
	deckConsumeAllPlayers: {
		name: '👥 感知所有玩家的牌（不只是 AI 自己）',
	},

	/* ===== 训练/蒸馏 ===== */
	trainBd: { clear: true, name: '<hr aria-hidden="true"><div style="color: #ffd479; text-align:center; font-size: 16px; padding: 10px;">🎓 训练/蒸馏（AI 学习闭环）</div>' },

 classicDoudizhu:{name:'常规斗地主专项规则',init:true,intro:'休闲／开黑／欢乐自动识别；修改于下一局生效。公共 AI 继续使用。'},
 classicDoudizhuCollect:{name:'采集常规斗地主专项数据',init:true,intro:'为实际提交与已确认结果记录模式、规则和角色；不把建议当执行。修改于下一局生效。'},
 playerDemonstrations:{name:'采集玩家手动出牌示范'},
 classicModelEnabled:{name:'专项模型参与实际选择'},
 classicEffectReport:{name:'结算显示AI效果'},
 modeTrainingCenter:{name:'📊 斗地主专项训练中心',clear:true,onclick:async function(){try{const m=await import('../../score/view/dashboard/modeTrainingPanel.js?v=41a');m.openModeTrainingPanel();}catch(e){alert('专项面板加载失败：'+e.message);}}},

	exportTrainingData_DISABLED_PR5E: {
		name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #ffd479, #ffa500); width: 100%; padding: 15px; font-size: 16px; margin: 8px 0;">📥 导出AI学习数据（含训练样本 + 对局/玩家/AI 操作）</button>',
		intro: '统一导出入口：训练样本 + 对局日志（人+机，内含玩家操作与AI决策链）。原先的「导出对局日志 / 只导出玩家 / 只导出AI操作」已并入此处，不再单列。',
		onclick: async function () {
			try {
				let msg = '';
				if (window.__DJSC && window.__DJSC.__trainExportModule) {
					const result = await window.__DJSC.__trainExportModule.downloadJson();
					if (!result.ok) { alert('导出失败：' + result.err); return false; }
					msg += (result.verified ? '✅ 学习数据已保存并核验。' : result.note || '已触发导出，请确认文件。') + '\n\n📊 样本数：' + result.count + ' 条\n📁 文件：' + result.file + '\n';
				} else {
					alert('训练数据模块未就绪');
					return false;
				}
				/* 对局日志（人+机，含玩家/AI操作）一并归入本入口导出 */
				import('../../score/foundation/io/export.js?v=41a').then(function (ex) {
					const store = window.__DJSC && window.__DJSC.gameLogStore;
					let extra = '';
					if (store && store.gameCount()) {
						ex.downloadTextFile('无名AI_对局日志_含玩家AI_' + Date.now() + '.json', store.exportAllJson(), 'application/json;charset=utf-8');
						extra = '🎮 已附带导出对局日志（' + store.gameCount() + ' 局，人+机，含玩家操作与AI决策链）\n';
					} else {
						extra = '（暂无对局日志）\n';
					}
					/* ★ 连招库（全维度）一并导出，供学习成果跨机回流 */
				try {
					const cc = window.__DJSC && window.__DJSC.comboChain;
					if (cc && cc.exportAll) {
						const cb = cc.exportAll();
						if (cb && cb.chains && cb.chains.length) {
							ex.downloadTextFile('无名AI_连招库_' + Date.now() + '.json', JSON.stringify(cb, null, 2), 'application/json;charset=utf-8');
							extra += '🔗 已附带导出连招库（内置+学习，维度全，共 ' + cb.count + ' 条）\n';
						}
					}
				} catch (eCC) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCC); }
				alert(msg + extra + '\n注：玩家操作/AI操作已包含在对局日志内；连招库含完整维度(id/牌型/权重/命中/胜率)，可「导入学习数据」回流。');
				}).catch(function (e) {
					alert(msg + '（附注：对局日志导出失败 - ' + e.message + '）');
				});
			} catch (e) {
				alert('导出失败：' + e.message);
			}
			return false;
		}
	},

	importTrainingData: {
		name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #ffb379, #ff8c42); width: 100%; padding: 15px; font-size: 16px; margin: 8px 0;">📤 导入别人的AI数据</button>',
		intro: '选择别人发给你的JSON文件（可多选），自动合并到你的样本里',
		onclick: function () {
			try {
				const input = document.createElement('input');
				input.type = 'file';
				input.accept = '.json';
				input.multiple = true;  /* 支持多选文件 */
				input.onchange = function (e) {
					const files = Array.from(e.target.files);
					if (!files.length) return;
					
					let totalAdded = 0, totalMerged = 0, totalSkipped = 0;
					let processed = 0;
					
					files.forEach(function(file) {
						const reader = new FileReader();
						reader.onload = function(ev) {
							try {
								const jsonStr = ev.target.result;
								if (window.__DJSC && window.__DJSC.trainImport) {
									const result = window.__DJSC.trainImport(jsonStr);
								/* ★ 连招库回流：若导入文件含连招库段(chains/comboChain/learningData)，并入本机学习库 */
								try {
									const parsed = JSON.parse(jsonStr);
									const cc = window.__DJSC && window.__DJSC.comboChain;
									let chainsArr = null;
									if (parsed && Array.isArray(parsed.chains)) chainsArr = parsed.chains;
									else if (parsed && parsed.comboChain && Array.isArray(parsed.comboChain.chains)) chainsArr = parsed.comboChain.chains;
									else if (parsed && parsed.learningData && Array.isArray(parsed.learningData.chains)) chainsArr = parsed.learningData.chains;
									if (cc && cc.importChains && chainsArr && chainsArr.length) {
										const im = cc.importChains(chainsArr);
										totalAdded += (im && im.added) || 0;
									}
								} catch (eUB) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eUB); }
									if (result.ok) {
										totalAdded += result.added;
										totalMerged += result.merged;
										totalSkipped += (result.skipped || 0) + (result.skippedWrongDim || 0) + (result.skippedNonFinite || 0) + (result.skippedInvalidLabels || 0);
									}
								}
							} catch (err) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(err); }
							processed++;
							if (processed === files.length) {
								alert('✅ 导入完成！\n\n文件数：' + files.length + ' 个\n新增样本：' + totalAdded + ' 条\n合并样本：' + totalMerged + ' 条\n跳过样本：' + totalSkipped + ' 条\n\n当前总样本：' + (window.__DJSC.trainBufferSize ? window.__DJSC.trainBufferSize() : '?') + ' 条');
							}
						};
						reader.readAsText(file);
					});
				};
				input.click();
			} catch (e) {
				alert('导入失败：' + e.message);
			}
			return false;
		}
	},

	clearTrainingBuffer: {
		name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #ff6b6b, #ee5a5a); width: 100%; padding: 15px; font-size: 16px; margin: 8px 0;">🗑️ 清空训练缓冲区</button>',
		intro: '清空所有已缓冲的训练样本',
		onclick: async function () {
			try {
				if (window.__DJSC && window.__DJSC.trainClearBuffer) {
					const result = await window.__DJSC.trainClearBuffer();
					alert(result.ok ? '✅ 数据库、内存和本地备份已清空' : '清空未完成：' + result.err + '；内存样本保留。');
				} else {
					alert('训练数据模块未就绪');
				}
			} catch (e) {
				alert('清空失败：' + e.message);
			}
			return false;
		}
	},

	showTrainStats: {
		name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #9ad8ff, #1e90ff); width: 100%; padding: 15px; font-size: 16px; margin: 8px 0;">📊 查看训练统计</button>',
		intro: '查看当前缓冲的训练样本数',
		onclick: function () {
			try {
				if (window.__DJSC && window.__DJSC.trainStats) {
					const s = window.__DJSC.trainStats();
					alert('📊 训练样本数：' + s.count + ' 条' + '\n上限：' + s.max + ' 条' + '\n累计导出：' + s.exports + ' 次');
				} else {
					alert('训练数据模块未就绪');
				}
			} catch (e) {
				alert('查询失败：' + e.message);
			}
			return false;
		}
	},

		/* ===== 模型训练与更新 ===== */
		modelBd: { clear: true, name: '<div style="color: #7fe3a0; text-align:center; padding: 4px;">▸ 模型训练与更新</div>' },

		/* ★ 模型权重在线更新：只更新 AI 模型参数数据，不下载/解压/覆盖扩展文件（实现见 js/update/）。
		 * 判新旧比较的是「模型权重版本」，与扩展版本无关；扩展版本只用于兼容性判断。 */
		checkModelUpdate: {
			name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #9ad8ff, #1e90ff); width: 100%; padding: 15px; font-size: 16px; margin: 8px 0;">🔄 检查模型权重更新</button>',
			intro: '比较本地与服务器的「模型权重版本」；只更新模型参数数据，不改动扩展文件、不影响本地训练样本。',
			onclick: function () {
				try {
					if (window.__DJSC && window.__DJSC.modelUpdate && window.__DJSC.modelUpdate.check) {
						window.__DJSC.modelUpdate.check().catch(function () {});
					} else if (window.__DJSC && window.__DJSC.updateCheck) {
						window.__DJSC.updateCheck();
					} else {
						alert('模型权重更新模块未就绪');
					}
				} catch (e) {
					alert('检查失败：' + e.message);
				}
				return false;
			}
		},

		useTrainedModel: {
			name: '🤖 启用训练模型（默认开启，新手开箱即用，日志显示 M 标签）',
		},

		/* 🔧 模型高级配置 */
		useResidual: {
			name: '🔗 启用残差连接（默认关闭，开启后训练更稳定）',
		},

		/* 🎚️ AI 强度档位：缩放"冠军策略"对决策的影响力系数。
		 * ⚠ 说明修正：此前文案写"极强=近乎完美"，但档位只改影响力、不改正确率；
		 *   且旧代码里该系数算完从未被使用（死开关）。现已真正接到冠军策略提权上。 */
		aiStrength: {
			name: '🎚️ AI 强度（冠军策略影响力档位）',
			intro: '缩放"冠军策略"对决策的影响力：极弱=0（纯规则，不接管）、弱=0.3、中=1.0（默认，与历史行为一致）、强=1.6、极强=2.0。档位只放大影响力，不提升模型本身的正确率——判断有误时，档位越高错误也被放大得越明显。',		},

		/* 🗂️ 对局日志自存：绕开内核"录像只留 20 条"的限制 */
		recordStatus: { name: '记录状态', onclick: function () { const store=window.__DJSC && window.__DJSC.gameLogStore; if(!store){alert('日志库未就绪');return false;} const st=store.storeStats(); alert((st.saving?'正在保存':'已停止保存新对局')+'\n已保存：'+st.games+' / '+st.cap+' 局\n日志容量：约 '+st.kb+' KB / '+st.maxKb+' KB'); return false; } },
		cloudShowButton: { name:'显示云端上传按钮', onclick:function(value){game.saveConfig('extension_无名AI_cloudShowButton',value);lib.config.extension_无名AI_cloudShowButton=value;window.__DJSC?.cloudFeedback?.refresh();} },
		cloudAutoUpload: { name:'允许自动上传反馈数据', onclick:function(value){game.saveConfig('extension_无名AI_cloudAutoUpload',value);lib.config.extension_无名AI_cloudAutoUpload=value;window.__DJSC?.cloudFeedback?.refresh();} },
		cloudUploadNow: { name:'立即上传', onclick:function(){window.__DJSC?.cloudFeedback?.upload();return false;} },
		cloudUploadStatus: { name:'上传状态', onclick:function(){const api=window.__DJSC?.cloudFeedback;if(!api){alert('上传通道未就绪');return false;}const st=api.status();alert('自动上传：'+(lib.config.extension_无名AI_cloudAutoUpload===true?'开启':'关闭')+'\n待上传：'+st.pendingSamples+' 条\n上次成功：'+st.lastOk+'\n地址：'+st.endpoint+(st.lastErr?'\n上次错误：'+st.lastErr:'')+(st.backoffMin?'\n限流退避中：约 '+st.backoffMin+' 分钟后自动重试':''));return false;} },
		exportGameFeedback: { name: '导出反馈包', onclick: function () { const store=window.__DJSC && window.__DJSC.gameLogStore; if(!store){alert('日志库未就绪');return false;} if(!store.gameCount()){alert('暂无对局日志');return false;} const result=store.shareGameLogs(); if(!result.ok)alert('导出未成功：'+(result.err||'无可用写入方式')); return false; } },
		logRetain: {
			name: '🗂️ 对局日志保留局数（扩展自存，不受内核 20 条限制）',
			intro: '每局结束自动把完整日志（AI决策链 + 玩家实际操作 + 出牌统计 + 胜负结论）存进扩展自己的日志库，与内核录像互不影响。超过局数或容量上限时自动淘汰旧记录，不自动导出。',		},

		/* 📮 交流群号：样本满额一键复制 */
		qqGroup: {
			name: '📮 交流群号（样本满额时一键复制）',
			intro: '样本攒满后可将导出文件发送到反馈与交流QQ群 1080487560；留空则只提示导出文件名。',
		},

		/* 📤 对局日志导出已并入「导出AI学习数据(exportTrainingData)」：
		 * 玩家操作 / AI操作 / 完整对局日志 统一由那个入口导出，不再单列栏目。 */

		clearGameLogs: {
			name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #ff8a8a, #c23b3b); width: 100%; padding: 15px; font-size: 16px; margin: 8px 0;">🗑️ 清空对局日志库</button>',
			intro: '清空扩展自己保存的对局日志（不影响内核录像与训练样本）。',
			onclick: function () {
				try {
					const store = window.__DJSC && window.__DJSC.gameLogStore;
					if (!store) { alert('日志库未就绪'); return; }
					const st = store.storeStats();
					if (!confirm('确定清空 ' + st.games + ' 局对局日志（约 ' + st.kb + ' KB）？此操作不可恢复。')) return false;
					store.clearGames();
					alert('✅ 已清空对局日志库');
				} catch (e) { alert('清空失败：' + e.message); }
				return false;
			},
		},

		learningRate: {
			name: '📈 学习率（越大训练越快）',
			intro: '0.00005~0.01，默认0.005平衡',		},

		championBoost: {
			name: '🏆 冠军策略（写入引擎的同类型最高分决策提权）',
			intro: '训练完成后，从样本里按决策类型聚合，挑出每类价值最高的冠军决策，固化为默认策略写入引擎。此项设置命中冠军动作的加分强度：0=关闭、3=轻微、6=明显、10=强执。既能把样本训练出的最高分决策固化长期优先，又可通过归零随时关闭。需要在模型提升后才会自动固化一次。',		},

		/* 🔄 模型更新模式 */

		/* 🧪 A/B 测试局数 */

		/* 📈 候选胜出阈值（高于旧模型 X%） */

		forceTrain: {
			name: '<button class="djsc-menu-config-btn">手动触发训练</button>',
			intro: '立即用当前样本训练模型',
			onclick: function () {
				try {
					if (window.__DJSC && window.__DJSC.forceTrain) {
						window.__DJSC.forceTrain();
					} else {
						alert('模型模块未就绪');
					}
				} catch (e) {
					alert('触发失败：' + e.message);
				}
				return false;
			}
		},

		showSampleCount: {
			name: '<button class="djsc-menu-config-btn">查看样本数</button>',
			intro: '查看当前训练样本数量',
			onclick: function () {
				try {
					import('../../score/model/train/trainExport.js?v=41a').then(function (m) {
						const count = m.bufferSize();
						let ready = false;
						try { ready = window.__DJSC.weightsReady(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
						let state = 'unknown';
						try { state = window.__DJSC.modelState.getState(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
						openStateCardPanel('📦 训练样本', [
							{ label: '当前样本数', value: count + ' 条', color: '#7fe3a0' },
							{ label: '模型状态', value: state, color: '#9ad8ff' },
							{ label: '模型就绪', value: ready ? '是' : '否', color: ready ? '#7fe3a0' : '#ff9c9c' },
						]);
					});
				} catch (e) {
					alert('查看失败：' + e.message);
				}
				return false;
			}
		},

		clearSamples: {
			name: '<button class="djsc-menu-config-btn" style="background: #ff6b6b;">清空训练样本</button>',
			intro: '清空所有训练样本（谨慎操作）',
			onclick: function () {
				try {
					if (confirm('确定要清空所有训练样本吗？\n此操作不可恢复！')) {
						import('../../score/model/train/trainExport.js?v=41a').then(async function (m) {
							const result = await m.bufferClear();
							alert(result.ok ? '数据库、内存和本地备份已清空' : '清空未完成：' + result.err);
						}).catch(e => alert('清空失败：' + e.message));
					}
				} catch (e) {
					alert('清空失败：' + e.message);
				}
				return false;
			}
		},

		showModelStatus: {
			name: '<button class="djsc-menu-config-btn">查看模型状态</button>',
			intro: '查看当前模型的训练状态和准确率，并给出动态学习建议',
			onclick: function () {
				/* ★ 动态推荐引擎：随「样本量 + 校准信任 + 准确率 + 阶段」实时变化。
				 * 目标：让模型始终处于学习状态，不过拟合、不污染、不休闲躺平。 */
				async function _recommend() {
					let state = 'progress', gamesSince = 0, accuracy = 0, ready = false;
					let sampleCount = 0, calibTrust = 0, lr = 0.005;
					try { state = window.__DJSC.modelState.getState(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					try { gamesSince = window.__DJSC.modelState.getGamesSince(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					try { ready = window.__DJSC.weightsReady(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					try { accuracy = (await import('../../score/model/weights/weights.js?v=41a')).getAccuracy() || 0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					try { sampleCount = (await import('../../score/model/train/trainExport.js?v=41a')).bufferSize() || 0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					try { calibTrust = (window.__DJSC.calibrator && window.__DJSC.calibrator.modelTrust()) || 0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					try { lr = Number((await import('../../score/foundation/config/util.js?v=41a')).cfg('learningRate', 0.005)) || 0.005; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

					/* ★ 动态推荐统一走共享函数（模型状态面板 & 训练完成弹窗同口径） */
					if (window.__DJSC && window.__DJSC.recommend) {
						return await window.__DJSC.recommend();
					}
					return '  1. 推荐功能未就绪';
				}

				_recommend().then(function (rec) {
					let state = 'progress', gamesSince = 0, accuracy = 0, ready = false;
					try { state = window.__DJSC.modelState.getState(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					try { gamesSince = window.__DJSC.modelState.getGamesSince(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					try { ready = window.__DJSC.weightsReady(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					try { accuracy = window.__DJSC.getAccuracy ? window.__DJSC.getAccuracy() : 0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					let extra = '<b style="color:#ffd479;">💡 动态推荐 · 保持学习</b><br>';
					extra += '<div style="color:#dbe7f5;">' + String(rec).replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div>';
					openStateCardPanel('🎛️ 模型状态', [
						{ label: '模型状态', value: state, color: state === 'stable' ? '#7fe3a0' : (state === 'training' ? '#ffd479' : '#ff9c9c') },
						{ label: '当前阶段局数', value: gamesSince + ' 局', color: '#9ad8ff' },
						{ label: '模型就绪', value: ready ? '是' : '否', color: ready ? '#7fe3a0' : '#ff9c9c' },
						{ label: '模型准确率', value: (accuracy * 100).toFixed(1) + '%', color: accuracy >= 0.6 ? '#7fe3a0' : '#ffd479' },
					], extra);
				}).catch(function () { alert('查看失败：模型模块未就绪'); });
				return false;
			}
		},

		autoFixModel: {
			name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #ff9c9c, #ff5a5a);">🔧 模型自启动修复</button>',
			intro: '自动检查模型是否正常工作，如果不工作就自动修复',
			onclick: function () {
				try {
					let report = '═══ 模型自启动修复报告 ═══\n\n';
					let allOk = true;

					/* 1. 检查weights模块 */
					try {
						if (typeof window.__DJSC.weightsReady === 'function') {
							report += '✅ weights模块: 已加载\n';
						} else {
							report += '❌ weights模块: 未加载\n';
							allOk = false;
						}
					} catch (e) {
						report += '❌ weights模块: 异常 - ' + e.message + '\n';
						allOk = false;
					}

					/* 2. 检查predict函数 */
					try {
						if (typeof window.__DJSC.confidence === 'function') {
							report += '✅ predict函数: 已挂载\n';
						} else {
							report += '❌ predict函数: 未挂载\n';
							allOk = false;
						}
					} catch (e) {
						report += '❌ predict函数: 异常\n';
						allOk = false;
					}

					/* 3. 检查W1输入层 */
					try {
						var w = window.__DJSC.weights;
						if (w && w.W1 && w.W1.length === 16640) {
							report += '✅ W1输入层: 正常 (' + w.W1.length + '维)\n';
						} else if (w && w.W1) {
							report += '⚠️ W1输入层: 长度不对 (' + w.W1.length + '，应为16640)\n';
						} else {
							report += '❌ W1输入层: 未初始化\n';
							allOk = false;
						}
					} catch (e) {
						report += '❌ W1输入层: 异常\n';
						allOk = false;
					}

					/* 4. 检查W4价值头 */
					try {
						if (w && w.W4_critic && w.W4_critic.length === 64) {
							report += '✅ W4价值头: 正常 (' + w.W4_critic.length + '维)\n';
						} else if (w && w.W4_critic) {
							report += '⚠️ W4价值头: 长度不对 (' + w.W4_critic.length + '，应为64)\n';
						} else {
							report += '❌ W4价值头: 未初始化\n';
							allOk = false;
						}
					} catch (e) {
						report += '❌ W4价值头: 异常\n';
						allOk = false;
					}

					/* 5. 测试推理 */
					try {
						var r = window.__DJSC.confidence(Array(130).fill(0));
						if (r && r.action && r.value !== undefined) {
							report += '✅ 测试推理: 正常\n';
							report += '   value=' + r.value.toFixed(3) + ', confidence=' + r.confidence.toFixed(3) + '\n';
						} else {
							report += '⚠️ 测试推理: 返回值异常\n';
						}
					} catch (e) {
						report += '❌ 测试推理: 失败 - ' + e.message + '\n';
						allOk = false;
					}

					/* 6. 样本数 */
					try {
						import('../../score/model/train/trainExport.js?v=41a').then(function (m) {
							var stats = m.trainStats();
							report += '\n📊 当前样本数: ' + (stats.count || 0) + '\n';
							if (allOk) {
								report += '\n✅ 所有检查通过！模型正常工作。';
							} else {
								report += '\n⚠️ 有问题需要修复，请重载扩展。';
							}
							alert(report);
						});
					} catch (e) {
						report += '\n❌ 样本统计: 异常\n';
						alert(report);
					}

				} catch (e) {
					alert('自启动修复失败：' + e.message);
				}
				return false;
			}
		},

		openDecisionDashboard: {
			name: '<button class="djsc-menu-config-btn">打开决策点观测面板</button>',
			intro: '查看所有决策点的 trust / 调用 / 后悔值 / 返回值类型',
			onclick: function () {
				try {
					if (window.__DJSC && window.__DJSC.openDecisionDashboard) {
						window.__DJSC.openDecisionDashboard();
					} else {
						alert('面板未就绪');
					}
				} catch (e) { alert('打开失败：' + e.message); }
				return false;
			}
		},

		openCalibratorPanel: {
			name: '<button class="djsc-menu-config-btn">📈 打开 · 决策校准趋势</button>',
			intro: '查看规则引擎与模型的博弈趋势',
			onclick: function () {
				try {
					if (window.__DJSC && window.__DJSC.openCalibratorPanel) {
						window.__DJSC.openCalibratorPanel();
					} else {
						alert('校准趋势面板未就绪');
					}
				} catch (e) { alert('打开失败：' + e.message); }
				return false;
			}
		},

		openBrainDashboard: {
			name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #7fe3a0, #2a6);">🧠 打开 · AI 大脑总览</button>',
			intro: '校准/认知/冲突/多档案/策略总线/护栏 一屏看完',
			onclick: function () {
				try {
					if (window.__DJSC && window.__DJSC.openBrainDashboard) {
						window.__DJSC.openBrainDashboard();
					} else {
						alert('大脑总览面板未就绪');
					}
				} catch (e) { alert('打开失败：' + e.message); }
				return false;
			}
		},

		openChampionPanel: {
			name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #FFD479, #c58b22);">🏆 打开 · 冠军策略总览</button>',
			intro: '一屏列出所有冠军策略嵌入（英雄×类型×决策点），实时价值/样本/冠军，可搜索、可清空重算',
			onclick: function () {
				try {
					if (window.__DJSC && window.__DJSC.openChampionPanel) {
						window.__DJSC.openChampionPanel();
					} else {
						alert('冠军策略面板未就绪');
					}
				} catch (e) { alert('打开失败：' + e.message); }
				return false;
			}
		},

		openReplayPanel: {
			name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #9ad8ff, #4a6a9a);">🎬 打开 · 决策回放时间轴</button>',
			intro: '查看每次决策的完整链路：状态→候选→模型→总线→执行→结果',
			onclick: function () {
				try {
					if (window.__DJSC && window.__DJSC.openReplayPanel) {
						window.__DJSC.openReplayPanel();
					} else {
						alert('决策回放面板未就绪');
					}
				} catch (e) { alert('打开失败：' + e.message); }
				return false;
			}
		},

		openComparePanel: {
			name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #ffd479, #c58b22);">⚖️ 打开 · 决策对比模式</button>',
			intro: '同一局面下，不同档案会怎么选？',
			onclick: function () {
				try {
					if (window.__DJSC && window.__DJSC.openComparePanel) {
						window.__DJSC.openComparePanel();
					} else {
						alert('决策对比面板未就绪');
					}
				} catch (e) { alert('打开失败：' + e.message); }
				return false;
			}
		},

		openNarratorPanel: {
			name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #9ad8ff, #4a6a9a);">💬 打开 · 决策解释器</button>',
			intro: '用自然语言解释最近 5 次决策的主因、反事实和置信度',
			onclick: function () {
				try {
					if (window.__DJSC && window.__DJSC.openNarratorPanel) {
						window.__DJSC.openNarratorPanel(5);
					} else {
						alert('决策解释器未就绪');
					}
				} catch (e) { alert('打开失败：' + e.message); }
				return false;
			}
		},

		openProfilerPanel: {
			name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #a8b8c8, #4a6a9a);">⏱️ 打开 · 性能分析器</button>',
			intro: '查看各阶段耗时、调用树、内存占用与优化建议',
			onclick: function () {
				try {
					if (window.__DJSC && window.__DJSC.openProfilerPanel) {
						window.__DJSC.openProfilerPanel();
					} else {
						alert('性能分析器未就绪');
					}
				} catch (e) { alert('打开失败：' + e.message); }
				return false;
			}
		},

		openExportPanel: {
			name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #7fe3a0, #2a6);">📦 打开 · 数据导出中心</button>',
			intro: '一键导出蒸馏包 / 完整训练包 / 全量备份包，支持导入还原',
			onclick: function () {
				try {
					if (window.__DJSC && window.__DJSC.openExportPanel) {
						window.__DJSC.openExportPanel();
					} else {
						alert('数据导出中心未就绪');
					}
				} catch (e) { alert('打开失败：' + e.message); }
				return false;
			}
		},

		quickExportAll: {
			name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #c9aaff, #6a4a9a);">⚡ 一键全量导出</button>',
			intro: '点一下自动导出全部 3 个包，无需打开面板',
			onclick: function () {
				try {
					const D = window.__DJSC;
					if (!D || !D.export) { alert('导出模块未就绪'); return false; }
					D.export.distill();
					setTimeout(function(){ D.export.fullTrain(); }, 300);
					setTimeout(function(){ D.export.backup(); }, 600);
					alert('✅ 已开始一键全量导出\n文件保存到：无名AI/data/output/');
				} catch (e) { alert('导出失败：' + e.message); }
				return false;
			}
		},

		openPostCheckPanel: {
			name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #7fd4ff, #2a7a9a); padding: 10px 20px; font-size: 14px;">📊 决策后检测 · 数据中心</button>',
			intro: '查看决策后实际收益统计 / 样本质量分析 / 一键清空样本',
			onclick: function () {
				try {
					const D = window.__DJSC;
					if (!D || !D.postCheck) { alert('决策后检测未就绪'); return false; }

					const pc = D.postCheck.stats();

					const extra =
						'<div style="margin:4px 0; color:#dbe7f5;">🎯 功能说明：</div>' +
						'<div style="color:#a8b8c8; font-size:11px; line-height:1.8;">' +
						'· 每次决策后 1.5 秒自动检测实际收益<br>' +
						'· 检测维度：目标掉血/掉牌/掉装备 + 自身掉血/掉牌 + 局势变化<br>' +
						'· 实际收益自动写入训练样本的 reward 字段<br>' +
						'· ⚠️ 注意：日志面板里不会显示这些记录</div>';

					openStateCardPanel('📊 决策后检测 · 数据中心', [
						{ label: '总检测次数', value: (pc.totalChecks || 0) + ' 次', color: '#7fe3a0' },
						{ label: '平均收益', value: (pc.avgReward || 0), color: '#9ad8ff' },
						{ label: '正收益', value: (pc.positiveCount || 0) + ' 次', color: '#ffd479' },
						{ label: '负收益', value: (pc.negativeCount || 0) + ' 次', color: '#ff9c9c' },
						{ label: '当前回合', value: pc.round || 0, color: '#a8b8c8' },
						{ label: '队列', value: (pc.queued || 0) + ' 排队 / ' + (pc.drained || 0) + ' 已结算', color: '#9ad8ff' },
					], extra);
				} catch (e) { alert('打开失败：' + e.message); }
				return false;
			}
		},

		openHotSwapPanel: {
			name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #ff9c9c, #c33);">🔥 打开 · 模型热更新</button>',
			intro: '查看候选模型 / A/B 进度 / 晋升历史',
			onclick: function () {
				try {
					const s = window.__DJSC.hotSwap && window.__DJSC.hotSwap.stats();
					if (!s) { alert('未就绪'); return false; }
					openStateCardPanel('🔥 模型热更新', [
						{ label: '样本', value: s.samples + ' 条', color: '#7fe3a0' },
						{ label: '候选模型', value: s.hasCandidate ? '有（年龄 ' + s.candidateAge + 's）' : '无', color: s.hasCandidate ? '#ffd479' : '#a8b8c8' },
						{ label: 'A/B 进度', value: s.abProgress, color: '#9ad8ff' },
						{ label: '晋升', value: s.promoted + ' 次', color: '#7fe3a0' },
						{ label: '丢弃', value: s.discarded + ' 次', color: '#ff9c9c' },
					]);
				} catch (e) { alert('失败：' + e.message); }
				return false;
			}
		},

		openSharedPanel: {
			name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #7fe3a0, #2a6);">🤝 打开 · 公共知识库</button>',
			intro: '局面指纹 → 群体智慧 → 采纳加成',
			onclick: function () {
				try {
					const s = window.__DJSC.shared.stats();
					const list = window.__DJSC.shared.list(8);
					let extra = '<b style="color:#9ad8ff;">Top 8 高置信条目</b><br>';
					extra += '<div style="color:#dbe7f5;">' + list.map(function (x) {
						return '· ' + x.fingerprint + ' → ' + x.choice +
						       '（' + (x.winRate * 100).toFixed(0) + '% / ' + x.samples + '）';
					}).join('<br>') + '</div>';
					openStateCardPanel('🤝 公共知识库', [
						{ label: '局面指纹', value: s.fingerprints || 0, color: '#7fe3a0' },
						{ label: '选择条目', value: (s.choices || 0) + '（高置信 ' + (s.highConfidence || 0) + '）', color: '#9ad8ff' },
						{ label: '贡献', value: (s.contributes || 0) + ' 次', color: '#ffd479' },
						{ label: '采纳', value: (s.adopts || 0) + ' 次', color: '#ff9c9c' },
					], extra);
				} catch (e) { alert('失败：' + e.message); }
				return false;
			}
		},

		openEvolutionPanel: {
			name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #9ad8ff, #4a6a9a);">🧬 打开 · 策略进化</button>',
			intro: '遗传算法维护档案种群，自动迭代优化',
			onclick: function () {
				try {
					const s = window.__DJSC.evolution.stats();
					let extra = '<b style="color:#9ad8ff;">种群排行</b><br>';
					extra += '<div style="color:#dbe7f5;">' + s.population.map(function (p, i) {
						return (i + 1) + '. ' + p.id +
						       ' 适应度 ' + (p.fitness * 100).toFixed(0) + '%' +
						       '（' + p.wins + '/' + p.games + '）' +
						       ' 攻' + (p.genome.atk * 100).toFixed(0) +
						       ' 守' + (p.genome.def * 100).toFixed(0);
					}).join('<br>') + '</div>';
					openStateCardPanel('🧬 策略进化', [
						{ label: '当前代数', value: '第 ' + s.generation + ' 代', color: '#7fe3a0' },
						{ label: '种群大小', value: s.popSize, color: '#9ad8ff' },
						{ label: '距下次进化', value: (window.__DJSC.evolution.EVOLVE_INTERVAL - s.gamesSinceEvolve) + ' 局', color: '#ffd479' },
					], extra, [{
						id: 'djsc-evolve-force-btn',
						text: '⚡ 强制进化一代',
						color: '#5a8ac9',
						onclick: function () {
							try {
								window.__DJSC.evolution.forceEvolve();
								alert('已进化到第 ' + (window.__DJSC.evolution.stats().generation) + ' 代');
								window.__DJSC.openStateCardPanel ? window.__DJSC.openStateCardPanel(
									'🧬 策略进化', [
										{ label: '当前代数', value: '第 ' + window.__DJSC.evolution.stats().generation + ' 代', color: '#7fe3a0' },
									]) : null;
							} catch (e) { alert('进化失败：' + e.message); }
						}
					}]);
				} catch (e) { alert('失败：' + e.message); }
				return false;
			}
		},

		openSelfCheck: {
			name: '<button class="djsc-menu-config-btn">🔍 打开 · 模块自检面板</button>',
			intro: '检查所有模块是否正确挂载，显示通过/失败状态',
			onclick: function () {
				try {
					/* 直接动态加载 selfCheck.js，不依赖 installScoreEngine */
					import('../../score/verification/selfCheck.js?v=41a').then(function (m) {
						m.openSelfCheck();
					}).catch(function (e) {
						alert('自检面板加载失败：' + e.message);
					});
				} catch (e) { alert('打开失败：' + e.message); }
				return false;
			}
		},

		openGuardPanel: {
			name: '<button class="djsc-menu-config-btn">🛡️ 打开 · 模型护栏面板</button>',
			intro: '查看模型护栏的拦截统计、冷却状态、红线类型',
			onclick: function () {
				try {
					import('../../score/model/net/modelGuard.js?v=41a').then(function (m) {
						m.openGuardPanel();
					}).catch(function (e) {
						alert('模型护栏面板加载失败：' + e.message);
					});
				} catch (e) { alert('打开失败：' + e.message); }
				return false;
			}
		},

	/* ===== 身份匹配 ===== */
	identityBd: { clear: true, name: '<div style="color: #9ad8ff; text-align:center; padding: 4px;">▸ 身份匹配</div>' },
	autoIdentityMatch: {
		name: '🎭 身份自动匹配（主公→守护型，反贼→张飞型，忠臣→诸葛亮型，内奸→独狼型）',
	},

	/* ===== 📊 实时状态检测（大按钮） ===== */
	monitorBd: { clear: true, name: '<hr aria-hidden="true"><div style="color: #ffd479; text-align:center; padding: 8px;">▸ 📊 实时状态检测（点击查看）</div>' },

	openPsychologyMonitor: {
		name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #9ad8ff, #4a6a9a);">🧠 博弈策略状态</button>',
		intro: '查看博弈策略（威慑/意图/压迫/保留）的实时统计',
		onclick: function () {
			try {
				const D = window.__DJSC || {};
				if (!D.psychology) return alert('博弈策略未挂载');
				const stats = D.psychology.stats();
				openStateCardPanel('🧠 博弈策略状态', [
					{ label: '总决策次数', value: stats.totalDecisions || 0, color: '#7fe3a0' },
					{ label: '威慑检测', value: (stats.deterrenceCount || 0) + ' 次', color: '#9ad8ff' },
					{ label: '意图识别', value: (stats.intentCount || 0) + ' 次', color: '#ffd479' },
					{ label: '压迫评分', value: stats.pressureAvg || 0, color: '#ff9c9c' },
					{ label: '保留策略', value: (stats.holdCount || 0) + ' 次', color: '#a8b8c8' },
				]);
			} catch (e) { alert('打开失败：' + e.message); }
			return false;
		}
	},

	openComboMonitor: {
		name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #7fe3a0, #4a9a6a);">🔗 连招链状态</button>',
		intro: '查看当前手牌能识别到的连招组合',
		onclick: function () {
			try {
				const D = window.__DJSC || {};
				if (!D.comboChain) return alert('连招链未挂载');
				const stats = D.comboChain.stats();
				let extra = '<b style="color:#9ad8ff;">当前手牌连招</b><br>';
				if (stats.chains > 0) {
					extra += '<div style="color:#dbe7f5;">' + (stats.list || []).map(function (c) { return '· ' + c.name + '（+' + c.bonus + '）'; }).join('<br>') + '</div>';
				} else {
					extra += '<div style="color:#888;">（当前手牌无合适连招组合）</div>';
				}
				extra += '<br><b style="color:#9ad8ff;">已知连招库</b><br>';
				extra += '<div style="color:#dbe7f5;">' + (stats.allChains || []).map(function (c) { return '· ' + c.name + '（+' + c.bonus + '）'; }).join('<br>') + '</div>';
				openStateCardPanel('🔗 连招链状态', [
					{ label: '当前检测连招', value: stats.chains || 0, color: '#7fe3a0' },
					{ label: '已知连招库', value: stats.totalKnown || 0, color: '#ffd479' },
				], extra);
			} catch (e) { alert('打开失败：' + e.message); }
			return false;
		}
	},

	openMemoryMonitor: {
		name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #ffd479, #9a7a4a);">👤 对手记忆状态</button>',
		intro: '查看长期记忆中记录的对手数量和对局数',
		onclick: function () {
			try {
				const D = window.__DJSC || {};
				if (!D.playerMemory) return alert('对手记忆未挂载');
				const stats = D.playerMemory.stats();
				openStateCardPanel('👤 对手记忆状态', [
					{ label: '记录玩家', value: stats.players || 0, color: '#7fe3a0' },
					{ label: '累计对局', value: (stats.totalGames || 0) + ' 局', color: '#9ad8ff' },
					{ label: '有攻击历史', value: stats.playersWithAttackHistory || 0, color: '#ffd479' },
				]);
			} catch (e) { alert('打开失败：' + e.message); }
			return false;
		}
	},

	openAutoFeatureMonitor: {
		name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #c49aff, #7a5a9a);">🔮 自动特征发现状态</button>',
		intro: '查看自动发现的维度数量和样本数',
		onclick: function () {
			try {
				const D = window.__DJSC || {};
				if (!D.autoFeature) return alert('自动发现未挂载');
				const stats = D.autoFeature.stats();
				openStateCardPanel('🔮 自动特征发现状态', [
					{ label: '总维度数', value: stats.totalDimensions || 0, color: '#7fe3a0' },
					{ label: '总样本数', value: stats.totalSamples || 0, color: '#9ad8ff' },
					{ label: '重要维度', value: stats.importantDimensions || 0, color: '#ffd479' },
				]);
			} catch (e) { alert('打开失败：' + e.message); }
			return false;
		}
	},

	openSoftMetricsMonitor: {
		name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #ff9c9c, #9a5a5a);">🎛️ 软指标学习状态</button>',
		intro: '查看软指标的当前值和学习次数',
		onclick: function () {
			try {
				const D = window.__DJSC || {};
				if (!D.softMetrics) return alert('软指标未挂载');
				const stats = D.softMetrics.stats();
				const keys = ['ally_attack_penalty', 'enemy_attack_bonus', 'protect_zhugong_bonus', 'zhugong_under_threat'];
				const cards = [{ label: '总学习次数', value: stats.totalLearn || 0, color: '#ffd479' }];
				keys.forEach(function (k) {
					try {
						cards.push({ label: k, value: D.softMetrics.get(k), color: '#9ad8ff' });
					} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				});
				openStateCardPanel('🎛️ 软指标学习状态', cards);
			} catch (e) { alert('打开失败：' + e.message); }
			return false;
		}
	},

	openPostCheckMonitor: {
		name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #9cdcff, #5a8a9a);">🔍 决策后检测状态</button>',
		intro: '查看决策后检测的统计和收益记录',
		onclick: function () {
			try {
				const D = window.__DJSC || {};
				if (!D.postCheck) return alert('后检测未挂载');
				const stats = D.postCheck.stats();
				openStateCardPanel('🔍 决策后检测状态', [
					{ label: '总检测次数', value: stats.totalChecks || 0, color: '#7fe3a0' },
					{ label: '平均收益', value: stats.avgReward || 0, color: '#9ad8ff' },
					{ label: '正收益决策', value: (stats.positiveCount || 0) + ' 次', color: '#ffd479' },
					{ label: '负收益决策', value: (stats.negativeCount || 0) + ' 次', color: '#ff9c9c' },
				]);
			} catch (e) { alert('打开失败：' + e.message); }
			return false;
		}
	},

	openProfilerMonitor: {
		name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #a8b8c8, #5a6a7a);">⏱️ 性能分析状态</button>',
		intro: '查看各阶段耗时和优化建议',
		onclick: function () {
			try {
				const D = window.__DJSC || {};
				if (!D.profiler) return alert('性能分析器未挂载');
				const stats = D.profiler.stats();
				let extra = '<b style="color:#9ad8ff;">Top 5 耗时阶段</b><br>';
				extra += '<div style="color:#dbe7f5;">' + (stats.phases || []).slice(0, 5).map(function (p) {
					return '· ' + p.phase + '：' + p.avg + 'ms（' + p.count + ' 次）';
				}).join('<br>') + '</div>';
				openStateCardPanel('⏱️ 性能分析状态', [
					{ label: 'localStorage', value: (stats.memory.localStorageKB || 0) + ' KB', color: '#9ad8ff' },
				], extra);
			} catch (e) { alert('打开失败：' + e.message); }
			return false;
		}
	},

	openTrainBufferMonitor: {
		name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #9affc4, #5a9a7a);">📦 训练缓冲状态</button>',
		intro: '查看训练样本缓冲的大小',
		onclick: function () {
			try {
				const D = window.__DJSC || {};
				if (!D.trainBufferSize) return alert('训练缓冲未挂载');
				const size = D.trainBufferSize();
				openStateCardPanel('📦 训练缓冲状态', [
					{ label: '当前缓冲', value: size + ' 条样本', color: '#7fe3a0' },
				], '<div style="color:#888; font-size:11px;">导出命令：window.__DJSC.trainExportJSONL()</div>');
			} catch (e) { alert('打开失败：' + e.message); }
			return false;
		}
	},

	openFullMonitor: {
		name: '<button class="djsc-menu-config-btn" style="background: linear-gradient(135deg, #ffd479, #9a7a4a); width: 100%;">📊 一键全功能状态检测</button>',
		intro: '一次性检测所有功能的运行状态',
		onclick: function () {
			try {
				const D = window.__DJSC || {};
				const ok = function (m) { return m ? '#7fe3a0' : '#ff9c9c'; };
				const mark = function (m) { return m ? '✅ 已挂载' : '❌ 未挂载'; };
				const cards = [
					{ label: '🧠 博弈策略', value: mark(D.psychology), color: ok(D.psychology) },
					{ label: '🔗 连招链', value: mark(D.comboChain), color: ok(D.comboChain) },
					{ label: '👤 对手记忆', value: mark(D.playerMemory), color: ok(D.playerMemory) },
					{ label: '🔮 自动发现', value: mark(D.autoFeature), color: ok(D.autoFeature) },
					{ label: '🎛️ 软指标', value: mark(D.softMetrics), color: ok(D.softMetrics) },
					{ label: '🔍 后检测', value: mark(D.postCheck), color: ok(D.postCheck) },
					{ label: '⏱️ 性能分析', value: mark(D.profiler), color: ok(D.profiler) },
					{ label: '📦 训练缓冲', value: mark(D.trainBufferSize), color: ok(D.trainBufferSize) },
				];
				const me = (typeof game !== 'undefined' && game.me) ? game.me : null;
				if (me) {
					cards.push(
						{ label: '玩家', value: me.name1 || me.name || '?', color: '#9ad8ff' },
						{ label: '身份', value: me.identity || '?', color: '#ffd479' },
						{ label: '血量', value: (me.hp || 0) + '/' + (me.maxHp || 0), color: '#7fe3a0' }
					);
				} else {
					cards.push({ label: '对局状态', value: '未在对局中', color: '#a8b8c8' });
				}
				openStateCardPanel('📊 全功能状态检测', cards);
			} catch (e) { alert('检测失败：' + e.message); }
			return false;
		}
	},

	/* ===== 界面设置 ===== */
	uiBd: { clear: true, name: '<div style="color: #9ad8ff; text-align:center; padding: 4px;">▸ 界面设置</div>' },
		/* 🌐 界面语言（UI Language） */

};

config = applyConfigSchema(config);
config = arrangeConfig(config, lib, game);

