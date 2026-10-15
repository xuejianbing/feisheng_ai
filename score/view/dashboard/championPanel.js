/*
 * ============================================
 * // 作者：飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 冠军策略总览面板 =================
 * 一屏接入/展示所有冠军策略嵌入（决策点）：
 *   (英雄, 类型, 决策点id) → value(价值) / count(样本) / bestValue(峰值)。
 * 同类型最高价值即为该决策类型的"冠军"，冠军策略按 value 提权/替换规则选牌。
 * 打开方式：window.__DJSC.openChampionPanel()
 */
import { getChampions, stats as champStats, clear as champClear, championDiagnostics, reloadFromStorage } from '../../decision/strategy/championStrategy.js?v=41a';
import { bufferSize as sampleBufferSize } from '../../model/train/trainExport.js?v=41a';   /* ★ 面板诊断：显示样本缓冲数 */

/* ================= 全屏遮罩打开面板（和其它面板：brain/calibrator 一致） ================= */
function _openFullscreenPanel(title, html) {
    try {
        /* 关闭旧面板 */
        try {
            if (window.__DJSC_PANEL) {
                try { window.__DJSC_PANEL.remove(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                window.__DJSC_PANEL = null;
            }
        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

        const W = window.innerWidth;
        const H = window.innerHeight;

        const panel = document.createElement('div');
        panel.id = 'djsc-champ-panel';
        panel.style.cssText = [
            'position: fixed',
            'top: 0',
            'left: 0',
            'width: ' + W + 'px',
            'height: ' + H + 'px',
            'max-width: ' + W + 'px',
            'max-height: ' + H + 'px',
            'margin: 0',
            'padding: 0',
            'box-sizing: border-box',
            'z-index: 2147483647',
            'background: #0a1018',
            'overflow-y: auto',
            'overflow-x: hidden',
            '-webkit-overflow-scrolling: touch',
            'color: white',
            'font-size: 16px',
            'line-height: 1.8',
        ].join('; ') + ';';

        /* 标题栏 */
        const header = document.createElement('div');
        header.style.cssText = 'font-size: 20px; color: #FFD479; margin: 20px; text-align: center; font-weight: bold; padding: 10px; background: #14243c; border-radius: 8px;';
        header.textContent = title;
        panel.appendChild(header);

        /* 内容区 */
        const body = document.createElement('div');
        body.style.cssText = 'color: #dbe7f5; background: #14243c; border-radius: 12px; padding: 20px; margin: 10px 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);';
        body.id = 'djsc-champ-body';
        body.innerHTML = html;
        panel.appendChild(body);

        /* 关闭按钮 */
        const closeBtn = document.createElement('div');
        closeBtn.textContent = '✕ 关闭';
        closeBtn.style.cssText = [
            'position: fixed',
            'bottom: 20px',
            'right: 16px',
            'padding: 12px 20px',
            'background: #1E90FF',
            'color: white',
            'border-radius: 26px',
            'font-size: 15px',
            'cursor: pointer',
            'box-shadow: 0 4px 12px rgba(0,0,0,0.6)',
            'z-index: 2147483646',
        ].join('; ') + ';';
        closeBtn.addEventListener('click', function () {
            try { panel.remove(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
            window.__DJSC_PANEL = null;
        });
        panel.appendChild(closeBtn);

        document.body.appendChild(panel);
        window.__DJSC_PANEL = panel;

        /* 绑定搜索 / 清空按钮 */
        setTimeout(function () {
            try {
                const input = document.getElementById('djsc-champ-search');
                if (input) input.addEventListener('input', function () {
                    const q = String(input.value || '').trim().toLowerCase();
                    const body = document.getElementById('djsc-champ-body');
                    if (body) body.innerHTML = _renderChampions(q);
                });
                const clearBtn = document.getElementById('djsc-champ-clear');
                if (clearBtn) clearBtn.addEventListener('click', function () {
                    if (confirm('清空所有冠军策略嵌入？(可从训练样本重算/回流)')) {
                        champClear();
                        alert('已清空冠军策略，可通过训练或 __DJSC.champion.recompute() 重新固化');
                        const q = document.getElementById('djsc-champ-search');
                        const body = document.getElementById('djsc-champ-body');
                        if (body) body.innerHTML = _renderChampions(q ? String(q.value).trim() : '');
                    }
                });
            } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        }, 50);
    } catch (e) {
        alert('打开面板失败：' + e.message);
    }
}

export function openChampionPanel() {
    try {
        /* ★ 打开前强制从 localStorage 重读内存 STORE，消除时序导致的"有数据却显示0" */
        try { reloadFromStorage(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        /* ★ 打开即固化：冠军库为空但样本缓冲非空时，自动重算一次冠军嵌入（不必等局末/训练）。
         *   配合引擎局末滚动刷新，保证任何时候打开面板都能看到当前样本能固化的最优决策点。 */
        try {
            const _st0 = champStats() || {};
            if (!(_st0.decisions > 0) && sampleBufferSize() > 0 &&
                typeof window !== 'undefined' && window.__DJSC && window.__DJSC.champion &&
                typeof window.__DJSC.champion.recompute === 'function') {
                window.__DJSC.champion.recompute();
                try { reloadFromStorage(); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
            }
        } catch (eR) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eR); }
        const html = _renderChampions('');
        _openFullscreenPanel('🏆 冠军策略总览', html);
    } catch (e) {
        alert('冠军面板异常：' + e.message);
    }
}

/* ================= 汇总卡片 ================= */
function _card(label, val, color) {
    return '<div style="flex:1; min-width:96px; background:rgba(255,255,255,0.05); border-radius:8px; padding:10px 12px; text-align:center;">' +
        '<div style="font-size:11px; color:#a8b8c8;">' + label + '</div>' +
        '<div style="font-size:22px; font-weight:bold; color:' + (color || '#fff') + ';">' + val + '</div>' +
        '</div>';
}

/* ================= 渲染所有冠军 ================= */
function _renderChampions(query) {
    try {
        const st = champStats() || {};
        const eb = {...getChampions()};
        const diagnostics=championDiagnostics();
        for(const [key,rows] of Object.entries(diagnostics.legacyEmbeds||{}))eb[key+' [旧记录]']=rows.map(r=>({...r,legacy:true}));
        const keys = Object.keys(eb);

        /* 按"组内最高价值"排序，冠军优先展示 */
        const groups = [];
        for (let i = 0; i < keys.length; i++) {
            const rows = (eb[keys[i]] || []);
            if (!rows.length) continue;
            const sep = keys[i].indexOf('|');
            const hero = (sep >= 0) ? keys[i].slice(0, sep) : '(无英雄/通用)';
            const type = (sep >= 0) ? keys[i].slice(sep + 1) : keys[i];
            /* 类型/英雄可读化 */
            const typeLabel = { skill: '技能', card: '卡牌', equip: '装备', end: '结算' }[type] || type;
            const sorted = rows.slice().sort(function (a, b) { return (b.value || 0) - (a.value || 0); });
            groups.push({ hero: hero, type: type, typeLabel: typeLabel, rows: sorted, top: sorted[0].value || 0 });
        }
        groups.sort(function (a, b) { return b.top - a.top; });

        /* 搜索过滤 */
        let total = 0, shown = 0;
        const q = String(query || '').toLowerCase();

        let h = '<div style="font-size:12px; color:#dbe7f5; padding:4px 0 14px; line-height:1.7;">';

        h += '<p>当前：旁路核对。经验估计暂不改变实际选择；旧记录只供查看。</p>';
        h += '<p>有效事务 '+(diagnostics.audit?.accepted||0)+' 条；重复 '+(diagnostics.audit?.duplicates||0)+' 条；冲突 '+(diagnostics.audit?.conflicts||0)+' 条。统计最多保留最近 2048 条有效事务。</p>';
        /* 汇总卡 */
        h += '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">';
        h += _card('决策类型', st.types || 0, '#ffd479');
        h += _card('嵌入条', st.decisions || 0, '#7fe3a0');
        h += _card('含特征', st.embs || 0, '#9ad8ff');
        h += _card('英雄数', st.heroCount || 0, '#ff9c9c');
        h += '</div>';

        /* 搜索 + 操作区 */
        h += '<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:10px;">';
        h += '<input id="djsc-champ-search" placeholder="🔍 搜英雄 / 决策点 / 类型 / 价值" style="flex:1; min-width:200px; padding:8px 10px; background:#0a1018; color:#dbe7f5; border:1px solid #2a3c52; border-radius:8px; font-size:13px;">';
        h += '<span style="font-size:11px; color:#a8b8c8;">' + groups.length + ' 组 · ' + (st.decisions || 0) + ' 条</span>';
        h += '</div>';

        if (!groups.length) {
            const _buf = (typeof sampleBufferSize === 'function') ? sampleBufferSize() : 0;
            h += '<div style="padding:30px; text-align:center; color:#a8b8c8;">暂无冠军数据。';
            if (_buf > 0) {
                h += '<br><br>样本缓冲已有 <b style="color:#7fe3a0;">' + _buf + '</b> 条（打开面板时已自动尝试固化）。';
                h += '<br>同一决策点需累计 ≥5 条样本且最高价值 &gt;0 才会固化为冠军点，';
                h += '<br>多打几局（局末自动回填价值并刷新）即可逐步出现。';
            } else {
                h += '<br><br>样本缓冲 <b style="color:#ff9c9c;">0</b> 条：本会话尚未记录到决策样本。';
                h += '<br>打完至少一局（局末自动回填价值并固化冠军）后再打开本面板。';
            }
            h += '</div>';
            h += '</div>';
            return h;
        }

        for (let gi = 0; gi < groups.length; gi++) {
            const g = groups[gi];
            /* 搜索：英雄/类型/任一行id/value 命中才显示整组 */
            let matched = '';
            if (q) {
                const inHead = (String(g.hero).toLowerCase().indexOf(q) >= 0) || (String(g.typeLabel).toLowerCase().indexOf(q) >= 0);
                let inRow = false;
                for (let r = 0; r < g.rows.length; r++) {
                    if (String(g.rows[r].id).toLowerCase().indexOf(q) >= 0 || String(g.rows[r].value || '').indexOf(q) >= 0) { inRow = true; break; }
                }
                if (!inHead && !inRow) continue;
            }
            shown++;

            h += '<div style="border-bottom:1px solid #24364a; padding:6px 0;">';
            /* 组头 */
            h += '<div style="font-weight:bold; font-size:13px; color:#FFD479; margin:10px 0 2px;">';
            h += '👑 冠军·' + g.typeLabel + '&nbsp; <span style="color:#7fe3a0; font-weight:normal">' + (g.hero || '') + '</span>';
            h += '<span style="float:right; font-size:11px; color:#a8b8c8; font-weight:normal;">' + g.rows.length + ' 条</span>';
            h += '</div>';

            /* 行 */
            for (let r = 0; r < g.rows.length; r++) {
                const row = g.rows[r];
                const val = (typeof row.value === 'number') ? row.value : 0;
                /* 价值在 (0,1]：value 1 撑满，低价值也保底可见 */
                const barW = Math.min(100, Math.max(4, Math.round(Math.abs(val) * 100)));
                const barColor = val >= 0 ? '#7fe3a0' : '#ff9c9c';
                const isChamp = (r === 0);   /* 组内价值最高 = 该类型冠军 */
                h += '<div style="display:flex; align-items:center; gap:8px; margin:3px 0; font-size:12px;' + (isChamp ? ' background:rgba(127,227,160,0.10);' : '') + '">';
                h += '<div style="width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#dbe7f5;" title="' + row.id + '">' + (isChamp ? '🏆 ' : '· ') + row.id + '</div>';
                /* 价值条 */
                h += '<div style="flex:1; height:10px; background:rgba(255,255,255,0.05); border-radius:3px; overflow:hidden;">';
                h += '<div style="height:100%; width:' + barW + '%; background:' + barColor + ';"></div>';
                h += '</div>';
                h += '<div style="width:52px; text-align:right; color:' + barColor + ';">' + val.toFixed(2) + '</div>';
                h += '<div style="width:64px; text-align:right; color:#a8b8c8; font-size:11px;">样本 ' + (row.count || 0) + '</div>';
                h += '</div>';
                const why={'insufficient-samples':'样本不足 5 条','insufficient-sessions':'来源不足 3 局','nonpositive-conservative-value':'保守价值非正'};
                h += '<div style="font-size:11px;color:#a8b8c8;padding:0 8px 8px;">'+(row.legacy?'旧最高值记录：缺少原始证据，不参与选择':('来源 '+row.sessionCount+' 局 · 平均 '+row.mean.toFixed(2)+' · 保守价值 '+val.toFixed(2)+' · 最佳案例 '+row.bestValue.toFixed(2)+' · '+(row.eligible?'满足统计门槛，仍需场景匹配（旁路）':why[row.reason]||'待核对')))+'</div>';
            }
            h += '</div>';
        }

        /* 底部提示 */
        h += '<div style="margin-top:14px; padding:8px 12px; background:#0a1018; border-radius:8px; font-size:11px; color:#a8b8c8;">' +
             '💡 排序依据保守经验价值；最佳案例仅供复盘。有效样本表示记录可核对，不表示动作正确。当前仅记录拟加分和拟改选。' +
             (shown >= 200 ? '<br>⚠ 分组较多，已按价值降序列出，可用搜索框过滤。' : '') +
             '</div>';

        h += '</div>';
        return h;
    } catch (e) {
        return '<div style="color:#ff9c9c; padding:20px;">渲染冠军面板异常：' + String(e) + '</div>';
    }
}

/* 挂到全局，供其它面板/控制台调用 */
if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.openChampionPanel = openChampionPanel;
}