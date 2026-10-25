/* ============================================================
 * cloudIngest · 数据上报通道 v2（增量上传版）
 * ------------------------------------------------------------
 * 教程约定：
 *   - 端点 https://wuming-ingest.wuming-ai.workers.dev/
 *   - KV 按小时聚合 aggregate/年-月-日/小时
 *   - 网关按 SHA-256 数据指纹去重，7 天自动过期
 *   - 匿名：不含用户 ID、不含精确时间戳（小时粒度）
 *   - 只上传不下载
 * v2 语义（客户端保留数据）：
 *   - 本地训练样本 / 连招 / 存储 / 配置 一律【不删除】
 *   - 训练样本按稳定身份及内容指纹同步修订；ts水印仅用于展示
 *   - 连招与 localStorage 快照按【分键内容指纹】判断：内容没变不重传
 *   - 发送前持久化固定批次，明确归档回执后逐批确认；失败保留原请求续传
 * ============================================================ */

import { cfg } from '../config/util.js?v=41a';
import { sha256Hex, _stableStringify, sampleValue, sampleDigest, isCloudArchived } from '../../model/train/cloudSampleState.js?v=41a';
import { persistCloudConfirmations, persistLegacyReview, trainingSamplesReady } from '../../model/train/trainExport.js?v=41a';
import { getSamples, getSampleStorageKey, bufferSize, exportStats, getSampleDiagnostics } from '../../model/train/trainExport.js?v=41a';
import { getSkillCandDiag } from '../../decision/skills/activeSkillEligibility.js?v=41a';
import { collectSkillBreakdownLite } from '../../decision/skills/skills.js?v=41a';   /* ★PR7 */
import { learnedChains } from '../../decision/strategy/comboChain.js?v=41a';
import { log } from '../diag/logger.js?v=41a';
import { safeGet, safeSet } from '../storage/storage.js?v=41a';
import { createIngestReceiptSummary, addIngestReceipt, describeIngestReceipt, parseIngestHttpResponse, normalizeIngestReceipt } from './ingestReceipt.js?v=41a';
import { sourceIdentity } from './sourceIdentity.js?v=41a';

const ENDPOINT = 'https://data.feiqiaoai.uno/';
const LAST_KEY = 'djsc_ingest_last';      /* 游标：{ watermark, keyFp, lastOk, lastErr } */
const BATCH_LIMIT = 400   /* ★1015：大批 51KB→17KB，弱网/链路抖动下失败率与损失大降 */;                 /* 单批样本数上限（防 413/超时） */
const PERIOD_MS = 3600 * 1000;            /* 教程：每小时自动上传 */

let _timer = null;
let _uploading = false;
let _activeController = null, _cancelRequested = false;
let _lastResult = null;   /* { at, ok, detail } 仅供面板显示，不持久化精确时间 */

/* ---------------- SHA-256（纯 JS，无名杀 WebView 无 crypto.subtle 保障） ---------------- */
// Shared content hashing keeps retirement and upload confirmation on the same contract.
function loadCursor() {
    try {
        /* ★PR4 修复：safeGet 返回原始字符串（storage.js 语义），旧版 typeof==='object' 恒 false
         * 导致游标永不命中→每次上传全量重传、退避游标重启即失效。 */
        const raw = safeGet(LAST_KEY);
        const o = raw ? JSON.parse(raw) : null;
        if (o && typeof o === 'object' && typeof o.watermark === 'number') return o;
    } catch (e) {}
    return { watermark: 0, keyFp: {}, lastOk: 0, lastErr: '', backoffUntil: 0 };   /* watermark=0 → 首次全量；backoffUntil=限流退避截止 ★fixPR2 */
}
function saveCursor(cur) {
    const raw = JSON.stringify(cur);
    if (!safeSet(LAST_KEY, raw) || safeGet(LAST_KEY) !== raw) throw new Error('上传检查点保存失败，停止发送并保留待传');
}   /* ★PR4 修复：对象须显式序列化（safeSet 是 String(value) 语义） */

