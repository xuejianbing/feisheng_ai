# -*- coding: utf-8 -*-
"""P0_Infer_Tune.py - 消除单条推理固定开销的实验"""
import os
import sys
import time
import pickle
import numpy as np

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
sys.path.insert(0, WD + r'\_pylibs')
KEEP = list(range(0, 32)) + list(range(48, 130))

d = np.load(WD + r'\real_pool.npz', allow_pickle=True)
X114 = d['X'][:, KEEP].astype(np.float64)


def bench(model, label, n=1000):
    t0 = time.perf_counter()
    for k in range(n):
        model.predict_proba(X114[k:k + 1])
    print('%-28s 单条 %.3fms' % (label, (time.perf_counter() - t0) / n * 1000))


pack = pickle.load(open(WD + r'\SubModel_Policy_minimal_clean.pkl', 'rb'))
m = pack['model']

bench(m, '默认 n_jobs=%s' % getattr(m, 'n_jobs', '?'))

m.n_jobs = 1
bench(m, 'n_jobs=1')

booster = m.booster_
t0 = time.perf_counter()
for k in range(1000):
    booster.predict(X114[k:k + 1])
print('%-28s 单条 %.3fms' % ('原生 booster', (time.perf_counter() - t0) / 1000 * 1000))

# 预测预热（第一次调用有初始化开销）
m.predict_proba(X114[:1])
bench(m, 'n_jobs=1 + 预热后')
