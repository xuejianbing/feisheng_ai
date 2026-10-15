/*
 * ============================================
 * // 作者：飛昇原創
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 决策后检测 =================
 * 决策执行后，对比执行前后的快照，计算实际收益：
 *   ① 目标变化：掉血 / 掉牌 / 装备被拆
 *   ② 自身变化：掉血 / 掉牌
 *   ③ 局势变化：场上存活数 / 敌我比例
 *   ④ 反制检测：被无懈 / 被闪 / 被反馈
// Autore: Feisheng Originale | Licenza: GPL-3.0
 * 把实际收益写进样本的 reward 字段（替代整局分数）
 */
import { log } from '../../foundation/diag/logger.js?v=41a';
import { isSameCamp } from '../strategy/modeStrategy.js?v=41a';   /* ★ 架构阵营判定：同阵营判定 */
import { dispositionOf } from '../relations/relations.js?v=41a';
import { VAL_CARD } from '../../knowledge/tables/value-tables.js?v=41a';      /* ★ 装备按真实价值加权（替代按件数） */

/* ★ 结算后检测的关系感知（用于实际收益正负判定）。
 * 优先用上层 targetIsEnemy；缺省统一走 relations.dispositionOf，避免身份模式态度透视。 */
function _resolveIsEnemy(me, target, hint) {
	try {
		if (typeof hint === 'boolean') return hint;
		if (!me || !target || target === me) return false;
		return dispositionOf(me, target) < 0;
	} catch (e) { return false; }
}

/* ★ 阵营判定（容错包装）：返回 1=我方 / -1=敌方 / 0=无法判定 */
function _campOf(me, p) {
	try {
		if (!me || !p || p === me) return 1;
		return isSameCamp(me, p) ? 1 : -1;
	} catch (e) { return 0; }
}

/* ★ 单人生存资产的装备价值（按卡真实价值，缺省给 1），替代"按件数" */
function _equipValue(p) {
	let v = 0;
	const eqs = p && p.getCards ? p.getCards('e') : [];
	for (let i = 0; i < eqs.length; i++) {
		const cid = eqs[i] && (eqs[i].id || eqs[i].name);
		v += (VAL_CARD && cid && VAL_CARD[cid] && VAL_CARD[cid].use) || 1;
	}
	return v;
}

/* ★ 聚合某方阵营的总资产快照（血量/手牌/装备价值/判定区/存活） */
function _campAssets(me, players, camp) {
	const agg = { hp: 0, hand: 0, equip: 0, judging: 0, alive: 0, count: 0 };
	(players || []).forEach(function (p) {
		if (!p) return;
		if (_campOf(me, p) !== camp) return;   /* 只聚合指定阵营（含"无法判定"则跳过） */
		if (p.alive === false) return;
		agg.hp += (p.hp || 0);
		agg.hand += p.countCards ? p.countCards('h') : 0;
		agg.equip += _equipValue(p);
		agg.judging += (p.getCards ? p.getCards('j') : []).length;   /* ★ 判定区延时锦囊（乐/兵/闪电）是持有者的隐性负资产 */
		agg.alive += 1;
		agg.count += 1;
	});
	return agg;
}

/* ================= 快照池 ================= */
const SNAPSHOT_POOL = new Map();   /* key -> snapshot */
const MAX_POOL = 50;
let _poolRound = -1;

/* ★ 统计计数器（跨局累计） */
let _totalChecks = 0;      /* 总检测次数（累积计数） */
let _totalReward = 0;      /* 总收益 */
let _positiveCount = 0;    /* 正收益次数 */
let _negativeCount = 0;    /* 负收益次数 */

/* ★ 异步队列状态（面板显示用） */
let _queuedTasks = 0;      /* 当前排队/处理中的任务数 */
let _callbacksDone = 0;    /* 已回调完成的任务数 */
let _drained = 0;          /* 已结算的任务数 */

function _syncPool() {
    try {
        const r = (_status && _status.roundNumber) || (game && game.roundNumber) || 0;
        if (r !== _poolRound) {
            SNAPSHOT_POOL.clear();
            _poolRound = r;
        }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= 拍快照 ================= */
function _snapshot(me, target) {
    try {
        const snap = {
            ts: Date.now(),
            round: (_status && _status.roundNumber) || 0,
            /* 自身状态 */
            meHp: me.hp || 0,
            meMaxHp: me.maxHp || 1,
            meHand: me.countCards ? me.countCards('h') : 0,
            meEquip: me.getCards ? me.getCards('e').length : 0,
            /* 目标状态 */
            tHp: target ? (target.hp || 0) : 0,
            tMaxHp: target ? (target.maxHp || 1) : 1,
            tHand: target && target.countCards ? target.countCards('h') : 0,
            tEquip: target && target.getCards ? target.getCards('e').length : 0,
            /* 场上局势 */
            alive: (game.players || []).filter(p => p && p.alive !== false).length,
        };
        /* ★ 阵营聚合资产（敌我双方整体收益用） */
        try {
            const all = game.players || [];
            snap.campF = _campAssets(me, all, 1);   /* 我方阵营 */
            snap.campE = _campAssets(me, all, -1);  /* 敌方阵营 */
        } catch (eCamp) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCamp); }
        return snap;
    } catch (e) { return null; }
}

