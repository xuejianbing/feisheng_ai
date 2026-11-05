
/* ===== 关键参数校验（功能层面防盗） ===== */
const _fs_checksum = {
    dim: 130,
    hid1: 128,
    hid2: 64,
    out: 6,
    check: function() {
        // 简单的一致性校验，被改了就返回false
        return (this.dim === 130 && this.hid1 === 128 && this.hid2 === 64 && this.out === 6);
    }
};
// ====================================
/*
 * ============================================
// Autor: Feisheng Original | Licencia: GPL-3.0
 * // Wydawca: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 权重系统（多层版 v3） =================
 * 结构：130 → 128 (GELU + LayerNorm) → 64 (GELU + LayerNorm) → 6 标签 [A/B/C/D/E/F] + Critic 价值头
 * ★ P2-39：早期文档写的 ReLU 已过时——隐藏层实际激活为 GELU，且每层做 LayerNorm。
 *   所谓"残差"并非 identity shortcut，而是同输入的并联可训练线性投影
 *   （h = GELU(W·x + W_proj·x + b)），数学上等价于 (W + W_proj)·x，
 *   维护时勿按标准残差块的恒等通路性质做假设。
 * 兼容旧 getWeights/getBias/isReady/predict 接口
 */
import { log } from '../../foundation/diag/logger.js';
import { cfg } from '../../foundation/config/util.js';  /* ★ 导入配置读取函数 */
import { setJSONQuotaSafe } from '../../foundation/storage/storage.js';  /* ★ 中央存储抽象：配额超限自动降级，写推荐性提升 */
import { DEFAULT_WEIGHTS } from './defaultWeights.js';  /* ★ 内置默认权重（由内置样本离线训练得到） */
import { safeGet as _lsGet } from '../../foundation/storage/storage.js';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */

const STORE_KEY = 'djsc_weights_v3';
const VERSION = 7;  /* ★ 版本升级：统一前向几何 + softmax温度 + 随机舍入，旧权重(饱和退化)作废重训 */
const IN_DIM = 130, HID1_DIM = 128, HID2_DIM = 64, OUT_DIM = 6;  /* ★ 修复：输入维度130，和features.js对齐 */
/* ★ §7：单一模型契约 MODEL_SCHEMA —— 版本 / 维度 / 数值类型 / 架构的唯一权威定义。
 *   DIM_CHECK、A/B 快照护栏（modelState.js 的 NET）等全部由此派生，禁止别处再手写维度。 */
const MODEL_SCHEMA = {
    version: VERSION,
    featureDim: IN_DIM,
    dims: [IN_DIM, HID1_DIM, HID2_DIM, OUT_DIM],
    dtype: { weights: 'int8', biases: 'int16', moments: 'float32' },
    architecture: { activation: 'gelu', norm: 'layernorm', residual: true, critic: true },
};

/* ★ 数据纪元（数据隔离）：旧版本样本存在 reward 写入 bug（reward 恒 ~100 与 meta.score 脱节），
 * 客户设备上"旧版本自己打 + 手动训练"得到的权重参数本身已被污染——版本号 v7 只能挡结构不兼容，
 * 挡不住"结构对但标签脏"。故引入数据纪元：凡 v7 存档缺 dv 标记且 trained>0，
 * 说明它由未经隔离清洗的旧数据训成，loadWeights 一律拒载回退内置默认权重，实现新旧数据隔离。
 * 本版本起 saveWeights 统一写入 dv=DATA_EPOCH；默认权重等 trained=0 的存档不受影响。 */
const DATA_EPOCH = 2;
/* ★ 导出网络输入维度，供 index.js 做"特征契约自检"（weights.IN_DIM vs features.FEATURE_DIM） */
const DIM_CHECK = {
    input: MODEL_SCHEMA.featureDim, dim: MODEL_SCHEMA.featureDim,
    hid1: MODEL_SCHEMA.dims[1], hid2: MODEL_SCHEMA.dims[2], out: MODEL_SCHEMA.dims[3],
    check: function () { return this.input === 130 && this.dim === 130 && this.hid1 === 128 && this.hid2 === 64 && this.out === 6; }
};
export { DIM_CHECK, MODEL_SCHEMA };
const SCALE = 128;
/* ★ softmax 温度：把 ±40~60 的原始 logits 压回 ±5~7.5，杜绝 softmax 完全饱和。
 * 饱和时 probs=[1,0,...]，标签平滑后正确类梯度方向会反转(prob>target→压正确logit)，模型反向学习；
 * 加温后 probs 回归合理区间，梯度方向正确且显著，隐藏层才真正学到东西。
 * argmax 对温度不变，推理标签不变；置信度/概率被校准，解决"冲突检测疯狂报警"。 */
const SOFTMAX_T = 8;
const DEFAULT_LR = 0.02;  /* ★ 默认学习率：步长乘子 0.005→0.02，Int8 权重才推得动 */
const BETA1 = 0.9;  /* ★ AdamW 一阶矩衰减 */
const BETA2 = 0.99;  /* ★ AdamW 二阶矩衰减：0.999→0.99，二阶矩更快遗忘，避免符号翻转后权重被 v 永久冻死 */
const EPS = 1e-8;  /* ★ AdamW 数值稳定项 */
const WEIGHT_DECAY = 0.001;  /* ★ L2 权重衰减，防止过拟合 */
let adamT = 0;  /* ★ AdamW 时间步 */

/* ★ 从配置读取学习率 */
function _getLearningRate() {
    try {
        const lr = parseFloat(cfg('learningRate', DEFAULT_LR));
        if (isNaN(lr) || lr <= 0) return DEFAULT_LR;
        return Math.min(0.05, Math.max(0.0005, lr));  /* 支持 0.0005~0.05（提高上限配合Int8随机舍入） */
    } catch (e) {
        return DEFAULT_LR;
    }
}

export const LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];
const SMOOTH = 0.05;  /* ★ 标签平滑：防止 softmax 饱和导致梯度消失，提升泛化 */

let W1 = null, B1 = null;   // 130*128, 128
let W2 = null, B2 = null;   // 128*64, 64
let W3 = null, B3 = null;   // 64*6, 6 (Actor头)
let W4 = null, B4 = null;   // 64*1, 1 (Critic头：价值评估) ★ 新增
let W_proj1 = null;  /* ★ 残差连接1：130→128 投影矩阵 */
let W_proj2 = null;  /* ★ 残差连接2：128→64 投影矩阵 */
let mW1 = null, mB1 = null;  /* ★ AdamW 一阶矩 m */
let mW2 = null, mB2 = null;
let mW3 = null, mB3 = null;
let mW4 = null, mB4 = null;  /* ★ Critic头的一阶矩 */
let mW_proj1 = null, mW_proj2 = null;  /* ★ 投影矩阵的一阶矩 */
let vW1 = null, vB1 = null;  /* ★ AdamW 二阶矩 v */
let vW2 = null, vB2 = null;
let vW3 = null, vB3 = null;
let vW4 = null, vB4 = null;  /* ★ Critic头的二阶矩 */
let vW_proj1 = null, vW_proj2 = null;  /* ★ 投影矩阵的二阶矩 */
let currentLR = _getLearningRate();  /* 当前学习率（从配置读取） */
let META = { version: VERSION, trained: 0, accuracy: 0, ready: false };

