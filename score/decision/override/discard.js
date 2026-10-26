import { tacticalEnabled } from '../strategy/tacticalOptimization.js?v=41a';
/*
 * ============================================
 * // Wydawca: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 接管 chooseToDiscard =================
 * 弃牌时按引擎的价值排序，优先弃低价值牌。
 * 降级策略与 use.js 相同。
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js?v=41a';
// 作者：飞升原创 | 許可：GPL-3.0
import { log } from '../../foundation/diag/logger.js?v=41a';
import { cardValueOf } from '../threat/threat.js?v=41a';
import { decideDiscard } from '../basic/discardBrain.js?v=41a';
import { executionEligibility, invokeHost } from '../execution/executionGateway.js?v=41a';
import { isEnemyOf } from '../relations/relations.js?v=41a';   /* ★ 指令 05 Stage B：敌我唯一权威源 */
import {versusDiscardPremium} from '../modes/versus/resourceReserveRuntime.js?v=41a';

import { bindChoiceLifecycle, patchChoiceField, completeChoiceTrace, choiceStat, choicePlayerBlocked } from './choiceLifecycle.js?v=41a';

const ORIG_KEY = '__djsc_orig_chooseToDiscard';
const SENTINEL = '__djsc_overridden_discard';

function _shouldOverride(player, event) {
	return executionEligibility('discard', player, event, { sentinel: SENTINEL }).ok;
}