/* ================= 决策前记录快照 ================= */
export function postCheckBefore(me, action, target, isEnemyHint) {
    try {
        _syncPool();
        if (!me || !action) return;

        const key = 'pc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const snap = _snapshot(me, target);

        SNAPSHOT_POOL.set(key, {
            before: snap,
            me: me.name || me.name1,
            target: target ? (target.name || target.name1) : null,
            action: action.id || '',
            type: action.type || '',
            isEnemy: _resolveIsEnemy(me, target, isEnemyHint),
            timing: action.timing || action._stage || '',   /* ★ 技能时机阶段 */
            player: (me && (me.name || me.name1)) || '',    /* ★ 当前玩家（用于回写冠军嵌入） */
            ts: Date.now(),
        });

        /* 池满清理 */
        if (SNAPSHOT_POOL.size > MAX_POOL) {
            const firstKey = SNAPSHOT_POOL.keys().next().value;
            SNAPSHOT_POOL.delete(firstKey);
        }

        return key;
    } catch (e) { return null; }
}

/* ================= 决策后计算实际收益 ================= */
export function postCheckAfter(snapshotKey, me, target) {
    try {
        _syncPool();
        if (!snapshotKey || !SNAPSHOT_POOL.has(snapshotKey)) return 0;

        const rec = SNAPSHOT_POOL.get(snapshotKey);
        const before = rec.before;
        if (!before) return 0;

        /* 拍执行后的快照 */
        const after = _snapshot(me, target);
        if (!after) return 0;

        /* ================= 计算实际收益 ================= */
        let gain = 0;
        const details = {};
        const isEnemy = rec.isEnemy;   /* ★ 阵营感知：决定目标变化的正负 */

        /* ① 目标变化：对敌人=正收益，对盟友/自己=负收益（错给盟友造成损失=大负） */
        if (target) {
            const dmg = before.tHp - after.tHp;
            if (dmg > 0) {
                gain += dmg * 3 * (isEnemy ? 1 : -1);      /* 敌人掉血+3/点；盟友掉血-3/点 */
                details.tHpDown = dmg;
                details.signErr = !isEnemy;
            }
            /* 目标掉牌 → 同理分阵营 */
            const cardLost = before.tHand - after.tHand;
            if (cardLost > 0) {
                gain += cardLost * 1.5 * (isEnemy ? 1 : -1);  /* 敌人掉牌+1.5/张；盟友-1.5/张 */
                details.tHandDown = cardLost;
                details.signErr = details.signErr || !isEnemy;
            }
            /* 目标掉装备 → 同理分阵营 */
            const eqLost = before.tEquip - after.tEquip;
            if (eqLost > 0) {
                gain += eqLost * 2 * (isEnemy ? 1 : -1);
                details.tEquipDown = eqLost;
                details.signErr = details.signErr || !isEnemy;
            }
        }

        /* ② 自身掉血 → 负收益 */
        const selfDmg = before.meHp - after.meHp;
        if (selfDmg > 0) {
            gain -= selfDmg * 2;      /* 每点血 -2 分 */
            details.meHpDown = selfDmg;
        }
        /* 自身掉牌 → 负收益 */
        const selfCardLost = before.meHand - after.meHand;
        if (selfCardLost > 0) {
            gain -= selfCardLost * 1;
            details.meHandDown = selfCardLost;
        }

        /* ③ 目标濒死 → 对敌人=大正，误伤盟友=大负 */
        if (target && after.tHp <= 1 && before.tHp > 1) {
            gain += 5 * (isEnemy ? 1 : -1);
            details.tNearDeath = true;
        }

        /* ④ 目标死亡 → 对敌人=极大正，误杀盟友/自己=极大负 */
        if (target && after.tHp <= 0) {
            gain += (isEnemy ? 20 : -20);
            details.tDead = true;
        }

        /* ⑤ 自己濒死 → 大负收益 */
        if (after.meHp <= 1 && before.meHp > 1) {
            gain -= 8;
            details.meNearDeath = true;
        }

        /* ⑥ 局势变化：敌人存活减少→优势；若是技能造成本方/盟友减少已在 ②④⑤ 覆盖，这里只对敌人加分 */
        if (isEnemy && after.alive < before.alive) {
            gain += (before.alive - after.alive) * 2;
            details.aliveDown = before.alive - after.alive;
        }

        /* ★ ⑦ 敌我双方阵营净收益（架构级：由实际结算判定正负）。
         * 对比结算前后两方阵营总资产，判断这次操作让"我方"变强、"敌方"变弱多少。
         * 我方资产增加 / 敌方资产减少 → 净正收益；反之 → 净负收益。 */
        let campNetGain = 0;
        let campDelta = {};
        try {
            const all = game.players || [];
            const afF = _campAssets(me, all, 1);   /* 结算后我方 */
            const afE = _campAssets(me, all, -1);  /* 结算后敌方 */
            const bfF = before.campF || { hp: 0, hand: 0, equip: 0, judging: 0, alive: 0 };
            const bfE = before.campE || { hp: 0, hand: 0, equip: 0, judging: 0, alive: 0 };
            const dF = {
                hp: afF.hp - bfF.hp, hand: afF.hand - bfF.hand,
                equip: afF.equip - bfF.equip, judging: afF.judging - bfF.judging, alive: afF.alive - bfF.alive,
            };
            const dE = {
                hp: afE.hp - bfE.hp, hand: afE.hand - bfE.hand,
                equip: afE.equip - bfE.equip, judging: afE.judging - bfE.judging, alive: afE.alive - bfE.alive,
            };
            /* 我方阵营变化 +，敌方阵营变化减（反向），净=两者合计。
             * ★ 判定区(judging)为隐性负资产：我方判定区增多减益、敌方判定区增多对我方有益，故双方均取 -2。 */
            campNetGain = (dF.hp * 3 + dF.hand * 1.5 + dF.equip * 1.2 + dF.alive * 3 + dF.judging * -2)
                        - (dE.hp * 3 + dE.hand * 1.5 + dE.equip * 1.2 + dE.alive * 3 + dE.judging * -2);
            campDelta = { dF: dF, dE: dE, net: campNetGain };
            /* 并入总收益，但仅当有实际阵营变化时 */
            if (Math.abs(campNetGain) > 0.01) gain += campNetGain * 0.5;
            details.campNet = Math.round(campNetGain * 100) / 100;
        } catch (eCamp2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCamp2); }

        /* 从池里删掉（已用完） */
        SNAPSHOT_POOL.delete(snapshotKey);

        /* ★ 更新统计计数器 */
        _totalChecks++;
        _totalReward += gain;
        if (gain > 0) _positiveCount++;
        else if (gain < 0) _negativeCount++;

        /* ★ 静默：不输出到日志面板 */
        // try {
        //     log.info('postCheck', '决策后检测: ' + rec.action +
        //         ' → 实际收益 ' + details.gain +
        //         '（' + JSON.stringify(details).slice(0, 80) + '）');
        // } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

        /* ★ 结算结果对象：gain=实际收益(正负已按阵营判定)，sign=净盈亏，含决策点与时机制品 */
        const result = {
            gain: gain,
            sign: gain > 0 ? 1 : (gain < 0 ? -1 : 0),   /* 正收益=+1 / 负收益=-1 / 无变化=0 */
            details: details,
            campNet: campNetGain,      /* ★ 敌我双方阵营净收益（正=我方占优，负=敌方占优）*/
            camp: campDelta,           /* ★ 我方/敌方资产变化明细 */
            friendlyGain: campDelta.dF ? (campDelta.dF.hp * 3 + campDelta.dF.hand * 1.5 + campDelta.dF.equip * 2) : 0,
            enemyGain: campDelta.dE ? (campDelta.dE.hp * 3 + campDelta.dE.hand * 1.5 + campDelta.dE.equip * 2) : 0,
            type: rec.type || '',
            id: rec.action || '',
            timing: rec.timing || '',
            isEnemy: !!isEnemy,
            player: rec.me || '',
        };

        return result;
    } catch (e) { return { gain: 0, sign: 0, details: {}, campNet: 0, camp: {}, friendlyGain: 0, enemyGain: 0, type: '', id: '', timing: '', isEnemy: false, player: '' }; }
}

