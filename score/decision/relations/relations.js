/*
 * ============================================
 * // 作者: 飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 关系系统统一模块（Relations） =================
 * 四个互相耦合的系统在此收口，成为全工程唯一的权威定义源：
 *
 *  ① 暴露系统（exposureOf）   —— 只“记录认知”，不下结论
 *        mePlayer 对 target 的「知晓程度 / 认知来源 / 明暗」。
 *        —— 仅供外部读取，不在这里判定敌友，语义单一。
 *
 *  ② 阵营系统（campRelationOf）—— 胜负条件上的归属关系（四态）
 *        'same' 同阵营 | 'opposite' 异阵营
 *        'independent' 独立（内奸/野心家：不站任何一方）
 *        'unknown' 未知（身份/势力未明 → 中立，不推定敌）
 *        —— 明确与“敌我”分离：只回答“谁和谁是一伙的规则关系”。
 *
 *  ③ 敌我系统（dispositionOf） —— 此刻我该把 target 当朋友还是敌人（三态）
 *        +1 友方 | -1 敌人 | 0 中性
 *        以宿主 get.attitude 为同源基线，叠加暴露系统提供的行为证据
 *        做“软翻转”：高置信疑似敌人 → -1；高置信疑似队友 → +1；其余保持中性。
 *
 *  ④ 收益系统（actionValue）   —— 一次行动的净收益统一入口
 *        actionValue(me, act) 返回一个收益数值（正=该做，负=不该做）。
 *        内部采用「relation-only → state-transition utility」双层语义：
 *          - 攻击/纯控制    只对 disposition<0 的真实敌人给正收益，否则强负；
 *          - 拆除(过河/顺手) 状态转换：拆敌人/拆队友负面判定区(乐/兵/闪电)为正，
 *            拆队友普通好牌为强负（不再 relation-only 恒罚队友）；
 *          - 状态转换(铁索)  交回 tiesuoEvaluator 唯一权威，本处不越权打分（中性 base）；
 *          - 辅助/救援/增益  只对 disposition>0 的真实队友给正收益，否则强负；
 *          - 中性目标一律给负（不做无用/伤己事）。
 *        收敛了原本散落的 targetScore / decisionBoost / hiddenIdentity 等多处口径。
 *
 * 本模块为纯计算，只 import 宿主与 observer 的“读取类”API，不触碰本体的记分。
 */
import { game, get } from '../../foundation/adapt/host.js';
import { getModeStrategy } from '../strategy/modeStrategy.js';
import { currentMode, isLikelyEnemy, isLikelyAlly, confidenceOfFor as idConfidenceOfFor, identityOfFor, hardIdentityOf, isRolePossibleFor } from '../../perception/observer/identity.js';
import { spyDispositionOf } from '../strategy/identityStance.js';

function _isIdentityMode() {
	try {
		if (currentMode() === 'identity') return true;
		const strategy = getModeStrategy();
		return !!(strategy && (strategy.name === 'identity' || strategy.name === 'connect'));
	} catch (e) { return false; }
}

/* ================= 暴露系统（exposureOf） =================
 * 返回对 target 的“认知状态”，只记录，不下敌友结论。
 * 字段语义：
 *   shown        target 是否明置身份/势力（可被观测到的公开信息）
 *   known        我方当前对该目标“身份已知程度” 0~1
 *   source       认知来源（'shown_lord' 主公明置 / 'shown_id' 身份明置 /
 *                'dead_id' 阵亡公开 / 'infer' 行为推断 / 'none' 无）
 *   inferConfidence 行为推断置信度（identity 局非零）
 */
