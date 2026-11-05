/*
 * ============================================
 * // Auteur: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 决策回放面板 =================
 * 全屏遮罩版（和 openSimplePanel / calibratorPanel 一致）
 */
import { replayListGames, replayGetGame, replayStats, replayReset, replayExportJson, replayGetCurrentBuffer } from '../../perception/replay/decisionReplay.js';
import { lib } from '../../foundation/adapt/host.js';

let _filterIntervention = 'all';
// Autor: Feisheng Original | Lizenz: GPL-3.0
let _selectedGame = -1;

function _donutChart(segments, opts) {
    opts = opts || {};
    const size = opts.size || 120;
    const thickness = opts.thickness || 16;
    const total = segments.reduce(function (s, x) { return s + Math.max(0, x.value); }, 0);
    if (total <= 0) return '<div style="font-size:10px; color:#888;">无数据</div>';

    const r = size / 2 - thickness / 2;
    const cx = size / 2, cy = size / 2;
    let angle = -Math.PI / 2;

    let svg = '<svg width="' + size + '" height="' + size + '">';
    segments.forEach(function (seg) {
        const frac = Math.max(0, seg.value) / total;
        if (frac <= 0) return;
        const a2 = angle + frac * Math.PI * 2;
        const large = (a2 - angle) > Math.PI ? 1 : 0;
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        const x2 = cx + r * Math.cos(a2);
        const y2 = cy + r * Math.sin(a2);
        svg += '<path d="M ' + x1 + ' ' + y1 + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2 +
               '" fill="none" stroke="' + seg.color + '" stroke-width="' + thickness + '"/>';
        angle = a2;
    });
    svg += '</svg>';
    return svg;
}

function _openFullscreenPanel(title, html) {
    openUtilityHtml(title, html, 'djsc-replay-panel');
    _bind();
}

export function openReplayPanel(gameIdx) {
    try {
        if (gameIdx !== undefined && gameIdx !== null) _selectedGame = gameIdx;
        const html = _buildHtml();
        _openFullscreenPanel('🎬 决策回放时间轴', html);
    } catch (e) {
        alert('回放面板异常：' + e.message);
    }
}

