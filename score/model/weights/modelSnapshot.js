/* 职责：完整权重快照转换、复制和结构校验；维度只读取 MODEL_SCHEMA。 */
import { MODEL_SCHEMA } from './weights.js';
const NET = { I: MODEL_SCHEMA.dims[0], H1: MODEL_SCHEMA.dims[1], H2: MODEL_SCHEMA.dims[2], O: MODEL_SCHEMA.dims[3] };
function _snapshotWeights(wm) {
    return {
        w1: wm.__getW1 ? Array.from(wm.__getW1()) : null,
        b1: wm.__getB1 ? Array.from(wm.__getB1()) : null,
        w2: wm.__getW2 ? Array.from(wm.__getW2()) : null,
        b2: wm.__getB2 ? Array.from(wm.__getB2()) : null,
        w3: wm.__getW3 ? Array.from(wm.__getW3()) : null,
        b3: wm.__getB3 ? Array.from(wm.__getB3()) : null,
        w4: wm.__getW4 ? Array.from(wm.__getW4()) : null,
        b4: wm.__getB4 ? Array.from(wm.__getB4()) : null,
        pr1: wm.__getPr1 ? Array.from(wm.__getPr1()) : null,
        pr2: wm.__getPr2 ? Array.from(wm.__getPr2()) : null,
    };
}
function _cloneSnapshot(s) {
    return {
        w1: s.w1 ? s.w1.slice() : null,
        b1: s.b1 ? s.b1.slice() : null,
        w2: s.w2 ? s.w2.slice() : null,
        b2: s.b2 ? s.b2.slice() : null,
        w3: s.w3 ? s.w3.slice() : null,
        b3: s.b3 ? s.b3.slice() : null,
        w4: s.w4 ? s.w4.slice() : null,
        b4: s.b4 ? s.b4.slice() : null,
        pr1: s.pr1 ? s.pr1.slice() : null,
        pr2: s.pr2 ? s.pr2.slice() : null,
    };
}
/* ★ __snapshotModel()（全参数+优化器态）→ 候选存储用的纯权重数组快照 */
function _snapToWeights(s) {
    if (!s) return null;
    const conv = a => (a && typeof a.length === 'number') ? Array.from(a) : null;
    return {
        w1: conv(s.W1), b1: conv(s.B1), w2: conv(s.W2), b2: conv(s.B2),
        w3: conv(s.W3), b3: conv(s.B3), w4: conv(s.W4), b4: conv(s.B4),
        pr1: conv(s.W_proj1), pr2: conv(s.W_proj2),
    };
}
function _snapshotComplete(s) {
    return !!(s && Array.isArray(s.w1) && Array.isArray(s.b1) && Array.isArray(s.w2) &&
        Array.isArray(s.b2) && Array.isArray(s.w3) && Array.isArray(s.b3) &&
        Array.isArray(s.w4) && Array.isArray(s.b4) && Array.isArray(s.pr1) && Array.isArray(s.pr2) &&
        s.w1.length === NET.I * NET.H1 && s.b1.length === NET.H1 &&
        s.w2.length === NET.H1 * NET.H2 && s.b2.length === NET.H2 &&
        s.w3.length === NET.H2 * NET.O && s.b3.length === NET.O &&
        s.w4.length === NET.H2 && s.b4.length === 1 &&
        s.pr1.length === NET.I * NET.H1 && s.pr2.length === NET.H1 * NET.H2);
}
function _normalizeCandidate(c) {
    if (!c || typeof c !== 'object') return null;
    if (!_snapshotComplete(c.weights)) return null;
    c.meta = (c.meta && typeof c.meta === 'object') ? c.meta : {};
    if (typeof c.meta.createdAt !== 'number') c.meta.createdAt = Date.now();
    if (typeof c.meta.samples !== 'number') c.meta.samples = 0;
    c.ab = (c.ab && typeof c.ab === 'object') ? c.ab : {};
    c.ab.scores = Array.isArray(c.ab.scores) ? c.ab.scores : [];
    return c;
}


export { NET, _snapshotWeights, _cloneSnapshot, _snapToWeights, _snapshotComplete, _normalizeCandidate };
