# -*- coding: utf-8 -*-
"""全量扫描 P0_True_Raw_Dataset.jsonl：统计 m.action / m.id 频次分布、跨 action 重叠"""
import json
from collections import Counter, defaultdict

RAW = r'E:\NoNameAI\data\P0_True_Raw_Dataset.jsonl'

n = 0
action_counter = Counter()
id_counter = Counter()
id2actions = defaultdict(set)
no_id = 0
has_sid = 0

with open(RAW, encoding='utf-8') as f:
    for line in f:
        n += 1
        d = json.loads(line)
        m = d.get('m') or {}
        act = m.get('action')
        aid = m.get('id')
        sid = m.get('sessionId')
        if sid:
            has_sid += 1
        action_counter[str(act)] += 1
        if aid is None or aid == '':
            no_id += 1
        else:
            aid = str(aid)
            id_counter[aid] += 1
            id2actions[aid].add(str(act))
        if n % 200000 == 0:
            print(f'  已扫描 {n} 行...', flush=True)

print('=' * 60)
print(f'总行数: {n}')
print(f'有 sessionId: {has_sid}')
print(f'm.id 为空: {no_id}')
print(f'm.action 分布: {dict(action_counter)}')
print(f'm.id distinct 总数: {len(id_counter)}')

overlap = {k: v for k, v in id2actions.items() if len(v) > 1}
print(f'跨 action 重叠的 id 数: {len(overlap)}')
for k, v in list(overlap.items())[:10]:
    print(f'  重叠: {k} -> {v}')

print('--- m.id 频次分桶 ---')
buckets = [(10000, '>=10000'), (5000, '5000-10000'), (1000, '1000-5000'),
           (500, '500-1000'), (100, '100-500'), (50, '50-100'),
           (20, '20-50'), (10, '10-20'), (5, '5-10'), (1, '1-5')]
for th, name in buckets:
    pass
counts = Counter()
for aid, c in id_counter.items():
    if c >= 10000: counts['>=10000'] += 1
    elif c >= 5000: counts['5000-10000'] += 1
    elif c >= 1000: counts['1000-5000'] += 1
    elif c >= 500: counts['500-1000'] += 1
    elif c >= 100: counts['100-500'] += 1
    elif c >= 50: counts['50-100'] += 1
    elif c >= 20: counts['20-50'] += 1
    elif c >= 10: counts['10-20'] += 1
    elif c >= 5: counts['5-10'] += 1
    else: counts['1-5'] += 1
for _, name in buckets:
    print(f'  {name:>12}: {counts[name]} 个 id')

print('--- Top 30 m.id ---')
for k, v in id_counter.most_common(30):
    print(f'  {v:7d}  {k}  actions={sorted(id2actions[k])}')

# 保存频次表供训练脚本使用
with open(r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1\action_id_counts.json', 'w', encoding='utf-8') as f:
    json.dump(id_counter, f, ensure_ascii=False)
print('已保存 action_id_counts.json')
