# -*- coding: utf-8 -*-
"""全量统计：modeContext.group / role / source × gameOutcome，定位阵营与幸存者偏差"""
import json
from collections import defaultdict, Counter

RAW = r'E:\NoNameAI\data\P0_True_Raw_Dataset.jsonl'

n = 0
group_c = Counter()
role_c = Counter()
source_c = Counter()
# 行级交叉
grp_role_out = Counter()
src_out = Counter()
role_out = Counter()
# session 级：sid -> (group, role, outcome, source)
sess = {}
role_vals_sample = {}

with open(RAW, encoding='utf-8') as f:
    for line in f:
        n += 1
        d = json.loads(line)
        m = d.get('m') or {}
        mc = m.get('modeContext') or {}
        grp = mc.get('group') or 'unknown'
        role = mc.get('role')
        out = m.get('gameOutcome')
        src = m.get('source')
        sid = m.get('sessionId')
        group_c[grp] += 1
        if role is not None:
            role_c[str(role)] += 1
            role_vals_sample.setdefault(str(role), 0)
            role_vals_sample[str(role)] += 1
        source_c[str(src)] += 1
        grp_role_out[(grp, str(role), str(out))] += 1
        src_out[(str(src), str(out))] += 1
        role_out[(str(role), str(out))] += 1
        if sid is not None:
            if sid not in sess:
                sess[sid] = (grp, str(role), str(out), str(src))
        if n % 200000 == 0:
            print(f'  已扫描 {n}...', flush=True)

print('=' * 70)
print(f'总行数: {n}')
print(f'session 数: {len(sess)}')
print('--- group 分布(行) ---')
for k, v in group_c.most_common():
    print(f'  {v:8d}  {k}')
print('--- role 取值(行) ---')
for k, v in role_c.most_common():
    print(f'  {v:8d}  {k}')
print('--- source 分布(行) ---')
for k, v in source_c.most_common():
    print(f'  {v:8d}  {k}')

print('--- role × outcome（行级，斗地主视角） ---')
agg = defaultdict(lambda: [0, 0, 0])
for (role, out), c in role_out.items():
    if out == 'win':
        agg[role][0] += c
    elif out == 'lose':
        agg[role][1] += c
    else:
        agg[role][2] += c
for role, (w, l, u) in agg.items():
    tot = w + l
    wr = w / tot * 100 if tot else 0
    print(f'  role={role:12s} win={w:7d} lose={l:7d} 无标记={u:6d} 胜率={wr:.2f}%')

print('--- source × outcome（行级，定位偏差来源） ---')
agg2 = defaultdict(lambda: [0, 0, 0])
for (src, out), c in src_out.items():
    if out == 'win':
        agg2[src][0] += c
    elif out == 'lose':
        agg2[src][1] += c
    else:
        agg2[src][2] += c
for src, (w, l, u) in agg2.items():
    tot = w + l
    wr = w / tot * 100 if tot else 0
    print(f'  source={src:22s} win={w:7d} lose={l:7d} 无标记={u:6d} 胜率={wr:.2f}%')

print('--- group × role × outcome（行级，主要组合） ---')
for k, v in grp_role_out.most_common(20):
    print(f'  {v:7d}  group={k[0]} role={k[1]} outcome={k[2]}')

print('--- session 级：地主局 / 农民局胜负 ---')
srole = defaultdict(lambda: [0, 0, 0])
for sid, (grp, role, out, src) in sess.items():
    if out == 'win':
        srole[role][0] += 1
    elif out == 'lose':
        srole[role][1] += 1
    else:
        srole[role][2] += 1
for role, (w, l, u) in srole.items():
    tot = w + l
    wr = w / tot * 100 if tot else 0
    print(f'  role={role:12s} 胜局={w:5d} 负局={l:5d} 无标记局={u:5d} 胜率={wr:.2f}%')
