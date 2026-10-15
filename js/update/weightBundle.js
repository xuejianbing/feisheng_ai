/*
 * ============================================
 * // 作者：飞升原创
 * 交流群：1080487560
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 无名AI · 模型权重包契约（纯数据 / 无宿主依赖） =================
 * 本文件是「模型权重」与「扩展版本」彻底分家的唯一权威定义：
 *  - 扩展版本 = js/config/version.js 的 VERSION（整包发布）
 *  - 模型权重版本 = weight bundle 的 releaseSeq / modelVersion（可独立在线发布）
 * 两者只通过 requiresExtension 区间做「兼容性」判断，绝不互相充当「新旧」判据。
 *
 * 本文件只做纯逻辑（版本比较、编解码、SHA-256、契约校验），
 * 不做网络、不碰存储、不碰 DOM、不引用任何其他模块——
 * 以便 Node 侧导出脚本（tools/export-weights.mjs）与自动化测试直接复用同一口径。
 *
 * 安全约束：权重包只允许是「纯数据 JSON」（base64 编码的类型化数组 + 元数据），
 * 不含、也绝不执行任何 JavaScript / 远程脚本。
 */

/* 服务端协议标识：客户端只在匹配时启用权重更新，否则安全降级（不报错、不打扰） */
export const MODEL_PROTOCOL = 'djsc-model-update-v1';
/* 权重包格式标识 */
export const BUNDLE_FORMAT = 'djsc-weight-bundle-v1';
/* 主决策模型唯一标识（第一期只发布主决策模型的官方权重） */
export const MODEL_ID = 'main-actor-critic';
/* 静态清单地址：服务端只需提供一个不可变清单文件，无需任何服务端逻辑 */
export const MODEL_MANIFEST_URL = 'https://data.feiqiaoai.uno/update/model/manifest.json';
/* 无官方权重记录时的本地基线版本（seq 最小，任何官方发布都视为更新） */
export const BUILTIN_RELEASE_SEQ = 0;

/* ---------------- 版本比较（扩展版本 / 权重发布版本） ---------------- */

/* 版本字符串 → 数值元组：'4.1' → [4,1]，非数字段按 0，最多取 4 段 */
export const parseVersionTuple = v => {
    const parts = String(v == null ? '' : v).trim().split('.').slice(0, 4).map(x => {
        const n = parseInt(x, 10);
        return Number.isFinite(n) ? n : 0;
    });
    while (parts.length < 4) parts.push(0);
    return parts;
};

/* 版本比较：返回 -1 / 0 / 1 */
export const compareVersion = (a, b) => {
    const x = parseVersionTuple(a), y = parseVersionTuple(b);
    for (let i = 0; i < 4; i++) {
        if (x[i] > y[i]) return 1;
        if (x[i] < y[i]) return -1;
    }
    return 0;
};

/* 扩展版本是否落在 [min, max] 内（max 为空表示不设上限） */
export const satisfiesExtensionRange = (version, range) => {
    const r = range || {};
    if (r.min != null && compareVersion(version, r.min) < 0) return false;
    if (r.max != null && r.max !== '' && compareVersion(version, r.max) > 0) return false;
    return true;
};

/* releaseSeq 归一化：只接受 >= 0 的有限整数，其余回退基线 */
export const normalizeReleaseSeq = v => {
    const n = Number(v);
    return (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) ? n : BUILTIN_RELEASE_SEQ;
};

/* 远程发布是否比本地新：以 releaseSeq 单调递增为准（模型版本不等同于扩展版本） */
export const isNewerRelease = (remoteSeq, localSeq) =>
    normalizeReleaseSeq(remoteSeq) > normalizeReleaseSeq(localSeq);

/* ---------------- 清单 → 客户端状态（纯判定，便于测试与复用） ----------------
 * 判定顺序即优先级：协议 → 字段完整性 → 扩展兼容性 → 本地损坏修复 → 是否有更新。
 * integrityState: 本地官方权重完整性（来自读回存档核对），'broken' 表示版本相同但内容损坏。
 * 返回 { state, latest, message }；state 取值：
 *   unsupported / invalid / needsExtensionUpdate / broken / available / latest */
