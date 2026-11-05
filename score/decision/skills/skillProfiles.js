/* 职责：从统一标签派生分类、画像、收益拆解和聚合；画像缓存只在此持有。 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js';
import { scoreSkill, deriveDimensions } from './skillRules.js';
import { skillTagsOf, _inferTimingCondition, _emptyTags, MAX_CACHE } from './skillSourceTags.js';
const _PROFILE_CACHE = new Map();
/* ================= 分类（主/副） ================= */
const TYPE_WEIGHTS = {
	draw:    { draw: 1.0, viewAs: 0.3 },
	atk:     { atk: 1.4, burst: 0.5, viewAs: 0.4, enemy: 0.3, damage: 0.8 },
	aoe:     { aoe: 1.8, multi: 0.5, enemy: 0.2 },
	sustain: { sustain: 1.5, ally: 0.4, self: 0.3, recover: 0.6 },
	def:     { def: 1.4, self: 0.3 },
	ctrl:    { ctrl: 1.4, enemy: 0.4, multi: 0.2, turnOver: 0.5, link: 0.4, skip: 0.5 },
	loseCard:{ loseCard: 1.2, ctrl: 0.4, discardEnemy: 0.5 },
	viewAs:  { viewAs: 1.4, self: 0.2 },
	aux:     { aux: 1.4, ally: 0.5, giveCard: 0.6, addSkill: 0.4 },
	costHp:  { costHp: 1.4, self: 0.3 },
	awaken:  { awaken: 1.8 },
	limit:   { limit: 2.0 },
	compare: { compare: 1.6, enemy: 0.3 },
	judge:   { judge: 1.4, ctrl: 0.3 },
};

export function classifySkill(tags) {
	try {
		if (!tags) return { primary: null, secondary: [], all: {} };
		const scores = {};
		for (const type in TYPE_WEIGHTS) {
			let s = 0;
			for (const dim in TYPE_WEIGHTS[type]) {
				s += (tags[dim] || 0) * TYPE_WEIGHTS[type][dim];
			}
			scores[type] = Math.round(s * 100) / 100;
		}
		const sorted = Object.entries(scores)
			.filter(function (e) { return e[1] > 0.1; })
			.sort(function (a, b) { return b[1] - a[1]; });
		if (!sorted.length) return { primary: null, secondary: [], all: scores };
		const primary = sorted[0][0];
		const primaryScore = sorted[0][1];
		const secondary = sorted.slice(1)
			.filter(function (e) { return e[1] >= primaryScore * 0.6; })
			.slice(0, 2)
			.map(function (e) { return e[0]; });
		return { primary, secondary, all: scores };
	} catch (e) {
		return { primary: null, secondary: [], all: {} };
	}
}

/* ================= 综合画像 ================= */
export function skillProfileOf(sid) {
	try {
		const cached = _PROFILE_CACHE.get(sid);
		if (cached) return cached;

		const sk = lib.skill && lib.skill[sid];
		if (!sk) return null;

		const tags = skillTagsOf(sid);

		/* ★ 修复：multiScore.dims.timing 已由多维评分算出，这里据它推 condition，
		 *  不再恒为 null（此前导致 engine 与 skillPlayBrain 的时机判断全部失效）
		 */
		const multiScore = scoreSkill(tags, { sid, skill: sk });
		const timingCond = _inferTimingCondition(sk, tags, multiScore.dims);

		const timing = {
			phase: tags.__phases && tags.__phases[0] ? tags.__phases[0] : 'passive',
			allPhases: tags.__phases || [],
			condition: timingCond,
		};

		const targetCats = tags.__targets || [];
		let category = 'self';
		if (targetCats.indexOf('enemy') >= 0 && targetCats.indexOf('ally') < 0) category = 'enemy';
		else if (targetCats.indexOf('ally') >= 0 && targetCats.indexOf('enemy') < 0) category = 'ally';
		else if (targetCats.indexOf('multi') >= 0 || tags.aoe > 0.5) category = 'all';
		else if (targetCats.length >= 2) category = 'mixed';

		/* ★ 新：多维评分（上面已算 multiScore，直接复用避免重复扫描） */
		const base = multiScore.final;
		const cost = _computeCost(tags);
		const risk = multiScore.dims.risk === 'none' ? 0 : 0.3;

		const cls = classifySkill(tags);

		const profile = {
			id: sid,
			tags,
			timing,
			targets: {
				category,
				priority: _computeTargetPriority(category),
				intent: tags.__targetIntent || null,
				confidence: Number(tags.__targetConfidence || 0),
				inferred: !!tags.__targetInferred,
			},
			profit: (function () {
				const multi = tags.__multi || scoreSkill(tags, { sid: sid, skill: sk });
				return {
					base: multi.final,
					cost: { net: Math.abs(multi.costScore) },
					risk: multi.dims.risk === 'none' ? 0 : 0.3,
					originalBase: multi.final,
					multi: multi,
					effectScore: multi.effectScore,
					costScore: multi.costScore,
					dims: multi.dims,
				};
			})(),
			classify: cls,
		};

		if (_PROFILE_CACHE.size < MAX_CACHE) _PROFILE_CACHE.set(sid, profile);
		return profile;
	} catch (e) { return null; }
}