/* ---------- 初始化 ---------- */
function _initRandom() {
    W1 = new Int8Array(IN_DIM * HID1_DIM);
    B1 = new Int16Array(HID1_DIM);
    W2 = new Int8Array(HID1_DIM * HID2_DIM);
    B2 = new Int16Array(HID2_DIM);
    W3 = new Int8Array(HID2_DIM * OUT_DIM);
    B3 = new Int16Array(OUT_DIM);
    W4 = new Int8Array(HID2_DIM * 1);  /* ★ Critic头：64*1 */
    B4 = new Int16Array(1);              /* ★ Critic头偏置：1维 */
    W_proj1 = new Int8Array(IN_DIM * HID1_DIM);  /* ★ 残差连接1：130→128 */
    W_proj2 = new Int8Array(HID1_DIM * HID2_DIM);  /* ★ 残差连接2：128→64 */
    
    /* ★ AdamW 一阶矩 m 和二阶矩 v 初始化 */
    mW1 = new Float32Array(IN_DIM * HID1_DIM);
    mB1 = new Float32Array(HID1_DIM);
    mW2 = new Float32Array(HID1_DIM * HID2_DIM);
    mB2 = new Float32Array(HID2_DIM);
    mW3 = new Float32Array(HID2_DIM * OUT_DIM);
    mB3 = new Float32Array(OUT_DIM);
    mW4 = new Float32Array(HID2_DIM * 1);  /* ★ Critic头的一阶矩 */
    mB4 = new Float32Array(1);              /* ★ Critic头偏置的一阶矩 */
    mW_proj1 = new Float32Array(IN_DIM * HID1_DIM);  /* ★ 投影矩阵1的一阶矩 */
    mW_proj2 = new Float32Array(HID1_DIM * HID2_DIM);  /* ★ 投影矩阵2的一阶矩 */
    vW1 = new Float32Array(IN_DIM * HID1_DIM);
    vB1 = new Float32Array(HID1_DIM);
    vW2 = new Float32Array(HID1_DIM * HID2_DIM);
    vB2 = new Float32Array(HID2_DIM);
    vW3 = new Float32Array(HID2_DIM * OUT_DIM);
    vB3 = new Float32Array(OUT_DIM);
    vW4 = new Float32Array(HID2_DIM * 1);  /* ★ Critic头的二阶矩 */
    vB4 = new Float32Array(1);              /* ★ Critic头偏置的二阶矩 */
    vW_proj1 = new Float32Array(IN_DIM * HID1_DIM);  /* ★ 投影矩阵1的二阶矩 */
    vW_proj2 = new Float32Array(HID1_DIM * HID2_DIM);  /* ★ 投影矩阵2的二阶矩 */
    adamT = 0;  /* ★ AdamW 时间步重置 */
    
    /* ★ 细化：缩小初始化方差（SCALE/12），避免极端 logits 在 GELU/LayerNorm 前的数值冲击，
     * 同时让 Int8 更新步长相对更显著、训练更稳（随机舍入期望步长不变）。 */
    const lim = Math.max(1, Math.floor(SCALE / 12));
    for (let i = 0; i < W1.length; i++) W1[i] = ((Math.random() * 2 - 1) * lim) | 0;
    for (let i = 0; i < W2.length; i++) W2[i] = ((Math.random() * 2 - 1) * lim) | 0;
    for (let i = 0; i < W3.length; i++) W3[i] = ((Math.random() * 2 - 1) * lim) | 0;
    for (let i = 0; i < W4.length; i++) W4[i] = ((Math.random() * 2 - 1) * lim / 2) | 0;  /* ★ Critic头初始值小一点 */
    for (let i = 0; i < W_proj1.length; i++) W_proj1[i] = ((Math.random() * 2 - 1) * lim / 4) | 0;  /* ★ 投影矩阵初始值小一点 */
    for (let i = 0; i < W_proj2.length; i++) W_proj2[i] = ((Math.random() * 2 - 1) * lim / 4) | 0;  /* ★ 投影矩阵初始值小一点 */
    
    currentLR = _getLearningRate();  /* 重置学习率（从配置读取） */
    META.ready = false;
}

/* ★ 生成指定长度的随机残差投影矩阵（旧存档缺 pr1/pr2 时兜底，避免 ReferenceError 触发整包随机化） */
function _initRandomPrj(len) {
    const n = (typeof len === 'number' && len > 0) ? len : (IN_DIM * HID1_DIM);
    const arr = new Int8Array(n);
    const lim = Math.max(1, Math.floor(SCALE / 12));
    for (let i = 0; i < n; i++) arr[i] = ((Math.random() * 2 - 1) * lim / 4) | 0;
    return arr;
}

/* ★ 载入内置默认权重（离线训练所得）：fail-closed。
 *   P0-03：此前先 _initRandom() 再检查版本，v6≠v7 时静默保留随机权重，调用方却打印
 *   “已载入内置默认权重（离线预训练）”，导致“显示预训练、实际随机”。
 *   现在：先整体解码到局部变量（任一失败即原子失败），全部通过后才覆盖当前权重并置 ready；
 *   失败时仅做随机兜底以保证不崩溃，但 ready=false 且记录诊断 _defaultDiag，绝不谎报已载入。 */
let _defaultDiag = null;  /* 最近一次内置默认权重加载诊断（null 表示成功） */
/* ★ 仅解码内置默认权重到局部副本，不触碰任何在线参数（失败只写诊断，返回 null）。
 *   resetWeights 与冷启动共用同一解码口径，杜绝"reset 失败却把在线模型随机化"。 */
function _decodeDefault() {
    const d = DEFAULT_WEIGHTS;
    if (!d) { _defaultDiag = 'DEFAULT_WEIGHTS 缺失'; return null; }
    if (d.v !== VERSION) {
        _defaultDiag = '内置默认权重版本 v' + d.v + ' 与运行时 v' + VERSION + ' 不一致';
        return null;
    }
    try {
        /* 全部先解码到局部变量，任一 shape 不符即抛错 → 不产生半解码副本 */
        const snap = {
            W1: _decodeInt8(d.w1, IN_DIM * HID1_DIM),
            B1: _decodeInt16(d.b1, HID1_DIM),
            W2: _decodeInt8(d.w2, HID1_DIM * HID2_DIM),
            B2: _decodeInt16(d.b2, HID2_DIM),
            W3: _decodeInt8(d.w3, HID2_DIM * OUT_DIM),
            B3: _decodeInt16(d.b3, OUT_DIM),
            W4: _decodeInt8(d.w4, HID2_DIM * 1),
            B4: _decodeInt16(d.b4, 1),
            W_proj1: _decodeInt8(d.pr1, IN_DIM * HID1_DIM),
            W_proj2: _decodeInt8(d.pr2, HID1_DIM * HID2_DIM),
            trained: d.trained || 0,
            accuracy: d.accuracy || 0,
        };
        _defaultDiag = null;
        return snap;
    } catch (e) {
        _defaultDiag = '内置默认权重解码失败: ' + ((e && e.message) ? e.message : e);
        return null;
    }
}

/* ★ 把已校验的默认快照原子提交到在线参数（调用方必须已通过 _decodeDefault 校验） */
function _commitDefault(s) {
    _initRandom();  /* 分配 AdamW 动量/二阶矩等伴随数组 */
    W1 = s.W1; B1 = s.B1; W2 = s.W2; B2 = s.B2; W3 = s.W3; B3 = s.B3;
    W4 = s.W4; B4 = s.B4; W_proj1 = s.W_proj1; W_proj2 = s.W_proj2;
    META.trained = s.trained;
    META.accuracy = s.accuracy;
    META.ready = true;
}

function _applyDefault() {
    const s = _decodeDefault();
    if (s) {
        _commitDefault(s);
        return true;
    }
    /* 冷启动兜底：没有"当前权重"可保留，只能随机化防崩，但明确未就绪并保留诊断 */
    _initRandom();
    META.ready = false;
    return false;
}

