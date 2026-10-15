/*
 * ============================================
 * // Autor: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 引擎插件（核心示范） =================
 * 把决策引擎包装成标准插件声明。
 * ★ 渐进式说明：真实 hook 安装仍由 index.js 成熟路径完成（避免双重安装），
 *   插件层负责统一「清单/依赖/生命周期广播/状态」，onInstall 只登记与检查。
 *   后续若取消 index.js 直装，把 installHooks() 移入 onInstall、uninstallHooks() 移入 onUninstall 即可无缝切换。 */
import { definePlugin, registerPlugin, pluginState } from '../foundation/runtime/plugins.js?v=41a';
/* ★ P0-01：补 installHooks 导入——此前未导入导致 onInstall 里 typeof 判断恒失败 → 插件及依赖它的
 *   panelPlugin/skillPlugin 全部被 disabled。 */
import { installHooks, startSettleWatch, clearScoreState } from '../decision/engine/engine.js?v=41a';

const enginePlugin = definePlugin({
	id: 'djsc.engine',
	name: '决策引擎核心',
	version: '1.0.0',
	type: 'engine',
	desc: '决策积分引擎主钩子 + 结算监听（真实安装走 index.js 成熟路径）',
	tags: ['core', 'engine'],
	onInstall: function () {
		/* 校验引擎可用（不重复安装 hook，装由 index.js 负责） */
		if (typeof installHooks !== 'function' || typeof startSettleWatch !== 'function') {
			throw new Error('engine 接口不可用');
		}
	},
	onUninstall: function () {
		/* 渐进式：默认不卸载 index.js 已装的 hook；如需接管见文件头说明 */
	},
	onStart: function () {},
	onGameEnd: function () {
		try { clearScoreState(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	},
});

/* ★ P0-02：注册与安装分离——import 阶段只登记不安装，统一由 installScoreEngine → loadPlugins → installAllPlugins 按拓扑序安装 */
registerPlugin(enginePlugin, { install: false });

/* 供外部查询插件状态 */
export function getEnginePlugin() { return pluginState('djsc.engine'); }