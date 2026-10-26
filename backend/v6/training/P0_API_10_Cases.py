# -*- coding: utf-8 -*-
"""P0_API_10_Cases.py - 10 条混合路由验证（3 条真实"有桃"场景 + 7 条其他）"""
import sys
import pickle
import numpy as np

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
sys.path.insert(0, WD)
sys.path.insert(0, WD + r'\_pylibs')
import Hybrid_Router as HR

KEEP = list(range(0, 32)) + list(range(48, 130))
TOP10 = ['card:sha', 'card:tiesuo', 'card:tao', 'card:guohe', 'card:shunshou',
         'card:wuzhong', 'card:jiu', 'card:juedou', 'card:nanman', 'card:lebu']

pack = pickle.load(open(WD + r'\SubModel_Policy_minimal_clean.pkl', 'rb'))
model = pack['model']
classes = np.array(pack['classes'], dtype=object)

d = np.load(WD + r'\real_pool.npz', allow_pickle=True)
X = d['X'][:, KEEP].astype(np.float64)
raw = d['labels']
truth = np.array([l if l in TOP10 else 'other' for l in raw], dtype=object)

P = model.predict_proba(X)
order = np.argsort(-P, axis=1)

# 找"路由首选为 tao（手牌支持 f4>0）且 tao 概率>=0.5"的样本，取 3 条
tao_idx = []
for k in range(len(X)):
    if X[k, 4] > 0:
        for rank in order[k]:
            cn = classes[rank]
            if cn == 'other':
                break
            fi = HR.HAND_FEAT.get(cn)
            if fi is not None and X[k, fi] > 0:
                if cn == 'card:tao' and P[k, rank] >= 0.5:
                    tao_idx.append(k)
                break
    if len(tao_idx) >= 3:
        break

print('可下发 tao 的真实样本数（前向扫描命中）: %d' % len(tao_idx))

# 挑 7 条非 tao 的样本（等距抽样）
other_pool = [k for k in range(0, len(X), 137) if k not in tao_idx][:7]

cases = [('tao-case', k) for k in tao_idx] + [('normal', k) for k in other_pool]

print('\n=== 10 条路由验证 ===')
tao_ok = 0
for j, (tag, k) in enumerate(cases):
    r = HR.route(X[k].tolist(), verbose=False)
    mark = ''
    if tag == 'tao-case':
        if r['execute_action_id'] == 'card:tao':
            tao_ok += 1
            mark = ' [桃命中]'
        else:
            mark = ' [期望桃, 实际%s]' % r['execute_action_id']
    print('  %2d %-9s 真实%-12s -> %-9s %-16s conf=%.2f%s'
          % (j + 1, tag, truth[k], r['source'], r['execute_action_id'],
             r['confidence'], mark))

print('\n3 条有桃场景返回桃: %d/3' % tao_ok)
print('路由统计:', HR.stats())
