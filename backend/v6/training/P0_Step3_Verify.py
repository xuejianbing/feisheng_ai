# -*- coding: utf-8 -*-
"""
P0_Step3_Verify.py - 独立推理验证
随机抽 3 个测试样本，输出 Top-3 动作 ID + 概率，与真实动作对比
"""
import sys, pickle
import numpy as np
sys.path.insert(0, r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1\_pylibs')

DATA = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1\policy_dataset.npz'
PKL = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1\SubModel_Policy.pkl'

with open(PKL, 'rb') as f:
    bundle = pickle.load(f)
clf = bundle['model']
classes = bundle['classes']

d = np.load(DATA, allow_pickle=True)
Xte, yte = d['Xte'], d['yte']
sids_te = d['sids_te']

rng = np.random.RandomState(20261020)
picks = rng.choice(len(Xte), size=3, replace=False)
print('=== 独立推理验证：3 个随机测试样本 ===')
for j, i in enumerate(picks):
    x = Xte[i:i+1]
    proba = clf.predict_proba(x)[0]
    order = np.argsort(-proba)[:3]
    true_idx = yte[i]
    print(f'--- 样本 {j+1}  (session {str(sids_te[i])[:20]}...) ---')
    print(f'  真实动作: {classes[true_idx]}')
    for rank, ci in enumerate(order):
        print(f'  Top{rank+1}: {classes[ci]:28s} 概率 {proba[ci]*100:.2f}%')
    hit = '✓ 命中真实动作' if true_idx in order else '✗ 真实动作不在 Top3'
    print(f'  结果: {hit}')