/* ---------------- 数据收集 ---------------- */
function collectChains() {
    try { return learnedChains ? learnedChains() : null; } catch (e) { return null; }
}
function collectStorage() {
    const out = {};
    try {
        const KEEP = ['djsc_ab_scores', 'djsc_learn_data_v1', 'djsc_calibrator_v1', 'djsc_score_selfmod_v3',
            'djsc_multi_profile_v1', 'djsc_mode_models_v1', 'djsc_weights_v3', 'djsc_weight_persist_v1',
            'djsc_game_logs_v1',   /* ★ fix11：加上对局日志（AI决策链+玩家操作日志） */
            'djsc_guard_recorder'];  /* ★ PR4：合法性校验拦截事件（≤100 条，走 storage 指纹增量） */
        for (let i = 0; i < KEEP.length; i++) {
            const v = safeGet(KEEP[i], undefined);
            if (v !== undefined && v !== null) out[KEEP[i]] = v;
        }
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.indexOf('djsc_mode_fold_') === 0) out[k] = safeGet(k, null);
            }
        } catch (eLS) {}
    } catch (e) {}
    try {
        const store = typeof window !== 'undefined' && window.__DJSC && window.__DJSC.gameLogStore;
        if (store) { const snapshot=JSON.parse(store.exportAllJson());delete snapshot.exportedAt;out.djsc_game_logs_v1=JSON.stringify(snapshot); }
    } catch (_) {}
    return out;
}
/* ---------------- v5 shadow 决策对比日志上传（★PR4）----------------
 * 数据源：shadow/shadowCore.js 写入的 localStorage['__ai_reason_shadow_v5']（上限 4000 条）。
 * 只传决策级摘要（不含 candidates 明细，单条 ~200B），decisionId 集合去重（FIFO 1500），
 * 上报成功才提交游标，失败自动重传；服务端按 envelope.shadowV5 字段入库。 */
const SHADOW_RAW_KEY = '__ai_reason_shadow_v5';
const SHADOW_UP_KEY = '__ai_reason_shadow_up_v1';
const SHADOW_BATCH = 400, SHADOW_SENT_MAX = 1500;
let _shadowBackoffUntil = 0;   /* ★PR7c：游标写不进（存储满）时 shadow 上传退避 30 分钟，防重传循环 */
function loadShadowSent() {
    try { const o = JSON.parse(safeGet(SHADOW_UP_KEY, null)); if (o && Array.isArray(o.sent)) return o.sent; } catch (e) {}
    return [];
}
function collectShadowV5() {
    const items = [];
    try {
        if (Date.now() < _shadowBackoffUntil) return { items: items, ids: [] };   /* ★PR7c：退避期内不收集 */
        const sent = loadShadowSent();
        const sentSet = {};
        for (let i = 0; i < sent.length; i++) sentSet[sent[i]] = 1;
        const raw = safeGet(SHADOW_RAW_KEY, null);
        const logArr = raw ? JSON.parse(raw) : null;
        if (!Array.isArray(logArr)) return { items: items, ids: [] };
        for (let i = 0; i < logArr.length && items.length < SHADOW_BATCH; i++) {
            const r = logArr[i];
            if (!r || !r.decisionId || sentSet[r.decisionId]) continue;
            items.push({
                decisionId: r.decisionId, ts: r.ts || 0, round: r.round || 0, mode: r.mode || '',
                player: r.player || '', teamPick: r.teamPick || '', v5Pick: r.v5Pick || null,
                v5PickS42: r.v5PickS42 || null, v5PickS456: r.v5PickS456 || null,
                reward: (r.reward == null ? null : r.reward),
                candCount: Array.isArray(r.candidates) ? r.candidates.length : 0,
            });
        }
    } catch (e) { try { console.warn('[cloud] shadow 收集失败（本次批次无 shadowV5）：', e && e.message || e); } catch (eW) {} }
    return { items: items, ids: items.map(function (x) { return x.decisionId; }) };
}
function commitShadowV5(ids) {
    if (!ids || !ids.length) return;
    try {
        const sent = loadShadowSent().concat(ids);
        if (sent.length > SHADOW_SENT_MAX) sent.splice(0, sent.length - SHADOW_SENT_MAX);
        safeSet(SHADOW_UP_KEY, JSON.stringify({ sent: sent }));
        /* ★ 4.0.24：写后读回校验——写入被配额/刷新打断时游标会假成功（服务器已有数据但手机不知，
           触发无意义重传循环）。读回失败则不视为提交，下轮自动重传（幂等）。 */
        const back = (function () { try { const o = JSON.parse(safeGet(SHADOW_UP_KEY, null)); return o && Array.isArray(o.sent) ? o.sent : null; } catch (eR) { return null; } })();
        if (!back || back[back.length - 1] !== sent[sent.length - 1]) {
            /* ★PR7c：写不进=存储已满（5MB 限额）→ 退避 30 分钟，不再每轮重传同一批；清理存储后自动恢复 */
            _shadowBackoffUntil = Date.now() + 30 * 60 * 1000;
            try { console.warn('[cloud] 存储可能已满（5MB），shadow 上传暂停 30 分钟；清理存储后自动恢复'); } catch (eW2) {}
        } else {
            _shadowBackoffUntil = 0;
        }
    } catch (e) { try { console.warn('[cloud] shadow 游标提交异常：', e && e.message || e); } catch (eW3) {} }
}
function collectPanelStats() {
    try {
        const s = exportStats();
        return {
            samples: s && s.count != null ? s.count : bufferSize(),
            /* ★ 4.0.24：训练缓冲线状态随批次上报——服务器直接观测 BUFFER 是否满/驱逐/导出失败，
               不再依赖本地诊断（15:18 样本线全灭事故即因缓冲状态不可见延迟 5 小时发现） */
            trainLine: s ? { count: s.count, max: s.max, paused: !!s.paused, pausedSamples: s.pausedSamples || 0, lastExport: String(s.lastExport || '').slice(0, 80) } : null,
            /* ★ fix10：__mode/__version 此前是死引用（全库无赋值），上报恒为空。
             *   mode 从游戏运行时取；version 从无名杀扩展注册表取，兜底硬编码。 */
            mode: (function () { try { return (typeof game !== 'undefined' && game.mode) || (typeof _status !== 'undefined' && _status.mode) || ''; } catch (eM) { return ''; } })(),
            version: (function () {
                try {
                    const exts = (typeof lib !== 'undefined' && lib.extension) || [];
                    const list = Array.isArray(exts) ? exts : Object.keys(exts || {}).map(k => exts[k]);
                    for (const e of list) { if (e && e.name === '无名AI' && e.version) return e.version; }
                } catch (eV) {}
                return '4.0.19-fix10';
            })(),
            brand: '飞雀V2'
        };
    } catch (e) { return { samples: bufferSize() }; }
}
function collectConfig() {
    try { return safeGet('djsc_score_config_v1', null); } catch (e) { return null; }
}