function exposureOf(me, t) {
	try {
		if (!t) return { shown: false, known: 0, source: 'none', inferConfidence: 0 };
		const identityMode = _isIdentityMode();
		/* 身份局严格只认公开身份；国战等其它模式保留原有“公开 group”语义。 */
		let shown = identityMode
			? (!!t.identityShown || t === game.zhu || t.identity === 'mingzhong')
			: (!!t.identityShown || (!!t.group && t.identityShown !== false));
		let source = 'none';
		let known = 0;

		/* 主公必然明置（身份局） */
		try {
			if (t === game.zhu) { shown = true; source = 'shown_lord'; known = 1; }
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		if (t.identityShown) { shown = true; source = 'shown_id'; known = 1; }
		else if ((t.hp !== undefined && t.hp <= 0) && t.identityShown) { shown = true; source = 'dead_id'; known = 1; }

		/* 行为推断置信度（identity 局才有非零值） */
		let conf = 0;
		try { conf = idConfidenceOfFor(me, t); } catch (e) { conf = 0; }
		if (known < 1 && conf > 0) {
			known = Math.max(known, conf);
			if (source === 'none') {
				const hard = hardIdentityOf(me, t);
				source = hard && hard.source === 'unique_remaining_slot' ? 'constraint' : 'infer';
			}
		}

		return { shown: shown, known: Math.round(known * 100) / 100, source: source, inferConfidence: Math.round(conf * 100) / 100 };
	} catch (e) { return { shown: false, known: 0, source: 'none', inferConfidence: 0 }; }
}

/* ================= 阵营系统（campRelationOf） =================
 * 返回 me/t 在“胜负条件归属”上的关系（四态）。
 * 判定依据：模式策略 getCamp 归类的阵营标识 + 独立角色识别。
 * 独立（内奸/野心家）：与任何一方既不“同”也不“异”，专为 remain 独立。
 * 未知（身份/势力未明）：返回 'unknown'，绝不fallback成“异/敌”。
 */
function campRelationOf(me, t) {
	try {
		if (!me || !t || me === t) return 'same';
		/* 独立身份按 observer 视角识别；target 未公开时不得直接读取真实 identity。 */
		if (isIndependent(me, t)) return 'independent';
		if (isIndependent(me, me)) return 'independent';

		const ca = getCampOf(me, me);
		const cb = getCampOf(t, me);
		if (ca === 'unknown' || cb === 'unknown') return 'unknown';
		if (ca === cb) return 'same';
		return 'opposite';
	} catch (e) { return 'unknown'; }
}

function isIndependent(observer, p) {
	try {
		if (!p) return false;
		if (p.isYezin || (p.identityShown && p.identity === 'yezin')) return true;
		const role = (observer && p === observer)
			? (p === game.zhu ? 'zhu' : p.identity)
			: identityOfFor(observer || null, p);
		return role === 'nei';
	} catch (e) { return false; }
}

/* 取可比较的阵营标识。身份局中 target 未公开时只允许合法 posterior 补足。 */
function getCampOf(p, observer) {
	try {
		const s = getModeStrategy();
		let base = 'unknown';
		if (s && typeof s.getCamp === 'function') base = String(s.getCamp(p) || 'unknown');
		if (base !== 'unknown') return base;

		if (s && (s.name === 'identity' || s.name === 'connect')) {
			const role = (observer && p === observer)
				? (p === game.zhu ? 'zhu' : p.identity)
				: identityOfFor(observer || null, p);
			if (role === 'zhu' || role === 'zhong' || role === 'mingzhong') return 'loyal';
			if (role === 'fan') return 'rebel';
			if (role === 'nei') return 'nei';
			return 'unknown';
		}
		return String((p && p.group) || 'unknown');
	} catch (e) { return 'unknown'; }
}

/* 快捷同阵营判断（供既有调用方，语义与四态中的 same 一致） */
function isSameCamp(a, b) { return campRelationOf(a, b) === 'same'; }

/* ================= 敌我系统（dispositionOf） =================
 * 返回 me 眼里 t 的处置关系：+1 友 / -1 敌 / 0 中性。
 *
 * 身份模式：
 *   - 禁止调用宿主 get.attitude / isFriend 作为输入，因为本体身份 AI 可能读取未公开 identity；
 *   - 只消费公开事实、observer-specific posterior、规则剩余槽位；
 *   - “身份不可能”由 isRolePossibleFor 判断，绝不用四舍五入后的概率 === 0；
 *   - 内奸 identity 固定；stance 统一委托 identityStance.js，避免多处阈值漂移。
 *
 * 其它模式保持宿主关系语义作为兜底。
 */
function _identityDisposition(me, t) {
	try {
		const myRole = me === game.zhu ? 'zhu' : me.identity;
		if (myRole === 'nei') return spyDispositionOf(me, t);

		if (isLikelyEnemy(me, t)) return -1;
		if (isLikelyAlly(me, t)) return 1;

		/* 规则层排除：忠/主只把仍可能为反的未知人保留为“可疑”；
		 * fan 槽位耗尽时明确 neutral，但不升级成 ally。 */
		if (myRole === 'zhu' || myRole === 'zhong' || myRole === 'mingzhong') {
			if (!isRolePossibleFor(me, t, 'fan')) return 0;
		} else if (myRole === 'fan') {
			if (t === game.zhu) return -1;
			if (!isRolePossibleFor(me, t, 'zhong')) return 0;
		}
		return 0;
	} catch (e) { return 0; }
}

function dispositionOf(me, t) {
	if (!me || !t || t === me) return 0;
	try {
		if (_isIdentityMode()) return _identityDisposition(me, t);
	} catch (eMode) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eMode); }

	/* 非身份模式保留宿主关系逻辑。 */
	try { if (t.isFriend && t.isFriend(me)) return 1; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	let att = 0;
	try { att = (get && typeof get.attitude === 'function') ? get.attitude(me, t) : 0; } catch (eA) { att = 0; }
	if (att < 0) return -1;
	if (att > 0) return 1;
	return 0;
}
function isAllyOf(me, t) { return dispositionOf(me, t) === 1; }
function isNeutralOf(me, t) { return dispositionOf(me, t) === 0; }
function isEnemyOfR(me, t) { return dispositionOf(me, t) === -1; }
/* ★ 规范名：isEnemyOf（与 isAllyOf/isNeutralOf 对齐三元；isEnemyOfR 仅作历史别名保留） */
const isEnemyOf = isEnemyOfR;

