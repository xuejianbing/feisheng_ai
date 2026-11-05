/*
 * ============================================
 * // Autor: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 技能识别插件（核心示范 #3） =================
 * 把技能扫描/识别生命周期包装成插件。
 * 展示：type=scorer（能力分类）、对局生命周期 onStart 重置扫描缓存、props 软合并技能接口。 */
import { definePlugin, registerPlugin, pluginState } from '../foundation/runtime/plugins.js';
import { scanReset, aggregateSkillTags, detectCombo, charComboOf, buildAutoSkillRules, scanCharacters } from '../decision/skills/skills.js';
import { scanObjectMethod } from '../decision/skills/skillScanner.js';
import { resetComboChain, learnedChains } from '../decision/strategy/comboChain.js';

/* 技能接口挂到 __DJSC.skills */
const skillProps = {
	skills: {
		scanReset: scanReset,
		aggregate: function () { return aggregateSkillTags; },
		detectCombo: detectCombo,
		charComboOf: charComboOf,
		autoRules: function () { return buildAutoSkillRules(); },
		scanCharacters: scanCharacters,
		scanObjectMethod: scanObjectMethod,
		comboReset: resetComboChain,   /* ★ 连招学习·每局重置并加载持久化 */
		learnedChains: learnedChains,  /* ★ 连招学习·查询 */
	},
};

const skillPlugin = definePlugin({
	id: 'djsc.skills',
	name: '技能识别与推荐',
	version: '1.0.0',
	type: 'scorer',
	desc: '技能源码扫描 / 标签聚合 / 连招与配合策略推荐',
	depends: ['djsc.engine'],
	tags: ['core', 'skills', 'scanner'],
	props: skillProps,
	onInstall: function () {},
	onUninstall: function () {},
	onStart: function () {
		/* 每局开局重置扫描缓存，避免技能缓存跨局串味 */
		try { scanReset(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		/* ★ 连招学习：每局重置临时权重，并加载持久化学习连招 */
		try { resetComboChain(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	},
});

/* ★ P0-02：注册与安装分离——import 阶段只登记不安装 */
registerPlugin(skillPlugin, { install: false });

/* 供外部查询插件状态 */
export function getSkillPlugin() { return pluginState('djsc.skills'); }