# -*- coding: utf-8 -*-
"""
P0_Baseline_Train.py - 4 组对照训练
real/demo × 130原始(无剔除) / 121(剔九维 LEAK_IDX)
标签：频次 >= MIN_COUNT 的复合标签为独立类，其余归 __other__
切分：GroupShuffleSplit 按 sessionId 8:2
"""

from legacy_training_guard import require_trusted_training_adapter
require_trusted_training_adapter()

import sys, pickle, json
import numpy as np
sys.path.insert(0, r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1\_pylibs')
import lightgbm as lgb
from collections import Counter
from sklearn.model_selection import GroupShuffleSplit

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
LEAK_IDX = [0, 17, 53, 64, 65, 68, 70, 71, 81]
MIN_COUNT = 50
N_EST = 100

def load_pool(name):
    d = np.load(WD + '\\' + name + '_pool.npz', allow_pickle=True)
    return d['X'], d['labels'], d['sids']

def topk_acc(proba, y, k):
    order = np.argsort(-proba, axis=1)[:, :k]
    hit = 0
    for i in range(len(y)):
        if y[i] in order[i]:
            hit += 1
    return hit / len(y)

def run(pool_name, drop_mode):
    X, labels, sids = load_pool(pool_name)
    if drop_mode == 'nine':
        keep = [i for i in range(130) if i not in LEAK_IDX]
        X = X[:, keep]
    lc = Counter(labels)
    keep_classes = sorted([k for k, v in lc.items() if v >= MIN_COUNT])
    n_other = sum(v for k, v in lc.items() if v < MIN_COUNT)
    classes = keep_classes + ['__other__']
    cls2idx = {k: i for i, k in enumerate(classes)}
    y = np.array([cls2idx.get(lab, len(keep_classes)) for lab in labels], dtype=np.int64)

    gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    tr, te = next(gss.split(X, y, groups=sids))
    print(f'### {pool_name} / {drop_mode} | 维度 {X.shape[1]} | 行 {len(X)} | num_class {len(classes)} '
          f'(other {n_other} 行 {n_other/len(X)*100:.1f}%) | 训练 {len(tr)} 测试 {len(te)}', flush=True)

    clf = lgb.LGBMClassifier(objective='multiclass', num_class=len(classes), n_jobs=-1,
                             n_estimators=N_EST, learning_rate=0.05, num_leaves=63,
                             min_child_samples=20, subsample=0.8, subsample_freq=1,
                             colsample_bytree=0.8, reg_lambda=1.0, random_state=42)
    ev = {}
    clf.fit(X[tr], y[tr], eval_set=[(X[tr], y[tr]), (X[te], y[te])],
            eval_names=['train', 'test'], eval_metric='multi_logloss',
            callbacks=[lgb.record_evaluation(ev), lgb.log_evaluation(0)])
    ptr = clf.predict_proba(X[tr])
    pte = clf.predict_proba(X[te])
    t1tr, t5tr = topk_acc(ptr, y[tr], 1), topk_acc(ptr, y[tr], 5)
    t1te, t5te = topk_acc(pte, y[te], 1), topk_acc(pte, y[te], 5)
    ltr = ev['train']['multi_logloss']
    lte = ev['test']['multi_logloss']
    print(f'    loss: 首 {lte[0]:.4f} -> 末 {lte[-1]:.4f} (test)', flush=True)
    print(f'    Top-1: train {t1tr*100:.2f}% | test {t1te*100:.2f}%', flush=True)
    print(f'    Top-5: train {t5tr*100:.2f}% | test {t5te*100:.2f}%', flush=True)
    return {'pool': pool_name, 'drop': drop_mode, 'dim': X.shape[1],
            'num_class': len(classes), 'n': len(X),
            'top1_test': t1te, 'top5_test': t5te,
            'top1_train': t1tr, 'top5_train': t5tr,
            'loss_first': lte[0], 'loss_last': lte[-1],
            'clf': clf, 'classes': classes}

results = []
for pool in ['real', 'demo']:
    for drop in ['none', 'nine']:
        r = run(pool, drop)
        results.append(r)
        print('', flush=True)

print('=' * 70)
print('汇总（测试集）：')
print(f'{"池":6s} {"维度":4s} {"类别":4s} {"样本":7s} {"Top-1":8s} {"Top-5":8s}')
for r in results:
    print(f'{r["pool"]:6s} {r["dim"]:4d} {r["num_class"]:4d} {r["n"]:7d} '
          f'{r["top1_test"]*100:7.2f}% {r["top5_test"]*100:7.2f}%')

# 保存 real/nine 与 demo/nine 两个模型
for r in results:
    if r['drop'] == 'nine':
        out = WD + '\\SubModel_Policy_' + r['pool'] + '.pkl'
        with open(out, 'wb') as f:
            pickle.dump({'model': r['clf'], 'classes': r['classes'],
                        'feature_dim': r['dim'], 'min_count': MIN_COUNT,
                        'source_type': r['pool'],
                        'metrics': {'top1_test': r['top1_test'], 'top5_test': r['top5_test']}}, f)
        print(f'已保存 {out}')
