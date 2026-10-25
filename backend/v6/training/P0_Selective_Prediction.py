# -*- coding: utf-8 -*-
"""P0_Selective_Prediction.py - 高置信下发+否则弃权回退的 coverage-accuracy 曲线"""
import sys
import pickle
import numpy as np

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
N = len(X)

P = model.predict_proba(X)
order = np.argsort(-P, axis=1)

# 每个样本：第一个"手牌支持的具体动作"及其概率
best_name = []
best_prob = []
for k in range(N):
    bn = 'other'
    bp = 0.0
    for rank in range(order.shape[1]):
        cname = classes[order[k, rank]]
        if cname == 'other':
            break
        fidx = HAND_FEAT.get(cname)
        if fidx is not None and X[k, fidx] > 0:
            bn = cname
            bp = P[k, order[k, rank]]
            break
    best_name.append(bn)
    best_prob.append(bp)
best_name = np.array(best_name, dtype=object)
best_prob = np.array(best_prob)

# 按置信度阈值 T 选择性下发
print('阈值T  覆盖率(下发%)  下发精度%  整体命中率%  回退精度%')
points = []
for T in [0.0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]:
    fire = (best_name != 'other') & (best_prob >= T)
    abstain = ~fire
    fire_correct = (best_name[fire] == truth[fire]).sum()
    abstain_correct = (truth[abstain] == 'other').sum()
    cover = 100 * fire.mean()
    fire_prec = 100 * fire_correct / max(1, fire.sum())
    overall = 100 * (fire_correct + abstain_correct) / N
    abst_prec = 100 * abstain_correct / max(1, abstain.sum())
    points.append((T, cover, fire_prec, overall, abst_prec))
    print(' %.1f   %8.1f   %7.1f   %8.1f   %7.1f' % (T, cover, fire_prec, overall, abst_prec))

import json
out = [{'T': t, 'coverage': c, 'fire_precision': fp, 'overall': o, 'abstain_precision': ap}
       for t, c, fp, o, ap in points]
json.dump(out, open(WD + r'\selective_curve.json', 'w'), indent=1)
print('\n已写 selective_curve.json')
