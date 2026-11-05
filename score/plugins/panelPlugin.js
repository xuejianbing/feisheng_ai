/*
 * ============================================
 * // Autor: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 面板插件（核心示范 #2） =================
 * 把调试桥/面板/对话框守护包装成标准插件。
 * 展示：type=panel、props 软合并（把面板接口挂到 __DJSC.panel）、onInstall/onUninstall 对称清理。 */
import { definePlugin, registerPlugin, pluginState } from '../foundation/runtime/plugins.js';
import { openScorePanel, installDebugBridge, uninstallDebugBridge, startDialogGuard, stopDialogGuard } from '../view/panel/panel.js';

/* props：挂到 __DJSC.panel 命名空间的键（经 registry.bind 软合并，只补缺失） */
const panelProps = {
	panel: {
		open: function () { try { openScorePanel(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } },
	},
};

const panelPlugin = definePlugin({
	id: 'djsc.panel',
	name: '面板与调试桥',
	version: '1.0.0',
	type: 'panel',
	desc: '决策积分面板、调试桥、对话框守卫',
	depends: ['djsc.engine'],
	tags: ['core', 'panel', 'view'],
	props: panelProps,
	onInstall: function () {
		try { installDebugBridge(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		try { startDialogGuard(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	},
	onUninstall: function () {
		try { stopDialogGuard(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		try { uninstallDebugBridge(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	},
});

/* ★ P0-02：注册与安装分离——import 阶段只登记不安装（避免 decisionScore=false 也提前装 debug bridge / dialog guard） */
registerPlugin(panelPlugin, { install: false });

/* 供外部查询插件状态 */
export function getPanelPlugin() { return pluginState('djsc.panel'); }