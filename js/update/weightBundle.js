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
 * 本文件只做纯逻辑（版本比较、契约常量），不做网络、不碰存储、不碰 DOM，
 * 以便 Node 侧导出脚本（tools/export-weights.mjs）与自动化测试直接复用同一口径。
 */

/* 服务端协议标识：客户端只在匹配时启用权重更新，否则安全降级（不报错、不打扰） */
export const MODEL_PROTOCOL = 'djsc-model-update-v1';
/* 主决策模型唯一标识（第一期只发布主决策模型的官方权重） */
export const MODEL_ID = 'main-actor-critic';
/* 静态清单地址：服务端只需提供一个不可变清单文件，无需任何服务端逻辑 */
export const MODEL_MANIFEST_URL = 'https://data.feiqiaoai.uno/update/model/manifest.json';
/* 无官方权重记录时的本地基线版本（seq 最小，任何官方发布都视为更新） */
export const BUILTIN_RELEASE_SEQ = 0;

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
