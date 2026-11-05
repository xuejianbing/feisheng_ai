/* 职责：导出中心界面、按钮与结果展示；数据打包与文件读写归 bootstrap/dataTransfer。 */
import {
    exportDistillPackage, exportFullTrainingPackage, exportFullBackup,
    importBackup, listExportedFiles, listImportableFiles,
    getTransferOverview, setDataTransferNotifications,
} from '../../bootstrap/dataTransfer.js';
import { DIRS } from '../../foundation/storage/storagePaths.js';
import { bufferClear } from '../../model/train/trainExport.js';
const OUTPUT_DIR = DIRS.output;
setDataTransferNotifications({ exportResult: _showExportResult, importResult: message => alert(message) });
/* 在面板里显示导出结果 */
function _showExportResult(title, path, detail) {
    const el = document.getElementById('djsc-export-result');
    if (!el) return;
    el.innerHTML = '<div style="background:#0f2a1e; border:1px solid #2a6; border-radius:6px; padding:10px; margin:10px 0;">' +
        '<div style="color:#7fe3a0; font-weight:bold; margin-bottom:4px;">' + title + '</div>' +
        '<div style="color:#a8b8c8; font-size:11px; word-break:break-all; margin-bottom:4px;">📁 ' + path + '</div>' +
        '<div style="color:#888; font-size:11px;">' + detail + '</div>' +
        '</div>';
    /* 自动刷新文件列表 */
    setTimeout(_refreshFileLists, 500);
}

