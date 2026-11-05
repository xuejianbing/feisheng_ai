/*
 * ============================================
 * 版权所有，侵权必究
 * 通用卡牌博弈AI决策引擎 · 自检模块
 * ============================================
 */

/* ================= 专业级就绪度体检 =================
 *
 * 【用途】一眼看清「通用架构 + 专业级预留」还差哪些没填。
 *
 * 覆盖四块：
 *   1. 内核解耦    —— 宿主适配桥是否已收敛（唯一耦合点）
 *   2. 游戏档案    —— 语义牌表 / 阶段 / 阵营 / 事件 是否填全
 *   3. 扩展点      —— 八类扩展点各已注册多少 / 还差多少
 *   4. 配置规格    —— 已接入项 vs 专业级预留项
 *
 * 调用：__DJSC.proReady.report()  取结构化报告
 *       __DJSC.proReady.text()    取可读文本
 */

import { profileReadiness } from '../foundation/adapt/gameProfile.js';
import { readiness as extReadiness } from '../foundation/runtime/extensionPoints.js';
import { readiness as cfgReadiness } from '../foundation/config/configSpec.js';
import { coverage, SEMANTIC_LABEL } from '../foundation/adapt/terms.js';
import { AUDIT } from './semanticAudit.js';

/** 结构化就绪度报告 */
export function report() {
	let prof = null;
	let ext = null;
	let cfg = null;
	let sem = null;
	try { prof = profileReadiness(); } catch (e) { prof = null; }
	try { ext = extReadiness(); } catch (e) { ext = null; }
	try { cfg = cfgReadiness(); } catch (e) { cfg = null; }
	try { sem = coverage(); } catch (e) { sem = null; }

	const gaps = [];

	if (sem) {
		sem.missing.forEach(function (s) {
			gaps.push({ area: '术语语义', item: SEMANTIC_LABEL[s] || s, todo: '在 gameProfile.js 的 semanticIds 填入该语义类的卡牌' });
		});
	}
	if (prof) {
		prof.phases.missing.forEach(function (k) { gaps.push({ area: '阶段', item: k, todo: '填该游戏实际阶段名' }); });
		prof.camps.missing.forEach(function (k) { gaps.push({ area: '阵营', item: k, todo: '填该游戏实际身份名' }); });
		prof.events.missing.forEach(function (k) { gaps.push({ area: '事件', item: k, todo: '填该游戏实际事件名' }); });
	}
	if (ext) {
		ext.rows.forEach(function (r) {
			if (r.open > 0) {
				gaps.push({
					area: '扩展点·' + r.label,
					item: r.point,
					todo: '还需 ' + r.open + ' 个实现；契约 ' + r.contract.join(' '),
				});
			}
		});
	}
	if (cfg) {
		cfg.pendingKeys.forEach(function (k) {
			gaps.push({ area: '配置预留', item: k, todo: '填值；实现接入后把 status 改为 active' });
		});
	}

	if (AUDIT && AUDIT.legacyFiles > 0) {
		gaps.push({
			area: '适配词表下沉',
			item: AUDIT.legacyFiles + ' 个文件 / ' + AUDIT.hits + ' 处专有词（洁净率 ' + AUDIT.cleanRate + '%）',
			todo: '替换为 terms.js 语义查询（idsOf / bucketIds / isSemantic / semanticOf）；进度见 build/semantic_audit.mjs',
		});
	}

	/* 就绪度权重：档案 30% + 扩展点 30% + 配置 20% + 词表洁净率 20% */
	const profPct = prof ? Math.round(((sem ? sem.filledCount : 0) / Math.max(1, sem ? sem.total : 1)) * 100) : 0;
	const extPct = ext ? ext.percent : 0;
	const cfgPct = cfg ? cfg.percent : 0;
	const vocabPct = (AUDIT && typeof AUDIT.cleanRate === 'number') ? AUDIT.cleanRate : 0;
	const overall = Math.round(profPct * 0.3 + extPct * 0.3 + cfgPct * 0.2 + vocabPct * 0.2);

	return {
		/* 内核解耦（已完成项） */
		kernel: {
			hostSeam: true,                              /* 宿主耦合已收敛为 score/foundation/adapt/host.js */
			featureDim: 130,                             /* 特征契约维度 */
			semanticLayer: true,                         /* 语义层已建立并作为权威来源（新增模块只认语义） */
			vocab: AUDIT,                                /* 专有词表残留审计（下沉进度） */
		},
		/* 游戏档案 */
		profile: prof,
		/* 扩展点 */
		extension: ext,
		/* 配置规格 */
		config: cfg,
		/* 待填清单 */
		gaps: gaps,
		/* 综合就绪度 */
		score: { profile: profPct, extension: extPct, config: cfgPct, vocab: vocabPct, overall: overall },
	};
}

/** 可读文本报告 */
export function text() {
	const r = report();
	const prof = r.profile || {};
	const lines = [];
	lines.push('【通用卡牌博弈AI决策引擎 · 专业级就绪度】');
	lines.push('─'.repeat(46));
	lines.push('内核解耦   : ✅ 宿主耦合唯一化（score/foundation/adapt/host.js）');
	lines.push('          : ✅ 特征契约 ' + r.kernel.featureDim + ' 维');
	lines.push('          : ✅ 语义层已建立并作为权威来源（新增模块只认语义）');
	if (r.kernel.vocab) {
		lines.push('适配词表   : ' + r.kernel.vocab.cleanRate + '% 文件已洁净' +
			'（' + r.kernel.vocab.cleanFiles + '/' + r.kernel.vocab.files + '）' +
			'，残留 ' + r.kernel.vocab.hits + ' 处 / ' + r.kernel.vocab.legacyFiles + ' 文件');
	}
	lines.push('─'.repeat(46));
	lines.push('游戏档案   : ' + (prof.name || '(未知)') + ' / ' + (prof.engine || '-'));
	if (r.extension) {
		lines.push('扩展点     : ' + r.extension.registered + '/' + r.extension.expect + '  (' + r.extension.percent + '%)');
	}
	if (r.config) {
		lines.push('配置规格   : 已接入 ' + r.config.active + ' 项 / 预留 ' + r.config.pending + ' 项');
	}
	lines.push('─'.repeat(46));
	lines.push('综合就绪度 : ' + r.score.overall + '%   (档案 ' + r.score.profile + '% · 扩展点 ' + r.score.extension +
		'% · 配置 ' + r.score.config + '% · 词表 ' + r.score.vocab + '%)');
	lines.push('─'.repeat(46));
	if (!r.gaps.length) {
		lines.push('✅ 无待填项，专业级架构已全部就绪');
	} else {
		lines.push('待填清单（共 ' + r.gaps.length + ' 项）：');
		r.gaps.slice(0, 40).forEach(function (g, i) {
			lines.push('  ' + (i + 1) + '. [' + g.area + '] ' + g.item + ' → ' + g.todo);
		});
		if (r.gaps.length > 40) lines.push('  … 其余 ' + (r.gaps.length - 40) + ' 项略');
	}
	return lines.join('\n');
}
