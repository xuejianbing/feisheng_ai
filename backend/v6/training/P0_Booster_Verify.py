# -*- coding: utf-8 -*-
"""P0_Booster_Verify.py - 验证原生 booster 类别映射与 model.predict_proba 一致"""
import sys
import pickle
import numpy as np

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
sys.path.insert(0, WD + r'\_pylibs')
KEEP = list(range(0, 32)) + list(range(48, 130))

d = np.load(WD + r'\real_pool.npz', allow_pickle=True)
X = d['X'][:, KEEP].astype(np.float64)

pack = pickle.load(open(WD + r'\SubModel_Policy_minimal_clean.pkl', 'rb'))
m = pack['model']
m.n_jobs = 1
classes = np.array(pack['classes'], dtype=object)
booster = m.booster_

P_sk = m.predict_proba(X[:200])
P_bo = booster.predict(X[:200])

print('sklearn shape', P_sk.shape, 'booster shape', P_bo.shape)
print('classes_:', list(m.classes_))
print('pkl classes:', list(classes))

maxdiff = np.abs(P_sk - P_bo).max()
print('两路径逐列最大差异: %.6f' % maxdiff)

arg_sk = P_sk.argmax(axis=1)
arg_bo = P_bo.argmax(axis=1)
print('argmax 一致率: %.2f%%' % (100 * (arg_sk == arg_bo).mean()))

# 单条 booster 预测的列顺序确认
single = booster.predict(X[0:1])
print('单条 booster 返回 shape:', single.shape)
print('一致且可安全使用:', maxdiff < 1e-4 and (arg_sk == arg_bo).all())
