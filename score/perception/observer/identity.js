/*
 * ============================================
 * // Autor: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 身份推理系统 =================
 * 依赖：observer.js（行为数据）、profile.js（画像）
 * 提供：
 *   updateBelief()                          全量刷新信念
 *   identityOf(player)                      最可能身份
 *   confidenceOf(player)                    置信度 0~1
// लेखक: फ़ेशेंग मूल | लाइसेंस: GPL-3.0
 *   isLikelyEnemy / isLikelyAlly            推理级敌友
 *   explainIdentity(player)                 调试
 *   resetBelief()                           生命周期
 * 仅在 identity 模式下生效；其它模式直接返回 "unknown"。
 * 注：本模块内联身份模式判断（不依赖 mode.js），保持叶子性。
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js?v=41a';
import { attackBy, aidBy, hostilityOf, friendlinessOf, getObservationRevision, getObs } from './observer.js?v=41a';
import { probHasCard } from '../../model/predict/handInference.js?v=41a';
import { playerKey, resolvePlayerByKey } from '../../foundation/adapt/playerIdentity.js?v=41a';
import { identityCampRelation, publicIdentityRole, selfIdentityRole, identityRoleInventory, remainingIdentitySlots, identityFactsState, resetIdentityFacts, identityRuleCapabilities } from './identityFacts.js?v=41a';
import {resetIdentityEvidence} from './identityEvidence.js?v=41a';
export {identityModelCompatibility} from '../../model/features/identityCompatibility.js?v=41a';

/* 计算某玩家打反贼的总次数（内奸也会打反贼） */
function attackFans(p, zhu) {
    try {
        let total = 0;
        (game.players || []).forEach(function (other) {
            if (!other || other === p || other === zhu) return;
            /* 只统计打身份已明置为反贼的玩家 */
            if (other.identityShown && other.identity === 'fan') {
                total += attackBy(p, other);
            }
        });
        return total;
    } catch (e) { return 0; }
}

const BELIEF = Object.create(null);
const IDENTITY_VIEWS = new Map();
let _beliefRound = -1;
let _beliefEvidenceRevision = -1;
let _beliefPublicKey = '';
let _beliefUpdating = false;

function keyOf(p) {
	try { return playerKey(p) || ""; } catch (e) { return ""; }
}

/* 只读取公开身份/存活等可观测字段，不读取隐藏身份。
 * 用于同一回合内“身份明置/阵营公开”后立即刷新信念。 */
function _publicIdentityFingerprint() {
    const state = identityFactsState(null);
    return state.sessionId + ':' + state.publicRevision + ':' + state.ruleVersion;
}

