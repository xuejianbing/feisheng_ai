/*
 * ============================================
 * // الناشر: في شينغ الأصلي
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 性能分析器 =================
 * 功能：
 *   ① 热点分析：各阶段耗时累计、平均、最大
 *   ② 调用树：按父子关系记录耗时（限深度 5）
 *   ③ 内存监控：localStorage 占用、缓存大小
 *   ④ 优化建议：自动识别瓶颈
// Автор: Фэйшэн Оригинал | Лицензия: GPL-3.0
 */
import { log } from './logger.js?v=5e5';
import { writeData, fileOf } from '../storage/storagePaths.js?v=5e5';   /* ★ 统一导出路径 */

import { ui } from '../adapt/host.js?v=5e5';
import { runtimePerformance } from './performanceCore.js?v=5e5';
const HISTORY_LIMIT = 100;
export const profStart = (phase, options) => runtimePerformance.start(phase, options);
export const profEnd = handle => runtimePerformance.end(handle);
export const profRecord = (phase, dt) => runtimePerformance.record(phase, dt);
export function profile(phase, fn) {
    const handle = profStart(phase);
    try { return fn(); } finally { profEnd(handle); }
}
export async function profileAsync(phase, fn) {
    const handle = profStart(phase, { detached: true });
    try { return await fn(); } finally { profEnd(handle); }
}

/* ================= 统计报告 ================= */
export function profilerStats() {
    const out = { ...runtimePerformance.snapshot(), memory: _memoryStats() };
    /* 按总耗时降序 */
    out.phases.sort(function (a, b) { return b.total - a.total; });
    /* 优化建议 */
    out.suggestions = _analyzeSuggestions(out.phases);
    return out;
}

function _memoryStats() {
    try {
        let lsTotal = 0, lsCount = 0;
        for (let i = 0; i < _lsLength(); i++) {
            const k = _lsKey(i);
            if (!k) continue;
            const v = _lsGet(k) || '';
            lsTotal += k.length + v.length;
            lsCount++;
        }
        return {
            localStorageBytes: lsTotal,
            localStorageKB: Math.round(lsTotal / 1024 * 100) / 100,
            localStorageKeys: lsCount,
        };
    } catch (e) { return {}; }
}

function _analyzeSuggestions(phases) {
    const out = [];
    phases.forEach(function (p) {
        if (p.avg > 100) {
            out.push({
                level: 'error',
                phase: p.phase,
                msg: '平均耗时 ' + p.avg + 'ms 过高（>100ms），建议优化',
            });
        } else if (p.avg > 30) {
            out.push({
                level: 'warn',
                phase: p.phase,
                msg: '平均耗时 ' + p.avg + 'ms 偏高（>30ms），留意',
            });
        }
        if (p.max > 500) {
            out.push({
                level: 'error',
                phase: p.phase,
                msg: '峰值耗时 ' + p.max + 'ms 超 500ms，可能导致卡顿',
            });
        }
    });
    return out;
}

