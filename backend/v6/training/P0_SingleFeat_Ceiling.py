# -*- coding: utf-8 -*-
"""P0_SingleFeat_Ceiling.py - 真人单特征条件主导动作占比天花板"""
import numpy as np
from collections import Counter

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
KEEP = list(range(0, 32)) + list(range(48, 130))

d = np.load(WD + r'\real_pool.npz', allow_pickle=True)
X = d['X'][:, KEEP].astype(np.float64)
lab = d['labels']

res = []
for i in range(X.shape[1]):
    col = X[:, i]
    vals = np.unique(col)
    conds = [('f%d>0' % i, col > 0)]
    if len(vals) <= 8:
        for v in vals:
            conds.append(('f%d==%g' % (i, v), col == v))
    else:
        nz = col[col > 0]
        if len(nz):
            m = np.median(nz)
            conds.append(('f%d>=%g' % (i, m), col >= m))
    for desc, mask in conds:
        n = int(mask.sum())
        if n < 1000:
            continue
        a, c = Counter(lab[mask]).most_common(1)[0]
        res.append((c / n, desc, a, n))

res.sort(reverse=True)
print('REAL 单特征条件主导动作占比 Top15（频次>1000）:')
for p, desc, a, n in res[:15]:
    print('  %-12s -> %-16s %5.1f%%  n=%d' % (desc, a, 100 * p, n))