/* ================= 异步结算检测（轮询式 + 串行队列） =================
 * 取代固定 setTimeout(1500) 的旧逻辑：
 *  - 每个决策候选都入队，串行处理，防海量任务同时 setTimeout 堆叠。
 *  - 每条任务用轮询采样 after 快照（每 300ms 一次），直到状态稳定 2 次
 *    或达到总超时上限，再判定实际收益。由真实结算效果驱动，而非卡死单一延时。 */

const POLL_INTERVAL = 300;   /* 采样间隔 ms */
const POLL_MAX = 12;         /* 最多采样次数 ≈ 3.6s，结算必完成 */
const SETTLE_STABLE = 2;     /* 连续 N 次采样状态不再变化 → 判定稳定 */

let _taskQueue = Promise.resolve();   /* 串行链 */

export function postCheckDelayed(snapshotKey, me, target, callback) {
    try {
        if (!snapshotKey || !SNAPSHOT_POOL.has(snapshotKey)) return;
        /* ★ 入队串行执行，避免阻塞主决策 */
        _queuedTasks++;                    /* ★ 统计：排队中任务 +1 */
        _taskQueue = _taskQueue.then(function () {
            return _pollSettle(snapshotKey, me, target);
        }).then(function (result) {
            _queuedTasks = Math.max(0, _queuedTasks - 1);   /* ★ 任务处理完 */
            _drained++;                                     /* ★ 已结算 +1 */
            if (callback) { try { callback(result); _callbacksDone++; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }
        }).catch(function () { _queuedTasks = Math.max(0, _queuedTasks - 1); });
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 异步轮询：隔 POLL_INTERVAL 采样 after，直到状态稳定或超时，再调用 postCheckAfter */
function _pollSettle(snapshotKey, me, target) {
    return new Promise(function (resolve) {
        (function poll(prevChanged, stable, iters) {
            iters = (iters || 0) + 1;
            try {
                /* ★ 超时上限保护：结算链路太长也强制判定，避免死循环 */
                if (iters > POLL_MAX) return resolve(postCheckAfter(snapshotKey, me, target));
                if (!SNAPSHOT_POOL.has(snapshotKey)) return resolve(postCheckAfter(snapshotKey, me, target));
                const chk = SNAPSHOT_POOL.get(snapshotKey);
                const after = _snapshot(me, target);
                const snap = chk.before || {};
                /* 本轮是否有状态变化（相对 before 快照） */
                const changed = after && (
                    (after.tHp !== snap.tHp) || (after.tHand !== snap.tHand) ||
                    (after.tEquip !== snap.tEquip) || (after.meHp !== snap.meHp) ||
                    (after.meHand !== snap.meHand) || (after.alive !== snap.alive)
                );
                if (!changed) {              /* 已恢复到初始状态 → 结算完成 */
                    return resolve(postCheckAfter(snapshotKey, me, target));
                }
                stable = (changed === prevChanged) ? (stable + 1) : 0;
                if (stable >= SETTLE_STABLE) {   /* 连续稳定 2 次 → 判定 */
                    return setTimeout(function () { resolve(postCheckAfter(snapshotKey, me, target)); }, POLL_INTERVAL);
                }
                /* 继续采样 */
                setTimeout(function () { poll(changed, stable, iters); }, POLL_INTERVAL);
            } catch (e) { resolve(postCheckAfter(snapshotKey, me, target)); }
        })(false, 0, 0);
    });
}

/* ★ 批量入队：对一批候选动作 (me, action, target) 逐个建立并异步结算。
 * 返回 Promise，全部结算完成并回写后 resolve 结果数组。 */
export async function postCheckBatch(entries, onResult) {
    const results = [];
    for (const e of entries || []) {
        if (!e || !e.action) continue;
        const key = postCheckBefore(e.me, e.action, e.target, e.isEnemy);
        if (key) {
            await postCheckDelayed(key, e.me, e.target, function (r) {
                results.push(r);
                if (onResult) try { onResult(r, e); } catch (err) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(err); }
            });
        }
    }
    return results;
}

/* ================= 查询接口 ================= */
export function postCheckStats() {
    return {
        /* 池状态 */
        poolSize: SNAPSHOT_POOL.size,
        round: _poolRound,
        /* ★ 异步队列状态（面板显示"后检测队列"） */
        queued: _queuedTasks,          /* 排队/处理中任务数 */
        drained: _drained,             /* 已结算任务数 */
        callbacksDone: _callbacksDone, /* 已回调完成数 */
        /* ★ 统计数据（面板显示用） */
        totalChecks: _totalChecks,
        avgReward: _totalChecks > 0 ? Math.round((_totalReward / _totalChecks) * 10) / 10 : 0,
        positiveCount: _positiveCount,
        negativeCount: _negativeCount,
    };
}

export function postCheckReset() {
    /* ★ 局结束清理：清空快照池，避免残留跨局数据 */
    SNAPSHOT_POOL.clear();
    _poolRound = -1;
    /* ★ 清理异步队列计数（防止跨局累加失真） */
    _queuedTasks = 0;
    _drained = 0;
    _callbacksDone = 0;
    /* 保留跨局累计统计（totalChecks/avgReward 等用于长期观察），清临时计数 */
    /* ★ 静默：不输出到日志面板 */
    // log.info('postCheck', '决策后检测池已复位');
}

/* ================= 挂载 ================= */
if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.postCheck = {
        before: postCheckBefore,
        after: postCheckAfter,
        delayed: postCheckDelayed,
        batch: postCheckBatch,
        stats: postCheckStats,
        reset: postCheckReset,
    };
}
