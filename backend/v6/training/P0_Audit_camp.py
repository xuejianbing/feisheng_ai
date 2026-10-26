# -*- coding: utf-8 -*-
"""
P0_Audit_camp.py - 阵营/对局视角审计
- 收集若干完整 session：actorId 集合、gameOutcome 集合、player 集合、modeContext
- 查清地主/农民如何识别、win/lose 是客观结果还是记录者视角
"""
import json
from collections import defaultdict, Counter

RAW = r'E:\NoNameAI\data\P0_True_Raw_Dataset.jsonl'

sessions = defaultdict(list)
n = 0
target_done = 0
# 先取前 60 个有 sid 的 session（完整收集）
wanted = []
with open(RAW, encoding='utf-8') as f:
    for line in f:
        d = json.loads(line)
        m = d.get('m') or {}
        sid = m.get('sessionId')
        if sid is None:
            continue
        if len(wanted) < 60:
            if sid not in wanted:
                wanted.append(sid)
        if sid in wanted:
            sessions[sid].append(d)
        if all(len(sessions.get(s, [])) > 0 for s in wanted) and len(sessions) == len(wanted):
            # 不能保证完整，继续读到这些session不再出现为止（简单起见读到60万个有sid行）
            pass
        n += 1
        if n >= 400000:
            break

print(f'收集 session 数: {len(sessions)}')
print('=' * 70)

# 逐个 session 汇总
single_view = 0
multi_view = 0
for i, sid in enumerate(wanted[:20]):
    rows = sessions[sid]
    actors = Counter()
    outcomes = Counter()
    players = Counter()
    sources = Counter()
    mc_keys = set()
    mc_sample = None
    for d in rows:
        m = d.get('m') or {}
        actors[m.get('actorId')] += 1
        outcomes[m.get('gameOutcome')] += 1
        players[str(m.get('player'))] += 1
        sources[m.get('source')] += 1
        mc = m.get('modeContext') or {}
        if mc:
            mc_keys.update(mc.keys())
            if mc_sample is None:
                mc_sample = mc
    nactors = len(actors)
    nout = len([k for k in outcomes if k])
    tag = '单视角' if nactors <= 1 else f'{nactors}视角'
    if nactors <= 1:
        single_view += 1
    else:
        multi_view += 1
    print(f'Session {i+1} [{tag}] 行数{len(rows)}')
    print(f'  actorId: {dict(actors)}')
    print(f'  gameOutcome: {dict(outcomes)}')
    print(f'  player: {dict(list(players.items())[:5])}')
    print(f'  source: {dict(sources)}')
    print(f'  modeContext keys: {sorted(mc_keys)}')
    if mc_sample:
        print(f'  modeContext 样本: {json.dumps(mc_sample, ensure_ascii=False)[:400]}')
    print('-' * 70)

print(f'前20 session: 单视角 {single_view}, 多视角 {multi_view}')
