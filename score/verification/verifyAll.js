/*
 * ============================================
 * // 作者: 飞升原创  交流群: 123456789
 * v3.1α 验证指令·全量自检
 * 整合 面板/核心命令/暴露模块/配置开关 一键在游戏内验证
 * 打开方式：控制台执行  window.__DJSC.verifyAll()
 * ============================================
 */

/* ★ P1-29：面板实际 24 个，补上 openChampionPanel */
const PANEL_KEYS = [
    'openScorePanel', 'openScoreDetailPanel', 'openPlanPanel', 'openFeedbackPanel',
    'openArchivePanel', 'openRecommendPanel', 'openSmartPanel', 'openSkillPanel',
    'openSkillBreakdownPanel', 'openSkillCustomPanel', 'openOverridePanel',
    'openMemoryPanel', 'openHealthPanel', 'openConfigPanel', 'openBrainDashboard',
    'openCalibratorPanel', 'openComparePanel', 'openDecisionDashboard',
    'openExportPanel', 'openGuardPanel', 'openProfilerPanel', 'openReplayPanel',
    'openSelfCheck', 'openChampionPanel'
];

/* 希望存在的核心命令 */
const CMD_KEYS = [
    'predict', 'confidence', 'weightsReady', 'cfg', 'trainBufferSize', 'trainStats',
    'trainExport', 'trainImport', 'trainBufferClear', 'getMeta', 'reloadWeights',
    'seatPressure', 'cardValueOf', 'enemiesOf', 'isEnemyOf', 'situationFactor',
    'targetScore', 'forecastSummary', 'maxBurstThreat', 'probHasShan', 'probHasTao',
    'probHasWuxie', 'probHasSha', 'probHasJiu', 'inferHand'
];

/* 应暴露为对象/可自检的模块 */
const MODULE_KEYS = [
    'elementFB', 'metaCognition', 'cognitionLog', 'conflict', 'calibrator',
    'multiProfile', 'strategyBus', 'replay', 'weightPersist', 'compare', 'hotSwap',
    'shared', 'evolution', 'psychology', 'comboChain', 'playerMemory', 'postCheck',
    'autoFeature', 'softMetrics', 'skillTags', 'judgeZone', 'cardTags', 'viewAs',
    'cost', 'aiTools', 'identity', 'learningOptimizer', 'decision', 'bandit',
    'discover', 'modelState', 'strategist', 'localTrainer', 'guardRecorder',
    'health', 'decisionHook', 'decisionRegistry', 'responseAI', 'replayAnalysis',
    'profiles', 'skillCustom', 'compat', 'pickRecommend', 'smartPanel',
    'decisionDashboard', 'autoplay', 'changelog', 'charts', 'compareAI',
    'modelGuard', 'modules', 'selfCheck'
];

/* 主要配置开关 */
const CONFIG_KEYS = [
    'decisionScore', 'decisionFeedback', 'responseAI', 'broadcastAI', 'compareAI',
    'adaptiveDifficulty', 'enablePlanner', 'psychologyLayer', 'comboChain', 'narrator',
    'profiler', 'hardOverride', 'override_use', 'override_respond', 'override_discard',
    'override_compare', 'crossGameMemory', 'skillFeedback', 'styleFeedback',
    'playerMemory', 'showReport', 'archiveGames', 'showLog', 'persist',
    'deckAwareness', 'deckConsumeAllPlayers', 'useTrainedModel', 'useResidual', 'aiStrength',
    'learningRate', 'forceTrain',
    'showSampleCount', 'clearSamples', 'showModelStatus', 'autoFixModel',
    'autoIdentityMatch'
];

/* 各模块常见的自检函数名候选 */
const STAT_FNS = ['stats', 'getStats', 'status', 'getMeta'];

function _safe(fn, label) {
    try { return { ok: true, val: fn() }; }
    catch (e) { return { ok: false, err: String(e && e.message || e), label: label }; }
}

/* ★ P0-08：改为 async——此前 forward 检查走 import().then()，其结果在 summary 生成后才落榜，
 *   假全绿。现在 await 导入后计入汇总再返回。 */