/* ---------- 加载/保存 ---------- */
export function loadWeights() {
    try {
        const raw = _lsGet(STORE_KEY);
        if (!raw) {
            const ok = _applyDefault();
            try {
                if (ok) log.info('weights', '无存档 → 已载入内置默认权重（离线预训练，开箱即用）');
                else log.warn('weights', '无存档且内置默认权重不可用（' + _defaultDiag + '）→ 模型未就绪，请重新训练或更新默认权重');
            } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
            return false;
        }
        const obj = JSON.parse(raw);
        if (!obj || obj.v !== VERSION) {
            const ok = _applyDefault();
            try {
                if (ok) log.info('weights', '存档版本 v' + (obj && obj.v) + ' ≠ 运行时 v' + VERSION + ' → 已载入内置默认权重');
                else log.warn('weights', '存档版本不匹配且内置默认权重不可用（' + _defaultDiag + '）→ 模型未就绪');
            } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
            return false;
        }
        /* ★ 数据隔离：v7 但缺数据纪元标记且有训练量的存档 = 旧版本污染数据训成 → 拒载回退 */
        if ((obj.dv || 1) < DATA_EPOCH && (obj.trained || 0) > 0) {
            const ok = _applyDefault();
            try {
                if (ok) log.info('weights', '存档数据纪元 dv=' + (obj.dv || 1) + ' < ' + DATA_EPOCH + '（旧版本污染数据训练，trained=' + obj.trained + '）→ 已拒载并回退内置默认权重');
                else log.warn('weights', '存档数据纪元过旧且内置默认权重不可用（' + _defaultDiag + '）→ 模型未就绪，请重新训练');
            } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
            return false;
        }
        /* ★ P0-04：按真实 dtype 解码（Int8 权重 / Int16 偏置），shape 不符直接抛错 → 走 fail-closed */
        W1 = _decodeInt8(obj.w1, IN_DIM * HID1_DIM); B1 = _decodeInt16(obj.b1, HID1_DIM);
        W2 = _decodeInt8(obj.w2, HID1_DIM * HID2_DIM); B2 = _decodeInt16(obj.b2, HID2_DIM);
        W3 = _decodeInt8(obj.w3, HID2_DIM * OUT_DIM); B3 = _decodeInt16(obj.b3, OUT_DIM);
        /* ★ 加载Critic头权重（如果旧版本没有就随机初始化） */
        if (obj.w4 && obj.b4) {
            W4 = _decodeInt8(obj.w4, HID2_DIM * 1); B4 = _decodeInt16(obj.b4, 1);
        } else {
            W4 = new Int8Array(HID2_DIM * 1);
            B4 = new Int16Array(1);
            for (let i = 0; i < W4.length; i++) W4[i] = 0;
            for (let i = 0; i < B4.length; i++) B4[i] = 0;
        }
        /* ★ 加载残差投影（旧存档没有则重用当前/随机，避免 NaN 崩坏） */
        W_proj1 = (obj.pr1 && _decodeInt8(obj.pr1, IN_DIM * HID1_DIM).length === IN_DIM * HID1_DIM) ? _decodeInt8(obj.pr1, IN_DIM * HID1_DIM) : (W_proj1 || _initRandomPrj(IN_DIM * HID1_DIM));
        W_proj2 = (obj.pr2 && _decodeInt8(obj.pr2, HID1_DIM * HID2_DIM).length === HID1_DIM * HID2_DIM) ? _decodeInt8(obj.pr2, HID1_DIM * HID2_DIM) : (W_proj2 || _initRandomPrj(HID1_DIM * HID2_DIM));
        META.trained = obj.trained || 0;
        META.accuracy = obj.accuracy || 0;
        META.ready = !!obj.ready;
        try { log.info('weights', '已加载权重（含Critic头），训练次数=' + META.trained); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        return true;
    } catch (e) {
        const ok = _applyDefault();
        try { if (!ok) log.warn('weights', '存档解析失败且内置默认权重不可用（' + _defaultDiag + '）→ 模型未就绪'); } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
        return false;
    }
}
export function saveWeights() {
    try {
        const obj = {
            v: VERSION,
            dv: DATA_EPOCH,   /* ★ 数据纪元：标记本存档由隔离清洗后的数据训成 */
            w1: _encodeTyped(W1), b1: _encodeTyped(B1),
            w2: _encodeTyped(W2), b2: _encodeTyped(B2),
            w3: _encodeTyped(W3), b3: _encodeTyped(B3),
            w4: _encodeTyped(W4), b4: _encodeTyped(B4),  /* ★ 保存Critic头 */
            pr1: _encodeTyped(W_proj1), pr2: _encodeTyped(W_proj2),  /* ★ 保存残差投影（开启 useResidual 时训练所得） */
            trained: META.trained, accuracy: META.accuracy, ready: META.ready,
        };
        /* ★ 走中央存储：配额超限自动降级，绝不因写失败抛错打扰对局 */
        setJSONQuotaSafe(STORE_KEY, obj);
        return true;
    } catch (e) { return false; }
}

/* ---------- Base64 编解码（分类型：Int8 权重 vs Int16 偏置） ----------
 * ★ P0-04：此前所有数组统一按 Int8 解码，Int16 偏置 (B1/B2/B3/B4) 会被拆成两倍长度的
 *   Int8 数组，bias 几何每次重载都错位。现按真实 dtype 解码并做长度校验：校验失败抛错，
 *   由调用方 fail-closed 处理，绝不静默接受错位参数。 */
function _toBytes(str) {
    if (!str) return new Uint8Array(0);
    const bin = atob(str);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}
/* 编码与 dtype 无关：直接写原始字节序列（Int8/Int16 通用） */
function _encodeTyped(arr) {
    if (!arr) return '';
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}
function _decodeInt8(str, expectedLen) {
    const bytes = _toBytes(str);
    const out = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (expectedLen !== undefined && out.length !== expectedLen) {
        throw new Error('Int8 shape mismatch: ' + out.length + ' != ' + expectedLen);
    }
    return out;
}
function _decodeInt16(str, expectedLen) {
    const bytes = _toBytes(str);
    if (bytes.byteLength % 2 !== 0) throw new Error('Int16 byte length odd: ' + bytes.byteLength);
    const out = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    if (expectedLen !== undefined && out.length !== expectedLen) {
        throw new Error('Int16 shape mismatch: ' + out.length + ' != ' + expectedLen);
    }
    return out;
}

/* ---------- GELU 激活函数（近似版） ---------- */
function gelu(x) {
    return 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x * x * x)));
}
/* ★ 细化：GELU 导数（用于隐藏层反向传播，此前用恒等近似，梯度几何不准） */
function geluDeriv(x) {
    const a = Math.sqrt(2 / Math.PI), b = 0.044715;
    const u = a * (x + b * x * x * x);
    const t = Math.tanh(u);
    const sech2 = 1 - t * t;
    return 0.5 * (1 + t) + 0.5 * x * sech2 * a * (1 + 3 * b * x * x);
}

/* ★ 细化：Layer Normalization 统计（返回均值/标准差/归一化输出） */
function _lnStats(x) {
    let μ = 0;
    for (let i = 0; i < x.length; i++) μ += x[i];
    μ /= x.length;
    let varr = 0;
    for (let i = 0; i < x.length; i++) varr += (x[i] - μ) * (x[i] - μ);
    varr /= x.length;
    const σ = Math.sqrt(varr + 1e-8);
    const out = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = (x[i] - μ) / σ;
    return { mean: μ, std: σ, out: out };
}
/* ★ 细化：Layer Normalization 反向传播
 * 给定对归一化输出的梯度 dY 与归一化值 y(hn)，返回对归一化前输入的梯度（已含 1/σ）。 */
function _lnBack(dY, y, std) {
    const N = y.length;
    if (N === 0) return new Float32Array(0);
    let s = 0, sy = 0;
    for (let i = 0; i < N; i++) { s += dY[i]; sy += dY[i] * y[i]; }
    const inv = 1 / N;
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) out[i] = (dY[i] - inv * s - inv * y[i] * sy) / std;
    return out;
}

/* ★ 保证 AdamW 动量/二阶矩数组一定已分配。
 * 关键缺陷：loadWeights() 的"版本匹配加载"路径只赋 W/B，从不分配马氏动量与二阶矩数组，
 * 导致有存档的情况下 mW3 等为 null，trainOne* 首行访问即抛错 → 静默 return false → 权重永不更新。
 * 该函数在训练前兜底补齐，使恢复存档后仍可正常训练。 */
function _ensureAdam() {
    if (mW1 && vW1 && mW2 && vW2 && mW3 && vW3 && mW4 && vW4) return;
    if (!mW1) mW1 = new Float32Array(IN_DIM * HID1_DIM);
    if (!mB1) mB1 = new Float32Array(HID1_DIM);
    if (!vW1) vW1 = new Float32Array(IN_DIM * HID1_DIM);
    if (!vB1) vB1 = new Float32Array(HID1_DIM);
    if (!mW2) mW2 = new Float32Array(HID1_DIM * HID2_DIM);
    if (!mB2) mB2 = new Float32Array(HID2_DIM);
    if (!vW2) vW2 = new Float32Array(HID1_DIM * HID2_DIM);
    if (!vB2) vB2 = new Float32Array(HID2_DIM);
    if (!mW3) mW3 = new Float32Array(HID2_DIM * OUT_DIM);
    if (!mB3) mB3 = new Float32Array(OUT_DIM);
    if (!vW3) vW3 = new Float32Array(HID2_DIM * OUT_DIM);
    if (!vB3) vB3 = new Float32Array(OUT_DIM);
    if (!mW4) mW4 = new Float32Array(HID2_DIM * 1);
    if (!mB4) mB4 = new Float32Array(1);
    if (!vW4) vW4 = new Float32Array(HID2_DIM * 1);
    if (!vB4) vB4 = new Float32Array(1);
    if (!mW_proj1) mW_proj1 = new Float32Array(IN_DIM * HID1_DIM);
    if (!vW_proj1) vW_proj1 = new Float32Array(IN_DIM * HID1_DIM);
    if (!mW_proj2) mW_proj2 = new Float32Array(HID1_DIM * HID2_DIM);
    if (!vW_proj2) vW_proj2 = new Float32Array(HID1_DIM * HID2_DIM);
}

/* ★ 统一训练前向：与推理 forwardFastWithValue 同口径，但额外缓存 GELU 前激活与 LN 统计，
 * 使隐藏层反向传播能用上真实导数（GELU' + LN'），而非线性近似。 */
function _forwardForTrain(features) {
    const I = IN_DIM, H1 = HID1_DIM, H2 = HID2_DIM, O = OUT_DIM;
    const useRes = (typeof cfg === 'function') ? cfg('useResidual', false) : false;
    const h1raw = new Float32Array(H1);
    for (let j = 0; j < H1; j++) {
        let sum = 0; const base = j * I;
        for (let i = 0; i < I; i++) sum += W1[base + i] * features[i];
        if (useRes) for (let i = 0; i < I; i++) sum += W_proj1[base + i] * features[i];
        h1raw[j] = (sum + B1[j] * SCALE) / SCALE;
    }
    const h1g = new Float32Array(H1);
    for (let j = 0; j < H1; j++) h1g[j] = gelu(h1raw[j]);
    const ln1 = _lnStats(h1g);
    const hn1 = ln1.out;

    const h2raw = new Float32Array(H2);
    for (let j = 0; j < H2; j++) {
        let sum = 0; const base = j * H1;
        for (let i = 0; i < H1; i++) sum += W2[base + i] * hn1[i];
        if (useRes) for (let i = 0; i < H1; i++) sum += W_proj2[base + i] * hn1[i];
        h2raw[j] = (sum + B2[j] * SCALE) / SCALE;
    }
    const h2g = new Float32Array(H2);
    for (let j = 0; j < H2; j++) h2g[j] = gelu(h2raw[j]);
    const ln2 = _lnStats(h2g);
    const hn2 = ln2.out;

    const actorLogits = new Float32Array(O);
    for (let k = 0; k < O; k++) {
        let sum = 0; const base = k * H2;
        for (let j = 0; j < H2; j++) sum += W3[base + j] * hn2[j];
        actorLogits[k] = (sum + B3[k] * SCALE) / SCALE;
    }
    let valueRaw = 0;
    for (let j = 0; j < H2; j++) valueRaw += W4[j] * hn2[j];
    valueRaw = (valueRaw + B4[0] * SCALE) / SCALE;

    return { actorLogits: actorLogits, value: Math.tanh(valueRaw), valueRaw: valueRaw, hn1: hn1, hn2: hn2, h1raw: h1raw, h2raw: h2raw, ln1: ln1, ln2: ln2 };
}

