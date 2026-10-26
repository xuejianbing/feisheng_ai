# -*- coding: utf-8 -*-
r"""
P0_Step3_Prepare.py - 动作策略模型 数据准备
- 数据源：E:\NoNameAI\data\P0_True_Raw_Dataset.jsonl (10-18 7:50 固化快照, 1,061,108 行)
- 特征：复用 P0_Strict_Clean 的 KEEP_IDX（剔9个泄露维 130→121）
- 标签：复合动作标签  m.action + ":" + m.id  （24个id跨action重叠，必须复合）
- 过滤口径：严格复刻 P0_Strict_Clean（仅 session 终局为纯 win / 纯 lose 的行，f 长度130）
- 对齐校验：npz 的前 N 行（P0_True 贡献）必须与本次 X 逐行一致
- 长尾处理：复合标签频次 >= MIN_COUNT 保留为独立类，其余归 __other__（样本不丢弃）
- 切分：GroupShuffleSplit 按 sessionId 8:2
输出：policy_dataset.npz（Xtr, ytr, Xte, yte, sids_tr, sids_te, classes, raw_labels）
"""

from legacy_training_guard import require_trusted_training_adapter
require_trusted_training_adapter()

import json
import sys
import numpy as np
from collections import defaultdict, Counter

sys.path.insert(0, r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1\_pylibs')

RAW = r'E:\NoNameAI\data\P0_True_Raw_Dataset.jsonl'
NPZ = r'E:\NoNameAI\data\P0_Final_Clean_Dataset.npz'
OUT = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1\policy_dataset.npz'

LEAK_IDX = [0, 17, 53, 64, 65, 68, 70, 71, 81]
KEEP_IDX = [i for i in range(130) if i not in LEAK_IDX]
assert len(KEEP_IDX) == 121
MIN_COUNT = 500

def iter_rows():
    with open(RAW, encoding='utf-8') as f:
        for line in f:
            yield json.loads(line)

# ============ PASS 1: session outcomes ============
print('=== PASS 1: 构建 session 终局映射 ===', flush=True)
session_outcomes = defaultdict(set)
n = 0
for d in iter_rows():
    m = d.get('m') or {}
    sid = m.get('sessionId')
    go = m.get('gameOutcome')
    if sid is not None and go in ('win', 'lose'):
        session_outcomes[sid].add(go)
    n += 1
    if n % 200000 == 0:
        print(f'  已扫描 {n} 行...', flush=True)
print(f'P0_True 总行数: {n}')
print(f'session 终局数: {len(session_outcomes)}')

# ============ PASS 2: 干跑计数 ============
print('=== PASS 2: 干跑清洗，确定保留行数 ===', flush=True)
def clean_row(d):
    m = d.get('m') or {}
    sid = m.get('sessionId')
    if sid is None:
        return None
    oc = session_outcomes.get(sid)
    if oc == {'win'}:
        pass
    elif oc == {'lose'}:
        pass
    else:
        return None
    feat = d.get('f')
    if not isinstance(feat, list) or len(feat) != 130:
        return None
    act = m.get('action')
    aid = m.get('id')
    if act is None or aid is None or aid == '':
        return None
    return sid, str(act), str(aid)

N = 0
for d in iter_rows():
    if clean_row(d) is not None:
        N += 1
print(f'清洗保留行数 N = {N}  (npz 三源合计 624,032)', flush=True)

# ============ PASS 3: 填充 ============
print('=== PASS 3: 填充特征与标签 ===', flush=True)
X = np.zeros((N, 121), dtype=np.float32)
raw_labels = []
sids = []
idx = 0
for d in iter_rows():
    r = clean_row(d)
    if r is None:
        continue
    sid, act, aid = r
    feat = d['f']
    X[idx, :] = [feat[i] for i in KEEP_IDX]
    raw_labels.append(act + ':' + aid)
    sids.append(sid)
    idx += 1
    if idx % 100000 == 0:
        print(f'  已填充 {idx}...', flush=True)
raw_labels = np.array(raw_labels, dtype=object)
sids = np.array(sids)
print(f'X: {X.shape}, labels: {raw_labels.shape}, sids: {sids.shape}')

# ============ 与 npz 对齐校验 ============
print('=== 对齐校验: npz.X 前 N 行 ===', flush=True)
npz = np.load(NPZ, allow_pickle=True)
X_npz = npz['X']
print(f'npz X: {X_npz.shape}')
if N <= X_npz.shape[0]:
    same = np.array_equal(X, X_npz[:N])
    print(f'本次 X 与 npz.X[:N] 逐行完全一致: {same}')
    if not same:
        diff = (X != X_npz[:N]).sum()
        print(f'  不一致元素数: {diff}')
else:
    print('N 超过 npz 行数，无法按前缀对齐')

# ============ 类别频次与长尾处理 ============
print('=== 类别频次与长尾处理 ===', flush=True)
cnt = Counter(raw_labels)
print(f'复合标签 distinct 总数: {len(cnt)}')
keep_classes = sorted([k for k, v in cnt.items() if v >= MIN_COUNT])
n_keep = len(keep_classes)
n_other_samples = sum(v for k, v in cnt.items() if v < MIN_COUNT)
print(f'频次 >= {MIN_COUNT} 的类别数: {n_keep}')
print(f'归入 __other__ 的样本数: {n_other_samples} ({n_other_samples/N*100:.2f}%)')
classes = keep_classes + ['__other__']
cls2idx = {k: i for i, k in enumerate(classes)}
y = np.array([cls2idx.get(lab, n_keep) for lab in raw_labels], dtype=np.int64)
print(f'num_class = {len(classes)}')
print('Top 15 类别:')
for k, v in cnt.most_common(15):
    print(f'  {v:7d}  {k}')
print('频次边界附近类别:')
for k in keep_classes:
    if cnt[k] < MIN_COUNT * 1.2:
        print(f'  {cnt[k]:6d}  {k}')
        break

# ============ GroupShuffleSplit 按 sessionId 8:2 ============
print('=== GroupShuffleSplit 按 sessionId 8:2 ===', flush=True)
from sklearn.model_selection import GroupShuffleSplit
gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
tr_idx, te_idx = next(gss.split(X, y, groups=sids))
print(f'训练样本: {len(tr_idx)}  测试样本: {len(te_idx)}')
print(f'训练局数: {len(set(sids[tr_idx]))}  测试局数: {len(set(sids[te_idx]))}')
print(f'训练类别数: {len(set(y[tr_idx]))}  测试类别数: {len(set(y[te_idx]))}')

np.savez(OUT,
         Xtr=X[tr_idx], ytr=y[tr_idx], sids_tr=sids[tr_idx],
         Xte=X[te_idx], yte=y[te_idx], sids_te=sids[te_idx],
         classes=np.array(classes, dtype=object))
print(f'=== 已保存 {OUT} ===')
