/*
 * ============================================
 * // Auteur: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 权重持久化 =================
 * 原理：把校准偏移固化进模型输出层的偏置项 B3（P0-07：6 类输出层是 W3/B3:64→6，
 *   此前误写 B2——那是 64 维隐藏层偏置，索引 2/3 只是普通隐层神经元，与 C/D 类无关）。
 *   · 偏置独立于输入 → 不破坏特征-权重映射
 *   · shift.atk > 0  → B3[D] 增加
 *   · shift.def > 0  → B3[C] 增加
 *   · shift.modelTrust > 0 → 全体 B3 向零收缩（降低自信度）。
 *     ★ 注意：softmax 对 logits 平移不变，"所有类同减常量"不改变任何相对概率；
 *     向零按比例收缩才会拉平分布、真正降低模型自信。彻底的置信控制应由决策层
 *     模型融合权重承担（超出本文件职责）。
// מחבר: פיישנג אוריגינל | רישיון: GPL-3.0
 * 触发：每局结束时消化一次，消化后 shift 归零。
 */
import { log } from '../../foundation/diag/logger.js';
import { safeGet as _lsGet, safeSet as _lsSet, safeRemove as _lsRemove } from '../../foundation/storage/storage.js';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */

const STORE_KEY = 'djsc_weight_persist_v1';
const DIGEST_LR = 8;
const DIGEST_INTERVAL = 1;

let STORE = { v: 1, digestedGames: 0, totalDigested: 0 };
let _loaded = false;

function _load() {
    try {
        if (_loaded) return;
        const raw = _lsGet(STORE_KEY);
        if (raw) {
            const obj = JSON.parse(raw);
            if (obj && obj.v === 1) STORE = obj;
        }
        _loaded = true;
    } catch (e) { _loaded = true; }
}
function _save() {
    try { _lsSet(STORE_KEY, JSON.stringify(STORE)); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export function digestShiftToWeights(shift, weightsModule) {
    try {
        if (!shift || !weightsModule) return false;

        /* ★ P0-07：6 类输出层偏置是 B3（64→6），此前误取 B2（隐藏层 64 维偏置） */
        const B3 = weightsModule.__getB3 ? weightsModule.__getB3() : null;
        if (!B3) return false;

        const LABEL_IDX = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };

        const atkStep = shift.atk * DIGEST_LR;
        const defStep = shift.def * DIGEST_LR;
        const trustStep = shift.modelTrust * DIGEST_LR;

        B3[LABEL_IDX.D] = _clamp(B3[LABEL_IDX.D] + atkStep);
        B3[LABEL_IDX.C] = _clamp(B3[LABEL_IDX.C] - atkStep * 0.5);

        B3[LABEL_IDX.C] = _clamp(B3[LABEL_IDX.C] + defStep);
        B3[LABEL_IDX.D] = _clamp(B3[LABEL_IDX.D] - defStep * 0.5);

        if (Math.abs(trustStep) > 0.1) {
            /* ★ softmax 平移不变：全体同减常量不改变相对概率。改为向零按比例收缩，
             * 拉平 logit 差距 → 真正降低自信度（信任越低收缩越强，封顶 20%/次）。 */
            const shrink = Math.min(0.2, Math.abs(trustStep) * 0.05);
            for (let k = 0; k < 6; k++) {
                B3[k] = _clamp(B3[k] * (1 - shrink));
            }
        }

        if (weightsModule.saveWeights) weightsModule.saveWeights();

/* Forfatter: Feisheng Original, Alle rettigheder forbeholdes */
        STORE.totalDigested++;
        _save();
        log.info('weightPersist', '校准偏移已固化入权重：atk=' + shift.atk.toFixed(3) +
                 ' def=' + shift.def.toFixed(3) + ' trust=' + shift.modelTrust.toFixed(3));
        return true;
    } catch (e) {
        log.warn('weightPersist', '固化失败：' + e.message);
        return false;
    }
}

/* ★ P0-07：B3 为 Int16Array，量程 ±32767（此前误用 Int8 的 ±127） */
function _clamp(v) {
    if (v > 32767) return 32767;
    if (v < -32767) return -32767;
    return v | 0;
}

export function weightPersistOnSettle() {
    try {
        _load();
        STORE.digestedGames++;
        _save();
        if (STORE.digestedGames % DIGEST_INTERVAL !== 0) return false;

        const cal = window.__DJSC && window.__DJSC.calibrator;
        if (!cal || !cal.weights) return false;
        const shift = cal.weights();

        const hasShift = Math.abs(shift.atk) > 0.05 ||
                         Math.abs(shift.def) > 0.05 ||
                         Math.abs(shift.modelTrust) > 0.05;
        if (!hasShift) return false;

        const wmod = window.__DJSC && window.__DJSC.__weightsModule;
        if (!wmod) return false;

        const ok = digestShiftToWeights(shift, wmod);
        if (ok) {
            if (cal.reset) cal.reset();
            return true;
        }
        return false;
    } catch (e) { return false; }
}

export function weightPersistStats() {
    _load();
    return {
        digestedGames: STORE.digestedGames,
        totalDigested: STORE.totalDigested,
    };
}

export function resetWeightPersist() {
    STORE = { v: 1, digestedGames: 0, totalDigested: 0 };
    try { _lsRemove(STORE_KEY); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.weightPersist = {
        digest: digestShiftToWeights,
        onSettle: weightPersistOnSettle,
        stats: weightPersistStats,
        reset: resetWeightPersist,
    };
}
_load();
