# -*- coding: utf-8 -*-
"""P0_Scene_FullScan.py - 全量扫描三场景可行性（不依赖 sid 过滤）"""
import json
from collections import Counter

RAW = r'E:\NoNameAI\data\P0_True_Raw_Dataset.jsonl'

hp0 = Counter()           # f11 HP<=0 样本的 (source,action,id)
shan_player = Counter()
wuxie_player = Counter()
tao_hp = Counter()        # 出桃时的 HP 标记 (f9/f10/f11)
n = 0

with open(RAW, encoding='utf-8') as f:
    for line in f:
        n += 1
        r = json.loads(line)
        m = r.get('m') or {}
        feat = r.get('f')
        if not (isinstance(feat, list) and len(feat) == 130):
            continue
        src = m.get('source')
        aid = m.get('id')
        act = m.get('action')

        if feat[11] > 0:  # f11 HP<=0
            hp0[(str(src), str(act), str(aid))] += 1
        if aid == 'shan' and src == 'real':
            shan_player[str(m.get('player'))] += 1
        if aid == 'wuxie' and src == 'real':
            wuxie_player[str(m.get('player'))] += 1
        if aid == 'tao' and src == 'real':
            key = (feat[9] > 0, feat[10] > 0, feat[11] > 0)
            tao_hp[key] += 1
        if n % 300000 == 0:
            print('...%d' % n, flush=True)

print('总行数', n)
print('\n=== f11 HP<=0 样本分布（source, action, id）===')
for k, v in hp0.most_common(20):
    print(' ', k, v)

print('\n=== real 出闪(shan) 的 player 字段 Top15 ===')
for k, v in shan_player.most_common(15):
    print('  %-20s %d' % (k, v))

print('\n=== real 出无懈(wuxie) 的 player 字段 Top15 ===')
for k, v in wuxie_player.most_common(15):
    print('  %-20s %d' % (k, v))

print('\n=== real 出桃(tao) 时 HP 标记 (f9 HP<=2, f10 HP<=1, f11 HP<=0) ===')
for k, v in tao_hp.most_common(10):
    print('  %-18s %d' % (k, v))
