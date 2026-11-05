/*
 * ============================================
 * // 作者：飛昇原創
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 统一卡片式状态面板 =================
 * 把散落在 config.js 里的 alert 纯文本状态弹窗，统一升级为
 * replayPanel 同款「深色玻璃弹窗 + 顶部一排彩色数值卡片」。
 * 用法：
 *   openStateCardPanel('🧠 博弈策略状态', [
 *       { label: '总决策次数', value: 12, color: '#7fe3a0' },
 *   ], '<b>附加段落…</b>');
 */
import { openUtilityHtml } from '../panel/panelTheme.js';

function _esc(v) {
    try { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    catch (e) { return ''; }
}

/* 与 replayPanel._card 完全一致的卡片样式 */
function _card(label, value, color) {
    return '<div style="flex:1; min-width:64px; padding:6px; background:rgba(255,255,255,0.04); border-radius:6px; text-align:center;">' +
        '<div style="font-size:10px; color:#9ad8ff; margin-bottom:2px;">' + _esc(label) + '</div>' +
        '<div style="font-size:14px; font-weight:600; color:' + _esc(color) + ';">' + _esc(value) + '</div></div>';
}

export function openStateCardPanel(title, cards, extraHtml, buttons) {
    try {
        let h = '<div style="font-size:12px; color:#dbe7f5; padding:8px; line-height:1.7;">';
        h += '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">';
        (cards || []).forEach(function (c) {
            if (!c) return;
            h += _card(c.label, c.value, c.color || '#9ad8ff');
        });
        h += '</div>';
        if (extraHtml) h += extraHtml;
        if (buttons && buttons.length) {
            h += '<div style="display:flex; gap:8px; margin-top:12px; justify-content:flex-end;">';
            buttons.forEach(function (b) {
                h += '<button id="' + _esc(b.id) + '" style="background:' + _esc(b.color || '#3a7a5a') + '; color:#fff; border:none; padding:5px 12px; border-radius:4px; cursor:pointer; font-size:11px;">' + _esc(b.text) + '</button>';
            });
            h += '</div>';
        }
        h += '</div>';
        openUtilityHtml(title, h, 'djsc-state-cards-panel');
        if (buttons && typeof document !== 'undefined') {
            setTimeout(function () {
                buttons.forEach(function (b) {
                    try {
                        const el = document.getElementById(b.id);
                        if (el) el.onclick = b.onclick;
                    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                });
            }, 120);
        }
    } catch (e) {
        try { alert('面板渲染失败：' + e.message); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
    }
}

/* ★ 供 config.js 无 import 环境直接调用（挂到全局） */
if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.openStateCardPanel = openStateCardPanel;
}