function _buildHtml() {
    const stats = replayStats();
    const games = replayListGames();

    let h = '<div style="font-size:12px; color:#dbe7f5; padding:8px; line-height:1.7;">';

    h += '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">';
    h += _card('归档局数', stats.games, '#9ad8ff');
    h += _card('决策总数', stats.decisions + stats.currentDecisions, '#7fe3a0');
    h += _card('本局决策', stats.currentDecisions, '#ffd479');
    h += _card('护栏拦截', stats.blocked + stats.currentBlocked, '#ff9c9c');
    h += _card('认知冲突', stats.conflicts + stats.currentConflicts, '#ffd479');
    h += _card('总线仲裁', stats.busArbitrations + stats.currentBus, '#a8b8c8');
    h += '</div>';

    if (stats.decisions > 0) {
        h += '<b style="color:#9ad8ff;">干预分布</b><br>';
        h += '<div style="display:flex; justify-content:center;">';
        h += _donutChart([
            { label: '模型', value: stats.byIntervention.model || 0, color: '#7fe3a0' },
            { label: '混合', value: stats.byIntervention.blend || 0, color: '#ffd479' },
            { label: '规则', value: stats.byIntervention.rule || 0, color: '#ff9c9c' },
            { label: '跳过', value: stats.byIntervention.skip || 0, color: '#888' },
        ], { size: 120, thickness: 16 });
        h += '</div>';
    }

    h += '<br><b style="color:#9ad8ff;">归档对局（点击回放）</b><br>';
    if (!games.length) {
        h += '<div style="color:#888; padding:8px;">暂无归档。跑一局后自动生成。</div>';
    } else {
        h += '<table style="width:100%; font-size:11px; border-collapse:collapse;">';
        h += '<tr style="background:#2a3a5a; color:#9ad8ff;">';
        h += '<th style="padding:4px;">时间</th><th>模式</th><th>身份</th><th>决策</th><th>结果</th></tr>';
        games.slice(0, 12).forEach(function (g) {
            const t = new Date(g.ts);
            const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
            const tstr = pad(t.getMonth() + 1) + '/' + pad(t.getDate()) + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes());
            const col = g.verdict === 'win' ? '#7fe3a0' : (g.verdict === 'lose' ? '#ff9c9c' : '#888');
            const sel = (g.idx === _selectedGame) ? 'background:rgba(127,227,160,0.1);' : '';
            h += '<tr style="border-bottom:1px solid #2a3a5a; ' + sel + ' cursor:pointer;" class="djsc-replay-game" data-idx="' + g.idx + '">';
            h += '<td style="padding:4px;">' + tstr + '</td>';
            h += '<td style="text-align:center;">' + g.mode + '</td>';
            h += '<td style="text-align:center;">' + (g.identity || '-') + '</td>';
            h += '<td style="text-align:center;">' + g.decisions + '</td>';
            h += '<td style="text-align:center; color:' + col + ';">' + (g.myScore || 0) + '</td>';
            h += '</tr>';
        });
        h += '</table>';
    }

    /* ★ 本局进行中：实时展示当前缓冲的决策（游戏中打开面板不再空） */
    if (stats.currentDecisions > 0) {
        const cur = replayGetCurrentBuffer();
        h += '<br><b style="color:#ffd479;">⚡ 本局进行中（' + cur.length + ' 条决策）</b><br>';
        h += '<div style="max-height:240px; overflow-y:auto; background:rgba(0,0,0,0.15); border-radius:4px; padding:6px;">';
        cur.forEach(function (d, i) {
            h += _renderDecision(d, i);
        });
        h += '</div>';
    }

    if (_selectedGame >= 0) {
        const g = replayGetGame(_selectedGame);
        if (g) {
            h += '<br><b style="color:#9ad8ff;">对局 #' + _selectedGame + ' 时间轴</b>';
            h += '<div style="font-size:10px; color:#888; margin-bottom:4px;">';
            h += '模式 ' + (g.meta.mode || '?') + ' | 玩家 ' + (g.meta.meKey || '?') +
                 ' | 身份 ' + (g.meta.myIdentity || '-') + ' | ' + g.decisions.length + ' 条决策';
            h += '</div>';

            h += '<div style="margin-bottom:6px;">';
            h += '<select id="djsc-replay-filter" style="font-size:11px; padding:2px; background:#2a3a5a; color:#fff; border:1px solid #4a6a9a; border-radius:3px;">';
            ['all', 'model', 'blend', 'rule', 'skip'].forEach(function (k) {
                const sel = (k === _filterIntervention) ? ' selected' : '';
                h += '<option value="' + k + '"' + sel + '>' + (k === 'all' ? '全部干预' : k) + '</option>';
            });
            h += '</select>';
            h += '</div>';

            h += '<div style="max-height:340px; overflow-y:auto; background:rgba(0,0,0,0.15); border-radius:4px; padding:6px;">';
            let shown = 0;
            g.decisions.forEach(function (d, i) {
                if (_filterIntervention !== 'all' && d.intervention !== _filterIntervention) return;
                shown++;
                h += _renderDecision(d, i);
            });
            if (!shown) h += '<div style="color:#888; text-align:center; padding:12px;">该筛选条件下无记录</div>';
            h += '</div>';
        }
    }

    h += '<br><div style="text-align:center; margin-top:10px; padding-top:8px; border-top:1px solid #2a3a5a;">';
    h += '<button id="djsc-replay-export" style="background:#2a6; color:#fff; border:none; padding:5px 12px; border-radius:4px; cursor:pointer; margin-right:6px;">📥 导出 JSON</button>';
    h += '<button id="djsc-replay-reset" style="background:#c33; color:#fff; border:none; padding:5px 12px; border-radius:4px; cursor:pointer;">🗑️ 清空回放</button>';
    h += '</div>';

    h += '</div>';
    return h;
}