/* 内联模式判断：identity 局才启用 */
export function currentMode() {
	try {
		if (get && typeof get.mode === "function") return get.mode();
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try {
		if (_status && _status.mode) return _status.mode;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return "unknown";
}

function _getB(p) {
	const k = keyOf(p);
	if (!k) return null;
	if (!BELIEF[k]) BELIEF[k] = { zhu: 0, zhong: 0, fan: 0, nei: 0, updated: -1 };
	return BELIEF[k];
}

/* ---------- 已阵亡阵营反推：辅助函数 ----------
 * 原理：身份局阵营有确定数量上限（内奸恒为 1，反贼/忠臣随非主公人数固定）。
 * 一旦某阵营已【现身】(明置或阵亡后公开)的数量达到上限 → 其余存活者该阵营信念应归零。
 * 保守约定：仅当“现身数 ≥ 上限”才剔除，绝不提前，避免配置不符时误判。 */
function _allPlayers() {
	try {
		const arr = (game.players || []).concat(game.dead || []);
		const seen = Object.create(null), out = [];
		arr.forEach(function (x) {
			if (!x) return;
			const k = keyOf(x);
			if (!k || seen[k]) return;
			seen[k] = 1;
			out.push(x);
		});
		return out;
	} catch (e) { return game.players || []; }
}

/* ---------- Role Inventory：规则配额 + 公开事实 ---------- */

const _ROLE_IDS = ['zhu', 'zhong', 'fan', 'nei'];

function _normalizeRole(role) {
	if (role === 'mingzhong') return 'zhong';
	return _ROLE_IDS.indexOf(role) >= 0 ? role : null;
}

/* 公开事实：只允许读取已经明置的身份；主公天然公开。 */
function _publicRoleOf(p) { return publicIdentityRole(p); }
function _selfRoleOf(observer) { return selfIdentityRole(observer); }
export function roleInventory() { return identityRoleInventory(); }
export function remainingRoleSlots(observer) { return remainingIdentitySlots(observer); }

/**
 * 只有“公开事实”或“规则槽位唯一解”才算 hard identity。
 * 行为概率再高也不 hard-lock，避免一次误判永久污染。
 */
export function hardIdentityOf(observer, target) {
	try {
		if (!target) return { role: null, source: 'none' };
		const pub = _publicRoleOf(target);
		if (pub) return { role: pub, source: 'public' };
		if (observer && target === observer) {
			const own = _selfRoleOf(observer);
			if (own) return { role: own, source: 'self' };
		}

		const rs = remainingRoleSlots(observer);
		if (!rs.constrainable || rs.unknownCount <= 0) return { role: null, source: 'none' };
		const positive = ['zhong', 'fan', 'nei'].filter(function (r) { return (rs.counts[r] || 0) > 0; });
		if (positive.length === 1 && (rs.counts[positive[0]] || 0) === rs.unknownCount) {
			return { role: positive[0], source: 'unique_remaining_slot' };
		}
		return { role: null, source: 'none' };
	} catch (e) { return { role: null, source: 'none' }; }
}

/**
 * 规则层“是否可能”：与概率大小严格分离。
 * true 只表示该身份仍有合法槽位；false 才表示逻辑上不可能。
 */
export function isRolePossibleFor(observer, target, role) {
	try {
		const r = _normalizeRole(role);
		if (!target || !r) return false;
		const hard = hardIdentityOf(observer, target);
		if (hard.role) return hard.role === r;

		const rs = remainingRoleSlots(observer);
		if (!rs.constrainable) return true; // 无法确认规则配额时 fail-open，不做错误排除
		return (rs.counts[r] || 0) > 0;
	} catch (e) { return true; }
}


/* ---------- 单个玩家的信念计算 ---------- */
function _computeBelief(p) {
	const b = { zhu: 0, zhong: 0, fan: 0, nei: 0, updated: (_status && _status.roundNumber) || 0 };
	if (!p) return b;

    const publicRole = _publicRoleOf(p);
    if (publicRole) return Object.assign(b, Object.fromEntries(_ROLE_IDS.map(r=>[r, r === publicRole ? 1 : 0])));
    if (!identityRuleCapabilities().standard) return Object.assign(b,{zhu:.25,zhong:.25,fan:.25,nei:.25});

	const zhu = game.zhu;
	if (!zhu || zhu === p) return b;

	/* ★ 主公视角：只知道自己是主公，其他人身份未知
	 * 不能把内奸直接当反贼打，要看行为：
	 *   - 打反贼多 → 可能是忠臣或内奸
	 *   - 救主公多 → 可能是忠臣
	 *   - 打主公多 → 可能是反贼
	 *   - 对所有人中立 → 可能是内奸 */

	/* 行为证据：对主公的攻击/援助 */
	const atkZhu = attackBy(p, zhu);
	const aidZhu = aidBy(p, zhu);

	/* 打反贼的行为（内奸也会打反贼） */
	const atkFan = attackFans(p, zhu);

	/* 反贼：打主公多、救主公少 */
	const fanScore = atkZhu * 0.4 - aidZhu * 0.2;

	/* 忠臣：救主公多、打主公少、打反贼多 */
	const zhongScore = aidZhu * 0.4 - atkZhu * 0.25 + atkFan * 0.15;

	/* 内奸：前期保证主公不死（救主公、打反贼），后期杀主公
	 * 主公阵亡→内奸也失败，所以前期内奸会：
	 *   - 救主公（桃/无懈）
	 *   - 打反贼
	 *   - 不打主公
	 * 后期（≤3人）内奸才会：
	 *   - 打主公
	 *   - 不救主公 */
	const h = hostilityOf(p);
	const f = friendlinessOf(p);
	const balance = -Math.abs(h - f) * 0.15 + Math.min(h, f) * 0.1;
	const aliveCount = (game.players || []).filter(function (pp) { return pp && pp.alive !== false; }).length;
	const isLateGame = aliveCount <= 3;

	/* 前期：内奸救主公多 → 可能是内奸（但也可能是忠臣） */
	/* 前期：内奸打反贼多 → 可能是内奸（但也可能是忠臣） */
	/* 后期：内奸打主公 → 一定是内奸 */
	let neiScore = balance + atkFan * 0.1 - aidZhu * 0.1;
	if (isLateGame && atkZhu > 0) {
		neiScore += 0.3;  // 后期打主公→内奸倾向强
	}
	/* 前期救主公但不打反贼→可能是忠臣，不是内奸 */
	if (!isLateGame && aidZhu > 0 && atkFan === 0) {
		neiScore -= 0.1;  // 救主公但不打反贼→更像忠臣
	}

	/* 位置先验：主公下家反贼略高（身份局常见）；API 不稳时忽略 */
	try {
		if (zhu && p && p.previousSeat === zhu) {
			const seatBonus = 0.15;
			b.fan = fanScore + seatBonus;
			b.zhong = zhongScore;
			b.nei = neiScore * 0.9;
		} else if (zhu && p && p.nextSeat === zhu) {
			b.fan = fanScore * 0.95;
			b.zhong = zhongScore + 0.1;
			b.nei = neiScore * 0.9;
		} else {
			b.fan = fanScore;
			b.zhong = zhongScore;
			b.nei = neiScore;
		}
	} catch (e) {
		b.fan = fanScore;
		b.zhong = zhongScore;
		b.nei = neiScore;
	}

	/* 身份推理禁止消费宿主 get.attitude/rawAttitude：
	 * 宿主身份模式内部可读取未公开 identity，因此不能作为“公平信息”证据。
	 * 此层只使用公开事实、合法观测和规则身份槽位。 */

	/* ★ 扩写：更多身份推理信号（权重全部再减半） */
	try {
		/* 1. 击杀行为：反贼倾向于杀忠臣，忠臣倾向于杀反贼 */
		const kills = (p._djsc_kills || []);
		if (kills.length > 0) {
			kills.forEach(function (victim) {
				/* 如果击杀的是已经明置的忠臣，那大概率是反贼 */
				const v = resolvePlayerByKey(victim, (game.players || []).concat(game.dead || []));
				if (v && v.identityShown && v.identity === 'zhong') b.fan += 0.1;
				/* 如果击杀的是已经明置的反贼，那大概率是忠臣 */
				if (v && v.identityShown && v.identity === 'fan') b.zhong += 0.1;
			});
		}
		/* 2. 救援行为：忠臣倾向于救主公 */
		const saves = (p._djsc_saves || []);
		if (saves.length > 0) {
			saves.forEach(function (saved) {
				if (resolvePlayerByKey(saved, (game.players || []).concat(game.dead || [])) === zhu) b.zhong += 0.08;
			});
		}
		/* 3. 装备偏好：反贼更倾向于进攻型装备，忠臣更倾向于防御型装备 */
		const equips = p.getCards ? p.getCards('e') : [];
		let atkEquip = 0, defEquip = 0;
		equips.forEach(function (e) {
			const name = get.name(e);
			if (name === 'zhuge' || name === 'qinggang' || name === 'guanshi') atkEquip++;
			if (name === 'bagua' || name === 'renwang' || name === 'baiyin') defEquip++;
		});
		if (atkEquip > defEquip) b.fan += 0.05;
		else if (defEquip > atkEquip) b.zhong += 0.05;
		/* 4. 手牌倾向信号（★ V01修复：不再读对手手牌内容=透视，改用合法概率推断）
		 *    反贼倾向留攻击牌、忠臣倾向留防御牌 —— 仅用于给身份先验加微偏置 */
		try {
			let atkP = 0, defP = 0;
			atkP = probHasCard(p, 'sha') + probHasCard(p, 'juedou') + probHasCard(p, 'nanman') + probHasCard(p, 'wanjian');
			defP = probHasCard(p, 'shan') + probHasCard(p, 'tao') + probHasCard(p, 'wuxie');
			if (atkP > defP + 0.2) b.fan += 0.04;
			else if (defP > atkP + 0.2) b.zhong += 0.08;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ★ 扩展信号：距离 + 出牌偏好 + 被攻击记录 */
		try {
			/* 1. 距离信号：与主公距离近 → 反贼概率略升（先手压制） */
			if (zhu && p) {
				let dist = 0;
				try {
					dist = zhu.distanceTo(p);
					if (dist === 1) {
						b.fan += 0.2;
						b.zhong += 0.1;
					} else if (dist >= 4) {
						b.zhong += 0.15;   /* 距离远，对主公威胁低 */
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			}

			/* 2. 出牌偏好：对主公使用拆牌 → 反贼概率 */
			try {
				const obs = getObs ? getObs() : null;
				if (obs && obs[keyOf(p)]) {
					const e = obs[keyOf(p)];
					/* 该玩家用过拆牌类打主公 */
					if (e.attacks && zhu) {
						const zhuKey = keyOf(zhu);
						if (e.attacks[zhuKey] >= 2) b.fan += 0.3;
						else if (e.attacks[zhuKey] >= 1) b.fan += 0.15;
					}
					/* 该玩家用过桃/无懈救主公 */
					if (e.aids && zhu) {
						const zhuKey = keyOf(zhu);
						if (e.aids[zhuKey] >= 1) b.zhong += 0.4;
					}
				}
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

			/* 3. 被攻击记录：谁打过该玩家 → 谁的身份倾向 */
			try {
				const obs = getObs ? getObs() : null;
				if (obs) {
					const myKey = keyOf(p);
					/* 遍历所有玩家，统计谁打过该玩家 */
					let attackedByFan = 0, attackedByZhong = 0;
					for (const other of (game.players || [])) {
						if (!other || other === p || other === zhu) continue;
						if (!obs[keyOf(other)]) continue;
						const oAttacks = obs[keyOf(other)].attacks || {};
						if (oAttacks[myKey] >= 1) {
							/* 基础行为 belief 必须 observer-agnostic：
							 * 二阶证据只使用 other 的公开身份，不调用匿名 identityOf(other)。 */
							const otherId = _publicRoleOf(other);
							if (otherId === 'fan') attackedByFan++;
							else if (otherId === 'zhong') attackedByZhong++;
						}
					}
					/* ★ 互杀修复：单次攻击只算弱证据（可能是顺拆/AOE 波及/战术换牌），
					 *   ≥2 次才给足额权重——防止几回合交火就把队友推成反贼。 */
					if (attackedByFan >= 2) b.zhong += 0.2 * attackedByFan;
					else if (attackedByFan === 1) b.zhong += 0.08;
					if (attackedByZhong >= 2) b.fan += 0.2 * attackedByZhong;
					else if (attackedByZhong === 1) b.fan += 0.08;
				}
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

			/* 4. 内奸特征：对所有人攻击/援助均衡 */
			try {
				const obs = getObs ? getObs() : null;
				if (obs && obs[keyOf(p)]) {
					const e = obs[keyOf(p)];
					const totalAtk = Object.keys(e.attacks || {}).reduce(function (s, k) {
						return s + (e.attacks[k] || 0);
					}, 0);
					const totalAid = Object.keys(e.aids || {}).reduce(function (s, k) {
						return s + (e.aids[k] || 0);
					}, 0);
					/* 攻击与援助都高 → 内奸特征（不分敌我） */
					if (totalAtk >= 2 && totalAid >= 1) {
						const balance = Math.abs(totalAtk - totalAid) / Math.max(1, totalAtk + totalAid);
						if (balance < 0.5) b.nei += 0.3;
					}
					/* 只打不救 → 弱反/内迹象（★ 减权：缺桃缺救援的忠臣前期同样只打不救，防误判） */
					if (totalAid === 0 && totalAtk >= 2) {
						b.fan += 0.06;
						b.nei += 0.06;
					}
				}
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }


	/* 行为层只产生 soft likelihood，不读取任何未公开真实身份。
	 * 负分先截断；完全无证据时保持中性 1/3，规则配额在查询层再约束。 */
	b.fan = Math.max(0, Number(b.fan) || 0);
	b.zhong = Math.max(0, Number(b.zhong) || 0);
	b.nei = Math.max(0, Number(b.nei) || 0);
	const total = b.fan + b.zhong + b.nei;
	if (total > 0) {
		b.fan /= total;
		b.zhong /= total;
		b.nei /= total;
	} else {
		b.fan = 1 / 3;
		b.zhong = 1 / 3;
		b.nei = 1 / 3;
	}

	/* 若本体已公开 identityShown，直接覆盖 */
	try {
		if (_publicRoleOf(p)) {
			const shownRole = _publicRoleOf(p);
			if (shownRole === "fan") { b.fan = 1; b.zhong = 0; b.nei = 0; }
			else if (shownRole === "zhong") { b.zhong = 1; b.fan = 0; b.nei = 0; }
			else if (shownRole === "nei") { b.nei = 1; b.fan = 0; b.zhong = 0; }
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	return b;
}

/* ---------- 全量刷新 ---------- */
export function updateBelief() {
	if (_beliefUpdating) return;
	try {
		if (currentMode() !== "identity") return;
		_beliefUpdating = true;

		/* 先写 revision marker，避免 _computeBelief 内部间接查询 identityOf 时递归刷新。 */
		_beliefRound = (_status && _status.roundNumber) || 0;
		_beliefEvidenceRevision = getObservationRevision();
		_beliefPublicKey = _publicIdentityFingerprint();

		(game.players || []).forEach(function (p) {
			if (!p || p.alive === false) return;
			const b = _getB(p);
			if (!b) return;
			const nb = _computeBelief(p);
			Object.assign(b, nb);
		});
	} catch (e) {
		if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e);
	} finally {
		_beliefUpdating = false;
	}
}

function _syncBelief() {
	try {
		if (_beliefUpdating) return;
		const r = (_status && _status.roundNumber) || 0;
		const ev = getObservationRevision();
		const pub = _publicIdentityFingerprint();
		/* 不再“每回合只算一次”：行为证据或公开身份一变化，同回合立即刷新。 */
		if (r !== _beliefRound || ev !== _beliefEvidenceRevision || pub !== _beliefPublicKey) updateBelief();
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ---------- 查询：基础行为 belief + observer-specific 槽位约束 ---------- */

function _roundBelief(b) {
	if (!b) return null;
	return {
		fan: Math.round((b.fan || 0) * 100) / 100,
		zhong: Math.round((b.zhong || 0) * 100) / 100,
		nei: Math.round((b.nei || 0) * 100) / 100,
	};
}

function _copyBelief(b) {
	if (!b) return null;
	return {
        zhu: Number(b.zhu) || 0,
		fan: Number(b.fan) || 0,
		zhong: Number(b.zhong) || 0,
		nei: Number(b.nei) || 0,
	};
}


/**
 * observer 视角的合法后验：
 *  - public / self / 唯一剩余槽位直接 one-hot；
 *  - 其它玩家 = 行为 likelihood × 剩余身份槽位 prior；
 *  - 槽位为 0 的身份概率严格归零。
 */
export function beliefOfFor(observer, p) {
	try {
		if (!p || currentMode() !== 'identity') return null;
		const hard = hardIdentityOf(observer, p);
		if (hard.role) {
			return {
				fan: hard.role === 'fan' ? 1 : 0,
				zhong: hard.role === 'zhong' ? 1 : 0,
				nei: hard.role === 'nei' ? 1 : 0,
			};
		}

		_syncBelief();
		const base = _getB(p);
		if (!base) return null;

		const rs = remainingRoleSlots(observer);
		if (!rs.constrainable) return _copyBelief(base);

		const roles = ['fan', 'zhong', 'nei'];
		let slotTotal = 0;
		for (const role of roles) slotTotal += Math.max(0, rs.counts[role] || 0);
		if (slotTotal <= 0) return _copyBelief(base);

		const score = { fan: 0, zhong: 0, nei: 0 };
		let total = 0;
		for (const role of roles) {
			const slots = Math.max(0, rs.counts[role] || 0);
			if (slots <= 0) { score[role] = 0; continue; }
			const prior = slots / slotTotal;
			/* 0.05 smoothing：行为没有证据 ≠ 逻辑上不可能；只有规则槽位能置 0。 */
			score[role] = (Math.max(0, Number(base[role]) || 0) + 0.05) * prior;
			total += score[role];
		}
		if (total <= 0) return _copyBelief(base);
		for (const role of roles) score[role] /= total;
		return _copyBelief(score);
	} catch (e) { return null; }
}

const SOFT_IDENTITY_MIN = 0.65;
const SOFT_IDENTITY_MARGIN = 0.20;

export function identityOfFor(observer, p) {
	try {
		if (!p || currentMode() !== 'identity') return 'unknown';
		const hard = hardIdentityOf(observer, p);
		if (hard.role) return hard.role;

		const b = beliefOfFor(observer, p);
		if (!b) return 'unknown';
		const ranked = ['fan', 'zhong', 'nei']
			.map(function (role) { return { role: role, p: Number(b[role]) || 0 }; })
			.sort(function (a, z) { return z.p - a.p; });
		const best = ranked[0], second = ranked[1] || { p: 0 };

		/* “最可能”不等于“可命名身份”：
		 * 50/50、接近打平或置信不足都保持 unknown。 */
		if (!best || best.p < SOFT_IDENTITY_MIN) return 'unknown';
		if (best.p - second.p < SOFT_IDENTITY_MARGIN) return 'unknown';
		return best.role;
	} catch (e) { return 'unknown'; }
}

export function confidenceOfFor(observer, p) {
	try {
		if (!p || currentMode() !== 'identity') return 0;
		if (hardIdentityOf(observer, p).role) return 1;
		const b = beliefOfFor(observer, p);
		if (!b) return 0;
		/* 决策层保留完整精度；仅 explain/debug 输出允许四舍五入。 */
		return Math.max(b.fan || 0, b.zhong || 0, b.nei || 0);
	} catch (e) { return 0; }
}

/* 兼容旧 API：不使用任何其它玩家的私有身份，只按公开观察者视角计算。 */
export function identityOf(p) { return identityOfFor(null, p); }
export function confidenceOf(p) { return confidenceOfFor(null, p); }
export function beliefOf(p) { return beliefOfFor(null, p); }

/* 新接口保留旧评分模型作对照；概率未校准，不以 maxProb 冒充可信度。 */
export function identityView(observer, target, context = {}) {
    if (!target || currentMode() !== 'identity') return null;
    const state = identityFactsState(observer, context);
    const evidenceRevision = getObservationRevision();
    const key = JSON.stringify([state.sessionId,state.observerId,state.privateVersion,state.publicRevision,
        evidenceRevision,state.ruleVersion,(_status && _status.roundNumber) || 0]);
    const pair = JSON.stringify([state.observerId,keyOf(target)]);
    const cached = IDENTITY_VIEWS.get(pair);
    if (cached && cached.key === key) return cached.value;
    const hard = hardIdentityOf(observer,target);
    const b = beliefOfFor(observer,target) || {};
    const probabilities = hard.role
        ? Object.fromEntries(_ROLE_IDS.map(r=>[r,hard.role === r ? 1 : 0]))
        : {zhu:b.zhu || 0,zhong:b.zhong || 0,fan:b.fan || 0,nei:b.nei || 0};
    const slots = remainingRoleSlots(observer);
    const possibleRoles = hard.role ? [hard.role] : _ROLE_IDS.filter(r=>!slots.constrainable || slots.counts[r]>0);
    const entropy = -Object.values(probabilities).reduce((s,p)=>s+(p>0?p*Math.log(p):0),0);
    const value = Object.freeze({...state,targetId:keyOf(target),probabilities:Object.freeze(probabilities),hardRole:hard.role,
        source:hard.source === 'unique_remaining_slot' ? 'constraint' : hard.role ? hard.source : 'inference',
        possibleRoles:Object.freeze(possibleRoles),evidenceRevision,beliefVersion:'legacy-score-v1',calibrated:false,
        diagnostics:Object.freeze({evidenceGroups:0,entropy,maxProbability:Math.max(...Object.values(probabilities)),
            reasonCodes:Object.freeze([...slots.reasonCodes,...(!hard.role?['legacy-uncalibrated-belief']:[])])})});
    IDENTITY_VIEWS.set(pair,{key,value});
    return value;
}

/* ---------- 推理级敌友：Identity 固定，Stance 可动态 ---------- */

function _roleOfSelf(me) {
	try {
		if (!me) return null;
		if (me === game.zhu) return 'zhu';
		return _normalizeRole(me.identity);
	} catch (e) { return null; }
}

export function isLikelyEnemy(me, other) {
	try {
		if (!me || !other || me === other || currentMode() !== 'identity') return false;
		const myId = _roleOfSelf(me);
		if (!myId || myId === 'nei') return false;

		const hard = hardIdentityOf(me, other);
		if (hard.role) return identityCampRelation(myId, hard.role) < 0;
		if (myId === 'zhu' || myId === 'zhong') {
			if (hard.role === 'fan') return true;
		} else if (myId === 'fan') {
			if (hard.role === 'zhu' || hard.role === 'zhong') return true;
		}

		const b = beliefOfFor(me, other);
		if (!b) return false;
		if (myId === 'zhu' || myId === 'zhong') {
			const p = b.fan || 0;
			return p >= SOFT_IDENTITY_MIN && p - Math.max(b.zhong || 0, b.nei || 0) >= SOFT_IDENTITY_MARGIN;
		}
		if (myId === 'fan') {
			const p = b.zhong || 0;
			return p >= SOFT_IDENTITY_MIN && p - Math.max(b.fan || 0, b.nei || 0) >= SOFT_IDENTITY_MARGIN;
		}
		return false;
	} catch (e) { return false; }
}

export function isLikelyAlly(me, other) {
	try {
		if (!me || !other || me === other || currentMode() !== 'identity') return false;
		const myId = _roleOfSelf(me);
		if (!myId || myId === 'nei') return false;

		const b = beliefOfFor(me, other);
		if (!b) return false;
		/* “敌方身份已排除”只代表不该打，不等于可以当确定队友喂资源。
		 * 忠/内 50:50 这类剩余槽位保持 neutral；只有 hard fact 或明显 posterior 优势才视为 ally。 */
		const hard = hardIdentityOf(me, other);
		if (hard.role) return identityCampRelation(myId, hard.role) > 0;
		if (myId === 'zhu' || myId === 'zhong') {
			if (hard.role === 'zhong') return true;
			return (b.zhong || 0) >= 0.65 && (b.zhong || 0) - (b.nei || 0) >= 0.20 && (b.fan || 0) < 0.25;
		}
		if (myId === 'fan') {
			if (hard.role === 'fan') return true;
			return (b.fan || 0) >= 0.65 && (b.fan || 0) - Math.max(b.zhong || 0, b.nei || 0) >= 0.20;
		}
		return false;
	} catch (e) { return false; }
}

/* ---------- 共享信念加权 ----------
 * 使用 observer-specific posterior；角色身份和动态 stance 分离。
 */
export function identityBiasOf(me, tgt, weight) {
	try {
		if (!me || !tgt || tgt === me || currentMode() !== 'identity') return 0;
		const myId = _roleOfSelf(me);
		if (!myId || myId === 'nei') return 0;
		const b = beliefOfFor(me, tgt);
		if (!b) return 0;

		let enemyP = 0, allyP = 0;
		if (myId === 'zhu' || myId === 'zhong') {
			enemyP = b.fan || 0;
			allyP = b.zhong || 0;
		} else if (myId === 'fan') {
			const hard = hardIdentityOf(me, tgt);
			enemyP = (hard.role === 'zhu' ? 1 : 0) + (b.zhong || 0);
			enemyP = Math.min(1, enemyP);
			allyP = b.fan || 0;
		}
		const delta = enemyP - allyP;
		if (Math.abs(delta) < 0.15) return 0;
		return weight * delta;
	} catch (e) { return 0; }
}

/* ---------- 生命周期 ---------- */
export function resetBelief() {
    resetIdentityFacts();
    resetIdentityEvidence(identityFactsState(null).sessionId);
    IDENTITY_VIEWS.clear();
	for (const k in BELIEF) delete BELIEF[k];
	_beliefRound = -1;
	_beliefEvidenceRevision = -1;
	_beliefPublicKey = '';
	_beliefUpdating = false;
}

export function explainIdentity(p, observer) {
	try {
		const b = beliefOfFor(observer || null, p);
		const hard = hardIdentityOf(observer || null, p);
		return {
			key: keyOf(p),
			publicIdentity: _publicRoleOf(p),
			hardIdentity: hard.role,
			hardSource: hard.source,
			inferred: identityOfFor(observer || null, p),
			confidence: confidenceOfFor(observer || null, p),
			belief: _roundBelief(b),
			roleInventory: roleInventory(),
			remainingSlots: remainingRoleSlots(observer || null),
			observedHostility: p ? Math.round(hostilityOf(p) * 100) / 100 : 0,
			observedFriendliness: p ? Math.round(friendlinessOf(p) * 100) / 100 : 0,
		};
	} catch (e) { return { err: String(e) }; }
}
