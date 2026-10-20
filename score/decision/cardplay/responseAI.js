/*
 * ============================================
 * // 作者：飛昇原創
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 响应/弃牌 AI 增强 =================
 * 用官方标签（skillTagFilter / ai.effect）影响：
 *   - 闪：关键时刻才出（防酒杀、保关键回合、防连弩）
 *   - 杀：响应南蛮/决斗/借刀时保留（避免打空）
 *   - 桃：留到真正需要（算清存活回合）
 *   - 酒：濒死时当桃用自救
 *   - 无懈：只解关键锦囊（乐/兵/南蛮/万箭/绝境判定）
 *   - 借刀杀人：实际被杀者的杀效果与交武器分支统一比较
 *   - 决斗：按宿主实际响应要求判断，不比较杀的点数
 * 完全不接管 chooseToRespond / chooseToDiscard 流程。
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js?v=41a';
import { cfg } from '../../foundation/config/util.js?v=41a';
import { log } from '../../foundation/diag/logger.js?v=41a';
import { onPlayerSkillInjected } from '../../foundation/config/util.js?v=41a';
import { evaluateTaoRescue } from '../safety/rescuePolicy.js?v=41a';
import { shouldUseWuxie } from '../response/wuxieEvaluator.js?v=41a';   /* ★ 无懈唯一权威策略源 */
import { isAllyOf, isEnemyOf, isNeutralOf } from '../relations/relations.js?v=41a';   /* ★ 指令 05 Stage B：敌我唯一权威源 */
import {installJiedaoChoiceBridge} from '../cards/jiedaoChoiceBridge.js?v=41a';
import {trickResponseContext} from '../response/trickResponseContext.js?v=41a';
import {resolveJiedaoResponse,evaluateJiedaoResponse,installJiedaoResponseBridge} from '../response/jiedaoResponse.js?v=41a';

const SKILL_ID = '_djsc_responseAI';
let _installed = false;
let _removeJiedaoBridge=null,_removeJiedaoChoiceBridge=null;

