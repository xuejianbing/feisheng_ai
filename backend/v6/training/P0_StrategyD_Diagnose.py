# -*- coding: utf-8 -*-
"""P0_StrategyD_Diagnose.py - 诊断策略D的提升是否真实"""
import sys
import pickle
import numpy as np
from collections import Counter

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
sys.path.insert(0, WD + r'\_pylibs')

KEEP = list(range(0, 32)) + list(range(48, 130))
TOP10 = ['card:sha', 'card:tiesuo', 'card:tao', 'card:guohe', 'card:shunshou',
         'card:wuzhong', 'card:jiu', 'card:juedou', 'card:nanman', 'card:lebu']
HAND_FEAT = {
    'card:sha': 2, 'card:shan': 3, 'card:tao': 4, 'card:wuxie': 5,
    'card:juedou': 6, 'card:nanman': 7,
    'card:wuzhong': 31, 'card:tiesuo': 31,
    'card:guohe': None, 'card:shunshou': None, 'card:jiu': None, 'card:lebu': None
}

pack = pickle.load(open(WD + r'\SubModel_Policy_minimal_clean.pkl', 'rb'))
model = pack['model']
classes = np.array(pack['classes'], dtype=object)

d = np.load(WD + r'\real_pool.npz', allow_pickle=True)
X = d['X'][:, KEEP].astype(np.float64)
raw = d['labels']
truth = np.array([l if l in TOP10 else 'other' for l in raw], dtype=object)

P = model.predict_proba(X)
order = np.argsort(-P, axis=1)

pred = []
for k in range(len(X)):
    chosen = 'other'
    for rank in range(order.shape[1]):
        cname = classes[order[k, rank]]
        if cname == 'other':
            break
        fidx = HAND_FEAT.get(cname)
        if fidx is not None and X[k, fidx] > 0:
            chosen = cname
            break
    pred.append(chosen)
pred = np.array(pred, dtype=object)

is_other_pred = pred == 'other'
is_other_truth = truth == 'other'

print('预测 other 比例: %.1f%%  真实 other 比例: %.1f%%'
      % (100 * is_other_pred.mean(), 100 * is_other_truth.mean()))

# 预测具体动作时的精度
concrete = ~is_other_pred
print('\n预测【具体动作】的样本: %d (%.1f%%)，其中正确: %d，精度 %.2f%%'
      % (concrete.sum(), 100 * concrete.mean(),
         (pred[concrete] == truth[concrete]).sum(),
         100 * (pred[concrete] == truth[concrete]).mean()))

# 预测 other 时的精度
print('预测【other】的样本: %d (%.1f%%)，其中真实other: %d，精度 %.2f%%'
      % (is_other_pred.sum(), 100 * is_other_pred.mean(),
         is_other_truth[is_other_pred].sum(),
         100 * is_other_truth[is_other_pred].mean()))

# 真实具体动作里，被我们正确覆盖的召回
truth_concrete = ~is_other_truth
print('\n真实【具体动作】召回: %.2f%%'
      % (100 * (pred[truth_concrete] == truth[truth_concrete]).sum() / truth_concrete.sum()))

# 各类别命中
print('\n各具体动作预测精度:')
for a in TOP10:
    mp = pred == a
    if mp.sum() > 0:
        print('  %-15s 预测%5d 正确%5d 精度%5.1f%%'
              % (a, mp.sum(), (truth[mp] == a).sum(), 100 * (truth[mp] == a).mean()))
