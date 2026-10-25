/*
 * ============================================
 * // Autor: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 插件索引 =================
 * 集中 import 所有插件模块（每个模块内部自注册）。
 * index.js 只需 import 本索引即完成插件系统装载；
 * 新增功能 = 在 score/plugins/ 下新建 1 个插件文件并在此登记 1 行 import。 */
import './enginePlugin.js?v=41a';
import './panelPlugin.js?v=41a';
import './skillPlugin.js?v=41a';
import './cognitionPlugin.js?v=41a';   /* ★ 新增功能示范：运行时情报中心 */
/* ★ 新增插件在此追加一行：import './myPlugin.js'; */

import { installAllPlugins, uninstallAllPlugins, listPlugins, installedCount, pluginCount, scan, pluginState } from '../foundation/runtime/plugins.js?v=41a';

/* 收集所有插件并返回状态清单
 * ★ P0-02：安装统一在此触发（installScoreEngine 调用本函数），import 阶段不再自动安装 */
export function loadPlugins() {
	installAllPlugins();   /* 按依赖拓扑序统一安装（跳过已 installed） */
	scan();                /* 触发一次生命周期广播（幂等） */
	return listPlugins();
}

/* ★ P0-02：转发统一卸载（uninstallScoreEngine 使用） */
export { installAllPlugins, uninstallAllPlugins };

export function pluginOverview() {
	return {
		total: pluginCount(),
		installed: installedCount(),
		plugins: listPlugins(),
	};
}

export function getPluginState(id) { return pluginState(id); }

export default { loadPlugins, pluginOverview, getPluginState };
