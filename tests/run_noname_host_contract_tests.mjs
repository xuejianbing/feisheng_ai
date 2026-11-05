/* 只读验证官方无名杀 v1.11.6.1 的宿主事件契约；不会修改宿主仓库。 */
import { execFileSync } from 'node:child_process';

const repo = process.env.NONAME_HOST_REPO;
if (!repo) throw new Error('缺少 NONAME_HOST_REPO');

function git(...args) {
	return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}
function source(path) { return git('show', 'HEAD:' + path); }
function check(condition, name) {
	if (!condition) throw new Error('宿主契约失败：' + name);
	process.stdout.write('.');
}

const head = git('rev-parse', 'HEAD').trim();
const tagHead = git('rev-parse', 'refs/tags/v1.11.6.1^{}').trim();
check(head === tagHead, '源码必须精确对应 v1.11.6.1');

const player = source('apps/core/noname/library/element/player.js');
const event = source('apps/core/noname/library/element/gameEvent.ts');
const content = source('apps/core/noname/library/element/content.ts');

check(/useCard\(params\)\s*\{[\s\S]*?game\.createEvent\("useCard"\)/.test(player),
	'Player.useCard 创建 useCard GameEvent');
check(/useCard\(params\)[\s\S]*?return next;/.test(player),
	'Player.useCard 返回 GameEvent，而非动作完成布尔值');
check(/then<TResult1, TResult2>[\s\S]*?this\.start\(\)/.test(event),
	'GameEvent.then 等待事件启动流程');
check(/finished = false;[\s\S]*?finish\(\)\s*\{\s*this\.finished = true;/.test(event),
	'GameEvent 暴露完成状态');
check(/cancel\([\s\S]*?this\._cancelled = true;[\s\S]*?this\.finish\(\)/.test(event),
	'取消事件同时标记 _cancelled 并结束');
check(/actionHistory\[player\.actionHistory\.length - 1\]\.useCard\.push\(event\)/.test(content),
	'useCard 执行流程登记真实动作事件');
check(/useSkill\(params\)\s*\{[\s\S]*?game\.createEvent\("useSkill"\)/.test(player),
	'Player.useSkill 创建 useSkill GameEvent');
check(/useSkill\(params\)[\s\S]*?next\.setContent\("useSkill"\);\s*return next;/.test(player),
	'Player.useSkill 返回可等待的 GameEvent');

console.log('\n无名杀 v1.11.6.1 宿主契约：9 项通过');