/* ---------------- 增量挑选 ---------------- */
/* 样本级指纹：固定业务字段组包（剔除 _persisted 等会抖动的内部字段），16hex 截短 */
// Only business fields are sent/hashed. Local DB and fingerprint caches never enter server dedup.
const _sampleFingerprints = new WeakMap();
function sampleFp(s) {
    const m=s.m||{}, ids=[m.sessionId,m.actorId,m.transactionId];
    const identity=ids.every(v=>typeof v==='string'&&v.length)?ids:getSampleStorageKey(s);
    const key=_stableStringify([identity,sampleValue(s)]), cached=_sampleFingerprints.get(s);
    if (cached?.key===key) return cached.fp;
    const fp=sha256Hex(key);_sampleFingerprints.set(s,{key,fp});return fp;
}
function wireSample(s, clientId) {
    const value = sampleValue(s), m = s.m || {};
    const complete = [m.sessionId,m.actorId,m.transactionId].every(v => typeof v === 'string' && v.length);
    const revision = sampleFp(s);
    // Missing transaction identity: isolate by content, never infer identity from time/card/hero.
    value.sync = {schema:'sample-revision-v1', logicalId:complete ? 'tx:' + JSON.stringify([m.sessionId,m.actorId,m.transactionId]) : 'legacy:' + JSON.stringify([clientId,getSampleStorageKey(s)]),
        revision, identity:complete ? 'transaction' : 'local-record-isolated'};
    return value;
}
function pickNewSamples(samples, watermark, sentMap) {
    const list = [], newFps = [], sent = sentMap || {};
    let maxTs = watermark || 0;
    for (const s of samples) {
        if (!s || typeof s !== 'object') continue;
        maxTs = Math.max(maxTs, s.ts || 0);
        const fp = sampleFp(s);
        const unknownLegacy = s._cloudLegacyReview === true && !s._cloudAck;
        if (!isCloudArchived(s) && !sent[fp] && !unknownLegacy) { list.push(s); newFps.push([fp, Date.now()]); }
    }
    return {list, maxTs, newFps};
}
/* Confirmations do not expire with the server dedup window. Watermark is display-only. */
function mergeSentFps(sentMap, newFps) {
    // Latest confirmations live beside durable samples, not in an ever-growing cursor.
    return {};
}
async function migrateSampleConfirmations(cur) {
    const samples=getSamples(), sent=cur.keyFp?.samples||{};
    if (cur.confirmationSchema===3 && !Object.keys(sent).length) return;
    const entries=[], unknown=[];
    for (const sample of samples) {
        const fp=sampleFp(sample);
        // Pre-750 cursors could advance on empty 200: their 16-hex entries are not durable receipts.
        if (sent[fp]) entries.push({sample,fp});
        else if (!sample._cloudAck && (cur.legacyWatermark??cur.watermark)>0 && (sample.ts||0)<=(cur.legacyWatermark??cur.watermark)) unknown.push(sample);
    }
    if (entries.length && !await persistCloudConfirmations(entries)) throw new Error('历史确认迁移保存失败，原检查点保留');
    if (unknown.length && !await persistLegacyReview(unknown)) throw new Error('历史待复核标记保存失败，原检查点保留');
    const next={...cur,keyFp:{...cur.keyFp,samples:{}},confirmationSchema:3,legacyWatermark:cur.legacyWatermark??cur.watermark};
    saveCursor(next);Object.assign(cur,next);
}
/* 连招/存储：分键内容指纹，返回变更载荷与替换后的指纹表 */
function diffSnapshot(cur) {
    const chains = collectChains();
    const storage = collectStorage();
    const newFp = Object.assign({}, cur.keyFp);
    let chainsPayload = null, storagePayload = null, changed = false;
    if (chains && typeof chains === 'object') {
        const fp = sha256Hex(_stableStringify(chains));
        if (newFp['__chains__'] !== fp) { newFp['__chains__'] = fp; chainsPayload = chains; changed = true; }
    }
    const storageFp = {};
    for (const k in storage) {
        /* ★ 性能：直接哈希 localStorage 原始文本（native 读取），跳过 parse+stableStringify 大对象；
         *   原文一致⇔内容一致，语义等价。口径切换后旧游标指纹不匹配会一次性重传 storage，幂等去重可吸收。 */
        let raw = null;
        try { raw = k === 'djsc_game_logs_v1' ? null : localStorage.getItem(k); } catch (eR) {}
        const fp = (raw !== null && raw !== undefined) ? sha256Hex(raw) : sha256Hex(_stableStringify(storage[k]));
        storageFp[k] = fp;
        if (newFp['__st__' + k] !== fp) { newFp['__st__' + k] = fp; changed = true; }
    }
    /* storage 整包一起传（键多但每个都很小，拆批不值得） */
    if (changed && Object.keys(storage).length) storagePayload = storage;
    return { chainsPayload, storagePayload, newFp, storageFp, changed };
}