/* ================= 历史快照 ================= */
const HISTORY = [];
export function profilerSnapshot() {
    try {
        const s = profilerStats();
        HISTORY.push({ ts: Date.now(), top: s.phases.slice(0, 5) });
        while (HISTORY.length > HISTORY_LIMIT) HISTORY.shift();
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
export function profilerHistory() { return HISTORY.slice(); }

/* ================= 控制 ================= */
export function profilerEnable(v) { runtimePerformance.enable(v); }
export function profilerEnabled() { return runtimePerformance.enabled(); }

export function profilerReset() {
    runtimePerformance.reset();
    HISTORY.length = 0;
    log.info('profiler', '性能分析器已复位');
}

/* ================= 面板渲染 ================= */
export function openProfilerPanel() {
    try {
        const s = profilerStats();
        const html = _buildHtml(s);
        let dlg = null;
        try { dlg = ui.create.dialog('性能分析'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        if (!dlg) { alert('面板打开失败'); return; }
        try {
            dlg.classList.add('fullheight');
            dlg.style.width = 'min(92vw, 720px)';
            dlg.style.maxWidth = '92vw';
            dlg.style.left = '4vw';
        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        const d = document.createElement('div');
        d.innerHTML = html;
        dlg.content.appendChild(d);
        styleNativePanel(dlg, '性能分析');
        setTimeout(_bind, 50);
    } catch (e) { alert('面板异常：' + e.message); }
}

function _buildHtml(s) {
    let h = '<div style="font-size:12px; color:#dbe7f5; padding:8px; line-height:1.7;">';

    /* 内存 */
    h += '<b style="color:#9ad8ff;">📦 内存</b><br>';
    h += '<div style="padding:4px 8px; background:rgba(255,255,255,0.04); border-radius:4px;">';
    h += 'localStorage：' + (s.memory.localStorageKB || 0) + ' KB / ' + (s.memory.localStorageKeys || 0) + ' 个键';
    h += '</div><br>';

    h += '<div>统计保留：' + s.retention.nodes + '/' + s.retention.maxNodes + ' 个调用节点；异步阶段为等待完成的总耗时，不能当作纯 CPU 耗时。</div><br>';
    /* 阶段耗时表 */
    h += '<b style="color:#9ad8ff;">⏱ 阶段耗时（按总耗时降序）</b>';
    if (!s.phases.length) {
        h += '<div style="color:#888; padding:8px;">暂无数据。跑几局后自动生成。</div>';
    } else {
        h += '<table style="width:100%; font-size:11px; border-collapse:collapse;">';
        h += '<tr style="background:#2a3a5a; color:#9ad8ff;">';
        h += '<th style="padding:3px;">阶段</th><th>次数</th><th>总(ms)</th><th>平均</th><th>峰值</th><th>P95</th></tr>';
        s.phases.forEach(function (p) {
            const col = p.avg > 100 ? '#ff9c9c' : (p.avg > 30 ? '#ffd479' : '#7fe3a0');
            h += '<tr style="border-bottom:1px solid #2a3a5a;">';
            h += '<td style="padding:3px;">' + p.phase + '</td>';
            h += '<td style="text-align:center;">' + p.count + '</td>';
            h += '<td style="text-align:center;">' + p.total + '</td>';
            h += '<td style="text-align:center; color:' + col + ';">' + p.avg + '</td>';
            h += '<td style="text-align:center;">' + p.max + '</td>';
            h += '<td style="text-align:center;">' + p.p95 + '</td>';
            h += '</tr>';
        });
        h += '</table>';
    }

    /* 优化建议 */
    if (s.suggestions && s.suggestions.length) {
        h += '<br><b style="color:#9ad8ff;">💡 优化建议</b>';
        s.suggestions.forEach(function (sg) {
            const col = sg.level === 'error' ? '#ff9c9c' : '#ffd479';
            h += '<div style="color:' + col + '; padding:2px 0; font-size:11px;">· [' + sg.phase + '] ' + sg.msg + '</div>';
        });
    }

    /* 调用树 */
    h += '<br><b style="color:#9ad8ff;">🌳 调用树（Top 深度 3）</b>';
    h += '<div style="font-family:monospace; font-size:10px; color:#a8b8c8; padding:4px; background:rgba(0,0,0,0.2); border-radius:4px; max-height:200px; overflow-y:auto;">';
    h += _renderTree(s.tree, 0);
    h += '</div>';

    /* 底部按钮 */
    h += '<br><div style="text-align:center; padding-top:8px; border-top:1px solid #2a3a5a; display:flex; gap:8px; justify-content:center;">';
    h += '<button id="djsc-profiler-export" style="background:#2a6; color:#fff; border:none; padding:5px 12px; border-radius:4px; cursor:pointer;">📥 导出报告</button>';
    h += '<button id="djsc-profiler-reset" style="background:#c33; color:#fff; border:none; padding:5px 12px; border-radius:4px; cursor:pointer;">🗑️ 重置统计</button>';
    h += '</div>';

    h += '</div>';
    return h;
}

/* 导出性能报告到文件 */
export function exportProfilerReport() {
    try {
        const s = profilerStats();
        const report = {
            exportedAt: new Date().toISOString(),
            phases: s.phases,
            retention: s.retention,
            tree: s.tree,
            memory: s.memory,
            suggestions: s.suggestions,
            history: profilerHistory(),
        };
        const json = JSON.stringify(report, null, 2);
        const filename = '性能报告_' + Date.now() + '.json';
        const how = writeData('output', filename, json, function (ok) {});
        alert(how === 'none' ? '❌ 导出失败：写盘与下载均不可用' : ('✅ 性能报告已导出\n路径：' + fileOf('output', filename)));
        return { ok: how !== 'none', via: how };
    } catch (e) {
        alert('❌ 导出失败：' + e.message);
        return { ok: false, err: e.message };
    }
}

function _renderTree(node, depth) {
    if (!node) return '';
    const pad = '　'.repeat(depth);
    let h = '';
    if (node.name !== 'root') {
        h += pad + '└ ' + node.name + ' (' + node.count + ' 次 / ' + node.total + 'ms)<br>';
    }
    if (depth < 3 && node.children && node.children.length) {
        node.children.slice(0, 6).forEach(function (c) {
            h += _renderTree(c, depth + 1);
        });
    }
    return h;
}

function _bind() {
    const btn1 = document.getElementById('djsc-profiler-export');
    if (btn1) btn1.addEventListener('click', exportProfilerReport);

    const btn2 = document.getElementById('djsc-profiler-reset');
    if (btn2) btn2.addEventListener('click', function () {
        if (confirm('重置性能统计？')) {
            profilerReset();
            const panels = document.querySelectorAll('.dialog.fullheight');
            if (panels.length) panels[panels.length - 1].remove();
            openProfilerPanel();
        }
    });
}
import { styleNativePanel } from '../../view/panel/panelTheme.js?v=5e5';
import { safeGet as _lsGet, lsLength as _lsLength, lsKey as _lsKey } from '../storage/storage.js?v=5e5';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */
