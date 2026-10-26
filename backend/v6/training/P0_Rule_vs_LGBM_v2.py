# -*- coding: utf-8 -*-
"""P0_Rule_vs_LGBM_v2.py - 11分类口径下，规则前置 vs LGBM 对拍"""
import sys
import pickle
import numpy as np
from collections import Counter

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
sys.path.insert(0, WD + r'\_pylibs')

KEEP = list(range(0, 32)) + list(range(48, 130))
DERIVED = {47: 'familiarity', 56: 'modulate_level', 57: 'modulator'}
TOP10 = ['card:sha', 'card:tiesuo', 'card:tao', 'card:guohe', 'card:shunshou',
         'card:wuzhong', 'card:jiu', 'card:juedou', 'card:nanman', 'card:lebu']

pack = pickle.load(open(WD + r'\SubModel_Policy_minimal_clean.pkl', 'rb'))
model = pack['model']
classes = np.array(pack['classes'], dtype=object)

d = np.load(WD + r'\real_pool.npz', allow_pickle=True)
X = d['X'][:, KEEP].astype(np.float64)
raw_lab = d['labels']
# 映射到 11 类
lab11 = np.array([l if l in TOP10 else 'other' for l in raw_lab], dtype=object)

proba = model.predict_proba(X)
pred = classes[proba.argmax(axis=1)]
print('封版 LGBM 真人全量 Top-1（11类口径）: %.2f%%' % (100 * (pred == lab11).mean()))
print('11类真人分布: %s' % dict(Counter(lab11)))


def make_conds(i):
    col = X[:, i]
    vals = np.unique(col)
    out = [('f%d>0' % i, col > 0)]
    if len(vals) <= 8:
        for v in vals:
            if v != 0:
                out.append(('f%d==%g' % (i, v), col == v))
    return out


rows = []
for i in range(X.shape[1]):
    for desc, mask in make_conds(i):
        cnt = int(mask.sum())
        if cnt < 1000:
            continue
        a, c = Counter(lab11[mask]).most_common(1)[0]
        if a == 'other':
            continue  # other 不是可执行动作
        rule_p = c / cnt
        model_p = (pred[mask] == lab11[mask]).mean()
        rows.append((rule_p - model_p, rule_p, model_p, desc, a, cnt, i in DERIVED))

clean = [r for r in rows if not r[6]]
clean.sort(reverse=True)
print('\n=== 纯局面单特征规则（11类，Top15，按对模型增益）===')
for gain, rp, mp, desc, a, cnt, _ in clean[:15]:
    print('  %-10s -> %-14s 规则%5.1f%% 模型%5.1f%% 增益%+.1f%% n=%d [%s]'
          % (desc, a, 100 * rp, 100 * mp, 100 * gain, cnt, '有利' if gain > 0 else '拖累'))

print('\n=== 动作派生特征（直接预测不可用）===')
for gain, rp, mp, desc, a, cnt, _ in sorted([r for r in rows if r[6]], reverse=True):
    print('  %-10s -> %-14s 规则%5.1f%% 模型%5.1f%% n=%d' % (desc, a, 100 * rp, 100 * mp, cnt))

benefit = [r for r in clean if r[0] > 0]
print('\n对模型严格有利（增益>0）的纯局面规则: %d 条' % len(benefit))
for gain, rp, mp, desc, a, cnt, _ in benefit:
    print('  %-10s -> %-14s 规则%5.1f%% 模型%5.1f%% 增益%+.1f%% n=%d' % (desc, a, 100 * rp, 100 * mp, 100 * gain, cnt))