/* ---------------- skillBreakdown 轻量上报（★PR7）----------------
 * 全场武将技能评分摘要，(version,player) 去重终身一次（评分为静态规则计算，同版本同武将恒定）；
 * 首批携带，全部成功才 commit 去重集合（失败自动重传），服务端落 aggregate 小时文件。 */
const SKBD_UP_KEY = '__ai_reason_skillbd_up_v1';
let _skbdPending = null;
function collectSkillBreakdownPending() {
    if (_skbdPending) return _skbdPending;
    try {
        const bd = collectSkillBreakdownLite();
        if (!bd || !bd.version || bd.version === 'unknown@' || !Array.isArray(bd.players) || !bd.players.length) return null;
        let rec = null;
        try { rec = JSON.parse(safeGet(SKBD_UP_KEY, null)); } catch (eR1) {}
        if (!rec || rec.version !== bd.version || !Array.isArray(rec.done)) rec = { version: bd.version, done: [] };
        const fresh = bd.players.filter(function (p) { return p && p.player && rec.done.indexOf(p.player) < 0; });
        if (!fresh.length) return null;
        _skbdPending = { version: bd.version, collectedAt: bd.collectedAt, players: fresh };
        return _skbdPending;
    } catch (eSkb) { return null; }
}
function commitSkillBreakdown(pend) {
    try {
        if (!pend || !pend.version || !Array.isArray(pend.players) || !pend.players.length) return;
        let rec = null;
        try { rec = JSON.parse(safeGet(SKBD_UP_KEY, null)); } catch (eR2) {}
        if (!rec || rec.version !== pend.version || !Array.isArray(rec.done)) rec = { version: pend.version, done: [] };
        pend.players.forEach(function (p) { if (rec.done.indexOf(p.player) < 0) rec.done.push(p.player); });
        if (rec.done.length > 800) rec.done = rec.done.slice(-800);
        safeSet(SKBD_UP_KEY, JSON.stringify(rec));
    } catch (eSkb2) {}
}

