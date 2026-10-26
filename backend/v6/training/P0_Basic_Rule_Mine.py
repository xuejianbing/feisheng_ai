# -*- coding: utf-8 -*-
"""P0_Basic_Rule_Mine.py - 单特征暴力关联挖掘最基础硬规则"""

from legacy_training_guard import require_trusted_training_adapter
require_trusted_training_adapter()

import json
import numpy as np
from collections import Counter

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
KEEP = list(range(0, 32)) + list(range(48, 130))   # 114 维
MIN_FREQ = 1000
MIN_PCT = 0.75


def load(name, fn):
    d = np.load(WD + '\\' + fn, allow_pickle=True)
    X = d['X'][:, KEEP].astype(np.float64)
    lab = d['labels']
    return X, lab


def scan(X, lab, tag):
    N = len(X)
    cands = []
    for i in range(X.shape[1]):
        col = X[:, i]
        vals = np.unique(col)
        conds = []
        if len(vals) <= 8:
            for v in vals:
                conds.append(('f%d==%g' % (i, v), col == v))
        else:
            nz = col[col > 0]
            conds.append(('f%d>0' % i, col > 0))
            if len(nz) > 0:
                med = np.median(nz)
                conds.append(('f%d>=%g' % (i, med), col >= med))
                p75 = np.percentile(nz, 75)
                if p75 > med:
                    conds.append(('f%d>=%g' % (i, p75), col >= p75))
        best = None
        for desc, mask in conds:
            n = int(mask.sum())
            if n < MIN_FREQ:
                continue
            a, c = Counter(lab[mask]).most_common(1)[0]
            pct = c / n
            # 每维度只留占比最高的一条
            if pct >= MIN_PCT and (best is None or pct > best[2]):
                best = (desc, a, pct, n)
        if best:
            cands.append(best)
    cands.sort(key=lambda x: -x[2])
    print('\n===== %s 池合格基础规则（频次>%d 占比>%d%%）共 %d 条 ====='
          % (tag, MIN_FREQ, int(MIN_PCT * 100), len(cands)))
    for j, (desc, a, pct, n) in enumerate(cands):
        print('  %2d. IF %-12s THEN %-18s 占比%5.1f%%  频次%d' % (j + 1, desc, a, 100 * pct, n))
    return cands


def coverage(X, rules):
    cov = np.zeros(len(X), dtype=bool)
    for desc, a, pct, n in rules:
        # 复算 mask
        if '>0' in desc:
            i = int(desc[1:].split('>')[0])
            cov |= X[:, i] > 0
        elif '>=' in desc:
            i = int(desc[1:].split('>=')[0])
            v = float(desc.split('>=')[1])
            cov |= X[:, i] >= v
        elif '==' in desc:
            i = int(desc[1:].split('==')[0])
            v = float(desc.split('==')[1])
            cov |= X[:, i] == v
    return cov


Xr, labr = load('real', 'real_pool.npz')
rules_r = scan(Xr, labr, 'REAL')
covr = coverage(Xr, rules_r)
print('REAL 规则覆盖率: %.1f%% (%d/%d)' % (100 * covr.mean(), covr.sum(), len(Xr)))

Xd, labd = load('demo', 'demo_pool.npz')
rules_d = scan(Xd, labd, 'DEMO')
covd = coverage(Xd, rules_d)
print('DEMO 规则覆盖率: %.1f%% (%d/%d)' % (100 * covd.mean(), covd.sum(), len(Xd)))

# 以 REAL 为权威规则落库；附带维度的原始索引映射
def to_orig(desc):
    parts = desc
    # 替换 f 索引为原始130维索引
    i = int(parts[1:].split('>')[0].split('=')[0])
    orig = KEEP[i]
    return orig

out = []
for desc, a, pct, n in rules_r:
    i = int(desc[1:].split('>')[0].split('=')[0])
    op = '>0' if '>0' in desc else ('>=' if '>=' in desc else '==')
    val = desc.split(op)[1]
    out.append({
        'cond': {'feature_114': i, 'feature_130': KEEP[i], 'op': op, 'value': float(val)},
        'action': a,
        'support': n,
        'precision': round(float(pct), 4),
        'desc': desc + ' -> ' + a
    })
with open(WD + r'\basic_rules.json', 'w', encoding='utf-8') as f:
    json.dump({'rules': out, 'source': 'real', 'min_freq': MIN_FREQ, 'min_pct': MIN_PCT,
               'coverage_real': round(float(covr.mean()), 4)}, f, ensure_ascii=False, indent=1)
print('\n已写 basic_rules.json，规则数', len(out))
