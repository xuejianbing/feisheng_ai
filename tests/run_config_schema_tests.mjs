import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CONFIG_ITEMS,
	CONFIG_SECTIONS,
	applyConfigSchema,
	hiddenConfigKeys,
	schemaConfigKeys,
	validateSchema,
	visibleConfigKeys,
} from '../js/config/configSchema.js';
import { SPEC, byKey, pending, readiness } from '../score/foundation/config/configSpec.js';

let pass = 0;
const fails = [];
function ok(cond, name, extra) {
	if (cond) { pass++; process.stdout.write('.'); }
	else { fails.push(name + (extra ? ' >> ' + extra : '')); process.stdout.write('F'); }
}
function eq(a, b, name) { ok(a === b, name, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const configSource = readFileSync(join(root, 'js', 'config', 'config.js'), 'utf8');
const layoutSource = readFileSync(join(root, 'js', 'config', 'configLayout.js'), 'utf8');
const specSource = readFileSync(join(root, 'score', 'foundation', 'config', 'configSpec.js'), 'utf8');
const utilSource = readFileSync(join(root, 'score', 'foundation', 'config', 'util.js'), 'utf8');

const schemaCheck = validateSchema();
ok(schemaCheck.ok, '10.60 schema 自身无重复/漏分组/非法默认值', schemaCheck.errors.join(' | '));

eq(CONFIG_ITEMS.qqGroup.default, '1080487560', '10.60 QQ群唯一默认值为1080487560');
eq(CONFIG_ITEMS.championBoost.default, '0', '10.60 冠军策略默认保持关闭');
eq(CONFIG_ITEMS.aiStrength.default, '中', '10.60 AI强度默认保持中');
eq(CONFIG_ITEMS.testDecisionLog.default, '摘要', '10.60 测试决策日志默认保持摘要');
eq(CONFIG_ITEMS.learningRate.default, '0.005', '10.60 学习率默认保持0.005');

ok(CONFIG_SECTIONS.some(s => s.id === 'player_cards' && s.entries.some(e => e && e.kind === 'subsection' && e.title === '锦囊牌')),
	'10.60 卡牌策略仍由Schema定义基本/锦囊/装备/其他层级');
ok(CONFIG_SECTIONS.some(s => s.id === 'dev_identity' && s.entries.some(e => e && e.kind === 'status' && e.title === '隐藏信息隔离')),
	'10.60 强制安全边界仍为锁定状态而非普通开关');

const visible = visibleConfigKeys();
const hidden = hiddenConfigKeys();
ok(visible.includes('decisionScore') && visible.includes('enablePlanner') && visible.includes('openGuardPanel'),
	'10.60 玩家/开发者关键设置均由Schema布局');
ok(hidden.includes('qqGroup') && hidden.includes('openSkillPanel'),
	'10.60 隐藏配置也登记在Schema，不形成未知配置');

ok(layoutSource.includes("from './configSchema.js'") &&
	!layoutSource.includes('const groups = [') &&
	!layoutSource.includes('const explanations = {'),
	'10.60 configLayout 不再维护第二份分组/说明表');

ok(configSource.includes("import { applyConfigSchema } from './configSchema.js'") &&
	configSource.includes('config = applyConfigSchema(config);'),
	'10.60 config.js 在渲染前由Schema注入配置契约');
ok(!/\binit\s*:/.test(configSource),
	'10.60 config.js 不再重复维护任何默认值');
ok(!/\bitem\s*:/.test(configSource),
	'10.60 config.js 不再重复维护枚举选项');

ok(specSource.includes("from '../../../js/config/configSchema.js'") &&
	!specSource.includes('123456789') &&
	!specSource.includes('gameProfileId') &&
	!specSource.includes('modelBackendUrl'),
	'10.60 ConfigSpec 只派生Schema，不保留旧群号/伪active预留项');

ok(utilSource.includes("configDefault") && utilSource.includes("return configDefault(k, d)"),
	'10.60 运行时cfg缺省值也回退唯一Schema');

eq(pending().length, 0, '10.60 未接线预留项不再伪装成pending配置');
eq(readiness().percent, 100, '10.60 已登记可配置项全部来自唯一Schema');

/* 所有可调值在 ConfigSpec 的默认值必须严格等于 Schema。 */
for (const key of schemaConfigKeys()) {
	const meta = CONFIG_ITEMS[key];
	if (!meta || meta.type === 'action') continue;
	const row = byKey(key);
	ok(!!row, '10.60 ConfigSpec 包含可调项 ' + key);
	if (row) eq(row.default, meta.default, '10.60 ConfigSpec 默认值同步 ' + key);
}

/* 用空壳 config 模拟 config.js：默认值/枚举项只由 applyConfigSchema 注入。 */
const dummy = {};
for (const key of schemaConfigKeys()) dummy[key] = {};
applyConfigSchema(dummy);
for (const key of schemaConfigKeys()) {
	const meta = CONFIG_ITEMS[key];
	if (!meta || meta.type === 'action') continue;
	eq(dummy[key].init, meta.default, '10.60 Schema注入默认值 ' + key);
	if (meta.options) {
		eq(JSON.stringify(dummy[key].item), JSON.stringify(meta.options), '10.60 Schema注入枚举项 ' + key);
	}
}

/* 轻量解析 config.js 顶层配置键，防新增设置忘记登记 Schema。
 * 这里只识别 export let config = {...} 第一层 identifier key。 */
function topLevelConfigKeys(src) {
	const start = src.indexOf('export let config = {');
	const open = src.indexOf('{', start);
	const out = [];
	let depth = 1, quote = null, esc = false, line = false, block = false;
	for (let i = open + 1; i < src.length && depth > 0; i++) {
		const c = src[i], n = src[i + 1];
		if (line) { if (c === '\n') line = false; continue; }
		if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
		if (quote) {
			if (esc) { esc = false; continue; }
			if (c === '\\') { esc = true; continue; }
			if (c === quote) quote = null;
			continue;
		}
		if (c === '/' && n === '/') { line = true; i++; continue; }
		if (c === '/' && n === '*') { block = true; i++; continue; }
		if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
		if (c === '{') { depth++; continue; }
		if (c === '}') { depth--; continue; }
		if (depth !== 1) continue;
		if (!/[A-Za-z_$]/.test(c)) continue;
		const m = src.slice(i).match(/^([A-Za-z_$][\w$]*)\s*:/);
		if (m) {
			out.push(m[1]);
			i += m[0].length - 1;
		}
	}
	return out;
}

const topKeys = topLevelConfigKeys(configSource);
const unregistered = topKeys.filter(key => key !== 'djscBd' && !/Bd$/.test(key) && !CONFIG_ITEMS[key]);
ok(unregistered.length === 0,
	'10.60 config.js 不存在未登记Schema的真实设置/动作',
	unregistered.join(', '));

const missingSource = schemaConfigKeys().filter(key => !topKeys.includes(key));
ok(missingSource.length === 0,
	'10.60 Schema 不引用 config.js 中不存在的功能',
	missingSource.join(', '));

process.stdout.write('\n');
if (fails.length) {
	console.error('\n❌ #34 config schema contract failed: ' + fails.length + ' / ' + (pass + fails.length));
	for (const f of fails) console.error('  FAIL ' + f);
	process.exitCode = 1;
} else {
	console.log('\n✅ #34 config schema contract passed: ' + pass + ' assertions');
}