/* ---------------- 组包与发送 ---------------- */
function hourOf(ts) {
    const d = new Date(ts);
    const p = n => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours());
}
function buildEnvelope(samples, chainsPayload, storagePayload, shadowV5, skbdPayload) {
    const env = { v: 2, hour: hourOf(Date.now()) };
    if (samples && samples.length) env.samples = samples;
    if (chainsPayload) env.comboChains = chainsPayload;
    if (storagePayload) env.storage = storagePayload;
    env.panelStats = collectPanelStats();
    /* ★ fix10：诊断随批次上报——skill 候选漏斗 + 采样接受/拒绝计数，
     *   服务端每批数据可直接观测 skill 断层，无需用户截图面板。 */
    try { env.skillDiag = getSkillCandDiag(); } catch (eSd) {}
    if (skbdPayload && skbdPayload.players && skbdPayload.players.length) env.skillBreakdown = skbdPayload;   /* ★PR7 */
    try { const sd = getSampleDiagnostics(); if (sd) env.sampleDiag = sd; } catch (eSd2) {}
    try { const ze = (typeof game !== 'undefined' && game && game.__wmzZipEnv) || null; if (ze) env.zipEnv = { usable: ze.usable, scanned: ze.scanned, hits: ze.hits.slice(0, 16), scripts: ze.scripts.slice(0, 6) }; } catch (eZ) {}
    const cfg = collectConfig();
    if (cfg) env.config = cfg;
    if (shadowV5 && shadowV5.length) env.shadowV5 = shadowV5;   /* ★PR4：v5 shadow 决策对比摘要 */
    return sourceIdentity.envelope(env, ENDPOINT);
}
async function postJSON(bodyObj) {
    const controller = new AbortController();
    _activeController = controller;
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
        const authorization=await sourceIdentity.request(bodyObj,ENDPOINT,controller.signal);
        const response=await fetch(ENDPOINT, {method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8',...authorization},
            body:_stableStringify(bodyObj), signal:controller.signal,redirect:'error',credentials:'omit'}).then(parseIngestHttpResponse);
        sourceIdentity.verifyReceipt(bodyObj,response,ENDPOINT);
        return response;
    } catch (e) {
        if (e.name === 'AbortError') { const error = new Error(_cancelRequested?'上传已中断，保留原批次待续传':'上传请求超时，服务端接收状态未知'); error.kind=_cancelRequested?'cancelled':'timeout'; throw error; }
        if (!e.kind) e.kind = e.rateLimited ? 'rate-limit' : 'network';
        throw e;
    } finally { clearTimeout(timer); _activeController=null; }
}
function cancelUpload() { _cancelRequested=true; _activeController?.abort(); return {cancelled:_uploading}; }

/* ---------------- 主流程 ---------------- */
function uploadNow(force) {
    if (!force && !cfg('cloudAutoUpload', false)) return Promise.resolve({ skipped: 'disabled' });
    if (_uploading) return Promise.resolve({ skipped: 'busy' });
    const cur = loadCursor();
    if(cur.permanentFailure && cur.permanentFailure.credentialId===sourceState().credentialId)return Promise.resolve({skipped:'source-auth-blocked',error:cur.lastErr,pendingRetained:!!cur.pending});
    /* ★P2 修复：退避（以及下面所有提前返回）必须在拿锁之前或经统一释放路径，
     *   原实现先置 _uploading = true 再判退避，命中退避直接 return → 锁永不释放，
     *   此后自动与手动上传都只能返回 busy，直到刷新页面。 */
    if (cur.backoffUntil && Date.now() < cur.backoffUntil) return Promise.resolve({ skipped: 'backoff', minLeft: Math.ceil((cur.backoffUntil - Date.now()) / 60000) });   /* ★fixPR2: 限流退避期内不再空耗配额 */
    _uploading = true;
    _cancelRequested = false;
    const _release = r => { _uploading = false; return r; };
    const _releaseOnError = e => {
        _uploading = false;
        const msg = String((e && e.message) || e);
        try { cur.lastErr = msg; saveCursor(cur); } catch (e2) {}
        _lastResult = { at: Date.now(), ok: false, detail: '异常：' + msg };
        try { log.warn('cloud', '上报异常（已释放任务锁，可重试）：' + msg); } catch (e3) {}
        return { ok: false, error: msg, sentSamples: 0 };
    };
    /* 成功 / 失败 / 异常 / 提前返回，全部经 _release 复位任务锁 */
    return Promise.resolve().then(() => _uploadRun(cur, force)).then(_release, _releaseOnError);
}

