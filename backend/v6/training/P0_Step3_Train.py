# -*- coding: utf-8 -*-
"""
P0_Step3_Train.py - LightGBM 动作策略多分类训练
输入：policy_dataset.npz
输出：SubModel_Policy.pkl  {model, classes, feature_dim, min_count, eval_log}
"""

from legacy_training_guard import require_trusted_training_adapter
require_trusted_training_adapter()

import sys, pickle
import numpy as np
sys.path.insert(0, r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1\_pylibs')
import lightgbm as lgb

DATA = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1\policy_dataset.npz'
OUT = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1\SubModel_Policy.pkl'

d = np.load(DATA, allow_pickle=True)
Xtr, ytr = d['Xtr'], d['ytr']
Xte, yte = d['Xte'], d['yte']
classes = list(d['classes'])
num_class = len(classes)
print('=== 数据加载 ===')
print(f'训练: {Xtr.shape}, 测试: {Xte.shape}, num_class: {num_class}')

clf = lgb.LGBMClassifier(
    objective='multiclass',
    num_class=num_class,
    n_jobs=-1,
    n_estimators=100,
    learning_rate=0.05,
    num_leaves=63,
    min_child_samples=20,
    subsample=0.8,
    subsample_freq=1,
    colsample_bytree=0.8,
    reg_lambda=1.0,
    random_state=42,
)

evals_result = {}
print('=== 开始训练（每10轮打印 multi_logloss） ===')
clf.fit(
    Xtr, ytr,
    eval_set=[(Xtr, ytr), (Xte, yte)],
    eval_names=['train', 'test'],
    eval_metric='multi_logloss',
    callbacks=[lgb.record_evaluation(evals_result), lgb.log_evaluation(period=10)],
)

print('=== Loss 下降过程（train / test multi_logloss） ===')
tr_loss = evals_result['train']['multi_logloss']
te_loss = evals_result['test']['multi_logloss']
for i in range(0, len(tr_loss), 10):
    end = min(i + 10, len(tr_loss)) - 1
    print(f'  轮次 {end+1:3d}: train {tr_loss[end]:.4f} | test {te_loss[end]:.4f}')
print(f'  最终轮次 {len(tr_loss)}: train {tr_loss[-1]:.4f} | test {te_loss[-1]:.4f}')

def topk_acc(proba, y, k):
    order = np.argsort(-proba, axis=1)[:, :k]
    hit = 0
    for i in range(len(y)):
        if y[i] in order[i]:
            hit += 1
    return hit / len(y)

proba_te = clf.predict_proba(Xte)
proba_tr = clf.predict_proba(Xtr)
top1_te = topk_acc(proba_te, yte, 1)
top5_te = topk_acc(proba_te, yte, 5)
top1_tr = topk_acc(proba_tr, ytr, 1)
top5_tr = topk_acc(proba_tr, ytr, 5)
print('=== 测试集指标 ===')
print(f'Top-1 准确率:  训练 {top1_tr*100:.2f}% | 测试 {top1_te*100:.2f}%')
print(f'Top-5 准确率:  训练 {top5_tr*100:.2f}% | 测试 {top5_te*100:.2f}%')

with open(OUT, 'wb') as f:
    pickle.dump({
        'model': clf,
        'classes': classes,
        'feature_dim': 121,
        'min_count': 500,
        'evals_result': evals_result,
        'metrics': {'top1_test': top1_te, 'top5_test': top5_te,
                    'top1_train': top1_tr, 'top5_train': top5_tr},
    }, f)
print(f'=== 模型已保存: {OUT} ===')
