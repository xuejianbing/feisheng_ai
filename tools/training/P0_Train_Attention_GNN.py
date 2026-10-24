# -*- coding: utf-8 -*-
"""
P0_Train_Attention_GNN.py - FT-Transformer(Attention) 与 GAT(GNN) 对比训练

数据：E:\\NoNameAI\\gdata\\graph_flat.npz（由 Graph_Data_Convertor.py 生成）
  - 114 维 KEEP 特征（f0-f31 + f48-f129，剔除 f32-f47 动作泄露段）
  - 17 类标签（与 P2/LGBM 同口径）
  - 按 sessionId 切分 8:2（GroupShuffleSplit, seed=42，与 P2 完全一致）
  - 图：4 节点(self/ally/enemy/target) x 20 维，16 条边 x 4 维

三者同口径对比：
  LGBM（基线，超参同 P2：200/15/4）、FT-Transformer、GAT(GATConv)

输出：
  E:\\NoNameAI\\gdata\\ft_transformer.pt / gat.pt / lgbm_slot17.pkl
  E:\\NoNameAI\\gdata\\train_metrics.json
"""
import argparse
import json
import math
import os
import pickle
import sys
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

GD = os.environ.get('TRAIN_GRAPH_DIR', r'E:\NoNameAI\gdata')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from Graph_Data_Convertor import (build_graphs, graph_stats, KEEP, NUM_NODES, NODE_DIM)  # noqa: E402

DEV = torch.device('cuda' if torch.cuda.is_available() else 'cpu')


# ============================================================ 模型
class FTTransformer(nn.Module):
    """FT-Transformer：FeatureTokenizer(逐特征加权) + CLS token + Transformer Encoder"""

    def __init__(self, num_features, num_classes, d_token=64, n_heads=8, n_layers=2,
                 d_ff=128, dropout=0.1):
        super().__init__()
        self.num_features = num_features
        self.d_token = d_token
        self.weight = nn.Parameter(torch.empty(num_features, d_token))
        self.bias = nn.Parameter(torch.empty(num_features, d_token))
        nn.init.normal_(self.weight, std=0.02)
        nn.init.normal_(self.bias, std=0.02)
        self.cls = nn.Parameter(torch.zeros(1, 1, d_token))
        nn.init.normal_(self.cls, std=0.02)
        layer = nn.TransformerEncoderLayer(
            d_model=d_token, nhead=n_heads, dim_feedforward=d_ff,
            dropout=dropout, activation='gelu', batch_first=True, norm_first=True)
        self.encoder = nn.TransformerEncoder(layer, num_layers=n_layers)
        self.head = nn.Sequential(
            nn.LayerNorm(d_token),
            nn.Linear(d_token, d_token),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(d_token, num_classes),
        )

    def forward(self, x):
        # FeatureTokenizer: x [B,F] -> [B,F,d_token]
        tok = x.unsqueeze(-1) * self.weight.unsqueeze(0) + self.bias.unsqueeze(0)
        cls = self.cls.expand(x.size(0), -1, -1)
        h = torch.cat([cls, tok], dim=1)
        h = self.encoder(h)
        return self.head(h[:, 0])


class GATNet(nn.Module):
    """GAT：GATConv(带边特征) x 2 层 + 图级 mean pooling + 分类头"""

    def __init__(self, in_dim, num_classes, hid=64, heads=4, edge_dim=4, dropout=0.3):
        super().__init__()
        from torch_geometric.nn import GATConv
        self.role = nn.Parameter(torch.zeros(NUM_NODES, in_dim))
        nn.init.normal_(self.role, std=0.02)
        self.conv1 = GATConv(in_dim, hid, heads=heads, edge_dim=edge_dim, concat=True)
        self.conv2 = GATConv(hid * heads, hid, heads=1, edge_dim=edge_dim, concat=False)
        self.dropout = dropout
        self.head = nn.Sequential(
            nn.Linear(hid, hid),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hid, num_classes),
        )

    def forward(self, x, edge_index, edge_attr, batch, n_graphs):
        x = x + self.role[torch.arange(NUM_NODES, device=x.device).repeat(n_graphs)]
        x = F.elu(self.conv1(x, edge_index, edge_attr))
        x = F.dropout(x, p=self.dropout, training=self.training)
        x = self.conv2(x, edge_index, edge_attr)
        # 图级池化
        out = torch.zeros(n_graphs, x.size(1), device=x.device, dtype=x.dtype)
        cnt = torch.zeros(n_graphs, device=x.device, dtype=x.dtype)
        out.index_add_(0, batch, x)
        cnt.index_add_(0, batch, torch.ones_like(x[:, 0]))
        g = out / cnt.unsqueeze(1).clamp(min=1)
        return self.head(g)


