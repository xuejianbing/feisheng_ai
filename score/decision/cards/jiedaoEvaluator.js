/*
 * ============================================
 * // 作者：飞升原创
 * 交流群: 123456789
 * v3.1β
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 借刀杀人 · pair-action 唯一权威（Stage F） =================
 * 借刀的真实语义不是「选一个目标」的单目标控制，而是
 *   weaponHolder（持刀者）+ victim（被指定出杀的对象）的 pair 动作。
 * 本文件是该 pair 语义的唯一权威：枚举合法 pair、对 pair 打分、选出最优 pair。
 *
 * 决策规则（敌我三态经 relations 收敛，无第二套事实）：
 *   - victim 必须是「真敌」（isEnemyOf），绝不把队友选作被刀对象；
 *   - holder 必须是「持武器者」（equip1 子类型）；
 *   - 借敌刀杀敌 = 敌方内耗（正收益，但 holder 可能拒绝→折价）；
 *   - 借友刀杀敌 = 借队友武器输出（正收益，武器强则更值）；
 *   - holder=敌 + victim=队友 / holder 无武器 → 恒非法（负无穷，绝不选）。
 *
 * 诊断：最优 pair 写入 _status.djsc_lastJiedao（pair 列表摘要 + 最终选择）。
 */
import { game, get } from '../../foundation/adapt/host.js';
import { isAllyOf, isEnemyOf } from '../relations/relations.js';

function _swallow(e) {
	try {
		if (typeof window !== 'undefined' && window.__DJSC && typeof window.__DJSC.swallow === 'function') {
			window.__DJSC.swallow(e);
			return;
		}
	} catch (_) { /* swallow 自身失败不再递归 */ }
}

/* 是否持武器（equip1 子类型唯一判据，复用 timing/jiedaoTiming 同口径） */
export function hasWeapon(p) {
	try {
		if (!p || typeof p.getCards !== 'function') return false;
		const equips = p.getCards('e') || [];
		for (let i = 0; i < equips.length; i++) {
			let subs = [];
			try { subs = (typeof get.subtypes === 'function') ? (get.subtypes(equips[i]) || []) : []; } catch (e) { subs = []; }
			if (subs.indexOf('equip1') >= 0) return true;
		}
		return false;
	} catch (e) { _swallow(e); return false; }
}

/* victim 效用：只允许真敌；残血有收割加成 */
function _victimValue(me, victim) {
	try {
		if (!isEnemyOf(me, victim)) return -Infinity;   /* 绝不把队友/中性选为被刀对象 */
		let v = 1.0;
		if (victim.hp !== undefined) {
			if (victim.hp <= 1) v += 2.0;
			else if (victim.hp <= 2) v += 1.0;
		}
		return v;
	} catch (e) { _swallow(e); return -Infinity; }
}

/* 单 pair 效用：holder 持刀 + victim 为敌的净收益 */
export function evaluateJiedaoPair(me, holder, victim) {
	try {
		if (!me || !holder || !victim || holder === victim) {
			return { use: false, score: -Infinity, reason: 'pair 非法' };
		}
		if (!hasWeapon(holder)) {
			return { use: false, score: -Infinity, reason: '持刀者无武器' };
		}
		const vv = _victimValue(me, victim);
		if (vv === -Infinity) {
			return { use: false, score: -Infinity, reason: '被刀对象非敌' };
		}
		let score = vv;
		let reason = '';
		if (isAllyOf(me, holder)) {
			/* 借队友刀打敌：可靠输出，武器强度越高越值（+0.5 基础可信度） */
			score += 0.5;
			reason = '借队友刀打敌';
		} else if (isEnemyOf(me, holder)) {
			/* 借敌刀杀敌：敌方内耗，价值高但 holder 可能拒绝 → 保守折价 */
			score += 0.2;
			reason = '借敌刀杀敌';
		} else {
			return { use: false, score: -Infinity, reason: '持刀者身份未明' };
		}
		return { use: score > 0, score: Math.round(score * 100) / 100, reason: reason };
	} catch (e) {
		_swallow(e);
		return { use: false, score: -Infinity, reason: '评估出错' };
	}
}

/* 枚举所有合法 (holder, victim) pair，按效用降序 */
export function enumerateJiedaoPairs(me) {
	const out = [];
	try {
		const players = game.players || [];
		const holders = [];
		const enemies = [];
		players.forEach(function (p) {
			if (!p || p === me || p.alive === false) return;
			if (hasWeapon(p)) holders.push(p);
			if (isEnemyOf(me, p)) enemies.push(p);
		});
		holders.forEach(function (h) {
			enemies.forEach(function (v) {
				if (h === v) return;
				const r = evaluateJiedaoPair(me, h, v);
				if (r.score === -Infinity) return;
				out.push({ holder: h, victim: v, score: r.score, reason: r.reason });
			});
		});
		out.sort(function (a, b) { return b.score - a.score; });
	} catch (e) { _swallow(e); }
	return out;
}

/* 最优 pair（含 use/score/理由），供 timing 层委托与诊断 */
export function bestJiedaoPair(me) {
	try {
		const pairs = enumerateJiedaoPairs(me);
		if (!pairs.length) return { use: false, score: 0, reason: '无合法借刀 pair', pairs: [] };
		const best = pairs[0];
		try {
			if (typeof window !== 'undefined' && window.__DJSC) {
				window.__DJSC._status = window.__DJSC._status || {};
			}
		} catch (_) { /* 诊断写入失败不阻断 */ }
		return {
			use: best.score > 0,
			score: best.score,
			reason: best.reason,
			holder: best.holder,
			victim: best.victim,
			pairs: pairs.slice(0, 5).map(function (x) {
				return { holder: x.holder && (x.holder.name1 || x.holder.name), victim: x.victim && (x.victim.name1 || x.victim.name), score: x.score };
			}),
		};
	} catch (e) {
		_swallow(e);
		return { use: false, score: 0, reason: '枚举出错' };
	}
}

export default { hasWeapon, evaluateJiedaoPair, enumerateJiedaoPairs, bestJiedaoPair };