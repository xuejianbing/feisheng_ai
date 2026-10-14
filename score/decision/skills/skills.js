/*
 * ============================================
 * // الناشر: في شينغ الأصلي
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 技能矩阵（ID 表 + 源码扫描 双轨） =================
 * 设计原则：
 *   ① 主路径 A：ID → 标签表（SKILL_ID_TAGS，官方武将快速路径）
 *   ② 主路径 B：源码 → 关键词扫描（API_PATTERNS，覆盖扩展武将）
 *   ③ 合并：同标签取两者最大值（不漏不错）
 *   ④ 未识别技能返回空标签（不猜测）
// Autor: Feisheng Original | Licencia: GPL-3.0
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js?v=5e5';
import { scanObjectMethod } from './skillScanner.js?v=5e5';
import { scoreSkill, deriveDimensions, renderScoreBreakdown } from './skillRules.js?v=5e5';

/* ================= 缓存 ================= */
const _TAG_CACHE = new Map();
const _PROFILE_CACHE = new Map();
const MAX_CACHE = 4000;

/* ================= 工具 ================= */
function _fnSource(fn) {
	try {
		if (typeof fn !== 'function') return '';
		return fn.toString();
	} catch (e) { return ''; }
}

/* 汇总技能定义里所有函数的源码（用于阈值/时机扫描） */
function _skillSource(sk) {
	try {
		if (!sk) return '';
		const parts = [];
		Object.keys(sk).forEach(function (k) {
			const v = sk[k];
			const s = _fnSource(v);
			if (s) parts.push(s);
		});
		return parts.join('\n');
	} catch (e) { return ''; }
}

/* 推定时机条件（human 标签），供 engine 与 skillPlayBrain 使用：
 *   濒死 / 已受伤 / 低血 / 响应 / 出牌 / null(被动或出牌阶段主动)
 */
function _inferTimingCondition(sk, tags, dims) {
	try {
		const timing = dims && dims.timing;
		/* 1. 多维时机为濒死 → 濒死救援类 */
		if (timing === 'dying') return '濒死';
		/* 2. 受伤后 / 伤害后 → 已受伤 */
		if (timing === 'damaged' || timing === 'damageAfter') return '已受伤';
		/* 3. 响应类 */
		if (timing === 'chooseToRespond') return '响应';

		/* 4. 源码含低血阈值（me.hp/player.hp 与 < / <= 且 阈值 ≤2）→ 低血时机 */
		const src = _skillSource(sk);
		const LOWHP = /(?:hp|s.hp|player\.hp)\s*(?:[<>]=?)\s*(?:1|2)\b/;
		if (LOWHP.test(src)) return '低血';

		/* 5. 自扣血成技（低血更敢发的上血技/转换出血） */
		if ((Number(tags.loseHp || 0) > 0 || Number(tags.loseMaxHp || 0) > 0)) return '低血';

		/* 6. 出牌阶段主动技 */
		if (timing === 'phaseUse' || timing === 'chooseToUse') return '出牌';

		return null;
	} catch (e) { return null; }
}

function _emptyTags() {
	return {
		/* 正收益标签 */
		draw: 0, gain: 0, damage: 0, useCard: 0, useSkill: 0,
		recover: 0, maxHp: 0, revive: 0,
		turnOver: 0, link: 0, skip: 0, judgeCard: 0, discardEnemy: 0, loseEnemy: 0,
		mark: 0, addSkill: 0, addTempSkill: 0, addShan: 0, changeHp: 0, giveCard: 0,
		judge: 0, compare: 0, viewAs: 0, guanxing: 0, topCards: 0,
		/* ★ 新增：削敌类正收益 */
		loseEnemyHp: 0, loseEnemyMaxHp: 0,
		/* mod 类正收益标签 */
		distChange: 0, rangeExtend: 0, attackRange: 0, damageBonus: 0,
		handcardLimit: 0, ignoreHandcard: 0,
		/* 旧版兼容标签（保留，兼容下游调用） */
		atk: 0, burst: 0, aoe: 0, sustain: 0, def: 0, ctrl: 0, aux: 0, loseCard: 0,
		costHp: 0, awaken: 0, limit: 0,
		/* 负收益标签 */
		loseHp: 0, loseMaxHp: 0, selfDie: 0, selfOut: 0,
		selfDiscard: 0, selfLose: 0, selfTurnOver: 0, selfLink: 0, selfRemove: 0,
		/* ★ 新增：自伤 / 资敌类负收益 */
		selfDamage: 0, selfSkip: 0, selfJudge: 0,
		feedDraw: 0, feedGain: 0, feedRecover: 0, feedHp: 0,
		feedSkill: 0, feedMark: 0,
		/* ★ 团队维度标签 */
		teamGain: 0, teamAid: 0, teamHurt: 0, teamRisk: 0, teamChain: 0,
		cancel: 0, negate: 0,
		/* AI 辅助类（不进正负收益，仅记条件） */
		aiOrder: 0, aiUseful: 0, aiValue: 0, threaten: 0, aiEffect: 0,
		cardRule: 0, saveRule: 0, equipRule: 0, damageMod: 0, skillTag: 0,
		/* ★ 新增：规则约束类（不进正负收益，仅记条件） */
		manageSkill: 0, ruleConstrain: 0, skillLimit: 0,
		/* 元数据 */
		enemy: 0, ally: 0, self: 0, multi: 0,
		__phases: [],
		__targets: [],
		/* ★ Skill Decision Kernel V2：目标方向元数据 */
		__targetIntent: null,       // support | offense | mixed | null
		__targetConfidence: 0,
		__targetInferred: false,
		__limits: {},
		__modLabels: [],    // ★ 新增：mod 对象的人类可读标签
		__aiLabels: [],     // ★ 新增：ai 字段的人类可读标签
		__metaTypes: [],    // ★ 新增：技能类型元信息（事件触发型/转化型/主动技/AI辅助型等）
		__isPureAI: false,  // ★ 新增：是否纯 AI 辅助技能
		__scope: null,
		__scopeLabel: null,
		__scopeCount: null,
		__scopeHits: null,
		__source: 'empty',
	};
}

function _mergeTags(base, patch) {
	const out = Object.assign({}, base);
	for (const k in patch) {
		if (k === '__phases' || k === '__targets') {
			out[k] = Array.from(new Set((base[k] || []).concat(patch[k] || [])));
		} else if (k === '__limits') {
			out[k] = Object.assign({}, base[k] || {}, patch[k] || {});
		} else if (typeof patch[k] === 'number') {
			out[k] = (out[k] || 0) + patch[k];
		} else {
			out[k] = patch[k];
		}
	}
	return out;
}

/* 两个标签对象合并，同标签取最大值（非求和） */
function _mergeTagsMax(a, b) {
	const out = Object.assign({}, a);
	for (const k in b) {
		if (k === '__phases' || k === '__targets') {
			out[k] = Array.from(new Set((a[k] || []).concat(b[k] || [])));
		} else if (k === '__limits') {
			out[k] = Object.assign({}, a[k] || {}, b[k] || {});
		} else if (typeof b[k] === 'number') {
			const av = a[k] || 0;
			const bv = b[k];
			/* 同号取绝对值大的，异号取和（允许抵消） */
			if (av * bv >= 0) {
				out[k] = Math.abs(av) >= Math.abs(bv) ? av : bv;
			} else {
				out[k] = av + bv;
			}
		} else if (k === '__targetIntent' || k === '__targetInferred') {
			/* scanner 的非数值目标语义也必须保留；ID 表只负责显式标签，
			 * 不应把源码推断的 provenance 静默丢掉。 */
			if (b[k] !== null && b[k] !== undefined) out[k] = b[k];
		}
	}
	return out;
}

/* ============================================================
 * 主表 A：技能 ID → 标签向量（官方武将快速路径）
 * 覆盖：标风火林山 + 界 + 常用 SP + 神
 * ============================================================ */