/* 对某个参数做一次 AdamW 步进（含 Int8 随机舍入）——负责 m/v + 随机舍入 + weight decay */
function _adamStep(W, m, v, idx, grad, lr, bc1, bc2) {
    m[idx] = BETA1 * m[idx] + (1 - BETA1) * grad;
    v[idx] = BETA2 * v[idx] + (1 - BETA2) * grad * grad;
    const mHat = m[idx] / bc1;
    const vHat = v[idx] / bc2;
    const wd = Math.round(lr * WEIGHT_DECAY * W[idx]);
    return _clamp((W[idx] - wd) - _qstep(lr * mHat / (Math.sqrt(vHat) + EPS) * SCALE));
}
function _adamStepB(B, m, v, idx, grad, lr, bc1, bc2) {
    m[idx] = BETA1 * m[idx] + (1 - BETA1) * grad;
    v[idx] = BETA2 * v[idx] + (1 - BETA2) * grad * grad;
    const mHat = m[idx] / bc1;
    const vHat = v[idx] / bc2;
    const wd = Math.round(lr * WEIGHT_DECAY * B[idx]);
    return _clamp16((B[idx] - wd) - _qstep(lr * mHat / (Math.sqrt(vHat) + EPS) * SCALE));
}

/* ================= 统一反向传播+更新：Actor(CEL逆温) + Critic(MSE) + 全部隐藏层(GELU'/LN') =================
 * ★ P1-17：标准反向传播要求同一步梯度都对应同一 forward 参数快照。
 *   旧实现"先更新 W4/W3 → 再用新 W3/W4 求 dHn2 → 更新 W2 → 再用新 W2 求 dHn1"，
 *   引入顺序依赖与额外噪声。现分两阶段：
 *     ① 全程只用 forward 时的旧权重，算完所有层梯度（dHn2/dH2raw/dHn1/dH1raw）；
 *     ② 梯度全部就绪后，再统一对各参数做 AdamW 更新。 */
/* ★ 梯度暂存缓冲（模块级复用，避免每步训练分配 ~41k 浮点数组造成 GC 压力）。
 *   仅 _computeGrads 写、_applyGrads / __gradientsForTest 读。 */
let gW1 = null, gB1 = null, gW2 = null, gB2 = null, gW3 = null, gB3 = null, gW4 = null, gB4 = null, gPr1 = null, gPr2 = null;
function _ensureGrads() {
    if (gW1) return;
    gW1 = new Float32Array(IN_DIM * HID1_DIM); gB1 = new Float32Array(HID1_DIM);
    gW2 = new Float32Array(HID1_DIM * HID2_DIM); gB2 = new Float32Array(HID2_DIM);
    gW3 = new Float32Array(HID2_DIM * OUT_DIM); gB3 = new Float32Array(OUT_DIM);
    gW4 = new Float32Array(HID2_DIM * 1); gB4 = new Float32Array(1);
    gPr1 = new Float32Array(IN_DIM * HID1_DIM); gPr2 = new Float32Array(HID1_DIM * HID2_DIM);
}

/* ① 梯度计算：全程只读 forward 时的参数快照，结果写入暂存缓冲；返回 useRes 供更新阶段使用 */
function _computeGrads(features, r, dLogits, dVraw) {
    const I = IN_DIM, H1 = HID1_DIM, H2 = HID2_DIM, O = OUT_DIM;
    const useRes = (typeof cfg === 'function') ? cfg('useResidual', false) : false;
    _ensureGrads();
    const hn1 = r.hn1, hn2 = r.hn2, h1raw = r.h1raw, h2raw = r.h2raw;

    /* ---- ① 基于旧权重计算全部梯度 ---- */
    const dV = (dVraw !== 0) ? dVraw * Math.max(0.1, (1 - r.value * r.value)) : 0;  /* tanh保底梯度 */
    const criticW = (dVraw !== 0) ? 0.5 : 0;

    /* 对 hn2 的总梯度（Actor + 0.5*Critic），用旧 W3/W4 */
    const dHn2 = new Float32Array(H2);
    for (let j = 0; j < H2; j++) {
        let s = 0;
        for (let k = 0; k < O; k++) s += dLogits[k] * (W3[k * H2 + j] / SCALE);
        s += criticW * dV * (W4[j] / SCALE);
        dHn2[j] = s;
    }
    /* LN2 → GELU2 反传 */
    const dPreLN2 = _lnBack(dHn2, hn2, r.ln2.std);
    const dH2raw = new Float32Array(H2);
    for (let j = 0; j < H2; j++) dH2raw[j] = dPreLN2[j] * geluDeriv(h2raw[j]);

    /* 对 hn1 的梯度，用旧 W2 */
    const dHn1 = new Float32Array(H1);
    for (let j = 0; j < H2; j++) {
        const base = j * H1;
        for (let i = 0; i < H1; i++) dHn1[i] += dH2raw[j] * (W2[base + i] / SCALE);
    }
    /* LN1 → GELU1 反传 */
    const dPreLN1 = _lnBack(dHn1, hn1, r.ln1.std);
    const dH1raw = new Float32Array(H1);
    for (let j = 0; j < H1; j++) dH1raw[j] = dPreLN1[j] * geluDeriv(h1raw[j]);

    /* 各参数梯度写入暂存缓冲（沿用既有逐层量化口径：W1/W_proj 梯度带 1/SCALE，其余为浮点梯度） */
    for (let j = 0; j < H2; j++) gW4[j] = dV * hn2[j];
    gB4[0] = dV;
    for (let k = 0; k < O; k++) {
        const base = k * H2;
        for (let j = 0; j < H2; j++) gW3[base + j] = dLogits[k] * hn2[j];
        gB3[k] = dLogits[k];
    }
    for (let j = 0; j < H2; j++) {
        const base = j * H1;
        for (let i = 0; i < H1; i++) {
            const g = dH2raw[j] * hn1[i];
            gW2[base + i] = g;
            gPr2[base + i] = useRes ? g : 0;
        }
        gB2[j] = dH2raw[j];
    }
    /* raw=ΣW1·f/SCALE → dW1=dH1raw·f/SCALE */
    for (let j = 0; j < H1; j++) {
        const base = j * I;
        for (let i = 0; i < I; i++) {
            const g = dH1raw[j] * (features[i] / SCALE);
            gW1[base + i] = g;
            gPr1[base + i] = useRes ? g : 0;
        }
        gB1[j] = dH1raw[j];
    }
    return { useRes: useRes, dHn2: dHn2, dH2raw: dH2raw, dHn1: dHn1, dH1raw: dH1raw };
}

/* ② 参数更新：梯度已全部就绪，统一 AdamW 步进（顺序不再影响梯度几何） */
function _applyGrads(lr, bc1, bc2, useRes, withCritic) {
    const I = IN_DIM, H1 = HID1_DIM, H2 = HID2_DIM, O = OUT_DIM;
    if (withCritic) {
        for (let j = 0; j < H2; j++) W4[j] = _adamStep(W4, mW4, vW4, j, gW4[j], lr, bc1, bc2);
        B4[0] = _adamStepB(B4, mB4, vB4, 0, gB4[0], lr, bc1, bc2);
    }
    for (let k = 0; k < O; k++) {
        const base = k * H2;
        for (let j = 0; j < H2; j++) W3[base + j] = _adamStep(W3, mW3, vW3, base + j, gW3[base + j], lr, bc1, bc2);
        B3[k] = _adamStepB(B3, mB3, vB3, k, gB3[k], lr, bc1, bc2);
    }
    for (let j = 0; j < H2; j++) {
        const base = j * H1;
        for (let i = 0; i < H1; i++) {
            W2[base + i] = _adamStep(W2, mW2, vW2, base + i, gW2[base + i], lr, bc1, bc2);
            if (useRes) W_proj2[base + i] = _adamStep(W_proj2, mW_proj2, vW_proj2, base + i, gPr2[base + i], lr, bc1, bc2);
        }
        B2[j] = _adamStepB(B2, mB2, vB2, j, gB2[j], lr, bc1, bc2);
    }
    /* raw=ΣW1·f/SCALE → dW1=dH1raw·f/SCALE */
    for (let j = 0; j < H1; j++) {
        const base = j * I;
        for (let i = 0; i < I; i++) {
            W1[base + i] = _adamStep(W1, mW1, vW1, base + i, gW1[base + i], lr, bc1, bc2);
            if (useRes) W_proj1[base + i] = _adamStep(W_proj1, mW_proj1, vW_proj1, base + i, gPr1[base + i], lr, bc1, bc2);
        }
        B1[j] = _adamStepB(B1, mB1, vB1, j, gB1[j], lr, bc1, bc2);
    }
}

