/* 职责：技能收益与敌我方向的文本展示；不扫描技能、不持有画像缓存。 */
import { lib, _status } from '../../foundation/adapt/host.js';
import { renderScoreBreakdown } from '../../decision/skills/skillRules.js';
import { skillTagsOf } from '../../decision/skills/skillSourceTags.js';
import { sixDimEnemyAlly, skillProfitBreakdown } from '../../decision/skills/skillProfiles.js';
export function renderSixDimEnemyAlly(sid, me) {
	try {
		const r = sixDimEnemyAlly(sid, me);
		const L = [];
		L.push('【六类·敌我方向】');
		const order = ['draw', 'damage', 'recover', 'control', 'utility', 'defense'];
		order.forEach(function (k) {
			const d = r.dims[k];
			if (!d) return;
			const mark = d.camp === '敌' ? '敌·' : '我·';
			const active = d.active ? '🟢' : '⚪';
			L.push('  ' + active + ' ' + mark + d.label + '（' + (d.score > 0 ? '+' : '') + d.score + '）');
		});
		if (r.warns && r.warns.length) {
			/* 黄线警告 */
			const group = {};
			r.warns.forEach(function (w) { group[w.msg] = 1; });
			L.push('');
			L.push('⚠️ 【不推荐黄线】');
			Object.keys(group).forEach(function (msg) { L.push('  ⚠️ ' + msg); });
		} else {
			L.push('');
			L.push('✅ 当前战况下：推荐使用');
		}
		return L.join('\n');
	} catch (e) {
		return '【六类·敌我方向】\n评估失败：' + String(e).slice(0, 60);
	}
}

/* ============================================================
 * ★ 技能收益拆解（正收益 / 负收益 / 条件 明细）
 * ============================================================ */
export function renderSkillBreakdownText(sid) {
	try {
		const sk = lib.skill && lib.skill[sid];
		const tags = skillTagsOf(sid);

		/* ★ 用多维评分渲染主体 */
		let text = renderScoreBreakdown(sid, tags, { sid: sid, skill: sk });

		/* ★ 附加：条件 / 元信息 */
		const br = skillProfitBreakdown(sid);
		const extras = [];

		if (br.metaTypes && br.metaTypes.length) {
			extras.push('');
			extras.push('【类型】' + br.metaTypes.join(' · '));
		}
		if (br.isPureAI) {
			extras.push('');
			extras.push('ℹ 该技能为 AI 辅助类');
		}
		if (br.isRuleOnly) {
			extras.push('');
			extras.push('ℹ 该技能为规则约束类');
		}
		/* ★ 优化：不要显示"未被识别"，改成友好提示 */
		if (br.isUnrecognized) {
			extras.push('');
			extras.push('ℹ 该技能效果较复杂');
			extras.push('  已按默认分数计算');
		}

		if (br.conditions && br.conditions.length) {
			extras.push('');
			extras.push('【条件/限制】');
			br.conditions.forEach(function (x) {
				let tag = '·';
				if (x.severity === 'warn') tag = '⚠';
				if (x.isPureAI) tag = '★';
				if (x.isRuleOnly || x.isRule) tag = '⚙';
				if (x.isMod) tag = '🔧';
				if (x.isAI) tag = '🤖';
				extras.push('  ' + tag + ' ' + x.label);
			});
		}

		/* ★ 六分类敌我方向 + 黄线不推荐 */
		extras.push('');
		extras.push(renderSixDimEnemyAlly(sid, _status.currentPhase));

		extras.push('');
		extras.push('【识别来源】' + (br.source || 'default'));

		return text + '\n' + extras.join('\n');
	} catch (e) {
		return '--- ' + sid + ' ---\n渲染异常：' + String(e).slice(0, 80);
	}
}