const SKILL_ID_TAGS = {
	/* ---------- 摸牌类 ---------- */
	yingzi:      { draw: 1.5, __phases: ['draw'], __targets: ['self'] },
	jizhi:       { draw: 1.5, __phases: ['useCard'], __limits: { frequent: true }, __targets: ['self'] },
	biyue:       { draw: 1.2, __phases: ['end'], __targets: ['self'] },
	yiji:        { draw: 1.0, sustain: 0.6, __phases: ['damaged'], __targets: ['ally', 'self'] },
	shangshi:    { draw: 1.8, __phases: ['damageAfter', 'phaseDraw'], __targets: ['self'] },
	jianxiong:   { draw: 1.2, awaken: 0.5, __phases: ['damaged'], __targets: ['self'] },
	fangzhu:     { draw: 1.0, ctrl: 0.8, __phases: ['damaged'], __targets: ['enemy'] },
	zishou:      { draw: 1.0, def: 0.5, __phases: ['phaseUse'], __targets: ['self'] },
	xingshuai:   { draw: 0.8, __phases: ['damaged'], __targets: ['ally'] },
	wugu:        { draw: 1.0, __phases: ['phaseUse'] },
	guicai:      { judge: 1.2, __phases: ['judge'], __targets: ['self', 'ally'] },

	/* ---------- 单体伤害类 ---------- */
	wusheng:     { viewAs: 1.4, atk: 0.8, __phases: ['chooseToUse', 'chooseToRespond'], __targets: ['enemy'] },
	longdan:     { viewAs: 1.5, atk: 0.6, def: 0.5, __phases: ['chooseToUse', 'chooseToRespond'], __targets: ['enemy', 'self'] },
	paoxiao:     { atk: 1.8, burst: 0.8, __phases: ['phaseUse'], __limits: { frequent: true }, __targets: ['enemy'] },
	liegong:     { atk: 1.6, compare: 1.2, __phases: ['phaseUse'], __targets: ['enemy'] },
	tieji:       { atk: 1.4, ctrl: 0.5, __phases: ['useCard'], __targets: ['enemy'] },
	qiangxi:     { atk: 1.5, costHp: 0.5, __phases: ['phaseUse'], __targets: ['enemy'] },
	shuangxiong: { atk: 1.2, compare: 1.6, __phases: ['phaseDraw'], __targets: ['enemy'] },
	quhu:        { compare: 1.6, ctrl: 0.8, atk: 0.6, __phases: ['phaseUse'], __targets: ['enemy'] },
	luanji:      { aoe: 1.8, burst: 0.8, __phases: ['phaseUse'], __targets: ['multi'] },
	wushuang:    { atk: 1.8, def: 0.6, __phases: ['phaseUse'], __targets: ['enemy'] },
	leiji:       { atk: 1.2, judge: 1.0, __phases: ['useCard'], __targets: ['enemy'] },
	kurou:       { costHp: 1.8, draw: 1.2, __phases: ['phaseUse'], __limits: { frequent: true }, __targets: ['self'] },
	zhiyan:      { draw: 1.0, __phases: ['phaseUse'], __targets: ['self'] },
	mashu:       { atk: 0.3, __phases: ['passive'], __targets: ['enemy'] },

	/* ---------- AOE 类 ---------- */
	yeyan:       { aoe: 2.2, burst: 1.2, __phases: ['phaseUse'], __targets: ['multi'] },
	fencheng:    { aoe: 2.0, burst: 1.0, limit: 1.5, __phases: ['phaseUse'], __targets: ['multi'] },
	shenfen:     { aoe: 2.5, burst: 1.5, limit: 2.0, __phases: ['phaseUse'], __targets: ['multi'] },
	huoshou:     { aoe: 1.2, def: 0.5, __phases: ['passive'], __targets: ['self'] },
	qinyin:      { aoe: 1.0, sustain: 1.0, __phases: ['phaseJieshu'], __targets: ['multi'] },

	/* ---------- 回复类 ---------- */
	qingnang:    { sustain: 2.0, __phases: ['phaseUse'], __targets: ['ally', 'self'] },
	jijiu:       { sustain: 1.8, viewAs: 1.2, __phases: ['dying', 'chooseToUse'], __targets: ['ally', 'self'] },
	jieyin:      { sustain: 1.5, loseCard: 0.8, __phases: ['phaseUse'], __targets: ['ally', 'self'] },
	ganlu:       { sustain: 1.5, __phases: ['phaseUse'], __targets: ['ally'] },
	jiuyuan:     { sustain: 1.5, __phases: ['dying'], __targets: ['ally'] },

	/* ---------- 防御类 ---------- */
	hujia:       { def: 2.0, aux: 1.0, __phases: ['chooseToRespond'], __limits: { zhuSkill: true }, __targets: ['self'] },
	ganglie:     { def: 1.2, atk: 0.8, judge: 1.0, __phases: ['damaged'], __targets: ['enemy'] },
	yingyang:    { def: 1.0, draw: 0.6, __phases: ['damaged'] },
	keji:        { def: 1.2, draw: 0.8, __phases: ['phaseJieshu', 'phaseDraw'], __targets: ['self'] },
	qianxun:     { def: 1.5, __phases: ['passive'], __targets: ['self'] },
	weimu:       { def: 1.3, __phases: ['passive'], __targets: ['self'] },
	tengjia:     { def: 1.8, __phases: ['passive'], __targets: ['self'] },
	bagua:       { def: 1.5, __phases: ['chooseToRespond'], __targets: ['self'] },
	renwang:     { def: 1.4, __phases: ['passive'], __targets: ['self'] },

	/* ---------- 控制类 ---------- */
	qixi:        { ctrl: 1.6, loseCard: 1.0, __phases: ['phaseUse'], __targets: ['enemy'] },
	qicai:       { ctrl: 0.8, viewAs: 1.0, __phases: ['phaseUse'], __targets: ['enemy'] },
	guanxing:    { ctrl: 1.5, judge: 1.0, __phases: ['phaseZhunbei'], __targets: ['self'] },
	qiaobian:    { ctrl: 1.2, draw: 0.5, __phases: ['phaseZhunbei', 'phaseDraw', 'phaseUse', 'phaseDiscard'], __targets: ['multi'] },
	shushen:     { ctrl: 1.0, draw: 0.6, __phases: ['useCard'], __targets: ['ally'] },
	wushuang_ctrl: { ctrl: 1.2, __phases: ['phaseUse'], __targets: ['enemy'] },
	duanliang:   { ctrl: 1.5, __phases: ['useCard'], __targets: ['enemy'] },
	wuxie:       { ctrl: 1.0, __phases: ['chooseToRespond'], __targets: ['multi'] },

	/* ---------- 拆牌类 ---------- */
	zhiheng:     { loseCard: 2.0, draw: 1.5, __phases: ['phaseUse'], __targets: ['self'] },
	qice:        { loseCard: 1.5, viewAs: 0.8, __phases: ['phaseUse'], __targets: ['multi'] },
	qizhi:       { loseCard: 1.5, draw: 0.8, __phases: ['useCard'], __targets: ['self'] },

	/* ---------- 转化类 ---------- */
	zhangba:     { viewAs: 1.2, atk: 0.8, __phases: ['chooseToUse'], __targets: ['enemy'] },
	cixiong:     { atk: 0.8, viewAs: 1.0, __phases: ['useCard'], __targets: ['enemy'] },
	shensu:      { viewAs: 0.8, atk: 0.6, __phases: ['chooseToUse'], __targets: ['enemy'] },
	tianxian:    { viewAs: 1.0, atk: 0.6, __phases: ['chooseToUse'], __targets: ['enemy'] },

	/* ---------- 辅助/团队类 ---------- */
	rende:       { aux: 2.0, sustain: 0.6, __phases: ['phaseUse'], __targets: ['ally'] },
	yinghun:     { aux: 1.8, draw: 0.5, __phases: ['phaseZhunbei', 'phaseJieshu'], __targets: ['ally', 'enemy'] },
	mingce:      { aux: 1.5, atk: 0.5, __phases: ['phaseUse'], __targets: ['ally'] },
	yizheng:     { aux: 1.5, draw: 0.6, __phases: ['phaseUse'], __targets: ['ally'] },
	jijiang:     { aux: 1.5, atk: 0.8, __phases: ['phaseUse', 'chooseToRespond'], __limits: { zhuSkill: true }, __targets: ['enemy'] },
	yajiao:      { aux: 1.2, draw: 0.5, __phases: ['useCard'], __targets: ['ally'] },
	zhiyu:       { aux: 1.2, sustain: 1.0, __phases: ['phaseJieshu'], __targets: ['ally', 'self'] },
	shangyi:     { aux: 1.0, __phases: ['phaseDraw'], __targets: ['ally'] },

	/* ---------- 卖血类 ---------- */
	xueyi:       { costHp: 1.5, draw: 1.2, __phases: ['passive'], __targets: ['self'] },
	juanshu:     { costHp: 1.2, def: 0.6, __phases: ['damaged'] },
	juejing:     { costHp: 0.8, draw: 1.5, __phases: ['damageAfter'], __targets: ['self'] },

	/* ---------- 觉醒类 ---------- */
	hunzi:       { awaken: 2.5, atk: 0.8, draw: 0.8, __phases: ['phaseZhunbei'], __targets: ['self'] },
	ruoyu:       { awaken: 2.2, draw: 1.0, __phases: ['phaseZhunbei'], __targets: ['self'] },
	zaiqi:       { awaken: 2.0, draw: 1.2, sustain: 0.8, __phases: ['phaseDraw'], __targets: ['self'] },
	yingyang_awaken: { awaken: 1.5, def: 0.8, __phases: ['damaged'] },

	/* ---------- 限定类 ---------- */
	tianyi:      { compare: 1.8, atk: 1.2, limit: 2.0, __phases: ['phaseUse'], __targets: ['enemy', 'multi'] },
	lijian:      { ctrl: 1.8, compare: 0.8, limit: 1.8, __phases: ['phaseUse'], __targets: ['enemy'] },
	jiehuo:      { ctrl: 2.0, limit: 1.8, __phases: ['phaseUse'], __targets: ['multi'] },
	fangquan:    { aux: 1.8, draw: 1.0, limit: 1.5, __phases: ['phaseUse'], __targets: ['ally'] },

	/* ---------- 拼点类 ---------- */
	xianzhen:    { compare: 1.8, atk: 1.2, __phases: ['phaseUse'], __targets: ['enemy'] },
	mengjin:     { compare: 1.2, atk: 0.8, ctrl: 0.8, __phases: ['useCard'], __targets: ['enemy'] },
	qiaoshui:    { compare: 1.5, ctrl: 1.0, __phases: ['phaseUse'], __targets: ['enemy'] },
	zenghui:     { compare: 1.5, ctrl: 1.2, __phases: ['phaseUse'], __targets: ['enemy'] },

	/* ---------- 判定类 ---------- */
	guidao:      { judge: 1.5, __phases: ['judge'], __targets: ['self', 'ally'] },
	tiandu:      { judge: 1.0, draw: 1.0, __phases: ['judge'], __targets: ['self'] },
	guose:       { ctrl: 1.2, viewAs: 0.8, __phases: ['phaseUse'], __targets: ['enemy'] },
	luoying:     { draw: 1.0, __phases: ['loseAfter'], __targets: ['self'] },

	/* ---------- 距离/位置类 ---------- */
	qicai_dist:  { def: 0.8, __phases: ['passive'], __targets: ['self'] },
	xiaoji:      { draw: 1.0, __phases: ['loseAfter'], __targets: ['self'] },

	/* ---------- 特殊：神将 ---------- */
	guixin:      { draw: 2.0, burst: 1.2, __phases: ['phaseUse'], __targets: ['self'] },
	jiuchi:      { viewAs: 1.2, atk: 0.8, __phases: ['chooseToUse'], __targets: ['enemy'] },
	wumou:       { draw: 0.8, def: 0.6, __phases: ['phaseUse'], __targets: ['self'] },
	wusheng_shen: { viewAs: 1.5, atk: 1.0, __phases: ['chooseToUse'], __targets: ['enemy'] },

	/* ---------- 常见界限突破 ---------- */
	re_yingzi:   { draw: 1.8, __phases: ['draw'], __targets: ['self'] },
	re_jianxiong: { draw: 1.5, __phases: ['damaged'], __targets: ['self'] },
	re_paoxiao:  { atk: 1.8, burst: 1.0, __phases: ['phaseUse'], __targets: ['enemy'] },
	re_guanyu:   { viewAs: 1.5, atk: 0.8, __phases: ['chooseToUse', 'chooseToRespond'], __targets: ['enemy'] },

	/* ---------- 主公技 ---------- */
	zhiheng_zhu: { loseCard: 2.0, draw: 1.5, __phases: ['phaseUse'], __limits: { zhuSkill: true }, __targets: ['self'] },
	jiuyuan_zhu: { sustain: 1.5, __phases: ['dying'], __limits: { zhuSkill: true }, __targets: ['ally'] },
};

/* ============================================================
 * 主表 B：源码关键词 → 效果标签（扩展武将通用识别）
 * sign: 1=正收益  -1=负收益  0=条件
 * 覆盖 Player 对象全部可调用方法
 * ============================================================ */
