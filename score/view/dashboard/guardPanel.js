/* 职责：展示护栏状态并连接既有接口；判断和冷却只有 safety/modelGuard 一份状态。 */
import { guardCheck, applyGuardPenalty, isGuardCoolingDown, guardStatus, resetGuard, RED_LINES } from '../../decision/safety/modelGuard.js';
/* ================= 打开面板（卡片式） ================= */
export function openGuardPanel() {
    try {
        const s = guardStatus();

        /* 红线统计 */
        let h = '<b style="color:#ff9c9c;">【红线统计】</b><div style="color:#dbe7f5;">';
        const rules = Object.keys(s.byRule || {});
        if (rules.length === 0) {
            h += '暂无拦截记录';
        } else {
            h += rules.map(function (r) { return '· ' + r + '：' + s.byRule[r] + ' 次'; }).join('<br>');
        }
        h += '</div><br>';

        /* 冷却中 */
        h += '<b style="color:#ffd479;">【冷却中】</b><div style="color:#dbe7f5;">';
        const cooldowns = Object.keys(s.cooldowns || {});
        if (cooldowns.length === 0) {
            h += '暂无冷却';
        } else {
            h += cooldowns.map(function (k) {
                return '· ' + k + '：剩余 ' + s.cooldowns[k].remainMin + ' 分钟';
            }).join('<br>');
        }
        h += '</div><br>';

        /* 最近拦截 */
        h += '<b style="color:#9ad8ff;">【最近拦截】</b><div style="color:#dbe7f5;">';
        if (!s.recentBlocks || s.recentBlocks.length === 0) {
            h += '暂无记录';
        } else {
            h += s.recentBlocks.map(function (b, i) {
                return (i + 1) + '. ' + b.rule + '（' + b.player + ' → ' + b.action + '）' + '<div style="color:#a8b8c8; margin-left:14px;">' + b.reason + '</div>';
            }).join('<br>');
        }
        h += '</div><br>';

        /* 红线类型 */
        h += '<b style="color:#ffd479;">【红线类型】</b><div style="color:#a8b8c8; font-size:11px;">';
        h += Object.keys(RED_LINES).map(function (k) { return '· ' + k + ' = ' + RED_LINES[k]; }).join('<br>');
        h += '</div>';

        /* 卡片式面板（优先） */
        try {
            const sc = (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.openStateCardPanel);
            if (typeof sc === 'function') {
                sc('🛡️ 模型护栏', [
                    { label: '检查次数', value: s.checks, color: '#7fe3a0' },
                    { label: '拦截次数', value: s.blocks, color: s.blocks > 0 ? '#ff9c9c' : '#7fe3a0' },
                    { label: '拦截率', value: (s.blockRate * 100) + '%', color: s.blockRate > 0.2 ? '#ffd479' : '#9ad8ff' },
                ], h);
                return;
            }
        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

        /* 用无名杀原生面板打开（降级） */
        try {
            let content = '=== 模型护栏 ===\n\n检查次数：' + s.checks + '\n拦截次数：' + s.blocks + '\n拦截率：' + (s.blockRate * 100) + '%';
            if (typeof openSimplePanel === 'function') {
                openSimplePanel('🛡️ 模型护栏', content);
            } else {
                alert(content);
            }
        } catch (e) {
            alert(content);
        }
    } catch (e) {
        alert('打开模型护栏面板失败：' + e.message);
    }
}

/* ================= 挂载到全局 ================= */
export function mountModelGuardInterface() {
    if (typeof window === 'undefined') return;
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.modelGuard = {
        check: guardCheck,
        penalty: applyGuardPenalty,
        isCoolingDown: isGuardCoolingDown,
        status: guardStatus,
        reset: resetGuard,
        openPanel: openGuardPanel,
        RED_LINES: RED_LINES,
    };
}


mountModelGuardInterface();
