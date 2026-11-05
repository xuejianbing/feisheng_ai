/*
 * ============================================
 * // الناشر: في شينغ الأصلي
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

import { SESSION_CHANGELOG } from '../../logs/今日修改日志.js';
import { WORK_TRAIL } from '../../logs/WORK_TRAIL.js';
import { VERSION, VERSION_SEMVER, BUILD_DATE, MIN_GAME_VERSION } from './version.js';  /* ★ P2-35：版本信息单一来源 */
const _BUILD_DATE_CN = BUILD_DATE.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1年$2月$3日');

/* ★ 会话修改日志内置：由 logs/今日修改日志.js 单一来源渲染成游戏内更新日志，
 *   以后只维护 logs 那一份即可，避免两处日志重复/不同步。 */
function _renderSessionLog() {
	try {
		return (SESSION_CHANGELOG || []).map(function (p) {
			const items = (p.changes || []).map(function (c) { return c.desc; }).join('；');
			return "<span style='color: #FFD700'>" + p.phase + "</span>：" + items + "。<br />";
		}).join('');
	} catch (e) { return ''; }
}

/* ★ 工作留痕：把 WORK_TRAIL（文件→日期→改动痕迹）渲染为可折叠清单 */
function _renderWorkTrail() {
	try {
		const keys = Object.keys(WORK_TRAIL || {});
		if (!keys.length) return '';
		const lis = keys.map(function (f) {
			const r = WORK_TRAIL[f];
			return "<li><b style='color:#00BFFF'>" + f + "</b> <i style='color:#FFA500'>[" + (r.dates || []).join(',') + "]</i><br />" + (r.desc || '') + "</li>";
		}).join('');
		return "<details style='margin-top:6px'><summary style='color:#FFD700'>工作留痕（" + keys.length + " 个文件改动痕迹）</summary><ul style='margin:4px 0 0 14px;font-size:12px'>" + lis + "</ul></details>";
	} catch (e) { return ''; }
}

export const changelog = "<details class='djsc-update-log'><summary>更新日志</summary><div class='djsc-update-content'><span style='color: #00FFB0'>无名AI · 决策积分引擎版 v" + VERSION + "</span><br /><span style='color: #00FFFF'>更新日期</span>：" + _BUILD_DATE_CN + "<br /><span style='color: #00FFB0'>扩展当前版本号</span>：<span style='color: #FFFF00'>" + VERSION + "（semver " + VERSION_SEMVER + "）</span><br /><span style='color: #00FFB0'>支持本体最低版本号</span>：<span style='color: #FFFF00'>" + MIN_GAME_VERSION + "</span><br /><span style='color: #00FFFF'>核心功能</span>：<br />· 决策积分引擎（代码级收益分析+统一动作评分+小模型先验+扩展识别+守恒记分）<br />· 八层决策信号：节奏/性格/团队/位置/经济/博弈/预测/趋势<br />· 技能三维矩阵 + 反馈自我学习 + 跨局记忆 + 战报归档<br />· 性格三维滑条 + 模板市场 + 分享字符串 + 自定义模板<br />· 观战/批量对比 + 决策回放导入导出 + AI 协作分工 + 多档案<br />· 原生 AI 接管层（实验，可选，默认关）<br />· 完全接管 chooseToUse/Respond/Discard/Compare + 熔断器<br /><span style='color: #00FFFF'>会话更新日志（logs/今日修改日志.js 单一来源，完整覆盖 09.13 ~ 09.29 全量改动 + 工作留痕，自动展开下方渲染）</span>：<br />" + _renderSessionLog() + "<span style='color: #FFD700'>v2.9 更新日志</span>：<br />· 优化设置分区、战后报告及功能面板，支持折叠记忆、居中半透明弹窗，统一中文与数值显示。<br />· 修正窗口越界、文字重叠和部分入口异常，新增反馈QQ群一键复制，鸣谢常显、日志可折叠。<br /><br /><span style='color: #FFD700'>v2.5 修复与升级</span>：<br />· 修复 allyExempt 模块加载失败导致真实加权校验不生效<br />· 批量修复 121 处子目录模块相对 import 路径错误<br />· 激活子目录模块化版为活代码（300+ 文件）<br />· 自检面板升级：33 个模块功能级 stats() 调用验证<br />· 修复 trainExport.js 未定义引用导致扩展加载崩溃<br />· 批量暴露 31 个模块到全局供自检访问<br /><span style='color: #FFD700'>v2.0 新增</span>：<br />· 博弈策略层（威慑姿态/意图识别/压迫力/策略保留）<br />· 连招链识别（铁索火攻/拆防连杀/酒杀斩杀/AOE顺拆/连弩爆发）<br />· 对手长期记忆（跨局玩家画像/仇恨度/行为偏好）<br />· 决策解释器 2.0（自然语言解释每次决策）<br />· 性能分析器（热点分析/调用树/内存监控）<br />· 训练数据导出（蒸馏包/完整训练包/全量备份）<br />· 四层违规样本过滤系统<br />· 开机自修复机制<br />" + _renderWorkTrail() + "</div></details>";