function _computeBaseProfit(tags) {
	let base = 0;
	/* 新标签 */
	base += (tags.draw || 0) * 1.0;
	base += (tags.gain || 0) * 1.2;
	base += (tags.damage || 0) * 2.0;
	base += (tags.useCard || 0) * 0.8;
	base += (tags.useSkill || 0) * 0.6;
	base += (tags.recover || 0) * 2.0;
	base += (tags.maxHp || 0) * 1.5;
	base += (tags.revive || 0) * 4.0;
	base += (tags.turnOver || 0) * 1.5;
	base += (tags.link || 0) * 1.0;
	base += (tags.skip || 0) * 1.2;
	base += (tags.judgeCard || 0) * 1.2;
	base += (tags.discardEnemy || 0) * 1.2;
	base += (tags.loseEnemy || 0) * 0.8;
	base += (tags.mark || 0) * 0.6;
	base += (tags.addSkill || 0) * 1.0;
	base += (tags.addTempSkill || 0) * 0.8;
	base += (tags.addShan || 0) * 0.5;
	base += (tags.changeHp || 0) * 0.8;
	base += (tags.giveCard || 0) * 1.0;
	base += (tags.judge || 0) * 1.0;
	base += (tags.compare || 0) * 1.2;
	base += (tags.viewAs || 0) * 1.0;
	base += (tags.guanxing || 0) * 0.8;
	base += (tags.topCards || 0) * 0.6;
	/* 旧标签（保留兼容） */
	base += (tags.atk || 0) * 2.0;
	base += (tags.burst || 0) * 1.5;
	base += (tags.aoe || 0) * 3.0;
	base += (tags.sustain || 0) * 2.0;
	base += (tags.def || 0) * 1.5;
	base += (tags.ctrl || 0) * 1.5;
	base += (tags.aux || 0) * 1.0;
	if (tags.limit > 0.5) base += 6;
	if (tags.awaken > 0.5) base += 5;
	if (base > 15) base = 15;
	return Math.round(base * 100) / 100;
}

function _computeCost(tags) {
	const cost = { hp: 0, cards: 0, net: 0 };
	/* 新负收益标签 */
	cost.hp = Math.abs(tags.loseHp || 0) + Math.abs(tags.loseMaxHp || 0) * 0.5;
	cost.cards = Math.abs(tags.selfDiscard || 0) + Math.abs(tags.selfLose || 0);
	/* 旧标签（保留兼容） */
	if (tags.costHp > 0) cost.hp += Math.min(2, tags.costHp * 0.7);
	if (tags.loseCard > 0) cost.cards += Math.min(2, tags.loseCard * 0.5);
	cost.net = cost.hp * 2 + cost.cards;
	return cost;
}

function _computeRisk(tags) {
	let risk = 0;
	if (tags.compare > 0.5) risk += 0.3;
	if (tags.judge > 0.5) risk += 0.15;
	if (tags.costHp > 0.5) risk += 0.3;
	if (tags.aoe > 0.5) risk += 0.2;
	return Math.min(1, Math.round(risk * 100) / 100);
}

