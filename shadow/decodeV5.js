// shadow/decodeV5.js
// v5_mixup 2种子集成推理（Int8反量化）——嵌入「无名AI」主扩展版（v3）
// v3 手机端加载加固：
//   1) base 规范化（缺尾斜杠自动补，防 assetURL='assets' 拼出 'assetsextension/...'）
//   2) 双通道×双编码 4 连尝试：lib.init.promises.json(原样/encodeURI) → 原生 fetch(原样/encodeURI)
//      覆盖：网页版/安卓 WebView/自定义协议、中文目录名 URL 编码差异、promises.json 实现差异
//   3) 每步失败 console.warn 打出实际 URL 与错误，控制台可直接定位 404/编码/协议问题
// 变更沿袭：v2 兼容 134 维 _feat（fix7）

let v5Models = { s42: null, s456: null };
let v5Ready = false;

function deqAll(data) {
    function deq(w) {
        const arr = new Float32Array(w.data.length);
        for (let i = 0; i < w.data.length; i++) arr[i] = w.data[i] * w.scale;
        return arr;
    }
    const W = {};
    for (const name in data.weights) {
        W[name] = { flat: deq(data.weights[name]), shape: data.weights[name].shape };
    }
    return W;
}

async function fetchJson(url) {
    const urls = [url, encodeURI(url)];
    for (let i = 0; i < urls.length; i++) {
        try { return await Promise.resolve(lib.init.promises.json(urls[i])); }
        catch (e) { console.warn('[V5] promises.json 失败(' + (i + 1) + '/2):', urls[i], e && e.message); }
    }
    for (let i = 0; i < urls.length; i++) {
        try {
            const r = await fetch(urls[i]);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return await r.json();
        } catch (e) { console.warn('[V5] fetch 失败(' + (i + 1) + '/2):', urls[i], e && e.message); }
    }
    throw new Error('4 种加载方式均失败');
}

async function loadOne(url) {
    const data = await fetchJson(url);
    return deqAll(data);
}

export async function loadV5All(assetURL) {
    let base = assetURL || ((typeof lib !== 'undefined' && lib.assetURL) || '');
    if (base && base.charAt(base.length - 1) !== '/') base += '/';
    v5Models.s42 = await loadOne(base + 'extension/无名AI/model/v5_mixup_s42.json');
    v5Models.s456 = await loadOne(base + 'extension/无名AI/model/v5_mixup_s456.json');
    v5Ready = true;
    console.log('[V5] 2种子模型加载完成');
}

export function isV5Ready() { return v5Ready; }

function predictOne(W, features) {
    const x = new Float32Array(130);
    for (let i = 0; i < 130; i++) x[i] = features[i] / 128.0;

    // fc1 + ln1 + relu
    let h1 = new Float32Array(192);
    for (let i = 0; i < 192; i++) {
        let s = 0;
        for (let j = 0; j < 130; j++) s += W['fc1.weight'].flat[i * 130 + j] * x[j];
        h1[i] = s + W['fc1.bias'].flat[i];
    }
    let mean = 0;
    for (let i = 0; i < 192; i++) mean += h1[i];
    mean /= 192;
    let vs = 0;
    for (let i = 0; i < 192; i++) { const d = h1[i] - mean; vs += d * d; }
    const std = Math.sqrt(vs / 192 + 1e-5);
    for (let i = 0; i < 192; i++) {
        h1[i] = (h1[i] - mean) / std * W['ln1.weight'].flat[i] + W['ln1.bias'].flat[i];
        h1[i] = h1[i] > 0 ? h1[i] : 0;
    }

    // fc2 + ln2 + relu
    let h2 = new Float32Array(96);
    for (let i = 0; i < 96; i++) {
        let s = 0;
        for (let j = 0; j < 192; j++) s += W['fc2.weight'].flat[i * 192 + j] * h1[j];
        h2[i] = s + W['fc2.bias'].flat[i];
    }
    mean = 0;
    for (let i = 0; i < 96; i++) mean += h2[i];
    mean /= 96;
    vs = 0;
    for (let i = 0; i < 96; i++) { const d = h2[i] - mean; vs += d * d; }
    const std2 = Math.sqrt(vs / 96 + 1e-5);
    for (let i = 0; i < 96; i++) {
        h2[i] = (h2[i] - mean) / std2 * W['ln2.weight'].flat[i] + W['ln2.bias'].flat[i];
        h2[i] = h2[i] > 0 ? h2[i] : 0;
    }

    // 残差
    const skip = new Float32Array(96);
    for (let i = 0; i < 96; i++) {
        let s = 0;
        for (let j = 0; j < 130; j++) s += W['skip.weight'].flat[i * 130 + j] * x[j];
        skip[i] = s;
    }
    for (let i = 0; i < 96; i++) h2[i] += skip[i];

    // fc3
    const out = new Float32Array(7);
    for (let i = 0; i < 7; i++) {
        let s = 0;
        for (let j = 0; j < 96; j++) s += W['fc3.weight'].flat[i * 96 + j] * h2[j];
        out[i] = s + W['fc3.bias'].flat[i];
    }
    return out[6];
}

export function v5Predict(features) {
    /* v2: 兼容 fixPR 主扩展 134 维 _feat（fix7 目标身份在尾部，取前 130 语义不变） */
    if (!v5Ready || !features || features.length < 130) return null;

    const p42 = predictOne(v5Models.s42, features);
    const p456 = predictOne(v5Models.s456, features);
    const ensemble = (p42 + p456) / 2;

    return {
        ensemble: ensemble,
        s42: p42,
        s456: p456,
    };
}
