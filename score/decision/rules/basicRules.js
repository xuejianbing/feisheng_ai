/* 职责：卡牌、技能、装备、判定和目标的基本规则；不生成执行事务、不写训练样本。 */
import { lib, game, get } from '../../foundation/adapt/host.js';
import { decideCard, classifyCard, pickTarget as pickCardTarget } from '../cardplay/cardPlayBrain.js';
import { decideSkill } from '../skills/skillPlayBrain.js';
import { decideEquip } from '../basic/equipBrain.js';
import { decideJudge } from '../basic/judgeBrain.js';
import { pickTargetByPurpose, targetScore as targetBrainScore } from '../basic/targetBrain.js';
import { buildTargetCandidate } from '../state/playerSnapshot.js';
import { skillProfileOf } from '../skills/skills.js';
import { isEnemyOf, isAllyOf, probHasShan, threatOf } from '../threat/threat.js';
import { identityBiasOf } from '../../perception/observer/identity.js';
import { isSameCamp, isEnemy } from '../strategy/modeStrategy.js';
import { probHasCard } from '../../model/predict/handInference.js';
import { vetoCandidate, setCandidatePriority, PRIORITY_TIER } from '../state/actionCandidate.js';
function applyBasicCardPlayRules(me, acts) {
	try {
		const targets = _buildTargetBrainCandidates(me);
		const meC = {};
		['sha', 'shan', 'tao', 'jiu', 'wuxie'].forEach(function (k) {
			try { meC[k] = me.countCards ? me.countCards('hs', k) : 0; } catch (e) { meC[k] = 0; }
		});
		let hasRejudge = false;
		try {
			const RJ = ['guicai', 'zhongyi', 'hongyan', 'tianbian', 'yusheng'];
			(me.skills || []).forEach(function (sid) { if (RJ.indexOf(sid) >= 0) hasRejudge = true; });
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		const ctx = {
			me: Object.assign({ hp: me.hp, maxHp: me.maxHp }, meC, { hasSuit: true }),
			hasRejudge: hasRejudge,
			enemyHasFire: false,
			targets: targets,
			targetLocked: true,
			hi: { identityBiasOf: identityBiasOf },
		};

		acts.forEach(function (a) {
			if (a.type !== 'card' && a.type !== 'equip') return;
			if (a.id === 'tiesuo') return;
			const tidx = a.targetObj ? targets.findIndex(function (t) { return t && t.pp === a.targetObj; }) : -1;
			const d = decideCard(a.id, ctx, tidx);
			if (d.veto) {
				vetoCandidate(a, d.vetoReason);
				a.reason = (a.reason || '') + '（[基本规则否决] ' + d.vetoReason + '）';
				a.rule = 'veto';
			} else if (d.priority >= 99) {
				const killCritical = d.category === 'output' &&
					['sha', 'huosha', 'leisha'].indexOf(a.id) >= 0;
				const priorityReason = killCritical ? '可直接完成击杀' : '高优先纯收益';
				setCandidatePriority(a, PRIORITY_TIER.CRITICAL, d.priority, priorityReason);
				a.reason = (a.reason || '') + '（[高优先] ' + priorityReason + '）';
				a.rule = killCritical ? 'kill' : 'critical';
				a.rulePriority = d.priority;
			} else {
				setCandidatePriority(a, PRIORITY_TIER.NORMAL, d.priority, '');
				a.rule = d.category;
				a.rulePriority = d.priority;
			}
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ Skill Decision Kernel V2：宿主合法目标过滤
 * 只在可以安全静态判定时排除非法目标；复杂/依赖选牌/事件态的 filterTarget 一律 fail-open。
 */
function _skillTargetDependsOnCard(filterTarget) {
	try {
		if (typeof filterTarget !== 'function') return false;
		const src = filterTarget.toString();
		const body = src.indexOf('=>') >= 0 ? src.slice(src.indexOf('=>') + 2) : src.slice(src.indexOf('{') + 1);
		return /\bcard\b/.test(body);
	} catch (e) { return true; }
}

function _isLegalSkillTarget(sid, me, target) {
	try {
		const sk = lib.skill && lib.skill[sid];
		if (!sk || typeof sk.filterTarget !== 'function') return true;
		const dependsOnCard = _skillTargetDependsOnCard(sk.filterTarget);
		let r;
		try { r = sk.filterTarget(null, me, target); } catch (e) { return true; }
		if (r === false && dependsOnCard) return true;   /* 选牌前无法确证非法 */
		return r !== false;
	} catch (e) { return true; }
}

function _skillNeedsExternalTarget(sid, prof) {
	try {
		const cats = (prof && prof.tags && prof.tags.__targets) || [];
		/* 纯 self 技能不进入“找不到友/敌目标”的否决。 */
		if (cats.length === 1 && cats[0] === 'self') return false;
		if (cats.indexOf('ally') >= 0 || cats.indexOf('enemy') >= 0 || cats.indexOf('multi') >= 0) return true;
		const sk = lib.skill && lib.skill[sid];
		return !!(sk && typeof sk.filterTarget === 'function');
	} catch (e) { return false; }
}

function _canConfirmSelfSkillTarget(sid, me, prof) {
	try {
		const cats = (prof && prof.tags && prof.tags.__targets) || [];
		const sk = lib.skill && lib.skill[sid];
		const explicitSelf = cats.indexOf('self') >= 0;
		if (!sk || typeof sk.filterTarget !== 'function') return explicitSelf;
		if (_skillTargetDependsOnCard(sk.filterTarget) && !explicitSelf) return false;
		let r;
		try { r = sk.filterTarget(null, me, me); } catch (e) { return explicitSelf; }
		return r !== false && (explicitSelf || (prof && prof.targets && prof.targets.intent === 'support'));
	} catch (e) { return false; }
}

function _skillTargetRange(sid) {
	try {
		const sk = lib.skill && lib.skill[sid];
		if (!sk) return null;
		const st = sk.selectTarget;
		/* 宿主负数 selectTarget（典型 -1）有自动/特殊选择语义，不按普通数量解释。 */
		if (typeof st === 'number') return st >= 0 ? [st, st] : null;
		if (Array.isArray(st) && st.length >= 2) {
			const min = Number(st[0]);
			const max = st[1] === Infinity ? Infinity : Number(st[1]);
			if (Number.isFinite(min) && min >= 0 && (max === Infinity || (Number.isFinite(max) && max >= 0))) {
				return [min, max === Infinity ? Infinity : Math.max(min, max)];
			}
		}
		/* 有 filterTarget 而无 selectTarget 时，宿主默认单目标。 */
		if (typeof sk.filterTarget === 'function' && st == null) return [1, 1];
		/* 动态函数依赖实时事件/已选对象，不在预规划阶段猜。 */
		return null;
	} catch (e) { return null; }
}

function _skillPurposeFromIntent(intent, category, confidence) {
	const c = (confidence === undefined || confidence === null) ? 1 : Number(confidence || 0);
	if (intent === 'offense') return c >= 0.55 ? 'attack' : null;
	if (intent === 'support') return c >= 0.55 ? 'support' : null;
	if (intent === 'mixed') return null;
	if (category === 'attack' || category === 'control') return 'attack';
	if (category === 'defense' || category === 'aux') return 'support';
	return null;
}

function _isSingleTargetSkillProfile(prof, decision) {
	try {
		const tags = (prof && prof.tags) || {};
		const cats = tags.__targets || [];
		const scope = tags.__scope || null;
		if (cats.indexOf('multi') >= 0) return false;
		if (prof && prof.targets && prof.targets.category === 'all') return false;
		if (scope === 'all' || scope === 'all_others' || scope === 'anyN'
			|| scope === 'enemyN' || scope === 'allyN' || scope === 'selfN') return false;
		if (decision && Array.isArray(decision.targetIndexes) && decision.targetIndexes.length > 1) return false;
		return true;
	} catch (e) { return false; }
}

/* ★ 基本技能决策标准接入层
 * 在 acts.sort 之前对 skill 候选应用 skillPlayBrain 的三段式标准：
 *   - 硬否决（负收益/自伤/时机不符/无可控敌）→ 压到接近结束回合
 *   - 其余按运行时优先级小幅加权（不改动既有技能多维评分主权重）
 */
function applyBasicSkillRules(me, acts) {
	try {
		const players = game.players || [];
		const targets = [];
		players.forEach(function (p) {
			if (!p || p === me || p.alive === false) return;
			/* 敌我系统（attitude 三态，与阵营 isSameCamp 分离） */
			let ally = false, en = false;
			try { ally = isAllyOf(me, p); en = isEnemyOf(me, p); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			let threat = 0;
			try { const th = threatOf(p); threat = (typeof th === 'number') ? th : 0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			targets.push({
			pp: p,           /* ★ 玩家对象引用：供技能目标索引解析成真实目标 */
				isAlly: ally, isEnemy: en,
				hp: (p.hp !== undefined ? p.hp : 3),
				maxHp: (p.maxHp || 3),
				threat: threat,
				handCount: 0,
			});
		});

		/* 濒死/健康度检测 */
		let dyingAlly = false, dyingMe = false;
		try {
			if (me.hp !== undefined && me.hp <= 0) dyingMe = true;
			targets.forEach(function (t) { if (t.isAlly && t.hp <= 0) dyingAlly = true; });
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		const econ = {
			lowHp: me.hp !== undefined && me.hp <= 1,
			damaged: me.hp !== undefined && me.hp < (me.maxHp || 3),
		};
		let stage = null;
		try { if (aliveCountP() <= 3) stage = 'endgame'; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		const ctx = {
			me: { hp: me.hp, maxHp: me.maxHp },
			targets: targets,
			econ: econ,
			stage: stage,
			dyingAlly: dyingAlly,
			dyingMe: dyingMe,
			hi: { identityBiasOf: identityBiasOf },   /* ★ 深度连接：注入身份信念源（技能目标选择用，非 identity 局恒 0） */
		};

		acts.forEach(function (a) {
			if (a.type !== 'skill') return;
			const sid = a.id;
			let prof = null;
			try { prof = skillProfileOf(sid); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			if (!prof) return;

			/* 每个技能都用自己的 filterTarget 生成合法候选，禁止“全体玩家池”直接复用。
			 * 例如炜烈 target.isDamaged()：满血角色不会再进入推荐目标。 */
			const skillTargets = targets.filter(function (t) {
				return t && t.pp && _isLegalSkillTarget(sid, me, t.pp);
			});
			/* 明确允许 self 的辅助技能，把自己作为真实候选加入；
			 * 未显式 self 时，仅在 filterTarget 可无卡牌上下文确证允许且 intent=support 时加入。 */
			if (_canConfirmSelfSkillTarget(sid, me, prof)) {
				skillTargets.unshift({
					pp: me, isAlly: true, isEnemy: false,
					hp: (me.hp !== undefined ? me.hp : 3),
					maxHp: (me.maxHp || 3), threat: 0, handCount: 0,
				});
			}
			const skillCtx = Object.assign({}, ctx, {
				targets: skillTargets,
				selectTargetRange: _skillTargetRange(sid),
			});
			const d = decideSkill(sid, prof, skillCtx);

			/* 高置信单方向技能没有合法/合理目标时，直接压制本轮发动；
			 * mixed/低置信技能仍 fail-open 交给宿主。 */
			const ti = prof.targets && prof.targets.intent;
			const tc = prof.targets ? Number(prof.targets.confidence || 0) : 0;
			const inferredTargetIntent = !!(prof.targets && prof.targets.inferred);
			a.targetIntent = ti || null;
			a.targetConfidence = tc;
			a.targetInferred = inferredTargetIntent;
			const directional = (ti === 'support' || ti === 'offense') && tc >= 0.55
				&& _skillNeedsExternalTarget(sid, prof);
			if (!d.veto && directional && d.targetRequired !== false
				&& d.targetDecisionResolved !== false && d.targetIndex < 0 && skillTargets.length > 0) {
				vetoCandidate(a, '无合法' + (ti === 'support' ? '友方' : '敌方') + '目标');
				a.reason = (a.reason || '') + '（[技能目标否决] 无合法' + (ti === 'support' ? '友方' : '敌方') + '目标）';
				a.rule = 'veto-target';
				return;
			}
			if (!d.veto && directional && d.targetRequired !== false
				&& d.targetDecisionResolved !== false && skillTargets.length === 0) {
				vetoCandidate(a, '无合法目标');
				a.reason = (a.reason || '') + '（[技能目标否决] 无合法目标）';
				a.rule = 'veto-target';
				return;
			}
			if (d.veto) {
				vetoCandidate(a, d.vetoReason);
				a.reason = (a.reason || '') + '（[技能否决] ' + d.vetoReason + '）';
				a.rule = 'veto';
			} else {
				setCandidatePriority(a, PRIORITY_TIER.NORMAL, d.priority, '');
				a.rule = d.category;
				a.rulePriority = d.priority;
				/* ★ 按技能自身类别写回【专属目标】：敌方技→真敌，己方辅助/增益→真友
				 *   修复此前技能 act 从不携带 target，导致"限制敌方技能"与"给己方摸牌技能"都落到同一无名目标 */
				if (typeof d.targetIndex === 'number' && d.targetIndex >= 0) {
					const tk = skillTargets[d.targetIndex];
					if (tk && tk.pp) {
						a.target = tk.pp.name1 || tk.pp.name || '';
						a.targetObj = tk.pp;
						/* provenance：只有真正经过 kernel 合法目标池 + decideSkill 解析出的目标，
						 * 才允许后续宿主桥消费。 */
						a.skillTargetResolved = true;
						a.skillTargetSingle = _isSingleTargetSkillProfile(prof, d);
						a.targetRule = d.rule + '→' + a.target + '(' + d.reason + ')';
						a.reason = (a.reason || '') + '（对象：' + a.target + '）';
						/* ★ 技能方向(purpose)：按技能类别映射，供统一收益守卫 actionValue 强判方向
						 *   attack/control → 敌向；defense/aux(辅助/增益) → 友向；其余由守卫回退。 */
						const _cat = d.category || d.rule || '';
						/* 目标 intent 高于技能大类：target.draw() 可能是辅助技，不能因 category=draw
						 * 又被翻译成 attack。mixed 则刻意不设 purpose，交回原生/专属策略。 */
						const _purpose = _skillPurposeFromIntent(ti, _cat, tc);
						if (_purpose) a.purpose = _purpose;
					}
				}
				/* ★ 多目标技能：写回 targetList（全部真敌/真友玩家对象），
				 *   供收益方向守卫逐目标判定整体方向，避免只判主目标漏判。 */
				if (Array.isArray(d.targetIndexes)) {
					a.targetRangeResolved = d.targetRangeResolved !== false;
					a.targetDecisionResolved = d.targetDecisionResolved !== false;
					a.targetRequired = d.targetRequired !== false;
					const list = [];
					d.targetIndexes.forEach(function (ti) {
						const tt = skillTargets[ti];
						if (tt && tt.pp && list.indexOf(tt.pp) < 0) list.push(tt.pp);
					});
					if (list.length) {
						a.targetList = list;
						a.targetListRule = d.rule + '(多目标×' + list.length + ')';
					}
				}
			}
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
function aliveCountP() {
	try { return (game.players || []).filter(function (p) { return p && p.alive !== false; }).length; } catch (e) { return 8; }
}

/* ★ 基本装备决策标准：对 equip 候选应用 equipBrain（立即装/同槽替换/藤甲否决） */
function applyBasicEquipRules(me, acts) {
	try {
		const slotHas = {};
		try {
			const e = me.getCards && me.getCards('e');
			if (e) e.forEach(function (c) {
				const n = get.name(c, me);
				const slot = equipSlotOf(n);
				if (slot && !slotHas[slot]) slotHas[slot] = n;
			});
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		let enemyHasFire = false;
		try {
			for (const p of (game.players || [])) {
				if (!p || p === me || p.alive === false) continue;
				if (!isEnemyOf(me, p)) continue;
				/* ★ V01修复：不再读对手手牌内容（透视作弊）。改用合法概率推断火系威胁 */
				try {
					const fireP = Math.max(
						probHasCard(p, 'huogong'),
						probHasCard(p, 'huosha'),
						probHasCard(p, 'nanman'),
						probHasCard(p, 'zhujin')
					);
					if (fireP >= 0.15) enemyHasFire = true;
					/* 装备区属公开信息（可见），保留：敌方朱雀羽扇 → 火攻威胁高 */
					if (p.getEquip && (p.getEquip('zhuque'))) enemyHasFire = true;
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		acts.forEach(function (a) {
			if (a.type !== 'equip' && a.type !== 'card') return;
			const id = a.id;
			const slot = equipSlotOf(id);
			if (!slot) return;
			const ctx = { enemyHasFire: enemyHasFire };
			ctx[slot] = slotHas[slot] || null;
			const d = decideEquip(id, ctx);
			if (d.veto) {
				vetoCandidate(a, d.vetoReason);
				a.reason = (a.reason || '') + '（[装备否决] ' + d.vetoReason + '）';
				a.rule = 'veto';
			} else {
				setCandidatePriority(a, PRIORITY_TIER.NORMAL, d.priority, '');
				a.rule = 'equip:' + d.category;
				a.rulePriority = d.priority;
			}
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
function equipSlotOf(id) {
	if (!id) return null;
	const W = ['muniu','zhuge','qinggang','qinglong','guding','guanshi','hanbing','jueying','qilin','zhangba','cixiong','zhuque','yiyang','fangtian'];
	const A = ['renwang','bagua','tengjia','baiyin'];
	const H = ['dilu','chitu','dawan','zixin','hualiu','zhuahuang'];
	if (W.indexOf(id) >= 0) return 'weapon';
	if (A.indexOf(id) >= 0) return 'armor';
	if (H.indexOf(id) >= 0) return 'horse';
	return null;
}

/* ★ 基本判定决策标准：对乐/兵/闪电候选应用 judgeBrain（贴敌/有改判才放闪电） */
function applyBasicJudgeRules(me, acts) {
	try {
		const players = game.players || [];
		let hasRejudge = false;
		try {
			const RJ = ['guicai','zhongyi','hongyan','tianbian','yusheng','jinguo'];
			(me.skills || []).forEach(function (s) { if (RJ.indexOf(s) >= 0) hasRejudge = true; });
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		const targets = [];
		players.forEach(function (p) {
			if (!p || p === me || p.alive === false) return;
			/* ★ 指令 05 Stage C：统一经 buildTargetCandidate 归一 */
			const cand = buildTargetCandidate(me, p);
			if (cand) targets.push(cand);
		});
		acts.forEach(function (a) {
			if (a.type !== 'card') return;
			const id = a.id;
			if (id !== 'lebu' && id !== 'bingliang' && id !== 'shandian') return;
			let t = null;
			if (a.targetObj) {
				t = targets.find(function (cand) { return cand && cand.pp === a.targetObj; }) || null;
			}
			/* 闪电等无单外部目标牌允许 target=null；其余目标牌若候选未绑定则只做保守规则判断。 */
			const d = decideJudge(id, { me: { hp: me.hp }, target: t, targets: targets, hasRejudge: hasRejudge });
			if (d.veto) {
				vetoCandidate(a, d.vetoReason);
				a.reason = (a.reason || '') + '（[判定否决] ' + d.vetoReason + '）';
				a.rule = 'veto';
			} else {
				setCandidatePriority(a, PRIORITY_TIER.NORMAL, d.priority, '');
				a.rule = 'judge:' + d.category;
				a.rulePriority = d.priority;
			}
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ 按用途分散目标：卡牌 → 目标用途 粗映射（输出/击杀、控制、拆除）
 * 让不同用途的卡各自选中「该用途最合适」的目标，避免所有卡都死绑全局 bestT 同一个人。
 * 不在表内的卡（桃/酒/增益等）回退 bestT 兜底。
 */
const _CARD_PURPOSE = (function () {
	const m = {};
	['sha', 'huosha', 'leisha', 'juedou', 'zhujin', 'nanman', 'wanjian'].forEach(function (id) { m[id] = 'kill'; });
	['lebu', 'bingliang', 'shandian'].forEach(function (id) { m[id] = 'control'; });
	['guohe', 'shunshou'].forEach(function (id) { m[id] = 'dismantle'; });
	return m;
})();

/* 构建给 targetBrain 用的目标候选数组（pp 字段保留，便于落盘取回 Player）
 * ★ 指令 05 Stage A：主公判定已收敛至 playerSnapshot.isLordOf（统一权威）。 */
function _buildTargetBrainCandidates(me) {
	const arr = [];
	for (const p of (game.players || [])) {
		if (!p || p === me || p.alive === false) continue;
		/* ★ 指令 05 Stage C：统一经 buildTargetCandidate 归一 */
		const cand = buildTargetCandidate(me, p);
		if (cand) arr.push(cand);
	}
	return arr;
}

/* ★ 按卡牌用途独立选目标（bestT 只作兜底，不替它强制集火单人） */
function _buildCardDecisionContext(me) {
	const targets = _buildTargetBrainCandidates(me);
	const meC = {};
	['sha', 'shan', 'tao', 'jiu', 'wuxie'].forEach(function (k) {
		try { meC[k] = me.countCards ? me.countCards('hs', k) : 0; } catch (e) { meC[k] = 0; }
	});
	let hasRejudge = false;
	try {
		const RJ = ['guicai', 'zhongyi', 'hongyan', 'tianbian', 'yusheng'];
		(me.skills || []).forEach(function (sid) { if (RJ.indexOf(sid) >= 0) hasRejudge = true; });
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return {
		me: Object.assign({ hp: me.hp, maxHp: me.maxHp }, meC, { hasSuit: true }),
		hasRejudge: hasRejudge,
		enemyHasFire: false,
		targets: targets,
		hi: { identityBiasOf: identityBiasOf },
	};
}

/* 候选目标必须在评分前绑定。只有宿主明确是单外部目标时才绑定；
 * 无目标、自身、自动全体、多目标/动态目标保持未绑定，交给各自专用策略或宿主。 */
function _resolveCardCandidateTarget(me, id, ctx, fallback) {
	try {
		if (id === 'tiesuo') return { target: null, index: -1, score: 0, resolved: false, reason: '铁索由专用 evaluator 决定' };
		const info = lib.card && lib.card[id];
		const cat = classifyCard(id);
		if (cat === 'gain' || cat === 'equip' || cat === 'respond') {
			return { target: null, index: -1, score: 0, resolved: true, reason: '无外部单目标' };
		}
		if (info) {
			const st = info.selectTarget;
			if (info.notarget === true || info.toself === true || st === -1) {
				return { target: null, index: -1, score: 0, resolved: true, reason: '宿主声明无单外部目标' };
			}
			if ((typeof st === 'number' && st > 1)
				|| (Array.isArray(st) && st.length > 1 && (st[1] === Infinity || Number(st[1]) > 1))
				|| typeof st === 'function') {
				return { target: null, index: -1, score: 0, resolved: false, reason: '多目标/动态目标不预绑定' };
			}
		}
		const tk = pickCardTarget(id, ctx);
		if (tk && tk.index >= 0 && ctx.targets[tk.index] && ctx.targets[tk.index].pp) {
			return { target: ctx.targets[tk.index].pp, index: tk.index, score: Number(tk.score || 0), resolved: true, reason: tk.reason || '' };
		}
		if (fallback && info && typeof info.filterTarget === 'function') {
			const fi = ctx.targets.findIndex(function (t) { return t && t.pp === fallback; });
			if (fi >= 0) return { target: fallback, index: fi, score: 0, resolved: true, reason: '使用全局关注目标兜底' };
		}
		return { target: null, index: -1, score: 0, resolved: false, reason: '未解析目标' };
	} catch (e) {
		return { target: null, index: -1, score: 0, resolved: false, reason: '目标解析异常' };
	}
}

/* ★ 基本目标决策标准：为输出/击杀类卡标注推荐目标（targetBrain），供决策回读 */
function applyBasicTargetRules(me, acts) {
	try {
		const targets = [];
		for (const p of (game.players || [])) {
			if (!p || p === me || p.alive === false) continue;
			/* ★ 指令 05 Stage C：统一经 buildTargetCandidate 归一 */
			const cand = buildTargetCandidate(me, p);
			if (cand) targets.push(cand);
		}
		const map = { sha: 'kill', huosha: 'kill', leisha: 'kill', juedou: 'kill', zhujin: 'kill', nanman: 'kill', wanjian: 'kill' };
		/* ★ 按用途分散目标：控制/拆除类卡各自选最优目标，不再统一指向 bestT */
		Object.keys(_CARD_PURPOSE).forEach(function (id) { if (!(id in map)) map[id] = _CARD_PURPOSE[id]; });
		acts.forEach(function (a) {
			if (a.type !== 'card') return;
			const purpose = map[a.id];
			if (!purpose || !targets.length) return;
			const tk = pickTargetByPurpose(purpose, targets);
			if (tk.index >= 0) {
				a.targetRule = purpose + '→' + targets[tk.index].name + '(' + tk.score + ')';
				a.targetSuggestion = targets[tk.index].name;
				/* 评分完成后禁止再改 target；这里只记录诊断一致性。 */
				if (a.targetObj) a.targetConsistent = (a.targetObj === targets[tk.index].pp);
			}
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ targetBrain 动态目标精修
 * 在既有 bestT（威胁×风格全局最优）之上，仅当存在“明显更优的可收割/高击杀确定率之敌”时切目标。
 * 纯增量：不乘任何权重、不压任何既有分；只把收割机会让决策受益。
 * 返回目标对象（Player）；无更优则返回当前 bestT（或 null）。
 */
function pickKillTarget(me, tsMap, cur) {
	try {
		const cands = [];
		for (const p of (game.players || [])) {
			if (!p || p === me) continue;
			try { if (p.alive === false || (p.hp !== undefined && p.hp <= 0)) continue; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			let ally = false; try { ally = isSameCamp(me, p); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			if (ally) continue;
			const hp = p.hp !== undefined ? p.hp : 3;
			const shanProb = (function () { try { return probHasShan(p); } catch (e) { return 0.5; } })();
			/* 可收割：1 血，或 2 血且大概率无闪（击杀确定率高） */
			const collect = hp <= 1 || (hp <= 2 && shanProb < 0.4);
			if (!collect) continue;
			let threat = 0; try { const t = threatOf(p); threat = isFinite(t) ? t : 0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			cands.push({ p: p, s: targetBrainScore('kill', { hp: hp, shanProb: shanProb, threat: threat }) });
		}
		if (!cands.length) return cur;
		cands.sort(function (a, b) { return b.s - a.s; });
		const best = cands[0];

		/* 当前目标属性 */
		const curIsCollect = (function () {
			if (!cur || cur === me) return false;
			let cAlly = false; try { cAlly = isSameCamp(me, cur); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			if (cAlly) return false;
			const cHp = cur.hp !== undefined ? cur.hp : 3;
			const cShan = (function () { try { return probHasShan(cur); } catch (e) { return 0.5; } })();
			return cHp <= 1 || (cHp <= 2 && cShan < 0.4);
		})();

		if (!curIsCollect) return best.p;                      /* 当前不是可收割 → 切到收割机会 */
		if (best.p === cur) return best.p;                     /* 已是同一目标 */
		const curS = targetBrainScore('kill', {
			hp: cur.hp !== undefined ? cur.hp : 3,
			shanProb: (function () { try { return probHasShan(cur); } catch (e) { return 0.5; } })(),
			threat: (function () { try { const t = threatOf(cur); return isFinite(t) ? t : 0; } catch (e) { return 0; } })(),
		});
		/* 已是可收割，仅在另一目标“击杀确定率明显更高”时才切，避免目标抖动 */
		if (best.s >= curS + 1.5) return best.p;
		return cur;
	} catch (e) { return cur; }
}


export { applyBasicCardPlayRules, _skillTargetDependsOnCard, _isLegalSkillTarget, _skillNeedsExternalTarget, _canConfirmSelfSkillTarget, _skillTargetRange, _skillPurposeFromIntent, _isSingleTargetSkillProfile, applyBasicSkillRules, aliveCountP, applyBasicEquipRules, equipSlotOf, applyBasicJudgeRules, _buildTargetBrainCandidates, _buildCardDecisionContext, _resolveCardCandidateTarget, applyBasicTargetRules, pickKillTarget };