function _backwardAndUpdate(features, r, dLogits, dVraw, lr, bc1, bc2) {
    const g = _computeGrads(features, r, dLogits, dVraw);
    _applyGrads(lr, bc1, bc2, g.useRes, dVraw !== 0);  /* ★ dVraw=0 时 Critic 头不更新（含权重衰减），与历史行为一致 */
}

/* ★ 仅供发布门禁（tests/run_tests.mjs §10.5）：纯读梯度计算——
 *   跑一遍训练前向 + 梯度阶段，返回全部参数梯度的副本；
 *   不触碰权重 / 动量 / adamT，可安全用于有限差分比对。
 *   返回梯度与内部更新口径一致：gW1/gPr1 带 1/SCALE 因子，其余为浮点梯度。 */
export function __gradientsForTest(features, labelIdx, valueTarget) {
    try {
        if (!features || labelIdx < 0 || labelIdx >= OUT_DIM) return null;
        const r = _forwardForTrain(features);
        if (!r) return null;
        const probs = softmax(r.actorLogits);
        const dLogits = new Float32Array(OUT_DIM);
        for (let k = 0; k < OUT_DIM; k++) {
            const target = (k === labelIdx) ? (1 - SMOOTH) : (SMOOTH / OUT_DIM);
            dLogits[k] = (probs[k] - target) / SOFTMAX_T;
        }
        const dVraw = (typeof valueTarget === 'number' && isFinite(valueTarget)) ? (r.value - valueTarget) : 0;
        const cg = _computeGrads(features, r, dLogits, dVraw);
        const dV = (dVraw !== 0) ? dVraw * Math.max(0.1, (1 - r.value * r.value)) : 0;
        return {
            gW1: Array.from(gW1), gB1: Array.from(gB1),
            gW2: Array.from(gW2), gB2: Array.from(gB2),
            gW3: Array.from(gW3), gB3: Array.from(gB3),
            gW4: Array.from(gW4), gB4: Array.from(gB4),
            gPr1: Array.from(gPr1), gPr2: Array.from(gPr2),
            dV: dV, useRes: cg.useRes,
            logits: Array.from(r.actorLogits), value: r.value,
            dLogits: Array.from(dLogits),
            dHn2: Array.from(cg.dHn2), dH2raw: Array.from(cg.dH2raw),
            dHn1: Array.from(cg.dHn1), dH1raw: Array.from(cg.dH1raw),
            hn1: Array.from(r.hn1), hn2: Array.from(r.hn2),
            h1raw: Array.from(r.h1raw), h2raw: Array.from(r.h2raw),
            ln1std: r.ln1.std, ln2std: r.ln2.std,
        };
    } catch (e) { return null; }
}

/* ---------- 前向传播 ---------- */
export function forward(features, outBuf) {
    try {
        if (!W1 || !features) return null;
        const I = IN_DIM, H1 = HID1_DIM, H2 = HID2_DIM, O = OUT_DIM;
        const useRes = (typeof cfg === 'function') ? cfg('useResidual', false) : false;  /* ★ 修复：此前 useRes 未声明导致 ReferenceError → 校验准确率恒为0 */
        
        /* 第一层：130 → 128 */
        const hidden1 = new Float32Array(H1);
        for (let j = 0; j < H1; j++) {
            let sum = 0;
            const base = j * I;
            for (let i = 0; i < I; i++) sum += W1[base + i] * features[i];
            /* ★ P1-18：补上第一层的 W_proj1 残差分支，与 forwardWithValue/forwardFastWithValue/_forwardForTrain 同口径，
             *   否则 useResidual=true 时验证准确率（本函数）与真实推理不是同一个模型函数 */
            if (useRes) {
                for (let i = 0; i < I; i++) sum += W_proj1[base + i] * features[i];
            }
            hidden1[j] = (sum + B1[j] * SCALE) / SCALE;
        }
        for (let j = 0; j < H1; j++) hidden1[j] = gelu(hidden1[j]);  /* GELU 激活函数 */

        /* ★ Layer Normalization（第一层） */
        let mean1 = 0;
        for (let j = 0; j < H1; j++) mean1 += hidden1[j];
        mean1 /= H1;
        let var1 = 0;
        for (let j = 0; j < H1; j++) var1 += (hidden1[j] - mean1) * (hidden1[j] - mean1);
        var1 /= H1;
        const std1 = Math.sqrt(var1 + 1e-8);
        for (let j = 0; j < H1; j++) hidden1[j] = (hidden1[j] - mean1) / std1;
        
        /* 第二层：128 → 64 */
        const hidden2 = new Float32Array(H2);
        for (let j = 0; j < H2; j++) {
            let sum = 0;
            const base = j * H1;
            for (let i = 0; i < H1; i++) sum += W2[base + i] * hidden1[i];
            if (useRes) {
                for (let i = 0; i < H1; i++) sum += W_proj2[base + i] * hidden1[i];
            }
            hidden2[j] = (sum + B2[j] * SCALE) / SCALE;
        }
        for (let j = 0; j < H2; j++) hidden2[j] = gelu(hidden2[j]);  /* GELU 激活函数 */

        /* ★ Layer Normalization（第二层） */
        let mean2 = 0;
        for (let j = 0; j < H2; j++) mean2 += hidden2[j];
        mean2 /= H2;
        let var2 = 0;
        for (let j = 0; j < H2; j++) var2 += (hidden2[j] - mean2) * (hidden2[j] - mean2);
        var2 /= H2;
        const std2 = Math.sqrt(var2 + 1e-8);
        for (let j = 0; j < H2; j++) hidden2[j] = (hidden2[j] - mean2) / std2;
        
        /* 输出层：64 → 6 (Actor头) */
        const out = outBuf || new Float32Array(O);
        for (let k = 0; k < O; k++) {
            let sum = 0;
            const base = k * H2;
            for (let j = 0; j < H2; j++) sum += W3[base + j] * hidden2[j];
            out[k] = (sum + B3[k] * SCALE) / SCALE;
        }
        return out;
    } catch (e) { return null; }
}

/* ★ 前向传播（带Critic头）：同时输出Actor logits和Value估值 */
export function forwardWithValue(features) {
    try {
        if (!W1 || !features) return null;
        const I = IN_DIM, H1 = HID1_DIM, H2 = HID2_DIM, O = OUT_DIM;
        const useRes = (typeof cfg === 'function') ? cfg('useResidual', false) : false;
        
        /* 第一层：130 → 128 */
        const hidden1 = new Float32Array(H1);
        for (let j = 0; j < H1; j++) {
            let sum = 0;
            const base = j * I;
            for (let i = 0; i < I; i++) sum += W1[base + i] * features[i];
            if (useRes) {
                for (let i = 0; i < I; i++) sum += W_proj1[base + i] * features[i];
            }
            hidden1[j] = (sum + B1[j] * SCALE) / SCALE;
        }
        for (let j = 0; j < H1; j++) hidden1[j] = gelu(hidden1[j]);

        /* Layer Normalization（第一层） */
        let mean1 = 0;
        for (let j = 0; j < H1; j++) mean1 += hidden1[j];
        mean1 /= H1;
        let var1 = 0;
        for (let j = 0; j < H1; j++) var1 += (hidden1[j] - mean1) * (hidden1[j] - mean1);
        var1 /= H1;
        const std1 = Math.sqrt(var1 + 1e-8);
        for (let j = 0; j < H1; j++) hidden1[j] = (hidden1[j] - mean1) / std1;
        
        /* 第二层：128 → 64 */
        const hidden2 = new Float32Array(H2);
        for (let j = 0; j < H2; j++) {
            let sum = 0;
            const base = j * H1;
            for (let i = 0; i < H1; i++) sum += W2[base + i] * hidden1[i];
            if (useRes) {
                for (let i = 0; i < H1; i++) sum += W_proj2[base + i] * hidden1[i];
            }
            hidden2[j] = (sum + B2[j] * SCALE) / SCALE;
        }
        for (let j = 0; j < H2; j++) hidden2[j] = gelu(hidden2[j]);

        /* Layer Normalization（第二层） */
        let mean2 = 0;
        for (let j = 0; j < H2; j++) mean2 += hidden2[j];
        mean2 /= H2;
        let var2 = 0;
        for (let j = 0; j < H2; j++) var2 += (hidden2[j] - mean2) * (hidden2[j] - mean2);
        var2 /= H2;
        const std2 = Math.sqrt(var2 + 1e-8);
        for (let j = 0; j < H2; j++) hidden2[j] = (hidden2[j] - mean2) / std2;
        
        /* Actor头：64 → 6 */
        const actorLogits = new Float32Array(O);
        for (let k = 0; k < O; k++) {
            let sum = 0;
            const base = k * H2;
            for (let j = 0; j < H2; j++) sum += W3[base + j] * hidden2[j];
            actorLogits[k] = (sum + B3[k] * SCALE) / SCALE;
        }
        
        /* Critic头：64 → 1，用Tanh压缩到[-1, 1] */
        let valueRaw = 0;
        for (let j = 0; j < H2; j++) valueRaw += W4[j] * hidden2[j];
        valueRaw = (valueRaw + B4[0] * SCALE) / SCALE;
        const value = Math.tanh(valueRaw);
        
        return {
            actorLogits: actorLogits,
            value: value,
            hidden2: hidden2,  /* 训练时反向传播用 */
            hidden1: hidden1   /* ★ 细化：供隐藏层反传使用（此前丢失，导致 W1/W2 无法更新） */
        };
    } catch (e) { return null; }
}

