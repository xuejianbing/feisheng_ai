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
 *   - 训练样本按 ts 时间水印做【增量上传】：每次只传上次之后新增或更新的样本
 *   - 连招与 localStorage 快照按【分键内容指纹】判断：内容没变不重传
 *   - 上传成功后只丢弃内存中的待传组包（"删除备份"），并推进水印/指纹；
 *     失败则保留待传，下次自动重试（网关 7 天指纹去重兜底边界重传）
 * ============================================================ */

import { cfg } from '../config/util.js?v=41a';
import { getSamples, bufferSize, exportStats, getSampleDiagnostics } from '../../model/train/trainExport.js?v=41a';
import { getSkillCandDiag } from '../../decision/skills/activeSkillEligibility.js?v=41a';
import { collectSkillBreakdownLite } from '../../decision/skills/skills.js?v=41a';   /* ★PR7 */
import { learnedChains } from '../../decision/strategy/comboChain.js?v=41a';
import { log } from '../diag/logger.js?v=41a';
import { safeGet, safeSet } from '../storage/storage.js?v=41a';
import { createIngestReceiptSummary, addIngestReceipt, describeIngestReceipt, parseIngestHttpResponse } from './ingestReceipt.js?v=41a';

const ENDPOINT = 'https://data.feiqiaoai.uno/';
const LAST_KEY = 'djsc_ingest_last';      /* 游标：{ watermark, keyFp, lastOk, lastErr } */
const FP_TTL = 7 * 24 * 3600 * 1000;      /* 与网关指纹过期一致 */
const BATCH_LIMIT = 400   /* ★1015：大批 51KB→17KB，弱网/链路抖动下失败率与损失大降 */;                 /* 单批样本数上限（防 413/超时） */
const PERIOD_MS = 3600 * 1000;            /* 教程：每小时自动上传 */

let _timer = null;
let _uploading = false;
let _lastResult = null;   /* { at, ok, detail } 仅供面板显示，不持久化精确时间 */

/* ---------------- SHA-256（纯 JS，无名杀 WebView 无 crypto.subtle 保障） ---------------- */
function _utf8(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
        else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
            const c2 = str.charCodeAt(i + 1);
            if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
                const cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
                out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
                i++;
            } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return Uint8Array.from(out);
}
function _rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
function _sha256Bytes(bytes) {
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const bitLen = bytes.length * 8;
    const withPad = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
    withPad.set(bytes);
    withPad[bytes.length] = 0x80;
    const dv = new DataView(withPad.buffer);
    dv.setUint32(withPad.length - 4, bitLen >>> 0, false);
    dv.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000), false);
    const w = new Uint32Array(64);
    for (let off = 0; off < withPad.length; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
        for (let i = 16; i < 64; i++) {
            const s0 = _rotr(w[i - 15], 7) ^ _rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = _rotr(w[i - 2], 17) ^ _rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, h] = H;
        for (let i = 0; i < 64; i++) {
            const S1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
            const S0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22);
            const mj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + mj) >>> 0;
            h = g; g = f; f = e; e = (d + t1) >>> 0;
            d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
        H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    let hex = '';
    for (let i = 0; i < 8; i++) hex += ('00000000' + H[i].toString(16)).slice(-8);
    return hex;
}
function sha256Hex(str) { return _sha256Bytes(_utf8(str)); }

/* ---------------- 稳定序列化（键排序，杜绝键序差异造成假指纹） ---------------- */
function _stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(_stableStringify).join(',') + ']';
    const keys = Object.keys(v).sort();
    let out = '';
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (k === '__fp' || k === '__fpKey') continue;   /* 指纹缓存字段不参与序列化/上传 */
        if (out) out += ',';
        out += JSON.stringify(k) + ':' + _stableStringify(v[k]);
    }
    return '{' + out + '}';
}

/* ---------------- 游标（水印 + 分键指纹） ---------------- */
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
function saveCursor(cur) { try { safeSet(LAST_KEY, JSON.stringify(cur)); } catch (e) {} }   /* ★PR4 修复：对象须显式序列化（safeSet 是 String(value) 语义） */

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
function sampleFp(s) {
    /* ★ 性能：缓存指纹于样本对象（BUFFER 同引用复用）。__fpKey 存指纹输入原文，
     *   调用时先算轻量 stringify 并比对——输入任何字段变化（合并更新 count/ts）缓存自动失效重算，语义与无缓存完全一致；
     *   命中时跳过 sha256（纯 JS 哈希是 1 万样本下的主要卡顿源），只剩轻量 stringify（便宜一个量级）。 */
    const key = _stableStringify({
        f: s.f, r: s.r, m: s.m || null, conf: s.conf, value_target: s.value_target,
        fbAsync: s.fbAsync, count: s.count, ts: s.ts, scene: s.scene || null
    });
    if (s.__fpKey === key && typeof s.__fp === 'string') return s.__fp;
    const fp = sha256Hex(key).slice(0, 16);
    try { s.__fpKey = key; s.__fp = fp; } catch (e) {}
    return fp;
}
/* 样本挑选：ts >= watermark 预过滤 → 样本级指纹精确排除已传；
 * 合并更新（count/ts 变）与同毫秒新样本都会命中新指纹，边界已传样本不会重复组包。
 * 指纹表 7 天过期，与网关指纹过期对齐（过期后同内容重传一次，网关同样接受）。 */
function pickNewSamples(samples, watermark, sentMap) {
    const list = [], newFps = [];
    let maxTs = watermark;
    const sent = sentMap || {};
    const now = Date.now();
    /* ★ 性能快速路径：先 O(n) 数值扫描取 maxTs（零哈希），确定无新样本直接返回——
     *   周期检查/局末钩子在增量稳定期零成本，不再阻塞主线程。maxTs<watermark 才短路；
     *   ==watermark 不能短路（同毫秒新样本仍需指纹识别）。 */
    let scanMax = 0;
    for (let i = 0; i < samples.length; i++) {
        const ts0 = samples[i] && samples[i].ts ? samples[i].ts : 0;
        if (ts0 > scanMax) scanMax = ts0;
    }
    if (scanMax < watermark) return { list, maxTs: watermark, newFps };
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const ts = s && s.ts ? s.ts : 0;
        if (ts < watermark) continue;
        if (ts > maxTs) maxTs = ts;
        const fp = sampleFp(s);
        if (!sent[fp]) { list.push(s); newFps.push([fp, now]); }
    }
    return { list, maxTs, newFps };
}
/* 指纹表过期清理 + 溢出保护 */
function mergeSentFps(sentMap, newFps) {
    const out = Object.assign({}, sentMap || {});
    const now = Date.now();
    for (let i = 0; i < (newFps || []).length; i++) out[newFps[i][0]] = newFps[i][1];
    for (const k in out) if (now - out[k] > FP_TTL) delete out[k];
    const keys = Object.keys(out);
    if (keys.length > 20000) {   /* 1 万样本上限的双倍封顶，丢最旧 */
        keys.sort((a, b) => out[a] - out[b]);
        for (let i = 0; i < keys.length - 20000; i++) delete out[keys[i]];
    }
    return out;
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
    return env;
}
function postJSON(bodyObj) {
    return fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },  /* 简单请求，免 OPTIONS 预检 */
        body: _stableStringify(bodyObj)
    }).then(parseIngestHttpResponse);
}

