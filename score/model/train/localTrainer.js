/*
 * ============================================
 * // Éditeur: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 本地训练器 · 多层网络 SGD（分片协程版） =================
 * ★ P2-38：旧版定义了 tryLoadWorker() 却从未调用——所谓"Web Worker 后台训练"
 *   从未生效；且 foundation/runtime/worker.js 内只是"模拟损失"的假训练，
 *   根本不触碰真实权重。真正的训练发生在 setTimeout 回调里，依旧同步占满主线程。
 *
 *   真 Worker 方案需要把 weights/features 等依赖宿主（lib/localStorage）的模块
 *   整体快照进线程，复杂且脆弱；本版采用【分片协程】：训练循环每处理
 *   YIELD_EVERY 个样本让出一次宏任务（setTimeout 0），保证游戏 UI 可穿插响应，
 *   数学结果与同步训练完全一致。
 */

import { getSamples } from './trainExport.js';
import { scoreToLabel } from './labelPolicy.js';
import { FEATURE_DIM } from '../features/features.js';
import { trainOne, trainOneWithValue, saveWeights, setAccuracy, markReady, getMeta, forward, setTrainLR } from '../weights/weights.js';
import { cfg } from '../../foundation/config/util.js';  /* ★ 导入配置读取函数 */
import { emit } from '../../foundation/runtime/eventBus.js';  /* ★ P2-33：训练生命周期事件 */
// Автор: Фэйшэн Оригинал | Лицензия: GPL-3.0

const EPOCHS = 10;  /* 训练10轮，手机不卡 */
const VAL_RATIO = 0.2;
const YIELD_EVERY = 256;  /* ★ P2-38：每处理 256 个样本让出一次主线程 */

let _training = false;
let _lastResult = null;
let _workSinceYield = 0;

/* ★ P2-38：协程让步闸——计数未到阈值时返回 undefined（零开销），
 *   到达阈值则返回一个宏任务 Promise，await 它即可让 UI 事件穿插执行。 */