function _computeTargetPriority(category) {
	switch (category) {
		case 'enemy': return '最脆或威胁最高';
		case 'ally':  return '主公或濒死队友';
		case 'all':   return '敌方密集区';
		case 'mixed': return '灵活选择';
		default:      return '自身';
	}
}

/* ================= 兼容旧接口 ================= */
export function codeGainOf(sid) {
	try {
		const tags = skillTagsOf(sid);
		return {
			net: (tags.draw || 0) * 1 + (tags.damage || 0) * 2 + (tags.atk || 0) * 2 + (tags.ctrl || 0) * 1.5,
			draw: tags.draw || 0,
			atk: (tags.damage || 0) + (tags.atk || 0),
			ctrl: tags.ctrl || 0,
		};
	} catch (e) { return { net: 0 }; }
}

export function codeGainAllOf(profile) {
	try {
		if (!profile || !profile.skills) return { net: 0 };
		let net = 0;
		profile.skills.forEach(function (sid) {
			try { net += codeGainOf(sid).net || 0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});
		return { net };
	} catch (e) { return { net: 0 }; }
}

export function scanCharacters() {
	try {
		const list = [];
		const chars = lib.character || {};
		for (const id in chars) {
			if (id.startsWith('_') || id.startsWith('gz_')) continue;
			const ch = chars[id];
			const skills = Array.isArray(ch) ? (ch[3] || []) : (ch.skills || []);
			if (!skills.length) continue;
			const sum = { atk: 0, def: 0, draw: 0, ctrl: 0 };
			skills.forEach(function (sid) {
				try {
					const t = skillTagsOf(sid);
					sum.atk += (t.atk || 0) + (t.damage || 0);
					sum.def += t.def || 0;
					sum.draw += t.draw || 0;
					sum.ctrl += t.ctrl || 0;
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			});
			const total = sum.atk + sum.def + sum.draw + sum.ctrl;
			if (total <= 0) continue;
			list.push({
				id,
				hp: Array.isArray(ch) ? ch[2] : (ch.hp || 4),
				tip: 'A' + Math.round(sum.atk * 10) / 10 + ' D' + Math.round(sum.def * 10) / 10 + ' G' + Math.round(sum.draw * 10) / 10,
			});
		}
		return { total: list.length, ext: list.length, cards: list };
	} catch (e) { return { total: 0, ext: 0, cards: [] }; }
}

/* ★ 聚合缓存：同一 skills 数组引用在决策内多次聚合（detectCombo/charCombo/miniFeatures）
 *   共用一次结果，避免重复遍历 skillTagsOf 聚合。WeakMap 以数组为键，GC 自然回收。 */
const _AGG_CACHE = new WeakMap();
export function aggregateSkillTags(skills) {
	/* ★ 缓存命中：skills 引用不变直接复用（返回浅拷贝，避免下游持引用后修改污染共享缓存） */
	try {
		if (skills && skills.length) {
			const hit = _AGG_CACHE.get(skills);
			if (hit) return Object.assign({}, hit);
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	const sum = _emptyTags();
	if (!skills) return sum;
	const keys = ['draw', 'gain', 'damage', 'useCard', 'useSkill', 'recover', 'maxHp', 'revive',
		'turnOver', 'link', 'skip', 'judgeCard', 'discardEnemy', 'loseEnemy',
		'mark', 'addSkill', 'addTempSkill', 'addShan', 'changeHp', 'giveCard',
		'judge', 'compare', 'viewAs', 'guanxing', 'topCards',
		'atk', 'burst', 'aoe', 'sustain', 'def', 'ctrl', 'aux', 'loseCard', 'costHp', 'awaken', 'limit',
		'loseHp', 'loseMaxHp', 'selfDiscard', 'selfLose', 'selfTurnOver', 'selfLink', 'selfRemove',
		/* ★ 新增 */
		'loseEnemyHp', 'loseEnemyMaxHp', 'selfDamage', 'selfSkip', 'selfJudge',
		'feedDraw', 'feedGain', 'feedRecover', 'feedHp', 'feedSkill', 'feedMark',
		'teamGain', 'teamAid', 'teamHurt', 'teamRisk', 'teamChain'];
	skills.forEach(function (sid) {
		try {
			const t = skillTagsOf(sid);
			keys.forEach(function (k) {
				if (typeof t[k] === 'number') sum[k] += t[k];
			});
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	});
	keys.forEach(function (k) {
		if (sum[k] > 3) sum[k] = 3;
		if (sum[k] < -3) sum[k] = -3;
	});
	/* ★ 写缓存 */
	try { if (skills && skills.length) _AGG_CACHE.set(skills, sum); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return sum;
}

/* ============================================================
 * ★ 技能效果六大分类 · 敌我方向 + 黄线不推荐
 * ------------------------------------------------
 * 六大类：摸牌 / 伤害 / 回复 / 控制 / 辅助 / 防御
 * 每个分类标注「敌我方向」：
 *   【我】增益我方（摸牌/回复/辅助/防御）
 *   【敌】削弱敌方（伤害/控制）
 * 并根据当前战况写「不推荐黄线」警告。
 * ============================================================ */
const SIX_DIM_DEF = {
	/* key → { label, camp: '我'|'敌', src: 该分类对应的技能标签数组 } */
	draw:    { label: '摸牌', camp: '我', src: ['draw'] },
	damage:  { label: '伤害', camp: '敌', src: ['damage', 'atk', 'burst', 'damageBonus', 'loseEnemyHp'] },
	recover: { label: '回复', camp: '我', src: ['recover', 'maxHp', 'revive'] },
	control: { label: '控制', camp: '敌', src: ['ctrl', 'turnOver', 'link', 'skip', 'judgeCard', 'discardEnemy', 'loseEnemy', 'loseEnemyMaxHp'] },
	utility: { label: '辅助', camp: '我', src: ['aux', 'giveCard', 'teamAid', 'teamRecover', 'addShan'] },
	defense: { label: '防御', camp: '我', src: ['def', 'sustain', 'addShan', 'judge'] },
};

/* 从技能标签算出六大分类分值（float，可能为负） */
function _sixDimScores(tags) {
	const out = {};
	for (const key in SIX_DIM_DEF) {
		const d = SIX_DIM_DEF[key];
		let v = 0;
		d.src.forEach(function (t) {
			if (typeof tags[t] === 'number' && Math.abs(tags[t]) > 0.01) v += tags[t];
		});
		out[key] = Math.round(v * 100) / 100;
	}
	return out;
}

/* 判断当前战况（尽量容错） */
function _ctxOf(me) {
	try {
		me = me || game.me;
		const hp = me ? (me.hp || 0) : 0;
		const maxHp = me ? (me.maxHp || hp || 1) : 1;
		const lowHp = maxHp > 0 && hp > 0 && hp <= Math.ceil(maxHp / 2);
		const dying = (typeof _status !== 'undefined' && _status.dying) ? 1 : 0;
		return { hp: hp, maxHp: maxHp, lowHp: lowHp, dying: !!dying };
	} catch (e) {
		return { hp: 0, maxHp: 1, lowHp: false, dying: false };
	}
}

/* ★ 核心：对某个技能的六大分类做敌我方向 + 黄线评估 */
export function sixDimEnemyAlly(sid, me) {
	try {
		const tags = skillTagsOf(sid);
		const scores = _sixDimScores(tags);
		const dims = {};
		for (const key in SIX_DIM_DEF) {
			const d = SIX_DIM_DEF[key];
			dims[key] = {
				label: d.label, camp: d.camp,
				score: scores[key],
				active: Math.abs(scores[key]) > 0.4,
			};
		}
		/* 当前战况 */
		const ctx = _ctxOf(me);
		const warns = [];

		/* 黄线规则：不推荐 */
		/* ① 残血/濒死时仍主打输出（伤害/控制）→ 提示该技能对当前生存是隐患 */
		if (ctx.dying || ctx.lowHp) {
			const off = (dims.damage.active ? dims.damage.score : 0) + (dims.control.active ? dims.control.score : 0);
			if (off > 1.5) warns.push({ dim: 'damage', msg: '残血/濒死仍主打输出，生存优先', level: 'warn' });
		}
		/* ② 纯【敌】向技能（伤害/控制）无正收益来源 → 不适合辅助队友 */
		/* ③ 无攻击手段（无伤害/无控制）时 → 标记防御被动，提示缺乏主动权 */
		const hasAttack = dims.damage.active || dims.control.active;
		if (!hasAttack && !dims.utility.active && !dims.recover.active) {
			warns.push({ dim: 'defense', msg: '几乎全面被动：缺乏进攻或增益手段', level: 'warn' });
		}
		/* ④ 六大分类全都不活跃 → 未识别/规则类，不强制黄线 */
		const anyActive = Object.keys(dims).some(function (k) { return dims[k].active; });
		const rec = warns.length ? '不推荐' : '推荐';
		return {
			sid: sid,
			dims: dims,
			ctx: { lowHp: ctx.lowHp, dying: ctx.dying },
			warns: warns,
			rec: rec,
			recommended: warns.length === 0 || !anyActive,
		};
	} catch (e) {
		return { sid: sid, dims: {}, warns: [], rec: '推荐', recommended: true };
	}
}

/* 六大分类敌我方向 · 纯文本渲染 */
export function skillProfitBreakdown(sid) {
	try {
		const tags = skillTagsOf(sid);
		const sk = lib.skill && lib.skill[sid];
		const multi = tags.__multi || scoreSkill(tags, { sid: sid, skill: sk });

		const positive = [];
		const negative = [];
		const conditions = [];

		multi.breakdown.filter(function (b) { return b.kind === 'effect' && b.score > 0; })
			.forEach(function (b) { positive.push({ label: b.label, score: b.score }); });
		multi.breakdown.filter(function (b) { return b.kind === 'effect' && b.score < 0; })
			.forEach(function (b) { negative.push({ label: b.label, score: b.score }); });
		multi.breakdown.filter(function (b) { return b.kind === 'cost'; })
			.forEach(function (b) { negative.push({ label: b.label, score: b.score }); });

		const limits = tags.__limits || {};
		if (limits.limited) conditions.push({ label: '限定技：一局一次', severity: 'warn' });
		if (limits.awaken) conditions.push({ label: '觉醒技：条件触发', severity: 'info' });
		if (limits.zhuSkill) conditions.push({ label: '主公技：仅主公可用', severity: 'warn' });
		if (limits.forced) conditions.push({ label: '锁定技：强制触发', severity: 'info' });
		if (limits.frequent) conditions.push({ label: '高频技：可多次使用', severity: 'info' });
		(tags.__modLabels || []).forEach(function (lbl) {
			conditions.push({ label: lbl, severity: 'info', isMod: true });
		});
		(tags.__aiLabels || []).forEach(function (lbl) {
			conditions.push({ label: 'AI: ' + lbl, severity: 'info', isAI: true });
		});

		const isRuleOnly = (tags.manageSkill > 0 || tags.skillLimit > 0 || tags.ruleConstrain > 0)
			&& !tags.__isPureAI && !positive.length && !negative.length;
		if (isRuleOnly) conditions.unshift({ label: '规则约束类：维护游戏规则/技能上限', severity: 'warn', isRuleOnly: true });
		if (tags.__isPureAI) conditions.unshift({ label: 'AI 辅助类：仅影响 AI 决策', severity: 'warn', isPureAI: true });

		const _r2 = function (v) { return Math.round(v * 100) / 100; };
		const posSum = _r2(positive.reduce(function (s, x) { return s + x.score; }, 0));
		const negSum = _r2(negative.reduce(function (s, x) { return s + x.score; }, 0));

		return {
			positive, negative, conditions,
			posSum, negSum, total: multi.final,
			source: tags.__source,
			metaTypes: tags.__metaTypes || [],
			isPureAI: tags.__isPureAI || false,
			isRuleOnly: !!isRuleOnly,
			isUnrecognized: positive.length === 0 && negative.length === 0
				&& !tags.__isPureAI && !isRuleOnly && conditions.length === 0,
			modLabels: tags.__modLabels || [],
			aiLabels: tags.__aiLabels || [],
			multi: multi,
		};
	} catch (e) {
		return { positive: [], negative: [], conditions: [], posSum: 0, negSum: 0, total: 0, err: String(e) };
	}
}

/* ============================================================
 * ★ 技能拆解 → 纯文本（适配 openSimplePanel）
 * ============================================================ */

export { _sixDimScores, _ctxOf };
export function clearSkillProfileCache() { _PROFILE_CACHE.clear(); }