# ============================================================ 数据
def load_flat(gdir):
    z = np.load(os.path.join(gdir, 'graph_flat.npz'), allow_pickle=True)
    return z


def topk(yt, proba, k):
    o = np.argsort(-proba, axis=1)[:, :k]
    return float(np.mean([y in r for y, r in zip(yt, o)]))


def train_lgbm(X114, y, tr, te, n_class, seed=42):
    import lightgbm as lgb
    t0 = time.time()
    clf = lgb.LGBMClassifier(objective='multiclass', num_class=n_class,
                              n_estimators=200, num_leaves=15, max_depth=4,
                              n_jobs=-1, random_state=seed, verbosity=-1)
    clf.fit(X114[tr], y[tr], callbacks=[lgb.log_evaluation(0)])
    proba = clf.predict_proba(X114[te])
    t1 = topk(y[te], proba, 1)
    t5 = topk(y[te], proba, 5)
    print('[LGBM]  Top-1=%.4f  Top-5=%.4f  (%.1fs)' % (t1, t5, time.time() - t0))
    return clf, proba, t1, t5


def train_ft(Xtr_n, ytr, Xte_n, yte, n_class, epochs=20, bs=512, lr=1e-3, seed=42,
             d_token=64, n_heads=8, n_layers=2, d_ff=128, dropout=0.1, feat_drop=0.0,
              label_smooth=0.0, wd=1e-4):
    torch.manual_seed(seed)
    np.random.seed(seed)
    model = FTTransformer(Xtr_n.shape[1], n_class, d_token=d_token, n_heads=n_heads,
                          n_layers=n_layers, d_ff=d_ff, dropout=dropout).to(DEV)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=wd)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=epochs * ((len(Xtr_n) + bs - 1) // bs),
                                                pct_start=0.2)
    lossf = nn.CrossEntropyLoss(label_smoothing=label_smooth)
    best = (0.0, 0.0, None, -1)
    for ep in range(epochs):
        model.train()
        perm = torch.randperm(len(Xtr_n))
        tot = 0.0
        t0 = time.time()
        for i in range(0, len(Xtr_n), bs):
            idx = perm[i:i + bs]
            xb = Xtr_n[idx].to(DEV, non_blocking=True)
            if feat_drop > 0:
                mask = (torch.rand_like(xb) > feat_drop).float()
                xb = xb * mask / (1.0 - feat_drop)
            yb = ytr[idx].to(DEV, non_blocking=True)
            opt.zero_grad(set_to_none=True)
            out = model(xb)
            loss = lossf(out, yb)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            tot += float(loss) * len(idx)
        t1, t5 = eval_ft(model, Xte_n, yte)
        print('[FT]  epoch %2d  loss=%.4f  Top-1=%.4f  Top-5=%.4f  (%.1fs)'
              % (ep + 1, tot / len(Xtr_n), t1, t5, time.time() - t0))
        if t1 > best[0]:
            best = (t1, t5, {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}, ep + 1)
    model.load_state_dict(best[2])
    print('[FT]  best Top-1=%.4f (epoch %d)' % (best[0], best[3]))
    return model, best[0], best[1]


@torch.no_grad()
def eval_ft(model, Xte_n, yte, bs=4096):
    model.eval()
    outs = []
    for i in range(0, len(Xte_n), bs):
        outs.append(model(Xte_n[i:i + bs].to(DEV)).float().cpu().numpy())
    proba = softmax_np(np.concatenate(outs, axis=0))
    return topk(yte, proba, 1), topk(yte, proba, 5)


def softmax_np(z):
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def train_gat(gx, gei, gea, y, tr, te, n_class, epochs=20, bs=1024, lr=1e-3, seed=42):
    from torch_geometric.nn import GATConv  # noqa: F401
    torch.manual_seed(seed)
    np.random.seed(seed)
    model = GATNet(NODE_DIM, n_class).to(DEV)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    lossf = nn.CrossEntropyLoss()
    best = (0.0, 0.0, None, -1)
    for ep in range(epochs):
        model.train()
        perm = np.random.permutation(len(tr))
        tot = 0.0
        t0 = time.time()
        for i in range(0, len(perm), bs):
            sel = perm[i:i + bs]
            ids = tr[sel]
            B = len(ids)
            xb = gx[ids].reshape(B * NUM_NODES, NODE_DIM)
            ei = gei[ids].reshape(2, B * 16).copy()
            ei[0] += np.repeat(np.arange(B, dtype=np.int64) * NUM_NODES, 16)
            ea = gea[ids].reshape(B * 16, 4)
            bt = torch.from_numpy(np.repeat(np.arange(B, dtype=np.int64), NUM_NODES))
            xb_t = torch.from_numpy(xb).to(DEV)
            ei_t = torch.from_numpy(ei).to(DEV)
            ea_t = torch.from_numpy(ea).to(DEV)
            bt_t = bt.to(DEV)
            yb = torch.from_numpy(y[ids]).to(DEV)
            opt.zero_grad(set_to_none=True)
            out = model(xb_t, ei_t, ea_t, bt_t, B)
            loss = lossf(out, yb)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            tot += float(loss) * B
        t1, t5 = eval_gat(model, gx, gei, gea, y, te)
        print('[GAT] epoch %2d  loss=%.4f  Top-1=%.4f  Top-5=%.4f  (%.1fs)'
              % (ep + 1, tot / len(perm), t1, t5, time.time() - t0))
        if t1 > best[0]:
            best = (t1, t5, {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}, ep + 1)
    model.load_state_dict(best[2])
    print('[GAT] best Top-1=%.4f (epoch %d)' % (best[0], best[3]))
    return model, best[0], best[1]


@torch.no_grad()
def eval_gat(model, gx, gei, gea, y, te, bs=2048):
    model.eval()
    outs = []
    for i in range(0, len(te), bs):
        ids = te[i:i + bs]
        B = len(ids)
        xb = torch.from_numpy(gx[ids].reshape(B * NUM_NODES, NODE_DIM)).to(DEV)
        ei = gei[ids].reshape(2, B * 16).copy()
        ei[0] += np.repeat(np.arange(B, dtype=np.int64) * NUM_NODES, 16)
        ei = torch.from_numpy(ei).to(DEV)
        ea = torch.from_numpy(gea[ids].reshape(B * 16, 4)).to(DEV)
        bt = torch.from_numpy(np.repeat(np.arange(B, dtype=np.int64), NUM_NODES)).to(DEV)
        outs.append(model(xb, ei, ea, bt, B).float().cpu().numpy())
    proba = softmax_np(np.concatenate(outs, axis=0))
    return topk(y[te], proba, 1), topk(y[te], proba, 5)


