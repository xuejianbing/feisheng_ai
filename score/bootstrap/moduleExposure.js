/* 职责：暴露模块接口并汇总就绪状态。isCurrent 阻止卸载后异步写入。 */
import { reg } from '../foundation/runtime/registry.js';
import { log } from '../foundation/diag/logger.js';
export function exposeScoreModules(isCurrent) {
	/* ★ 补全接口挂载到 window.__DJSC（★ P1-24：每个回调先校验代际，卸载后不再挂载） */
	try {
		window.__DJSC = window.__DJSC || {};
		/* 反馈统计 */
		import('../perception/feedback/feedback.js').then(function (m) {
			if (!isCurrent()) return;
			window.__DJSC.feedbackStats = m.getFeedbackStats;
		}).catch(function () {});
		/* 决策反馈 */
		import('../decision/feedback/decisionFeedback.js').then(function (m) {
			if (!isCurrent()) return;
			window.__DJSC.decisionFeedbackStats = m.getDecisionFeedbackStats;
		}).catch(function () {});
		/* 自适应状态 */
		import('../decision/tuning/adaptive.js').then(function (m) {
			if (!isCurrent()) return;
			window.__DJSC.adaptiveStatus = m.adaptiveStatus;
		}).catch(function () {});
		/* 记忆存储 */
		import('../perception/memory/memory.js').then(function (m) {
			if (!isCurrent()) return;
			window.__DJSC.memoryStats = m.storeStats;
		}).catch(function () {});
		/* 合法性校验 */
		import('../decision/safety/allyExempt.js').then(function (m) {
			if (!isCurrent()) return;
			m.mountAllyExemptInterface();
		}).catch(function () {});
		/* 校验记录器 */
		import('../decision/safety/guardRecorder.js').then(function (m) {
			if (!isCurrent()) return;
			m.mountGuardRecorderInterface();
		}).catch(function () {});
		/* 自检面板 */
		import('../verification/selfCheck.js').then(function (m) {
			if (!isCurrent()) return;
			window.__DJSC.openSelfCheck = m.openSelfCheck;
		}).catch(function () {});
		/* 模型护栏 */
		import('../view/dashboard/guardPanel.js').then(function (m) {
			if (!isCurrent()) return;
			m.mountModelGuardInterface();
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
			['elementFB', '../perception/feedback/elementFeedback.js'],
			['metaCognition', '../cognition/metaCognition.js'],
			['cognitionLog', '../cognition/log/cognitiveLog.js'],
			['conflict', '../decision/analysis/conflictDetector.js'],
			['calibrator', '../model/calibrate/decisionCalibrator.js'],
			['multiProfile', '../cognition/profile/multiProfile.js'],
			['strategyBus', '../decision/strategy/strategyBus.js'],
			/* ★ 连接性修复：原为 ['replay', '../perception/archive/archive.js']，
			 *   会与 decisionReplay 自挂载的 __DJSC.replay 混为一体（同名不同源）。
			 *   archive 统一走 replayAnalysis（与 engine.js 一致）。 */
			['replayAnalysis', '../perception/archive/archive.js'],
			['weightPersist', '../model/weights/weightPersist.js'],
			/* ★ 连接性修复：原为 ['compare', '../decision/response/compareAI.js']，
			 *   会与 decisionCompare 自挂载的 __DJSC.compare 混为一体。
			 *   compareAI 统一走 compareAI（与 engine.js 一致）。 */
			['compareAI', '../decision/response/compareAI.js'],
			['hotSwap', '../model/net/modelHotSwap.js'],
			['shared', '../perception/knowledge/sharedKnowledge.js'],
			['evolution', '../model/train/evolution.js'],
			/* ★ 连接性修复：原为 ['psychology', '../cognition/reasoning/gameTheory.js']，
			 *   会与 think/psychology.js 自挂载的 __DJSC.psychology 混为一体。
			 *   博弈论统一走 gameTheory 独立命名。 */
			['gameTheory', '../cognition/reasoning/gameTheory.js'],
			['comboChain', '../decision/strategy/comboChain.js'],
			['playerMemory', '../perception/memory/playerMemory.js'],
			['postCheck', '../decision/analysis/postCheck.js'],
			['autoFeature', '../model/features/autoFeature.js'],
			['softMetrics', '../cognition/reasoning/softMetrics.js'],
			['skillTags', '../decision/skills/skillTags.js'],
			['judgeZone', '../decision/cardplay/judgeZone.js'],
			['cardTags', '../knowledge/cards/cardTags.js'],
			['viewAs', '../decision/cardplay/viewAs.js'],
			['cost', '../decision/cardplay/costCalc.js'],
			['aiTools', '../view/panel/aiTools.js'],
			['identity', '../perception/observer/identity.js'],
			['learningOptimizer', '../model/train/learningOptimizer.js'],
			['archiveRecycle', '../model/train/archiveRecycle.js'],   /* ★ 归档离线训练回流：胜利局样本回灌 */
			['decision', '../decision/engine/decisionRegistry.js'],
			['bandit', '../model/train/bandit.js'],
			['discover', '../perception/discover/autoDiscover.js'],
			['modelState', '../model/state/modelLifecycle.js'],
			['strategist', '../decision/strategy/strategist.js'],
			/* ★ 通用架构层（专业级预留） */
			['terms', '../foundation/adapt/terms.js'],
			['profile', '../foundation/adapt/gameProfile.js'],
			['gameLogStore', '../perception/journal/gameLogStore.js'],  /* ★ 对局日志自存库：绕开内核录像 20 条上限 */
			['mergeExport', './mergedDataExport.js'],  /* ★ 合并导出：多类数据合并成 1 个文件（按钮已统一为 exportAllData） */
			['extPoints', '../foundation/runtime/extensionPoints.js'],
			['configSpec', '../foundation/config/configSpec.js'],
			['proReady', '../verification/professionalReadiness.js'],
			/* ★ 连接性修复：事件总线此前从未被挂载（孤立模块）→ 统一走总线暴露 on/emit/off */
			['eventBus', '../foundation/runtime/eventBus.js'],
			['executionGateway', '../decision/execution/executionGateway.js'],
		];
		/* ★ P0-10：收集全部暴露任务，全部 settle 后按结果置 modular 状态与 modularReady */
		const _exposeTasks = [];
		MODULES_TO_EXPOSE.forEach(function ([name, path]) {
			_exposeTasks.push(import(path).then(function (mod) {
				if (!isCurrent()) return;   /* ★ P1-24：卸载后不再暴露 */
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
			if (!isCurrent()) return;   /* ★ P1-24：卸载后不再改写 modular 状态 */
			try {
				const mod = window.__DJSC.modular;
				mod.status = (mod.failed && mod.failed.length) ? 'degraded' : 'ready';
				window.__DJSC.modularReady = (mod.status === 'ready');
				log.info('init', '模块化版 ' + mod.status + '：已暴露 ' + (mod.loaded ? mod.loaded.length : 0) + ' 个模块' + ((mod.failed && mod.failed.length) ? '，失败 ' + mod.failed.length + ' 个 [' + mod.failed.join('；') + ']' : ''));
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
