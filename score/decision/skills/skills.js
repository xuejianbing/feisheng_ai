/* 既有技能公共入口：统一转出各职责模块并保留原全局桥。缓存不存放在此。 */
import { lib } from '../../foundation/adapt/host.js';
import { skillTagsOf, _collectSource, clearSkillTagCache } from './skillSourceTags.js';
export { skillTagsOf, _collectSource };
import { classifySkill, skillProfileOf, codeGainOf, codeGainAllOf, scanCharacters, aggregateSkillTags, sixDimEnemyAlly, skillProfitBreakdown, clearSkillProfileCache } from './skillProfiles.js';
export { classifySkill, skillProfileOf, codeGainOf, codeGainAllOf, scanCharacters, aggregateSkillTags, sixDimEnemyAlly, skillProfitBreakdown };
import { buildAutoSkillRules, charComboOf, skillRuleOf, skillBranchesOf, checkBranch, skillStagesOf, skillInteractionOf, detectCombo, miniFeatures, advice, clearSkillAdviceCache } from './skillAdvice.js';
export { buildAutoSkillRules, charComboOf, skillRuleOf, skillBranchesOf, checkBranch, skillStagesOf, skillInteractionOf, detectCombo, miniFeatures, advice };
import { renderSixDimEnemyAlly, renderSkillBreakdownText } from '../../view/report/skillPresentation.js';
export { renderSixDimEnemyAlly, renderSkillBreakdownText };
export function clearGainCache() {
	try { clearSkillTagCache(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { clearSkillProfileCache(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 清空按 name 的武将配合策略缓存（Map 可 clear）。
	 * 其余派生缓存均为 WeakMap（以 skills 数组 / me 对象为键），
	 * 靠引用失效 + 垃圾回收自动回收，无需手动清理。 */
	try { clearSkillAdviceCache(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
export function scanReset() { clearGainCache(); }


/* ★ 暴露模块引用，供 strategist 动态访问（避免顶层循环依赖） */
try {
	if (lib) {
		lib.__djsc_skillsModule = {
			skillProfileOf: skillProfileOf,
			skillTagsOf: skillTagsOf,
			classifySkill: classifySkill,
			skillProfitBreakdown: skillProfitBreakdown,
			renderSkillBreakdownText: renderSkillBreakdownText,
			sixDimEnemyAlly: sixDimEnemyAlly,
			renderSixDimEnemyAlly: renderSixDimEnemyAlly,
			_collectSource: _collectSource,           // ★ 暴露扫描函数
		};
	}
	/* 同时挂到 window，供调试桥使用 */
	if (typeof window !== 'undefined') {
		window.__DJSC_COLLECT_SOURCE = _collectSource;
	}
} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