export async function verifyAll() {
    const D = window.__DJSC || {};
    const out = [];
    let ok = 0, fail = 0;

    function rec(cat, name, pass, detail) {
        out.push({ cat: cat, name: name, pass: pass ? '✅' : '❌', detail: detail || '' });
        pass ? ok++ : fail++;
    }

    /* 1. 面板 */
    PANEL_KEYS.forEach(function (k) {
        rec('面板', k, typeof D[k] === 'function', typeof D[k] === 'function' ? '已挂载' : '缺失');
    });

    /* 2. 核心命令 */
    CMD_KEYS.forEach(function (k) {
        rec('命令', k, typeof D[k] === 'function', typeof D[k] === 'function' ? '可调用' : '缺失');
    });

    /* 2.5 前向传播健全性：forward 不得因内部错误抛错返回 null（防残差/几何 bug → 准确率恒0）
     * ★ P0-09：forward 返回 Float32Array（TypedArray），Array.isArray 恒 false → 正确输出也判失败；
     *   改用 ArrayBuffer.isView + 长度判定。 */
    try {
        const m = await import('../model/weights/weights.js');
        const fwd = (m && typeof m.forward === 'function') ? m.forward : null;
        if (fwd) {
            try {
                const probe = new Array(130).fill(0);
                const r = fwd(probe);
                const pass = !!r && r.length === 6 && ArrayBuffer.isView(r);
                rec('模型', 'forward 前向传播', pass, pass ? '输出6维' : '返回异常(null/类型/长度)');
            } catch (e) {
                rec('模型', 'forward 前向传播', false, String(e));
            }
        } else {
            rec('模型', 'forward 前向传播', false, 'weights.forward 未就绪');
        }
    } catch (e) {
        rec('模型', 'forward 前向传播', false, '加载失败 ' + String(e));
    }

    /* 3. 模块 + 子自检调用 */
    MODULE_KEYS.forEach(function (k) {
        const m = D[k];
        if (!m || typeof m !== 'object') { rec('模块', k, false, '未挂载'); return; }
        let okk = m._real === true ? true : (Object.keys(m).length > 0);
        let note = '已挂载';
        /* 尝试调用一个自检函数 */
        for (const fn of STAT_FNS) {
            if (typeof m[fn] === 'function') {
                const r = _safe(function () { return m[fn](); }, k + '.' + fn);
                note += '; ' + fn + '()=' + (r.ok ? '正常' : '异常:' + r.err);
                if (!r.ok) okk = false;
                break;
            }
        }
        rec('模块', k, okk, note);
    });

    /* ★ P2-33：事件总线不能只是"有文件"——必须存在真实业务订阅（game:end 落盘 / train:* 日志） */
    try {
        const eb = await import('../foundation/runtime/eventBus.js');
        const stats = eb.eventStats();
        let total = 0;
        Object.keys(stats).forEach(function (k) { total += stats[k]; });
        rec('模块', 'eventBus 业务订阅', total >= 3, total + ' 个订阅 / ' + Object.keys(stats).length + ' 类事件（game:start/game:end 由插件广播发布，train:* 由 localTrainer 发布）');
    } catch (e) { rec('模块', 'eventBus 业务订阅', false, String(e)); }

    /* ★ P1-27：配置存在性以扩展 config schema（js/config/config.js 的键集）为权威——
     *   cfg(k) 缺省返回 undefined 且没有 has() API，"不抛错"不代表 key 存在；
     *   反过来，合法声明过但用户未显式设置的开关 cfg 也读不出值，不应误判缺失。
     *   现：schema 声明即通过（附当前值/缺省标注）；schema 未声明但 cfg 可读→告警口径通过；
     *   两者皆无才判缺失。 */
    let cfgSchema = null;
    try {
        const cm = await import('../../js/config/config.js');
        cfgSchema = (cm && cm.config && typeof cm.config === 'object') ? cm.config : null;
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    CONFIG_KEYS.forEach(function (k) {
        let pass = false, detail = '缺失';
        const declared = cfgSchema ? Object.prototype.hasOwnProperty.call(cfgSchema, k) : false;
        let v, readOk = false;
        if (typeof D.cfg === 'function') {
            try { v = D.cfg(k); readOk = (v !== undefined); } catch (e) { detail = '读取异常:' + e.message; }
        }
        if (declared) {
            pass = true;
            detail = 'schema 已声明' + (readOk ? '，当前值=' + JSON.stringify(v).slice(0, 40) : '（未设置，用缺省）');
        } else if (readOk) {
            pass = true;
            detail = 'schema 未声明但可读，值=' + JSON.stringify(v).slice(0, 40);
        } else if (detail === '缺失') {
            detail = cfgSchema ? 'schema 无此 key 且 cfg 读不到' : 'schema 加载失败且 cfg 读不到';
        }
        rec('配置', k, pass, detail);
    });

    /* 5. 训练数据/模型就绪 */
    const bs = _safe(function () { return D.trainBufferSize ? D.trainBufferSize() : -1; });
    rec('数据', 'trainBufferSize', bs.ok, bs.ok ? bs.val + ' 条样本' : '异常:' + bs.err);
    const wr = _safe(function () { return D.weightsReady ? D.weightsReady() : -1; });
    rec('模型', 'weightsReady', wr.ok, wr.ok ? String(wr.val) : '异常:' + wr.err);

    /* 5.1 冠军策略固化能力 */
    const champApi = (D.champion && typeof D.champion.get === 'function' && typeof D.champion.applyRule === 'function' && typeof D.champion.recompute === 'function');
    let champInfo = 'API' + (champApi ? '就绪' : '缺失');
    try {
        const cs = D.champion.stats ? D.champion.stats() : null;
        if (cs && cs.embeds) champInfo += (Object.keys(cs.embeds).length ? '｜已固化 ' + Object.keys(cs.embeds).length + ' 类' + ('/' + (cs.embs || 0) + ' 条嵌入') : '｜暂无固化嵌入');
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    rec('数据', 'champion 冠军策略', champApi, champInfo);

    /* ★ §9：四层分层视图（L1 加载 / L2 连接 / L3 功能 smoke / L4 实战手动）——
     * 聚合 layers.js，解决"检查真实功能"与"检查有没有函数名"混层；下方原分类明细保留。 */
    let layerView = null;
    try {
        const lm = await import('./layers.js');
        layerView = await lm.verifyLayers();
        layerView.layers.forEach(function (l) {
            rec('分层', l.layer + ' ' + l.name, l.auto ? l.summary.pass : true,
                l.auto ? ('✅' + l.summary.ok + ' ❌' + l.summary.fail) : ('⏭ 手动 ' + l.summary.manual + ' 项'));
        });
    } catch (e) { rec('分层', 'layers.js', false, String(e && e.message || e)); }

    /* 生成报告 */
    const total = out.length;
    const lines = out.map(function (r) {
        return r.pass + ' [' + r.cat + '] ' + r.name + ' — ' + r.detail;
    });
    const summary = '✅通过 ' + ok + '  ❌失败 ' + fail + '  共 ' + total + ' 项';

    /* 内容（深色清透卡片，三区块：头部状态 + 分类统计 + 明细） */
    let html = '<div style="font:12px/1.65 sans-serif;color:#dfeaf5;">'
        /* 头部 */
        + '<div style="background:linear-gradient(135deg,#12395e,#0f1b28);padding:10px 14px;border-radius:8px 8px 0 0;">'
        +   '<div style="display:flex;justify-content:space-between;align-items:center">'
        +     '<b style="color:#00ffb0;font-size:14px">无名AI · 全量自检</b>'
        +     '<span style="font-size:11px;color:#7fd4ff">' + total + ' 项检查</span>'
        +   '</div>'
        +   '<div style="margin-top:8px;font-size:13px">' + (ok === total ? '✅ 全部通过，引擎就绪' : '⚠️ 有 ' + fail + ' 项未通过，红色为异常项') + '</div>'
        +   '<div style="margin-top:6px;height:6px;background:#12263a;border-radius:3px;overflow:hidden">'
        +     '<div style="width:' + Math.round(ok / Math.max(1, total) * 100) + '%;height:100%;background:linear-gradient(90deg,#00c853,#00e676);transition:width .4s"></div>'
        +   '</div>'
        /* ★ §9：分层汇总条 */
        +   (layerView ? '<div style="margin-top:8px;font-size:11px;color:#9ad8ff">' + layerView.summary + '</div>' : '')
        + '</div>'
        /* 分类统计 */
        + '<div style="padding:8px 14px;background:#0d1826;">'
        +   (function () {
                const cats = {};
                out.forEach(function (r) { cats[r.cat] = (cats[r.cat] || 0) + 1; });
                const parts = [];
                for (const c in cats) parts.push('<span style="margin-right:10px;color:#9fb8cf">' + c + ' <b style="color:#e8f3ff">' + cats[c] + '</b></span>');
                return parts.join('');
            })()
        + '</div>'
        /* 明细 */
        + '<div style="background:#0f1b28;padding:10px 14px;max-height:52vh;overflow:auto;border-radius:0 0 8px 8px;">'
        +   lines.map(function (l) { return '<div style="padding:1.5px 0;border-bottom:1px solid rgba(255,255,255,.03)">' + l + '</div>'; }).join('')
        + '</div>'
        + '</div>';

    /* 面板展示 */
    try {
        const bgs = ui && ui.create && ui.create.div ? ui.create.div('', _status.window) : null;
        const mask = document.createElement('div');
        mask.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);overflow:auto;';
        const box = document.createElement('div');
        box.style.cssText = 'width:92%;max-width:760px;margin:6vh auto;';
        box.innerHTML = html + '<div style="text-align:center;padding:8px"><a style="color:#7fd4ff;cursor:pointer" onclick="this.parentElement.parentElement.parentElement.remove()">[关闭]</a></div>';
        mask.appendChild(box);
        (document.body || document.documentElement).appendChild(mask);
    } catch (e) {
        try { game.log('⚠️ 自检：' + summary); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
    }
    try { console.log('[无名AI 自检] ' + summary + '\n' + lines.join('\n')); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

    /* ★ 把明细逐行打到游戏日志，避免主程序控制台只显示 [object Object]，
     * 让玩家在游戏内日志直接看到每一项内容。 */
    try {
        if (typeof game === 'object' && game && game.log) {
            game.log('📊 全量自检：' + summary);
            lines.forEach(function (l) { try { game.log(l); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); } });
        }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

    return { total: total, ok: ok, fail: fail, summary: summary, report: out, text: '【无名AI 全量自检】' + summary + '\n' + lines.join('\n') };
}

/* ★ 顶层独立纯文本版：不依赖先调用 verifyAll，主程序控制台直接显示字符串而非对象
 * ★ P0-08：verifyAll 已 async，此处 await 等待完整结果 */
async function verifyAllText() {
    try {
        const r = (typeof verifyAll === 'function') ? await verifyAll() : await window.__DJSC.verifyAll();
        return '【无名AI 全量自检】' + r.summary + '\n' +
            (r.report || []).map(function (it) { return it.pass + ' [' + it.cat + '] ' + it.name + ' — ' + it.detail; }).join('\n');
    } catch (e) {
        return '【无名AI 全量自检】错误：' + e.message;
    }
}

/* 挂载到全局总线：verifyAll / verifyAllQuick 同一处一次挂好。
 * verifyAll 入口查找不到的常见原因——旧扩展缓存/侧载路径未重载；
 * 因此把 quick 也做成 verifyAll 的属性，只要 verifyAll 在，quick 必然在。 */
try {
    window.__DJSC = window.__DJSC || {};
    /* ★ P0-08：verifyAll 已 async，quick 同步 await 后再跑健康检查 */
    const _quick = async function () {
        const r = (typeof verifyAll === 'function') ? await verifyAll() : await window.__DJSC.verifyAll();
        try { window.__DJSC.health && window.__DJSC.health.check && window.__DJSC.health.check(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        try { window.__DJSC.selfCheck && window.__DJSC.selfCheck.run && window.__DJSC.selfCheck.run(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        return r;
    };
    window.__DJSC.verifyAll = verifyAll;
    window.__DJSC.verifyAllQuick = _quick;
    window.__DJSC.verifyAllText = verifyAllText;
    verifyAll.quick = _quick;   /* 属性备份，防挂名不一致 */
} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }