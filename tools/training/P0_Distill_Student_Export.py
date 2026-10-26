# -*- coding: utf-8 -*-
"""
P0_Distill_Student_Export.py - 知识蒸馏 + 导出 client_policy_model_v3.js + Python-JS 对拍

流程：
  1. 读 train_metrics.json，选 Top-1 最高的模型作为 Teacher（FT-Transformer / GAT / LGBM）
  2. Teacher 在训练集上打软标签（温度 T），硬标签 = 真值
  3. 蒸馏 Student：MLP 114 -> 32 -> 17
     loss = (1-a)*CE(hard) + a*T^2*KL(teacher_soft_T || student_T)
  4. 评估 Student Top-1 / Top-5
  5. 导出 client_policy_model_v3.js（base64 float64 权重，无运行时依赖）
     JS 接口与 v2 对齐：接收 130 维原始特征 -> 按 featureKeep 取 114 维 -> 归一化 -> MLP
  6. 1000 条 Python-JS 对拍（Top-1 类别一致性，要求 100%）
  7. 计算 SHA256

Python 侧对拍采用与 JS 完全相同的运算顺序（朴素双循环乘加），
保证 IEEE754 双精度下逐位一致，不依赖 BLAS 累加顺序。
"""
import argparse
import base64
import hashlib
import json
import math
import os
import pickle
import subprocess
import sys
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

WD = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WD)
GD = os.environ.get('TRAIN_GRAPH_DIR', r'E:\NoNameAI\gdata')
REPO = os.environ.get('TRAIN_REPO_DIR', r'C:\Users\123\Coze\Drive\编程专家\repo_feisheng_ai')
OUT_JS = os.path.join(REPO, 'score', 'model', 'net', 'client_policy_model_v3.js')
DEV = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

HIDDEN = 32
ALPHA = 0.7
TEMP = 2.0


class Student(nn.Module):
    """114 -> 32 -> 17 轻量学生模型"""

    def __init__(self, in_dim=114, hidden=HIDDEN, out_dim=17):
        super().__init__()
        self.fc1 = nn.Linear(in_dim, hidden)
        self.fc2 = nn.Linear(hidden, out_dim)

    def forward(self, x):
        return self.fc2(F.relu(self.fc1(x)))


# ============================================================ Teacher 概率
def teacher_probs(kind, gdir, X114, X130, tr, te, y, n_class, metrics):
    """返回 (train_probs, test_probs, top1, top5)"""
    if kind == 'ensemble':
        a_tr, a_te, a1, a5 = teacher_probs('lgbm', gdir, X114, X130, tr, te, y, n_class, metrics)
        b_tr, b_te, b1, b5 = teacher_probs('ft_transformer', gdir, X114, X130, tr, te, y, n_class, metrics)
        w = 0.5
        e_tr = w * a_tr + (1 - w) * b_tr
        e_te = w * a_te + (1 - w) * b_te
        def topk(yt, proba, k):
            o = np.argsort(-proba, axis=1)[:, :k]
            return float(np.mean([v in r for v, r in zip(yt, o)]))
        return e_tr, e_te, topk(y[te], e_te, 1), topk(y[te], e_te, 5)
    if kind == 'ft_transformer':
        from P0_Train_Attention_GNN import FTTransformer, softmax_np
        ck = torch.load(os.path.join(gdir, 'ft_transformer.pt'), map_location=DEV, weights_only=False)
        arch = ck.get('arch')
        if not isinstance(arch, dict):
            arch = ck.get('hp') or {}
        m = FTTransformer(114, n_class, d_token=arch.get('d_token', 64),
                          n_heads=arch.get('n_heads', 8), n_layers=arch.get('n_layers', 2),
                          d_ff=arch.get('d_ff', 128), dropout=arch.get('dropout', 0.1)).to(DEV)
        m.load_state_dict(ck['state_dict'])
        m.eval()
        mn, mx, rng = ck['mn'], ck['mx'], ck['rng']

        @torch.no_grad()
        def run(idx):
            outs = []
            Xn = ((X114[idx] - mn) / rng).astype(np.float32)
            for i in range(0, len(idx), 4096):
                xb = torch.from_numpy(Xn[i:i + 4096]).to(DEV)
                outs.append(m(xb).float().cpu().numpy())
            return softmax_np(np.concatenate(outs, axis=0))
        return run(tr), run(te), metrics['ft_transformer']['top1'], metrics['ft_transformer']['top5']
    if kind == 'lgbm':
        with open(os.path.join(gdir, 'lgbm_slot17.pkl'), 'rb') as f:
            pk = pickle.load(f)
        clf = pk['model']
        return clf.predict_proba(X114[tr]), clf.predict_proba(X114[te]), \
            metrics['lgbm']['top1'], metrics['lgbm']['top5']
    if kind == 'gat':
        from P0_Train_Attention_GNN import GATNet, softmax_np, eval_gat
        from Graph_Data_Convertor import build_graphs, NODE_DIM, NUM_NODES
        ck = torch.load(os.path.join(gdir, 'gat.pt'), map_location=DEV, weights_only=False)
        m = GATNet(NODE_DIM, n_class).to(DEV)
        m.load_state_dict(ck['state_dict'])
        m.eval()
        gmn, grng = ck['gmn'], ck['grng']
        gx, gei, gea = build_graphs(X130)
        gx = ((gx - gmn) / grng).astype(np.float32)

        @torch.no_grad()
        def run(idx):
            outs = []
            for i in range(0, len(idx), 2048):
                ids = idx[i:i + 2048]
                B = len(ids)
                xb = torch.from_numpy(gx[ids].reshape(B * NUM_NODES, NODE_DIM)).to(DEV)
                ei = gei[ids].reshape(2, B * 16).copy()
                ei[0] += np.repeat(np.arange(B, dtype=np.int64) * NUM_NODES, 16)
                ei = torch.from_numpy(ei).to(DEV)
                ea = torch.from_numpy(gea[ids].reshape(B * 16, 4)).to(DEV)
                bt = torch.from_numpy(np.repeat(np.arange(B, dtype=np.int64), NUM_NODES)).to(DEV)
                outs.append(m(xb, ei, ea, bt, B).float().cpu().numpy())
            return softmax_np(np.concatenate(outs, axis=0))
        return run(tr), run(te), metrics['gat']['top1'], metrics['gat']['top5']
    raise ValueError(kind)


# ============================================================ 导出
def b64_f64(arr):
    return base64.b64encode(np.asarray(arr, dtype='<f8').tobytes()).decode('ascii')


JS_TEMPLATE = '''/* -*- coding: utf-8 -*-
 * client_policy_model_v3.js
 * 蒸馏学生模型（MLP 114 -> 32 -> 17），无运行时依赖。
 * 生成脚本：tools/training/P0_Distill_Student_Export.py
 * schema: __SCHEMA__
 * 输入：130 维原始特征（按 featureKeep 取 114 维，规避 f32-f47 动作泄露段）
 * 输出：17 类概率 / topK
 */
var CLIENT_POLICY_V3_META = __META__;

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CLIENT_POLICY_V3 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var meta = CLIENT_POLICY_V3_META;

  function b64ToF64(b64) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var clean = String(b64).replace(/[^A-Za-z0-9+/]/g, '');
    var n = Math.floor(clean.length * 3 / 4);
    var bytes = new Uint8Array(n);
    var p = 0;
    for (var i = 0; i < clean.length; i += 4) {
      var c0 = chars.indexOf(clean[i]);
      var c1 = chars.indexOf(clean[i + 1]);
      var c2 = chars.indexOf(clean[i + 2]);
      var c3 = chars.indexOf(clean[i + 3]);
      var has1 = i + 1 < clean.length;   // c0,c1 存在 -> 可写第 1 字节
      var has2 = i + 2 < clean.length;   // c2 存在   -> 可写第 2 字节
      var has3 = i + 3 < clean.length;   // c3 存在   -> 可写第 3 字节
      if (has1) bytes[p++] = ((c0 << 2) | (c1 >> 4)) & 255;
      if (has2) bytes[p++] = (((c1 & 15) << 4) | (c2 >> 2)) & 255;
      if (has3) bytes[p++] = (((c2 & 3) << 6) | c3) & 255;
    }
    var dv = new DataView(bytes.buffer);
    var out = new Float64Array(n / 8);
    for (var k = 0; k < out.length; k++) out[k] = dv.getFloat64(k * 8, true);
    return out;
  }

  var W1 = b64ToF64(meta.w1);
  var B1 = b64ToF64(meta.b1);
  var W2 = b64ToF64(meta.w2);
  var B2 = b64ToF64(meta.b2);

  function forward114(x114) {
    var h = new Array(meta.hidden);
    for (var j = 0; j < meta.hidden; j++) {
      var s = B1[j];
      var off = j * meta.featureDim;
      for (var i = 0; i < meta.featureDim; i++) s += W1[off + i] * x114[i];
      h[j] = s > 0 ? s : 0;
    }
    var out = new Array(meta.numClasses);
    for (var k = 0; k < meta.numClasses; k++) {
      var s2 = B2[k];
      var off2 = k * meta.hidden;
      for (var j2 = 0; j2 < meta.hidden; j2++) s2 += W2[off2 + j2] * h[j2];
      out[k] = s2;
    }
    return out;
  }

  function pick114(features130) {
    var keep = meta.featureKeep;
    var x = new Array(meta.featureDim);
    for (var i = 0; i < meta.featureDim; i++) x[i] = (features130[keep[i]] - meta.normMin[i]) / meta.normRange[i];
    return x;
  }

  function softmax(logits) {
    var max = logits[0];
    for (var i = 1; i < logits.length; i++) if (logits[i] > max) max = logits[i];
    var sum = 0, exps = new Array(logits.length);
    for (var j = 0; j < logits.length; j++) { exps[j] = Math.exp(logits[j] - max); sum += exps[j]; }
    var probs = new Array(logits.length);
    for (var k = 0; k < logits.length; k++) probs[k] = exps[k] / sum;
    return probs;
  }

  var model = {
    meta: meta,
    classes: meta.classes,
    featureDim: meta.featureDim,
    featureKeep: meta.featureKeep,
    threshold: meta.threshold,
    schema: meta.schema,
    format: meta.format,

    rawScores: function (features130) {
      return forward114(pick114(features130));
    },

    predictProba: function (features130) {
      return softmax(forward114(pick114(features130)));
    },

    topK: function (features130, k) {
      var probs = this.predictProba(features130);
      var arr = [];
      for (var i = 0; i < probs.length; i++) arr.push({ action: meta.classes[i], probability: probs[i] });
      arr.sort(function (a, b) { return b.probability - a.probability; });
      return arr.slice(0, k || 3);
    },

    selfTest: function () {
      var zero = [];
      for (var i = 0; i < 130; i++) zero.push(0);
      var probs = this.predictProba(zero);
      var sum = 0;
      for (var j = 0; j < probs.length; j++) sum += probs[j];
      return {
        ok: Math.abs(sum - 1) < 1e-9 && meta.classes.length === meta.numClasses &&
             W1.length === meta.featureDim * meta.hidden && W2.length === meta.hidden * meta.numClasses,
        msg: 'client policy model v3 selfTest',
        data: { top3: this.topK(zero, 3), sum: sum }
      };
    }
  };

  return model;
});
'''


# ============================================================ 对拍
def py_forward(x130, keep, mn, rng, W1, B1, W2, B2, hidden, n_class):
    """与 JS forward114/pick114 完全同序的纯 Python 前向"""
    x = [(float(x130[keep[i]]) - float(mn[i])) / float(rng[i]) for i in range(len(keep))]
    h = []
    for j in range(hidden):
        s = B1[j]
        off = j * len(keep)
        for i in range(len(keep)):
            s += W1[off + i] * x[i]
        h.append(s if s > 0 else 0.0)
    out = []
    for k in range(n_class):
        s2 = B2[k]
        off2 = k * hidden
        for j2 in range(hidden):
            s2 += W2[off2 + j2] * h[j2]
        out.append(s2)
    return out


NODE_HARNESS = r'''
const path = require('path');
const M = require(process.argv[2]);
const fs = require('fs');
const samples = JSON.parse(fs.readFileSync(process.argv[3], 'utf-8'));
const out = [];
for (let i = 0; i < samples.length; i++) {
  const logits = M.rawScores(samples[i]);
  const probs = M.predictProba(samples[i]);
  let bi = 0;
  for (let j = 1; j < probs.length; j++) if (probs[j] > probs[bi]) bi = j;
  out.push({ top1: bi, probs: probs, logits: logits });
}
fs.writeFileSync(process.argv[4], JSON.stringify(out));
console.log('js_done', out.length);
'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--gdir', default=GD)
    ap.add_argument('--epochs', type=int, default=30)
    ap.add_argument('--teacher', default='', help='留空则按 metrics 自动选最优')
    ap.add_argument('--out-js', default=OUT_JS)
    ap.add_argument('--parity-n', type=int, default=1000)
    ap.add_argument('--alpha', type=float, default=None)
    ap.add_argument('--temp', type=float, default=None)
    args = ap.parse_args()

    z = np.load(os.path.join(args.gdir, 'graph_flat.npz'), allow_pickle=True)
    X130, X114, y = z['X130'], z['feat114'], z['y']
    classes = [str(c) for c in z['classes']]
    mn, mx, rng = z['mn'], z['mx'], z['rng']
    tr, te = z['tr'], z['te']
    n_class = len(classes)
    with open(os.path.join(args.gdir, 'train_metrics.json'), encoding='utf-8') as f:
        metrics = json.load(f)

    # ---- 选 Teacher ----
    cand = {k: v for k, v in metrics.items() if k in ('ft_transformer', 'gat', 'lgbm')}
    teacher = args.teacher or max(cand, key=lambda k: cand[k]['top1'])
    print('候选 Teacher: %s' % {k: round(v['top1'], 4) for k, v in cand.items()})
    if teacher in cand:
        print('选定 Teacher = %s (Top-1=%.4f)' % (teacher, cand[teacher]['top1']))
    else:
        print('选定 Teacher = %s (集成，Top-1 见下)' % teacher)
    t0 = time.time()
    p_tr, p_te, t_top1, t_top5 = teacher_probs(teacher, args.gdir, X114, X130, tr, te, y, n_class, metrics)
    print('Teacher 软标签生成完毕 (%.1fs)' % (time.time() - t0))

    global ALPHA, TEMP
    if args.alpha is not None: ALPHA = args.alpha
    if args.temp is not None: TEMP = args.temp
    print('蒸馏超参: alpha=%.3f  temperature=%.2f' % (ALPHA, TEMP))

    # ---- 软标签（温度 T） ----
    def soft_labels(p):
        zt = np.log(np.clip(p, 1e-12, None)) / TEMP
        zt = zt - zt.max(axis=1, keepdims=True)
        e = np.exp(zt)
        return (e / e.sum(axis=1, keepdims=True)).astype(np.float32)

    s_tr = soft_labels(p_tr)

    # ---- 蒸馏 ----
    torch.manual_seed(42)
    np.random.seed(42)
    Xn = ((X114.astype(np.float64) - mn.astype(np.float64)) / rng.astype(np.float64))
    Xtr = torch.from_numpy(Xn[tr])
    Xte = torch.from_numpy(Xn[te])
    ytr = torch.from_numpy(y[tr]).long()
    yte = y[te]
    Str = torch.from_numpy(s_tr.astype(np.float64))
    student = Student(114, HIDDEN, n_class).to(DEV).double()
    opt = torch.optim.AdamW(student.parameters(), lr=2e-3, weight_decay=1e-4)
    bs = 1024
    steps = args.epochs * ((len(tr) + bs - 1) // bs)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=steps, pct_start=0.25)

    def topk_np(yt, proba, k):
        o = np.argsort(-proba, axis=1)[:, :k]
        return float(np.mean([a in r for a, r in zip(yt, o)]))

    best = (0.0, 0.0, None, -1)
    for ep in range(args.epochs):
        student.train()
        perm = torch.randperm(len(tr))
        tot = 0.0
        t1 = time.time()
        for i in range(0, len(perm), bs):
            idx = perm[i:i + bs]
            xb = Xtr[idx].to(DEV, non_blocking=True)
            yb = ytr[idx].to(DEV, non_blocking=True)
            sb = Str[idx].to(DEV, non_blocking=True)
            opt.zero_grad(set_to_none=True)
            logits = student(xb)
            ce = F.cross_entropy(logits, yb)
            logp = F.log_softmax(logits / TEMP, dim=1)
            kl = F.kl_div(logp, sb, reduction='batchmean') * (TEMP * TEMP)
            loss = (1 - ALPHA) * ce + ALPHA * kl
            loss.backward()
            opt.step()
            sched.step()
            tot += float(loss) * len(idx)
        student.eval()
        with torch.no_grad():
            outs = []
            for i in range(0, len(te), 8192):
                outs.append(student(Xte[i:i + 8192].to(DEV)).cpu().numpy())
            lg = np.concatenate(outs, axis=0)
        e = np.exp(lg - lg.max(axis=1, keepdims=True))
        proba = e / e.sum(axis=1, keepdims=True)
        t1v = topk_np(yte, proba, 1)
        t5v = topk_np(yte, proba, 5)
        print('[DISTILL] epoch %2d loss=%.4f Top-1=%.4f Top-5=%.4f (%.1fs)'
              % (ep + 1, tot / len(perm), t1v, t5v, time.time() - t1))
        if t1v > best[0]:
            best = (t1v, t5v, {k: v.detach().cpu().clone() for k, v in student.state_dict().items()}, ep + 1)
    student.load_state_dict(best[2])
    print('[DISTILL] best Top-1=%.4f Top-5=%.4f (epoch %d)' % (best[0], best[1], best[3]))

    # ---- 导出 ----
    sd = student.state_dict()
    W1 = sd['fc1.weight'].detach().cpu().numpy().astype('<f8')     # [32,114] (float64)
    B1 = sd['fc1.bias'].detach().cpu().numpy().astype('<f8')       # [32]
    W2 = sd['fc2.weight'].detach().cpu().numpy().astype('<f8')     # [17,32]
    B2 = sd['fc2.bias'].detach().cpu().numpy().astype('<f8')       # [17]
    keep = list(range(0, 32)) + list(range(48, 130))   # 114 维 KEEP（与 v2 / LGBM 一致）

    meta = {
        'format': 'client-policy-model-v3',
        'schema': 'slot17_student_v3',
        'generatedAt': time.strftime('%Y-%m-%d %H:%M:%S'),
        'teacher': teacher,
        'teacherTop1': float(t_top1),
        'distill': {'alpha': ALPHA, 'temperature': TEMP, 'hidden': HIDDEN},
        'classes': classes,
        'numClasses': n_class,
        'featureDim': len(keep),
        'featureKeep': keep,
        'normMin': [float(v) for v in mn],
        'normRange': [float(v) for v in rng],
        'hidden': HIDDEN,
        'threshold': 0.3,
        'w1': b64_f64(W1.reshape(-1)),
        'b1': b64_f64(B1),
        'w2': b64_f64(W2.reshape(-1)),
        'b2': b64_f64(B2),
    }
    js = JS_TEMPLATE.replace('__META__', json.dumps(meta, ensure_ascii=False, separators=(',', ':'))) \
                    .replace('__SCHEMA__', meta['schema'])
    os.makedirs(os.path.dirname(args.out_js), exist_ok=True)
    with open(args.out_js, 'w', encoding='utf-8', newline='\n') as f:
        f.write(js)
    np.savez(os.path.join(args.gdir, 'student_v3_weights.npz'),
             W1=W1, B1=B1, W2=W2, B2=B2, keep=np.array(keep, dtype=np.int64),
             mn=mn.astype(np.float64), rng=rng.astype(np.float64),
             classes=np.array(classes, dtype=object))
    size = os.path.getsize(args.out_js)
    sha = hashlib.sha256(open(args.out_js, 'rb').read()).hexdigest()
    print('\n已导出 %s' % args.out_js)
    print('  大小 %d bytes  SHA256 %s' % (size, sha))

    # ---- 1000 条 Python-JS 对拍 ----
    n = min(args.parity_n, len(te))
    sel = te[:n]
    samples = X130[sel]
    tmp_js = os.path.join(args.gdir, '_parity_samples.json')
    tmp_out = os.path.join(args.gdir, '_parity_js_out.json')
    tmp_harness = os.path.join(args.gdir, '_parity_runner.cjs')
    with open(tmp_js, 'w', encoding='utf-8') as f:
        json.dump([[float(v) for v in row] for row in samples], f)
    with open(tmp_harness, 'w', encoding='utf-8') as f:
        f.write(NODE_HARNESS)
    t0 = time.time()
    r = subprocess.run(['node', tmp_harness, args.out_js, tmp_js, tmp_out],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print('Node 对拍执行失败:\n%s\n%s' % (r.stdout, r.stderr))
        return
    print('JS 侧推理完成 (%.1fs)' % (time.time() - t0))
    js_out = json.load(open(tmp_out, encoding='utf-8'))

    match = 0
    max_diff = 0.0        # logits 级最大偏差
    max_pdiff = 0.0       # 概率级最大偏差
    mism = []
    for i in range(n):
        py = py_forward(samples[i], keep, mn, rng, W1.reshape(-1), B1, W2.reshape(-1), B2,
                        HIDDEN, n_class)
        py_bi = int(np.argmax(py))
        js_bi = int(js_out[i]['top1'])
        if py_bi == js_bi:
            match += 1
        elif len(mism) < 10:
            mism.append((i, py_bi, js_bi, py[py_bi], py[js_bi]))
        jl = js_out[i]['logits']
        d = max(abs(py[j] - jl[j]) for j in range(n_class))
        max_diff = max(max_diff, d)
        em = np.exp(py - np.max(py))
        pyp = em / em.sum()
        jpr = js_out[i]['probs']
        dp = max(abs(pyp[j] - jpr[j]) for j in range(n_class))
        max_pdiff = max(max_pdiff, dp)
    rate = match / n
    _d0 = py_forward(samples[0], keep, mn, rng, W1.reshape(-1), B1, W2.reshape(-1), B2,
                     HIDDEN, n_class)
    print('[DIAG] W1[:4]=%s' % (list(np.round(W1.reshape(-1)[:4], 8).tolist()),))
    print('[DIAG] B1[:4]=%s  B2[:4]=%s' % (list(np.round(B1[:4], 8).tolist()),
                                            list(np.round(B2[:4], 8).tolist())))
    print('[DIAG] py_logits[0]=%s' % (list(np.round(_d0, 6).tolist()),))
    print('[DIAG] js_logits[0]=%s' % (list(np.round(js_out[0]['logits'], 6).tolist()),))
    print('\n===== Python-JS 对拍 =====')
    print('样本数 %d  Top-1 一致 %d  一致率 %.4f' % (n, match, rate))
    print('最大 logits 偏差 %.3e   最大概率偏差 %.3e' % (max_diff, max_pdiff))
    for i, a, b, pa, pb in mism:
        print('  样本 %d: py=%d(%.6f) js=%d(%.6f)' % (i, a, pa, b, pb))

    result = {
        'teacher': teacher, 'teacher_top1': float(t_top1), 'teacher_top5': float(t_top5),
        'student_top1': float(best[0]), 'student_top5': float(best[1]),
        'student_arch': 'MLP 114->%d->%d' % (HIDDEN, n_class),
        'alpha': ALPHA, 'temperature': TEMP,
        'js_path': args.out_js, 'js_size_bytes': size, 'js_sha256': sha,
        'parity_samples': n, 'parity_match': match, 'parity_rate': rate,
        'parity_max_logit_diff': max_diff, 'parity_max_prob_diff': max_pdiff,
        'train_samples': int(len(tr)), 'test_samples': int(len(te)),
        'classes': classes,
    }
    with open(os.path.join(args.gdir, 'distill_report.json'), 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print('报告落盘 %s' % os.path.join(args.gdir, 'distill_report.json'))


if __name__ == '__main__':
    main()