/* 上传主体：不含任务锁，由 uploadNow 统一拿锁与释放 */
async function _uploadRun(cur, force) {
    await trainingSamplesReady();
    await migrateSampleConfirmations(cur);
    const upgradeReviewRequired=getSamples().filter(s=>!s._cloudAck && s._cloudLegacyReview===true).length;
    // A write-ahead single-batch journal is the persistent queue head. Remaining records stay local.
    // A restart always retries this immutable envelope before constructing any newer revision.
    cur.clientId ||= Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    const resumeOnly = !!cur.pending;
    const pick = pickNewSamples(getSamples ? getSamples() : [], cur.legacyWatermark||0, cur.keyFp?.samples);
    const snap = diffSnapshot(cur), shadow = collectShadowV5();
    _skbdPending = null;
    const skbd = collectSkillBreakdownPending();
    const batches = [];
    if (cur.pending) batches.push(cur.pending);
    else {
        for (let i=0;i<pick.list.length;i+=BATCH_LIMIT) {
            const list=pick.list.slice(i,i+BATCH_LIMIT);
            batches.push({env:buildEnvelope(list.map(s=>wireSample(s,cur.clientId)),null,null,null,null),
                fps:list.map(s=>[sampleFp(s),Date.now()]), count:list.length});
        }
        if (snap.changed || force || shadow.items.length || skbd) batches.push({
            env:buildEnvelope(null,snap.chainsPayload,snap.storagePayload,shadow.items,skbd),
            fps:[],count:0,snapshotFp:snap.newFp,shadowIds:shadow.ids,skbd});
    }
    if (!batches.length) return {skipped:upgradeReviewRequired?'upgrade-review-required':'no-new-data',upgradeReviewRequired};
    let sentSamples=0, receiptSummary=createIngestReceiptSummary();
    try {
        for (const batch of JSON.parse(JSON.stringify(batches))) {
            // Freeze before persisting: callbacks may revise original samples while HTTP is pending.
            cur.pending = JSON.parse(JSON.stringify(batch));
            saveCursor(cur);
            const response = await postJSON(cur.pending.env);
            receiptSummary = addIngestReceipt(receiptSummary,response);
            // A legacy 2xx is an HTTP acknowledgement only; never invent durable archive counts.
            if (!response || response.ok !== true || response.receiptUnavailable) {
                const error=new Error('服务端未明确确认接收，保留原批次');error.kind='unconfirmed';throw error;
            }
            if (batch.count && (!normalizeIngestReceipt(response) ||
                response.receipt.receivedSamples !== batch.count || response.receipt.archivedSamples !== batch.count)) {
                const error=new Error('样本归档回执不完整，保留原批次');error.kind='unconfirmed';throw error;
            }
            const next=JSON.parse(JSON.stringify(cur));
            const confirmed=new Set(batch.fps.map(pair=>pair[0]));
            const entries=getSamples().filter(s=>confirmed.has(sampleFp(s))).map(sample=>({sample,fp:sampleFp(sample)}));
            if (entries.length && !await persistCloudConfirmations(entries)) throw new Error('归档确认本地保存失败，保留批次重试');
            next.keyFp=next.keyFp||{};
            next.keyFp.samples=mergeSentFps(next.keyFp.samples,batch.fps);
            if (batch.snapshotFp) next.keyFp={...batch.snapshotFp,samples:next.keyFp.samples};
            next.uploadedTotal=(next.uploadedTotal||0)+batch.count;
            next.watermark=Math.max(next.watermark||0,...(batch.env.samples||[]).map(s=>s.ts||0));
            next.pending=null;next.lastErr='';next.backoffUntil=0;next.failures=0;delete next.permanentFailure;
            saveCursor(next);Object.assign(cur,next); // only publish checkpoint after verified write
            sentSamples+=batch.count;
            if (batch.shadowIds) commitShadowV5(batch.shadowIds);
            if (batch.skbd) commitSkillBreakdown(batch.skbd);
        }
        cur.lastOk=Date.now();saveCursor(cur);
        const receiptText=describeIngestReceipt(receiptSummary);
        _lastResult={at:Date.now(),ok:true,detail:sentSamples+' 条样本；'+receiptText,serverReceipt:receiptSummary};
        return {ok:true,sentSamples,resumed:resumeOnly,upgradeReviewRequired,serverReceipt:receiptSummary,receiptText};
    } catch(e) {
        cur.lastErr=String(e.message||e);cur.failures=(cur.failures||0)+1;
        if(e.permanent)cur.permanentFailure={kind:e.kind||'protocol',code:e.code||'E_PERMANENT_REJECTION',credentialId:sourceState().credentialId};
        const cap=e.rateLimited?3600000:900000;
        const base=e.rateLimited?300000:30000;
        const delay=e.kind==='cancelled'?0:Number.isFinite(e.retryAfterMs)&&e.retryAfterMs>0?e.retryAfterMs:
            Math.min(cap,base*2**Math.min(cur.failures-1,8))*(0.75+Math.random()*0.25);
        cur.backoffUntil=Date.now()+delay;
        try { saveCursor(cur); } catch (_) {} // old write-ahead checkpoint remains authoritative
        _lastResult={at:Date.now(),ok:false,detail:cur.lastErr,kind:e.kind||'storage'};
        return {ok:false,error:cur.lastErr,kind:e.kind||'storage',sentSamples,serverReceipt:receiptSummary,
            receiptText:describeIngestReceipt(receiptSummary)};
    }
}

