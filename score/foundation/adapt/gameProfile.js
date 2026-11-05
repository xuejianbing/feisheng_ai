/*
 * ============================================
 * 版权所有，侵权必究
 * 通用卡牌博弈AI决策引擎 · 内核模块
 * ============================================
 */

/* ================= 游戏档案（Game Profile） =================
 *
 * 【接入一款新游戏：只需要填这一张表，内核零改动】
 *
 * 1) 复制 EMPTY_PROFILE 作为起点；
 * 2) 填 name / engine；
 * 3) 在 semanticIds 里，把该游戏的卡牌 id 填进对应语义类
 *    （攻击/防御/治疗/控制/延时/无效化/增益/补牌，填不出的留空即可）；
 * 4) 在 phases / camps / events 里填该游戏的阶段名、身份名、事件名；
 * 5) 如需覆盖默认判定，实现可选的 relationOf / winCondition；
 * 6) 调用 setProfile(你的档案)，或用 setProfile(部分字段) 局部覆盖。
 *
 * 填完执行 __DJSC.proReady.text() 查看就绪度，缺什么会逐项列出。
 */

import { setMapping, coverage, SEMANTIC } from './terms.js';

/* ---------- 空白模板（复制填写） ---------- */
export const EMPTY_PROFILE = {
	id: '',
	name: '（待填）游戏名',
	engine: '（待填）引擎名',
	/* 通用阶段 → 该游戏实际阶段名 */
	phases: { judge: '', draw: '', play: '', discard: '', end: '' },
	/* 语义类 → 该游戏卡牌 id 表 */
	semanticIds: {
		attack: {}, defense: {}, heal: {}, control: {},
		delay: {}, negate: {}, buff: {}, draw: {},
	},
	/* 特征槽位 → 语义类并集（一般不用改） */
	featureBuckets: {
		atk: [SEMANTIC.ATTACK],
		def: [SEMANTIC.DEFENSE, SEMANTIC.HEAL, SEMANTIC.NEGATE, SEMANTIC.BUFF],
		ctrl: [SEMANTIC.CONTROL],
		delay: [SEMANTIC.DELAY],
	},
	/* 具体卡牌 → 通用战略状态转移。核心决策层禁止再写牌名分支。 */
	strategicEffects: {},
	/* 阵营语义 → 该游戏身份名 */
	camps: { self: '', ally: '', enemy: '', third: '' },
	/* 通用事件 → 该游戏事件名 */
	events: { turnStart: '', phaseStart: '', cardUsed: '', damage: '', dying: '', death: '' },
	/* 可选覆盖：关系判定（返回 same/hostile/neutral/unknown） */
	relationOf: null,
	/* 可选覆盖：胜负判定（返回 win/lose/ongoing） */
	winCondition: null,
};

/* ---------- 当前实现档案：卡牌游戏「某杀」适配 ----------
 * 说明：本档案是「适配层配置」，不属于内核逻辑。
 * 内核只认语义，牌名/身份名一律在此登记。
 */