/* ★ 修复：ai.check 返回值带关键牌保护 */
/* ★ 弃牌 AI 关键牌保护（增强版） */
function _buildCheck(player) {
	return function (card) {
		try {
			const name = get.name(card, player);
			const v = cardValueOf(card, player);
			let mul = 1.0;

			/* ===== ★ 基本弃牌决策标准（discardBrain）：明确否决 → 力保防弃 ===== */
			try {
				const dBrain = decideDiscard(name, {
					me: {
						hp: player.hp, maxHp: player.maxHp,
						wuxieCount: player.countCards('hs', 'wuxie'),
						shaCount: player.countCards('hs', 'sha'),
						hasZhuge: !!(player.getEquip && player.getEquip('zhuge')),
						hasPaoxiao: !!(player.hasSkill && player.hasSkill('paoxiao')),
					},
				});
				if (dBrain.veto) {
					/* 力保：返回极大负值，避免被选为弃牌 */
					return -1000;
				}
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

			/* ===== 基础保护：关键牌乘数提升 ===== */
			if (name === 'tao') {
				/* 桃：血量越低越宝贵 */
				const hpRatio = (player.hp || 0) / Math.max(1, player.maxHp || 1);
				if (hpRatio < 0.3) mul = 4.0;
				else if (hpRatio < 0.5) mul = 2.8;
				else if (hpRatio < 0.7) mul = 2.0;
				else if (hpRatio >= 0.9) {
					/* ★ 血量健康：桃不再稀缺——多于 1 张时随行弃置（留 1 张备用） */
					const taoCntD = player.countCards('hs', 'tao');
					mul = taoCntD > 1 ? 0.8 : 1.0;
				}
				else mul = 1.6;
			} else if (name === 'wuxie') {
				/* 无懈：手里唯一时极宝贵，多张时可弃 */
				const wxCount = player.countCards('hs', 'wuxie');
				if (wxCount === 1) mul = 3.0;
				else if (wxCount === 2) mul = 1.8;
				else mul = 1.2;
			} else if (name === 'shan') {
				/* 闪：血量低 + 面对连弩 → 极高保护 */
				const hp = player.hp || 0;
				let hasEnemyZhuge = false;
				try {
					for (const p of (game.players || [])) {
						if (!p || p === player || p.alive === false) continue;
						if (!isEnemyOf(player, p)) continue;
						if (p.getEquip && p.getEquip('zhuge')) { hasEnemyZhuge = true; break; }
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				if (hp <= 1) mul = 4.0;
				else if (hp <= 2) mul = 2.8;
				else if (hasEnemyZhuge) mul = 2.2;
				else if (hp <= 3) mul = 1.6;
				else mul = 1.2;
			} else if (name === 'sha') {
				/* 杀：有连弩/咆哮/唯一杀时保护 */
				const shaCount = player.countCards('hs', 'sha');
				const hasZhuge = !!(player.getEquip && player.getEquip('zhuge'));
				const hasPaoxiao = player.hasSkill && player.hasSkill('paoxiao');
				if (shaCount === 1 && (hasZhuge || hasPaoxiao)) mul = 2.2;
				else if (shaCount === 1) mul = 1.5;
				else if (shaCount === 2) mul = 1.2;
				else mul = 1.0;
			} else if (name === 'jiu') {
				/* 酒：配合杀时保护 */
				const hasSha = player.countCards('hs', 'sha') > 0;
				if (hasSha && (player.getEquip && player.getEquip('zhuge'))) mul = 1.8;
				else if (hasSha) mul = 1.3;
				else mul = 1.0;
			}

			/* ===== 装备保护 ===== */
			try {
				const subs = get.subtypes(card);
				if (subs && subs.length) {
					/* 防具、坐骑：已装备替代品不足时保护 */
					if (subs.indexOf('equip2') >= 0) {
						/* 防具：如果是唯一防具 → 保护 */
						const hasOtherArmor = player.getCards('e').some(function (ec) {
							try { return get.subtypes(ec).indexOf('equip2') >= 0 && ec !== card; } catch (e) { return false; }
						});
						if (!hasOtherArmor) mul = Math.max(mul, 1.4);
					}
					if (subs.indexOf('equip1') >= 0 && name === 'zhuge') {
						/* 连弩：手里杀 >= 2 时极宝贵 */
						const shaCount = player.countCards('hs', 'sha');
						if (shaCount >= 2) mul = Math.max(mul, 2.0);
					}
				}
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

			/* ===== 已明知的牌：被敌方已知 → 相对不值钱 → 优先弃 ===== */
			try {
				let isKnown = false;
				for (const p of (game.players || [])) {
					if (!p || p === player || p.alive === false) continue;
					if (!isEnemyOf(player, p)) continue;
					try {
						const known = p.getKnownCards ? p.getKnownCards(player) : [];
						if (known.indexOf(card) >= 0) { isKnown = true; break; }
					} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				}
				/* 己方已知牌 → 减 30% 保护（可弃） */
				if (isKnown) mul *= 0.7;
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

			/* ===== 濒死保护：血量 <= 1 时所有防御牌翻倍 ===== */
			if ((player.hp || 0) <= 1) {
				if (name === 'shan' || name === 'tao' || name === 'wuxie' || name === 'jiu') {
					mul *= 1.5;
				}
			}

			/* 统计打点 */
			try {
				if (!_status.djsc_overrideStats) {
					_status.djsc_overrideStats = { use: {}, respond: {}, discard: {}, compare: {}, soft: {} };
				}
				const b = _status.djsc_overrideStats.discard;
				b.check = (b.check || 0) + 1;
			} catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }

			// Keep the native choice lifecycle's null fallback on failures.
			return -v * mul - versusDiscardPremium(player, card, _status.event);
		} catch (e) { return null; }
	};
}

export function installDiscardOverride() {
	try {
		const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (!proto) return;
		if (proto[ORIG_KEY]) return;

		const orig = proto.chooseToDiscard;
		if (typeof orig !== 'function') return;
		proto[ORIG_KEY] = orig;

        proto.chooseToDiscard = function (...args) {
            const player = this, parent = _status.event;
            if (choicePlayerBlocked(player) || tacticalEnabled('fire') && parent?.name === 'huogong') return orig.apply(this, args);
            const host = invokeHost({ kind: 'discard', player, orig, thisArg: this, args,
                failureReason: e => '原生 chooseToDiscard 异常：' + e.message });
            if (!host.ok) return host.result;
            const next = host.result;
            bindChoiceLifecycle(next, 'discard', function (ev, trace, registerCleanup) {
                if (choicePlayerBlocked(player) || !_shouldOverride(player, ev)) return;
                const originalAI = ev.ai, check = _buildCheck(player);
                let restoreAI = () => {};
                const restore = () => { restoreAI(); delete ev[SENTINEL]; };
                registerCleanup(restore);
                ev[SENTINEL] = true;
                restoreAI = patchChoiceField(ev, 'ai', function () {
                    const score = check.apply(this, arguments);
                    if (typeof score === 'number' && Number.isFinite(score)) return score;
                    return typeof originalAI === 'function' ? originalAI.apply(this, arguments) : 0;
                });
                return restore;
            }, function (ev, trace) {
                completeChoiceTrace(ev, trace);
                if (trace.selected) choiceStat('discard', 'selected');
                if (trace.executed) choiceStat('discard', 'executed');
            });
            return next;
        };

		log.info('override', 'chooseToDiscard 接管层已安装');
	} catch (e) {
		try { console.error('[决策积分] installDiscardOverride 失败：', e); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
	}
}

export function uninstallDiscardOverride() {
	try {
		const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (!proto || !proto[ORIG_KEY]) return;
		proto.chooseToDiscard = proto[ORIG_KEY];
		delete proto[ORIG_KEY];
		log.info('override', 'chooseToDiscard 接管层已卸载');
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
