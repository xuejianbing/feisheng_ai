/*
 * ============================================
 * // 作者：飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 静默 catch 观测器（P2-32）+ 异常健康度（指令 05 Stage J） =================
 * 背景：全扩展约 1400+ 处 catch(e){}，把"可降级异常 / 真 bug / 接口断裂 /
 *   数据损坏 / import 失败"全部静默吞掉，用户看到"AI 没生效"时开发侧拿不到根因。
 *
 * 策略（对应报告三级分类，且绝不打断对局）：
 *  - 每次被静默的异常都计数（hot path 也只做整数自增，开销可忽略）；
 *  - 按 message@调用栈首帧 聚合，swallowStats() 可查高频真因；
 *  - 生命周期内最多 console.debug 采样 MAX_LOG 条，不刷日志、不弹窗；
 *  - swallow() 自身永不抛出。
 *
 * ★ 指令 05 Stage J：把「expected fallback」与「unexpected exception」分流。
 *   - expected：业务可降级分支（如字段缺失回退默认值）→ swallowError()，仅静默计数；
 *   - unexpected：真 bug / 关键接口断裂 / 引擎安装失败 → reportUnexpected(module, reason, err)，
 *     进入结构化诊断（module / reason / counter / last occurrence），unexpectedStats() 可查，
 *     并汇入 healthCheck 的「异常健康度」，避免"模块坏掉只表现为 AI 变笨"。
 *
 * 使用：业务代码的空 catch 体由 codemod 统一改写成
 *   catch (e) { if (window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
 * 控制台：window.__DJSC.swallowStats() / window.__DJSC.resetSwallow()
 *         window.__DJSC.unexpectedStats() / window.__DJSC.resetUnexpected()
 */

var _swTotal = 0;
var _swCounts = Object.create(null);   /* key -> count */
var _swLogLeft = 40;                   /* 生命周期采样日志上限 */

function _swFrame(e) {
    try {
        var stack = e && e.stack;
        if (!stack) return '';
        var lines = String(stack).split('\n');
        for (var i = 0; i < lines.length; i++) {
            var ln = lines[i];
            if (ln.indexOf('swallow.js') >= 0) continue;
            var t = ln.trim();
            if (t) return t.slice(0, 160);
        }
    } catch (se) {}
    return '';
}

export function swallowError(e, context) {
    try {
        _swTotal++;
        var msg;
        try { msg = (e && (e.message || String(e))) || 'unknown'; } catch (me) { msg = 'unknown'; }
        msg = String(msg).slice(0, 120);
        var frame = context ? String(context).slice(0, 80) : _swFrame(e);
        var key = msg + (frame ? ' @ ' + frame : '');
        _swCounts[key] = (_swCounts[key] || 0) + 1;
        if (_swLogLeft > 0) {
            _swLogLeft--;
            try { console.debug('[无名AI·静默] ' + msg + (frame ? '  ' + frame : '')); } catch (le) {}
        }
    } catch (outer) {
        /* 观测器自身任何意外都不允许影响业务 */
    }
}

export function swallowStats() {
    try {
        var keys = Object.keys(_swCounts);
        var top = keys.map(function (k) { return { key: k, count: _swCounts[k] }; })
            .sort(function (a, b) { return b.count - a.count; })
            .slice(0, 20);
        return { total: _swTotal, kinds: keys.length, sampledLogLeft: _swLogLeft, top: top };
    } catch (e) { return { total: _swTotal, kinds: 0, top: [] }; }
}

export function resetSwallow() {
    _swTotal = 0;
    _swCounts = Object.create(null);
    _swLogLeft = 40;
}

/* ---------- ★ Stage J：unexpected 异常健康度注册表 ---------- */
var _unexpected = Object.create(null);   /* key: module → { module, reason, count, last } */
var _unexpectedTotal = 0;

/**
 * 记录一次「unexpected exception」（真 bug / 关键接口断裂，非业务可降级分支）。
 * @param {string} module 发生模块名
 * @param {string} reason 失败原因简述（可空，回退 err.message）
 * @param {Error}  err    原始异常（可空）
 */
export function reportUnexpected(module, reason, err) {
    try {
        _unexpectedTotal++;
        var m = String(module || '?').slice(0, 60);
        var r = String(reason || (err && (err.message || String(err))) || 'unknown').slice(0, 160);
        var rec = _unexpected[m] || (_unexpected[m] = { module: m, reason: r, count: 0, last: 0 });
        rec.count++;
        rec.reason = r;          /* 保留最新 reason */
        rec.last = Date.now();
    } catch (e) {
        /* 观测器自身任何意外都不允许影响业务 */
    }
}

export function unexpectedStats() {
    try {
        var keys = Object.keys(_unexpected);
        var items = keys.map(function (k) { var r = _unexpected[k]; return { module: r.module, reason: r.reason, count: r.count, last: r.last }; })
            .sort(function (a, b) { return b.count - a.count; });
        return { total: _unexpectedTotal, modules: items.length, items: items.slice(0, 20) };
    } catch (e) { return { total: _unexpectedTotal, modules: 0, items: [] }; }
}

export function resetUnexpected() {
    _unexpected = Object.create(null);
    _unexpectedTotal = 0;
}

/* 叶子模块，模块求值即自挂载；extension.js 把本 import 放在第一位以保证最早可用 */
if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.swallow = swallowError;
    window.__DJSC.swallowStats = swallowStats;
    window.__DJSC.resetSwallow = resetSwallow;
    window.__DJSC.reportUnexpected = reportUnexpected;
    window.__DJSC.unexpectedStats = unexpectedStats;
    window.__DJSC.resetUnexpected = resetUnexpected;
}