/* ================= 闪 ================= */
/* 判断：这张闪是否值得保留 */
function _shouldKeepShan(player, card) {
	try {
		/* 濒死区：血量越低，闪越宝贵，保留闪应对下一张杀 */
		if (player.hp <= 2) return true;

		const enemies = (game.players || []).filter(function (p) {
			return p && p.alive !== false && p !== player && isEnemyOf(player, p);
		});
		if (!enemies.length) return false;

		/* 敌方有连弩：连杀威胁高，无条件保留闪 */
		try {
			for (const e of enemies) {
				if (e.getEquip && e.getEquip('zhuge')) return true;
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* 自身自救能力（桃/酒）——有后手时更敢硬吃 */
		let selfSave = 0;
		try {
			selfSave = player.countCards('hs', function (c) {
				const n = get.name(c);
				return n === 'tao' || n === 'jiu';
			});
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* 敌方是否有酒（酒杀威胁） */
		let enemyHasJiu = false;
		try {
			enemyHasJiu = enemies.some(function (e) {
				return e.countCards && e.countCards('hs', 'jiu') > 0;
			});
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		const avgHand = enemies.reduce(function (s, e) {
			return s + (e.countCards ? e.countCards('h') : 0);
		}, 0) / Math.max(1, enemies.length);

		/* hp=3 细分 */
		if (player.hp === 3) {
			if (enemyHasJiu && selfSave === 0) return true;
			if (avgHand >= 2) return true;
			return false;
		}
		/* hp=4 细分 */
		if (player.hp === 4) {
			if (enemyHasJiu && selfSave === 0) return true;
			return false;
		}
		return false;
	} catch (e) { return false; }
}

/* ================= 杀 ================= */
/* 判断：这张杀是否值得保留 */
function _shouldKeepSha(player, arg) {
	try {
		if (player.hp <= 1) return false;

		const shaInHand = player.countCards('hs', 'sha');
		if (shaInHand >= 3) return false;

		let enemyHasZhuge = false;
		try {
			const enemies = (game.players || []).filter(function (p) {
				return p && p.alive !== false && p !== player && isEnemyOf(player, p);
			});
			enemyHasZhuge = enemies.some(function (e) {
				return e.getEquip && e.getEquip('zhuge');
			});
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		let needSha = false;
		try {
			needSha = player.hasSkillTag('shaRequired') ||
				player.hasSkill('wusheng') ||
				player.hasSkill('paoxiao') ||
				player.hasSkill('longdan') ||
				player.hasSkill('liegong');
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		if (shaInHand === 1) {
			if (player.hp >= 3 && (enemyHasZhuge || needSha)) return true;
			if (player.hp >= 4) return true;
			return false;
		}
		if (shaInHand === 2) {
			if (enemyHasZhuge && needSha && player.hp >= 3) return true;
			if (enemyHasZhuge && player.hp >= 4) return true;
			return false;
		}
		return false;
	} catch (e) { return false; }
}

/* ================= 桃 ================= */
/* 返回 true = 保留桃（不出）；false = 出桃。
 * ★ 修复：濒死目标交给唯一权威 evaluateTaoRescue（self/ally→出，neutral/enemy→保留），
 *   并去掉原先 `if (target.hp<=0) return false`（会把敌方濒死也判成「该出桃」的早退）。 */
function _shouldSaveTao(player, target, ctx) {
	try {
		if (!target) return false;
		/* 濒死目标识别：ctx.dyingTarget 覆盖 → _status.event.dying */
		let dyingTarget;
		if (ctx && ('dyingTarget' in ctx)) dyingTarget = ctx.dyingTarget;
		else { try { dyingTarget = _status.event && _status.event.dying; } catch (e) { dyingTarget = null; } }
		if (target === dyingTarget || (target === player && (player.hp || 0) <= 0)) {
			return !evaluateTaoRescue(player, target, ctx || {}).allow;
		}
		/* 非濒死：原有「留桃待救」逻辑 */
		if ((target.hp || 0) >= (target.maxHp || 1)) return false;
		if (target === player && player.hp > 1) return true;
		if (target !== player && isAllyOf(player, target) && target.hp > 1) return true;
		return false;
	} catch (e) { return false; }
}
export { _shouldSaveTao };

/* ================= 酒（濒死自救） ================= */
function _shouldJiuRescue(player, target) {
	try {
		if (player !== target) return false;
		const dying = _status.event && _status.event.dying;
		if (dying !== player) return false;
		if ((player.hp || 0) > 0) return false;

		const taoCount = player.countCards('hs', 'tao');
		if (taoCount > 0) return false;

		const jiuCount = player.countCards('hs', 'jiu');
		if (jiuCount <= 0) return false;

		if (player.hp + 1 <= 0) return false;

		return true;
	} catch (e) { return false; }
}

/* ================= 无懈可击 =================
 * ★ 指令 03：唯一权威来自 wuxieEvaluator（真实事件链上下文解析）。
 *   本模块不再维护第二套 critical/harmful 名单，也不再用「最后一张」硬否决。
 *   返回 true = 该出无懈（不惩罚）；false = 建议保留（打分惩罚）；null → fail-open 放行。 */
function _shouldWuxie(player, target, card) {
	try {
		const use = shouldUseWuxie(player, _status.event, {});
		if (use === null) return true;   /* 上下文待定 → 不阻止、不惩罚 */
		return use;
	} catch (e) { return true; }
}

/* ================= 借刀杀人 ================= */
/* 与实际 chooseToUse 评分共享持刀者/addedTarget 和分支比较。 */
function _jiedaoTarget(player){return resolveJiedaoResponse(player,_status.event)?.victim||null;}

/* ================= 响应场景辅助 ================= */
function _isRespondingToSha() {
	try {
		const ev = _status.event;
		if (!ev) return false;
		if (ev.name === 'chooseToRespond') return true;
		if (ev.getParent) {
			const p = ev.getParent();
			if (p && p.name === 'chooseToRespond') return true;
		}
		if (ev.name === 'nanman' || ev.name === 'juedou' || ev.name === 'jiedao') return true;
		// Borrowed Sha is handled before generic retention in skillTagFilter.
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return false;
}

/* ================= 备用响应逻辑（未接入流程） ================= */
function _shouldRespond(player, card, event) {
	try {
		const id = get.name(card, player);
		if (id === 'shan') return !_shouldKeepShan(player, card);
		if (id === 'tao') {
			const dying = _status.event && _status.event.dying;
			return !_shouldSaveTao(player, dying);
		}
		if (id === 'jiu') {
			const dying = _status.event && _status.event.dying;
			if (dying === player && (player.hp || 0) <= 0) {
				return _shouldJiuRescue(player, player);
			}
			return false;
		}
		if (id === 'wuxie') return !_shouldWuxie(player, event);
		return true;
	} catch (e) { return true; }
}

/* ================= 安装 ================= */
export function installResponseAI() {
	if (_installed || lib.skill[SKILL_ID]) return;
	try {
		lib.skill[SKILL_ID] = {
			silent: true,
			charlotte: true,
			superCharlotte: true,
			unique: true,
			temp: true,           // ★ 玩家死亡时自动清理
			invisible: true,      // ★ 不在技能列表显示
			ai: {
				skillTagFilter(player, tag, arg) {
					try {
						if (cfg('responseAI', true) === false) return;
						if (tag === 'respondShan' || tag === 'shan') {
							const keep = _shouldKeepShan(player, arg);
							if (keep) {
								try {
									_status.djsc_lastResponse = {
										kind: 'shan-keep', score: -3, ts: Date.now(),
										reason: '保留闪（HP=' + (player.hp || 0) + '）',
										hp: player.hp,
									};
								} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
								return false;
							}
						}
						if (tag === 'respondSha' || tag === 'sha') {
							/* A resolved branch cannot be vetoed again by generic Sha retention. */
							const borrow=evaluateJiedaoResponse(player,_status.event);
							if(borrow.resolved){
								_status.djsc_lastResponse={kind:'jiedao-'+borrow.action,score:borrow.delta,ts:Date.now(),reason:borrow.reason};
								return borrow.action==='transfer'?false:undefined;
							}
							if(_jiedaoTarget(player))return;

                            // Standard duel responds with legal Sha, regardless of rank. Native AI owns
                            // Sha requirements, conversion skills and voluntary damage decisions.
                            if(trickResponseContext(player,_status.event,['juedou']))return;

							/* 其它响应场景：杀保留判断 */
							if (_isRespondingToSha() && _shouldKeepSha(player, arg)) {
								try {
									_status.djsc_lastResponse = {
										kind: 'sha-keep', score: -3, ts: Date.now(),
										reason: '保留杀（手里 ' + player.countCards('hs', 'sha') + ' 张）',
									};
								} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
								return false;
							}
						}
					} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				},
				effect: {
					player(card, player, target) {
						try {
							if (cfg('responseAI', true) === false) return;
							const id = get.name(card, player);
							if (id === 'tao' && _shouldSaveTao(player, target)) {
								try {
									_status.djsc_lastResponse = { kind: 'tao-save', score: -2, ts: Date.now(), reason: '保留桃' };
								} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
								return [1, -0.4];
							}
							if (id === 'wuxie' && !_shouldWuxie(player, target, card)) {
								try {
									_status.djsc_lastResponse = { kind: 'wuxie-save', score: -2, ts: Date.now(), reason: '保留无懈' };
								} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
								return [1, -0.5];
							}
							if (id === 'jiu' && _shouldJiuRescue(player, target)) {
								try {
									_status.djsc_lastResponse = { kind: 'jiu-rescue', score: 5, ts: Date.now(), reason: '濒死自救' };
								} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
								return [1, 1.0];
							}
						} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					},
				},
			},
		};

		(game.players || []).forEach(function (p) {
			try {
				if (p && p !== game.me && !p.hasSkill(SKILL_ID)) p.addSkill(SKILL_ID);
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});
		_hookAddSkill();
		_removeJiedaoBridge=installJiedaoResponseBridge();
		_removeJiedaoChoiceBridge=installJiedaoChoiceBridge();

		_installed = true;
		log.info('response', '响应/弃牌 AI 增强已安装');
	} catch (e) {
		try { console.error('[决策积分] installResponseAI 失败：', e); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
	}
}

/* 使用共享的 addSkill 监听器（第 38 步） */
let _unhookAddSkill = null;
function _hookAddSkill() {
	if (_unhookAddSkill) return;
	try {
		_unhookAddSkill = onPlayerSkillInjected(function (player) {
			try {
				if (player !== game.me && !player.hasSkill(SKILL_ID) && lib.skill[SKILL_ID]) {
					lib.element.Player.prototype.addSkill.call(player, SKILL_ID);
				}
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export function uninstallResponseAI() {
	try {
		_removeJiedaoChoiceBridge?.();_removeJiedaoChoiceBridge=null;
		_removeJiedaoBridge?.();_removeJiedaoBridge=null;
		try { delete lib.skill[SKILL_ID]; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		(game.players || []).forEach(function (p) {
			try { p.removeSkill(SKILL_ID); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});
		if (_unhookAddSkill) {
			try { _unhookAddSkill(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			_unhookAddSkill = null;
		}
		_installed = false;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
