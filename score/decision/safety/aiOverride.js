/*
 * ============================================
 * // 著者: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 原生 AI 接管层 =================
 * 策略：软接管（不硬接管），只用无名杀官方 AI 接口：
 *   · mod.aiOrder   → 出牌优先级修正
 *   · mod.aiValue   → 卡牌价值修正
 *   · ai.effect      → 目标选择修正
 *   · ai.useful      → 是否值得用修正
 * 把 bestAction 的结论翻译成原生 AI 能理解的分数修正。
 * 不破坏响应/弃牌/拼点 AI，只做加法修正。
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js';
import { bestAction } from '../engine/engine.js';
import { stageExecutionDecision } from '../execution/executionGateway.js';
import { skillProfileOf } from '../skills/skills.js';
import { beginSkillChoiceStage } from '../skills/skillChoiceTransaction.js';
import { classifySkillCardSelection, skillCardSelectionAdjustment } from '../skills/skillCardChoiceBrain.js';
import { cfg } from '../../foundation/config/util.js';
import { isAllyOf, dispositionOf } from '../relations/relations.js';   /* ★ 指令 05 Stage B：敌我唯一权威源 */

const SKILL_ID = '_djsc_engine';

/* ★ 指令 02：显式重铸判定。
 * engine 的 bestAction 标记 recast（即 evaluator 判定「重铸优于任何使用」）时，
 * 不得再把该牌（尤其铁索连环）的 aiOrder / aiValue / useful 推高，
 * 否则原生 AI 只会优先"打出该牌"，直接堵死宿主重铸路径。
 * 纯谓词，不依赖宿主对象，便于门禁直接断言。 */
export function isRecastRecommended(ba) {
	return !!(ba && ba.recast === true);
}

let _installed = false;
let _protoHooked = false;
let _skillTargetHooked = false;
/* 每次安装使用独立 token。旧 wrapper 即使被后装扩展包在调用链内，
 * 卸载后也永久退化为透明 passthrough；重新安装不会让旧 wrapper 复活。 */
let _activeHookToken = null;

function _markOwnedWrapper(fn, token) {
	try {
		Object.defineProperty(fn, '__djscHookActive', {
			value: function () { return !!token && _activeHookToken === token; },
			configurable: true,
		});
	} catch (e) {}
	return fn;
}
/* ★ M09：备份被换装的底层方法原引用，卸载时原样还原，避免热重载残留 */
const _protoBackup = {
	addSkill: null, getSkills: null, gameCheck: null,
	chooseCard: null, chooseTarget: null, chooseCardTarget: null, chooseButtonTarget: null,
	chooseButton: null, chooseControl: null,
};
/* 记录“我们实际安装进去的 wrapper”本身。卸载时只有当前方法仍严格等于
 * 该 wrapper 才恢复原引用；若后装扩展又包了一层，则绝不覆盖别人的修改。 */
const _protoOwned = {
	addSkill: null, getSkills: null, gameCheck: null,
	chooseCard: null, chooseTarget: null, chooseCardTarget: null, chooseButtonTarget: null,
	chooseButton: null, chooseControl: null,
};

/* ================= ★ 软接管打点（决策级去重） ================= */
const _softCounted = new Map();  // player → round标记