/* ================= 面板 UI ================= */
export function openExportPanel() {
    const html = _buildPanelHtml();
    let dlg = null;
    try { dlg = ui.create.dialog('数据导出中心'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    if (!dlg) { _openOverlayPanel('数据导出中心', html); return; }
    try {
        dlg.classList.add('fullheight');
        dlg.style.width = 'min(92vw, 640px)';
        dlg.style.maxWidth = '92vw';
        dlg.style.left = '4vw';
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    const d = document.createElement('div');
    d.innerHTML = html;
    dlg.content.appendChild(d);
    styleNativePanel(dlg, '数据导出中心');
    setTimeout(_bindExportButtons, 50);
}

function _buildPanelHtml() {
    const { sampleN, weightReady, lsKeys } = getTransferOverview();

    let h = '<div style="font-size:12px; color:#dbe7f5; padding:10px; line-height:1.8;">';

    h += '<div style="background:rgba(154,216,255,0.08); border-radius:6px; padding:10px; margin-bottom:12px;">';
    h += '<div style="color:#9ad8ff; font-weight:bold; margin-bottom:6px;">📊 当前数据概览</div>';
    h += '<div>训练样本：<b style="color:#7fe3a0;">' + sampleN + '</b> 条</div>';
    h += '<div>模型权重：' + (weightReady ? '<b style="color:#7fe3a0;">已就绪</b>' : '<b style="color:#ff9c9c;">未就绪</b>') + '</div>';
    h += '<div>localStorage 键：' + lsKeys + ' 个</div>';
    h += '<div style="color:#888; font-size:11px; margin-top:4px;">导出路径：' + OUTPUT_DIR + '</div>';
    h += '</div>';

    /* 导出按钮 */
    h += '<div style="margin-bottom:12px;">';
    h += '<div style="color:#9ad8ff; font-weight:bold; margin-bottom:6px;">📦 导出到 data/output/</div>';

    /* 导出结果显示区 */
    h += '<div id="djsc-export-result" style="margin-bottom:8px;"></div>';

    /* 一键全量导出 */
    h += '<div style="background:#2a1e3e; border:1px solid #6a4a9a; border-radius:6px; padding:10px; margin-bottom:8px;">';
    h += '<div style="color:#c9aaff; font-weight:bold;">⚡ 一键全量导出</div>';
    h += '<div style="color:#a8b8c8; font-size:11px; margin:4px 0;">点一下自动导出全部 3 个包，无需其他操作</div>';
    h += '<div style="color:#888; font-size:10px; margin:2px 0;">保存到：' + OUTPUT_DIR + '</div>';
    h += '<button id="djsc-export-all" style="background:linear-gradient(135deg,#c9aaff,#6a4a9a); color:#fff; border:none; padding:8px 16px; border-radius:4px; cursor:pointer; margin-top:4px; font-weight:bold;">一键导出全部</button>';
    h += '</div>';

    h += '<div style="color:#888; font-size:11px; margin:8px 0; text-align:center;">—— 或单独导出 ——</div>';

    h += '<div style="background:#1e2a3e; border-radius:6px; padding:10px; margin-bottom:8px;">';
    h += '<div style="color:#7fe3a0; font-weight:bold;">① 最小蒸馏包</div>';
    h += '<div style="color:#a8b8c8; font-size:11px; margin:4px 0;">训练样本 + 特征清单 + 权重 → 直接喂给 Python 蒸馏</div>';
    h += '<div style="color:#888; font-size:10px; margin:2px 0;">保存到：' + OUTPUT_DIR + '蒸馏包_时间戳</div>';
    h += '<button id="djsc-export-distill" style="background:linear-gradient(135deg,#7fe3a0,#2a6); color:#fff; border:none; padding:6px 14px; border-radius:4px; cursor:pointer; margin-top:4px;">导出</button>';
    h += '</div>';

    h += '<div style="background:#1e2a3e; border-radius:6px; padding:10px; margin-bottom:8px;">';
    h += '<div style="color:#ffd479; font-weight:bold;">② 完整训练包</div>';
    h += '<div style="color:#a8b8c8; font-size:11px; margin:4px 0;">蒸馏包 + 元认知 + 校准器 + 多档案 + 战报</div>';
    h += '<div style="color:#888; font-size:10px; margin:2px 0;">保存到：' + OUTPUT_DIR + '完整训练包_时间戳</div>';
    h += '<button id="djsc-export-fulltrain" style="background:linear-gradient(135deg,#ffd479,#c58b22); color:#fff; border:none; padding:6px 14px; border-radius:4px; cursor:pointer; margin-top:4px;">导出</button>';
    h += '</div>';

    h += '<div style="background:#1e2a3e; border-radius:6px; padding:10px;">';
    h += '<div style="color:#9ad8ff; font-weight:bold;">③ 全量备份包</div>';
    h += '<div style="color:#a8b8c8; font-size:11px; margin:4px 0;">所有 localStorage 数据 → 一键还原到另一台设备</div>';
    h += '<div style="color:#888; font-size:10px; margin:2px 0;">保存到：' + OUTPUT_DIR + '全量备份_时间戳</div>';
    h += '<button id="djsc-export-backup" style="background:linear-gradient(135deg,#9ad8ff,#4a6a9a); color:#fff; border:none; padding:6px 14px; border-radius:4px; cursor:pointer; margin-top:4px;">导出</button>';
    h += '</div>';
    h += '</div>';

    /* 已导出文件列表 */
    h += '<div style="margin-bottom:12px;">';
    h += '<div style="color:#9ad8ff; font-weight:bold; margin-bottom:6px;">📁 已导出文件（data/output/）</div>';
    h += '<div id="djsc-exported-list" style="background:#1e2a3e; border-radius:6px; padding:10px; min-height:40px;">';
    h += '<div style="color:#888; font-size:11px;">加载中...</div>';
    h += '</div>';
    h += '</div>';

    /* 导入 */
    h += '<div style="margin-bottom:12px;">';
    h += '<div style="color:#9ad8ff; font-weight:bold; margin-bottom:6px;">📥 从 data/input/ 导入</div>';
    h += '<div style="background:#1e2a3e; border-radius:6px; padding:10px;">';
    h += '<div id="djsc-import-list" style="margin-bottom:8px;">';
    h += '<div style="color:#888; font-size:11px;">加载中...</div>';
    h += '</div>';
    h += '<div style="color:#888; font-size:11px; margin-top:4px;">把备份文件放到 extension/无名AI/data/input/ 目录下</div>';
    h += '</div>';
    h += '</div>';

    /* 清空 */
    h += '<div style="text-align:center; border-top:1px solid #2a3a5a; padding-top:10px;">';
    h += '<button id="djsc-export-clear" style="background:#666; color:#fff; border:none; padding:5px 12px; border-radius:4px; cursor:pointer; font-size:11px;">清空训练样本缓冲</button>';
    h += '</div>';

    h += '</div>';
    return h;
}

function _bindExportButtons() {
    /* 导出按钮 */
    const btn1 = document.getElementById('djsc-export-distill');
    if (btn1) btn1.addEventListener('click', exportDistillPackage);

    const btn2 = document.getElementById('djsc-export-fulltrain');
    if (btn2) btn2.addEventListener('click', exportFullTrainingPackage);

    const btn3 = document.getElementById('djsc-export-backup');
    if (btn3) btn3.addEventListener('click', exportFullBackup);

    /* 一键全量导出 */
    const btn0 = document.getElementById('djsc-export-all');
    if (btn0) btn0.addEventListener('click', function () {
        exportDistillPackage();
        setTimeout(exportFullTrainingPackage, 300);
        setTimeout(exportFullBackup, 600);
    });

    /* 清空 */
    const btn5 = document.getElementById('djsc-export-clear');
    if (btn5) btn5.addEventListener('click', function () {
        if (!confirm('确定清空训练样本缓冲？此操作不可恢复！')) return;
        bufferClear();
        alert('✅ 已清空');
        const panels = document.querySelectorAll('.dialog.fullheight');
        if (panels.length) panels[panels.length - 1].remove();
        openExportPanel();
    });

    /* 加载文件列表 */
    _refreshFileLists();
}

function _refreshFileLists() {
    /* 已导出 */
    listExportedFiles().then(function (files) {
        const el = document.getElementById('djsc-exported-list');
        if (!el) return;
        if (!files.length) { el.innerHTML = '<div style="color:#888; font-size:11px;">暂无文件</div>'; return; }
        let html = '';
        files.forEach(function (f) {
            html += '<div style="padding:4px 0; border-bottom:1px dashed #2a3a5a; font-size:11px;">';
            html += '<span style="color:#7fe3a0;">📄</span> ' + f;
            html += '</div>';
        });
        el.innerHTML = html;
    });

    /* 可导入 */
    listImportableFiles().then(function (files) {
        const el = document.getElementById('djsc-import-list');
        if (!el) return;
        if (!files.length) { el.innerHTML = '<div style="color:#888; font-size:11px;">暂无文件（把备份文件放到 input/ 目录）</div>'; return; }
        let html = '';
        files.forEach(function (f) {
            html += '<div style="padding:4px 0; border-bottom:1px dashed #2a3a5a;">';
            html += '<span style="color:#9ad8ff; margin-right:8px;">📄</span>' + f;
            html += '<button class="djsc-import-btn" data-file="' + f + '" style="background:#c58b22; color:#fff; border:none; padding:3px 10px; border-radius:3px; cursor:pointer; font-size:11px; float:right;">导入</button>';
            html += '</div>';
        });
        el.innerHTML = html;
        /* 绑定导入按钮 */
        el.querySelectorAll('.djsc-import-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const f = this.getAttribute('data-file');
                if (confirm('确定导入 ' + f + '？这会覆盖当前所有数据！')) {
                    importBackup(f);
                }
            });
        });
    });
}

/* 全屏遮罩降级 */
function _openOverlayPanel(title, html) {
    openUtilityHtml(title, html, 'djsc-export-panel');
    setTimeout(_bindExportButtons, 50);
}

/* ================= 挂载 ================= */
if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.export = {
        distill: exportDistillPackage,
        fullTrain: exportFullTrainingPackage,
        backup: exportFullBackup,
        import: importBackup,
        listExported: listExportedFiles,
        listImportable: listImportableFiles,
        panel: openExportPanel,
    };
    window.__DJSC.openExportPanel = openExportPanel;
}
import { styleNativePanel, openUtilityHtml } from '../panel/panelTheme.js';
