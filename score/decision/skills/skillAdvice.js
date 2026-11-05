/* 职责：根据同一标签和画像派生技能规则、阶段、分支、连招与建议。 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js';
import { scoreSkill } from './skillRules.js';
import { skillTagsOf, _classifySkill, _findParent } from './skillSourceTags.js';
import { skillProfileOf, aggregateSkillTags, _sixDimScores, _ctxOf } from './skillProfiles.js';
/* 占位函数（保持兼容） */
export function buildAutoSkillRules() { _autoRuleCacheSafe(); return _AUTO_RULES; }
export function charComboOf(name) { return _charCombo(name); }
export function skillRuleOf(sid) { return _ruleOf(sid); }
export function skillBranchesOf(sid) { return _branchesOf(sid); }
export function checkBranch(sid, me) { return _checkBranch(sid, me); }
export function skillStagesOf(sid) { return _stagesOf(sid); }
export function skillInteractionOf(sid) { return _interactionOf(sid); }
export function detectCombo(me) { return _detectCombo(me); }
export function miniFeatures(me) { return _miniFeatures(me); }
export function advice(sid, me) { return _advice(sid, me); }

/* ============================================================
 * ★ 扩展点实现（技能分支 / 阶段 / 联动 / 连招 / 配合策略）
 * ------------------------------------------------------------
 * 这些数据全部由「已扫描到的本体标签」派生，不再返回空值。
 * 复用 skillTagsOf / skillProfileOf / scoreSkill 结果，避免 O(N) 重复扫描。
 * ============================================================ */

/* ---- 自动策略规则缓存（buildAutoSkillRules 返回对象，以 ID 为键） ---- */
let _AUTO_RULES = null;
let _AUTO_RULES_TS = 0;
const _AUTO_RULE_TTL = 15000;