export const NONAME_PROFILE = {
	id: 'noname',
	name: '无名杀',
	engine: '无名杀运行时',
	phases: { judge: 'phaseJudge', draw: 'phaseDraw', play: 'phaseUse', discard: 'phaseDiscard', end: 'phaseDiscard' },
	semanticIds: {
		attack: { sha: 1, juedou: 1, huogong: 1, nanman: 1, wanjian: 1, zhujin: 1, huosha: 1, leisha: 1 },
		defense: { shan: 1 },
		heal: { tao: 1 },
		control: { guohe: 1, shunshou: 1, lebu: 1, bingliang: 1, tiesuo: 1 },
		delay: { lebu: 1, bingliang: 1 },
		negate: { wuxie: 1 },
		buff: { jiu: 1 },
		draw: {},                                   /* 待填：补牌类卡牌 */
	},
	featureBuckets: {
		atk: [SEMANTIC.ATTACK],
		def: [SEMANTIC.DEFENSE, SEMANTIC.HEAL, SEMANTIC.NEGATE, SEMANTIC.BUFF],
		ctrl: [SEMANTIC.CONTROL],
		delay: [SEMANTIC.DELAY],
	},
	/* 牌名只在适配档案出现；决策层只处理 create-state / remove-target-card。 */
	strategicEffects: {
		lebu: {
			operation: 'create-state',
			state: { family: 'delayed-control', dimension: 'action-denial', zone: 'j' },
		},
		bingliang: {
			operation: 'create-state',
			state: { family: 'delayed-control', dimension: 'resource-denial', zone: 'j' },
		},
		shandian: {
			operation: 'create-state',
			state: { family: 'delayed-hazard', dimension: 'damage-risk', zone: 'j' },
		},
		guohe: { operation: 'remove-target-card' },
		shunshou: { operation: 'remove-target-card' },
	},
	camps: { self: '自己', ally: '同阵营', enemy: '敌对阵营', third: '第三方' },
	events: {
		turnStart: 'phaseBegin', phaseStart: 'phaseBegin', cardUsed: 'useCard',
		damage: 'damage', dying: 'dying', death: 'die',
	},
	relationOf: null,
	winCondition: null,
};

/* ---------- 内部状态 ---------- */
let _profile = null;

function _merge(base, p) {
	p = p || {};
	const out = {};
	Object.keys(base).forEach(function (k) {
		if (k === 'semanticIds' || k === 'phases' || k === 'camps' || k === 'events' || k === 'featureBuckets' || k === 'strategicEffects') {
			out[k] = Object.assign({}, base[k], p[k] || {});
		} else {
			out[k] = (p[k] === undefined) ? base[k] : p[k];
		}
	});
	return out;
}

/** 取当前档案 */
export function getProfile() { return _profile; }

/** 取当前档案（等待就绪） */
export function ready() { return !!_profile; }

/**
 * 设置游戏档案：可传完整档案，也可只传部分字段做局部覆盖
 * @param {object} p
 */
export function setProfile(p) {
	_profile = _merge(_profile || NONAME_PROFILE, p);
	setMapping(_profile);
	return _profile;
}

/** 用当前档案重刷语义映射（档案被就地修改后调用） */
export function applyProfile() {
	setMapping(_profile || NONAME_PROFILE);
	return _profile;
}

/** 档案就绪度：哪些项已填、哪些待填 */
export function profileReadiness() {
	const prof = _profile || NONAME_PROFILE;
	const sem = coverage();

	const numFilled = function (obj) {
		obj = obj || {};
		const keys = Object.keys(obj);
		const ok = keys.filter(function (k) {
			const v = obj[k];
			if (v === null || v === undefined || v === '') return false;
			if (typeof v === 'object') return Object.keys(v).length > 0;
			return true;
		});
		return { filled: ok.length, total: keys.length, missing: keys.filter(function (k) { return ok.indexOf(k) < 0; }) };
	};

	const phases = numFilled(prof.phases);
	const camps = numFilled(prof.camps);
	const events = numFilled(prof.events);

	const pending = []
		.concat(sem.missing.map(function (s) { return '语义类未填: ' + s; }))
		.concat(phases.missing.map(function (k) { return '阶段未填: ' + k; }))
		.concat(camps.missing.map(function (k) { return '阵营未填: ' + k; }))
		.concat(events.missing.map(function (k) { return '事件未填: ' + k; }));

	return {
		id: prof.id,
		name: prof.name,
		engine: prof.engine,
		semantic: sem,
		phases: phases,
		camps: camps,
		events: events,
		optional: { relationOf: typeof prof.relationOf === 'function', winCondition: typeof prof.winCondition === 'function' },
		pending: pending,
		ready: sem.missing.length === 0 && phases.missing.length === 0,
	};
}

/* ★ 模块加载即生效：用内置档案填充语义表，保证内核开箱可用 */
setProfile(null);