function _maybeYield() {
    if (++_workSinceYield < YIELD_EVERY) return undefined;
    _workSinceYield = 0;
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

export function isTraining() { return _training; }
export function lastResult() { return _lastResult; }

/* ★ P2-38：分片协程训练。兼容旧回调 onDone(result)，同时返回 Promise(result)。
 *   训练本身仍在主线程执行，但每 YIELD_EVERY 样本让出一次，不再长时间卡死 UI。 */
export function trainLocalAsync(onDone) {
    if (_training) {
        const busy = { ok: false, err: '正在训练' };
        if (onDone) { try { onDone(busy); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }
        return Promise.resolve(busy);
    }
    _training = true;
    _workSinceYield = 0;
    try { emit('train:start', { ts: Date.now() }); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    return Promise.resolve().then(function () { return _train(); }).then(function (r) {
        _training = false;
        _lastResult = r;
        try { emit(r && r.ok ? 'train:done' : 'train:fail', r || {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        if (onDone) { try { onDone(r); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }
        return r;
    }, function (e) {
        const r = { ok: false, err: String(e && e.message || e) };
        _training = false;
        _lastResult = r;
        try { emit('train:fail', r); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
        if (onDone) { try { onDone(r); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); } }
        return r;
    });
}

async function _train() {
    const samples = getSamples();
    if (!samples || samples.length < 200) {
        return { ok: false, err: '样本不足（需 ≥200，当前 ' + (samples ? samples.length : 0) + '）' };
    }

    const t0 = performance.now();
    
    /* ★ Mini-Batch 训练配置（手机端友好：小批量少轮次） */
    const BATCH_SIZE = 100;  /* 每次训练取100条（原来1000太多了会卡） */
    const EPOCHS = Math.max(5, Math.min(20, Math.floor(500 / (samples.length / BATCH_SIZE))));  /* 最多20轮（原来200太多了） */
    
    let lr = (typeof cfg === 'function') ? cfg('learningRate', 0.02) : 0.02;  /* ★ 从配置读取学习率（默认0.02配合Int8随机舍入） */
    lr = parseFloat(lr) || 0.02;  /* ★ 转成数字，防止item配置读出字符串 */
    
    const dim = FEATURE_DIM;
    
    /* ★ 打乱样本顺序 */
    const shuffled = samples.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
    }
    
    /* ★ Mini-Batch 训练循环 */
    let totalTrained = 0;
    let totalLoss = 0;
    
    for (let epoch = 0; epoch < EPOCHS; epoch++) {
        /* 随机取一个batch */
        const batchStart = (epoch * BATCH_SIZE) % shuffled.length;
        const batch = [];
        for (let i = 0; i < BATCH_SIZE && (batchStart + i) < shuffled.length; i++) {
            batch.push(shuffled[batchStart + i]);
        }
        
        if (batch.length < 10) continue;
        
        /* 在这个batch上训练 */
        for (let b = 0; b < batch.length; b++) {
            const s = batch[b];
            const count = s.count || 1;
            const effectiveCount = Math.min(count, 3);  /* batch里最多重复3次 */
            for (let c = 0; c < effectiveCount; c++) {
                trainOne(s.f, scoreToLabel(s.r), lr);
                totalTrained++;
                const _y = _maybeYield();  /* ★ P2-38：分片让出主线程 */
                if (_y) await _y;
            }
        }
        
        /* ★ P2-38：让步已在样本循环内按 YIELD_EVERY 精确分片完成，旧版这里是空分支 */
    }
    
    const n = samples.length;
    let posCount = 0, negCount = 0;
    for (let i = 0; i < samples.length; i++) {
        if (samples[i].r > 0) posCount++; else negCount++;
    }

    /* ★ 准备训练数据：X特征矩阵、Y标签、V价值目标 */
    const X = new Int8Array(n * dim);
    const Y = new Int8Array(n);
    const V = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const s = samples[i];
        const off = i * dim;
        for (let j = 0; j < dim; j++) X[off + j] = s.f[j] | 0;
        Y[i] = scoreToLabel(s.r);
        V[i] = (s.value_target !== undefined) ? s.value_target : 0;
    }

    /* 打乱顺序 */
    const idx = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    for (let i = n - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    }

    /* 划分训练集/验证集 */
    const valN = Math.max(20, (n * VAL_RATIO) | 0);
    const trN = n - valN;

    /* ★ 三层网络训练：用 trainOneWithValue 做反向传播（同时训练Actor和Critic）
     * 3.1 封测：
     *  ─ 余弦退火学习率：epoch 从 baseLR 平滑衰减到 10% baseLR，后期收敛更稳不震荡
     *  ─ 回放样本按 count 加权（频率越高重复越多，封顶 3 次），交易过拟合
     */
    const baseLR = lr;
    for (let epoch = 0; epoch < EPOCHS; epoch++) {
        /* ★ 学习率调度（余弦退火）：coef 1→0，epochLR 落在 [baseLR*0.1, baseLR] */
        const coef = 0.5 * (1 + Math.cos(Math.PI * epoch / EPOCHS));
        const epochLR = baseLR * (0.1 + 0.9 * coef);
        setTrainLR(epochLR);
        let mistakes = 0;
        for (let i = 0; i < trN; i++) {
            const src = idx[i];
            const off = src * dim;
            const feat = new Int8Array(dim);
            for (let j = 0; j < dim; j++) feat[j] = X[off + j];
            /* ★ 3.1：回放优先级——count 越高的样本重复训练越多（封顶 3），
             * 与上方 Mini-Batch 分支的封顶策略保持一致 */
            const rep = Math.min(1 + ((samples[src].count || 1) >> 1), 3);
            for (let rc = 0; rc < rep; rc++) {
                trainOneWithValue(feat, Y[src], V[src], epochLR);  /* 传入 value_target */
            }
            const _yTr = _maybeYield();  /* ★ P2-38：训练分片让出主线程 */
            if (_yTr) await _yTr;
        }

        /* 验证集准确率 */
        let correct = 0;
        for (let i = trN; i < n; i++) {
            const src = idx[i];
            const off = src * dim;
            const feat = new Int8Array(dim);
            for (let j = 0; j < dim; j++) feat[j] = X[off + j];
            const logits = forward(feat);
            if (logits) {
                let maxIdx = 0, maxVal = -Infinity;
                for (let k = 0; k < 6; k++) {
                    if (logits[k] > maxVal) { maxVal = logits[k]; maxIdx = k; }
                }
                if (maxIdx === Y[src]) correct++;
            }
            const _yVa = _maybeYield();  /* ★ P2-38：验证分片让出主线程 */
            if (_yVa) await _yVa;
        }
        const acc = correct / valN;

        /* 每 10 轮输出一次 */
        if (epoch % 10 === 0) {
            try { console.log('[训练] epoch=' + epoch + ' acc=' + (acc * 100).toFixed(1) + '%'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        }
    }

    /* 3.1：训练结束恢复基准学习率，避免调度残留影响后续在线 trainOne */
    setTrainLR(baseLR);

    /* ★ 保存权重 */
    /* 在循环外面重新算一次最终准确率 */
    let finalCorrect = 0;
    for (let i = trN; i < n; i++) {
        const src = idx[i];
        const off = src * dim;
        const feat = new Int8Array(dim);
        for (let j = 0; j < dim; j++) feat[j] = X[off + j];
        const logits = forward(feat);
        if (logits) {
            let maxIdx = 0, maxVal = -Infinity;
            for (let k = 0; k < 6; k++) {
                if (logits[k] > maxVal) { maxVal = logits[k]; maxIdx = k; }
            }
            if (maxIdx === Y[src]) finalCorrect++;
        }
        const _yFin = _maybeYield();  /* ★ P2-38：终评分片让出主线程 */
        if (_yFin) await _yFin;
    }
    const finalAcc = finalCorrect / valN;
    try {
        setAccuracy(finalAcc);
        markReady(true);
        saveWeights();
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

    const meta = getMeta();
    return {
        ok: true,
        accuracy: Math.round(finalAcc * 1e4) / 1e4,
        posRatio: Math.round(posCount / n * 1e4) / 1e4,
        samples: n,
        epochs: EPOCHS,
        trained: meta.trained,
        ms: Math.round(performance.now() - t0),
    };
}

/* 挂到全局方便控制台调试 */
if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.trainLocalAsync = trainLocalAsync;
    window.__DJSC.isTraining = isTraining;
    window.__DJSC.lastResult = lastResult;
}