/* ---------- 推理专用前向（复用 scratch 缓冲区，降低手机端每决策的分配/GC压力） ----------
 * ★ 性能优化：predict() 每决策会被模型融合循环调用最多 15 次，
 * 原 forwardWithValue 每次都 new 隐藏层数组，造成大量小数组分配 + GC。
 * 这里等价复现 forwardWithValue 的精确数值（GELU + 双层 LayerNorm + /SCALE），
 * 仅复用静态隐藏/输出缓冲区。训练路径仍用独立分配的 forwardWithValue，行为完全不变。
 * 导出仅供发布门禁（tests/run_tests.mjs 10.4）做三套前向一致性核对。 */
let _sH1 = new Float32Array(0);
let _sH2 = new Float32Array(0);
let _sA = new Float32Array(0);
export function forwardFastWithValue(features) {
    try {
        if (!W1 || !features) return null;
        const I = IN_DIM, H1 = HID1_DIM, H2 = HID2_DIM, O = OUT_DIM;
        const useRes = (typeof cfg === 'function') ? cfg('useResidual', false) : false;
        if (_sH1.length !== H1) _sH1 = new Float32Array(H1);
        if (_sH2.length !== H2) _sH2 = new Float32Array(H2);
        if (_sA.length !== O) _sA = new Float32Array(O);
        const hidden1 = _sH1, hidden2 = _sH2;

        /* 第一层：130 → 128 */
        for (let j = 0; j < H1; j++) {
            let sum = 0;
            const base = j * I;
            for (let i = 0; i < I; i++) sum += W1[base + i] * features[i];
            if (useRes) {
                for (let i = 0; i < I; i++) sum += W_proj1[base + i] * features[i];
            }
            hidden1[j] = gelu((sum + B1[j] * SCALE) / SCALE);
        }
        /* Layer Normalization（第一层，与 forwardWithValue 同等精度） */
        let mean1 = 0;
        for (let j = 0; j < H1; j++) mean1 += hidden1[j];
        mean1 /= H1;
        let var1 = 0;
        for (let j = 0; j < H1; j++) var1 += (hidden1[j] - mean1) * (hidden1[j] - mean1);
        var1 /= H1;
        const std1 = Math.sqrt(var1 + 1e-8);
        for (let j = 0; j < H1; j++) hidden1[j] = (hidden1[j] - mean1) / std1;

        /* 第二层：128 → 64 */
        for (let j = 0; j < H2; j++) {
            let sum = 0;
            const base = j * H1;
            for (let i = 0; i < H1; i++) sum += W2[base + i] * hidden1[i];
            if (useRes) {
                for (let i = 0; i < H1; i++) sum += W_proj2[base + i] * hidden1[i];
            }
            hidden2[j] = gelu((sum + B2[j] * SCALE) / SCALE);
        }
        /* Layer Normalization（第二层） */
        let mean2 = 0;
        for (let j = 0; j < H2; j++) mean2 += hidden2[j];
        mean2 /= H2;
        let var2 = 0;
        for (let j = 0; j < H2; j++) var2 += (hidden2[j] - mean2) * (hidden2[j] - mean2);
        var2 /= H2;
        const std2 = Math.sqrt(var2 + 1e-8);
        for (let j = 0; j < H2; j++) hidden2[j] = (hidden2[j] - mean2) / std2;

        /* ============== 残差短接：若开启，加一层浅残差（hidden2 直连输出前的轻量补偿） ==============
         * 可选「残差块」：把 hidden2 与 hidden1 的粗粒度均值做残差补偿，仅当 useResidual 时叠加。
         * 这里采用最稳形式：输出层前不再另加投影（避免多余矩阵），保守为空实现。
         * 残差生效由 W_proj1/W_proj2 已在前两层独立叠加保证，推理与训练同口径。 */

        /* Actor头：64 → 6 */
        for (let k = 0; k < O; k++) {
            let sum = 0;
            const base = k * H2;
            for (let j = 0; j < H2; j++) sum += W3[base + j] * hidden2[j];
            _sA[k] = (sum + B3[k] * SCALE) / SCALE;
        }

        /* Critic头：64 → 1，Tanh 压缩到 [-1, 1] */
        let valueRaw = 0;
        for (let j = 0; j < H2; j++) valueRaw += W4[j] * hidden2[j];
        valueRaw = (valueRaw + B4[0] * SCALE) / SCALE;

        return { actorLogits: _sA, value: Math.tanh(valueRaw) };
    } catch (e) { return null; }
}

/* ---------- softmax（带温度，校准饱和输出） ---------- */
export function softmax(logits) {
    if (!logits || !logits.length) return [];
    /* ★ 加温：logits / T 后再归一化。推理与训练同口径，概率/置信度被校准；argmax 不变 */
    const T = SOFTMAX_T;
    let max = -Infinity;
    for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
    const exps = new Float32Array(logits.length);
    let sum = 0;
    for (let i = 0; i < logits.length; i++) {
        exps[i] = Math.exp((logits[i] - max) / T);  /* ★ 已含温度 */
        sum += exps[i];
    }
    const probs = new Float32Array(logits.length);
    for (let i = 0; i < logits.length; i++) probs[i] = exps[i] / sum;
    return probs;
}

/* ---------- 单样本 SGD（与 trainOneWithValue 共享同一前向几何与反向传播） ---------- */
export function trainOne(features, labelIdx, lr) {
    if (!features || labelIdx < 0 || labelIdx >= OUT_DIM) return false;
    try {
        if (typeof lr !== 'number' || isNaN(lr)) lr = currentLR;
        _ensureAdam();  /* ★ 关键修复：恢复存档后动量数组为 null，训练首行即抛错，必须先补齐 */

        /* 统一训练前向（含 GELU 前激活 / LN 统计缓存，供真实导数反传） */
        const r = _forwardForTrain(features);
        if (!r) return false;

        /* Actor 交叉熵（标签平滑 + 温度） */
        const probs = softmax(r.actorLogits);
        const dLogits = new Float32Array(OUT_DIM);
        for (let k = 0; k < OUT_DIM; k++) {
            const target = (k === labelIdx) ? (1 - SMOOTH) : (SMOOTH / OUT_DIM);
            dLogits[k] = (probs[k] - target) / SOFTMAX_T;
        }

        adamT++;
        const bc1 = 1 - Math.pow(BETA1, adamT);
        const bc2 = 1 - Math.pow(BETA2, adamT);
        _backwardAndUpdate(features, r, dLogits, 0, lr, bc1, bc2);
        META.trained++;
        return true;
    } catch (e) { return false; }
}
/* ★ 带Critic的训练函数：同时训练Actor（分类）和Critic（价值回归）。
 * 共享 _forwardForTrain _backwardAndUpdate，隐藏层用真实 GELU'+LN' 反传，深层表示可学习。 */
export function trainOneWithValue(features, labelIdx, valueTarget, lr) {
    if (!features || labelIdx < 0 || labelIdx >= OUT_DIM) return false;
    try {
        if (!(typeof lr === 'number' && isFinite(lr) && lr > 0)) lr = currentLR;
        _ensureAdam();  /* ★ 关键修复：同 trainOne */

        const r = _forwardForTrain(features);
        if (!r) return false;

        /* Actor 交叉熵 */
        const probs = softmax(r.actorLogits);
        const dLogits = new Float32Array(OUT_DIM);
        for (let k = 0; k < OUT_DIM; k++) {
            const target = (k === labelIdx) ? (1 - SMOOTH) : (SMOOTH / OUT_DIM);
            dLogits[k] = (probs[k] - target) / SOFTMAX_T;
        }

        /* Critic MSE：tanh 保底梯度，饱和区仍保留方向性梯度 */
        const valueLoss = r.value - valueTarget;
        const dVraw = valueLoss;  /* 未含 tanh 导数；保底在 _backwardAndUpdate 内统一应用 */

        adamT++;
        const bc1 = 1 - Math.pow(BETA1, adamT);
        const bc2 = 1 - Math.pow(BETA2, adamT);
        _backwardAndUpdate(features, r, dLogits, dVraw, lr, bc1, bc2);
        META.trained++;
        return true;
    } catch (e) { return false; }
}

function _clamp(v) { if (v > 127) return 127; if (v < -127) return -127; return v | 0; }
function _clamp16(v) { if (v > 32767) return 32767; if (v < -32767) return -32767; return v | 0; }
/* ★ 随机舍入（无偏量化）：Int8 权重更新步长常 <0.5 被 Math.round 舍成0，权重饿死；
 * 以小数部分为概率随机进位，期望步长 = 原步长，权重持续可动、训练不冻结 */