# ============================================================ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--gdir', default=GD)
    ap.add_argument('--epochs', type=int, default=20)
    ap.add_argument('--skip-lgbm', action='store_true')
    ap.add_argument('--only-ft', action='store_true')
    ap.add_argument('--d-token', type=int, default=64)
    ap.add_argument('--heads', type=int, default=8)
    ap.add_argument('--layers', type=int, default=2)
    ap.add_argument('--d-ff', type=int, default=128)
    ap.add_argument('--dropout', type=float, default=0.1)
    ap.add_argument('--feat-drop', type=float, default=0.0)
    ap.add_argument('--label-smooth', type=float, default=0.0)
    ap.add_argument('--wd', type=float, default=1e-4)
    ap.add_argument('--lr', type=float, default=1e-3)
    ap.add_argument('--tag', default='')
    args = ap.parse_args()

    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    print('device: %s  torch %s  cuda=%s' % (DEV, torch.__version__, torch.cuda.is_available()))

    z = load_flat(args.gdir)
    X130 = z['X130']
    X114 = z['feat114']
    y = z['y']
    groups = z['groups']
    classes = [str(c) for c in z['classes']]
    mn, mx, rng = z['mn'], z['mx'], z['rng']
    tr = z['tr']
    te = z['te']
    n_class = len(classes)
    print('样本 %d  特征 %d  类别 %d  训练 %d / 测试 %d'
          % (len(X114), X114.shape[1], n_class, len(tr), len(te)))

    # ---- 114 维归一化（train 统计量） ----
    def norm114(a):
        return ((a - mn) / rng).astype(np.float32)
    X114n = norm114(X114)
    Xtr_t = torch.from_numpy(X114n[tr])
    ytr_t = torch.from_numpy(y[tr])
    Xte_t = torch.from_numpy(X114n[te])

    # ---- 图 ----
    gx_all, gei_all, gea_all = build_graphs(X130)
    # 节点特征 min-max（在训练集上统计）
    gx_tr_stat = gx_all[tr].reshape(-1, NODE_DIM)
    gmn = gx_tr_stat.min(axis=0)
    gmx = gx_tr_stat.max(axis=0)
    grng = np.where(gmx - gmn > 1e-6, gmx - gmn, 1.0)
    gx_all = ((gx_all - gmn) / grng).astype(np.float32)
    st = graph_stats()
    print('图: 节点 %d/图 节点维度 %d 边 %d/图 边维度 %d'
          % (st['num_nodes'], st['node_dim'], st['num_edges'], st['edge_dim']))

    results = {}

    # ---- LGBM 基线 ----
    lgbm_clf = None
    if not args.skip_lgbm:
        lgbm_clf, lgbm_proba, t1, t5 = train_lgbm(X114, y, tr, te, n_class)
        results['lgbm'] = {'top1': t1, 'top5': t5}
        with open(os.path.join(args.gdir, 'lgbm_slot17.pkl'), 'wb') as f:
            pickle.dump({'model': lgbm_clf, 'classes': classes, 'feature_keep': KEEP,
                         'feature_dim': 114, 'top1': t1, 'top5': t5}, f)

    # ---- FT-Transformer ----
    ft, ft1, ft5 = train_ft(Xtr_t, ytr_t, Xte_t, y[te], n_class, epochs=args.epochs,
                            lr=args.lr, d_token=args.d_token, n_heads=args.heads,
                            n_layers=args.layers, d_ff=args.d_ff, dropout=args.dropout,
                            feat_drop=args.feat_drop,
              label_smooth=args.label_smooth, wd=args.wd)
    results['ft_transformer'] = {'top1': ft1, 'top5': ft5}
    torch.save({'state_dict': ft.state_dict(), 'classes': classes, 'feature_keep': KEEP,
                'mn': mn, 'mx': mx, 'rng': rng, 'top1': ft1, 'top5': ft5,
                'arch': 'ft-transformer', 'hp': {'d_token': args.d_token, 'n_heads': args.heads,
                'n_layers': args.layers, 'd_ff': args.d_ff, 'dropout': args.dropout,
                'feat_drop': args.feat_drop, 'lr': args.lr, 'epochs': args.epochs}},
               os.path.join(args.gdir, 'ft_transformer%s.pt' % args.tag))

    # ---- GAT ----
    if args.only_ft:
        g1, g5 = 0.0, 0.0
    else:
        gat, g1, g5 = train_gat(gx_all, gei_all, gea_all, y, tr, te, n_class, epochs=args.epochs)
    if not args.only_ft:
        results['gat'] = {'top1': g1, 'top5': g5}
    if not args.only_ft:
        torch.save({'state_dict': gat.state_dict(), 'classes': classes, 'node_dim': NODE_DIM,
                    'gmn': gmn, 'grng': grng, 'top1': g1, 'top5': g5,
                    'arch': 'gat-2layer'}, os.path.join(args.gdir, 'gat.pt'))

    # ---- 汇总 ----
    print('\n===== 同口径对比（纯真人已结算 / 17 类 / session 8:2 切分） =====')
    print('%-16s %10s %10s' % ('模型', 'Top-1', 'Top-5'))
    for k in ('lgbm', 'ft_transformer', 'gat'):
        if k in results:
            print('%-16s %10.4f %10.4f' % (k, results[k]['top1'], results[k]['top5']))
    print('%-16s %10.4f %10.4f  (目标基线)' % ('target', 0.6504, 0.0))
    with open(os.path.join(args.gdir, 'train_metrics%s.json' % args.tag), 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    print('指标落盘 %s' % os.path.join(args.gdir, 'train_metrics.json'))


if __name__ == '__main__':
    main()
