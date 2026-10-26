# -*- coding: utf-8 -*-
"""P0_f31_inspect.py - 检查 f31 条件下动作可执行性"""
import numpy as np
from collections import Counter

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
KEEP = list(range(0, 32)) + list(range(48, 130))
d = np.load(WD + r'\real_pool.npz', allow_pickle=True)
X = d['X'][:, KEEP]
lab = d['labels']
m = X[:, 31] > 0
print('f31>0 样本数:', int(m.sum()))
print('原始复合标签完整分布:')
for a, c in Counter(lab[m]).most_common(12):
    print('  %-16s %5d  %5.1f%%' % (a, c, 100 * c / m.sum()))