export const classifyManifestState = opt => {
    const { manifest, localSeq, extensionVersion, integrityState } = opt || {};
    const latest = manifest && typeof manifest === 'object' ? manifest.latest : null;

    if (!manifest || typeof manifest !== 'object' || manifest.protocol !== MODEL_PROTOCOL
        || manifest.modelId !== MODEL_ID || !latest || typeof latest !== 'object') {
        /* 服务器未启用协议（例如返回了别的 JSON）→ 安全降级 */
        return { state: 'unsupported', latest: null, message: '协议未启用或清单格式不符' };
    }
    if (typeof latest.modelVersion !== 'string' || !Number.isFinite(Number(latest.releaseSeq))
        || typeof latest.url !== 'string' || !latest.url) {
        return { state: 'invalid', latest, message: '缺少 modelVersion / releaseSeq / url' };
    }
    if (!satisfiesExtensionRange(extensionVersion, latest.requiresExtension)) {
        return { state: 'needsExtensionUpdate', latest };
    }
    /* 版本相同但内容损坏 → 允许重新获取修复（与"已是最新"区分开） */
    if (integrityState === 'broken' && normalizeReleaseSeq(latest.releaseSeq) <= normalizeReleaseSeq(localSeq)) {
        return { state: 'broken', latest };
    }
    if (isNewerRelease(latest.releaseSeq, localSeq)) return { state: 'available', latest };
    return { state: 'latest', latest };
};

/* ---------------- 参数契约：网络层 / Critic 头 / 残差投影，一个都不能少 ----------------
 * 长度由 dims 派生（[I,H1,H2,O]），避免与 MODEL_SCHEMA 手写维度漂移；
 * kind 决定字节宽度与取值范围（Int8 权重 / Int16 偏置）。
 * ★ 必须覆盖全部 10 项，杜绝"只更新部分网络"造成的静默错位。 */
export const paramSpec = dims => {
    const I = dims[0], H1 = dims[1], H2 = dims[2], O = dims[3];
    return [
        { key: 'w1', len: I * H1, kind: 'int8' },
        { key: 'b1', len: H1, kind: 'int16' },
        { key: 'w2', len: H1 * H2, kind: 'int8' },
        { key: 'b2', len: H2, kind: 'int16' },
        { key: 'w3', len: H2 * O, kind: 'int8' },
        { key: 'b3', len: O, kind: 'int16' },
        { key: 'w4', len: H2, kind: 'int8' },      /* Critic 头权重 */
        { key: 'b4', len: 1, kind: 'int16' },      /* Critic 头偏置 */
        { key: 'pr1', len: I * H1, kind: 'int8' }, /* 残差投影 1 */
        { key: 'pr2', len: H1 * H2, kind: 'int8' },/* 残差投影 2 */
    ];
};
/* 固定顺序：摘要与体积都按此顺序串联，保证任何实现得到同一结果 */
export const PARAM_ORDER = ['w1', 'b1', 'w2', 'b2', 'w3', 'b3', 'w4', 'b4', 'pr1', 'pr2'];

/* ---------------- base64 ↔ 字节（与本体存档同源编码，体积最小且无外部依赖） ---------------- */
export const decodeBase64 = str => {
    if (typeof str !== 'string' || !str) return null;
    try {
        if (typeof atob === 'function') {
            const bin = atob(str);
            const out = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            return out;
        }
    } catch (e) { return null; }
    return null;
};

export const encodeBase64 = bytes => {
    if (!bytes || typeof bytes.length !== 'number') return '';
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    try { return btoa(bin); } catch (e) { return ''; }
};

/* 字节 → 类型化数组（按 kind 决定宽度；长度不符返回 null） */
export const bytesToTyped = (bytes, spec) => {
    if (!bytes) return null;
    if (spec.kind === 'int16') {
        if (bytes.byteLength !== spec.len * 2) return null;
        const out = new Int16Array(spec.len);
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < spec.len; i++) out[i] = dv.getInt16(i * 2, true);  /* 本机小端（与存档一致） */
        return out;
    }
    if (bytes.byteLength !== spec.len) return null;
    return Int8Array.from(bytes);
};