function _esc(x) {
    return String(x == null ? '' : x)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _displayName(id) {
    try { return (lib.translate && lib.translate[id]) || id || '?'; } catch (e) { return id || '?'; }
}

function _targetText(target) {
    if (Array.isArray(target)) return target.join('、');
    return target || '';
}

function _actionText(a) {
    if (!a) return '未知动作';
    const name = _displayName(a.id);
    const target = _targetText(a.target);
    let verb = '执行';
    if (a.type === 'card') verb = '使用';
    else if (a.type === 'skill') verb = '发动技能';
    else if (a.type === 'equip') verb = '装备';
    else if (a.type === 'end') return '结束回合';
    return verb + '【' + name + '】' + (target ? ' → ' + target : '');
}

function _plainReason(reason) {
    if (!reason) return '';
    let r = String(reason);
    /* “冠军/深度思考”等改判过程单独展示，主原因只保留动作本身的判断。 */
    r = r.split('｜冠军:')[0].split('｜深度思考:')[0].split('｜总线：')[0];
    r = r.replace(/\[M:[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
    return r;
}

function _decisionPath(d) {
    const reason = String((d.final && d.final.reason) || (d.bus && d.bus.reason) || '');
    const steps = [];
    if (/^规划：|残局解/.test(reason)) steps.push('规划器调整了原始排序');
    if (reason.indexOf('｜冠军:') >= 0) steps.push('冠军经验对候选进行了提权/改判');
    if (reason.indexOf('｜深度思考:') >= 0) steps.push('深度思考重新比较后改判');
    if (d.guard && d.guard.blocked) steps.push('安全护栏拦截了原动作');
    return steps;
}

function _labelText(x) {
    const map = { A:'空·待机', B:'普通牌', C:'防御·恢复·结束', D:'进攻·控制', E:'装备', F:'技能' };
    return map[x] || x || '?';
}

function _priorityText(policy) {
    if (!policy) return '普通';
    if (policy.veto || policy.eligible === false) return '已否决';
    if (policy.priorityTier === 'forced') return '强制';
    if (policy.priorityTier === 'critical') return '高';
    return '普通';
}

function _renderDecision(d, idx) {
    const iv = d.intervention || 'none';
    const ivColor = iv === 'model' ? '#7fe3a0' : (iv === 'blend' ? '#ffd479' : (iv === 'rule' ? '#ff9c9c' : '#888'));

    let h = '<div style="border-bottom:1px solid #2a3a5a; padding:7px 0; font-size:11px;">';
    h += '<div style="color:' + ivColor + '; font-weight:bold;">';
    h += '#' + (idx + 1) + ' R' + _esc(d.round) + ' ' + _esc(d.player);
    h += '</div>';

    if (d.final) {
        h += '<div style="padding-left:10px; color:#dbe7f5; margin-top:3px;">';
        h += '▶ 最终选择：' + _esc(_actionText(d.final));
        h += '</div>';
        h += '<div style="padding-left:10px; color:#9fb5c8; margin-top:2px;">';
        h += '真实收益评分：' + _esc(d.final.score) +
             '　策略优先级：' + _esc(_priorityText(d.final.policy));
        if (d.final.policy && d.final.policy.priorityReason) {
            h += '（' + _esc(d.final.policy.priorityReason) + '）';
        }
        h += '</div>';

        const why = _plainReason(d.final.reason || (d.bus && d.bus.reason) || '');
        if (why) {
            h += '<div style="padding-left:10px; color:#a8c7df; margin-top:2px;">';
            h += '原因：' + _esc(why);
            h += '</div>';
        }
    }

    const path = _decisionPath(d);
    if (path.length) {
        h += '<div style="padding-left:10px; color:#b9d59d; margin-top:2px;">';
        h += '调整过程：' + _esc(path.join(' → '));
        h += '</div>';
    }

    if (d.conflict && d.conflict.detected) {
        h += '<div style="padding-left:10px; color:#ffd479; margin-top:2px;">';
        h += '模型意见与规则方向不同：规则=' + _esc(_labelText(d.conflict.ruleLabel)) +
             '，模型=' + _esc(_labelText(d.conflict.modelLabel)) +
             '。这只是分歧提示，最终执行以上方“最终选择”为准。';
        h += '</div>';
    }

    if (d.guard && d.guard.blocked) {
        h += '<div style="padding-left:10px; color:#ff9c9c; margin-top:2px;">';
        h += '安全护栏：原动作被拦截' + (d.guard.reason ? '，原因：' + _esc(d.guard.reason) : '');
        h += '</div>';
    }

    if (d.outcome) {
        h += '<div style="padding-left:10px; color:#888; font-size:10px; margin-top:2px;">';
        h += '执行后：HP ' + _esc(d.outcome.meHp) + ' | 手牌 ' + _esc(d.outcome.meHand) +
             ' | 局面变化 ' + _esc(d.outcome.scoreDelta);
        h += '</div>';
    }

    h += '</div>';
    return h;
}

function _card(label, val, color) {
    return '<div style="flex:1; min-width:64px; padding:6px; background:rgba(255,255,255,0.04); border-radius:6px; text-align:center;">' +
        '<div style="font-size:10px; color:#9ad8ff; margin-bottom:2px;">' + label + '</div>' +
        '<div style="font-size:14px; font-weight:600; color:' + color + ';">' + val + '</div></div>';
}

function _bind() {
    try {
        document.querySelectorAll('.djsc-replay-game').forEach(function (tr) {
            tr.addEventListener('click', function () {
                const idx = parseInt(this.dataset.idx, 10);
                _selectedGame = idx;
                _refreshPanel();
            });
        });

        const sel = document.getElementById('djsc-replay-filter');
        if (sel) {
            sel.addEventListener('change', function () {
                _filterIntervention = this.value;
                _refreshPanel();
            });
        }

        const exp = document.getElementById('djsc-replay-export');
        if (exp) exp.addEventListener('click', function () {
            try {
                const json = replayExportJson();
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = '无名AI_决策回放_' + Date.now() + '.json';
                a.click();
                URL.revokeObjectURL(url);
            } catch (e) { alert('导出失败：' + e.message); }
        });

        const rst = document.getElementById('djsc-replay-reset');
        if (rst) rst.addEventListener('click', function () {
            if (!confirm('清空所有决策回放记录？')) return;
            replayReset();
            _selectedGame = -1;
            _refreshPanel();
        });
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

function _refreshPanel() {
    try {
        if (window.__DJSC_PANEL) {
            try { window.__DJSC_PANEL.remove(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
            window.__DJSC_PANEL = null;
        }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    openReplayPanel(_selectedGame);
}

if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.openReplayPanel = openReplayPanel;
}
import { openUtilityHtml } from '../panel/panelTheme.js';
