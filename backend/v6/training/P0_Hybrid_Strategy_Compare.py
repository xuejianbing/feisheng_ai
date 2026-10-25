# -*- coding: utf-8 -*-
"""P0_Hybrid_Strategy_Compare.py - 比较纯模型/强制规则/可执行性校验三策略"""
import sys
import pickle
import numpy as np

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
sys.path.insert(0, WD + r'\_pylibs')

KEEP = list(range(0, 32)) + list(range(48, 130))
TOP10 = ['card:sha', 'card:tiesuo', 'card:tao', 'card:guohe', 'card:shunshou',
         'card:wuzhong', 'card:jiu', 'card:juedou', 'card:nanman', 'card:lebu']

# 动作 -> 手牌特征索引（需要该特征>0 才可执行）；None 表示无明确手牌特征，信任模型
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
order = np.argsort(-P, axis=1)  # 概率降序的类索引


def acc(pred):
    return 100 * (pred == truth).mean()

# 策略 A：纯 LGBM
predA = classes[order[:, 0]]
aA = acc(predA)

# 策略 B：f31 强制 wuzhong（有不可执行风险）
predB = predA.copy()
m31 = X[:, 31] > 0
predB[m31] = 'card:wuzhong'
aB = acc(predB)

# 策略 C：可执行性校验 —— 首选手牌不支持则降序找第一个支持的
predC = []
for k in range(len(X)):
    chosen = None
    for rank in range(order.shape[1]):
        cname = classes[order[k, rank]]
        if cname == 'other':
            chosen = 'other'
            break
        fidx = HAND_FEAT.get(cname)
        if fidx is None or X[k, fidx] > 0:
            chosen = cname
            break
    predC.append(chosen)
predC = np.array(predC, dtype=object)
aC = acc(predC)

# 策略 D：可执行性校验 + 若所有具体动作都不支持则返回 other（而非信任无特征动作）
# 已被 C 覆盖（无特征动作信任）；再做严格版：无特征动作也跳过
predD = []
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
    predD.append(chosen)
predD = np.array(predD, dtype=object)
aD = acc(predD)

print('策略 A 纯LGBM：              %.2f%%' % aA)
print('策略 B f31强制无中：          %.2f%%（含不可执行风险）' % aB)
print('策略 C 可执行性校验(信任无特征):%.2f%%' % aC)
print('策略 D 可执行性校验(严格)：    %.2f%%' % aD)

# 统计可执行性校验改变了多少首选
changed = (predC != predA).sum()
print('\n策略C 共修正 %d 个模型首选（%.1f%%）' % (changed, 100 * changed / len(X)))