function _qstep(x) {
    if (x >= 0) { const fl = Math.floor(x); return fl + (Math.random() < (x - fl) ? 1 : 0); }
    const a = -x; const fl = Math.floor(a); return -(fl + (Math.random() < (a - fl) ? 1 : 0));
}

/* ---------- 兼容旧接口 ---------- */
export function getWeights() { return W1; }
export function getBias()    { return B1; }
export function isReady()    { return !!META.ready; }
export function getAccuracy() { return META.accuracy; }
export function setAccuracy(a) { META.accuracy = a; }
/* ★ 3.1 封测：供训练器做学习率调度（余弦退火），只写正有限数 */
export function setTrainLR(x) { if (typeof x === 'number' && isFinite(x) && x > 0) currentLR = x; }
export function getCurrentLR() { return currentLR; }
export function markReady(ok) { META.ready = !!ok; saveWeights(); }
export function getTrained() { return META.trained; }
export function getMeta()    { return Object.assign({}, META); }
export function predict(features) {
    /* ★ 兜底返回值：防止 undefined 导致冲突检测疯狂报警。
     *   ★ 10.4：均匀分布必须真的归一（6×0.2=1.2 会让概率和检查/融合加权失真），confidence 取 1/6。 */
    const _u = 1 / 6;
    const fallback = {
        action: 'B',
        label: 'B',
        probs: [_u, _u, _u, _u, _u, _u],
        confidence: _u,
        value: 0.0  /* ★ 兜底价值评估 */
    };

    try {
        /* ★ 如果权重还没初始化，自动初始化 */
        if (!W1) {
            _initRandom();
            META.ready = false;
        }
        
        /* ★ 用复用缓冲的推理快速前向，同时获取Actor概率和Critic价值 */
        const result = forwardFastWithValue(features);
        if (!result || !result.actorLogits) return fallback;
        
        const probs = softmax(result.actorLogits);
        /* ★ 10.4：softmax 返回 Float32Array，不能用 Array.isArray 判空——
         *   此前该判定恒为 false，predict() 在生产中永远返回均匀兜底（action 恒 B、置信度恒 0）。 */
        if (!probs || probs.length < 6) return fallback;

        /* ★ 从概率分布中推导出 action 和 label */
        let bestIdx = 0;
        let bestProb = -1;
        for (let i = 0; i < probs.length; i++) {
            if (probs[i] > bestProb) {
                bestProb = probs[i];
                bestIdx = i;
            }
        }

        const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
        const action = labels[bestIdx] || 'B';

        return {
            action: action,
            label: action,
            probs: Array.from(probs),
            confidence: bestProb,
            maxProb: bestProb,  /* ★ 接口统一：显式最大后验概率，供深度思考等消费方走直通道 */
            value: result.value  /* ★ 价值评估：-1到1之间 */
        };
    } catch (e) {
        return fallback;
    }
}
export function resetWeights() {
    /* ★ 重置 = 回到出厂内置默认权重（而非随机初始化），保证重置后仍有可用模型。
     *   P0-03：内置权重不可用时绝不静默保存随机权重，直接失败并提示。
     *   ★ 10.3：失败时只解码、不提交——在线权重一位不动（此前失败路径也会 _initRandom，
     *   与日志里"已保留当前权重"的承诺矛盾）。 */
    const s = _decodeDefault();
    if (!s) {
        try { log.warn('weights', '重置失败：内置默认权重不可用（' + _defaultDiag + '），已保留当前权重'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        return false;
    }
    _commitDefault(s);
    saveWeights();
    return true;
}

/* ---------- 兼容旧变量导出 ---------- */
export const WEIGHTS = W1;
export const BIAS = 0;

/* ---------- 兼容旧函数导出 ---------- */
export function saveLocalWeights(w, b, acc) {
    try {
        if (w) {
            for (let i = 0; i < W1.length && i < w.length; i++) W1[i] = w[i] | 0;
        }
        if (b !== undefined && B1.length > 0) B1[0] = b | 0;
        if (acc !== undefined) META.accuracy = acc;
        META.ready = true;
        saveWeights();
        return true;
    } catch (e) { return false; }
}
export function reloadWeights() {
    return loadWeights();
}

loadWeights();
export const WEIGHTS_DIMS = { IN: IN_DIM, HID1: HID1_DIM, HID2: HID2_DIM, OUT: OUT_DIM };

/* ================= 供权重固化模块使用 ================= */
export function __getW2() { return W2; }
export function __getB2() { return B2; }
export function __getW1() { return W1; }
export function __getB1() { return B1; }
export function __getW3() { return W3; }
export function __getB3() { return B3; }
/* ★ P1-14：补齐 Critic 头与残差投影的访问器，热更快照必须覆盖全部可训练参数 */
export function __getW4() { return W4; }
export function __getB4() { return B4; }
export function __getPr1() { return W_proj1; }
export function __getPr2() { return W_proj2; }

/* ★ 优化器(AdamW)状态快照/还原：供热更"候选训练"隔离使用，
 *   避免候选训练污染主模型的动量/二阶矩，实现可回滚的 A/B。
 * ★ P1-15：补齐 Critic 头(mW4/mB4/vW4/vB4)与残差投影(mW_proj1/2, vW_proj1/2)的动量，
 *   否则 residual/Critic 训练仍会直接污染在线优化器状态。 */
export function __getMoments() {
    try {
        return {
            mW1: mW1 ? Array.from(mW1) : null, mB1: mB1 ? Array.from(mB1) : null,
            mW2: mW2 ? Array.from(mW2) : null, mB2: mB2 ? Array.from(mB2) : null,
            mW3: mW3 ? Array.from(mW3) : null, mB3: mB3 ? Array.from(mB3) : null,
            mW4: mW4 ? Array.from(mW4) : null, mB4: mB4 ? Array.from(mB4) : null,
            mW_proj1: mW_proj1 ? Array.from(mW_proj1) : null, mW_proj2: mW_proj2 ? Array.from(mW_proj2) : null,
            vW1: vW1 ? Array.from(vW1) : null, vB1: vB1 ? Array.from(vB1) : null,
            vW2: vW2 ? Array.from(vW2) : null, vB2: vB2 ? Array.from(vB2) : null,
            vW3: vW3 ? Array.from(vW3) : null, vB3: vB3 ? Array.from(vB3) : null,
            vW4: vW4 ? Array.from(vW4) : null, vB4: vB4 ? Array.from(vB4) : null,
            vW_proj1: vW_proj1 ? Array.from(vW_proj1) : null, vW_proj2: vW_proj2 ? Array.from(vW_proj2) : null,
            adamT: adamT,
        };
    } catch (e) { return null; }
}
export function __setMoments(o) {
    try {
        if (!o) return false;
        if (o.mW1) mW1 = new Float32Array(o.mW1);
        if (o.mB1) mB1 = new Float32Array(o.mB1);
        if (o.mW2) mW2 = new Float32Array(o.mW2);
        if (o.mB2) mB2 = new Float32Array(o.mB2);
        if (o.mW3) mW3 = new Float32Array(o.mW3);
        if (o.mB3) mB3 = new Float32Array(o.mB3);
        if (o.mW4) mW4 = new Float32Array(o.mW4);
        if (o.mB4) mB4 = new Float32Array(o.mB4);
        if (o.mW_proj1) mW_proj1 = new Float32Array(o.mW_proj1);
        if (o.mW_proj2) mW_proj2 = new Float32Array(o.mW_proj2);
        if (o.vW1) vW1 = new Float32Array(o.vW1);
        if (o.vB1) vB1 = new Float32Array(o.vB1);
        if (o.vW2) vW2 = new Float32Array(o.vW2);
        if (o.vB2) vB2 = new Float32Array(o.vB2);
        if (o.vW3) vW3 = new Float32Array(o.vW3);
        if (o.vB3) vB3 = new Float32Array(o.vB3);
        if (o.vW4) vW4 = new Float32Array(o.vW4);
        if (o.vB4) vB4 = new Float32Array(o.vB4);
        if (o.vW_proj1) vW_proj1 = new Float32Array(o.vW_proj1);
        if (o.vW_proj2) vW_proj2 = new Float32Array(o.vW_proj2);
        if (typeof o.adamT === 'number') adamT = o.adamT;
        return true;
    } catch (e) { return false; }
}

/* ================= ★ P0-05：模型完整快照 / 还原（候选训练隔离） =================
 * 覆盖全部可训练参数（W/B、残差投影）与优化器状态（AdamW 动量 m / 二阶矩 v / 时间步），
 * 使"候选训练"可在隔离参数上进行并在失败/拒绝时完整回滚，避免候选直接污染在线模型。 */
function _cloneTA(arr) {
    if (!arr) return null;
    try { return new arr.constructor(arr); } catch (e) { return null; }
}
export function __snapshotModel() {
    try {
        return {
            W1: _cloneTA(W1), B1: _cloneTA(B1), W2: _cloneTA(W2), B2: _cloneTA(B2),
            W3: _cloneTA(W3), B3: _cloneTA(B3), W4: _cloneTA(W4), B4: _cloneTA(B4),
            W_proj1: _cloneTA(W_proj1), W_proj2: _cloneTA(W_proj2),
            mW1: _cloneTA(mW1), mB1: _cloneTA(mB1), mW2: _cloneTA(mW2), mB2: _cloneTA(mB2),
            mW3: _cloneTA(mW3), mB3: _cloneTA(mB3), mW4: _cloneTA(mW4), mB4: _cloneTA(mB4),
            mW_proj1: _cloneTA(mW_proj1), mW_proj2: _cloneTA(mW_proj2),
            vW1: _cloneTA(vW1), vB1: _cloneTA(vB1), vW2: _cloneTA(vW2), vB2: _cloneTA(vB2),
            vW3: _cloneTA(vW3), vB3: _cloneTA(vB3), vW4: _cloneTA(vW4), vB4: _cloneTA(vB4),
            vW_proj1: _cloneTA(vW_proj1), vW_proj2: _cloneTA(vW_proj2),
            adamT: adamT,
            META: { version: META.version, trained: META.trained, accuracy: META.accuracy, ready: META.ready },
        };
    } catch (e) { return null; }
}
export function __restoreModel(snap) {
    try {
        if (!snap) return false;
        /* 核心权重必须全部存在且 shape 正确，否则整体拒绝（避免部分还原导致几何错位） */
        const need = [
            ['W1', IN_DIM * HID1_DIM], ['B1', HID1_DIM], ['W2', HID1_DIM * HID2_DIM], ['B2', HID2_DIM],
            ['W3', HID2_DIM * OUT_DIM], ['B3', OUT_DIM], ['W4', HID2_DIM * 1], ['B4', 1],
            ['W_proj1', IN_DIM * HID1_DIM], ['W_proj2', HID1_DIM * HID2_DIM],
        ];
        for (let i = 0; i < need.length; i++) {
            const a = snap[need[i][0]];
            if (!a || typeof a.length !== 'number' || a.length !== need[i][1]) return false;
        }
        W1 = _cloneTA(snap.W1); B1 = _cloneTA(snap.B1);
        W2 = _cloneTA(snap.W2); B2 = _cloneTA(snap.B2);
        W3 = _cloneTA(snap.W3); B3 = _cloneTA(snap.B3);
        W4 = _cloneTA(snap.W4); B4 = _cloneTA(snap.B4);
        W_proj1 = _cloneTA(snap.W_proj1); W_proj2 = _cloneTA(snap.W_proj2);
        /* 优化器状态：shape 匹配则还原，否则保持当前（不致命） */
        const mom = [
            ['mW1', IN_DIM * HID1_DIM], ['mB1', HID1_DIM], ['mW2', HID1_DIM * HID2_DIM], ['mB2', HID2_DIM],
            ['mW3', HID2_DIM * OUT_DIM], ['mB3', OUT_DIM], ['mW4', HID2_DIM * 1], ['mB4', 1],
            ['mW_proj1', IN_DIM * HID1_DIM], ['mW_proj2', HID1_DIM * HID2_DIM],
            ['vW1', IN_DIM * HID1_DIM], ['vB1', HID1_DIM], ['vW2', HID1_DIM * HID2_DIM], ['vB2', HID2_DIM],
            ['vW3', HID2_DIM * OUT_DIM], ['vB3', OUT_DIM], ['vW4', HID2_DIM * 1], ['vB4', 1],
            ['vW_proj1', IN_DIM * HID1_DIM], ['vW_proj2', HID1_DIM * HID2_DIM],
        ];
        for (let i = 0; i < mom.length; i++) {
            const a = snap[mom[i][0]];
            if (a && typeof a.length === 'number' && a.length === mom[i][1]) {
                const c = _cloneTA(a);
                if (c) {
                    if (mom[i][0] === 'mW1') mW1 = c; else if (mom[i][0] === 'mB1') mB1 = c;
                    else if (mom[i][0] === 'mW2') mW2 = c; else if (mom[i][0] === 'mB2') mB2 = c;
                    else if (mom[i][0] === 'mW3') mW3 = c; else if (mom[i][0] === 'mB3') mB3 = c;
                    else if (mom[i][0] === 'mW4') mW4 = c; else if (mom[i][0] === 'mB4') mB4 = c;
                    else if (mom[i][0] === 'mW_proj1') mW_proj1 = c; else if (mom[i][0] === 'mW_proj2') mW_proj2 = c;
                    else if (mom[i][0] === 'vW1') vW1 = c; else if (mom[i][0] === 'vB1') vB1 = c;
                    else if (mom[i][0] === 'vW2') vW2 = c; else if (mom[i][0] === 'vB2') vB2 = c;
                    else if (mom[i][0] === 'vW3') vW3 = c; else if (mom[i][0] === 'vB3') vB3 = c;
                    else if (mom[i][0] === 'vW4') vW4 = c; else if (mom[i][0] === 'vB4') vB4 = c;
                    else if (mom[i][0] === 'vW_proj1') vW_proj1 = c; else if (mom[i][0] === 'vW_proj2') vW_proj2 = c;
                }
            }
        }
        if (typeof snap.adamT === 'number') adamT = snap.adamT;
        if (snap.META) {
            META.trained = snap.META.trained || 0;
            META.accuracy = snap.META.accuracy || 0;
            META.ready = !!snap.META.ready;
        }
        return true;
    } catch (e) { return false; }
}

/* ★ 供诊断：最近一次内置默认权重加载失败原因（null 表示未失败/成功） */
export function getDefaultDiag() { return _defaultDiag; }

/* ================= 供热更新使用 =================
 * ★ P1-14 配套：除 W1/B1/W2/B2/W3/B3 外，新增可选的 Critic 头(w4/b4)与残差投影(pr1/pr2)，
 *   使热更快照可以覆盖 3.1 完整模型状态；缺省字段保持当前值（向后兼容旧候选）。 */
export function __applySnapshot(snapshot) {
    try {
        if (!snapshot) return false;
        /* ★ 架构护栏：维度不符的层一律拒绝，
         *   杜绝"旧96维/缺输出层"快照写回，避免主模型权重错位污染。 */
        const bad = function (arr, n) { return arr && (typeof arr.length !== 'number' || arr.length !== n); };
        if (bad(snapshot.w1, IN_DIM * HID1_DIM)) return false;
        if (bad(snapshot.b1, HID1_DIM)) return false;
        if (bad(snapshot.w2, HID1_DIM * HID2_DIM)) return false;
        if (bad(snapshot.b2, HID2_DIM)) return false;
        if (bad(snapshot.w3, HID2_DIM * OUT_DIM)) return false;
        if (bad(snapshot.b3, OUT_DIM)) return false;
        if (bad(snapshot.w4, HID2_DIM * 1)) return false;
        if (bad(snapshot.b4, 1)) return false;
        if (bad(snapshot.pr1, IN_DIM * HID1_DIM)) return false;
        if (bad(snapshot.pr2, HID1_DIM * HID2_DIM)) return false;
        /* ★ P0-04 配套：偏置是 Int16，不能用 Int8Array 装载（会截断高位） */
        if (snapshot.w1) W1 = new Int8Array(snapshot.w1);
        if (snapshot.b1) B1 = new Int16Array(snapshot.b1);
        if (snapshot.w2) W2 = new Int8Array(snapshot.w2);
        if (snapshot.b2) B2 = new Int16Array(snapshot.b2);
        if (snapshot.w3) W3 = new Int8Array(snapshot.w3);
        if (snapshot.b3) B3 = new Int16Array(snapshot.b3);
        /* ★ P1-14：Critic 头与残差投影一并换入（存在才覆盖） */
        if (snapshot.w4) W4 = new Int8Array(snapshot.w4);
        if (snapshot.b4) B4 = new Int16Array(snapshot.b4);
        if (snapshot.pr1) W_proj1 = new Int8Array(snapshot.pr1);
        if (snapshot.pr2) W_proj2 = new Int8Array(snapshot.pr2);
        META.ready = true;
        return true;
    } catch (e) { return false; }
}

/* ================= ★ Critic头导出（供控制台检查） ================= */
export const W4_critic = W4;    /* 别名：W4_critic */
export const b4_critic = B4;    /* 别名：b4_critic */

/* ★ 挂载到window上，方便控制台检查（用getter自动获取最新值） */
if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.weights = window.__DJSC.weights || {};
    
    /* ★ 用getter自动获取最新的W4，不管什么时候初始化都能拿到 */
    Object.defineProperty(window.__DJSC.weights, 'W4_critic', {
        get: function () { return W4; },
        configurable: true
    });
    Object.defineProperty(window.__DJSC.weights, 'b4_critic', {
        get: function () { return B4; },
        configurable: true
    });
    Object.defineProperty(window.__DJSC.weights, 'W1', {
        get: function () { return W1; },
        configurable: true
    });
    
    window.__DJSC.weights.criticReady = (W4 !== null);  /* Critic头是否已初始化 */
    window.__DJSC.weights.forwardWithValue = forwardWithValue;  /* ★ 直接暴露forwardWithValue */
    window.__DJSC.weights.VERSION = (window.__DJSC && window.__DJSC.VERSION) || '3.1β';  /* ★ P2-35：版本号跟随权威源 */
}
