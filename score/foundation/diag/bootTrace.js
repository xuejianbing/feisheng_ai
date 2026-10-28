/* bootTrace.js —— 启动/首次决策耗时轨迹（手机端"进游戏卡死"定位用）
 *
 * 只读、无副作用：不写存储、不发网络、不改游戏状态。
 * 在关键步骤调用 bootMark('名称', {可选数值/布尔/字符串})：
 *   - 控制台立即打印 `[DJSC] 名称 t=<相对扩展开始加载的毫秒>`，方便在无名杀手机端
 *     「设置 → 其他 → 控制台」直接看最后停在哪一步；
 *   - 轨迹保留最近 160 条，可用 window.__DJSC.perfReport() 一次性取回
 *     （含 perf 统计、权重元信息、决策次数）。
 *
 * 桌面快速自查：node -e 无法跑（依赖 window），浏览器/无名杀控制台里
 *   console.log(JSON.stringify(window.__DJSC.perfReport(), null, 2))
 */

const MAX_MARKS = 160;
const TRACE_VERSION = 2;
let _observer = null;
const _longTasks = [];
const _recentDecisions = [];
let _firstDecisionPerf = null;
export function recordDecisionPerf(ms, phases, reusedResult = false) {
 try {
  const row = { ms: _round(ms), reusedResult: !!reusedResult, phases: {} };
  for (const key of ['preflight','context','targets','candidates','planner','model','observability','guard','telemetry']) if (Number.isFinite(phases?.[key])) row.phases[key] = phases[key];
  if (!_firstDecisionPerf) _firstDecisionPerf = row;
  _recentDecisions.push(row);
  if (_recentDecisions.length > 60) _recentDecisions.shift();
 } catch (_) {}
}

let _printed = 0;
export function uninstallPerfReport() { try { if (_observer) _observer.disconnect(); } catch (_) {} _observer = null; }
function observeLongTasks() {
 if (_observer || typeof PerformanceObserver === 'undefined') return;
 try {
  _observer = new PerformanceObserver(list => {
   for (const entry of list.getEntries()) {
    const preceding = _marks.filter(m => m.t + _t0 <= entry.startTime).slice(-1)[0];
    _longTasks.push({ start: _round(entry.startTime), ms: _round(entry.duration), precedingMark: preceding?.name || null });
   }
   if (_longTasks.length > 50) _longTasks.splice(0, _longTasks.length - 50);
  });
  _observer.observe({type:'longtask',buffered:true});
 } catch (_) { uninstallPerfReport(); }
}


let _t0 = 0;
let _startedAt = 0;
const _marks = [];

function _now() {
	try {
		return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
			? performance.now()
			: Date.now();
	} catch (e) { return Date.now(); }
}

function _round(v) { return (typeof v === 'number' && isFinite(v)) ? Math.round(v * 10) / 10 : v; }

/** 打一个启动轨迹点。name 简短稳定（英文冒号分隔），extra 只允许原始类型。 */
export function bootMark(name, extra) {
	try {
		const t = _now();
		if (!_t0) { _t0 = t; _startedAt = Date.now(); }
		const rec = { name: String(name), t: _round(t - _t0) };
		if (extra && typeof extra === 'object') {
			for (const k in extra) {
				if (!Object.prototype.hasOwnProperty.call(extra, k)) continue;
				const v = extra[k];
				if (typeof v === 'number') rec[k] = _round(v);
				else if (typeof v === 'boolean') rec[k] = v;
				else if (typeof v === 'string') rec[k] = v.slice(0, 90);
			}
		}
		_marks.push(rec);
		if (_marks.length > MAX_MARKS) _marks.splice(0, _marks.length - MAX_MARKS);
		try { if (_printed++ < MAX_MARKS) console.log('[DJSC] ' + rec.name + ' t=' + rec.t + 'ms'); } catch (e) { /* 控制台不可用时不阻断 */ }
		return rec;
	} catch (e) { return null; }
}

export function bootTrace() {
	return _marks.slice();
}

/** 汇总启动轨迹 + 运行时统计，供 __DJSC.perfReport() 与控制台诊断使用。 */
export function bootReport() {
	const out = {
		traceVersion: TRACE_VERSION,
		startedAt: _startedAt || null,
		now: Date.now(),
		marks: bootTrace(),
        longTasks: _longTasks.slice(),
        firstDecisionPerf: _firstDecisionPerf ? {..._firstDecisionPerf, phases:{..._firstDecisionPerf.phases}} : null,
        recentDecisions: _recentDecisions.map(r=>({...r,phases:{...r.phases}})),
        observationBoundary: 'ext:start follows static ESM dependency evaluation. Resource timings measure fetching only; parsing/evaluation before this mark is not separately observable. Longtask association is temporal, not proof of cause.',

	};
	try {
		const w = (typeof window !== 'undefined') ? window : null;
		const D = w && w.__DJSC;
		if (D) {
			out.decisions = (typeof D._djscDecisionCount === 'number') ? D._djscDecisionCount : null;
			out.firstDecision = D._djscFirstDecision ? true : false;
			out.weights = (typeof D.getMeta === 'function') ? D.getMeta() : null;
			out.perf = (typeof D.perfStats === 'function') ? D.perfStats() : null;
			out.policyV3 = (typeof D.policyModelV3 === 'object' && D.policyModelV3)
				? { loaded: !!D.policyModelV3._loaded, loadMs: (typeof D.policyModelV3.stats === 'function' ? (D.policyModelV3.stats() || {}).loadMs : null) }
				: null;
		}
	} catch (e) { /* 诊断失败不影响主流程 */ }
    try {
        out.resources = performance.getEntriesByType('resource').filter(e => decodeURI(e.name).includes('/extension/无名AI/')).slice(-160).map(e => ({ path: decodeURI(e.name).split('/extension/无名AI/')[1].split('?')[0], start: _round(e.startTime), fetchMs: _round(e.duration) }));
    } catch (_) { out.resources = []; }
    return out;
}

/** 挂到 window.__DJSC（幂等；不覆盖已有同名函数）。 */
export function installPerfReport() {
	try {
		if (typeof window === 'undefined') return false;
		window.__DJSC = window.__DJSC || {};
        observeLongTasks();
		if (typeof window.__DJSC.perfReport !== 'function') window.__DJSC.perfReport = bootReport;
		if (typeof window.__DJSC.bootTrace !== 'function') window.__DJSC.bootTrace = bootTrace;
		if (typeof window.__DJSC.bootMark !== 'function') window.__DJSC.bootMark = bootMark;
		return true;
	} catch (e) { return false; }
}

export default { bootMark, bootTrace, bootReport, installPerfReport };