const API_PATTERNS = [
	/* ===== 正收益：摸牌/获取 ===== */
	{ re: /\.draw\s*\(/g,                    tag: 'draw',         sign: 1,  weight: 1.0 },
	{ re: /\.gain\s*\(/g,                    tag: 'gain',         sign: 1,  weight: 1.2 },
	{ re: /\.gainPlayerCard\s*\(/g,          tag: 'gain',         sign: 1,  weight: 1.2 },
	{ re: /\.gainMultiple\s*\(/g,            tag: 'gain',         sign: 1,  weight: 1.2 },
	{ re: /chooseToGuanxing/g,               tag: 'guanxing',     sign: 1,  weight: 0.8 },
	{ re: /\.getTopCards\s*\(/g,             tag: 'topCards',     sign: 1,  weight: 0.6 },

	/* ===== 正收益：伤害/攻击 ===== */
	{ re: /\.damage\s*\(/g,                  tag: 'damage',       sign: 1,  weight: 1.6 },
	{ re: /\.useCard\s*\(/g,                 tag: 'useCard',      sign: 1,  weight: 0.8 },
	{ re: /\.useSkill\s*\(/g,                tag: 'useSkill',     sign: 1,  weight: 0.6 },

	/* ===== 正收益：回复/体力 ===== */
	{ re: /\.recover\s*\(/g,                 tag: 'recover',      sign: 1,  weight: 1.5 },
	{ re: /\.gainMaxHp\s*\(/g,               tag: 'maxHp',        sign: 1,  weight: 1.0 },
	{ re: /\.revive\s*\(/g,                  tag: 'revive',       sign: 1,  weight: 3.0 },

	/* ===== 正收益：控制/限制 ===== */
	{ re: /\.turnOver\s*\(/g,                tag: 'turnOver',     sign: 1,  weight: 1.5 },
	{ re: /\.link\s*\(/g,                    tag: 'link',         sign: 1,  weight: 1.0 },
	{ re: /\.skip\s*\(/g,                    tag: 'skip',         sign: 1,  weight: 1.2 },
	{ re: /\.addJudgeCard\s*\(/g,            tag: 'judgeCard',    sign: 1,  weight: 1.2 },
	{ re: /\.discardPlayerCard\s*\(/g,       tag: 'discardEnemy', sign: 1,  weight: 1.2 },
	{ re: /\.loseToSpecial\s*\(/g,           tag: 'loseEnemy',    sign: 1,  weight: 0.8 },

	/* ===== 正收益：辅助/团队 ===== */
	{ re: /\.addMark\s*\(/g,                tag: 'mark',         sign: 1,  weight: 0.6 },
	{ re: /\.addSkill\s*\(/g,                tag: 'addSkill',     sign: 1,  weight: 1.0 },
	{ re: /\.addTempSkill\s*\(/g,            tag: 'addTempSkill', sign: 1,  weight: 0.8 },
	{ re: /\.addShan\s*\(/g,                 tag: 'addShan',      sign: 1,  weight: 0.5 },
	{ re: /\.changeHp\s*\(/g,                tag: 'changeHp',     sign: 1,  weight: 0.8 },
	{ re: /\.chooseGiveCard/g,               tag: 'giveCard',     sign: 1,  weight: 1.0 },

	/* ===== 正收益：判定/拼点 ===== */
	{ re: /\.judge\s*\(/g,                   tag: 'judge',        sign: 1,  weight: 1.0 },
	{ re: /chooseToCompare/g,                tag: 'compare',      sign: 1,  weight: 1.2 },
	{ re: /chooseToPindian/g,                tag: 'compare',      sign: 1,  weight: 1.2 },

	/* ===== 正收益：转化/视为 ===== */
	{ re: /viewAs\s*:/g,                     tag: 'viewAs',       sign: 1,  weight: 1.0 },
	{ re: /viewAsFilter/g,                   tag: 'viewAs',       sign: 1,  weight: 0.8 },

	/* ===== 负收益：失去体力/上限 ===== */
	{ re: /\.loseHp\s*\(/g,                  tag: 'loseHp',       sign: -1, weight: 1.6 },
	{ re: /\.loseMaxHp\s*\(/g,               tag: 'loseMaxHp',    sign: -1, weight: 1.2 },
	{ re: /\.die\s*\(/g,                     tag: 'selfDie',      sign: -1, weight: 5.0 },
	{ re: /\.out\s*\(/g,                     tag: 'selfOut',      sign: -1, weight: 4.0 },

	/* ===== 负收益：弃牌/失去 ===== */
	{ re: /\.discard\s*\(/g,                 tag: 'selfDiscard',  sign: -1, weight: 0.8 },
	{ re: /\.lose\s*\(/g,                    tag: 'selfLose',     sign: -1, weight: 0.8 },
	{ re: /\.loseCard\s*\(/g,                tag: 'selfLose',     sign: -1, weight: 0.8 },
	{ re: /\.remove\s*\(/g,                  tag: 'selfRemove',   sign: -1, weight: 2.0 },

	/* ===== 负收益：翻面/横置自己 ===== */
	{ re: /\.turnOver\s*\(\s*false\s*\)/g,   tag: 'selfTurnOver', sign: -1, weight: 1.2 },
	{ re: /\.link\s*\(\s*false\s*\)/g,       tag: 'selfLink',     sign: -1, weight: 0.8 },

	/* ===== 负收益：取消/无效 ===== */
	{ re: /\.cancel\s*\(/g,                  tag: 'cancel',       sign: -1, weight: 0.6 },
	{ re: /\.negate\s*\(/g,                  tag: 'negate',       sign: -1, weight: 0.8 },

	/* ===== 条件类（记录到 __limits） ===== */
	{ re: /limited\s*:\s*true/g,             tag: 'limited',      sign: 0,  weight: 1.0 },
	{ re: /awaken\s*:\s*true/g,              tag: 'awaken',       sign: 0,  weight: 1.0 },
	{ re: /juexingji\s*:\s*true/g,           tag: 'awaken',       sign: 0,  weight: 1.0 },
	{ re: /zhuSkill\s*:\s*true/g,            tag: 'zhuSkill',     sign: 0,  weight: 1.0 },
	{ re: /forced\s*:\s*true/g,              tag: 'forced',       sign: 0,  weight: 0.5 },
	{ re: /locked\s*:\s*true/g,              tag: 'locked',       sign: 0,  weight: 0.5 },
	{ re: /frequent\s*:\s*true/g,            tag: 'frequent',     sign: 0,  weight: 0.5 },
	{ re: /direct\s*:\s*true/g,              tag: 'direct',       sign: 0,  weight: 0.3 },

	/* ===== 规则约束类（识别"技能管理/上限维护"型技能） ===== */
	{ re: /\.removeSkill\s*\(/g,             tag: 'manageSkill',  sign: 0,  weight: 1.0 },
	{ re: /\.removeTempSkill\s*\(/g,         tag: 'manageSkill',  sign: 0,  weight: 0.8 },
	{ re: /\.removeAdditionalSkill\s*\(/g,   tag: 'manageSkill',  sign: 0,  weight: 1.0 },
	{ re: /skills?\.length/g,                tag: 'manageSkill',  sign: 0,  weight: 0.6 },
	{ re: /countSkills/g,                    tag: 'manageSkill',  sign: 0,  weight: 0.8 },
	{ re: /extraSkills?/g,                   tag: 'skillLimit',   sign: 0,  weight: 0.8 },
	{ re: /额外技能/g,                        tag: 'skillLimit',   sign: 0,  weight: 0.8 },
	{ re: /技能上限/g,                        tag: 'skillLimit',   sign: 0,  weight: 0.8 },
	{ re: /\.setStorage\s*\(/g,              tag: 'ruleConstrain', sign: 0, weight: 0.3 },
	{ re: /\.getStorage\s*\(/g,              tag: 'ruleConstrain', sign: 0, weight: 0.3 },

	/* ===== 中文描述关键词（从 _info 描述里提取，兜底识别） ===== */
	/* 摸牌/获得 */
	{ re: /摸\s*[一二两三四五六七八九十\d]+\s*张/g,  tag: 'draw',         sign: 1,  weight: 0.8 },
	{ re: /获得\s*[一二两三四五六七八九十\d]+\s*张/g, tag: 'gain',         sign: 1,  weight: 0.8 },
	{ re: /获得\s*[一二两三四五六七八九十\d]+\s*个/g, tag: 'mark',         sign: 1,  weight: 0.6 },
	{ re: /摸牌/g,                            tag: 'draw',         sign: 1,  weight: 0.6 },
	/* 伤害 */
	{ re: /造成\s*[一二两三四五六七八九十\d]+\s*点伤害/g, tag: 'damage',  sign: 1,  weight: 1.4 },
	{ re: /造成伤害/g,                         tag: 'damage',       sign: 1,  weight: 0.8 },
	{ re: /弃置/g,                            tag: 'selfDiscard',  sign: -1, weight: 0.4 },
	/* 回复 */
	{ re: /回复\s*[一二两三四五六七八九十\d]+\s*点体力/g, tag: 'recover', sign: 1,  weight: 1.2 },
	{ re: /回复体力/g,                         tag: 'recover',      sign: 1,  weight: 0.6 },
	/* 失去体力 */
	{ re: /失去\s*[一二两三四五六七八九十\d]+\s*点体力/g, tag: 'loseHp', sign: -1, weight: 1.2 },
	{ re: /失去体力/g,                         tag: 'loseHp',       sign: -1, weight: 0.6 },
	/* ★ 更宽的中文描述：战绝、苦肉等"失去体力"写法 */
	{ re: /你失去\s*[一二两三四五六七八九十\d]*\s*点体力/g, tag: 'loseHp', sign: -1, weight: 1.2 },
	{ re: /失去\s*[一二两三四五六七八九十\d]*\s*点体力，视为/g, tag: 'loseHp', sign: -1, weight: 1.4 },
	{ re: /失去\s*[一二两三四五六七八九十\d]+\s*点体力上限/g, tag: 'loseMaxHp', sign: -1, weight: 1.0 },
	/* 控制 */
	{ re: /翻面/g,                            tag: 'turnOver',     sign: 1,  weight: 0.8 },
	{ re: /横置/g,                            tag: 'link',         sign: 1,  weight: 0.6 },
	{ re: /跳过/g,                            tag: 'skip',         sign: 1,  weight: 0.8 },
	{ re: /弃置其/g,                          tag: 'discardEnemy', sign: 1,  weight: 0.8 },
	{ re: /弃置一名其他角色的/g,                tag: 'discardEnemy', sign: 1,  weight: 0.8 },
	/* ★ 更宽的中文描述：勤王、苦肉等"弃置"写法 */
	{ re: /弃置一张牌/g,                       tag: 'selfDiscard',  sign: -1, weight: 0.6 },
	{ re: /你可以弃置一张/g,                   tag: 'selfDiscard',  sign: -1, weight: 0.6 },
	/* 使用/视为 */
	{ re: /视为使用/g,                        tag: 'viewAs',       sign: 1,  weight: 0.8 },
	{ re: /当作/g,                            tag: 'viewAs',       sign: 1,  weight: 0.6 },
	/* 条件/限制 */
	{ re: /限定技/g,                          tag: 'limited',      sign: 0,  weight: 1.0 },
	{ re: /觉醒技/g,                          tag: 'awaken',       sign: 0,  weight: 1.0 },
	{ re: /主公技/g,                          tag: 'zhuSkill',     sign: 0,  weight: 1.0 },
	{ re: /锁定技/g,                          tag: 'forced',       sign: 0,  weight: 0.8 },
	{ re: /每回合限一次/g,                    tag: 'frequent',     sign: 0,  weight: 0.5 },
	{ re: /每轮限一次/g,                      tag: 'frequent',     sign: 0,  weight: 0.5 },
	{ re: /出牌阶段限一次/g,                  tag: 'frequent',     sign: 0,  weight: 0.5 },

	/* ★ 更宽的中文描述：战绝、苦肉等"失去体力"写法 */
	{ re: /你失去\s*[一二两三四五六七八九十\d]*\s*点体力/g, tag: 'loseHp', sign: -1, weight: 1.2 },
	{ re: /失去\s*[一二两三四五六七八九十\d]*\s*点体力，视为/g, tag: 'loseHp', sign: -1, weight: 1.4 },
	{ re: /视为使用一张【决斗】/g,                tag: 'viewAs',       sign: 1,  weight: 1.0 },
	{ re: /失去体力，视为/g,                     tag: 'loseHp',       sign: -1, weight: 1.2 },

	/* ★ 弃牌类中文描述（勤王、仁德等） */
	{ re: /弃置一张牌/g,                       tag: 'selfDiscard',  sign: -1, weight: 0.6 },
	{ re: /你可以弃置一张/g,                   tag: 'selfDiscard',  sign: -1, weight: 0.6 },
	{ re: /弃置\s*[一二两三四五六七八九十\d]+\s*张牌/g, tag: 'selfDiscard', sign: -1, weight: 0.6 },

	/* ★ 出牌阶段限一次 / 每回合限一次（高频技识别） */
	{ re: /出牌阶段限\d+次/g,                   tag: 'frequent',     sign: 0,  weight: 0.5 },
	{ re: /每名角色的回合限一次/g,               tag: 'frequent',     sign: 0,  weight: 0.5 },
	{ re: /每局游戏限一次/g,                    tag: 'limited',      sign: 0,  weight: 1.0 },
	{ re: /限定技，/g,                          tag: 'limited',      sign: 0,  weight: 1.0 },
	{ re: /觉醒技，/g,                          tag: 'awaken',       sign: 0,  weight: 1.0 },
	{ re: /主公技，/g,                          tag: 'zhuSkill',     sign: 0,  weight: 1.0 },
	{ re: /锁定技，/g,                          tag: 'forced',       sign: 0,  weight: 0.8 },
	{ re: /转换技，/g,                          tag: 'frequent',     sign: 0,  weight: 0.3 },
	{ re: /使命技，/g,                          tag: 'limited',      sign: 0,  weight: 0.5 },

	/* ★ 血量/上限相关的其它写法 */
	{ re: /你减\s*[一二两三四五六七八九十\d]*\s*点体力上限/g, tag: 'loseMaxHp', sign: -1, weight: 1.2 },
	{ re: /你加\s*[一二两三四五六七八九十\d]*\s*点体力上限/g, tag: 'maxHp', sign: 1, weight: 1.0 },
	{ re: /回复\s*[一二两三四五六七八九十\d]*\s*点体力/g, tag: 'recover', sign: 1, weight: 1.2 },

	/* ★ 摸牌/弃牌的更宽写法 */
	{ re: /摸\s*[一二两三四五六七八九十\d]*\s*张牌/g, tag: 'draw',   sign: 1, weight: 0.8 },
	{ re: /你摸\s*[一二两三四五六七八九十\d]*\s*张/g, tag: 'draw',  sign: 1, weight: 0.8 },
	{ re: /其摸\s*[一二两三四五六七八九十\d]*\s*张/g, tag: 'aux',   sign: 1, weight: 0.4 },
	{ re: /其弃置\s*[一二两三四五六七八九十\d]*\s*张/g, tag: 'discardEnemy', sign: 1, weight: 0.6 },

	/* ★ 伤害类的中文写法 */
	{ re: /对其造成\s*[一二两三四五六七八九十\d]*\s*点伤害/g, tag: 'damage', sign: 1, weight: 1.4 },
	{ re: /你对其造成/g,                         tag: 'damage',       sign: 1, weight: 1.0 },
	{ re: /造成\s*[一二两三四五六七八九十\d]*\s*点火焰伤害/g, tag: 'damage', sign: 1, weight: 1.6 },
	{ re: /造成\s*[一二两三四五六七八九十\d]*\s*点雷电伤害/g, tag: 'damage', sign: 1, weight: 1.6 },

	/* ★ 判定/拼点类中文写法 */
	{ re: /进行判定/g,                          tag: 'judge',        sign: 1, weight: 0.8 },
	{ re: /你与其拼点/g,                        tag: 'compare',      sign: 1, weight: 1.0 },
	{ re: /你与其进行拼点/g,                    tag: 'compare',      sign: 1, weight: 1.2 },
];

/* ============================================================
 * 作用范围识别表（中文描述 + 源码双路提取）
 * scope 枚举：
 *   self      仅自己
 *   self1     自己 + 1 名角色
 *   selfN     自己 + N 名角色
 *   all       全体（无差别）
 *   all_others 除自己外全体
 *   any1      任意 1 名
 *   anyN      任意 N 名
 *   enemy1    敌方 1 名
 *   enemyN    敌方 N 名
 *   ally1     友方 1 名
 *   allyN     友方 N 名
 * ============================================================ */
const SCOPE_PATTERNS = [
	/* ===== 中文描述（优先） ===== */
	{ re: /你和一名角色各/g,                      scope: 'self1', weight: 3.0 },
	{ re: /你与一名角色各/g,                      scope: 'self1', weight: 3.0 },
	{ re: /你与其各/g,                            scope: 'self1', weight: 3.0 },
	{ re: /你与一名其他角色各/g,                  scope: 'self1', weight: 3.0 },
	{ re: /你和[一二两三四五六七八九十\d]+名角色各/g, scope: 'selfN', weight: 3.0 },
	{ re: /你与[一二两三四五六七八九十\d]+名角色各/g, scope: 'selfN', weight: 3.0 },
	{ re: /你和[一二两三四五六七八九十\d]+名其他角色各/g, scope: 'selfN', weight: 3.0 },
	{ re: /你与所有/g,                            scope: 'all',    weight: 3.0 },
	{ re: /所有角色/g,                            scope: 'all',    weight: 2.5 },
	{ re: /所有其他角色/g,                        scope: 'all_others', weight: 2.5 },
	{ re: /全体/g,                                scope: 'all',    weight: 2.0 },
	{ re: /令一名角色/g,                          scope: 'any1',   weight: 2.0 },
	{ re: /令一名其他角色/g,                      scope: 'enemy1', weight: 2.5 },
	{ re: /令[一二两三四五六七八九十\d]+名角色/g, scope: 'anyN',   weight: 2.0 },
	{ re: /令[一二两三四五六七八九十\d]+名其他角色/g, scope: 'enemyN', weight: 2.5 },
	{ re: /你摸/g,                                scope: 'self',   weight: 2.0 },
	{ re: /你回复/g,                              scope: 'self',   weight: 2.0 },
	{ re: /你弃置/g,                              scope: 'self',   weight: 2.0 },
	{ re: /你获得/g,                              scope: 'self',   weight: 1.5 },
	{ re: /你失去/g,                              scope: 'self',   weight: 1.5 },
	{ re: /你受到/g,                              scope: 'self',   weight: 1.5 },

	/* ===== 源码扫描（兜底） ===== */
	{ re: /chooseTarget\s*\(\s*1\s*[,)]/g,        scope: 'any1',   weight: 1.5 },
	{ re: /chooseTarget\s*\(\s*[2-9]\d*\s*[,)]/g, scope: 'anyN',   weight: 1.5 },
	{ re: /chooseTarget\s*\(\s*\[/g,              scope: 'anyN',   weight: 1.5 },
	{ re: /game\.filterPlayer\s*\(/g,             scope: 'all',    weight: 1.0 },
	{ re: /game\.countPlayer\s*\(/g,              scope: 'all',    weight: 1.0 },
	{ re: /game\.players\.forEach/g,              scope: 'all',    weight: 1.0 },
	{ re: /\.forEach\s*\(\s*function\s*\(\s*\w+\s*\)\s*\{[^}]*\.damage\s*\(/g, scope: 'all', weight: 1.2 },
	{ re: /player\.draw\s*\(/g,                   scope: 'self',   weight: 0.8 },
	{ re: /player\.recover\s*\(/g,                scope: 'self',   weight: 0.8 },
	{ re: /player\.loseHp\s*\(/g,                 scope: 'self',   weight: 0.8 },
];

/* scope 人类可读标签 */
const SCOPE_LABEL = {
	'self':       '仅自己',
	'self1':      '自己+1名',
	'selfN':      '自己+N名',
	'all':        '全体',
	'all_others': '除自己外全体',
	'any1':       '任意1名',
	'anyN':       '任意N名',
	'enemy1':     '敌方1名',
	'enemyN':     '敌方N名',
	'ally1':      '友方1名',
	'allyN':      '友方N名',
};

/**
 * 从源码和描述中提取作用范围
 * @param {string} src     技能源码（_collectSource 的输出）
 * @param {string} sid     技能 ID
 * @returns {object} { scope, scopeLabel, scopeCount, hits }
 */
function _extractScope(src, sid) {
	const hits = {};
	if (!src) src = '';

	/* 汇总所有扫描源：源码 + 中文描述 */
	let allSrc = src;
	try {
		if (sid) {
			const info = lib.translate && lib.translate[sid + '_info'];
			if (typeof info === 'string') allSrc += '\n' + info;
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	SCOPE_PATTERNS.forEach(function (p) {
		try {
			const re = new RegExp(p.re.source, 'g');
			const m = allSrc.match(re);
			if (m && m.length) {
				const cnt = Math.min(m.length, 3);
				hits[p.scope] = (hits[p.scope] || 0) + p.weight * cnt;
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	});

	/* 取权重最高的 scope */
	let bestScope = 'any1';
	let bestWeight = 0;
	for (const sc in hits) {
		if (hits[sc] > bestWeight) {
			bestWeight = hits[sc];
			bestScope = sc;
		}
	}

	/* 若同时命中 self1 和 all，优先 all（更精确） */
	if (hits.all && hits.self1) bestScope = 'all';
	if (hits.all_others && hits.all) bestScope = 'all_others';

	/* 提取具体数字（如"你和三名角色各"） */
	let scopeCount = null;
	try {
		const CN_NUM = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
		const m = allSrc.match(/你和([一二两三四五六七八九十\d]+)名角色各/);
		if (m) {
			const v = m[1];
			scopeCount = CN_NUM[v] || parseInt(v, 10) || null;
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	return {
		scope: bestScope,
		scopeLabel: SCOPE_LABEL[bestScope] || '未识别',
		scopeCount: scopeCount,
		hits: hits,
		_hasData: bestWeight > 0,
	};
}

/* ============================================================
 * 标签作用对象映射表（增强版：加标签名 + 目标说明 + 双向标记）
 *   affect：'enemy' | 'self' | 'ally' | 'all' | 'any'
 *   target：人类可读的目标名
 *   dual：  true 表示"视具体情况双向作用"（如铁索连环横置敌人或友军效果相反）
 *   dualTip：双向说明
 * ============================================================ */
const SKILL_TAG_AFFECT = {
	/* ===== 正收益 ===== */
	draw:           { affect: 'self',  target: '自己' },
	gain:           { affect: 'self',  target: '自己' },
	damage:         { affect: 'enemy', target: '敌方' },
	atk:            { affect: 'enemy', target: '敌方' },
	burst:          { affect: 'enemy', target: '敌方' },
	aoe:            { affect: 'all',   target: '全体' },
	useCard:        { affect: 'any',   target: '视卡牌' },
	useSkill:       { affect: 'any',   target: '视技能' },
	recover:        { affect: 'ally',  target: '自己/友方' },
	sustain:        { affect: 'ally',  target: '自己/友方' },
	maxHp:          { affect: 'self',  target: '自己' },
	revive:         { affect: 'ally',  target: '自己/友方' },
	turnOver:       { affect: 'any',   target: '敌人或队友',
	                  dual: true, dualTip: '敌人翻面=收益｜队友翻面=损失' },
	link:           { affect: 'any',   target: '敌人或队友',
	                  dual: true, dualTip: '敌人横置=收益｜队友横置=损失' },
	skip:           { affect: 'any',   target: '敌人或队友',
	                  dual: true, dualTip: '跳过敌人阶段=收益｜跳过队友=损失' },
	judgeCard:      { affect: 'enemy', target: '敌方' },
	discardEnemy:   { affect: 'enemy', target: '敌方' },
	loseEnemy:      { affect: 'enemy', target: '敌方' },
	mark:           { affect: 'any',   target: '视标记' },
	addSkill:       { affect: 'any',   target: '视技能' },
	addTempSkill:   { affect: 'any',   target: '视技能' },
	addShan:        { affect: 'ally',  target: '自己/友方' },
	changeHp:       { affect: 'any',   target: '视目标' },
	giveCard:       { affect: 'ally',  target: '友方' },
	judge:          { affect: 'any',   target: '视判定' },
	compare:        { affect: 'any',   target: '敌人或队友' },
	viewAs:         { affect: 'any',   target: '视转化' },
	guanxing:       { affect: 'self',  target: '自己' },
	topCards:       { affect: 'self',  target: '自己' },
	def:            { affect: 'self',  target: '自己' },
	ctrl:           { affect: 'enemy', target: '敌方' },
	aux:            { affect: 'ally',  target: '友方' },
	distChange:     { affect: 'self',  target: '自己' },
	rangeExtend:    { affect: 'self',  target: '自己' },
	attackRange:    { affect: 'self',  target: '自己' },
	damageBonus:    { affect: 'enemy', target: '敌方' },
	handcardLimit:  { affect: 'self',  target: '自己' },
	ignoreHandcard: { affect: 'self',  target: '自己' },

	/* ===== 负收益 ===== */
	loseHp:         { affect: 'self',  target: '自己' },
	loseMaxHp:      { affect: 'self',  target: '自己' },
	selfDie:        { affect: 'self',  target: '自己' },
	selfOut:        { affect: 'self',  target: '自己' },
	selfDiscard:    { affect: 'self',  target: '自己' },
	selfLose:       { affect: 'self',  target: '自己' },
	selfTurnOver:   { affect: 'self',  target: '自己' },
	selfLink:       { affect: 'self',  target: '自己' },
	selfRemove:     { affect: 'self',  target: '自己' },
	cancel:         { affect: 'any',   target: '视情况' },
	negate:         { affect: 'any',   target: '视情况' },

	/* ===== 旧标签 ===== */
	loseCard:       { affect: 'self',  target: '自己' },
	costHp:         { affect: 'self',  target: '自己' },
	awaken:         { affect: 'self',  target: '自己' },
	limit:          { affect: 'self',  target: '自己' },
};

/* 作用对象 → 图标 */
const AFFECT_ICON = {
	enemy: '🗡', self: '🛡', ally: '🤝', all: '🌐', any: '❔',
};

/* 四象限 → 完整标签 */
const QUADRANT_LABEL = {
	'enemy+': '🗡+ 对敌收益',
	'enemy-': '🗡- 资敌损失',
	'self+':  '🛡+ 自身收益',
	'self-':  '🛡- 自身代价',
	'ally+':  '🤝+ 对友收益',
	'ally-':  '🤝- 误伤队友',
	'all+':   '🌐+ 全体收益',
	'all-':   '🌐- 全体伤害',
	'any+':   '❔+ 任意收益',
	'any-':   '❔- 任意损失',
};

/**
 * 计算作用对象（返回 { affect, target, dual, dualTip }）
 */
function _resolveAffect(tag, tags) {
	const def = SKILL_TAG_AFFECT[tag];
	if (!def) return { affect: 'any', target: '视情况', dual: false };
	let affect = def.affect;
	try {
		const targets = (tags && tags.__targets) || [];
		/* 源码级 __targets 优先级更高（除非是双向技能） */
		if (!def.dual) {
			if (targets.indexOf('enemy') >= 0 && targets.indexOf('ally') < 0) affect = 'enemy';
			else if (targets.indexOf('ally') >= 0 && targets.indexOf('enemy') < 0) affect = 'ally';
			else if (targets.indexOf('multi') >= 0) affect = 'all';
			else if (targets.indexOf('self') >= 0 && affect === 'any') affect = 'self';
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return {
		affect: affect,
		target: def.target,
		dual: !!def.dual,
		dualTip: def.dualTip || null,
	};
}

/**
 * 计算象限（作用对象 + 收益方向）
 * @param {string} affect  'enemy' | 'self' | 'ally' | 'all' | 'any'
 * @param {number} score   已经乘过符号的分数（>0 正收益，<0 负收益）
 */
function _getQuadrant(affect, score) {
	const sign = score >= 0 ? '+' : '-';
	return affect + sign;
}

/* ============================================================
 * 主表 C：mod 对象函数名 → 效果标签（识别持续修改型技能）
 * aiOnly: true 表示只影响 AI 决策评分，不改变游戏状态
 * ============================================================ */
const MOD_KEYWORD_TAGS = {
	/* ===== 距离/范围类（实际游戏效果） ===== */
	globalFrom:        { label: '改变距离',           tag: 'distChange',     weight: 1.2, aiOnly: false },
	globalTo:          { label: '改变距离',           tag: 'distChange',     weight: 1.2, aiOnly: false },
	targetInRange:     { label: '扩展攻击范围',       tag: 'rangeExtend',    weight: 1.0, aiOnly: false },
	attackRange:       { label: '改变攻击范围',       tag: 'attackRange',    weight: 0.8, aiOnly: false },
	globalFromTo:      { label: '改变距离',           tag: 'distChange',     weight: 1.0, aiOnly: false },

	/* ===== 卡牌规则类（实际游戏效果） ===== */
	cardUsable:        { label: '改变卡牌使用次数',   tag: 'cardRule',       weight: 1.0, aiOnly: false },
	cardEnabled:       { label: '启用/禁用卡牌',      tag: 'cardRule',       weight: 0.8, aiOnly: false },
	cardDiscardable:   { label: '改变弃牌规则',       tag: 'cardRule',       weight: 0.6, aiOnly: false },
	cardSavable:       { label: '改变救援规则',       tag: 'saveRule',       weight: 0.8, aiOnly: false },
	cardUsableTarget:  { label: '改变使用目标',       tag: 'cardRule',       weight: 0.6, aiOnly: false },

	/* ===== 手牌/装备栏（实际游戏效果） ===== */
	maxHandcard:       { label: '改变手牌上限',       tag: 'handcardLimit',  weight: 0.8, aiOnly: false },
	maxHandcardBase:   { label: '改变手牌上限',       tag: 'handcardLimit',  weight: 0.6, aiOnly: false },
	ignoredHandcard:   { label: '无视手牌限制',       tag: 'ignoreHandcard', weight: 1.0, aiOnly: false },
	canBeReplaced:     { label: '装备可替换性',       tag: 'equipRule',      weight: 0.6, aiOnly: false },
	canBeIgnored:      { label: '可忽略手牌',         tag: 'ignoreHandcard', weight: 0.6, aiOnly: false },

	/* ===== 伤害类（实际游戏效果） ===== */
	damageBonus:       { label: '伤害加成',           tag: 'damageBonus',    weight: 1.4, aiOnly: false },
	damageSuffered:    { label: '受伤改变',           tag: 'damageMod',      weight: 1.0, aiOnly: false },
	damageSource:      { label: '伤害来源调整',       tag: 'damageMod',      weight: 0.8, aiOnly: false },

	/* ===== 技能标记类 ===== */
	skillTagFilter:    { label: '技能标记过滤',       tag: 'skillTag',       weight: 0.5, aiOnly: false },

	/* ===== AI 评分类（不改变游戏状态） ===== */
	aiOrder:           { label: 'AI出牌顺序调整',     tag: 'aiOrder',        weight: 0.2, aiOnly: true },
	aiUseful:          { label: 'AI价值调整',         tag: 'aiUseful',       weight: 0.2, aiOnly: true },
	aiValue:           { label: 'AI价值调整',         tag: 'aiValue',        weight: 0.2, aiOnly: true },
};

/* ============================================================
 * 主表 C2：规则约束类关键词 → 人类可读标签
 * ============================================================ */
const RULE_CONSTRAINT_LABELS = {
	'manageSkill':    '技能列表管理（增删技能）',
	'ruleConstrain':  '状态存储/规则约束',
	'skillLimit':     '额外技能上限管理',
};

/* ============================================================
 * 主表 D：ai 字段名 → 标签（识别 AI 辅助类技能）
 * 全部 aiOnly: true
 * ============================================================ */
const AI_FIELD_TAGS = {
	threaten:       { label: '威胁度评估',     tag: 'threaten',  weight: 0.3, aiOnly: true },
	effect:         { label: '效果评估',       tag: 'aiEffect',  weight: 0.2, aiOnly: true },
	skillTagFilter: { label: '技能标记',       tag: 'skillTag',  weight: 0.3, aiOnly: true },
	order:          { label: '优先级评估',     tag: 'aiOrder',   weight: 0.1, aiOnly: true },
	useful:         { label: '价值评估',       tag: 'aiUseful',  weight: 0.1, aiOnly: true },
	value:          { label: '价值评估',       tag: 'aiValue',   weight: 0.1, aiOnly: true },
	result:         { label: '结果评估',       tag: 'aiResult',  weight: 0.2, aiOnly: true },
	maixie:         { label: '卖血评估',       tag: 'maixie',    weight: 0.2, aiOnly: true },
	directHit_ai:   { label: '直伤评估',       tag: 'directHit', weight: 0.2, aiOnly: true },
	noe:            { label: '禁用装备评估',   tag: 'aiValue',   weight: 0.1, aiOnly: true },
	presha:         { label: '预杀评估',       tag: 'presha',    weight: 0.1, aiOnly: true },
	mingzhi:        { label: '明置评估',       tag: 'aiValue',   weight: 0.1, aiOnly: true },
	nokeep:         { label: '不保留评估',     tag: 'aiValue',   weight: 0.1, aiOnly: true },
	nowuxie:        { label: '无需无懈',       tag: 'nowuxie',   weight: 0.1, aiOnly: true },
};

/* ============================================================
 * 时机关键词映射
 * ============================================================ */
const PHASE_KEYWORDS = {
	phaseZhunbei: 'prepare',
	phaseJudge:   'judge',
	phaseDraw:    'draw',
	phaseUse:     'use',
	phaseDiscard: 'discard',
	phaseJieshu:  'end',
	damageBefore: 'damageBefore',
	damageAfter:  'damageAfter',
	dying:        'dying',
	die:          'death',
};

/* ============================================================
 * 主入口：识别技能标签（ID 表 + 源码扫描 + mod扫描 + ai扫描 四轨）
 * ============================================================ */
export function skillTagsOf(sid) {
	try {
		const cached = _TAG_CACHE.get(sid);
		if (cached) return cached;

		const sk = lib.skill && lib.skill[sid];
		if (!sk) return _emptyTags();

		/* ===== ★ 快速分类：假技能/内部/子技能/钩子 ===== */
		const _cls = _classifySkill(sid, sk);

		/* 假技能 + 内部工具：直接空标签 */
		if (_cls === 'fake' || _cls === 'internal') {
			const empty = _emptyTags();
			empty.__source = 'skip-' + _cls;
			empty.__isFake = true;
			if (_TAG_CACHE.size < MAX_CACHE) _TAG_CACHE.set(sid, empty);
			return empty;
		}

		/* 子技能：从主技能继承（权重减半） */
		if (_cls === 'child') {
			const parentId = _findParent(sid);
			if (parentId && lib.skill[parentId] && parentId !== sid) {
				try {
					const parentTags = skillTagsOf(parentId);
					if (parentTags && parentTags.__source
						&& parentTags.__source.indexOf('skip-') !== 0
						&& parentTags.__source !== 'empty') {
						const inherited = _emptyTags();
						for (const k in parentTags) {
							if (typeof parentTags[k] === 'number' && parentTags[k] !== 0) {
								inherited[k] = parentTags[k] * 0.5;
							}
						}
						inherited.__source = 'inherit';
						inherited.__parent = parentId;
						inherited.__phases = (parentTags.__phases || []).slice();
						inherited.__targets = (parentTags.__targets || []).slice();
						inherited.__limits = Object.assign({}, parentTags.__limits || {});
						try {
							inherited.__multi = scoreSkill(inherited, { sid: sid, skill: sk });
						} catch (e) { inherited.__multi = null; }
						if (_TAG_CACHE.size < MAX_CACHE) _TAG_CACHE.set(sid, inherited);
						return inherited;
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			}
		}

		let idTags = null;
		let srcTags = _emptyTags();

		/* ===== 路径 A：查 ID 表 ===== */
		if (SKILL_ID_TAGS[sid]) {
			idTags = _mergeTags(_emptyTags(), SKILL_ID_TAGS[sid]);
		} else {
			const parts = sid.split('_');
			for (let i = 1; i < parts.length; i++) {
				const candidate = parts.slice(i).join('_');
				if (SKILL_ID_TAGS[candidate]) {
					idTags = _mergeTags(_emptyTags(), SKILL_ID_TAGS[candidate]);
					break;
				}
			}
		}

		/* ===== 路径 B：源码扫描（双路合并：对象-方法交叉 + 关键词兜底） ===== */
		try {
			const src = _collectSource(sk, sid);
			if (src) {
				/* B1 主路径：对象-方法交叉扫描（高精度，判正负） */
				let objTags = null;
				try {
					objTags = scanObjectMethod(src, { sid, skill: sk });
				} catch (eObj) {
					try { console.warn('[djsc/skills] 对象扫描失败 ' + sid, eObj); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
				}

				/* B2 兜底路径：关键词扫描（中文描述 + 无法判断对象的 API 调用）
				 *   注意：API_PATTERNS 里的"纯 API 调用"条目（如 /\.draw\s*\(/）
				 *   已被对象扫描覆盖，此处仅保留中文描述兜底            */
				API_PATTERNS.forEach(function (p) {
					try {
						/* 跳过纯 API 调用正则（对象扫描已负责） */
						if (p.re.source.indexOf('\\b') < 0 && p.re.source.indexOf('.') === 0) return;
						if (/^\s*\\\./.test(p.re.source)) return;   // 以 \. 开头 = 纯 API 调用

						const re = new RegExp(p.re.source, 'g');
						const m = src.match(re);
						if (m && m.length) {
							const count = Math.min(m.length, 5);
							const effWeight = p.weight * (1 + (count - 1) * 0.1);
							const score = p.sign * effWeight * count;

							if (p.sign > 0) {
								srcTags[p.tag] = (srcTags[p.tag] || 0) + score;
							} else if (p.sign < 0) {
								srcTags[p.tag] = (srcTags[p.tag] || 0) + score;
							} else {
								if (!srcTags.__limits) srcTags.__limits = {};
								srcTags.__limits[p.tag] = true;
							}
						}
					} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				});

				/* B3 合并：对象路径优先级更高
				 *   - 同一标签：对象路径存在就用对象路径（绝对值取大）
				 *   - 对象路径的"对偶抵消"：若对象路径给出 feedDraw: -2，
				 *     同时关键词给出 draw: +1，则结果应为 feedDraw: -2（不抵消）
				 *   - 反向也成立：若对象路径给出 damage: +2（打敌），
				 *     关键词给出 selfDamage: -1，两者共存                    */
				if (objTags) {
					for (const k in objTags) {
						if (typeof objTags[k] !== 'number') continue;
						const bv = objTags[k];
						const av = srcTags[k] || 0;
						if (av === 0) {
							srcTags[k] = bv;
						} else if (av * bv >= 0) {
							/* 同号：取绝对值大的（对象路径通常更准，但保守取大） */
							srcTags[k] = Math.abs(av) >= Math.abs(bv) ? av : bv;
						} else {
							/* 异号：对象路径优先，但保留关键词的残余（×0.3） */
							srcTags[k] = bv + av * 0.3;
						}
					}
					/* 对象扫描器生成的目标方向不是普通数值标签，需要显式带入。 */
					if (Array.isArray(objTags.__targets)) srcTags.__targets = objTags.__targets.slice();
					if (typeof objTags.__targetIntent === 'string') srcTags.__targetIntent = objTags.__targetIntent;
					if (typeof objTags.__targetConfidence === 'number') srcTags.__targetConfidence = objTags.__targetConfidence;
					srcTags.__targetInferred = !!objTags.__targetInferred;
				}
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ===== 路径 B3：作用范围识别 ===== */
		try {
			const src = _collectSource(sk, sid);
			const scopeInfo = _extractScope(src, sid);
			if (scopeInfo._hasData) {
				srcTags.__scope = scopeInfo.scope;
				srcTags.__scopeLabel = scopeInfo.scopeLabel;
				srcTags.__scopeCount = scopeInfo.scopeCount;
				srcTags.__scopeHits = scopeInfo.hits;
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ===== 路径 C：扫描 mod 对象 ===== */
		let modHasNonAI = false;
		let modHasAI = false;
		try {
			if (sk.mod && typeof sk.mod === 'object') {
				const modKeys = Object.keys(sk.mod);
				modKeys.forEach(function (key) {
					const rule = MOD_KEYWORD_TAGS[key];
					if (!rule) return;
					srcTags[rule.tag] = (srcTags[rule.tag] || 0) + rule.weight;
					if (!srcTags.__modLabels) srcTags.__modLabels = [];
					const lbl = rule.label + (rule.aiOnly ? '（AI）' : '');
					/* ★ 按 label 去重（不是按 tag），同名只保留一条 */
					if (srcTags.__modLabels.indexOf(lbl) < 0) {
						srcTags.__modLabels.push(lbl);
					}
					if (rule.aiOnly) modHasAI = true;
					else modHasNonAI = true;
				});
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ===== 路径 C2：规则约束类识别（无 content 但有 filter/trigger） ===== */
		try {
			const hasContent = typeof sk.content === 'function';
			const hasViewAs = !!sk.viewAs;
			const hasMod = !!sk.mod;
			/* 无 content、无 viewAs、无 mod，只有 trigger + filter → 大概率是规则管理型 */
			if (!hasContent && !hasViewAs && !hasMod && sk.trigger && typeof sk.filter === 'function') {
				const filterSrc = sk.filter.toString();
				/* 检查 filter 里是否操作技能列表 */
				if (/skills?\.(length|indexOf|includes)/.test(filterSrc) ||
					/removeSkill|removeTempSkill|countSkills/.test(filterSrc) ||
					/额外技能|技能上限/.test(filterSrc)) {
					srcTags.manageSkill = (srcTags.manageSkill || 0) + 1.0;
					srcTags.skillLimit = (srcTags.skillLimit || 0) + 0.8;
				}
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ===== 路径 D：扫描 ai 字段 ===== */
		let aiHasFields = false;
		try {
			if (sk.ai && typeof sk.ai === 'object') {
				const aiKeys = Object.keys(sk.ai);
				aiKeys.forEach(function (key) {
					const rule = AI_FIELD_TAGS[key];
					if (!rule) return;
					srcTags[rule.tag] = (srcTags[rule.tag] || 0) + rule.weight;
					if (!srcTags.__aiLabels) srcTags.__aiLabels = [];
					if (srcTags.__aiLabels.indexOf(rule.label) < 0) {
						srcTags.__aiLabels.push(rule.label);
					}
					aiHasFields = true;
				});
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ===== 路径 E：技能元数据识别 ===== */
		try {
			const meta = [];
			if (sk.trigger) meta.push('事件触发型');
			if (sk.viewAs) meta.push('转化型');
			if (sk.enable) meta.push('主动技');
			if (sk.mod) meta.push('持续修改型');
			if (sk.subSkill) meta.push('复合技能');
			if (sk.group) meta.push('关联技能');
			if (sk.forced) meta.push('锁定技');
			if (sk.limited) meta.push('限定技');
			if (sk.awaken || sk.juexingji) meta.push('觉醒技');
			if (sk.zhuSkill) meta.push('主公技');
			if (sk.persistentSkill) meta.push('常驻技能');
			srcTags.__metaTypes = meta;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ===== 通用字段补充 ===== */
		try {
			const limits = srcTags.__limits || {};
			if (sk.limited === true) limits.limited = true;
			if (sk.awaken === true || sk.juexingji === true) limits.awaken = true;
			if (sk.zhuSkill === true) limits.zhuSkill = true;
			if (sk.forced === true) limits.forced = true;
			if (sk.frequent === true) limits.frequent = true;
			if (sk.locked === true) limits.locked = true;
			srcTags.__limits = limits;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		if (!idTags) _extractPhasesFromTrigger(sk, srcTags);

		try {
			if (sk.viewAs) srcTags.viewAs = (srcTags.viewAs || 0) + 1.5;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		try {
			if (sk.enable) {
				const en = Array.isArray(sk.enable) ? sk.enable : [sk.enable];
				if (en.indexOf('phaseUse') >= 0) srcTags.__phases.push('use');
				if (en.indexOf('chooseToUse') >= 0) srcTags.__phases.push('chooseToUse');
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ===== 判断是否纯 AI 辅助技能 ===== */
		try {
			/* ★ 技能 ID 前缀强判：扩展/内部 AI 辅助技能都带这些前缀 */
			const AI_PREFIXES = ['gjcx_', 'aiyh_', '_djsc', '_aiyh'];
			let isAIPrefix = false;
			for (let i = 0; i < AI_PREFIXES.length; i++) {
				if (sid.indexOf(AI_PREFIXES[i]) === 0) { isAIPrefix = true; break; }
			}

			const hasRealEffect = (
				srcTags.draw > 0 || srcTags.gain > 0 || srcTags.damage > 0 ||
				srcTags.recover > 0 || srcTags.loseHp < 0 || srcTags.selfDiscard < 0 ||
				srcTags.distChange > 0 || srcTags.rangeExtend > 0 || srcTags.damageBonus > 0 ||
				srcTags.cardRule > 0 || srcTags.handcardLimit > 0 || srcTags.ignoreHandcard > 0 ||
				srcTags.viewAs > 0 || srcTags.atk > 0 || srcTags.def > 0 || srcTags.ctrl > 0
			);
			const hasAIOnly = (modHasAI || aiHasFields) || isAIPrefix;

			if (hasAIOnly && (!hasRealEffect || isAIPrefix)) {
				srcTags.__isPureAI = true;
				if (srcTags.__metaTypes.indexOf('AI辅助型') < 0) {
					srcTags.__metaTypes.push('AI辅助型');
				}
				/* ★ 清空所有正负收益标签 */
				const CLEAR_KEYS = [
					'draw','gain','damage','useCard','useSkill','recover','maxHp','revive',
					'turnOver','link','skip','judgeCard','discardEnemy','loseEnemy',
					'mark','addSkill','addTempSkill','addShan','changeHp','giveCard',
					'judge','compare','guanxing','topCards',
					'loseHp','loseMaxHp','selfDie','selfOut','selfDiscard','selfLose',
					'selfTurnOver','selfLink','selfRemove','cancel','negate',
					'atk','burst','aoe','sustain','def','ctrl','aux','loseCard','costHp','awaken','limit',
				];
				CLEAR_KEYS.forEach(function (k) { srcTags[k] = 0; });
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ===== 合并 ===== */
		let merged;
		if (idTags) {
			merged = _mergeTagsMax(idTags, srcTags);
			merged.__phases = Array.from(new Set((idTags.__phases || []).concat(srcTags.__phases || [])));
			/* 手工 ID 表属于高置信知识：若明确给了目标方向，不让源码启发式把它污染成 mixed。 */
			const explicitTargets = idTags.__targets || [];
			if (explicitTargets.length) {
				merged.__targets = explicitTargets.slice();
				const hasEnemy = explicitTargets.indexOf('enemy') >= 0;
				const hasAlly = explicitTargets.indexOf('ally') >= 0 || explicitTargets.indexOf('self') >= 0;
				merged.__targetIntent = hasEnemy && hasAlly ? 'mixed' : (hasEnemy ? 'offense' : (hasAlly ? 'support' : null));
				merged.__targetConfidence = 1;
				merged.__targetInferred = false;
			} else {
				merged.__targets = Array.isArray(srcTags.__targets) ? srcTags.__targets.slice() : [];
				merged.__targetIntent = srcTags.__targetIntent || null;
				merged.__targetConfidence = Number(srcTags.__targetConfidence || 0);
				merged.__targetInferred = !!srcTags.__targetInferred;
			}
			merged.__limits = Object.assign({}, idTags.__limits || {}, srcTags.__limits || {});
			merged.__modLabels = srcTags.__modLabels || [];
			merged.__aiLabels = srcTags.__aiLabels || [];
			merged.__metaTypes = srcTags.__metaTypes || [];
			merged.__isPureAI = srcTags.__isPureAI || false;
			merged.__source = 'id+src';
		} else {
			merged = srcTags;
			merged.__source = 'src';
		}

		const normalized = _normalizeTags(merged);

		/* ★ 附加多维评分 */
		try {
			normalized.__multi = scoreSkill(normalized, { sid: sid, skill: sk });
		} catch (e) {
			normalized.__multi = null;
		}

		if (_TAG_CACHE.size < MAX_CACHE) _TAG_CACHE.set(sid, normalized);
		return normalized;
	} catch (e) { return _emptyTags(); }
}

/* ================= 收集技能源码（覆盖所有可能藏效果的字段） ================= */
/* ================= 收集技能源码（深度递归，覆盖所有可能藏效果的字段） =================
 * 扫描范围：
 *   ① 技能对象本身的所有函数字段（不止 content/filter）
 *   ② trigger / mod / subSkill / group 等嵌套对象的所有函数
 *   ③ group / subSkill 关联的技能对象（递归 1 层）
 *   ④ 中文描述文本（lib.translate[sid+'_info']）
 *   ⑤ 关联技能的中文描述
 */
export function _collectSource(sk, sid, _seen) {
	const sources = [];
	if (!sk) return '';

	/* 防循环 */
	if (!_seen) _seen = new Set();
	if (_seen.has(sk)) return '';
	_seen.add(sk);

	/* ===== ① 扫描技能对象自身的所有函数字段 ===== */
	try {
		for (const k in sk) {
			const v = sk[k];
			if (typeof v === 'function') {
				try { sources.push(_fnSource(v)); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			} else if (typeof v === 'string' && (k === 'prompt' || k === 'prompt2')) {
				sources.push(v);
			} else if (Array.isArray(v) && k === 'enable') {
				sources.push(v.join(' '));
			} else if (v && typeof v === 'object') {
				/* 对象字段：递归扫描（mod / trigger / viewAs / subSkill / ai 等） */
				sources.push(_deepScan(v, 0, 3));
			}
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	/* ===== ② 扫描 viewAs 对象 ===== */
	if (sk.viewAs && typeof sk.viewAs === 'object') {
		try { sources.push(JSON.stringify(sk.viewAs)); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	}

	/* ===== ③ 扫描 group / skillName / subSkill 关联的技能 ===== */
	try {
		const relatedIds = [];
		/* group：字符串或数组 */
		if (sk.group) {
			const g = Array.isArray(sk.group) ? sk.group : [sk.group];
			g.forEach(function (gid) {
				if (typeof gid === 'string') relatedIds.push(gid);
			});
		}
		/* ★ skillName：多段式技能常用它指向基础技能名（字符串/数组/对象分支），
		 *   此前漏读导致"连读"断链，只拿到主技能一段。 */
		if (sk.skillName) {
			const collectName = function (v) {
				if (typeof v === 'string') relatedIds.push(v);
				else if (Array.isArray(v)) v.forEach(collectName);
				else if (v && typeof v === 'object') {
					Object.keys(v).forEach(function (k) {
						collectName(v[k]);
					});
				}
			};
			collectName(sk.skillName);
		}
		/* subSkill：对象，键是子技能 ID */
		if (sk.subSkill && typeof sk.subSkill === 'object') {
			for (const sk2 in sk.subSkill) {
				/* 子技能 ID 通常不需要另找 lib.skill，因为就在 sk.subSkill[sk2] 里 */
				const sub = sk.subSkill[sk2];
				if (sub && typeof sub === 'object') {
					sources.push(_collectSource(sub, null, _seen));
				}
			}
		}
		/* 遍历关联的技能，递归收集（1 层） */
		relatedIds.forEach(function (gid) {
			try {
				const gsk = lib.skill && lib.skill[gid];
				if (gsk && gsk !== sk) {
					sources.push(_collectSource(gsk, gid, _seen));
				}
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	/* ===== ④ 扫描中文描述文本 ===== */
	try {
		if (sid) {
			/* 主描述 */
			const info = lib.translate && lib.translate[sid + '_info'];
			if (typeof info === 'string' && info) sources.push('描述:' + info);
			/* 短名描述（有些技能短名里也有信息） */
			const name = lib.translate && lib.translate[sid];
			if (typeof name === 'string' && name && name !== info) sources.push('名称:' + name);
		}
		/* 关联技能的描述 */
		if (sk.group) {
			const g = Array.isArray(sk.group) ? sk.group : [sk.group];
			g.forEach(function (gid) {
				if (typeof gid !== 'string') return;
				const info = lib.translate && lib.translate[gid + '_info'];
				if (typeof info === 'string' && info) sources.push('描述[' + gid + ']:' + info);
			});
		}
		/* ★ skillName 指向技能的描述（与 group 对称，补全连读） */
		if (sk.skillName) {
			const pushName = function (v) {
				if (typeof v === 'string') {
					const info = lib.translate && lib.translate[v + '_info'];
					if (typeof info === 'string' && info) sources.push('描述[' + v + ']:' + info);
				} else if (Array.isArray(v)) v.forEach(pushName);
				else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { pushName(v[k]); });
			};
			pushName(sk.skillName);
		}
		/* 子技能描述 */
		if (sk.subSkill && typeof sk.subSkill === 'object') {
			for (const sk2 in sk.subSkill) {
				const info = lib.translate && lib.translate[sk2 + '_info'];
				if (typeof info === 'string' && info) sources.push('描述[' + sk2 + ']:' + info);
			}
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	return sources.join('\n');
}

/* ================= 深度扫描对象里所有函数（限定深度） ================= */
function _deepScan(obj, depth, maxDepth) {
	const out = [];
	if (!obj || typeof obj !== 'object' || depth > maxDepth) return '';
	if (Array.isArray(obj)) {
		obj.forEach(function (item) {
			if (typeof item === 'function') {
				try { out.push(_fnSource(item)); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			} else if (item && typeof item === 'object') {
				out.push(_deepScan(item, depth + 1, maxDepth));
			} else if (typeof item === 'string') {
				out.push(item);
			}
		});
		return out.join('\n');
	}
	try {
		for (const k in obj) {
			const v = obj[k];
			if (typeof v === 'function') {
				try { out.push(_fnSource(v)); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			} else if (typeof v === 'string') {
				out.push(v);
			} else if (v && typeof v === 'object') {
				out.push(_deepScan(v, depth + 1, maxDepth));
			}
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return out.filter(Boolean).join('\n');
}

/* ================= 从 trigger 字段提取时机 ================= */
function _extractPhasesFromTrigger(sk, tags, _seen) {
	try {
		const phases = new Set((tags.__phases || []));
		if (!_seen) _seen = new Set();
		const visit = function (s) {
			if (!s || typeof s !== 'object' || _seen.has(s)) return;
			_seen.add(s);
			const trg = s.trigger;
			const collect = function (name) {
				const p = PHASE_KEYWORDS[name];
				if (p) phases.add(p);
			};
			if (trg) {
				if (typeof trg === 'string') collect(trg);
				else if (Array.isArray(trg)) trg.forEach(collect);
				else if (typeof trg === 'object') {
					for (const k in trg) {
						if (!trg[k]) continue;
						collect(k);
						if (typeof trg[k] === 'string') collect(trg[k]);
						if (Array.isArray(trg[k])) trg[k].forEach(collect);
					}
				}
			}
			/* ★ 递归子技能：多段技能的时机常藏在 subSkill/effect 里 */
			if (s.subSkill && typeof s.subSkill === 'object') {
				for (const k in s.subSkill) visit(s.subSkill[k]);
			}
			if (s.group) {
				const g = Array.isArray(s.group) ? s.group : [s.group];
				g.forEach(function (gid) {
					const gsk = (typeof gid === 'string') ? (lib.skill && lib.skill[gid]) : null;
					if (gsk && gsk !== s) visit(gsk);
				});
			}
			/* ★ skillName 指向技能也可携带时机 */
			if (s.skillName) {
				const visitName = function (v) {
					if (typeof v === 'string') {
						const nsk = lib.skill && lib.skill[v];
						if (nsk && nsk !== s) visit(nsk);
					} else if (Array.isArray(v)) v.forEach(visitName);
					else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { visitName(v[k]); });
				};
				visitName(s.skillName);
			}
		};
		visit(sk);
		tags.__phases = Array.from(phases);
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= 归一化（正负分开处理） ================= */
function _normalizeTags(tags) {
	const out = _emptyTags();

	const POS_KEYS = [
		'draw','gain','damage','useCard','useSkill','recover','maxHp','revive',
		'turnOver','link','skip','judgeCard','discardEnemy','loseEnemy',
		'mark','addSkill','addTempSkill','addShan','changeHp','giveCard',
		'judge','compare','viewAs','guanxing','topCards',
		/* ★ 新增 */
		'loseEnemyHp','loseEnemyMaxHp',
		'distChange','rangeExtend','attackRange','damageBonus','handcardLimit','ignoreHandcard',
		'atk','burst','aoe','sustain','def','ctrl','aux','loseCard','costHp','awaken','limit',
		/* ★ 团队正收益 */
		'teamGain','teamAid','teamChain',
	];

	const NEG_KEYS = [
		'loseHp','loseMaxHp','selfDie','selfOut','selfDiscard','selfLose',
		'selfTurnOver','selfLink','selfRemove','cancel','negate',
		/* ★ 新增 */
		'selfDamage','selfSkip','selfJudge',
		'feedDraw','feedGain','feedRecover','feedHp','feedSkill','feedMark',
		/* ★ 团队负收益 */
		'teamHurt','teamRisk',
	];

	POS_KEYS.forEach(function (k) {
		const v = tags[k];
		if (typeof v === 'number' && v > 0.01) {
			out[k] = Math.round((v / (1 + v / 3)) * 100) / 100;
		}
	});

	NEG_KEYS.forEach(function (k) {
		const v = tags[k];
		if (typeof v === 'number' && v < -0.01) {
			const abs = Math.abs(v);
			out[k] = -Math.round((abs / (1 + abs / 3)) * 100) / 100;
		}
	});

	/* AI 辅助类数值（不做饱和归一化，原样保留，仅用于面板显示） */
	['aiOrder','aiUseful','aiValue','threaten','aiEffect','aiResult','maixie',
	 'directHit','presha','nowuxie','cardRule','saveRule','equipRule',
	 'damageMod','skillTag'].forEach(function (k) {
		if (typeof tags[k] === 'number' && Math.abs(tags[k]) > 0.001) {
			out[k] = Math.round(tags[k] * 100) / 100;
		}
	});

	/* ★ 规则约束类标签（不进正负收益，仅记条件） */
	['manageSkill','ruleConstrain','skillLimit'].forEach(function (k) {
		if (typeof tags[k] === 'number' && Math.abs(tags[k]) > 0.001) {
			out[k] = Math.round(tags[k] * 100) / 100;
		}
	});

	out.__phases = Array.isArray(tags.__phases) ? tags.__phases.slice() : [];
	out.__targets = Array.isArray(tags.__targets) ? tags.__targets.slice() : [];
	out.__targetIntent = typeof tags.__targetIntent === 'string' ? tags.__targetIntent : null;
	out.__targetConfidence = typeof tags.__targetConfidence === 'number' ? tags.__targetConfidence : 0;
	out.__targetInferred = !!tags.__targetInferred;
	out.__limits = Object.assign({}, tags.__limits || {});
	out.__modLabels = Array.isArray(tags.__modLabels) ? tags.__modLabels.slice() : [];
	out.__aiLabels = Array.isArray(tags.__aiLabels) ? tags.__aiLabels.slice() : [];
	out.__metaTypes = Array.isArray(tags.__metaTypes) ? tags.__metaTypes.slice() : [];
	out.__isPureAI = !!tags.__isPureAI;
	out.__scope = tags.__scope || null;
	out.__scopeLabel = tags.__scopeLabel || null;
	out.__scopeCount = (typeof tags.__scopeCount === 'number') ? tags.__scopeCount : null;
	out.__scopeHits = tags.__scopeHits || null;
	out.__source = tags.__source || 'empty';
	return out;
}

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

export function clearGainCache() {
	try { _TAG_CACHE.clear(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { _PROFILE_CACHE.clear(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 清空按 name 的武将配合策略缓存（Map 可 clear）。
	 * 其余派生缓存均为 WeakMap（以 skills 数组 / me 对象为键），
	 * 靠引用失效 + 垃圾回收自动回收，无需手动清理。 */
	try { _CHAR_COMBO_CACHE.clear(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
export function scanReset() { clearGainCache(); }

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
export function renderSixDimEnemyAlly(sid, me) {
	try {
		const r = sixDimEnemyAlly(sid, me);
		const L = [];
		L.push('【六类·敌我方向】');
		const order = ['draw', 'damage', 'recover', 'control', 'utility', 'defense'];
		order.forEach(function (k) {
			const d = r.dims[k];
			if (!d) return;
			const mark = d.camp === '敌' ? '敌·' : '我·';
			const active = d.active ? '🟢' : '⚪';
			L.push('  ' + active + ' ' + mark + d.label + '（' + (d.score > 0 ? '+' : '') + d.score + '）');
		});
		if (r.warns && r.warns.length) {
			/* 黄线警告 */
			const group = {};
			r.warns.forEach(function (w) { group[w.msg] = 1; });
			L.push('');
			L.push('⚠️ 【不推荐黄线】');
			Object.keys(group).forEach(function (msg) { L.push('  ⚠️ ' + msg); });
		} else {
			L.push('');
			L.push('✅ 当前战况下：推荐使用');
		}
		return L.join('\n');
	} catch (e) {
		return '【六类·敌我方向】\n评估失败：' + String(e).slice(0, 60);
	}
}

/* ============================================================
 * ★ 技能收益拆解（正收益 / 负收益 / 条件 明细）
 * ============================================================ */
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
export function renderSkillBreakdownText(sid) {
	try {
		const sk = lib.skill && lib.skill[sid];
		const tags = skillTagsOf(sid);

		/* ★ 用多维评分渲染主体 */
		let text = renderScoreBreakdown(sid, tags, { sid: sid, skill: sk });

		/* ★ 附加：条件 / 元信息 */
		const br = skillProfitBreakdown(sid);
		const extras = [];

		if (br.metaTypes && br.metaTypes.length) {
			extras.push('');
			extras.push('【类型】' + br.metaTypes.join(' · '));
		}
		if (br.isPureAI) {
			extras.push('');
			extras.push('ℹ 该技能为 AI 辅助类');
		}
		if (br.isRuleOnly) {
			extras.push('');
			extras.push('ℹ 该技能为规则约束类');
		}
		/* ★ 优化：不要显示"未被识别"，改成友好提示 */
		if (br.isUnrecognized) {
			extras.push('');
			extras.push('ℹ 该技能效果较复杂');
			extras.push('  已按默认分数计算');
		}

		if (br.conditions && br.conditions.length) {
			extras.push('');
			extras.push('【条件/限制】');
			br.conditions.forEach(function (x) {
				let tag = '·';
				if (x.severity === 'warn') tag = '⚠';
				if (x.isPureAI) tag = '★';
				if (x.isRuleOnly || x.isRule) tag = '⚙';
				if (x.isMod) tag = '🔧';
				if (x.isAI) tag = '🤖';
				extras.push('  ' + tag + ' ' + x.label);
			});
		}

		/* ★ 六分类敌我方向 + 黄线不推荐 */
		extras.push('');
		extras.push(renderSixDimEnemyAlly(sid, _status.currentPhase));

		extras.push('');
		extras.push('【识别来源】' + (br.source || 'default'));

		return text + '\n' + extras.join('\n');
	} catch (e) {
		return '--- ' + sid + ' ---\n渲染异常：' + String(e).slice(0, 80);
	}
}

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

/* ===== 技能分类 ===== */
function _classifySkill(sid, sk) {
	try {
		if (!sk || typeof sk !== 'object') return 'invalid';

		/* 内部工具：_ 开头 / zf_ 前缀 */
		if (/^_/.test(sid)) return 'internal';
		if (/^zf_/.test(sid)) return 'internal';

		const hasContent = typeof sk.content === 'function';
		const hasViewAs = !!sk.viewAs;
		const hasTrigger = !!sk.trigger;
		const hasEnable = !!sk.enable;
		const hasMod = !!sk.mod;
		const hasFilter = typeof sk.filter === 'function';
		const hasAttr = !!(sk.forced || sk.limited || sk.zhuSkill || sk.frequent
			|| sk.awaken || sk.juexingji || sk.locked);

		/* 假技能：无任何有效字段 */
		if (!hasContent && !hasViewAs && !hasTrigger && !hasEnable
			&& !hasMod && !hasFilter && !hasAttr) {
			return 'fake';
		}

		/* 子技能：特定后缀 */
		const CHILD_RE = /(_effect|_used|_mark|_clear|_backup|_add|_count|_targeted|_buff|_debuff|_tag|_temp|_roundcount|_limit|_record|_global|_rewrite|_blocker|_ban|_trigger|_check|_init|_handcard|_distance|_range|_view|_put|_remove|_achieve|_fail|_dying|_damage|_draw|_use|_recover|_sha|_round|_aiSkill|_backflow|_restore|_fall|_more|_less|_self|_others|_min|_max|_\d+)$/;
		if (CHILD_RE.test(sid)) return 'child';

		return 'real';
	} catch (e) { return 'real'; }
}

/* ===== 查找主技能 ===== */
function _findParent(sid) {
	try {
		const SUFFIXES = [
			'_effect2', '_effect3', '_effect', '_used', '_mark', '_clear',
			'_backup', '_add', '_count', '_targeted', '_buff', '_debuff',
			'_tag', '_temp', '_roundcount', '_limit', '_record', '_global',
			'_rewrite', '_blocker', '_ban', '_trigger', '_check', '_init',
			'_handcard', '_distance', '_range', '_view', '_put', '_remove',
			'_achieve', '_fail', '_dying', '_damage', '_draw', '_use',
			'_recover', '_sha', '_round', '_backflow', '_restore', '_fall',
			'_more', '_less', '_self', '_others', '_min', '_max',
		];
		for (const suf of SUFFIXES) {
			if (sid.endsWith(suf)) {
				const p = sid.slice(0, -suf.length);
				if (p && lib.skill[p]) return p;
			}
		}
		/* 兜底：去掉最后一段 */
		const idx = sid.lastIndexOf('_');
		if (idx > 0) {
			const p = sid.slice(0, idx);
			if (lib.skill[p]) return p;
		}
		return null;
	} catch (e) { return null; }
}