/* ---------------- 调度 ---------------- */
function dueForPeriodic(cur) {
    return !cur.lastOk || (Date.now() - cur.lastOk) >= PERIOD_MS;
}
function hasNewData(cur) {
    try {
        const pick = pickNewSamples(getSamples ? getSamples() : [], cur.legacyWatermark||0, cur.keyFp && cur.keyFp.samples);
        return pick.list.length > 0;
    } catch (e) {}
    return false;
}
function periodicCheck() {
    if (!cfg('cloudAutoUpload', false)) return;
    try {
        const cur = loadCursor();
        if (dueForPeriodic(cur) && !(cur.backoffUntil && Date.now() < cur.backoffUntil)) void uploadNow(false);   /* ★fixPR2: 自动上传受 1h 节流+退避约束，对齐服务端 2 次/h 配额 */
    } catch (e) {}
}
function onGameEndHook() { try { periodicCheck(); } catch (e) {} }
/* ---------------- 外显上传按钮（玩家一键上传） ---------------- */
const BTN_ID = 'djsc-cloud-btn';
const TOAST_ID = 'djsc-cloud-toast';
function _cloudToast(msg, ok) {
    try {
        if (typeof document === 'undefined') return;
        let t = document.getElementById(TOAST_ID);
        if (!t) { t = document.createElement('div'); t.id = TOAST_ID; document.body.appendChild(t); }
        t.textContent = msg;
        t.style.cssText = 'position:fixed;left:50%;bottom:18%;transform:translateX(-50%);z-index:99999;background:rgba(0,0,0,.78);color:#fff;font-size:13px;padding:8px 14px;border-radius:8px;max-width:78vw;pointer-events:none;transition:opacity .3s;opacity:1;' + (ok === false ? 'background:rgba(140,30,30,.85);' : (ok === true ? 'background:rgba(30,110,50,.85);' : ''));
        clearTimeout(t.__tm);
        t.__tm = setTimeout(function () { try { t.style.opacity = '0'; } catch (e) {} }, 2000);
    } catch (e) {}
}
function _ensureCloudBtn() {
    try {
        if (!cfg('cloudShowButton', false) || typeof document === 'undefined') return;
        if (document.getElementById(BTN_ID)) return;
        const b = document.createElement('div');
        b.id = BTN_ID;
        b.textContent = '☁️';
        b.title = '上传数据到云端';
        b.style.cssText = 'position:fixed;right:6px;top:38%;z-index:99998;width:38px;height:38px;line-height:38px;text-align:center;font-size:20px;border-radius:50%;background:rgba(20,20,20,.45);color:#fff;user-select:none;-webkit-user-select:none;cursor:pointer;opacity:.6;transition:opacity .2s;touch-action:manipulation;';
        b.addEventListener('click', function (ev) {
            try {
                ev.stopPropagation();
                if (b.__busy) return;
                b.__busy = true;
                b.textContent = '⏳';
                b.style.opacity = '.95';
                const restore = function () { setTimeout(function () { b.textContent = '☁️'; b.style.background = 'rgba(20,20,20,.45)'; b.style.opacity = '.6'; b.__busy = false; }, 1400); };
                uploadNow(true).then(function (r) {
                    if (r && r.ok) { b.textContent = '✓'; b.style.background = 'rgba(30,110,50,.7)'; restore(); _cloudToast('已上传：' + (r.sentSamples || 0) + ' 条新样本，本地学习数据保留' + (r.snapshotChanged ? '（含快照）' : '') + (r.receiptText ? '；' + r.receiptText : ''), true); }
                    else if (r && r.skipped === 'busy') { b.textContent = '☁️'; b.style.opacity = '.6'; b.__busy = false; _cloudToast('正在上传中，请稍候'); }
                    else { b.textContent = '✗'; b.style.background = 'rgba(140,30,30,.7)'; restore(); _cloudToast('上传失败：' + ((r && r.error) || '未知') + '；数据已保留', false); }
                }).catch(function (eUp) { b.textContent = '✗'; b.style.background = 'rgba(140,30,30,.7)'; restore(); _cloudToast('上传失败：' + eUp + '；数据已保留', false); });
            } catch (eBtn) { try { b.__busy = false; } catch (e2) {} }
        });
        document.body.appendChild(b);
    } catch (e) {}
}
function _removeCloudBtn() {
    try { const b = document.getElementById(BTN_ID); if (b) b.remove(); } catch (e) {}
    try { const t = document.getElementById(TOAST_ID); if (t) t.remove(); } catch (e) {}
}
function refreshCloudSettings() {
    if (cfg('cloudAutoUpload', false)) {
        if (!_timer) _timer = setInterval(periodicCheck, 15 * 60 * 1000);
    } else if (_timer) { clearInterval(_timer); _timer = null; }
    if (cfg('cloudShowButton', false)) _ensureCloudBtn(); else _removeCloudBtn();
}
function installCloudIngest() { refreshCloudSettings(); }
function feedbackToast(result) {
    if (result?.upgradeReviewRequired) { _cloudToast('本次确认 '+(result.sentSamples||0)+' 条；另有 '+result.upgradeReviewRequired+' 条旧记录缺少可靠确认，已保留待后端联调复核'); return; }
    if (result && result.ok) _cloudToast('已上传 ' + (result.sentSamples || 0) + ' 条新样本，本地学习数据保留' + (result.receiptText ? '；' + result.receiptText : ''), true);
    else if (result && result.skipped === 'busy') _cloudToast('正在上传中，请稍候');
    else if (result && result.skipped === 'no-new-data') _cloudToast('暂无新增反馈数据');
    else _cloudToast('上传失败，数据已保留，请稍后重试', false);
}
async function uploadFeedback() {
    try { const result=await uploadNow(true);feedbackToast(result);return result; }
    catch(e){const result={ok:false,error:String(e)};feedbackToast(result);return result;}
}
function uninstallCloudIngest() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    _removeCloudBtn();
}