function _softStat(player) {
	try {
		if (!player) return;
		const round = (_status && _status.roundNumber) || 0;
		const name = player.name1 || player.name || '?';
		const key = name + '|' + round;
		if (_softCounted.get(player) === key) return;  // 本回合已计
		_softCounted.set(player, key);
		if (!_status.djsc_overrideStats) {
			_status.djsc_overrideStats = { use: {}, respond: {}, discard: {}, compare: {}, soft: {} };
		}
		if (!_status.djsc_overrideStats.soft) _status.djsc_overrideStats.soft = {};
		const b = _status.djsc_overrideStats.soft;
		b.hit = (b.hit || 0) + 1;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ---------- bestAction 复用 ----------
 * 不再使用“同一玩家同一回合”粗粒度缓存：它会跨局面复用旧决策。
 * #31 已由 engine 负责 state fingerprint + TTL 缓存；这里只调用 engine 并登记事务。 */
function _getBA(player) {
	try {
		if (!player || player === game.me) return null;
		try { if (player.isOnline2 && player.isOnline2()) return null; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		if (cfg('decisionScore', true) === false) return null;

		const ba = bestAction();

		/* ★ Evaluate → Stage：这里只登记待提交事务，不写学习/广播/回放。
		 * 同状态重复询问时 engine 会返回同一事务；Execution Gateway 的 Stage 本身幂等。
		 * 局面变化时 engine state-key 立即重算，不再被“按回合缓存”遮蔽。 */
		try {
			if (ba && ba.__djscTransaction) stageExecutionDecision(player, ba, 'soft');
		} catch (eTx) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTx); }

		return ba;
	} catch (e) { return null; }
}

function _getFreshSkillBA(player, sid) {
	try {
		/* 连续技能每进入一个新的 choice stage 都重新评估当前真实状态。
		 * engine 自身按事件窗口/state-key 决定是否复用。 */
		const ba = _getBA(player);
		if (!ba || ba.type !== 'skill' || ba.id !== sid) return null;
		return ba;
	} catch (e) { return null; }
}

function _clearCache() {
	/* bestAction 缓存已统一收敛到 engine 的 state-key cache。
	 * 这里只清理 soft override 自己的统计去重状态。 */
	try { _softCounted.clear(); }
	catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ---------- 牌名匹配：兼容 viewAs（武圣/龙胆/奇才） ---------- */
function _cardMatches(card, player, rule) {
	try {
		if (!card || !rule) return false;
		if (get.name(card, player) === rule) return true;
		try {
			const info = get.info(card);
			if (info && info.viewAs) {
				const va = info.viewAs;
				const nm = (typeof va === 'string') ? va : (va && va.name);
				if (nm === rule) return true;
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		return false;
	} catch (e) { return false; }
}

/* ================= ★ Skill Decision Kernel V2 · 宿主目标桥 =================
 * 内部 engine 已经决定“哪个技能 + 哪个目标”后，把该高置信方向作为有限偏置
 * 注入真实 chooseTarget / chooseCardTarget 事件。
 * 不修改 filterTarget，不制造非法目标；无法解析技能/目标时完全 fail-open。
 */

function _samePlayer(a, b) {
	if (!a || !b) return false;
	if (a === b) return true;
	try {
		const ak = a.playerid || a.name1 || a.name || '';
		const bk = b.playerid || b.name1 || b.name || '';
		return !!ak && ak === bk;
	} catch (e) { return false; }
}

function _parentEventOf(ev) {
	try {
		if (!ev) return null;
		if (typeof ev.getParent === 'function') {
			const p = ev.getParent();
			if (p && p !== ev) return p;
		}
		return ev.parent || null;
	} catch (e) { return null; }
}

export function resolveActiveSkillContext(player, startEvent) {
	try {
		let ev = startEvent || (_status && _status.event) || null;
		let foundId = null;
		let ownerEvent = null;
		for (let depth = 0; ev && depth < 7; depth++) {
			const cand = [ev.skill, ev.sourceSkill, ev.skillName, ev.name];
			let localId = null;
			for (const id of cand) {
				if (typeof id !== 'string' || !id || id === SKILL_ID) continue;
				/* 真正 lib.skill 条目是技能对象；普通事件名 chooseTarget/phaseUse 等
				 * 即使某些测试/扩展 Proxy 对未知 key 返回函数，也不能误认成技能。 */
				const info = lib.skill && lib.skill[id];
				if (info && typeof info === 'object') {
					localId = id;
					break;
				}
			}
			if (localId) {
				if (!foundId) {
					foundId = localId;
					ownerEvent = ev;
				} else if (localId === foundId) {
					/* 子 choice event 可能复制同一个 skill/sourceSkill。继续向上收敛到
					 * 同一技能最外层 owner，使连续阶段稳定共享 transaction。 */
					ownerEvent = ev;
				} else {
					/* 遇到另一个真实技能说明跨入外层/嵌套技能边界，不能串 transaction。 */
					break;
				}
			}
			ev = _parentEventOf(ev);
		}
		return foundId ? { id: foundId, event: ownerEvent } : null;
	} catch (e) { return null; }
}

export function resolveActiveSkillId(player, startEvent) {
	const ctx = resolveActiveSkillContext(player, startEvent);
	return ctx ? ctx.id : null;
}

function _findActionTarget(ba) {
	try {
		if (!ba) return null;
		if (ba.targetObj && typeof ba.targetObj === 'object') return ba.targetObj;
		const name = Array.isArray(ba.target) ? ba.target[0] : ba.target;
		if (!name) return null;
		for (const p of (game.players || [])) {
			if (!p) continue;
			if ((p.playerid || '') === name || (p.name1 || p.name || '') === name) return p;
		}
		return null;
	} catch (e) { return null; }
}

function _findActionTargets(ba) {
	try {
		const out = [];
		if (ba && Array.isArray(ba.targetList)) {
			for (const p of ba.targetList) {
				if (p && typeof p === 'object' && out.indexOf(p) < 0) out.push(p);
			}
		}
		const primary = _findActionTarget(ba);
		if (primary && out.indexOf(primary) < 0) out.unshift(primary);
		return out;
	} catch (e) { return []; }
}

export function getSkillTargetBridgeDecision(player, sid, baOverride) {
	try {
		if (!player || !sid) return null;
		const ba = baOverride || _getBA(player);
		if (!ba || ba.type !== 'skill' || ba.id !== sid) return null;
		/* 必须经过 kernel 合法目标池解析；Stage 2 允许“同一次 chooseTarget 事件内”的
		 * 同方向多目标组合，但 mixed / 无 provenance / 低置信仍 fail-open。 */
		const confidence = Number(ba.targetConfidence || 0);
		if (ba.skillTargetResolved !== true || confidence < 0.55) return null;
		if (ba.skillTargetSingle !== true && (!Array.isArray(ba.targetList) || !ba.targetList.length)) return null;
		const targets = _findActionTargets(ba);
		if (!targets.length) return null;
		const target = targets[0];
		const purpose = ba.purpose || ((ba.rule === 'attack' || ba.rule === 'control') ? 'attack'
			: ((ba.rule === 'defense' || ba.rule === 'aux') ? 'support' : null));
		if (purpose !== 'attack' && purpose !== 'support') return null;
		if (ba.targetIntent === 'support' && purpose !== 'support') return null;
		if (ba.targetIntent === 'offense' && purpose !== 'attack') return null;
		if (ba.targetIntent !== 'support' && ba.targetIntent !== 'offense') return null;
		return {
			skillId: sid,
			target: target,
			targets: targets,
			targetName: target.playerid || target.name1 || target.name || '',
			targetRangeResolved: ba.targetRangeResolved !== false,
			purpose: purpose,
			intent: ba.targetIntent,
			confidence: confidence,
			score: Number(ba.score || 0),
		};
	} catch (e) { return null; }
}

export function wrapSkillTargetAI(original, player, decision) {
	if (!decision || !player) return original;
	if (original && original.__djscSkillTargetBridge === decision.skillId + '|' + decision.targetName) return original;
	const wrapped = function (target) {
		let nativeScore = 0;
		try {
			if (typeof original === 'function') {
				const n = Number(original.apply(this, arguments));
				if (Number.isFinite(n)) nativeScore = n;
			}
		} catch (e) {}
		try {
			if (!target) return nativeScore;
			const plannedTargets = Array.isArray(decision.targets) && decision.targets.length ? decision.targets : [decision.target];
			if (plannedTargets.some(function (p) { return _samePlayer(target, p); })) return Math.max(nativeScore, 12);
			const rel = dispositionOf(player, target);
			if (decision.purpose === 'support') {
				if (rel < 0) return Math.min(nativeScore, -12);
				if (rel > 0) return nativeScore + 1.5;
				return nativeScore - 1;
			}
			if (decision.purpose === 'attack') {
				if (rel > 0) return Math.min(nativeScore, -12);
				if (rel < 0) return nativeScore + 1.5;
				return nativeScore - 1;
			}
		} catch (e) {}
		return nativeScore;
	};
	try {
		Object.defineProperty(wrapped, '__djscSkillTargetBridge', {
			value: decision.skillId + '|' + decision.targetName,
			configurable: true,
		});
	} catch (e) {}
	return wrapped;
}

function _eventFilterDependsOnCard(filterTarget) {
	try {
		if (typeof filterTarget !== 'function') return false;
		const src = filterTarget.toString();
		const body = src.indexOf('=>') >= 0 ? src.slice(src.indexOf('=>') + 2) : src.slice(src.indexOf('{') + 1);
		return /\bcard\b/.test(body);
	} catch (e) { return true; }
}

export function eventAcceptsSkillTarget(next, player, target) {
	try {
		if (!next || !target) return false;
		const ft = next.filterTarget;
		if (typeof ft !== 'function') return true;
		/* chooseCardTarget 的合法性如果依赖尚未选定的 card，就不猜。 */
		if (_eventFilterDependsOnCard(ft)) return false;
		try { return ft(null, player, target) !== false; } catch (e) { return false; }
	} catch (e) { return false; }
}

function _eventFilterDependsOnSelection(filterTarget) {
	try {
		if (typeof filterTarget !== 'function') return false;
		const src = filterTarget.toString();
		const body = src.indexOf('=>') >= 0 ? src.slice(src.indexOf('=>') + 2) : src.slice(src.indexOf('{') + 1);
		/* 多目标组合合法性若依赖已选目标/实时事件，不能通过逐目标静态调用证明。
		 * 这里故意偏保守：漏判会把“不合法组合”错误桥接进宿主；误判最多只是回退原生 AI。 */
		if (/ui\s*\.\s*selected\b|_status\s*\.\s*event\b|get\s*\.\s*event\b/.test(body)) return true;
		if (/\b(?:event|evt|currentEvent|chooseEvent|trigger|parent)\s*\.\s*(?:targets|cards|buttons|selected|selectedTargets|selectedCards)\b/.test(body)) return true;
		if (/\bthis\s*\.\s*(?:targets|cards|buttons|selected|selectedTargets|selectedCards)\b/.test(body)) return true;
		return false;
	} catch (e) { return true; }
}

function _eventFixedTargetCount(next) {
	try {
		if (!next) return null;
		const st = next.selectTarget;
		if (typeof st === 'number') return st >= 0 ? st : null;
		if (Array.isArray(st) && st.length >= 2) {
			const a = Number(st[0]), b = Number(st[1]);
			if (Number.isFinite(a) && Number.isFinite(b) && a >= 0 && a === b) return a;
			return null;
		}
		if (st == null && typeof next.filterTarget === 'function') return 1;
		return null;
	} catch (e) { return null; }
}

export function eventAcceptsSkillTargetPlan(next, player, decision) {
	try {
		if (!decision || !decision.target) return false;
		const planned = Array.isArray(decision.targets) && decision.targets.length ? decision.targets : [decision.target];
		/* 合法性只要依赖实时已选对象，就不能在事件创建阶段静态证明。
		 * 单目标也可能发生在 chooseButtonTarget/多阶段技能里，并依赖已选 button/card。 */
		if (_eventFilterDependsOnSelection(next && next.filterTarget)) return false;
		if (!eventAcceptsSkillTarget(next, player, planned[0])) return false;

		/* 当前事件若声明固定目标数，必须与计划数量一致；这个兼容性约束同样适用于单目标，
		 * 防止同一技能里的“单目标计划”误桥到另一个固定2目标阶段。 */
		const fixed = _eventFixedTargetCount(next);
		if (fixed !== null && fixed !== planned.length) return false;
		if (planned.length <= 1) return true;

		/* 多目标整组只有在 engine 已解析数量、且当前事件本身也是相同固定 N 时才可桥接。 */
		if (decision.targetRangeResolved !== true) return false;
		if (fixed === null) return false;
		for (const t of planned) {
			if (!eventAcceptsSkillTarget(next, player, t)) return false;
		}
		return true;
	} catch (e) { return false; }
}

export function bridgeSkillTargetChoiceOnce(next, player, skillContext, field, baOverride) {
	try {
		if (!skillContext || !skillContext.id) return next;
		const stage = next && next.__djscSkillChoiceStage;
		if (stage && stage.skillId === skillContext.id) {
			/* Stage 3：消费范围收缩到当前 transaction stage。这样同一技能后续
			 * 仍可出现新的 target stage，但上一阶段计划不会跨阶段复用。 */
			if (stage.targetBridgeConsumed) return next;
			const out = bridgeSkillTargetEvent(next, player, skillContext.id, field, baOverride);
			if (out && out.__djscSkillTargetDecision) {
				stage.targetBridgeConsumed = true;
				stage.targetDecision = out.__djscSkillTargetDecision;
			}
			return out;
		}

		/* 没有 transaction provenance 时维持 Stage 2 的保守 owner-event 单次语义。 */
		const ownerEvent = skillContext.event || null;
		if (ownerEvent && ownerEvent.__djscSkillTargetBridgeConsumed) return next;
		const out = bridgeSkillTargetEvent(next, player, skillContext.id, field, baOverride);
		if (out && out.__djscSkillTargetDecision && ownerEvent) {
			try {
				ownerEvent.__djscSkillTargetBridgeConsumed = {
					skillId: skillContext.id,
					target: out.__djscSkillTargetDecision.targetName,
				};
			} catch (e) {}
		}
		return out;
	} catch (e) { return next; }
}

export function bridgeSkillTargetEvent(next, player, sid, field, baOverride) {
	try {
		if (!next || !player || !sid || !field) return next;
		const decision = getSkillTargetBridgeDecision(player, sid, baOverride);
		if (!decision) return next;
		if (!eventAcceptsSkillTargetPlan(next, player, decision)) return next;
		if (typeof next[field] === 'function') next[field] = wrapSkillTargetAI(next[field], player, decision);

		/* 很多本体技能是 chooseTarget(...).set('ai', fn)：
		 * 拦截这个“后写 ai”，否则刚桥接完又会被技能自己的 set 覆盖。 */
		if (typeof next.set === 'function' && !next.__djscSkillTargetSetBridge) {
			const origSet = next.set;
			next.set = function (key, value) {
				if (key === field && typeof value === 'function') {
					value = wrapSkillTargetAI(value, player, decision);
				}
				return origSet.call(this, key, value);
			};
			try { next.__djscSkillTargetSetBridge = true; } catch (e) {}
		}
		try {
			next.__djscSkillTargetDecision = decision;
			_softStat(player);
		} catch (e) {}
		return next;
	} catch (e) { return next; }
}

function _ownSkillCardContext(player) {
	const out = {
		hp: (player && player.hp !== undefined) ? player.hp : 3,
		maxHp: (player && player.maxHp) || 3,
		shaCount: 0, shanCount: 0, wuxieCount: 0, jiuCount: 0,
		hasZhuge: false, hasPaoxiao: false,
	};
	try {
		const hand = player && typeof player.getCards === 'function' ? (player.getCards('h') || []) : [];
		for (const c of hand) {
			let id = '';
			try { id = (typeof get.name === 'function' && get.name(c, player)) || (c && c.name) || ''; } catch (e) { id = (c && c.name) || ''; }
			if (id === 'sha') out.shaCount++;
			else if (id === 'shan') out.shanCount++;
			else if (id === 'wuxie') out.wuxieCount++;
			else if (id === 'jiu') out.jiuCount++;
		}
		try {
			const equips = player && typeof player.getCards === 'function' ? (player.getCards('e') || []) : [];
			for (const c of equips) {
				let id = '';
				try { id = (typeof get.name === 'function' && get.name(c, player)) || (c && c.name) || ''; } catch (e) { id = (c && c.name) || ''; }
				if (id === 'zhuge') out.hasZhuge = true;
			}
		} catch (e) {}
		try { if (player && typeof player.hasSkill === 'function' && player.hasSkill('paoxiao')) out.hasPaoxiao = true; } catch (e) {}
	} catch (e) {}
	return out;
}

export function skillCardAIValueModifier(player, card, num, baOverride, eventOverride) {
	try {
		const base = Number(num);
		if (!player || !card || !Number.isFinite(base)) return num;
		const ba = baOverride || _getBA(player);
		if (!ba || ba.type !== 'skill' || !ba.id) return num;

		/* declarative 主动技（filterCard/check）没有 player.chooseCard() 调用。
		 * 只在当前真实技能上下文与 bestAction 完全一致时修改 aiValue，避免污染普通出牌。 */
		const active = resolveActiveSkillContext(player,
			eventOverride !== undefined ? eventOverride : (_status && _status.event));
		if (!active || active.id !== ba.id) return num;

		const info = lib.skill && lib.skill[ba.id];
		if (!info || typeof info !== 'object' || !info.filterCard) return num;
		const profile = skillProfileOf(ba.id);
		const semantic = classifySkillCardSelection(profile, { skillInfo: info });
		if (semantic !== 'cost') return num;

		let owner = null;
		try {
			if (typeof get.owner !== 'function') return num;
			owner = get.owner(card);
		} catch (e) { return num; }
		if (owner !== player) return num;

		let id = '';
		try {
			id = (typeof get.name === 'function' && get.name(card, player))
				|| (card && card.name) || '';
		} catch (e) { id = (card && card.name) || ''; }
		if (!id) return num;

		const d = skillCardSelectionAdjustment(id, profile, {
			me: _ownSkillCardContext(player),
			cardValue: base,
			skillInfo: info,
		});
		/* 宿主常见 check(card)=常数-get.value(card)。
		 * 适合作成本 → adjustment>0 → 降低 value；关键牌则提高 value。 */
		return base - Number(d && d.adjustment || 0);
	} catch (e) { return num; }
}

export function wrapSkillCardOpportunityAI(original, player, stage, profile) {
	if (!player || !stage) return original;
	const tag = stage.skillId + '|' + stage.transactionId + '|' + stage.ordinal;
	if (original && original.__djscSkillCardStageBridge === tag) return original;
	const meCardCtx = _ownSkillCardContext(player);
	const wrapped = function (card) {
		let nativeScore = 0;
		try {
			if (typeof original === 'function') {
				const n = Number(original.apply(this, arguments));
				if (Number.isFinite(n)) nativeScore = n;
			}
		} catch (e) {}
		try {
			let owner = null;
			try {
				if (typeof get.owner !== 'function') return nativeScore;
				owner = get.owner(card);
			} catch (e) { return nativeScore; }
			/* 只评价明确属于当前玩家的牌；未知/外部来源完全沿用原生 AI。 */
			if (owner !== player) return nativeScore;

			let id = '';
			try { id = (typeof get.name === 'function' && get.name(card, player)) || (card && card.name) || ''; } catch (e) { id = (card && card.name) || ''; }
			if (!id) return nativeScore;
			let value = NaN;
			try { value = Number(get.value(card, player)); } catch (e) {}

			const d = skillCardSelectionAdjustment(id, profile, {
				me: meCardCtx,
				cardValue: value,
				skillInfo: profile && profile.__skillInfo,
			});
			return nativeScore + Number(d && d.adjustment || 0);
		} catch (e) { return nativeScore; }
	};
	try { Object.defineProperty(wrapped, '__djscSkillCardStageBridge', { value: tag, configurable: true }); } catch (e) {}
	return wrapped;
}

export function bridgeSkillCardStageEvent(next, player, skillContext, field, baOverride) {
	try {
		if (!next || !player || !skillContext || !skillContext.id || !field || next.processAI) return next;
		const stage = next.__djscSkillChoiceStage;
		if (!stage || stage.skillId !== skillContext.id || stage.choiceType !== 'card') return next;
		const ba = baOverride || _getBA(player);
		if (!ba || ba.type !== 'skill' || ba.id !== skillContext.id) return next;
		if (ba.rule === 'veto' || ba.rule === 'veto-target') return next;
		const baseProfile = skillProfileOf(skillContext.id);
		const profile = Object.assign({}, baseProfile || {}, {
			__skillInfo: lib.skill && lib.skill[skillContext.id],
		});

		if (typeof next[field] === 'function') {
			next[field] = wrapSkillCardOpportunityAI(next[field], player, stage, profile);
		}
		if (typeof next.set === 'function' && !next.__djscSkillCardStageSetBridge) {
			const origSet = next.set;
			next.set = function (key, value) {
				if (key === field && typeof value === 'function') {
					value = wrapSkillCardOpportunityAI(value, player, stage, profile);
				}
				return origSet.call(this, key, value);
			};
			try { next.__djscSkillCardStageSetBridge = true; } catch (e) {}
		}
		try {
			next.__djscSkillCardStageDecision = {
				skillId: skillContext.id,
				transactionId: stage.transactionId,
				stageOrdinal: stage.ordinal,
			};
			_softStat(player);
		} catch (e) {}
		return next;
	} catch (e) { return next; }
}

export function wrapSkillCostCardAI(original, player, decision) {
	if (!decision || !player) return original;
	const tag = decision.skillId + '|' + decision.targetName;
	if (original && original.__djscSkillCostBridge === tag) return original;
	const wrapped = function (card) {
		let nativeScore = 0;
		try {
			if (typeof original === 'function') {
				const n = Number(original.apply(this, arguments));
				if (Number.isFinite(n)) nativeScore = n;
			}
		} catch (e) {}
		try {
			let owner = null;
			try { owner = get.owner ? get.owner(card) : null; } catch (e) {}
			if (owner && owner !== player) return nativeScore;
			const v = Number(get.value(card, player));
			if (!Number.isFinite(v)) return nativeScore;
			const tie = Math.max(-0.2, Math.min(0.2, -v * 0.02));
			return nativeScore + tie;
		} catch (e) { return nativeScore; }
	};
	try { Object.defineProperty(wrapped, '__djscSkillCostBridge', { value: tag, configurable: true }); } catch (e) {}
	return wrapped;
}

export function bridgeSkillCardCostEvent(next, player, sid, field, baOverride) {
	try {
		if (!next || !player || !sid || !field || next.processAI) return next;
		const decision = getSkillTargetBridgeDecision(player, sid, baOverride);
		if (!decision) return next;
		/* 联合选牌只跟随“同一个 chooseCardTarget 事件里已经成功桥接的目标计划”。
		 * 若目标桥因 consumed / stage mismatch / card-dependent filter 而 fail-open，
		 * 牌半边也必须一起 fail-open。 */
		const attached = next.__djscSkillTargetDecision;
		if (!attached || attached.skillId !== sid) return next;
		if (!eventAcceptsSkillTargetPlan(next, player, decision)) return next;
		if (typeof next[field] === 'function') next[field] = wrapSkillCostCardAI(next[field], player, decision);
		if (typeof next.set === 'function' && !next.__djscSkillCostSetBridge) {
			const origSet = next.set;
			next.set = function (key, value) {
				if (key === field && typeof value === 'function') value = wrapSkillCostCardAI(value, player, decision);
				return origSet.call(this, key, value);
			};
			try { next.__djscSkillCostSetBridge = true; } catch (e) {}
		}
		return next;
	} catch (e) { return next; }
}

function _skillExplicitButtonDecision(player, sid, baOverride) {
	try {
		const ba = baOverride || _getBA(player);
		if (!ba || ba.type !== 'skill' || ba.id !== sid) return null;
		if (ba.rule === 'veto' || ba.rule === 'veto-target') return null;
		if (ba.buttonChoice === undefined || ba.buttonChoice === null) return null;
		return ba.buttonChoice;
	} catch (e) { return null; }
}

export function wrapExplicitSkillButtonAI(original, planned) {
	if (planned === null || planned === undefined) return original;
	const wrapped = function (button) {
		let nativeScore = 0;
		try {
			if (typeof original === 'function') {
				const n = Number(original.apply(this, arguments));
				if (Number.isFinite(n)) nativeScore = n;
			}
		} catch (e) {}
		try {
			if (!button) return nativeScore;
			if (button.link === planned || button === planned) return Math.max(nativeScore, 12);
		} catch (e) {}
		return nativeScore;
	};
	return wrapped;
}

export function bridgeSkillButtonEvent(next, player, sid, field, baOverride) {
	try {
		if (!next || !player || !sid || !field || next.processAI) return next;
		/* button.link 即使恰好是玩家，也可能表示技能内部另一种角色/分支语义。
		 * 只有 planner 明确产出 buttonChoice 才允许接管；否则完全原生。 */
		const planned = _skillExplicitButtonDecision(player, sid, baOverride);
		if (planned === null) return next;
		let bridged = false;
		if (typeof next[field] === 'function') {
			next[field] = wrapExplicitSkillButtonAI(next[field], planned);
			bridged = true;
		}
		if (typeof next.set === 'function' && !next.__djscSkillButtonSetBridge) {
			const origSet = next.set;
			next.set = function (key, value) {
				if (key === field && typeof value === 'function') value = wrapExplicitSkillButtonAI(value, planned);
				return origSet.call(this, key, value);
			};
			try { next.__djscSkillButtonSetBridge = true; } catch (e) {}
			bridged = true;
		}
		if (bridged) {
			try { next.__djscSkillButtonDecision = { skillId: sid, choice: planned }; } catch (e) {}
		}
		return next;
	} catch (e) { return next; }
}

export function bridgeSkillButtonChoiceOnce(next, player, skillContext, field, baOverride) {
	try {
		if (!skillContext || !skillContext.id) return next;
		const ownerEvent = skillContext.event || null;
		if (ownerEvent && ownerEvent.__djscSkillButtonBridgeConsumed) return next;
		const out = bridgeSkillButtonEvent(next, player, skillContext.id, field, baOverride);
		if (out && out.__djscSkillButtonDecision && ownerEvent) {
			try {
				ownerEvent.__djscSkillButtonBridgeConsumed = {
					skillId: skillContext.id,
				};
			} catch (e) {}
		}
		return out;
	} catch (e) { return next; }
}

function _skillExplicitControlDecision(player, sid, baOverride) {
	try {
		const ba = baOverride || _getBA(player);
		if (!ba || ba.type !== 'skill' || ba.id !== sid) return null;
		if (ba.rule === 'veto' || ba.rule === 'veto-target') return null;
		/* chooseControl 的语义高度技能特化。只有 planner 明确产出 controlChoice
		 * 才允许桥接；“唯一非取消项”本身不代表继续子效果一定更优。 */
		if (ba.controlChoice === undefined || ba.controlChoice === null) return null;
		return ba.controlChoice;
	} catch (e) { return null; }
}

export function bridgeSkillControlEvent(next, player, sid, baOverride) {
	try {
		if (!next || !player || !sid || next.processAI) return next;
		const planned = _skillExplicitControlDecision(player, sid, baOverride);
		if (planned === null) return next;
		const wrap = function (original) {
			return function () {
				try {
					const controls = Array.isArray(next.controls) ? next.controls : [];
					if (typeof planned === 'number' && planned >= 0 && planned < controls.length) return planned;
					const idx = controls.indexOf(planned);
					if (idx >= 0) return idx;
				} catch (e) {}
				try { return typeof original === 'function' ? original.apply(this, arguments) : 0; } catch (e) { return 0; }
			};
		};
		next.ai = wrap(typeof next.ai === 'function' ? next.ai : null);
		if (typeof next.set === 'function' && !next.__djscSkillControlSetBridge) {
			const origSet = next.set;
			next.set = function (key, value) {
				if (key === 'ai' && typeof value === 'function') value = wrap(value);
				return origSet.call(this, key, value);
			};
			try { next.__djscSkillControlSetBridge = true; } catch (e) {}
		}
		try { next.__djscSkillControlDecision = { skillId: sid, choice: planned }; } catch (e) {}
		return next;
	} catch (e) { return next; }
}

export function bridgeSkillControlChoiceOnce(next, player, skillContext, baOverride) {
	try {
		if (!skillContext || !skillContext.id) return next;
		const ownerEvent = skillContext.event || null;
		if (ownerEvent && ownerEvent.__djscSkillControlBridgeConsumed) return next;
		const out = bridgeSkillControlEvent(next, player, skillContext.id, baOverride);
		if (out && out.__djscSkillControlDecision && ownerEvent) {
			try {
				ownerEvent.__djscSkillControlBridgeConsumed = {
					skillId: skillContext.id,
				};
			} catch (e) {}
		}
		return out;
	} catch (e) { return next; }
}

function _hookSkillTargetChoice() {
	if (_skillTargetHooked) return;
	try {
		const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (!proto) return;
		const hookToken = _activeHookToken;
		if (!hookToken) return;

		const origChooseCard = proto.chooseCard;
		if (typeof origChooseCard === 'function') {
			_protoBackup.chooseCard = origChooseCard;
			proto.chooseCard = _markOwnedWrapper(function () {
				if (_activeHookToken !== hookToken) return origChooseCard.apply(this, arguments);
				const skillCtx = resolveActiveSkillContext(this, _status && _status.event);
				const next = origChooseCard.apply(this, arguments);
				if (!skillCtx) return next;
				beginSkillChoiceStage(this, skillCtx, 'card', next);
				const ba = _getFreshSkillBA(this, skillCtx.id);
				return bridgeSkillCardStageEvent(next, this, skillCtx, 'ai', ba);
			}, hookToken);
			_protoOwned.chooseCard = proto.chooseCard;
		}

		const origChooseTarget = proto.chooseTarget;
		if (typeof origChooseTarget === 'function') {
			_protoBackup.chooseTarget = origChooseTarget;
			proto.chooseTarget = _markOwnedWrapper(function () {
				if (_activeHookToken !== hookToken) return origChooseTarget.apply(this, arguments);
				const skillCtx = resolveActiveSkillContext(this, _status && _status.event);
				const next = origChooseTarget.apply(this, arguments);
				if (!skillCtx) return next;
				beginSkillChoiceStage(this, skillCtx, 'target', next);
				const ba = _getFreshSkillBA(this, skillCtx.id);
				return bridgeSkillTargetChoiceOnce(next, this, skillCtx, 'ai', ba);
			}, hookToken);
			_protoOwned.chooseTarget = proto.chooseTarget;
		}

		const origChooseCardTarget = proto.chooseCardTarget;
		if (typeof origChooseCardTarget === 'function') {
			_protoBackup.chooseCardTarget = origChooseCardTarget;
			proto.chooseCardTarget = _markOwnedWrapper(function () {
				if (_activeHookToken !== hookToken) return origChooseCardTarget.apply(this, arguments);
				const skillCtx = resolveActiveSkillContext(this, _status && _status.event);
				const next = origChooseCardTarget.apply(this, arguments);
				if (!skillCtx) return next;
				beginSkillChoiceStage(this, skillCtx, 'card-target', next);
				const ba = _getFreshSkillBA(this, skillCtx.id);
				bridgeSkillTargetChoiceOnce(next, this, skillCtx, 'ai2', ba);
				bridgeSkillCardCostEvent(next, this, skillCtx.id, 'ai1', ba);
				return next;
			}, hookToken);
			_protoOwned.chooseCardTarget = proto.chooseCardTarget;
		}

		const origChooseButtonTarget = proto.chooseButtonTarget;
		if (typeof origChooseButtonTarget === 'function') {
			_protoBackup.chooseButtonTarget = origChooseButtonTarget;
			proto.chooseButtonTarget = _markOwnedWrapper(function () {
				if (_activeHookToken !== hookToken) return origChooseButtonTarget.apply(this, arguments);
				const skillCtx = resolveActiveSkillContext(this, _status && _status.event);
				const next = origChooseButtonTarget.apply(this, arguments);
				if (!skillCtx) return next;
				beginSkillChoiceStage(this, skillCtx, 'button-target', next);
				const ba = _getFreshSkillBA(this, skillCtx.id);
				bridgeSkillTargetChoiceOnce(next, this, skillCtx, 'ai2', ba);
				bridgeSkillButtonChoiceOnce(next, this, skillCtx, 'ai1', ba);
				return next;
			}, hookToken);
			_protoOwned.chooseButtonTarget = proto.chooseButtonTarget;
		}

		const origChooseButton = proto.chooseButton;
		if (typeof origChooseButton === 'function') {
			_protoBackup.chooseButton = origChooseButton;
			proto.chooseButton = _markOwnedWrapper(function () {
				if (_activeHookToken !== hookToken) return origChooseButton.apply(this, arguments);
				const skillCtx = resolveActiveSkillContext(this, _status && _status.event);
				const next = origChooseButton.apply(this, arguments);
				if (!skillCtx) return next;
				beginSkillChoiceStage(this, skillCtx, 'button', next);
				const ba = _getFreshSkillBA(this, skillCtx.id);
				return bridgeSkillButtonChoiceOnce(next, this, skillCtx, 'ai', ba);
			}, hookToken);
			_protoOwned.chooseButton = proto.chooseButton;
		}

		const origChooseControl = proto.chooseControl;
		if (typeof origChooseControl === 'function') {
			_protoBackup.chooseControl = origChooseControl;
			proto.chooseControl = _markOwnedWrapper(function () {
				if (_activeHookToken !== hookToken) return origChooseControl.apply(this, arguments);
				const skillCtx = resolveActiveSkillContext(this, _status && _status.event);
				const next = origChooseControl.apply(this, arguments);
				if (!skillCtx) return next;
				beginSkillChoiceStage(this, skillCtx, 'control', next);
				const ba = _getFreshSkillBA(this, skillCtx.id);
				return bridgeSkillControlChoiceOnce(next, this, skillCtx, ba);
			}, hookToken);
			_protoOwned.chooseControl = proto.chooseControl;
		}

		_skillTargetHooked = !!(_protoBackup.chooseCard || _protoBackup.chooseTarget || _protoBackup.chooseCardTarget
			|| _protoBackup.chooseButtonTarget || _protoBackup.chooseButton || _protoBackup.chooseControl);
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= ★ 原生 skill effect 方向守卫 =================
 * 与 bestAction 无关：当无名杀原生 AI 自己评估某个主动技能目标时，也统一消费
 * Skill Decision Kernel 的 target intent，防止“内部认为不该资敌，但原生技能 AI 绕过”。
 */

export function skillTargetDirectionAdjustment(intent, confidence, relation) {
	const c = Number(confidence || 0);
	if (c < 0.55) return 0;
	if (intent === 'support') {
		if (relation < 0) return -12;
		if (relation > 0) return 1.5;
		return -1;
	}
	if (intent === 'offense') {
		if (relation > 0) return -12;
		if (relation < 0) return 1.5;
		return -1;
	}
	return 0;
}

function _skillIdFromEffectSubject(subject) {
	try {
		if (typeof subject !== 'string' || !subject) return null;
		const sk = lib.skill && lib.skill[subject];
		return sk && typeof sk === 'object' ? subject : null;
	} catch (e) { return null; }
}

export function skillDirectionEffectModifier(subject, player, target) {
	try {
		const sid = _skillIdFromEffectSubject(subject);
		if (!sid || !player || !target) return null;
		const prof = skillProfileOf(sid);
		if (!prof || !prof.targets) return null;
		const intent = prof.targets.intent;
		const confidence = Number(prof.targets.confidence || 0);
		if (intent !== 'support' && intent !== 'offense') return null;
		const rel = dispositionOf(player, target);
		const delta = skillTargetDirectionAdjustment(intent, confidence, rel);
		if (!delta) return null;
		return [1, delta];
	} catch (e) { return null; }
}

/* ---------- 安装 ---------- */
export function installAIOverride() {
	if (_installed || lib.skill[SKILL_ID]) return;
	try {
		lib.skill[SKILL_ID] = {
			silent: true,
			charlotte: true,
			superCharlotte: true,
			unique: true,
			temp: true,           // ★ 玩家死亡时自动清理
			invisible: true,      // ★ 不在技能列表显示
			mod: {
				/* ★ ① 出牌优先级修正 */
				aiOrder(player, card, num) {
					try {
						const ba = _getBA(player);
						if (!ba || !ba.rule) return num;
						if (ba.action === 'C' && ba.rule === 'end') {
							return Math.min(num, 0.01);
						}
						/* ★ 指令 02：显式重铸 → 主动让出顺序。宿主 _recasting 技能 order=6，
						 * 仅「不推高」不足以让位；必须把铁索自身使用顺序压到 6 以下，
						 * 重铸才会真正发生。 */
						if (isRecastRecommended(ba)) {
							return Math.min(num, 5);
						}
						if (_cardMatches(card, player, ba.rule)) {
							_softStat(player);  // ★ 软接管命中打点
							return 100 + num;
						}
						return num;
					} catch (e) { return num; }
				},

				/* ★ ② 卡牌价值修正（软接管：只加不减） */
				aiValue(player, card, num) {
					try {
						const ba = _getBA(player);
						if (!ba) return num;

						/* ★ 指令 02：显式重铸 → 不额外加价值 */
						if (isRecastRecommended(ba)) {
							return num;
						}

						/* Stage 3：declarative filterCard/check 技能没有 chooseCard() 桥。
						 * 在当前技能上下文中，通过 aiValue 让宿主原生 check(card) 消费同一套成本策略。 */
						const skillCardValue = skillCardAIValueModifier(player, card, num, ba);
						if (skillCardValue !== num) return skillCardValue;

						/* 如果是我们推荐的牌 → 加价值 */
						if (ba.rule && _cardMatches(card, player, ba.rule)) {
							return num + 2.0;
						}

						/* 如果是打队友的牌 → 减价值 */
						const cardId = get.name(card, player);
						const isAttack = ['sha', 'juedou', 'huogong', 'nanman', 'wanjian'].indexOf(cardId) >= 0;
						if (isAttack && ba.avoidAlly) {
							return num - 1.5;
						}

						return num;
					} catch (e) { return num; }
				},
			},
			ai: {
				/* ★ ③ 目标选择修正 */
				effect: {
					player(card, player, target) {
						try {
							if (get.itemtype(target) !== 'player') return;

							/* ★ 技能方向先于 bestAction：原生技能 AI 评估也必须遵守统一敌友语义。
							 * 这样即使该技能被 engine 降权、没有成为 bestAction，也不能绕过去资敌。 */
							const skillDir = skillDirectionEffectModifier(card, player, target);
							if (skillDir) return skillDir;

							const ba = _getBA(player);
							if (!ba) return;

							const tname = target.name || target.name1;
							const isAtk = get.tag(card, 'damage');
							const isDelay = (function () {
								const id = get.name(card, player);
								return id === 'lebu' || id === 'bingliang';
							})();

							/* ★ 修正：ba.target 可能是数组（铁锁连环等多目标牌），需包含匹配 */
							const tgtMatch = Array.isArray(ba.target)
								? ba.target.indexOf(tname) >= 0
								: (tname === ba.target);

							if (ba.target && tgtMatch) {
								if (isAtk) return [1, 2.5];
								if (isDelay) return [1, 2.0];
								return [1, 1.0];
							}

							if (isAllyOf(player, target) && isAtk) {
								/* 濒死队友：灭队级抑制 */
								if ((target.hp || 0) <= 1) return [1, -5.0];
								return [1, -3.0];
							}
						} catch (e) { return; }
					},
				},

				/* ★ ④ 是否值得用修正 */
				useful(player, event) {
					try {
						const ba = _getBA(player);
						if (!ba) return;

						/* ★ 指令 02：显式重铸 → 不标为「值得用」 */
						if (isRecastRecommended(ba)) {
							return;
						}

						/* 如果是我们推荐的动作 → 提高有用性 */
						if (ba.rule && event && event.card && _cardMatches(event.card, player, ba.rule)) {
							return 1.5;
						}

						return;
					} catch (e) { return; }
				},
			},
		};

		(game.players || []).forEach(function (p) {
			try {
				if (p && p !== game.me && !p.hasSkill(SKILL_ID)) p.addSkill(SKILL_ID);
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});

		_activeHookToken = {};
		_hookAddSkill();
		_hookRoundChange();
		_hookSkillTargetChoice();

		_installed = true;
		try { if (game.log) game.log('决策积分引擎：原生 AI 软接管层已安装（aiOrder + aiValue + effect + useful）'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	} catch (e) {
		_activeHookToken = null;
		try { console.error('[决策积分引擎] installAIOverride 失败：', e); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
	}
}

function _hookAddSkill() {
	if (_protoHooked) return;
	try {
		const proto = lib.element.Player.prototype;
		const hookToken = _activeHookToken;
		if (!hookToken) return;
		const orig = proto.addSkill;
		if (typeof orig !== 'function') return;
		_protoBackup.addSkill = orig;   /* ★ M09：存下原生 addSkill，卸载时还原 */
		proto.addSkill = _markOwnedWrapper(function () {
			if (_activeHookToken !== hookToken) return orig.apply(this, arguments);
			const r = orig.apply(this, arguments);
			try {
				if (this !== game.me && !this.hasSkill(SKILL_ID) && lib.skill[SKILL_ID]) {
					orig.call(this, SKILL_ID);
				}
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			return r;
		}, hookToken);
		_protoOwned.addSkill = proto.addSkill;
		_protoHooked = true;

		/* ★ 修复左慈死亡 temp 报错：过滤掉 lib.skill[sid] 为 undefined 的残留技能 */
		const origGetSkills = proto.getSkills;
		if (typeof origGetSkills === 'function') {
			_protoBackup.getSkills = origGetSkills;   /* ★ M09：存下原生 getSkills，卸载时还原 */
			proto.getSkills = _markOwnedWrapper(function () {
				if (_activeHookToken !== hookToken) return origGetSkills.apply(this, arguments);
				const skills = origGetSkills.apply(this, arguments);
				try {
					if (Array.isArray(skills) && skills.length > 0) {
						return skills.filter(function (sid) {
							return lib.skill[sid] !== undefined;
						});
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				return skills;
			}, hookToken);
			_protoOwned.getSkills = proto.getSkills;
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

function _hookRoundChange() {
	try {
		if (game.__djsc_check_hooked) return;
		const hookToken = _activeHookToken;
		if (!hookToken) return;
		game.__djsc_check_hooked = true;
		const orig = game.check;
		if (typeof orig !== 'function') return;
		_protoBackup.gameCheck = orig;   /* ★ M09：存下原生 game.check，卸载时还原 */
		game.check = _markOwnedWrapper(function () {
			if (_activeHookToken !== hookToken) return orig.apply(this, arguments);
			try { _clearCache(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			return orig.apply(this, arguments);
		}, hookToken);
		_protoOwned.gameCheck = game.check;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ---------- 卸载 ---------- */
export function uninstallAIOverride() {
	/* 先失效本代 wrapper；即使它被第三方 wrapper 包在内部，也只能透明调用旧原函数。 */
	_activeHookToken = null;
	try { _clearCache(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ M09：还原被换装的底层方法（仅当仍是我们的包装时才还原，避免热重载残留） */
	try {
		var proto = (lib && lib.element && lib.element.Player) ? lib.element.Player.prototype : null;
		if (proto) {
			if (_protoBackup.addSkill && proto.addSkill === _protoOwned.addSkill) proto.addSkill = _protoBackup.addSkill;
			if (_protoBackup.getSkills && proto.getSkills === _protoOwned.getSkills) proto.getSkills = _protoBackup.getSkills;
			if (_protoBackup.chooseCard && proto.chooseCard === _protoOwned.chooseCard) proto.chooseCard = _protoBackup.chooseCard;
			if (_protoBackup.chooseTarget && proto.chooseTarget === _protoOwned.chooseTarget) proto.chooseTarget = _protoBackup.chooseTarget;
			if (_protoBackup.chooseCardTarget && proto.chooseCardTarget === _protoOwned.chooseCardTarget) proto.chooseCardTarget = _protoBackup.chooseCardTarget;
			if (_protoBackup.chooseButtonTarget && proto.chooseButtonTarget === _protoOwned.chooseButtonTarget) proto.chooseButtonTarget = _protoBackup.chooseButtonTarget;
			if (_protoBackup.chooseButton && proto.chooseButton === _protoOwned.chooseButton) proto.chooseButton = _protoBackup.chooseButton;
			if (_protoBackup.chooseControl && proto.chooseControl === _protoOwned.chooseControl) proto.chooseControl = _protoBackup.chooseControl;
		}
		var g = (typeof game !== 'undefined') ? game : null;
		if (g && _protoBackup.gameCheck && g.check === _protoOwned.gameCheck) g.check = _protoBackup.gameCheck;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ M09：复位标志，允许下次 install 重新正确地换装 */
	try {
		if (typeof game !== 'undefined') game.__djsc_check_hooked = false;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	_protoHooked = false;
	_skillTargetHooked = false;
	for (const k of Object.keys(_protoOwned)) _protoOwned[k] = null;
	try { delete lib.skill[SKILL_ID]; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	(game.players || []).forEach(function (p) {
		try { p.removeSkill(SKILL_ID); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	});
	_installed = false;
}

/* ---------- 挂载到全局 ---------- */
if (typeof window !== 'undefined') {
	window.__DJSC = window.__DJSC || {};
	window.__DJSC.aiOverride = {
		install: installAIOverride,
		uninstall: uninstallAIOverride,
		installed: function () { return _installed; },
	};
}
