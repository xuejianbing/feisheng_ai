/*
 * ============================================
 * // Autor: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 新增功能示范插件 =================
 * 【如何新增一个功能】（三步，无需改动 core / index.js）：
 *   1. 在 score/plugins/ 下新建本类文件；
 *   2. 用 definePlugin 声明 id/props/onInstall/onUninstall/生命周期；
 *   3. 在 plugins/index.js 追加一行 import。
 *
 * 本插件示范一个"运行时情报中心"：把插件状态 + 对局关键缓存匿名化展示，
 * 纯只读、零副作用，证明标准协议可独立贡献能力。 */
import { definePlugin, registerPlugin, pluginState, pluginOverview } from '../foundation/runtime/plugins.js';

/* 挂到 __DJSC.cognition 命名空间的只读情报接口 */
const cognitionProps = {
	cognition: {
		pluginStatus: function () { try { return pluginOverview(); } catch (e) { return null; } },
		pluginState: function (id) { try { return pluginState(id); } catch (e) { return null; } },
	},
};

const cognitionPlugin = definePlugin({
	id: 'djsc.cognition',
	name: '运行时情报中心',
	version: '1.0.0',
	type: 'metrics',
	desc: '插件状态与运行情报（只读，示范标准插件贡献独立能力）',
	depends: [],
	tags: ['demo', 'metrics'],
	props: cognitionProps,
	onInstall: function () {},
	onUninstall: function () {},
	onStart: function () {},
	onGameEnd: function () {},
});

/* ★ P0-02：注册与安装分离——import 阶段只登记不安装 */
registerPlugin(cognitionPlugin, { install: false });

/* 供外部查询插件状态 */
export function getCognitionPlugin() { return pluginState('djsc.cognition'); }