/* 职责：挂载扩展面板入口、汇总失败；不启动引擎。 */
import { VERSION } from '../../../js/config/version.js';
/* ★ 挂载全部 24 个面板到 window.__DJSC（扩展一加载就挂载好）
 * ★ P1-30：单个面板 import 失败不再被静默吞掉——Promise.allSettled 汇总，
 *   成功/失败计数与失败面板名单都打到日志，杜绝"失败了仍打印全部挂载完成"的假成功。 */
export async function mountAllPanels() {
	const failed = [];
	try {
		window.__DJSC = window.__DJSC || {};

		/* panel.js里的13个面板（同一模块，整体失败记 1 项） */
		const panel = await import('../../view/panel/panel.js');
		window.__DJSC.openScorePanel = panel.openScorePanel;
		window.__DJSC.openScoreDetailPanel = panel.openScoreDetailPanel;
		window.__DJSC.openPlanPanel = panel.openPlanPanel;
		window.__DJSC.openFeedbackPanel = panel.openFeedbackPanel;
		window.__DJSC.openArchivePanel = panel.openArchivePanel;
		window.__DJSC.openRecommendPanel = panel.openRecommendPanel;
		window.__DJSC.openConfigPanel = panel.openConfigPanel;
		window.__DJSC.openMemoryPanel = panel.openMemoryPanel;
		window.__DJSC.openSkillPanel = panel.openSkillPanel;
		window.__DJSC.openOverridePanel = panel.openOverridePanel;
		window.__DJSC.openSkillBreakdownPanel = panel.openSkillBreakdownPanel;
		window.__DJSC.openSkillCustomPanel = panel.openSkillCustomPanel;
		window.__DJSC.openHealthPanel = panel.openHealthPanel;

		/* 其他文件里的11个面板：逐个独立挂载，失败记录名单 */
		const dyn = [
			['openBrainDashboard', '../../view/dashboard/brainDashboard.js'],
			['openCalibratorPanel', '../dashboard/calibratorPanel.js'],
			['openComparePanel', '../../view/dashboard/comparePanel.js'],
			['openDecisionDashboard', '../../view/dashboard/decisionDashboard.js'],
			['openExportPanel', '../dashboard/exportPanel.js'],
			['openGuardPanel', '../dashboard/guardPanel.js'],
			['openProfilerPanel', '../../foundation/diag/profiler.js'],
			['openReplayPanel', '../../view/dashboard/replayPanel.js'],
			['openSelfCheck', '../../verification/selfCheck.js'],
			['openSmartPanel', '../../view/panel/smartPanel.js'],
			['openChampionPanel', '../../view/dashboard/championPanel.js'],
		];
		const results = await Promise.allSettled(dyn.map(function (d) {
			return import(/* webpackIgnore: true */ d[1]).then(function (m) {
				if (typeof m[d[0]] !== 'function') throw new Error('导出缺失: ' + d[0]);
				window.__DJSC[d[0]] = m[d[0]];
			});
		}));
		results.forEach(function (r, i) {
			if (r.status === 'rejected') failed.push(dyn[i][0]);
		});

		const loaded = 24 - failed.length;
		console.log('%c[无名AI v' + VERSION + '] ✅ 扩展加载完成！', 'color: #00d4ff; font-weight: bold;');
		console.log('%c作者: 飞升原创 | 交流群: 1080487560', 'color: #aaa; font-size: 10px;');
		/* ★ P1-29：面板实为 24 个（13 + 11），日志与数量口径对齐 */
		if (failed.length) {
			console.warn('[无名AI] ⚠️ 面板挂载 ' + loaded + '/24 完成，失败 ' + failed.length + ' 个：' + failed.join('、'));
		} else {
			console.log('%c[无名AI] ✅ 所有24个面板挂载完成！', 'color: #0f0;');
		}
	} catch(e) {
		console.error('[无名AI] ❌ 面板挂载失败:', e);
		try { if (window.__DJSC && window.__DJSC.reportUnexpected) window.__DJSC.reportUnexpected('extension.mountAllPanels', '面板整体挂载失败', e); } catch (_) {}
	}
}
