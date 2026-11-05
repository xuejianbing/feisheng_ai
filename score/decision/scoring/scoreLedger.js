/* 职责：守恒台账、货币换算和记分记录。分数/日志只在此持有一份，导出为实时绑定。
 * 保留原重置语义：resetLedgerRound 只换 round/scoreLog；完整重置才清原始分与奖池。 */
import { lib, game, get } from '../../foundation/adapt/host.js';
import { enemiesOf } from '../threat/threat.js';
import { identityOf as _identityOf } from '../../perception/observer/identity.js';
import { nameOf, keyOf } from '../../foundation/config/util.js';
import { log } from '../../foundation/diag/logger.js';
import { fxToMoney, fxSnapshot } from '../../knowledge/exchange/exchange.js';
import { getModeStrategy } from '../strategy/modeStrategy.js';
let round = {};
let _rawRound = {};
let scoreLog = [];
/* ★ 全局守恒台账（总账 ledger）：
 *   保证「Σ玩家货币 + _ledger = 0」恒成立 —— 任何一笔 give 都等价于总账内的
 *   转移：加分 → _ledger 补亏；扣分 → _ledger 存留。系统注入（奖池）与
 *   失败阵营产出经 ledger 平衡，全局货币总量守恒。 */
let _ledger = 0;
let REC = { effects: {}, cards: {}, timings: {}, log: [] };
function rec(kind, key, extra) {
	try {
		if (!REC[kind]) REC[kind] = {};
		REC[kind][key] = (REC[kind][key] || 0) + 1;
		if (REC.log.length < 300) REC.log.push({ kind: kind, key: key, extra: extra || "", ts: Date.now() });
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
/* ================= 守恒引擎 · 奖池与入场费 =================
 * 设计（严格守恒）：
 *   - 入场投入：对局开始所有玩家损失入场费 SEED_FEE 货币 → 进入奖池。
 *   - 系统注入：系统给予总计约 30% 奖池货币（SYSTEM_POOL_RATE），这一部分
 *     由「游戏失败后的阵营产出」补偿，而非凭空造币——保证守恒不变量。
 *   - 守恒不变量：Σ玩家round + _ledger = 0 恒成立（由 give 每笔自动维护）。 */
const SEED_FEE = 1;             /* ← 入场费（每人开局损失，进入奖池） */
const SYSTEM_POOL_RATE = 0.3;   /* ← 系统奖池注入比例 ≈30% */
/* 结算时供审计：记录系统注水承诺（收失败阵营产出匹配） */
let _poolPromise = 0;

/* 开局记账：入场扣款经 give，守恒自动成立；
 * 系统 30% 注水作为「产出承诺」登记，结算由失败阵营匹配。 */
function _initLedger(players) {
	try {
		players = Array.isArray(players) ? players : [];
		_poolPromise = Math.round(players.length * SEED_FEE * SYSTEM_POOL_RATE * 100) / 100;
		/* 入场投入：每人扣一笔进奖池（give 自动把 _ledger 变成 +N·SEED_FEE） */
		players.forEach(function (p) {
			if (!p) return;
			try { give(p, -SEED_FEE, "入场投入（守恒奖池）"); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 守恒对账：Σ玩家round + ledger 应≈0；返回偏差（审计用） */
function _conservationBalance() {
	try {
		let s = _ledger;
		for (const k in round) s += round[k];
		return Math.round(s * 100) / 100;
	} catch (e) { return NaN; }
}

/* 返回胜方玩家列表：优先 game.winner（identity 阵营或 'me'），回退全部存活 */
function _winningSet() {
	try {
		const ps = (game && game.players) || [];
		const w = game && game.winner;
		if (w && w !== 'me') {
			const win = ps.filter(function (p) { return p && p.identity === w; });
			if (win.length) return win;
		}
		if (w === 'me' && game.me) return [game.me];
		return ps.filter(function (p) { return _isAlive(p); });
	} catch (e) { return []; }
}

/* 导出守恒审计（面板/自检用）：玩家总量、ledger、系统注水承诺、守恒偏差 */
function conservationLedger() {
	try {
		let playerSum = 0;
		for (const k in round) playerSum += round[k];
		return {
			playerSum: Math.round(playerSum * 100) / 100,
			ledger: Math.round(_ledger * 100) / 100,
			poolPromise: Math.round(_poolPromise * 100) / 100,
			balance: _conservationBalance(),
			seedFee: SEED_FEE,
			systemRate: SYSTEM_POOL_RATE,
			src: '败方产出补系统30%奖池 · 入场投入守恒',
			fx: fxSnapshot({ phase: _stage() }),   /* ★ 动态汇率快照 */
		};
	} catch (e) { return { balance: NaN }; }
}

function give(char, pts, tag) {
	try {
		if (!char) return;
		const k = keyOf(char);
		/* ★ 货币与积分合并：round 贡献分以「货币」为唯一计量单位。
		 *   toMoney 负责单笔价值有界化（单次巨额→≤29 货币），
		 *   _rawRound 存货币浮点累计，round 直接持货币值（不再套 Int8 分层量化——
		 *   因货币已天然有界，旧 toInt8 的防溢出量化成为冗余，移除使量纲统一）。 */
		const moneyPts = toMoney(pts);
		_rawRound[k] = (_rawRound[k] || 0) + moneyPts;
		round[k] = Math.round(_rawRound[k] * 100) / 100;
		/* ★ 守恒入账：每次 give 同步更新总账 ledger。
		 *   加减分视为总账内的货币转移，Σ玩家round + ledger 恒为 0。 */
		_ledger -= moneyPts;
		scoreLog.push({ char: k, pts: moneyPts, tag: tag, ts: Date.now() });
		if (scoreLog.length > 400) scoreLog.shift();
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 带阵营标注的显示名：名字（反贼阵营/主忠阵营/内奸/主公/未知） */
function displayName(char) {
	try {
		const nm = nameOf(char);
		if (!char) return nm;
		let id = "";
		try { id = _identityOf(char); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		let faction = "未知";
		if (id === "zhu") faction = "主公";
		else if (id === "zhong") faction = "主忠阵营";
		else if (id === "fan") faction = "反贼阵营";
		else if (id === "nei") faction = "内奸";
		return nm + "（" + faction + "）";
	} catch (e) { return nameOf(char); }
}
function givePair(from, to, pts, tag) { give(from, pts, tag); give(to, -pts, tag + "（守恒）"); }
/* ★ 阵营识别 */
function _campOf(player) {
	try {
		const mod = lib.__djsc_modeStrategy;
		if (mod && mod.getModeStrategy) {
			const strategy = mod.getModeStrategy();
			if (strategy && strategy.getCamp) return strategy.getCamp(player);
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* 身份模式兜底也必须遵守公开信息边界；不能因策略模块暂不可用就退回真实 identity。 */
	try {
		const mode = (get && typeof get.mode === 'function') ? get.mode() : '';
		if (mode === 'identity') {
			if (player === game.zhu) return 'loyal';
			if (player && (player.identityShown || player.identity === 'mingzhong')) {
				if (player.identity === 'zhu' || player.identity === 'zhong' || player.identity === 'mingzhong') return 'loyal';
				if (player.identity === 'fan') return 'rebel';
				if (player.identity === 'nei') return 'nei';
			}
			return 'unknown';
		}
	} catch (eMode) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eMode); }
	return (player && player.identity) || 'unknown';
}

/* ★ 个体贡献度：本局累计正分 */
function _contribution(player) {
	try {
		const k = keyOf(player);
		const v = round[k] || 0;
		return Math.max(0, v);
	} catch (e) { return 0; }
}

/* ★ 是否存活 */
function _isAlive(p) {
	try {
		if (!p) return false;
		if (p.alive === false) return false;
		if (typeof p.isDead === 'function' && p.isDead()) return false;
		return true;
	} catch (e) { return true; }
}

/* ================= 动态换算记账入口 cash() =================
 * 统一货币原则：业务维度值经 fxToMoney 动态汇率 → 货币等量，再计入 round。
 * give() 走"货币无维度"（业务值即货币）；cash() 走"业务值 + 维度汇率"。
 * 全部最终汇入同一货币刻度，实现"货币只有一种"。 */
function cash(char, dim, business, tag) {
	try {
		if (!char) return;
		const conv = fxToMoney(dim, business, { phase: _stage() });
		return give(char, conv.money, tag);
	} catch (e) { return void 0; }
}

/* 当前对局阶段（early/middle/late/endgame）供汇率动态系数使用 */
function _stage() {
	try {
		const players = (game && game.players) || [];
		let alive = 0, maxHp = 0, hp = 0;
		players.forEach(function (p) {
			if (!_isAlive(p)) return;
			alive++; const m = p.maxHp || 4; maxHp += m; hp += Math.min(p.hp || 0, m);
		});
		if (!alive) return 'middle';
		const ratio = hp / maxHp;
		if (ratio < 0.4) return 'endgame';
		if (alive <= 3) return 'late';
		if (ratio > 0.75) return 'early';
		return 'middle';
	} catch (e) { return 'middle'; }
}

/* ★ 阵营平均分（只算活着的成员） */
function _campAvg(members) {
	const alive = members.filter(_isAlive);
	if (!alive.length) return 0;
	let sum = 0;
	for (let i = 0; i < alive.length; i++) sum += _contribution(alive[i]);
	return sum / alive.length;
}

/* ★ 按「阵营平均分」+ 多阵营分层分配扣分 */
function giveVs(char, pts, tag) {
	give(char, pts, tag);
	const es = enemiesOf(char);
	if (!es.length) return;

	const total = -pts;

	/* 按阵营分组 */
	const byCamp = {};
	es.forEach(function (e) {
		const camp = _campOf(e);
		if (!byCamp[camp]) byCamp[camp] = [];
		byCamp[camp].push(e);
	});

	/* ★ 阶段 1：过滤出"还有活人"的阵营 */
	const aliveCamps = Object.keys(byCamp).filter(function (camp) {
		return byCamp[camp].some(_isAlive);
	});

	/* 全部敌方阵营都灭 → 均摊给所有敌方（极端情况兜底） */
	if (aliveCamps.length === 0) {
		const per = Math.round(total * 100 / es.length) / 100;
		es.forEach(function (e) { give(e, per, tag + "（全灭均摊·守恒）"); });
		return;
	}

	/* ★ 阶段 2：只对活着的阵营计算平均分贡献度 */
	const campContrib = {};
	let campSum = 0;
	aliveCamps.forEach(function (camp) {
		const c = _campAvg(byCamp[camp]);
		campContrib[camp] = c;
		campSum += c;
	});

	/* 退化：全 0 → 均摊给活着的阵营成员 */
	if (campSum <= 0.01) {
		const aliveMembers = [];
		aliveCamps.forEach(function (camp) {
			byCamp[camp].forEach(function (p) { if (_isAlive(p)) aliveMembers.push(p); });
		});
		if (!aliveMembers.length) return;
		const per = Math.round(total * 100 / aliveMembers.length) / 100;
		aliveMembers.forEach(function (e) { give(e, per, tag + "（均摊·守恒）"); });
		return;
	}

	/* ★ 阶段 3：按阵营平均分比例切分（最后一个活阵营吃余数） */
	let campAllocated = 0;
	aliveCamps.forEach(function (camp, ci) {
		const aliveMembers = byCamp[camp].filter(_isAlive);

		let campShare;
		if (ci === aliveCamps.length - 1) {
			campShare = Math.round((total - campAllocated) * 100) / 100;
		} else {
			campShare = Math.round(total * (campContrib[camp] / campSum) * 100) / 100;
			campAllocated += campShare;
		}

		/* ★ 阶段 4：阵营内按个人得分切分（最后一个成员吃余数） */
		const memberSum = aliveMembers.reduce(function (s, e) { return s + _contribution(e); }, 0);
		let memberAllocated = 0;
		aliveMembers.forEach(function (e, mi) {
			let share;
			if (mi === aliveMembers.length - 1 || memberSum <= 0.01) {
				share = Math.round((campShare - memberAllocated) * 100) / 100;
			} else {
				share = Math.round(campShare * (_contribution(e) / memberSum) * 100) / 100;
				memberAllocated += share;
			}
			const pct = memberSum > 0
				? Math.round(_contribution(e) / memberSum * 100)
				: Math.round(100 / aliveMembers.length);
			give(e, share, tag + "（" + camp + "·" + pct + "%）");
		});
	});
}

const MONEY_UNIT = 1;             /* 基准货币单位（1 货币 = 1 标准收益） */
const MONEY_LIN  = 8;             /* 线性区上界：|pts|≤8 → 1:1 等量 */
const MONEY_MID  = 50;            /* 亚线性区上界：8<|pts|≤50 → ×0.5 */
const MONEY_CAP  = 29;            /* 大额封顶：|pts|>50 折算后封顶为 29 货币 */
function toMoney(pts) {
	pts = Number(pts) || 0;
	const s = pts < 0 ? -1 : 1;
	const a = Math.abs(pts);
	let out;
	if (a <= MONEY_LIN) out = a;                          /* 线性区：1:1 */
	else if (a <= MONEY_MID) out = MONEY_LIN + (a - MONEY_LIN) * 0.5;  /* 亚线性 */
	else out = MONEY_LIN + (MONEY_MID - MONEY_LIN) * 0.5 + Math.min(MONEY_CAP - (MONEY_LIN + (MONEY_MID - MONEY_LIN) * 0.5), (a - MONEY_MID) * 0.2); /* 大额：再×0.2 渐压缩 */
	out = Math.min(MONEY_CAP, out);
	return Math.round(s * out * 100) / 100;
}


export { round, scoreLog, REC, _poolPromise, SYSTEM_POOL_RATE, rec, _initLedger, _winningSet, conservationLedger, give, displayName, givePair, _campOf, _contribution, _isAlive, cash, _stage, _campAvg, giveVs, toMoney };
export function resetLedgerRound() { round = {}; scoreLog = []; }
export function resetLedgerState() {
    round = {}; _rawRound = {}; scoreLog = []; _ledger = 0; _poolPromise = 0;
    REC = { effects: {}, cards: {}, timings: {}, log: [] };
}
export function getLedgerRecord() { return REC; }