/**
 * 关系世界状态指纹：只编码“决策上会改变敌我判断/置信度”的结果，不绑定任何具体身份事件。
 * 用途：同一回合内关系翻转时，让 bestAction / enemiesOf / situationFactor 等缓存即时失效。
 */
function relationStateKey(me) {
	try {
		if (!me) return 'no_me';
		const out = [];
		for (const p of (game.players || [])) {
			if (!p || p === me || p.alive === false) continue;
			const k = String(p.playerid || p.name1 || p.name || p.name2 || '?');
			const ex = exposureOf(me, p);
			const d = dispositionOf(me, p);
			out.push(k + ':' + d + ':' + (ex.source || 'none') + ':' + Number(ex.known || 0).toFixed(2));
		}
		out.sort();
		return out.join('|');
	} catch (e) { return 'relation_error'; }
}

/* 判定区是否含「负面」延时牌（乐/兵/闪电）——拆除类动作的状态转换效用判据。
 * ★ 指令 05 Stage D：过河拆/顺手 队友的乐、兵、闪电是帮队友（正面状态转换），
 * 与拆队友好牌（负面）区分。卡名按本工程内既有口径匹配（同 threat.js / wuxieEvaluator）。 */
function _hasNegativeJudge(t) {
	try {
		if (!t || typeof t.getCards !== 'function') return false;
		const j = t.getCards('j');
		if (!Array.isArray(j)) return false;
		for (const c of j) {
			let n = '';
			try { if (get && typeof get.name === 'function') n = get.name(c, t); } catch (e) { n = ''; }
			if (typeof n !== 'string' || !n) n = (c && typeof c.name === 'string') ? c.name : ((c && typeof c.id === 'string') ? c.id : '');
			if (n === 'lebu' || n === 'bingliang' || n === 'shandian') return true;
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return false;
}

/* ================= 收益系统（actionValue） =================
 * 一次行动的净收益统一入口。act: { type, id, ... }。
 * 内部用“单调三态强判定”把目标方向写死：
 *   - attack/control/dismantle(i.e. 对敌动作)：目标非真敌 ≈ 强负；
 *   - support/save/gain(+target 为某玩家的正面动作)：目标非真友 ≈ 强负；
 *   - 中性目标（无明确敌我也）：给负（不做无依据事）。
 * 再叠加：卡牌/技能基础分（由调用方传入 act.base）、残血收割、威胁度等。
 * 供 engine / skillPlayBrain / cardPlayBrain 统一调用，收敛分散口径。
 * act.target 既可是玩家对象，也可是玩家 name（自动解析）。
 *
 * 返回值约定：正数越该做，负数越不该做；建议评分相加。
 */
function actionValue(me, act) {
	act = act || {};
	try {
		const purpose = act.purpose || inferPurpose(act);
		const tgt = act.targetObj || resolveTarget(act.target);
		const base = (typeof act.base === 'number') ? act.base : 0;

		/* ---- 无目标（作用于自己/全场） ---- */
		if (!tgt || tgt === me) {
			/* 全场AOE（nanman/wanjian）会打到自己与队友，留待 base 自评，这里只给中性微调 */
			return base + (act.aoecd ? 0 : 0);
		}

		const d = dispositionOf(me, tgt);
		/* ---- 攻击/控制：只对真敌正收益 ---- */
		if (purpose === 'attack' || purpose === 'kill' || purpose === 'damage' ||
			purpose === 'control') {
			if (d < 0) {
				/* 真敌：基础分 + 收割/威胁加成 */
				let v = base;
				try { if ((tgt.hp !== undefined && tgt.hp <= 1)) v += 2.0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				try { if ((tgt.hp !== undefined && tgt.hp <= 2)) v += 1.0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				return Math.round(v * 100) / 100;
			}
			if (d === 0) return Math.min(base, -3.0);   /* 中性/身份未明 → 拒绝盲打 */
			return -8.0;                                 /* 真友 → 强罚（绝不打队友） */
		}

		/* ---- 拆除（过河/顺手）：状态转换效用，非 relation-only ----
		 * 拆敌人正收益；拆队友的负面判定区(乐/兵/闪电)=帮队友→正；拆队友好牌→强罚。 */
		if (purpose === 'dismantle') {
			if (d < 0) {
				let v = base;
				try { if ((tgt.hp !== undefined && tgt.hp <= 1)) v += 2.0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				try { if ((tgt.hp !== undefined && tgt.hp <= 2)) v += 1.0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				return Math.round(v * 100) / 100;
			}
			if (d > 0) {
				/* ★ 反例覆盖：过河拆/顺手 队友的乐、兵、闪电 = 解除队友负面状态 → 正收益 */
				if (_hasNegativeJudge(tgt)) return Math.round((base + 3.0) * 100) / 100;
				return -8.0;                             /* 拆队友好牌(装备/手牌) → 强罚 */
			}
			return Math.min(base, -3.0);                 /* 中性/身份未明 → 不盲拆 */
		}

		/* ---- 状态转换（铁索横置/解横置）：state-transition utility ----
		 * 「使用/重铸/目标」由 tiesuoEvaluator 唯一决定；此处关系方向守卫不越权打分，
		 * 返回 base 保持中性，避免把「解横置队友/横置敌人」误判成 relation-only 的敌向/友向。 */
		if (purpose === 'state') return base;

		/* ---- 辅助/救援/增益：只对真友正收益 ---- */
		if (purpose === 'support' || purpose === 'save' || purpose === 'gain' ||
			purpose === 'heal') {
			if (d > 0) {
				let v = base;
				try { if ((tgt.hp !== undefined && tgt.hp <= 0)) v += 3.0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				try { if ((tgt.hp !== undefined && tgt.hp <= 1)) v += 1.0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				return Math.round(v * 100) / 100;
			}
			if (d === 0) return Math.min(base, -3.0);   /* 中性 → 不白给 */
			return -8.0;                                 /* 真敌 → 强罚（绝不资助敌人）★摸牌给敌方核心修复点 */
		}

		/* ---- 通用 ---- */
		return base;
	} catch (e) { return (act.base || 0); }
}

/* 解析目标：玩家对象 或 name 字符串 */
function resolveTarget(tgt) {
	try {
		if (!tgt) return null;
		if (tgt && typeof tgt === 'object' && tgt.name) return tgt;
		if (typeof tgt === 'string') {
			for (const p of (game.players || [])) {
				if (p && (p.name1 || p.name || '') === tgt) return p;
			}
			return null;
		}
		return null;
	} catch (e) { return null; }
}

/* 推断动作用途（供未显式声明 purpose 的调用方）
 * ★ 指令 05 Stage D · 动作语义唯一源（唯一粗分类权威，禁止其它模块再维护第二套）：
 *   attack     单点/AOE 伤害：sha/juedou/huogong/nanman/wanjian/zhujin/leisha/huosha
 *   control    纯控制（贴敌人判定区/借刀）：lebu/bingliang/jiedao（jiedao=借刀 pair 卡，Stage F 深化）
 *   dismantle  拆除（过河/顺手）：guohe/shunshou —— 状态转换效用（拆队友负面判定区=帮队友）
 *   state      状态转换（横置集合 toggle）：tiesuo —— 交回 tiesuoEvaluator 唯一权威
 *   heal       回血/群体回复：tao/taoyuan
 *   gain       给牌/输送（技/牌赠予）：dingming/yiji/rendezvous/rende/chuansong
 *   注意：shandian(闪电) 对自己使用、入己判定区并轮转，非“贴敌人”，不归 control（→ generic，
 *         其用/不用由 judgeBrain.vetoJudge 唯一决定）。 */
function inferPurpose(act) {
	try {
		const id = act.id || (act.card && (act.card.name || act.card.id)) || '';
		if (!id) return 'generic';
		const ATK = ['sha', 'juedou', 'huogong', 'nanman', 'wanjian', 'zhujin', 'leisha', 'huosha'];
		const CTRL = ['lebu', 'bingliang', 'jiedao'];
		const DISMANTLE = ['guohe', 'shunshou'];
		const STATE = ['tiesuo'];
		const HEAL = ['tao', 'taoyuan'];
		const GIVE = ['dingming', 'yiji', 'rendezvous', 'rende', 'chuansong'];
		if (HEAL.indexOf(id) >= 0) return 'heal';
		if (DISMANTLE.indexOf(id) >= 0) return 'dismantle';
		if (STATE.indexOf(id) >= 0) return 'state';
		if (CTRL.indexOf(id) >= 0) return 'control';
		if (ATK.indexOf(id) >= 0) return 'attack';
		if (GIVE.indexOf(id) >= 0) return 'gain';
		return 'generic';
	} catch (e) { return 'generic'; }
}

/* 快捷：判断某动作作用于目标是否为“合理的正向选择”（供目标排序） */
function directionScore(me, act, t) {
	try {
		const purpose = act.purpose || inferPurpose(act);
		const d = dispositionOf(me, t);
		if (purpose === 'attack' || purpose === 'control') {
			if (d < 0) return 1;
			if (d === 0) return -1;
			return -3;
		}
		if (purpose === 'dismantle') {
			if (d < 0) return 1;
			if (d > 0) return _hasNegativeJudge(t) ? 1 : -3;   /* 拆队友负面判定→正，拆队友好牌→负 */
			return -1;
		}
		if (purpose === 'state') return 0;   /* 横置/解横置交回 tiesuoEvaluator，不做关系方向加减分 */
		if (purpose === 'support' || purpose === 'save' || purpose === 'heal' || purpose === 'gain') {
			if (d > 0) return 1;
			if (d === 0) return -1;
			return -3;
		}
		return 0;
	} catch (e) { return 0; }
}

/* ================= 生命周期 ================= */
function resetRelations() {
	try { /* 观测定时自行失效，无需强清 */ } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= 导出 ================= */
export {
	exposureOf, campRelationOf, isSameCamp, isIndependent,
	dispositionOf, isAllyOf, isNeutralOf, isEnemyOf, isEnemyOfR, relationStateKey,
	actionValue, directionScore, inferPurpose, resetRelations,
};