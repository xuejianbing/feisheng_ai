/*
 * #23：统一游戏阶段 / AOE 单一评估器契约测试
 */
import { existsSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let passed = 0;
const failures = [];
function ok(cond, name, extra) {
	if (cond) {
		passed++;
		process.stdout.write('.');
		return;
	}
	failures.push(name + (extra ? ' >> ' + extra : ''));
	process.stdout.write('F');
}
function eq(actual, expected, name) {
	ok(actual === expected, name, 'got ' + JSON.stringify(actual) + ' want ' + JSON.stringify(expected));
}

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const repoRoot = resolve(here, '..', '..', '..');
const hostPath = join(repoRoot, 'noname.js');
const hostOwned = !existsSync(hostPath);
const hostPkgPath = join(repoRoot, 'package.json');
const hostPkgOwned = hostOwned && !existsSync(hostPkgPath);

const HOST_STUB = `const fn = function () { return undefined; };
const configStore = {};
function P() { return new Proxy(fn, {
	get(t, k) {
		if (k === Symbol.toPrimitive) return function () { return ''; };
		if (k === 'config') return configStore;
		if (!(k in t)) t[k] = P();
		return t[k];
	},
	set(t, k, v) { t[k] = v; return true; },
	apply() { return undefined; }
}); }
export const lib = P();
export const game = P();
export const ui = P();
export const get = P();
export const ai = P();
export const _status = P();
export const _configStore = configStore;
export default { lib, game, ui, get, ai, _status };
`;

if (hostOwned) writeFileSync(hostPath, HOST_STUB, 'utf8');
if (hostPkgOwned) writeFileSync(hostPkgPath, '{"type":"module"}\n', 'utf8');
function cleanup() {
	if (hostOwned && existsSync(hostPath)) {
		try { rmSync(hostPath); } catch (e) {}
	}
	if (hostPkgOwned && existsSync(hostPkgPath)) {
		try { rmSync(hostPkgPath); } catch (e) {}
	}
}
process.on('exit', cleanup);

globalThis.window = globalThis.window || {};
globalThis.window.__DJSC = globalThis.window.__DJSC || {};
globalThis.localStorage = globalThis.localStorage || {
	getItem() { return null; },
	setItem() {},
	removeItem() {},
	clear() {},
	key() { return null; },
	get length() { return 0; },
};

const host = await import(pathToFileURL(hostPath).href);
const phase = await import(pathToFileURL(join(pkg, 'score', 'decision', 'state', 'gamePhase.js')).href);
const threat = await import(pathToFileURL(join(pkg, 'score', 'decision', 'threat', 'threat.js')).href);
const endgame = await import(pathToFileURL(join(pkg, 'score', 'decision', 'tuning', 'endgameOpt.js')).href);
const multi = await import(pathToFileURL(join(pkg, 'score', 'decision', 'strategy', 'multiTurnOpt.js')).href);
const gameTheory = await import(pathToFileURL(join(pkg, 'score', 'cognition', 'reasoning', 'gameTheory.js')).href);
const aoe = await import(pathToFileURL(join(pkg, 'score', 'decision', 'timing', 'aoeTiming.js')).href);

function players(n) {
	return Array.from({ length: n }, function (_, i) {
		return {
			name: 'p' + i,
			name1: 'p' + i,
			alive: true,
			hp: 3,
			maxHp: 4,
			identity: i === 0 ? 'zhu' : 'fan',
			identityShown: true,
			countCards(zone, filter) {
				if (arguments.length > 1) throw new Error('hidden card filter access');
				if (zone !== 'h') return 0;
				return 2;
			},
			getCards(zone) { return zone === 'e' ? [] : []; },
			getEquip() { return null; },
			hasSkillTag() { return false; },
		};
	});
}

/* 1. Game phase：残局人数优先于轮次。 */
host.game.players = players(3);
host._status.roundNumber = 1;
eq(phase.getGamePhase().phase, 'endgame', '23.1 三人局第一轮也必须判为 endgame');
eq(phase.getGamePhase().alive, 3, '23.1 统一 phase 返回存活人数');

host.game.players = players(5);
host._status.roundNumber = 2;
eq(phase.getGamePhase().phase, 'early', '23.1 五人第二轮为 early');

host._status.roundNumber = 5;
eq(phase.getGamePhase().phase, 'mid', '23.1 五人第五轮为 mid');

host._status.roundNumber = 8;
eq(phase.getGamePhase().phase, 'late', '23.1 五人第八轮为 late');

/* 2. tempoFactor 消费统一 phase；残局阶段本身不再强制进攻。 */
host.game.players = players(3);
host._status.roundNumber = 1;
const tf = threat.tempoFactor();
eq(tf.stage, 'endgame', '23.2 tempoFactor 使用统一残局判定');
eq(tf.atkMul, 1.0, '23.2 endgame 不再由 phase 层统一提高攻击倍率');
eq(tf.keepMul, 1.0, '23.2 endgame 不再由 phase 层统一压低防守倍率');
eq(tf.burstMul, 1.0, '23.2 endgame burst 阶段倍率保持中性');
eq(endgame.isEndgame(host.game.players[0]), true, '23.2 endgameOpt 与统一 phase 一致');

/* 3. multiTurn 修复未导入 _status 的旧旁路，并且残局不再泛化加杀/桃。 */
const multiSource = readFileSync(join(pkg, 'score', 'decision', 'strategy', 'multiTurnOpt.js'), 'utf8');
eq(multiSource.includes('_status'), false, '23.3 multiTurn 不再直接读取未导入的 _status');
ok(multiSource.includes("if (plan.strategy === 'endgame') return 1.0"),
	'23.3 multiTurn 残局层保持中性，具体战术交给 endgameOpt');
ok(multiSource.includes('getGamePhase()'), '23.3 multiTurn 消费统一 gamePhase');

/* 4. gameTheory 保留身份博弈，但不再复制人数阶段 card utility。 */
eq(gameTheory.gameTheoryBonus(host.game.players[0], { id: 'sha' }), 0,
	'23.4 gameTheory 不再因人数阶段给攻击牌重复加权');
eq(gameTheory.gameTheoryBonus(host.game.players[0], { id: 'nanman' }), 0,
	'23.4 AOE 不再从 gameTheory 获得重复残局加权');

/* 5. AOE evaluator 禁止精确读取对手隐藏杀/闪。 */
const target = players(1)[0];
let hiddenFilterTouched = false;
target.countCards = function (zone, filter) {
	if (arguments.length > 1) {
		hiddenFilterTouched = true;
		throw new Error('hidden card filter access');
	}
	if (zone === 'h') return 4;
	return 0;
};
target.getCards = function (zone) { return zone === 'e' ? [] : []; };

const pNanman = aoe.aoeResponseProbability(target, 'nanman');
const pWanjian = aoe.aoeResponseProbability(target, 'wanjian');
ok(Number.isFinite(pNanman) && pNanman >= 0 && pNanman <= 1,
	'23.5 南蛮响应概率只由公开状态估计');
ok(Number.isFinite(pWanjian) && pWanjian >= 0 && pWanjian <= 1,
	'23.5 万箭响应概率只由公开状态/行为概率估计');
eq(hiddenFilterTouched, false, '23.5 AOE evaluator 未调用带牌名过滤的 countCards');

/* 6. 静态审计：AOE 不消费 phase；engine 只保留一个 aoeBonus 调用。 */
const aoeSource = readFileSync(join(pkg, 'score', 'decision', 'timing', 'aoeTiming.js'), 'utf8');
const engineSource = readFileSync(join(pkg, 'score', 'decision', 'engine', 'engine.js'), 'utf8') +
	readFileSync(join(pkg, 'score/decision/scoring/cardCandidateScore.js'), 'utf8');
eq(aoeSource.includes('getGamePhase'), false, '23.6 AOE evaluator 不重复消费 game phase');
eq(aoeSource.includes('isEndgamePhase'), false, '23.6 AOE evaluator 不内置残局策略');
eq(aoeSource.includes("countCards('hs'"), false, '23.6 AOE evaluator 无 hs 精确隐藏牌读取');
eq(aoeSource.includes('endgameMul'), false, '23.6 AOE evaluator 无残局额外乘数');
eq(engineSource.includes('allyAtRisk'), false, '23.6 engine 已删除第二套 AOE 风险评估');
eq(engineSource.includes('endgameMul'), false, '23.6 engine 已删除 AOE 残局重复乘数');
eq((engineSource.match(/aoeBonus\(/g) || []).length, 1, '23.6 engine 只有一个 AOE evaluator 调用点');

/* 7. endgameOpt 仍保留具体残局战术，而非被整体删除。 */
const endSource = readFileSync(join(pkg, 'score', 'decision', 'tuning', 'endgameOpt.js'), 'utf8');
for (const strategy of ['finish_kill', 'seek_range', 'defensive', 'survive_1v2', 'focus', 'save_ally']) {
	ok(endSource.includes("strategy: '" + strategy + "'") || endSource.includes("case '" + strategy + "'"),
		'23.7 保留残局具体策略：' + strategy);
}

process.stdout.write('\n');
if (failures.length) {
	console.error('❌ #23 phase/AOE contract failed: ' + failures.length);
	for (const f of failures) console.error('  FAIL ' + f);
	process.exitCode = 1;
} else {
	console.log('✅ #23 phase/AOE contract passed: ' + passed + ' assertions');
}
