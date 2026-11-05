/*
 * ============================================
 * // Author: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策点钩子 =================
 * 拦截无名杀的 chooseTo* 接口，根据 trust 决定是否接管。
 */

import { getTrust, DECISION_REGISTRY } from './decisionRegistry.js';
import { recordPull } from '../../model/train/bandit.js';
import { invokeObservedHost } from '../execution/executionGateway.js';
import { log } from '../../foundation/diag/logger.js';

/* 已安装的钩子记录 */
const _installed = {};

/* 接管阈值：分差大于这个值才接管 */
const THRESHOLD = 20;

/* ================= 三层防护 ================= */

/* ★ 第一层：合法性回退（让无名杀本体负责） */
function _checkLegality(me, name, value, args) {
    try {
        /* 目标合法性：死人不选 */
        if (value && value.hp !== undefined) {
            if (value.alive === false) return false;
            if (value.hp <= 0 && name.indexOf('Target') >= 0) return false;
        }
        /* 牌合法性：不能用自己没有的牌 */
        if (value && (value.name || typeof value === 'string')) {
            const cardName = typeof value === 'string' ? value : value.name;
            if (cardName && me.countCards) {
                /* 只在"从手牌选"的场景检查 */
                if (name.indexOf('Discard') >= 0 || name.indexOf('Use') >= 0) {
                    if (me.countCards('h', cardName) <= 0) return false;
                }
            }
        }
        return true;
    } catch (e) { return false; }
}

/* ★ 第三层：红线禁止（只做绝对必要的 5 条） */
const REDLINES = [
    /* 1. 不能对自己出攻击牌 */
    function (me, card, target) {
        if (target === me && ['sha', 'juedou', 'huogong'].indexOf(card) >= 0) return false;
        return true;
    },
    /* 2. 不能对已死的人出牌 */
    function (me, card, target) {
        if (target && target.alive === false) return false;
        return true;
    },
    /* 3. 不能在没牌时选牌 */
    function (me, card) {
        if (typeof card === 'string' && me.countCards) {
            if (me.countCards('h', card) <= 0) return false;
        }
        return true;
    },
    /* 4. 不能对无懈可击对非锦囊使用 */
    function (me, card, target) {
        if (card === 'wuxie' && target) {
            try {
                if (typeof get !== 'undefined' && get.type) {
                    const t = get.type(target, 'trick');
                    if (t !== 'trick') return false;
                }
            } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        }
        return true;
    },
    /* 5. 不能选中不存在的技能 */
    function (me, button) {
        if (button && button.skill) {
            if (!me.hasSkill || !me.hasSkill(button.skill)) return false;
        }
        return true;
    },
];

function _checkRedline(me, card, target) {
    for (let i = 0; i < REDLINES.length; i++) {
        if (!REDLINES[i](me, card, target)) return false;
    }
    return true;
}

/* ================= 安装一个决策点钩子 ================= */
function installOne(name) {
    try {
        const proto = (typeof noname !== 'undefined' && noname.Player) ? noname.Player.prototype : null;
        if (!proto || !proto[name]) return;

        const ORIG_KEY = '__djsc_orig_' + name;
        if (proto[ORIG_KEY]) return;   /* 已安装 */

        const orig = proto[name];
        proto[ORIG_KEY] = orig;

        proto[name] = function (...args) {
            /* decisionHook 是监督员，不是执行器。
             * 它只能观察一次真实宿主调用，绝不能因为检查失败再次执行同一 chooseTo*。 */
            if (!this || !this.game || !this.game.me) {
                return orig.apply(this, args);
            }

            const trust = getTrust(name);
            if (trust < 0.5) {
                return orig.apply(this, args);
            }

            try { recordPull(name); }
            catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

            const host = invokeObservedHost({
                decisionPoint: name,
                orig: orig,
                thisArg: this,
                args: args,
            });
            if (!host.ok) {
                try { log.warn('decision', name + ' 宿主调用异常：' + String(host.error && host.error.message || host.reason)); } catch (_) {}
                return host.result;
            }

            const result = host.result;

            /* 合法性/红线在这里仅做诊断。GameEvent 已经由宿主创建，
             * 监督员没有资格“重跑一次原生决策”来试图修复结果。 */
            try {
                if (!_checkLegality(this, name, result, args)) {
                    log.warn('decision', name + ' 观测到可疑合法性结果，保持宿主原结果');
                }
            } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

            try {
                const cardId = (result && result.name) ? result.name : (typeof result === 'string' ? result : null);
                const target = (args && args[0] && args[0].target) ? args[0].target : null;
                if (!_checkRedline(this, cardId, target)) {
                    log.warn('decision', name + ' 观测到红线风险，保持宿主原结果');
                }
            } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

            return result;
        };

        _installed[name] = true;
        try { log.info('decision', '已接管 ' + name + '（trust=' + getTrust(name) + '）'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= 安装所有决策点钩子 ================= */
export function installDecisionHooks() {
    try {
        /* ★ 自动接管：从 DECISION_REGISTRY 读取所有决策点 */
        let names = [];
        for (const name in DECISION_REGISTRY) {
            if (DECISION_REGISTRY[name].skip) continue;
            names.push(name);
        }

        /* 如果注册表是空的，用硬编码列表兜底 */
        if (names.length === 0) {
            names = [
                'chooseToUse',
                'chooseToRespond',
                'chooseToDiscard',
                'chooseToCompare',
                'chooseToGive',
                'chooseToGuanxing',
                'chooseToPindian',
                'chooseButton',
                'chooseCard',
                'chooseTarget',
            ];
        }

        names.forEach(function (name) {
            installOne(name);
        });

        try { log.info('decision', '所有决策点钩子已安装（共 ' + names.length + ' 个）'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= 卸载所有决策点钩子 ================= */
export function uninstallDecisionHooks() {
    try {
        const proto = (typeof noname !== 'undefined' && noname.Player) ? noname.Player.prototype : null;
        if (!proto) return;

        for (const name in _installed) {
            const ORIG_KEY = '__djsc_orig_' + name;
            if (proto[ORIG_KEY]) {
                proto[name] = proto[ORIG_KEY];
                delete proto[ORIG_KEY];
            }
        }

        for (const k in _installed) delete _installed[k];
        try { log.info('decision', '所有决策点钩子已卸载'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 挂到全局 */
if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    /* ★ 连接性修复：模块自挂载为复数 decisionHooks，而引擎/自检统一用单数 decisionHook。
     *   两个名字指向同一模块，避免"读单数、挂复数"互相找不到。 */
    const _hookApi = {
        install: installDecisionHooks,
        uninstall: uninstallDecisionHooks,
    };
    window.__DJSC.decisionHooks = window.__DJSC.decisionHooks || _hookApi;
    window.__DJSC.decisionHook = window.__DJSC.decisionHook || _hookApi;
}
