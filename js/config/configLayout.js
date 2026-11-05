/*
 * 无名AI设置中心
 * 仅负责展示层分组与交互；沿用既有配置键、保存方式与功能回调。
 * 玩家设置与开发者设置使用同一底层配置，避免重复状态与“死开关”。
 */

import { CONFIG_SECTIONS, configDefault, configMeta, hiddenConfigKeys } from './configSchema.js';

const QQ_GROUP = String(configDefault('qqGroup', ''));
const FEEDBACK_URL = 'https://wj.qq.com/s2/28087292/uhbn/';

export function arrangeConfig(source, lib, game) {

    const hidden = new Set(hiddenConfigKeys());

    const text = html => String(html || '').replace(/<[^>]*>/g, '').replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').replace(/^\s*打开\s*[·・]?\s*/, '').trim();
    const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const currentMode = lib.config.extension_无名AI_settings_mode === 'developer' ? 'developer' : 'player';

    function applyMode(mode) {
        const safeMode = mode === 'developer' ? 'developer' : 'player';
        try { game.saveConfig('extension_无名AI_settings_mode', safeMode); } catch (_) {}
        const apply = function () {
            if (!document || !document.body) return;
            document.body.dataset.djscSettingsMode = safeMode;
            document.querySelectorAll('.djsc-mode-choice').forEach(function (node) {
                node.dataset.active = node.dataset.mode === safeMode ? 'true' : 'false';
            });
        };
        try { apply(); } catch (_) {}
        try { setTimeout(apply, 0); } catch (_) {}
    }

    try {
        if (typeof document !== 'undefined' && document.body) document.body.dataset.djscSettingsMode = currentMode;
        else setTimeout(function () {
            if (typeof document !== 'undefined' && document.body) document.body.dataset.djscSettingsMode = currentMode;
        }, 0);
    } catch (_) {}

    function copyGroupNumber(button) {
        const finish = function (copied) {
            if (!button) return;
            button.textContent = copied ? '已复制' : '请手动复制';
            button.classList.add('djsc-copy-result');
            setTimeout(function () {
                button.textContent = '复制';
                button.classList.remove('djsc-copy-result');
            }, 1800);
        };
        (async function () {
            let copied = false;
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(QQ_GROUP);
                    copied = true;
                }
            } catch (_) {}
            if (!copied) {
                const input = document.createElement('textarea');
                const previousFocus = document.activeElement;
                input.value = QQ_GROUP;
                input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
                document.body.appendChild(input);
                try {
                    input.focus();
                    input.select();
                    copied = document.execCommand('copy');
                } catch (_) {}
                finally {
                    input.remove();
                    if (previousFocus && previousFocus.focus) previousFocus.focus();
                }
            }
            finish(copied);
        })();
    }

    const result = {};

    const headerText = text(source.djscBd && source.djscBd.name ? source.djscBd.name : '无名AI');
    const versionText = (headerText.match(/v\s*([^\s]+)/i) || [null, ''])[1];
    result.settingsHeader = {
        clear: true,
        nopointer: true,
        name: '<div class="djsc-settings-header"><b>无名AI</b><span>' + (versionText ? 'v' + escape(versionText) : '设置中心') + '</span><small>决策 · 策略 · 学习 · 诊断</small></div>',
        onclick: function () { return false; },
    };

    result.settingsModePlayer = {
        clear: true,
        name: '<span class="djsc-mode-choice" data-mode="player" data-active="' + (currentMode === 'player') + '"><b>玩家选项</b><small>游戏体验与常用功能</small></span>',
        onclick: function () { applyMode('player'); return false; },
    };
    result.settingsModeDeveloper = {
        clear: true,
        name: '<span class="djsc-mode-choice" data-mode="developer" data-active="' + (currentMode === 'developer') + '"><b>开发者选项</b><small>测试、诊断与模型工具</small></span>',
        onclick: function () { applyMode('developer'); return false; },
    };

    result.aboutTeam = {
        clear: true,
        nopointer: true,
        name:
            '<div class="djsc-team-card">' +
                '<div class="djsc-team-title">无名AI开发团队</div>' +
                '<div class="djsc-team-grid">' +
                    '<span>原作者 / 核心开发</span><strong>飞升</strong>' +
                    '<span>当前维护 / 后续开发</span><strong>微雀qiao（WeiqiaoCode）</strong>' +
                    '<span>内测与宣传</span><strong>小小王同志</strong>' +
                '</div>' +
                '<div class="djsc-team-qq"><span>反馈与交流QQ群</span><strong>' + QQ_GROUP + '</strong></div>' +
            '</div>',
        onclick: function () { return false; },
    };
    result.copyQQGroup = {
        clear: true,
        name: '<span class="djsc-setting-action-row djsc-about-copy"><span class="djsc-setting-name">QQ群：<span class="djsc-feedback-number">' + QQ_GROUP + '</span></span><button type="button" class="djsc-setting-action">复制</button></span>',
        onclick: function () {
            copyGroupNumber(this.querySelector('.djsc-setting-action'));
            return false;
        },
    };

    result.feedbackSurvey = {
        clear: true,
        name: '<span class="djsc-setting-action-row djsc-about-feedback"><span class="djsc-setting-name">问题反馈问卷<div class="djsc-setting-desc">提交Bug、异常行为、测试结果与改进建议。</div></span><button type="button" class="djsc-setting-action">填写</button></span>',
        onclick: function () {
            try {
                const opened = window.open(FEEDBACK_URL, '_blank', 'noopener,noreferrer');
                if (!opened && window.location) window.location.href = FEEDBACK_URL;
            } catch (_) {
                try { window.location.href = FEEDBACK_URL; } catch (_) {}
            }
            return false;
        },
    };

    const assigned = new Set();

    function optionAction(key, meta) {
        if (meta && meta.actionLabel) return meta.actionLabel;
        if (/clear/i.test(key)) return '清空';
        if (/import/i.test(key)) return '导入';
        if (/export/i.test(key)) return '导出';
        return '查看';
    }

    for (const group of CONFIG_SECTIONS) {
        const storageKey = 'extension_无名AI_settings_group_' + group.id;
        const defaultOpen = !!group.defaultOpen;
        const expanded = lib.config[storageKey] === undefined ? defaultOpen : !!lib.config[storageKey];

        result['group_' + group.id] = {
            clear: true,
            name: '<div class="djsc-settings-group" data-scope="' + group.scope + '" data-group="' + group.id + '" data-open="' + expanded + '" data-accent="' + group.accent + '"><span>' + group.title + '</span><span class="djsc-settings-arrow">' + (expanded ? '▼' : '▶') + '</span></div>',
            onclick: function () {
                const header = this.querySelector('.djsc-settings-group');
                const open = header.dataset.open !== 'true';
                header.dataset.open = String(open);
                header.querySelector('.djsc-settings-arrow').textContent = open ? '▼' : '▶';
                game.saveConfig(storageKey, open);
                return false;
            },
        };

        let pseudoIndex = 0;
        for (const entry of group.entries || []) {
            if (entry && typeof entry === 'object' && entry.kind === 'subsection') {
                result['sub_' + group.id + '_' + (++pseudoIndex)] = {
                    clear: true,
                    nopointer: true,
                    name: '<div class="djsc-setting-subsection" data-scope="' + group.scope + '" data-group="' + group.id + '"><b>' + escape(entry.title || '') + '</b>' + (entry.description ? '<small>' + escape(entry.description) + '</small>' : '') + '</div>',
                    onclick: function () { return false; },
                };
                continue;
            }
            if (entry && typeof entry === 'object' && entry.kind === 'status') {
                result['status_' + group.id + '_' + (++pseudoIndex)] = {
                    clear: true,
                    nopointer: true,
                    name: '<div class="djsc-protected-status" data-scope="' + group.scope + '" data-group="' + group.id + '"><span>🔒 ' + escape(entry.title || '') + '</span><strong>已启用</strong>' + (entry.description ? '<small>' + escape(entry.description) + '</small>' : '') + '</div>',
                    onclick: function () { return false; },
                };
                continue;
            }

            const key = entry;
            if (typeof key !== 'string') continue;
            assigned.add(key);
            if (!source[key] || hidden.has(key)) continue;

            const meta = configMeta(key) || {};
            const option = { ...source[key] };
            const fullName = text(option.name);
            const label = meta.label || (key === 'importTrainingData' ? '导入AI学习数据' : fullName.replace(/[（(].*$/s, '').trim());
            const desc = meta.description || option.intro || '';
            option.intro = desc || fullName;
            const descHtml = desc ? '<div class="djsc-setting-desc">' + escape(desc) + '</div>' : '';
            const name = '<span class="djsc-setting-name" data-scope="' + group.scope + '" data-group="' + group.id + '">' + escape(label) + descHtml + '</span>';

            if (meta.type === 'action' || String(option.name || '').includes('djsc-menu-config-btn')) {
                option.clear = true;
                const danger = meta.dangerous ? ' data-dangerous="true"' : '';
                option.name = '<span class="djsc-setting-action-row" data-scope="' + group.scope + '" data-group="' + group.id + '"' + danger + '>' + name + '<button type="button" class="djsc-setting-action">' + optionAction(key, meta) + '</button></span>';
            } else {
                option.name = name;
            }
            result[key] = option;
        }
    }

    const sectionKeys = new Set(Object.keys(source).filter(key => key.endsWith('Bd')));
    const leftovers = Object.keys(source).filter(key =>
        !sectionKeys.has(key) &&
        !assigned.has(key) &&
        !hidden.has(key) &&
        key !== 'openFeedbackGroup'
    );

    if (leftovers.length) {
        const groupId = 'dev_other';
        result.group_dev_other = {
            clear: true,
            name: '<div class="djsc-settings-group" data-scope="developer" data-group="' + groupId + '" data-open="false" data-accent="blue"><span>D9 · 兼容与其他</span><span class="djsc-settings-arrow">▶</span></div>',
            onclick: function () {
                const header = this.querySelector('.djsc-settings-group');
                const open = header.dataset.open !== 'true';
                header.dataset.open = String(open);
                header.querySelector('.djsc-settings-arrow').textContent = open ? '▼' : '▶';
                game.saveConfig('extension_无名AI_settings_group_' + groupId, open);
                return false;
            },
        };
        leftovers.forEach(function (key) {
            const meta = configMeta(key) || {};
            const option = { ...source[key] };
            const fullName = text(option.name);
            const label = meta.label || fullName;
            const name = '<span class="djsc-setting-name" data-scope="developer" data-group="' + groupId + '">' + escape(label) + '</span>';
            if (meta.type === 'action' || String(option.name || '').includes('djsc-menu-config-btn')) {
                option.clear = true;
                option.name = '<span class="djsc-setting-action-row" data-scope="developer" data-group="' + groupId + '">' + name + '<button type="button" class="djsc-setting-action">' + optionAction(key, meta) + '</button></span>';
            } else {
                option.name = name;
            }
            result[key] = option;
        });
    }

    return result;
}
