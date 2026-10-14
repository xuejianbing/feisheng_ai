import {installClassicChoiceHooks,uninstallClassicChoiceHooks} from './decision/modes/doudizhu/choices.js?v=5e5';
/*
 * ============================================
 * // 作者：飛昇原創
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 统一入口（整合进 无名AI） ================= */
import { lib, game, ui, get, ai, _status } from './foundation/adapt/host.js?v=5e5';
import { installHooks, uninstallHooks, startSettleWatch, stopSettleWatch, bestAction, rulesDecide, clearScoreState } from './decision/engine/engine.js?v=5e5';
import { openScorePanel } from './view/panel/panel.js?v=5e5';  /* ★ P0-02：debug bridge / dialog guard 移交 panelPlugin 生命周期管理 */
import { scanReset } from './decision/skills/skills.js?v=5e5';
import { installAIOverride, uninstallAIOverride } from './decision/safety/aiOverride.js?v=5e5';
import { warnConflicts, shouldDisableOverride, applyCompatPatches } from './foundation/adapt/compat.js?v=5e5';
import { log } from './foundation/diag/logger.js?v=5e5';
import { reg } from './foundation/runtime/registry.js?v=5e5';   /* ★ 唯一挂载总线：__DJSC 挂载统一入口 */
import { installResponseAI, uninstallResponseAI } from './decision/cardplay/responseAI.js?v=5e5';
import { installCompareAI, uninstallCompareAI } from './perception/stats/compareAI.js?v=5e5';
import { installStrategist, uninstallStrategist } from './decision/strategy/strategist.js?v=5e5';
import { installOptimizationHooks, uninstallOptimizationHooks } from './decision/safety/optimization.js?v=5e5';
import { installOverrideLayers, uninstallOverrideLayers, overrideStatus, retryOverrideLayers } from './decision/override/index.js?v=5e5';
/* ★ 标准插件框架：所有功能以插件声明接入，新增功能写插件即可 */
import { loadPlugins, pluginOverview, getPluginState, uninstallAllPlugins } from './plugins/index.js?v=5e5';
import { broadcastStart, broadcastGameEnd } from './foundation/runtime/plugins.js?v=5e5';
import { on as busOn, clear as busClear } from './foundation/runtime/eventBus.js?v=5e5';  /* ★ P2-33：事件总线真正接入业务链路 */
import { flushPending, quotaProbe, safeGet, safeSet, safeRemove } from './foundation/storage/storage.js?v=5e5';

let _installed = false;
let _gen = 0;   /* ★ P1-24：安装代际——卸载后自动使所有 pending import().then() 回调失效，杜绝热重载后旧闭包仍挂载 API */

export function isScoreEngineEnabled() {
	try { return lib.config["extension_无名AI_decisionScore"] !== false; } catch (e) { return true; }
}

