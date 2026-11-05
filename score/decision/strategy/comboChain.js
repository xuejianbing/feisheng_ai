/*
 * ============================================
 * // Éditeur: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 连招链 =================
 * 识别手牌里的预定义连招，并给出执行优先级
 * 核心连招：
 *   ① 铁索 + 属性伤害（火攻/火杀/雷杀）
 *   ② 拆防具 + 连杀（先拆藤甲/仁王，再穿透）
 *   ③ 酒 + 杀 + 追击（酒杀打残血）
 *   ④ AOE + 顺闪（先 AOE 消耗防御，再顺关键牌）
 *   ⑤ 连弩 + 多杀（攒杀一波爆发）
 *   ⑥ 无中 + 顺拆（补牌后拆关键）
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js';
import { isPlayerLinked } from '../state/playerState.js';   /* ★ 指令 05 Stage A：唯一横置读取入口 */
import { isEnemyOf } from '../relations/relations.js';   /* ★ 指令 05 Stage B：敌我唯一权威源 */
import { cfg } from '../../foundation/config/util.js';
import { log } from '../../foundation/diag/logger.js';
import { getJSON, setJSONQuotaSafe } from '../../foundation/storage/storage.js';

/* ================= 连招学习（动态扩展）+ 持久化 =================
 * 连招不再是一成不变的静态表：
 *  - LEARNED：对局中提炼出的"有效连招"，本局内存级别生效；
 *  - mem：跨局持久化的学习连招（成功率+权重），上限由 CHAIN_MEM_MAX 控制。
 * 学习素材来源：对局中成功出牌序列 / 我方高分动作的手牌组合。 */
const MEM_KEY = 'djsc_learned_chains_v1';
const CHAIN_MEM_MAX = 40;         /* 持久化学习连招条数上限 */
let LEARNED = [];                 /* 本局动态连招（也是 mem 的活跃镜像） */
let learnedLoaded = false;
/* ★ 本局高分策略登记：对局中命中且带动评分(>1)的连招 id → 出现次数。
 * 对局结束由 finalizeLearned(won) 按胜负固化进连招学习库（入库 = 可复用 + 全维度导出）。 */
const SESSION = new Map();        /* id -> hit 次数 */

