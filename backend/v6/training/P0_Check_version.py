# -*- coding: utf-8 -*-
"""探查最新数据中的版本字段：brand / version / nonameVersion / clientVersion 等"""
import json
from collections import Counter

# 先看 18.json / 17.json 的结构和版本字段
for fn in [r'E:\NoNameAI\aggregate\2026-10-20\18.json',
           r'E:\NoNameAI\aggregate\2026-10-20\17.json']:
    print('=' * 60)
    print(fn)
    with open(fn, encoding='utf-8') as f:
        obj = json.load(f)
    print('顶层类型:', type(obj).__name__)
    if isinstance(obj, dict):
        print('顶层 keys:', list(obj.keys())[:20])
        # 取样本列表
        for k in ['samples', 'records', 'data', 'items']:
            if k in obj:
                rows = obj[k]
                break
        else:
            rows = list(obj.values())
    else:
        rows = obj
    print('记录数:', len(rows))
    if len(rows) == 0:
        continue
    # 打印第一条记录的完整 key 树
    first = rows[0]
    def walk(o, pre=''):
        if isinstance(o, dict):
            for k, v in o.items():
                p = pre + '.' + k
                if isinstance(v, (dict, list)):
                    walk(v, p)
                else:
                    pass
    # 收集所有"版本"相关键
    def find_keys(o, hits, pre=''):
        if isinstance(o, dict):
            for k, v in o.items():
                p = pre + '.' + k
                if any(t in k.lower() for t in ['version', 'brand', 'ver', 'release', 'client']):
                    hits.setdefault(p, Counter())
                    if not isinstance(v, (dict, list)):
                        hits[p][str(v)] += 1
                if isinstance(v, (dict, list)):
                    find_keys(v, hits, p)
        elif isinstance(o, list):
            for item in o[:3]:
                find_keys(item, hits, pre)
    hits = {}
    # 对全部记录统计版本字段
    for r in rows:
        find_keys(r, hits)
    print('版本相关字段统计:')
    for p, c in hits.items():
        print(f'  {p}: {dict(c.most_common(15))}')