export function installScoreEngine() {
    installClassicChoiceHooks();
	if (_installed) return;
	const myGen = ++_gen;   /* 本次安装代际 */

	/* ★ 存储配额守护：先释放扩展占用的重键，避免 localStorage 耗尽导致主程序 QuotaExceededError */
	try { safeStorageGuard(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	/* installHooks 是关键路径：失败则不置 _installed，允许下次重试
	 * （原代码先置 true 再 try，任何异常都会被吞掉且永远无法恢复）
	 */
	try { installHooks(); } catch (e) { return; }
	_installed = true;

	/* ★ 标准插件框架：登记并按依赖拓扑序统一安装全部插件（★ P0-02：注册/安装分离，
	 *   import 阶段只注册；debug bridge 与 dialog guard 由 panelPlugin.onInstall 负责） */
	try {
		loadPlugins();
		const overview = pluginOverview();  /* loadPlugins 返回数组，统计须走 pluginOverview */
		reg.mount('plugins', {
			list: function () { return pluginOverview(); },
			state: getPluginState,
			broadcastStart: broadcastStart,
			broadcastGameEnd: broadcastGameEnd,
		});
		log.info('init', '插件系统已装载 ' + (overview && overview.total) + ' 个（已安装 ' + (overview && overview.installed) + '）');
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	try { startSettleWatch(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ P2-33：事件总线业务订阅（此前 eventBus 仅被挂到 __DJSC，无任何业务发布/订阅） */
	try {
		/* 对局结束：强制把防抖写队列落盘，保证跨局记忆/校准/反馈不丢最后一写 */
		busOn('game:end', function () { try { flushPending(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
		/* 训练生命周期：由 localTrainer 发布，此处订阅做可观测性记录 */
		busOn('train:done', function (r) { try { log.info('train', '本地训练完成 acc=' + (r && r.accuracy) + ' samples=' + (r && r.samples) + ' 用时' + (r && r.ms) + 'ms'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
		busOn('train:fail', function (r) { try { log.warn('train', '本地训练未成功：' + (r && r.err)); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 兼容性检测（不阻断，只打日志） */
	try { warnConflicts(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 本体 Bug 兼容补丁 */
	try { applyCompatPatches(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 联机自动禁用接管层 */
	try {
		if (!shouldDisableOverride()) {
			// 软接管：永远安装（保底层，不破坏本体）
			installAIOverride();
			// 硬接管：逐层安装（每层独立熔断，自动重试）
			installOverrideLayers();
		} else {
			log.info('compat', '联机模式：已跳过原生 AI 接管层');
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { import('./view/autoplay/autoplay.js?v=5e5').then(function (m) { if (myGen !== _gen || !_installed) return; try { m.initAutoplayMonitor(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }).catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try {
		if (ui && ui.create && typeof ui.create.system === "function") {
			ui.create.system("决策积分", function () { try { openScorePanel(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }, true);
			ui.create.system("战报", function () {
				try {
					import('./view/report/report.js?v=5e5').then(function (m) { if (myGen !== _gen || !_installed) return; try { m.showReport(true); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }).catch(function () {});
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			}, true);
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 主面板通过 config.js 的 openPanel.onclick 打开，旧版 setInterval 轮询已移除 */
	try { log.info('init', '已整合进 无名AI（记分+评分框架+小模型+扩展识别）'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 响应/弃牌 AI 增强 */
	try { installResponseAI(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 拼点/选牌 AI */
	try { installCompareAI(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 策略总线（最后安装，收集所有信号） */
	try { installStrategist(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 卡牌优化器（hook result.target 暴露覆写信号） */
	try { installOptimizationHooks(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 选将推荐 */
	try { import('./decision/strategy/pickRecommend.js?v=5e5').then(function (m) { if (myGen !== _gen || !_installed) return; m.installPickRecommend && m.installPickRecommend(); }).catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 模型状态机 + Bandit 自动调 trust */
	try {
		import('./model/weights/weights.js?v=5e5').then(function (m) {
			if (myGen !== _gen || !_installed) return;
			/* ★ 统一走总线：已存在则不覆盖，消除与 engine.js 的重复挂载互冲 */
			reg.mount('weightsReady', m.isReady);
			reg.mount('predict', m.predict);
			reg.mount('reloadWeights', m.reloadWeights);
			reg.mount('getMeta', m.getMeta);
			reg.mount('resetWeights', m.resetWeights);
			/* ★ 特征契约自检：网络输入维度 ／ 特征输出维度 若漂移，首启即告警而非训练时静默崩坏 */
			import('./model/features/features.js?v=5e5').then(function (f) {
				if (myGen !== _gen || !_installed) return;
				try {
					var dc = (m.DIM_CHECK && m.DIM_CHECK.check && m.DIM_CHECK.check()) || Object.keys(m.DIM_CHECK || {}).length > 0;
					var wIn = (m.DIM_CHECK && m.DIM_CHECK.input) || (m.IN_DIM) || 0;
					if (!dc) { console.warn('[无名AI·契约] 权重网络结构校验 DIM_CHECK 失败'); }
					else if (f.FEATURE_DIM && wIn && f.FEATURE_DIM !== wIn) {
						console.warn('[无名AI·契约] 特征维度漂移：features.FEATURE_DIM=' + f.FEATURE_DIM + ' ≠ weights.IN_DIM=' + wIn + '，模型输入将错位！');
					}
				} catch (eChk) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eChk); }
			}).catch(function () {});
		}).catch(function () {});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { import('./model/net/modelState.js?v=5e5').catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 置信度工具（熵置信版）：模块自挂载 __DJSC.confidenceOf / evaluateConfidence / blendScore，
	 *   此前从未被导入导致自挂载不生效（孤立模块）→ 副作用导入激活 */
	try { import('./model/net/confidence.js?v=5e5').catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { import('./model/train/bandit.js?v=5e5').catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ M08：让"决策点监督员"真正上岗（之前只导入没安装，等于白装摄像头）。
	 *    延时到下一轮宏任务，确保 DECISION_REGISTRY 等依赖已就绪。 */
	try {
		import('./decision/engine/decisionHook.js?v=5e5').then(function (m) {
			try {
				window.setTimeout(function () {
					if (myGen !== _gen || !_installed) return;
					try { if (m.installDecisionHooks) m.installDecisionHooks(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				}, 0);
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}).catch(function () {});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 决策点自动发现（影子模式） */
	try { import('./perception/discover/autoDiscover.js?v=5e5').then(function (m) { if (myGen !== _gen || !_installed) return; try { m.installAutoDiscover(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }).catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 全局反射扫描器（运行时探针） */
	try { import('./foundation/runtime/globalScanner.js?v=5e5').then(function (m) { if (myGen !== _gen || !_installed) return; try { m.installProbes(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }).catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 决策点观测面板 */
	try { import('./view/dashboard/decisionDashboard.js?v=5e5').catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 全量自检指令（window.__DJSC.verifyAll） */
	try { import('./verification/verifyAll.js?v=5e5').catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ §9 分层自检（window.__DJSC.verifyLayers / verifyLayersText） */
	try { import('./verification/layers.js?v=5e5').catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	/* ★ 补全接口挂载到 window.__DJSC（★ P1-24：每个回调先校验代际，卸载后不再挂载） */
	try {
		window.__DJSC = window.__DJSC || {};
		/* 反馈统计 */
		import('./perception/feedback/feedback.js?v=5e5').then(function (m) {
			if (myGen !== _gen || !_installed) return;
			window.__DJSC.feedbackStats = m.getFeedbackStats;
		}).catch(function () {});
		/* 决策反馈 */
		import('./decision/feedback/decisionFeedback.js?v=5e5').then(function (m) {
			if (myGen !== _gen || !_installed) return;
			window.__DJSC.decisionFeedbackStats = m.getDecisionFeedbackStats;
		}).catch(function () {});
		/* 自适应状态 */
		import('./decision/tuning/adaptive.js?v=5e5').then(function (m) {
			if (myGen !== _gen || !_installed) return;
			window.__DJSC.adaptiveStatus = m.adaptiveStatus;
		}).catch(function () {});
		/* 记忆存储 */
		import('./perception/memory/memory.js?v=5e5').then(function (m) {
			if (myGen !== _gen || !_installed) return;
			window.__DJSC.memoryStats = m.storeStats;
		}).catch(function () {});
		/* 合法性校验 */
		import('./decision/safety/allyExempt.js?v=5e5').then(function (m) {
			if (myGen !== _gen || !_installed) return;
			window.__DJSC.checkAllyExempt = m.checkAllyExempt;
		}).catch(function () {});
		/* 校验记录器 */
		import('./decision/safety/guardRecorder.js?v=5e5').then(function (m) {
			if (myGen !== _gen || !_installed) return;
			window.__DJSC.guardRecorder = {
				record: m.recordGuardEvent,
				getStats: m.getGuardStats,
				reset: m.resetGuardRecorder,
			};
		}).catch(function () {});
		/* 自检面板 */
		import('./verification/selfCheck.js?v=5e5').then(function (m) {
			if (myGen !== _gen || !_installed) return;
			window.__DJSC.openSelfCheck = m.openSelfCheck;
		}).catch(function () {});
		/* 模型护栏 */
		import('./model/net/modelGuard.js?v=5e5').then(function (m) {
			if (myGen !== _gen || !_installed) return;
			window.__DJSC.modelGuard = {
				check: m.guardCheck,
				penalty: m.applyGuardPenalty,
				isCoolingDown: m.isGuardCoolingDown,
				status: m.guardStatus,
				reset: m.resetGuard,
				openPanel: m.openGuardPanel,
				RED_LINES: m.RED_LINES,
			};
		}).catch(function () {});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 激活子目录模块化版（仅加载模块定义，不重复安装 hook）
	 * 递归 import 会把 score/foundation/、score/decision/、score/perception/ 等
	 * 所有子目录文件加载为活代码；installScoreEngine 不会被自动调用，
	 * 因此不会重复注册 hook / 重复触发 AI 接管。
	 */
	/* ★ core/index.js 已删除，直接标记模块化版就绪
	 * ★ P0-10：modularReady 不再提前置 true——改为状态机 {status, loaded, failed}，
	 *   批量暴露全部 resolve 后才按结果置 'ready'/'degraded' 并同步 modularReady */
	try {
		window.__DJSC = window.__DJSC || {};
		window.__DJSC.modular = {
			isEnabled: function() { return true; },
			install: function() {},
			uninstall: function() {},
			status: 'loading',   /* loading / ready / degraded */
			loaded: [],
			failed: [],
		};
		window.__DJSC.modularReady = false;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 批量暴露模块到 window.__DJSC（供自检面板访问）
	 * 每个模块动态 import 后，把全部导出挂到 __DJSC[模块名] 下。
	 * 这样自检面板就能调用 stats/getStats 等函数验证功能。 */
	try {
		const MODULES_TO_EXPOSE = [
			['elementFB', './perception/feedback/elementFeedback.js'],
			['metaCognition', './cognition/metaCognition.js'],
			['cognitionLog', './cognition/log/cognitiveLog.js'],
			['conflict', './decision/analysis/conflictDetector.js'],
			['calibrator', './model/calibrate/decisionCalibrator.js'],
			['multiProfile', './cognition/profile/multiProfile.js'],
			['strategyBus', './decision/strategy/strategyBus.js'],
			/* ★ 连接性修复：原为 ['replay', './perception/archive/archive.js']，
			 *   会与 decisionReplay 自挂载的 __DJSC.replay 混为一体（同名不同源）。
			 *   archive 统一走 replayAnalysis（与 engine.js 一致）。 */
			['replayAnalysis', './perception/archive/archive.js'],
			['weightPersist', './model/weights/weightPersist.js'],
			/* ★ 连接性修复：原为 ['compare', './perception/stats/compareAI.js']，
			 *   会与 decisionCompare 自挂载的 __DJSC.compare 混为一体。
			 *   compareAI 统一走 compareAI（与 engine.js 一致）。 */
			['compareAI', './perception/stats/compareAI.js'],
			['hotSwap', './model/net/modelHotSwap.js'],
			['shared', './perception/knowledge/sharedKnowledge.js'],
			['evolution', './model/train/evolution.js'],
			/* ★ 连接性修复：原为 ['psychology', './cognition/reasoning/gameTheory.js']，
			 *   会与 think/psychology.js 自挂载的 __DJSC.psychology 混为一体。
			 *   博弈论统一走 gameTheory 独立命名。 */
			['gameTheory', './cognition/reasoning/gameTheory.js'],
			['comboChain', './decision/strategy/comboChain.js'],
			['playerMemory', './perception/memory/playerMemory.js'],
			['postCheck', './decision/analysis/postCheck.js'],
			['autoFeature', './model/features/autoFeature.js'],
			['softMetrics', './cognition/reasoning/softMetrics.js'],
			['skillTags', './decision/skills/skillTags.js'],
			['judgeZone', './decision/cardplay/judgeZone.js'],
			['cardTags', './knowledge/cards/cardTags.js'],
			['viewAs', './decision/cardplay/viewAs.js'],
			['cost', './decision/cardplay/costCalc.js'],
			['aiTools', './view/panel/aiTools.js'],
			['identity', './perception/observer/identity.js'],
			['learningOptimizer', './model/train/learningOptimizer.js'],
			['archiveRecycle', './model/train/archiveRecycle.js'],   /* ★ 归档离线训练回流：胜利局样本回灌 */
			['decision', './decision/engine/decisionRegistry.js'],
			['bandit', './model/train/bandit.js'],
			['discover', './perception/discover/autoDiscover.js'],
			['modelState', './model/net/modelState.js'],
			['strategist', './decision/strategy/strategist.js'],
			/* ★ 通用架构层（专业级预留） */
			['terms', './foundation/adapt/terms.js'],
			['profile', './foundation/adapt/gameProfile.js'],
			['gameLogStore', './perception/journal/gameLogStore.js'],  /* ★ 对局日志自存库：绕开内核录像 20 条上限 */
			['mergeExport', './foundation/io/mergeExport.js'],  /* ★ 合并导出：多类数据合并成 1 个文件（按钮已统一为 exportAllData） */
			['extPoints', './foundation/runtime/extensionPoints.js'],
			['configSpec', './foundation/config/configSpec.js'],
			['proReady', './verification/professionalReadiness.js'],
			/* ★ 连接性修复：事件总线此前从未被挂载（孤立模块）→ 统一走总线暴露 on/emit/off */
			['eventBus', './foundation/runtime/eventBus.js'],
			['executionGateway', './decision/execution/executionGateway.js'],
		];
		/* ★ P0-10：收集全部暴露任务，全部 settle 后按结果置 modular 状态与 modularReady */
		const _exposeTasks = [];
		MODULES_TO_EXPOSE.forEach(function ([name, path]) {
			_exposeTasks.push(import(path).then(function (mod) {
				if (myGen !== _gen || !_installed) return;   /* ★ P1-24：卸载后不再暴露 */
				try { window.__DJSC.modular.loaded.push(name); } catch (eT) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eT); }
				/* ★ 统一经总线软合并：只补缺失键，不覆盖模块自挂载的 canonical 实现 */
				reg.bind(name, mod);
				/* ★ 别名守护（经总线 reg.ensure：仅补缺失、绝不用 undefined 覆盖） */
				try {
					const t = reg.ns(name);
					if (name === 'multiProfile') {
						reg.ensure(t, 'stats', mod.multiProfileStats);
						reg.ensure(t, 'effectiveShift', mod.getEffectiveShift);
					} else if (name === 'strategyBus') {
						reg.ensure(t, 'stats', mod.strategyBusStats);
					} else if (name === 'softMetrics') {
						reg.ensure(t, 'get', mod.getMetric);
						reg.ensure(t, 'learn', mod.learnMetric);
						reg.ensure(t, 'stats', mod.softMetricStats);
						reg.ensure(t, 'reset', mod.resetSoftMetrics);
					} else if (name === 'postCheck') {
						reg.ensure(t, 'before', mod.postCheckBefore);
						reg.ensure(t, 'after', mod.postCheckAfter);
						reg.ensure(t, 'stats', mod.postCheckStats);
						reg.ensure(t, 'reset', mod.postCheckReset);
					} else if (name === 'evolution') {
						reg.ensure(t, 'stats', mod.evolveStats);
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			}).catch(function (e) {
				try { window.__DJSC.modular.failed.push(name + ': ' + String(e).slice(0, 60)); } catch (eT) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eT); }
			}));
		});
		Promise.allSettled(_exposeTasks).then(function () {
			if (myGen !== _gen || !_installed) return;   /* ★ P1-24：卸载后不再改写 modular 状态 */
			try {
				const mod = window.__DJSC.modular;
				mod.status = (mod.failed && mod.failed.length) ? 'degraded' : 'ready';
				window.__DJSC.modularReady = (mod.status === 'ready');
				log.info('init', '模块化版 ' + mod.status + '：已暴露 ' + (mod.loaded ? mod.loaded.length : 0) + ' 个模块' + ((mod.failed && mod.failed.length) ? '，失败 ' + mod.failed.length + ' 个 [' + mod.failed.join('；') + ']' : ''));
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export function uninstallScoreEngine() {
    uninstallClassicChoiceHooks();
	if (!_installed) return;
	_installed = false;
	_gen++;   /* ★ P1-24：使本次安装的所有 pending import().then() 回调代际失效 */
	try { busClear(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }   /* ★ P2-33：清空事件订阅，防止热重载后旧闭包残留 */
	try { flushPending(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }   /* ★ P2-33：卸载前强制落盘防抖写队列 */
	try { uninstallHooks(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { stopSettleWatch(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ P0-02：debug bridge / dialog guard 的清理随插件统一逆序卸载 */
	try { uninstallAllPlugins(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { uninstallAIOverride(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ M08：监督员对称下班（还原所有被换装的 chooseTo* 决策点） */
	try {
		if (window.__DJSC && window.__DJSC.decisionHook && typeof window.__DJSC.decisionHook.uninstall === 'function') {
			window.__DJSC.decisionHook.uninstall();
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { uninstallOverrideLayers(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { uninstallResponseAI(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { uninstallCompareAI(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { uninstallStrategist(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { uninstallOptimizationHooks(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { broadcastGameEnd(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ P1-24：补充此前未卸载的副作用 */
	try { import('./view/autoplay/autoplay.js?v=5e5').then(function (m) { try { m.stopBatchAutoplay ? m.stopBatchAutoplay() : (m.stopAutoplay && m.stopAutoplay()); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }).catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { import('./foundation/runtime/globalScanner.js?v=5e5').then(function (m) { try { m.uninstallProbes && m.uninstallProbes(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }).catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { import('./decision/strategy/pickRecommend.js?v=5e5').then(function (m) { try { m.uninstallPickRecommend && m.uninstallPickRecommend(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }).catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { import('./perception/discover/autoDiscover.js?v=5e5').then(function (m) { try { m.uninstallAutoDiscover && m.uninstallAutoDiscover(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }).catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export { openScorePanel, bestAction, rulesDecide, scanReset };

/* ================= 存储配额守护 =================
 * 扩展把训练样本写进本地存储（旧版）会撑爆 ~5MB 配额，
 * 导致无名杀主程序自身 setItem 也抛 QuotaExceededError。
 * 启动时先探测：若写入极小的探针都失败，说明配额已满，
 * 则清理扩展占用最重的键，释放空间后再正常启动。
 * ★ P2-31：全部经由中央存储抽象（quotaProbe/safeGet/safeSet/safeRemove），
 *   业务层不再直触 localStorage；本函数属存储治理层代码。
 */
function safeStorageGuard() {
	try {
		/* 探针：若连一个超小值都写不进去 → 存储已满 */
		if (quotaProbe()) return;  /* 还有空间，不用清 */
		/* ★ P1-21：分级清理策略（此前直接删除权重/归档/记忆等不可重建资产）
		 *   ① 可重建缓存（日志片段）→ 自动删；
		 *   ② 可导出但重要（训练样本缓冲）→ shrink 保留较新一半，不整库删除；
		 *   ③ 不可轻易重建（权重 djsc_weights_v3 / 战报归档 / 玩家记忆）→ 禁止静默删，仅告警。 */
		var removedCache = 0;
		var CACHE_KEYS = [
			'djsc_game_logs_v1',   /* 对局日志自存库：可从对局行为重建，优先释放 */
			'djsc_replay_v1',      /* 决策回放：可从决策样本重建（★PR5f） */
			'djsc_compare_v1'      /* 决策对比：可从决策样本重建（★PR5f） */
		];
		for (var i = 0; i < CACHE_KEYS.length; i++) {
			if (safeRemove(CACHE_KEYS[i])) removedCache++;
		}
		/* 训练样本缓冲：压缩为较新一半（trainExport.saveToStorage 同口径） */
		var shrunk = false;
		var rawS = safeGet('djsc_training_samples_v1');
		if (rawS) {
			try {
				var arr = JSON.parse(rawS);
				if (Array.isArray(arr) && arr.length > 2) {
					shrunk = safeSet('djsc_training_samples_v1', JSON.stringify(arr.slice(-Math.floor(arr.length / 2))));
				}
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}
		/* 复查：仍写不进去 → 不再动权重/归档/记忆，告警交用户处理 */
		if (quotaProbe()) {
			try { console.warn('[无名AI] 本地存储已满：已清理可重建缓存 ' + removedCache + ' 个' + (shrunk ? '，训练样本已压缩一半' : '') + '；权重/战报/记忆已保留'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		} else {
			try {
					/* ★ PR5f：配额仍不足时，对「战报归档」仅提示不静默删（权重/玩家记忆同理受保护）。
					 *   一次性标记防每次启动重复打扰；阈值 3MB——归档达该量级才在游戏内提示。 */
					var _arch = safeGet('无名AI_archive');
					var _archKB = _arch ? _arch.length * 2 / 1024 : 0;
					if (!safeGet('djsc_quota_warned_v1') && _archKB > 3072) {
						safeSet('djsc_quota_warned_v1', String(Date.now()));
						try {
							if (typeof game !== 'undefined' && game && game.log) {
								game.log('[无名AI] 本地存储空间紧张：战报归档已占 ' + _archKB.toFixed(1) + ' KB，请在设置中清理历史归档（AI 权重与记忆未受影响）。');
							}
						} catch (eLog) { if (typeof window !== 'undefined' && window.__DJSC) window.__DJSC.swallow(eLog); }
						console.warn('[无名AI] 配额仍不足：归档保留，已在游戏内提示用户手动清理');
					} else {
						console.warn('[无名AI] 本地存储配额仍不足：为保护模型权重/战报归档/玩家记忆不再自动删除，请手动导出数据后清理');
					}
				} catch (e3) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e3); }
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

// 选将早于 gameStart；模块载入时尝试安装，正式安装时再次核对。
installClassicChoiceHooks();
