import { ok, eq, finish } from './_harness.mjs';
import {
	CHARACTER_ARCHETYPE,
	buildCharacterPolicyCore,
	characterCardAffinity,
	characterSkillAffinity,
	characterFuelKeepBonus,
} from '../../score/decision/strategy/characterPolicyCore.js';

function sig(id, tags, phases) {
	return { id, tags: tags || {}, phases: phases || [] };
}

/* 进攻/爆发同系：不应因分数接近被误判成HYBRID。 */
const assault = buildCharacterPolicyCore({
	heroId: 'attackHero',
	signals: [
		sig('attack_a', { atk: 1.8, burst: 0.8 }, ['phaseUse']),
		sig('attack_b', { atk: 0.8, viewAs: 1.4 }, ['chooseToUse']),
	],
});
eq(assault.archetype.primary, CHARACTER_ARCHETYPE.ASSAULT,
	'10.64 进攻+爆发同系画像保持ASSAULT主型');
ok(assault.dimensions.offense > assault.dimensions.control,
	'10.64 进攻武将offense维度高于control');
ok(assault.archetype.secondary.includes(CHARACTER_ARCHETYPE.BURST),
	'10.64 进攻武将保留BURST副画像');

/* 控制武将。 */
const control = buildCharacterPolicyCore({
	heroId: 'controlHero',
	signals: [
		sig('ctrl_a', { ctrl: 1.8, discardEnemy: 1.2, skip: 0.8 }, ['phaseUse']),
		sig('ctrl_b', { judge: 1.2, ctrl: 1.0 }, ['judge']),
	],
});
eq(control.archetype.primary, CHARACTER_ARCHETYPE.CONTROL,
	'10.64 控制技能组识别CONTROL画像');
ok(control.resource.controlFuel > control.resource.attackFuel,
	'10.64 控制武将更重视控制燃料');

/* 支援/续航同系。 */
const sustain = buildCharacterPolicyCore({
	heroId: 'supportHero',
	signals: [
		sig('heal_a', { sustain: 2.0, recover: 1.5, teamAid: 0.8 }, ['phaseUse']),
		sig('heal_b', { aux: 1.5, teamGain: 1.0, giveCard: 0.8 }, ['phaseUse']),
	],
});
ok(
	sustain.archetype.primary === CHARACTER_ARCHETYPE.SUSTAIN ||
	sustain.archetype.primary === CHARACTER_ARCHETYPE.SUPPORT,
	'10.64 支援/续航技能组识别同系画像'
);
ok(sustain.resource.healFuel > 0.35, '10.64 治疗武将生成桃资源燃料');
ok(sustain.resource.nullificationFuel > 0.20, '10.64 支援武将提高无懈资源价值');

/* 受伤收益与主动卖血：只提高安全血线换血容忍，不取消低血保护。 */
const sacrifice = buildCharacterPolicyCore({
	heroId: 'bloodHero',
	signals: [
		sig('damaged_gain', { draw: 1.2, sustain: 0.8 }, ['damaged']),
		sig('self_cost', { costHp: 1.6, draw: 1.0 }, ['phaseUse']),
	],
});
ok(sacrifice.dimensions.damageBenefit > 0.20, '10.64 识别受伤后正收益');
ok(sacrifice.resource.hpSpendTolerance > 0.25, '10.64 卖血收益形成有界换血容忍');

const costSignal = sig('self_cost', { costHp: 1.6, draw: 1.0 }, ['phaseUse']);
const healthyCost = characterSkillAffinity(sacrifice, costSignal, 0.75);
const lowHpCost = characterSkillAffinity(sacrifice, costSignal, 0.20);
ok(healthyCost.delta > lowHpCost.delta,
	'10.64 同一卖血技能在健康血线比1血/低血更积极');
ok(lowHpCost.delta <= 0,
	'10.64 低血时画像不得鼓励自损');

/* 画像只提供有界软偏好。 */
const shaAffinity = characterCardAffinity(assault, 'sha');
ok(shaAffinity.delta > 0 && shaAffinity.delta <= 0.18,
	'10.64 进攻画像对杀提供有界软加成');
const ctrlSha = characterCardAffinity(control, 'sha');
ok(shaAffinity.delta > ctrlSha.delta,
	'10.64 不同武将对同一张杀产生不同普通utility偏好');

/* 核心燃料：进攻武将留杀/酒，控制武将留控制牌，支援武将留桃/无懈。 */
const assaultShaFuel = characterFuelKeepBonus(assault, 'sha');
const assaultShanFuel = characterFuelKeepBonus(assault, 'shan');
ok(assaultShaFuel.value > assaultShanFuel.value,
	'10.64 进攻武将更重视杀作为燃料');
ok(characterFuelKeepBonus(control, 'guohe').value > 0,
	'10.64 控制武将保留控制锦囊燃料');
ok(characterFuelKeepBonus(sustain, 'tao').value > 0,
	'10.64 续航武将提高桃的保留价值');
ok(characterFuelKeepBonus(sustain, 'wuxie').value > 0,
	'10.64 支援武将提高无懈保留价值');

/* 未识别/空技能组必须安全退化。 */
const blank = buildCharacterPolicyCore({ heroId: 'blank', signals: [] });
eq(blank.archetype.primary, CHARACTER_ARCHETYPE.HYBRID,
	'10.64 空技能组安全退化HYBRID');
eq(characterCardAffinity(blank, 'sha').delta, 0,
	'10.64 空画像不凭空改变卡牌价值');

finish('character_policy');