/* ---------------- SHA-256（纯 JS，不依赖 crypto.subtle） ----------------
 * 为何自带实现：非安全上下文 / 老 WebView 上 crypto.subtle 不可用，
 * 而"校验下载内容"是安全边界，不能用"环境不确定就跳过校验"来兜底。 */
const _K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export const sha256Hex = bytes => {
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const len = bytes.length;
    const bitLenHi = Math.floor(len / 536870912);   /* len*8 的高 32 位 */
    const bitLenLo = (len << 3) >>> 0;
    const pad = new Uint8Array((((len + 9) + 63) >> 6) << 6);
    pad.set(bytes);
    pad[len] = 0x80;
    const dv = new DataView(pad.buffer);
    dv.setUint32(pad.length - 8, bitLenHi, false);
    dv.setUint32(pad.length - 4, bitLenLo, false);
    const w = new Uint32Array(64);
    for (let off = 0; off < pad.length; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
        for (let i = 16; i < 64; i++) {
            const x = w[i - 15], y = w[i - 2];
            const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
            const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
        for (let i = 0; i < 64; i++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + _K[i] + w[i]) >>> 0;
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) >>> 0;
            h = g; g = f; f = e; e = (d + t1) >>> 0;
            d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
        H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    let out = '';
    for (let i = 0; i < 8; i++) out += H[i].toString(16).padStart(8, '0');
    return out;
};

/* ---------------- 摘要与体积：按 PARAM_ORDER 串联原始字节后取 SHA-256 ----------------
 * 与语言无关：任何实现（Node / 浏览器）对同一权重得到同一摘要与同一体积。 */
export const concatParamBytes = (params, dims) => {
    if (!params || typeof params !== 'object') return null;
    const spec = paramSpec(dims);
    const chunks = [];
    let total = 0;
    for (let i = 0; i < spec.length; i++) {
        const bytes = decodeBase64(params[spec[i].key]);
        if (!bytes) return null;
        const need = spec[i].kind === 'int16' ? spec[i].len * 2 : spec[i].len;
        if (bytes.byteLength !== need) return null;
        chunks.push(bytes);
        total += bytes.byteLength;
    }
    const all = new Uint8Array(total);
    let off = 0;
    for (let i = 0; i < chunks.length; i++) { all.set(chunks[i], off); off += chunks[i].byteLength; }
    return all;
};

export const paramsSize = (params, dims) => {
    const all = concatParamBytes(params, dims);
    return all ? all.byteLength : 0;
};

export const paramsDigest = (params, dims) => {
    const all = concatParamBytes(params, dims);
    return all ? sha256Hex(all) : null;
};

/* ---------------- 契约校验（下载后 / 导入前一律先过这里） ----------------
 * expect 由调用方从运行时契约读出（weights.js 的 MODEL_SCHEMA / DATA_EPOCH），
 * 本文件不硬编码这些常量，也不允许"为了通过校验而改版本常量"。
 * 返回 { ok, errors[], digest, size, decoded, probe }：任何一项不满足都不允许应用。 */
export const validateBundle = (bundle, expect) => {
    const errors = [];
    const dims = (expect && expect.dims) || [134, 128, 64, 6];
    const spec = paramSpec(dims);
    const push = m => { if (errors.length < 12) errors.push(m); };

    if (!bundle || typeof bundle !== 'object') return { ok: false, errors: ['权重包不是对象'], digest: null, size: 0, decoded: null, probe: null };
    if (bundle.format !== BUNDLE_FORMAT) push('格式标识不符：' + bundle.format);
    if (bundle.modelId !== MODEL_ID) push('模型标识不符：' + bundle.modelId);
    if (expect && expect.schemaVersion != null && bundle.schemaVersion !== expect.schemaVersion) {
        push('网络结构版本不匹配：包 ' + bundle.schemaVersion + ' ≠ 运行时 ' + expect.schemaVersion);
    }
    if (expect && expect.featureDim != null && bundle.featureDim !== expect.featureDim) {
        push('特征维度不匹配：包 ' + bundle.featureDim + ' ≠ 运行时 ' + expect.featureDim);
    }
    const bd = Array.isArray(bundle.dims) ? bundle.dims : null;
    if (!bd || bd.length !== dims.length || bd.some((v, i) => v !== dims[i])) {
        push('网络维度不匹配：包 ' + JSON.stringify(bd) + ' ≠ 运行时 ' + JSON.stringify(dims));
    }
    /* 数据纪元：低于运行时纪元会被 loadWeights 拒载 → 必须在应用前就拒绝 */
    if (expect && expect.dataEpoch != null) {
        const de = Number(bundle.dataEpoch);
        if (!Number.isFinite(de) || !Number.isInteger(de)) push('数据纪元非法：' + bundle.dataEpoch);
        else if (de < expect.dataEpoch) push('数据纪元过旧：包 ' + de + ' < 运行时 ' + expect.dataEpoch + '（会被拒载）');
    }

    /* 全部 10 项参数：必须齐备、长度精确、数值有限且在类型范围内 */
    const params = bundle.params;
    const decoded = {};
    if (!params || typeof params !== 'object') {
        push('缺少 params');
    } else {
        for (let i = 0; i < spec.length; i++) {
            const s = spec[i];
            const raw = params[s.key];
            if (typeof raw !== 'string' || !raw) { push('缺少参数 ' + s.key); continue; }
            const bytes = decodeBase64(raw);
            const need = s.kind === 'int16' ? s.len * 2 : s.len;
            if (!bytes) { push('参数 ' + s.key + ' base64 解码失败'); continue; }
            if (bytes.byteLength !== need) { push('参数 ' + s.key + ' 字节数 ' + bytes.byteLength + ' ≠ ' + need); continue; }
            const typed = bytesToTyped(bytes, s);
            if (!typed || typed.length !== s.len) { push('参数 ' + s.key + ' 类型/长度不符'); continue; }
            let bad = null;
            const lo = s.kind === 'int16' ? -32768 : -128;
            const hi = s.kind === 'int16' ? 32767 : 127;
            for (let k = 0; k < typed.length; k++) {
                const v = typed[k];
                if (!Number.isFinite(v) || !Number.isInteger(v) || v < lo || v > hi) { bad = k; break; }
            }
            if (bad !== null) { push('参数 ' + s.key + '[' + bad + '] 数值非法'); continue; }
            decoded[s.key] = typed;
        }
    }

    /* 体积与 SHA-256：必须与元数据一致（版本相同但内容损坏也要能识别出来） */
    let digest = null, size = 0;
    if (!errors.length) {
        const all = concatParamBytes(params, dims);
        if (!all) push('参数无法串联');
        else {
            digest = sha256Hex(all);
            size = all.byteLength;
            const wantSize = Number(bundle.size);
            if (!Number.isFinite(wantSize) || wantSize !== size) push('体积不符：元数据 ' + bundle.size + ' ≠ 实际 ' + size);
            const wantDigest = String(bundle.sha256 || '').toLowerCase();
            if (!/^[0-9a-f]{64}$/.test(wantDigest)) push('sha256 字段缺失或格式非法');
            else if (wantDigest !== digest) push('SHA-256 不匹配：内容与元数据不一致');
        }
    }

    /* 探针（可选）：官方包提供确定性输入与期望标签，客户端应用后再前向一次自检 */
    let probe = null;
    if (bundle.probe != null) {
        const p = bundle.probe;
        if (!p || !Array.isArray(p.input) || p.input.length !== dims[0] || !p.input.every(Number.isFinite)
            || !Number.isInteger(p.expectTop) || p.expectTop < 0 || p.expectTop >= dims[3]) {
            push('探针数据非法');
        } else {
            probe = { input: p.input.slice(), expectTop: p.expectTop };
        }
    }

    return { ok: errors.length === 0, errors, digest, size, decoded: errors.length === 0 ? decoded : null, probe };
};