function _autoRuleCacheSafe() {
	try {
		const now = Date.now();
		if (_AUTO_RULES && now - _AUTO_RULES_TS < _AUTO_RULE_TTL) return _AUTO_RULES;
		const rules = {};
		const libSkill = lib.skill || {};
		for (const sid in libSkill) {
			try {
				if (_classifySkill(sid, libSkill[sid]) !== 'real') continue;
				const profile = skillProfileOf(sid);
				if (!profile) continue;
				const p = profile.profit || {};
				const tags = profile.tags || {};
				if (!tags || Object.keys(tags).length === 0) continue;
				/* 仅收录有正收益或明确方向的可执行策略 */
				const dims = (p.multi && p.multi.dims) || {};
				const kind = _skillKind(tags);
				if (!kind) continue;
				rules[sid] = {
					cond: _branchCondText(sid, profile),
					w: Math.max(1, Math.min(3, Math.round(Math.abs(p.base) + 0.5))),
					kind: kind,
				};
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}
		_AUTO_RULES = rules;
		_AUTO_RULES_TS = now;
		return rules;
	} catch (e) { return {}; }
}

/* 技能主类（供规则/风格命名） */
function _skillKind(tags) {
	try {
		const score = { damage: 2, control: 1.5, draw: 1.5, sustain: 1.8, defense: 1.6, support: 1.4, burst: 1.7 };
		let best = null, bestV = 0;
		if ((tags.damage || 0) + (tags.atk || 0) + (tags.burst || 0) > 1) {
			const v = score.damage * (1 + (tags.damage || 0));
			if (v > bestV) { bestV = v; best = 'damage'; }
		}
		if ((tags.turnOver || 0) + (tags.ctrl || 0) + (tags.skip || 0) > 0.5) {
			const v = score.control * (1 + (tags.ctrl || 0));
			if (v > bestV) { bestV = v; best = 'control'; }
		}
		if ((tags.draw || 0) + (tags.gain || 0) > 0.5) {
			const v = score.draw * (1 + (tags.draw || 0));
			if (v > bestV) { bestV = v; best = 'draw'; }
		}
		if ((tags.recover || 0) > 0) {
			const v = score.sustain * (1 + (tags.recover || 0));
			if (v > bestV) { bestV = v; best = 'sustain'; }
		}
		if ((tags.def || 0) + (tags.judge || 0) > 0.5) {
			const v = score.defense * (1 + (tags.def || 0));
			if (v > bestV) { bestV = v; best = 'defense'; }
		}
		if ((tags.teamAid || 0) + (tags.recover || 0) + (tags.aux || 0) > 0.5 && !best) {
			best = 'support';
		}
		return best;
	} catch (e) { return null; }
}

/* 单条自动规则的人类可读触发条件文本 */
function _branchCondText(sid, profile) {
	try {
		const cond = profile.timing && profile.timing.condition;
		const phase = profile.timing && profile.timing.phase;
		if (cond === '濒死') return '濒死时机触发，救援/反杀收益最大化';
		if (cond === '低血') return '低血（≤2）时可判发动，残血更值';
		if (cond === '已受伤') return '受伤后触发，反击或止损';
		if (cond === '响应') return '响应时机（闪/无懈）后可触发';
		if (cond === '出牌') return '出牌阶段主动发动';
		const LABEL = { phaseUse: '出牌阶段', phaseDraw: '摸牌阶段', phaseZhunbei: '准备阶段', phaseDiscard: '弃牌阶段', phaseJieshu: '结束阶段', passive: '被动触发', dying: '濒死时机', damageAfter: '伤害后', judge: '判定阶段' };
		return (LABEL[phase] || '按时机') + '内发动';
	} catch (e) { return '按时机发动'; }
}

/* 单个技能规则（手动 SKILL_RULE 已由外部 value-tables 提供，这里返回自动派生） */
function _ruleOf(sid) {
	try {
		return _autoRuleCacheSafe()[sid] || null;
	} catch (e) { return null; }
}

/* ---- 条件分支：由时机/频率/风险派生 ---- */
function _branchesOf(sid) {
	try {
		const profile = skillProfileOf(sid);
		if (!profile) return { branches: [] };
		const p = profile.profit || {};
		const tags = profile.tags || {};
		const dims = (p.multi && p.multi.dims) || {};
		const branches = [];
		const add = function (cond, bonus, risky, limited) {
			branches.push({ cond: cond, bonus: Math.round(bonus * 100) / 100, risky: !!risky, limited: !!limited });
		};

		/* 时机分支 */
		const phase = profile.timing && profile.timing.condition;
		if (phase === '濒死') add('濒死单位时发动（救援收益最大化）', 1.4, false, false);
		else if (phase === '低血') add('自体力 / 目标体力越低收益越高', tags.recover ? 1.2 : 0.9, true, false);
		else if (phase === '已受伤') add('受伤后发动（反击/过牌时机集中）', 1.1, false, false);
		else if (phase === '响应') add('响应时机（闪/无懈后触发）', 1.1, false, false);

		/* 风险/频率分支 */
		if (dims.risk === 'judge') add('判定成功收益，可被改判放大', 1.0, true, false);
		if (dims.risk === 'compare') add('拼点收益，手牌大点更稳', 0.8, true, false);
		if (dims.frequency === 'limit') add('限定技：整局一次，选关键时机使用', 2.0, false, true);
		if (dims.frequency === 'awaken') add('觉醒技：达成条件自动觉醒，收益强化', 1.8, false, true);

		/* 代价分支 */
		if (Math.abs(tags.costHp || 0) > 0 || Math.abs(tags.loseHp || 0) > 0) {
			add('需扣体力，残血/濒死慎发', 0, true, false);
		}
		if (Math.abs(tags.selfDiscard || 0) > 0) {
			add('需弃手牌，保留关键牌再发', 0.2, false, false);
		}
		if (Math.abs(tags.selfTurnOver || 0) > 0 || Math.abs(tags.selfLink || 0) > 0) {
			add('自身翻面/横置，控制节奏后发', 0.5, true, false);
		}
		if (!branches.length) {
			add('时机自由，进入出牌阶段普遍可用', 0.8, false, false);
		}
		return { branches: branches };
	} catch (e) { return { branches: [] }; }
}

/* 当前局面是否满足某分支（简化：濒死/低血/风险维度） */
function _checkBranch(sid, me) {
	try {
		const profile = skillProfileOf(sid);
		if (!profile) return true;
		const ctx = _ctxOf(me);
		const condPhases = profile.timing && profile.timing.condition;
		if (condPhases === '濒死') return !!ctx.dying;
		if (condPhases === '低血') return ctx.lowHp;
		return true;
	} catch (e) { return true; }
}

/* ---- 阶段拆解（前置 cost / 核心 effect / 后续 after）---- */
function _stagesOf(sid) {
	try {
		const profile = skillProfileOf(sid);
		const stages = { cost: { ops: [] }, effect: { ops: [] }, after: { ops: [] } };
		if (!profile) return stages;
		const multi = profile.profit && profile.profit.multi;
		if (!multi) return stages;
		(multi.breakdown || []).forEach(function (b) {
			if (b.kind === 'cost') stages.cost.ops.push({ label: b.label, score: b.score });
			else if (b.kind === 'effect') stages.effect.ops.push({ label: b.label, score: b.score });
		});
		/* 残余效果（若有标记/加技能）归入 after */
		const tags = profile.tags || {};
		if ((tags.mark || 0) > 0) stages.after.ops.push({ label: '标记/资源积累', score: tags.mark });
		if ((tags.addSkill || 0) > 0) stages.after.ops.push({ label: '获得技能（长期生效）', score: tags.addSkill });
		return stages;
	} catch (e) { return { cost: { ops: [] }, effect: { ops: [] }, after: { ops: [] } }; }
}

/* ---- 技能联动（团队标签 + 已知组合）---- */
const _COMBO_PAIRS = [
	{ a: 'yingzi', b: ['wusheng', 'baobian', 'liegong', 'kongcheng'], name: '英姿+输出', bonus: 1.5 },
	{ a: 'jizhi', b: ['guicai', 'qixi', 'guose', 'wuxie'], name: '集智+控场', bonus: 1.5 },
	{ a: 'leiji', b: ['jizhi'], name: '雷击+集智', bonus: 1.6 },
	{ a: 'qingnang', b: ['renxin', 'huatuo', 'yiji'], name: '青囊+救援', bonus: 1.4 },
	{ a: 'wangxi', b: ['ganglie', 'fankui', 'jianxiong'], name: '忘隙+反击', bonus: 1.5 },
	{ a: 'luoyi', b: ['wusheng', 'liegong'], name: '裸衣+输出', bonus: 1.5 },
	{ a: 'qiaobian', b: ['shensu', 'luoshen'], name: '巧变+节奏', bonus: 1.4 },
];
function _interactionOf(sid) {
	try {
		const interactions = [];
		const parent = _findParent(sid) || sid;
		_COMBO_PAIRS.forEach(function (p) {
			if (p.a === parent || p.a === sid) {
				p.b.forEach(function (b) {
					if (lib.skill[b]) interactions.push({ with: b, name: p.name, bonus: p.bonus });
				});
			} else if (p.b.indexOf(parent) >= 0 || p.b.indexOf(sid) >= 0) {
				if (lib.skill[p.a]) interactions.push({ with: p.a, name: p.name, bonus: p.bonus });
			}
		});
		/* 团队联动标签 */
		const tags = skillTagsOf(sid);
		if ((tags.teamGain || 0) > 0) interactions.push({ with: '队友', name: '团队收益', bonus: 1.2 });
		if ((tags.teamAid || 0) > 0) interactions.push({ with: '濒死队友', name: '救援', bonus: 1.6 });
		if ((tags.teamChain || 0) > 0) interactions.push({ with: '队友', name: '技能联动', bonus: 0.9 });
		return { interactions: interactions };
	} catch (e) { return { interactions: [] }; }
}

/* ---- 武将级连招：聚合武将全部技能后的互补组合 ---- */
/* ---- 连招检测缓存：me.skills 引用不变则复用，避免 bestAction 每决策重算 ---- */
const _COMBO_CACHE = new WeakMap();
function _detectCombo(me) {
	try {
		const out = [];
		if (!me) return out;
		const skills = me.skills || [];
		/* ★ 缓存命中：技能列表引用不变（本决策内）直接复用，杜绝每决策 O(技能聚合) 重算 */
		const hit = _COMBO_CACHE.get(me);
		if (hit && hit.skills === skills) return hit.value;
		if (skills.length < 2) { _COMBO_CACHE.set(me, { skills: skills, value: out }); return out; }
		/* 分类汇总标签便于判断互补 */
		const agg = aggregateSkillTags(skills);
		const hasDraw = (agg.draw || 0) > 0.5;
		const hasDmg = (agg.damage || 0) + (agg.atk || 0) > 0.8;
		const hasCtrl = (agg.turnOver || 0) + (agg.ctrl || 0) + (agg.skip || 0) > 0.4;
		const hasRecover = (agg.recover || 0) > 0;
		if (hasDraw && hasDmg) out.push({ name: '过牌+输出', bonus: 1.6 });
		if (hasCtrl && hasDmg) out.push({ name: '控制+收割', bonus: 1.5 });
		if (hasDraw && hasCtrl) out.push({ name: '过牌+控场', bonus: 1.4 });
		if (hasRecover && hasDmg) out.push({ name: '续航+输出', bonus: 1.5 });
		/* 已知两两组合 */
		const owned = {};
		skills.forEach(function (s) { owned[_findParent(s) || s] = true; });
		if (owned['yingzi'] && owned['jizhi']) out.push({ name: '英姿+集智', bonus: 1.5 });
		if (owned['leiji'] && (owned['jizhi'] || owned['guicai'])) out.push({ name: '雷击改判', bonus: 1.6 });
		if (owned['jiushi'] && (owned['sha'] || owned['wusheng'])) out.push({ name: '酒+连杀', bonus: 1.4 });
		if ((owned['qixi'] || owned['guohe']) && owned['guhuo']) out.push({ name: '拆牌+蛊惑', bonus: 1.3 });
		/* 去重 */
		const seen = {};
		const result = out.filter(function (c) {
			if (seen[c.name]) return false;
			seen[c.name] = true;
			return true;
		});
		/* ★ 写缓存：以 me 为键、skills 引用为失效依据 */
		try { _COMBO_CACHE.set(me, { skills: skills, value: result }); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		return result;
	} catch (e) { return []; }
}

/* ---- 武将配合策略：主风格 + 建议 ---- */
/* ★ 武将配合策略缓存：lib.character[name] 局内不变，按 name 缓存结果避免重复改编组 */
const _CHAR_COMBO_CACHE = new Map();
function _charCombo(name) {
	try {
		if (!name) return null;
		/* ★ 缓存命中 */
		try {
			const cHit = _CHAR_COMBO_CACHE.get(name);
			if (cHit) return cHit;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		const char = lib.character && lib.character[name];
		if (!char) return null;
		const skills = Array.isArray(char) ? (char[3] || []) : (char.skills || []);
		if (!skills.length) return null;
		const agg = aggregateSkillTags(skills);
		const s = _sixDimScores(agg);
		/* 主风格 */
		let style = '均衡';
		let max = 0;
		const cand = [
			{ k: 'attack', label: '爆', v: (s.damage || 0) },
			{ k: 'control', label: '控', v: (s.control || 0) },
			{ k: 'draw', label: '过牌', v: (s.draw || 0) },
			{ k: 'sustain', label: '回血', v: (s.recover || 0) },
			{ k: 'defense', label: '防', v: (s.defense || 0) },
		];
		cand.forEach(function (c) { if (c.v > max) { max = c.v; style = c.label; } });
		/* 建议 */
		let advice = '';
		if (style === '爆') advice = '优先集火无闪脆皮，攒输出一波带走';
		else if (style === '控') advice = '盯紧高威胁敌方，先拆输出核心再收割';
		else if (style === '过牌') advice = '靠过牌滚雪球，苟住节奏拖后期';
		else if (style === '回血') advice = '保血线、救队友，打消耗战';
		else if (style === '防') advice = '先稳防守，等敌方空档再反打';
		else advice = '均衡发育，随局做关键决策';
		const result = { style: style, advice: advice };
		/* ★ 写缓存（上限裁剪防无限增） */
		try { if (_CHAR_COMBO_CACHE.size < 2048) _CHAR_COMBO_CACHE.set(name, result); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		return result;
	} catch (e) { return null; }
}

/* ---- 精简特征（供前端快速展示，可选）---- */
const _MINI_CACHE = new WeakMap();
function _miniFeatures(me) {
	try {
		if (!me) return null;
		/* ★ 缓存命中：me 引用不变（局内同一角色）复用一个 skill 数组 */
		const mHit = _MINI_CACHE.get(me);
		if (mHit) return mHit;
		const skills = me.skills || [];
		const agg = aggregateSkillTags(skills);
		const s = _sixDimScores(agg);
		const result = {
			skills: skills.length,
			atk: Math.round(s.damage * 10) / 10,
			ctrl: Math.round(s.control * 10) / 10,
			draw: Math.round(s.draw * 10) / 10,
			sustain: Math.round(s.recover * 10) / 10,
			def: Math.round(s.defense * 10) / 10,
			use: Object.keys(s).length > 0,
		};
		/* ★ 写缓存：me 为键、WeakMap 随玩家对象回收 */
		try { _MINI_CACHE.set(me, result); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		return result;
	} catch (e) { return null; }
}

/* ---- 中文建议（结合技能核心 + 当前局面）---- */
function _advice(sid, me) {
	try {
		const profile = skillProfileOf(sid);
		if (!profile) return '技能未识别，暂时无法给出建议';
		const p = profile.profit || {};
		const tags = profile.tags || {};
		const base = p.base || 0;
		const kind = _skillKind(tags);
		const ctx = _ctxOf(me);
		let text = '';
		if (kind === 'damage') text = '想扩展优势时优先发动，打敌方低血/无防守目标';
		else if (kind === 'control') text = '用于打断敌方节奏，优先对高威胁目标发动';
		else if (kind === 'draw') text = '稳定过牌，滚雪球建立资源差';
		else if (kind === 'sustain') text = '己方或队友低血时优先救援';
		else if (kind === 'defense') text = '以守为攻，生存优先';
		else if (kind === 'support') text = '配合队友打出团队收益';
		else text = '根据场上节奏灵活决定';
		if (base >= 3) text += '（该技能收益很高，值得重点储备时机）';
		if (ctx.dying || ctx.lowHp) text += '；当前血线偏低，注意保命';
		return text;
	} catch (e) { return ''; }
}


export function clearSkillAdviceCache() { _CHAR_COMBO_CACHE.clear(); }