function loadLearned() {
	if (learnedLoaded) return;
	learnedLoaded = true;
	try {
		const arr = getJSON(MEM_KEY, []);
		if (Array.isArray(arr)) LEARNED = arr;
	} catch (e) { LEARNED = []; }
}
function persistLearned() {
	try {
		const kept = LEARNED.slice(-CHAIN_MEM_MAX);
		setJSONQuotaSafe(MEM_KEY, kept, function (v) { return Array.isArray(v) ? v.slice(-20) : v; });
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 学习：记录一次被使用的连招，按胜负回报微调权重 */
export function learnChainUse(chainId, winning) {
	try {
		loadLearned();
		let rec = LEARNED.find(function (c) { return c.id === chainId; });
		if (!rec) {
			const base = CHAINS.find(function (c) { return c.id === chainId; });
			rec = {
				id: chainId,
				name: base ? base.name : chainId,
				setup: base ? base.setup.slice() : [],
				follow: base ? base.follow.slice() : [],
				learned: true, times: 0, wins: 0,
				bonus: base ? base.bonus : 1.0,
			};
			LEARNED.push(rec);
		}
		rec.times++;
		/* 学习到的连招有机会被真正打进牌局 → 覆盖权重，同时保留牌型组合 */
		if (rec.setup && rec.setup.length === 0 && rec.follow && rec.follow.length === 0) {
			const base = CHAINS.find(function (c) { return c.id === chainId; });
			if (base) { rec.setup = base.setup.slice(); rec.follow = base.follow.slice(); }
		}
		if (winning) rec.wins++;
		/* 成功率学习权重：成绩越好权重越贴近其真实价值 */
		rec.bonus = Math.round((rec.bonus + (winning ? 0.15 : -0.1)) * 100) / 100;
		if (rec.bonus < 0.5) rec.bonus = 0.5;
		if (rec.bonus > 6) rec.bonus = 6;
		persistLearned();
		return rec;
	} catch (e) { return null; }
}

/* 对局开始时加载学习连招（重置每局临时数据权重，保留跨局累计） */
export function resetComboChain() {
	log.info('comboChain', '连招链缓存已复位');
	try {
		loadLearned();
		LEARNED.forEach(function (r) { if (r.learned) { r.times = 0; r.wins = 0; } });
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { SESSION.clear(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 查询学习到的连招（面板展示用） */
export function learnedChains() {
	loadLearned();
	return LEARNED.filter(function (r) { return r.learned; }).map(function (r) { return { id: r.id, name: r.name, bonus: r.bonus, times: r.times, wins: r.wins }; });
}

/* 手动抹除全部学习连招 */
export function clearLearnedChains() {
	LEARNED = [];
	try { setJSONQuotaSafe(MEM_KEY, []); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return LEARNED.length;
}

/* ★ 对局结束固化：把本局被评估为高分(带动评分)命中过的连招，按胜负固化进连招学习库。
 * 新 id → 新增 learned 条目；已有 id → learnChainUse 更新权重/胜率。返回统计。 */
export function finalizeLearned(won) {
	try {
		loadLearned();
		let done = 0, fresh = 0;
		SESSION.forEach(function (hit, id) {
			const base = CHAINS.find(function (c) { return c.id === id; });
			const exists = LEARNED.find(function (c) { return c.id === id; });
			if (!base && !exists) return;          /* 无法定位牌型则跳过（learned 需可识别牌型） */
			const isNew = !exists;
			const rec = learnChainUse(id, won);
			if (rec) { done++; if (isNew) fresh++; }
		});
		const total = SESSION.size;
		SESSION.clear();
		if (total) log.info('comboChain', '本局高分连招固化入库 ' + done + ' 条（新增 ' + fresh + '，胜负=' + won + '）');
		return { done: done, fresh: fresh, total: total };
	} catch (e) { return { err: String(e) }; }
}

/* ★ 全维度导出连招库：内置 + 学习，含牌型/权重/命中/胜率等完整维度。
 * 供「导出AI学习数据」附带导出、跨机回流。 */
export function exportAllChains() {
	try {
		loadLearned();
		const builtin = CHAINS.map(function (c) {
			return { id: c.id, name: c.name, setup: (c.setup||[]).slice(), follow: (c.follow||[]).slice(), bonus: c.bonus, learned: false, times: 0, wins: 0, winRate: 0, source: 'builtin' };
		});
		const learned = LEARNED.filter(function (r) { return r.learned; }).map(function (r) {
			const rate = r.times > 0 ? Math.round((r.wins / r.times) * 10000) / 100 : 0;
			return { id: r.id, name: r.name, setup: (r.setup||[]).slice(), follow: (r.follow||[]).slice(), bonus: r.bonus, learned: true, times: r.times, wins: r.wins, winRate: rate, minBonus: 0.5, maxBonus: 6, source: 'learned' };
		});
		return { version: 'v1', exportedAt: Date.now(), count: builtin.length + learned.length, chains: builtin.concat(learned), builtin: builtin, learned: learned };
	} catch (e) { return { err: String(e) }; }
}

/* ★ 回流导入连招库：把别人导出的 chains 并入本机学习库（内置 id 不改；无牌型跳弃） */
export function importChains(arr) {
	try {
		if (!Array.isArray(arr)) return { ok: false, err: '格式错误：需数组', added: 0 };
		loadLearned();
		let added = 0;
		arr.forEach(function (c) {
			if (!c || !c.id) return;
			if (CHAINS.find(function (x) { return x.id === c.id; })) return;  /* 内置不覆盖 */
			const setup = Array.isArray(c.setup) ? c.setup.slice() : [];
			const follow = Array.isArray(c.follow) ? c.follow.slice() : [];
			if (!setup.length && !follow.length) return;
			let rec = LEARNED.find(function (x) { return x.id === c.id; });
			if (!rec) {
				rec = { id: c.id, name: c.name || c.id, setup: setup, follow: follow, learned: true, times: c.times || 0, wins: c.wins || 0, bonus: (typeof c.bonus === 'number' ? c.bonus : 1.0) };
				LEARNED.push(rec);
			} else {
				if (setup.length) rec.setup = setup;
				if (follow.length) rec.follow = follow;
				if (typeof c.bonus === 'number') rec.bonus = c.bonus;
				if (c.times) rec.times = c.times;
				if (c.wins) rec.wins = c.wins;
			}
			added++;
		});
		persistLearned();
		return { ok: true, added: added };
	} catch (e) { return { ok: false, err: String(e), added: 0 }; }
}

/* ================= 连招定义表 ================= */
/* 每条：{ id, name, setup[], follow[], condition(), bonus } */
export const CHAINS = [
    {
        id: 'tiesuo_fire',
        name: '铁索+火攻',
        setup: ['tiesuo'],
        follow: ['huogong', 'huosha', 'leisha'],
        condition: function (me, enemy) {
            /* 目标已被横置 或 场上至少有 2 个可被横置的敌人 */
            try {
                if (enemy && isPlayerLinked(enemy)) return true;
                let count = 0;
                for (const p of (game.players || [])) {
                    if (!p || p === me || p.alive === false) continue;
                    if (isEnemyOf(me, p)) count++;
                }
                return count >= 2;
            } catch (e) { return false; }
        },
        bonus: 3.5,
    },
    {
        id: 'strip_sha',
        name: '拆防具+连杀',
        setup: ['guohe', 'shunshou'],
        follow: ['sha', 'huosha', 'leisha'],
        condition: function (me, enemy) {
            try {
                if (!enemy) return false;
                const equips = enemy.getCards ? enemy.getCards('e') : [];
                return equips.some(function (e) {
                    const n = get.name(e);
                    return n === 'tengjia' || n === 'renwang' || n === 'bagua';
                });
            } catch (e) { return false; }
        },
        bonus: 2.5,
    },
    {
        id: 'jiu_sha',
        name: '酒+杀斩杀',
        setup: ['jiu'],
        follow: ['sha'],
        condition: function (me, enemy) {
            try {
                if (!enemy) return false;
                return (enemy.hp || 0) <= 2;
            } catch (e) { return false; }
        },
        bonus: 4.0,
    },
    {
        id: 'aoe_strip',
        name: 'AOE+顺关键',
        setup: ['nanman', 'wanjian'],
        follow: ['shunshou', 'guohe'],
        condition: function (me, enemy) {
            try {
                if (!enemy) return false;
                /* 敌人手牌 >= 2 才有可顺价值 */
                return (enemy.countCards ? enemy.countCards('h') : 0) >= 2;
            } catch (e) { return false; }
        },
        bonus: 1.8,
    },
    {
        id: 'zhuge_burst',
        name: '连弩+多杀',
        setup: [],
        follow: ['sha'],
        condition: function (me, enemy) {
            try {
                if (!me.getEquip || !me.getEquip('zhuge')) return false;
                const sha = me.countCards ? me.countCards('hs', 'sha') : 0;
                return sha >= 2;
            } catch (e) { return false; }
        },
        bonus: 3.0,
    },
    {
        id: 'wuzhong_strip',
        name: '无中+顺拆',
        setup: ['wuzhong'],
        follow: ['shunshou', 'guohe'],
        condition: function (me, enemy) {
            try {
                return (me.countCards ? me.countCards('h') : 0) <= 2;
            } catch (e) { return false; }
        },
        bonus: 1.5,
    },
    /* ===== 内置强化连招（推演自经典博弈策略） ===== */
    {
        id: 'huogong_yaoshi',
        name: '火攻+消耗关键手牌',
        setup: ['huogong'],
        follow: ['shunshou', 'guohe', 'jie'],
        condition: function (me, enemy) {
            try {
                /* 敌方手牌多或血厚时，火攻先逼牌再顺/拆 */
                if (!enemy) return false;
                return (enemy.countCards ? enemy.countCards('h') : 0) >= 3 || (enemy.hp || 0) >= 3;
            } catch (e) { return false; }
        },
        bonus: 2.0,
    },
    {
        id: 'shun_jie_liantiao',
        name: '顺/借/乐连环',
        setup: ['shunshou', 'jie'],
        follow: ['le'],   /* 先带走防御牌，再用乐压制 */
        condition: function (me, enemy) {
            try {
                if (!enemy || enemy.hp === 0) return false;
                /* 敌方装备区/判定区有牌可顺，且回合结束前用乐收益高 */
                const e = enemy.getCards ? enemy.getCards('e').length : 0;
                const j = enemy.getCards ? enemy.getCards('j').length : 0;
                return e > 0 || j > 0;
            } catch (e) { return false; }
        },
        bonus: 2.2,
    },
    {
        id: 'tao_lengjia',
        name: '借刀+杀联动',
        setup: ['jiedao'],
        follow: ['sha'],
        condition: function (me, enemy) {
            try {
                if (!enemy) return false;
                /* 敌我都有武器区 → 借刀杀敌收益最大 */
                const meWeap = me.getCards ? me.getCards('e').some(function (c) { return get.position(c) === 'e'; }) : false;
                return meWeap;
            } catch (e) { return false; }
        },
        bonus: 1.9,
    },
    {
        id: 'jue_lengtai',
        name: '决斗+杀诱因',
        setup: ['juedou'],
        follow: ['sha'],
        condition: function (me, enemy) {
            try {
                if (!enemy) return false;
                /* 敌方杀多 → 先决斗消耗，后期残血再补刀 */
                return (enemy.countCards ? enemy.countCards('h') : 0) >= 3;
            } catch (e) { return false; }
        },
        bonus: 1.8,
    },
    {
        id: 'binhua_lianji',
        name: '冰冻/寒冰连锁',
        setup: ['bingliang', 'le'],
        follow: ['le'],
        condition: function (me, enemy) {
            try {
                if (!enemy) return false;
                /* 用冰冻/乐控住敌方后，下回合可放心输出 */
                return (enemy.hp || 0) <= 2;
            } catch (e) { return false; }
        },
        bonus: 2.3,
    },
    {
        id: 'wuzhong_chop',
        name: '无中起手爆发',
        setup: ['wuzhong'],
        follow: ['sha', 'huosha', 'leisha'],
        condition: function (me, enemy) {
            try {
                /* 无中拉牌差后，尽快建立进攻火力 */
                return true;
            } catch (e) { return false; }
        },
        bonus: 1.3,
    },
    {
        id: 'sha_lengjia_zhi',
        name: '杀+闪逼防',
        setup: ['feijun', 'sha'],
        follow: ['sha'],
        condition: function (me, enemy) {
            try {
                if (!enemy) return false;
                return (enemy.hp || 0) <= 2;
            } catch (e) { return false; }
        },
        bonus: 1.7,
    },
    {
        id: 'yueying_jiliao',
        name: '月英集智消耗',
        setup: ['wuzhong', 'shunshou', 'guohe'],
        follow: ['huogong', 'wugu'],
        condition: function (me, enemy) {
            try {
                return (me.countCards ? me.countCards('h') : 0) >= 3;
            } catch (e) { return false; }
        },
        bonus: 1.6,
    },
];

/* ================= 主函数：识别可用连招 ================= */
export function detectChains(me, enemy) {
    try {
        if (!me) return [];
        const hand = me.getCards ? me.getCards('h') : [];
        const handNames = {};
        hand.forEach(function (c) {
            const n = get.name(c, me);
            handNames[n] = (handNames[n] || 0) + 1;
        });

        const available = [];
        /* ★ 合并内置连招 + 学习连招（学习连招在"同名"时会覆盖 bonus，但保留其 setup/follow 同字段） */
        const pool = CHAINS.slice();
        try {
            loadLearned();
            LEARNED.forEach(function (r) {
                if (!r.id) return;
                const ex = pool.find(function (c) { return c.id === r.id; });
                if (ex) ex.bonus = r.bonus;   /* 学习到权重则覆盖 */
                else pool.push({ id: r.id, name: r.name, setup: [], follow: [], condition: function(){return true;}, bonus: r.bonus });
            });
        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        pool.forEach(function (chain) {
            /* setup 全都在手里（除了 zhuge_burst 需要装备） */
            const hasSetup = chain.setup.every(function (id) {
                return (handNames[id] || 0) > 0;
            });
            const hasFollow = chain.follow.some(function (id) {
                return (handNames[id] || 0) > 0;
            });
            if (!hasSetup && chain.setup.length > 0) return;
            if (!hasFollow) return;
            /* 条件判断 */
            let condOk = true;
            try { condOk = chain.condition(me, enemy); } catch (e) { condOk = false; }
            if (!condOk) return;

            /* 计算具体可用性 */
            available.push({
                id: chain.id,
                name: chain.name,
                setup: chain.setup.slice(),
                follow: chain.follow.slice(),
                bonus: chain.bonus,
                availableSetup: chain.setup.filter(function (id) { return (handNames[id] || 0) > 0; }),
                availableFollow: chain.follow.filter(function (id) { return (handNames[id] || 0) > 0; }),
            });
        });
        return available;
    } catch (e) { return []; }
}

/* ================= 连招总收益 ================= */
export function chainScore(me, chain, enemy) {
    try {
        if (!chain) return 0;
        let score = chain.bonus;
        /* 目标残血 → 连招更值 */
        if (enemy) {
            const hp = enemy.hp || 0;
            if (hp <= 1) score *= 1.8;
            else if (hp <= 2) score *= 1.4;
        }
        /* 我方资源充足 → 可以放心打连招 */
        try {
            const hc = me.countCards ? me.countCards('h') : 0;
            if (hc >= 5) score *= 1.15;
            else if (hc <= 2) score *= 0.8;
        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        return Math.round(score * 100) / 100;
    } catch (e) { return 0; }
}

/* ================= 起手牌优先级 ================= */
export function chainPriority(chain) {
    try {
        if (!chain) return 0;
        /* setup 越少越优先（更容易启动） */
        const setupCost = chain.setup.length;
        /* follow 越多越灵活 */
        const followFlex = chain.follow.length;
        return chain.bonus - setupCost * 0.5 + followFlex * 0.2;
    } catch (e) { return 0; }
}

/* ================= 应用层：把连招接入评分 ================= */
export function comboChainBonus(me, action, bestT) {
    try {
        if (cfg('comboChain', true) === false) return 1.0;
        if (!me || !action || !action.id) return 1.0;

        const chains = detectChains(me, bestT);
        if (!chains.length) return 1.0;

        let bonus = 1.0;
        chains.forEach(function (chain) {
            /* 命中评测 → 登记进本局高分策略会话（对局结束按胜负固化入库） */
            const hitSetup = chain.setup.indexOf(action.id) >= 0;
            const hitFollow = chain.follow.indexOf(action.id) >= 0;
            if (hitSetup || hitFollow) {
                try { SESSION.set(chain.id, (SESSION.get(chain.id) || 0) + 1); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
            }
            /* 是 setup 牌 → 起手加成（更值得先打） */
            if (hitSetup) {
                const pri = chainPriority(chain);
                bonus *= (1 + pri * 0.05);
            }
            /* 是 follow 牌 → 后续加成 */
            if (hitFollow) {
                const cs = chainScore(me, chain, bestT);
                bonus *= (1 + cs * 0.03);
            }
        });
        return Math.round(bonus * 1000) / 1000;
    } catch (e) { return 1.0; }
}

/* ================= 状态查询 ================= */
export function comboChainStats() {
    try {
        const me = _status.currentPhase || game.me;
        const chains = me ? detectChains(me, null) : [];
        
        /* ★ 同时返回所有已知连招列表 */
        const allChains = CHAINS.map(function (c) {
            return { id: c.id, name: c.name, bonus: c.bonus };
        });
        
        return {
            chains: chains.length,
            list: chains.map(function (c) {
                return { id: c.id, name: c.name, bonus: c.bonus, priority: chainPriority(c) };
            }),
            allChains: allChains,  /* ★ 所有已知连招 */
            totalKnown: allChains.length,  /* ★ 已知连招总数 */
            learned: learnedChains(),  /* ★ 学习到的连招（成功率+权重） */
            learnedCount: learnedChains().length,
        };
    } catch (e) { return { chains: 0, list: [], allChains: [], totalKnown: 0, learned: [], learnedCount: 0 }; }
}