/* ---------------- 主流程 ---------------- */
function uploadNow(force) {
    if (!force && !cfg('cloudAutoUpload', false)) return Promise.resolve({ skipped: 'disabled' });
    if (_uploading) return Promise.resolve({ skipped: 'busy' });
    const cur = loadCursor();
    /* ★P2 修复：退避（以及下面所有提前返回）必须在拿锁之前或经统一释放路径，
     *   原实现先置 _uploading = true 再判退避，命中退避直接 return → 锁永不释放，
     *   此后自动与手动上传都只能返回 busy，直到刷新页面。 */
    if (!force && cur.backoffUntil && Date.now() < cur.backoffUntil) return Promise.resolve({ skipped: 'backoff', minLeft: Math.ceil((cur.backoffUntil - Date.now()) / 60000) });   /* ★fixPR2: 限流退避期内不再空耗配额 */
    _uploading = true;
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
function _uploadRun(cur, force) {
    const samples = getSamples ? getSamples() : [];
    const pick = pickNewSamples(samples, cur.watermark, cur.keyFp && cur.keyFp.samples);
    const snap = diffSnapshot(cur);
    const shadowBatch = collectShadowV5();   /* ★PR4：v5 shadow 待传摘要 */
    _skbdPending = null;
    const skbdPend = collectSkillBreakdownPending();   /* ★PR7 */
    const hasWork = pick.list.length > 0 || snap.changed || shadowBatch.items.length > 0 || (skbdPend && skbdPend.players.length > 0);   /* ★PR7 */
    if (!hasWork && !force) {
        return Promise.resolve({ skipped: 'no-new-data', pendingSamples: bufferSize() });
    }
    /* 样本分批：每批独立 POST，全部 2xx 才推进水印 */
    const batches = [];
    for (let i = 0; i < pick.list.length; i += BATCH_LIMIT) batches.push(pick.list.slice(i, i + BATCH_LIMIT));
    if (!batches.length || (snap.changed || force)) batches.push(null);   /* 终批：携带快照/统计/配置 */
    let idx = 0, sentSamples = 0, failed = false, failMsg = '', rateLimited = false;
    let receiptSummary = createIngestReceiptSummary();
    function step() {
        if (idx >= batches.length) return Promise.resolve();
        const list = batches[idx];
        const env = buildEnvelope(list, idx === batches.length - 1 ? snap.chainsPayload : null,
            idx === batches.length - 1 ? snap.storagePayload : null,
            (idx === 0 && shadowBatch.items.length) ? shadowBatch.items : null,
            (idx === 0) ? skbdPend : null);   /* ★PR7：首批携带 */   /* ★ 4.0.24：shadow 改随首批上传——首批成功即 commit，不再被终批限流拖死 */
        return postJSON(env).then(response => {
            receiptSummary = addIngestReceipt(receiptSummary, response);
            if (list) sentSamples += list.length;
            idx++;
        }).catch(e => {
            failed = true;
            failMsg = String(e && e.message || e);
            if (e && e.rateLimited) rateLimited = true;   /* ★P2 修复：限流标记透传（文案匹配不可靠） */
        });
    }
    function run() { return step().then(() => ((failed || idx >= batches.length) ? Promise.resolve() : run())); }
    return run().then(() => {
        if (failed) {
            cur.lastErr = failMsg;
            /* ★fixPR2: 服务端限流（429/rate_limit）→ 30 分钟退避；lastErr 落盘避免重启后无痕迹 */
            if (rateLimited || /rate_limit|429/i.test(failMsg)) cur.backoffUntil = Date.now() + 30 * 60 * 1000;
            saveCursor(cur);
            _lastResult = { at: Date.now(), ok: false, detail: failMsg };
            try { log.warn('cloud', '上报失败（保留待传，本地数据未动）：' + failMsg); } catch (e) {}
            return { ok: false, error: failMsg, sentSamples, serverReceipt: receiptSummary, receiptText: describeIngestReceipt(receiptSummary) };
        }
        /* 全部成功：只推进游标 + 记样本指纹 + 丢弃内存组包（"删除备份"），原始数据一律保留 */
        cur.watermark = pick.maxTs || cur.watermark;
        cur.keyFp = snap.newFp;
        if (pick.newFps.length) {
            cur.keyFp.samples = mergeSentFps(cur.keyFp.samples, pick.newFps);
        }
        cur.lastOk = Date.now(); cur.lastErr = ''; cur.backoffUntil = 0;
        cur.uploadedTotal = (cur.uploadedTotal || 0) + sentSamples;   /* ★1015：累计已上传样本数（随游标持久化，供面板显示） */
        saveCursor(cur);
        commitShadowV5(shadowBatch.ids);
        commitSkillBreakdown(skbdPend);   /* ★PR7：成功才推进去重集合 */   /* ★PR4：shadow 游标只在全部成功后推进，失败自动重传 */
        const receiptText = describeIngestReceipt(receiptSummary);
        const detail = sentSamples + ' 条样本' + (snap.changed ? ' + 快照变更' : '') + (shadowBatch.items.length ? ' + shadow' + shadowBatch.items.length : '');
        _lastResult = { at: Date.now(), ok: true, detail: detail + (receiptText ? '；' + receiptText : ''), serverReceipt: receiptSummary, receiptText };
        try { log.info('cloud', '上报成功：' + _lastResult.detail); } catch (e) {}
        return { ok: true, sentSamples, snapshotChanged: snap.changed, serverReceipt: receiptSummary, receiptText };
    });
}

/* ---------------- 调度 ---------------- */
function dueForPeriodic(cur) {
    return !cur.lastOk || (Date.now() - cur.lastOk) >= PERIOD_MS;
}
function hasNewData(cur) {
    try {
        const pick = pickNewSamples(getSamples ? getSamples() : [], cur.watermark, cur.keyFp && cur.keyFp.samples);
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
    const pick = pickNewSamples(getSamples ? getSamples() : [], cur.watermark, cur.keyFp && cur.keyFp.samples);
    const snap = diffSnapshot(cur);
    /* ★P2 修复：三个口径必须各自独立，禁止相加冒充"去重后的样本总数"——
     * 上传成功后本地样本仍然保留，本地数已包含已上传数，相加必然重复计数。 */
    const localSaved = bufferSize();          /* 本地保存样本数（含已上传，本地永不删除） */
    const pendingCount = pick.list.length;    /* 当前待上传样本数（水印之后的新样本） */
    const uploadedCount = cur.uploadedTotal || 0;   /* 历史累计成功上传样本数 */
    return {
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
if(typeof window!=='undefined'){window.__DJSC=window.__DJSC||{};window.__DJSC.cloudFeedback={refresh:refreshCloudSettings,upload:uploadFeedback,status};}
const cloudCmd = {
    uploadNow: force => uploadNow(force !== false),
    status,
    help: () => 'cloudIngest: uploadNow [force] / status。增量上传：本地数据保留，只传新增样本与变更快照；网关按 SHA-256 去重 7 天。',
    set: () => 'v2 无可写配置；本地数据永不删除。'
};

export { cloudCmd as cmd, uploadNow, status, cloudCmd, onGameEndHook, installCloudIngest, uninstallCloudIngest, sha256Hex, _stableStringify, pickNewSamples, diffSnapshot, loadCursor };