/* ---------------- 面板接口 ---------------- */
function status() {
    const cur = loadCursor();
    const pick = pickNewSamples(getSamples ? getSamples() : [], cur.legacyWatermark||0, cur.keyFp && cur.keyFp.samples);
    const snap = diffSnapshot(cur);
    /* ★P2 修复：三个口径必须各自独立，禁止相加冒充"去重后的样本总数"——
     * 上传成功后本地样本仍然保留，本地数已包含已上传数，相加必然重复计数。 */
    const localSaved = bufferSize();          /* 本地保存样本数（含已上传，本地永不删除） */
    const pendingCount = pick.list.length;    /* 当前待上传样本数（水印之后的新样本） */
    const uploadedCount = cur.uploadedTotal || 0;   /* 历史累计成功上传样本数 */
    return {
        source:sourceState(),permanentFailure:cur.permanentFailure||null,
        pendingBatch: !!cur.pending,
        upgradeReviewRequired: getSamples().filter(s=>!s._cloudAck && s._cloudLegacyReview===true).length,
        backoffUntil: cur.backoffUntil || 0,
        checkpointSchema: 1,
        endpoint: ENDPOINT,
        watermark: cur.watermark,
        watermarkText: cur.watermark ? new Date(cur.watermark).toLocaleString() : '（首次，将全量上传）',
        pendingSamples: pendingCount,
        bufferTotal: localSaved,
        snapshotChanged: snap.changed,
        lastOk: cur.lastOk ? new Date(cur.lastOk).toLocaleString() : '从未',
        uploadedTotal: uploadedCount,   /* ★1015：累计已上传 */
        sampleCounts: { localSaved: localSaved, pending: pendingCount, uploaded: uploadedCount },
        backoffMin: (cur.backoffUntil && Date.now() < cur.backoffUntil) ? Math.ceil((cur.backoffUntil - Date.now()) / 60000) : 0,
        lastErr: cur.lastErr || '',
        lastResult: _lastResult
    };
}
function sourceState(){try{return sourceIdentity.status();}catch(e){return {credentialId:null,error:e.code||'E_SOURCE_STORAGE',authorization:'unavailable'};}}
function retrySourceAuthorization(){const cur=loadCursor();if(cur.permanentFailure){delete cur.permanentFailure;cur.backoffUntil=0;saveCursor(cur);}return {pendingRetained:!!cur.pending};}
function configureSourceCredential(value){sourceIdentity.install(value,ENDPOINT);retrySourceAuthorization();return sourceState();}
if(typeof window!=='undefined'){window.__DJSC=window.__DJSC||{};window.__DJSC.cloudFeedback={refresh:refreshCloudSettings,upload:uploadFeedback,status,sourceStatus:sourceState,configureSourceCredential,retrySourceAuthorization};}
const cloudCmd = {
    cancelUpload,
    uploadNow: force => uploadNow(force !== false),
    status,
    help: () => 'cloudIngest: uploadNow [force] / status。增量上传：本地数据保留，只传新增样本与变更快照；网关按 SHA-256 去重 7 天。',
    set: () => 'v2 无可写配置；本地数据永不删除。'
};

export { cloudCmd as cmd, uploadNow, cancelUpload, status, cloudCmd, onGameEndHook, installCloudIngest, uninstallCloudIngest, sha256Hex, _stableStringify, pickNewSamples, diffSnapshot, loadCursor,configureSourceCredential,retrySourceAuthorization };
