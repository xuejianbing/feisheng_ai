# -*- coding: utf-8 -*-
"""
P1_ComboRules_Build.py - 决策三：组合技硬规则生成并合并进 basic_rules.json

流程：
  1. 扫描 E:\\NoNameAI\\aggregate\\**\\*.json，按 (sessionId, actorId) 还原动作序列；
     用真实数据计算每个 setup -> follow 的条件概率 P(follow|setup)，作为 confidence 依据；
     条件加强（如残血敌人 f20>0）时单独算 P(follow|setup, f20>0)。
  2. 生成 combo_rules.json（前端前置规则层可直接执行的 token 格式）：
     {"id","name","layer":"pre_model_force","condition":[...],"action",
      "priority","confidence","evidence":{...}}
  3. 备份 basic_rules.json（.bak_时间戳）后，把 combo_rules 节点合并进去，
     原 rules 内容原样保留；写回时 UTF-8 无 BOM。
  4. --self-test：校验语法、必备三条规则、token 合法性、confidence 区间、合并结果。

token 词典（comboChain.js 前置层评估；每个 token 必须能在客户端拿到）：
  <card>_used        本回合自己出牌阶段已打出该卡（从 turn 动作序列读取）
  <card>_in_hand     手牌中存在该卡（detectChains 同款 handNames 判定）
  sha_count_ge_2     手牌杀数 >= 2
  enemy_hp_le_2      存在 HP<=2 的敌方（状态特征 f20>0；客户端可用引擎判定）
  enemy_linked       存在被横置（铁索）的敌方（isPlayerLinked）
  zhuge_equipped     已装备诸葛连弩（me.getEquip('zhuge')）
"""

from legacy_training_guard import require_trusted_training_adapter
require_trusted_training_adapter()

import argparse
import collections
import datetime as dt
import glob
import json
import os
import shutil
import sys
import time

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
AGG_DIR = r'E:\NoNameAI\aggregate'
COMBO_JSON = os.path.join(WD, 'combo_rules.json')
BASIC_JSON = os.path.join(WD, 'basic_rules.json')

# 条件概率计算所需的 setup -> follow
PAIR_STATS = ['jiu', 'guohe', 'tiesuo', 'shunshou', 'juedou', 'wuzhong', 'nanman', 'lebu']
FOLLOW_OF = {
    'jiu': ['sha'],
    'guohe': ['sha'],
    'tiesuo': ['huogong'],
    'shunshou': ['sha'],
    'juedou': ['sha'],
    'wuzhong': ['sha'],
    'nanman': ['sha'],
}
VALID_TOKENS = {
    'jiu_used', 'guohe_used', 'tiesuo_used', 'shunshou_used', 'juedou_used',
    'wuzhong_used', 'nanman_used', 'lebu_used',
    'sha_in_hand', 'huogong_in_hand', 'sha_count_ge_2',
    'enemy_hp_le_2', 'enemy_linked', 'zhuge_equipped',
}


def scan():
    """返回 cond: {'setup': {'n_total', 下一步计数 Counter, n_f20, 下一步计数_f20 Counter,
       n_f2(有杀), n_f2f20(有杀且残血敌), 对应 next Counter}}"""
    stat = {a: {'n': 0, 'next': collections.Counter(),
                'n_f20': 0, 'next_f20': collections.Counter(),
                'n_f2': 0, 'next_f2': collections.Counter(),
                'n_f2_f20': 0, 'next_f2_f20': collections.Counter()}
            for a in PAIR_STATS}
    files = sorted(glob.glob(os.path.join(AGG_DIR, '*', '*.json')))
    for fp in files:
        try:
            packets = json.load(open(fp, encoding='utf-8'))
        except Exception:
            continue
        for pkt in packets:
            seq = collections.defaultdict(list)
            for s in pkt.get('samples') or []:
                m = s.get('m') or {}
                sid, actor = m.get('sessionId'), m.get('actorId')
                act, aid = m.get('action'), m.get('id')
                if not sid or actor is None or not act or not aid:
                    continue
                f = s.get('f')
                f20 = f[20] if isinstance(f, list) and len(f) > 20 else 0
                f2 = f[2] if isinstance(f, list) and len(f) > 2 else 0
                # 序列保留全部动作（与 P1_Combo_Shadow_Mining 同口径）；
                # 条件概率只统计 setup 为出牌类的相邻对
                seq[(sid, actor)].append((s.get('ts', 0), aid, f20, f2))
            for rows in seq.values():
                rows.sort(key=lambda x: x[0])
                for (_, a, f20, f2), (_, b, _1, _2) in zip(rows[:-1], rows[1:]):
                    if a in stat:
                        st = stat[a]
                        st['n'] += 1
                        st['next'][b] += 1
                        low = bool(f20 and f20 > 0)
                        has_sha = bool(f2 and f2 > 0)
                        if low:
                            st['n_f20'] += 1
                            st['next_f20'][b] += 1
                        if has_sha:
                            st['n_f2'] += 1
                            st['next_f2'][b] += 1
                        if low and has_sha:
                            st['n_f2_f20'] += 1
                            st['next_f2_f20'][b] += 1
    return stat


def p(stat, setup, follow, low=False, has_sha=False):
    st = stat.get(setup)
    if not st:
        return None, 0, 0
    if low and has_sha:
        n, c = st['n_f2_f20'], st['next_f2_f20'].get(follow, 0)
    elif low:
        n, c = st['n_f20'], st['next_f20'].get(follow, 0)
    elif has_sha:
        n, c = st['n_f2'], st['next_f2'].get(follow, 0)
    else:
        n, c = st['n'], st['next'].get(follow, 0)
    return (round(c / n, 4) if n else None), c, n


def build_rules(stat):
    """confidence 全部来自真实序列；手牌门控用 f2(有杀)>0，残血门控用 f20(敌方濒死)>0。
    火攻无手牌特征（f0-f31 仅杀/闪/桃/无懈/决斗/AOE），铁索→火攻无法门控测量，
    只能保留无条件概率并标 force_unsafe，建议走 soft boost。"""
    ev = {}
    for a, bs in FOLLOW_OF.items():
        ev[a] = {}
        for b in bs:
            p0, c0, n0 = p(stat, a, b)
            pl, cl, nl = p(stat, a, b, low=True)
            ps, cs, ns = p(stat, a, b, has_sha=True)
            psl, csl, nsl = p(stat, a, b, low=True, has_sha=True)
            ev[a][b] = {'p': p0, 'hits': c0, 'n': n0,
                        'p_lowhp': pl, 'hits_lowhp': cl, 'n_lowhp': nl,
                        'p_sha_in_hand': ps, 'hits_sha': cs, 'n_sha': ns,
                        'p_sha_lowhp': psl, 'hits_sha_lowhp': csl, 'n_sha_lowhp': nsl}
    rules = [
        {
            'id': 'CR_jiu_sha',
            'name': '酒→杀斩杀（酒已用且有杀，强制续杀）',
            'layer': 'pre_model_force',
            'recommended_layer': 'pre_model_force',
            'priority': 95,
            'condition': ['jiu_used', 'sha_in_hand'],
            'action': 'card:sha',
            'confidence': ev['jiu']['sha']['p_sha_in_hand'],
            'evidence': {
                'n': ev['jiu']['sha']['n_sha'], 'hits': ev['jiu']['sha']['hits_sha'],
                'empirical_p': ev['jiu']['sha']['p_sha_in_hand'],
                'empirical_p_base': ev['jiu']['sha']['p'],
                'client_chain_wins': '5/5=100%（jiu_sha 连招上报）',
                'note': '门控=用酒时f2(有杀)>0；自己出牌阶段用酒后下一张杀伤害+1，有杀必出',
            },
        },
        {
            'id': 'CR_guohe_sha_lowhp',
            'name': '过河拆桥→杀（拆牌压残血，补刀）',
            'layer': 'pre_model_force',
            'recommended_layer': 'pre_model_force' if (ev['guohe']['sha']['p_sha_lowhp'] or 0) >= 0.6 else 'soft_boost',
            'priority': 80,
            'condition': ['guohe_used', 'sha_in_hand', 'enemy_hp_le_2'],
            'action': 'card:sha',
            'confidence': ev['guohe']['sha']['p_sha_lowhp'],
            'evidence': {
                'n': ev['guohe']['sha']['n_sha_lowhp'],
                'hits': ev['guohe']['sha']['hits_sha_lowhp'],
                'empirical_p': ev['guohe']['sha']['p_sha_lowhp'],
                'empirical_p_base': ev['guohe']['sha']['p'],
                'note': '门控=用过河时f2(有杀)>0且f20(敌方濒死)>0；低于0.6建议软加分而非强制',
            },
        },
        {
            'id': 'CR_tiesuo_huogong',
            'name': '铁索连环→火攻（横置后属性引爆）',
            'layer': 'pre_model_force',
            'recommended_layer': 'soft_boost',
            'force_unsafe': True,
            'priority': 85,
            'condition': ['tiesuo_used', 'huogong_in_hand', 'enemy_linked'],
            'action': 'card:huogong',
            'confidence': ev['tiesuo']['huogong']['p'],
            'evidence': {
                'n': ev['tiesuo']['huogong']['n'],
                'hits': ev['tiesuo']['huogong']['hits'],
                'empirical_p_unconditional': ev['tiesuo']['huogong']['p'],
                'gated_p': '不可测量（114维特征无火攻手牌/横置状态字段）',
                'client_chain': 'tiesuo_fire 整周期触发 0 次，现仅以 bonus=3.5 软加分',
                'note': '门控后的真实概率无法从现有数据验证；强制出火攻风险高，建议保持 comboChain.js 软加分',
            },
        },
        {
            'id': 'CR_shunshou_sha_lowhp',
            'name': '顺手牵羊→杀（顺牌后补刀）',
            'layer': 'pre_model_force',
            'recommended_layer': 'pre_model_force' if (ev['shunshou']['sha']['p_sha_lowhp'] or 0) >= 0.6 else 'soft_boost',
            'priority': 78,
            'condition': ['shunshou_used', 'sha_in_hand', 'enemy_hp_le_2'],
            'action': 'card:sha',
            'confidence': ev['shunshou']['sha']['p_sha_lowhp'],
            'evidence': {
                'n': ev['shunshou']['sha']['n_sha_lowhp'],
                'hits': ev['shunshou']['sha']['hits_sha_lowhp'],
                'empirical_p': ev['shunshou']['sha']['p_sha_lowhp'],
                'empirical_p_base': ev['shunshou']['sha']['p'],
                'note': '门控=用顺手时f2(有杀)>0且f20(敌方濒死)>0',
            },
        },
        {
            'id': 'CR_juedou_sha',
            'name': '决斗→杀（决斗后持杀压制）',
            'layer': 'pre_model_force',
            'recommended_layer': 'pre_model_force' if (ev['juedou']['sha']['p_sha_in_hand'] or 0) >= 0.6 else 'soft_boost',
            'priority': 70,
            'condition': ['juedou_used', 'sha_in_hand'],
            'action': 'card:sha',
            'confidence': ev['juedou']['sha']['p_sha_in_hand'],
            'evidence': {
                'n': ev['juedou']['sha']['n_sha'],
                'hits': ev['juedou']['sha']['hits_sha'],
                'empirical_p': ev['juedou']['sha']['p_sha_in_hand'],
                'empirical_p_base': ev['juedou']['sha']['p'],
                'client_chain_wins': '2/2=100%（jue_lengtai 连招上报）',
            },
        },
        {
            'id': 'CR_zhuge_burst',
            'name': '连弩+多杀（诸葛连弩已装备且杀≥2）',
            'layer': 'pre_model_force',
            'recommended_layer': 'pre_model_force',
            'priority': 75,
            'condition': ['zhuge_equipped', 'sha_count_ge_2'],
            'action': 'card:sha',
            'confidence': 0.90,
            'evidence': {
                'client_chain_wins': '8/9=89%（zhuge_burst 连招上报）',
                'note': '序列统计无法直接取装备状态，confidence 取自客户端连招胜率',
            },
        },
    ]
    return rules, ev


def write_combo(rules, ev):
    doc = {
        'version': 'v1_combo_pre_force',
        'generated_at': dt.datetime.now().isoformat(timespec='seconds'),
        'data_source': 'E:\\NoNameAI\\aggregate（同 sessionId/actorId 相邻动作，共 %d 个小时归档）'
                      % len(glob.glob(os.path.join(AGG_DIR, '*', '*.json'))),
        'layer': 'pre_model_force',
        'semantics': '在策略模型推理之前评估：condition 全部为 true 且 action 合法时，'
                     '强制执行 action（最高 priority 胜出），模型不再参与该决策。'
                     'recommended_layer 为 soft_boost 或 force_unsafe=true 的规则'
                     '不建议强制拦截，只做加分（对应 comboChain.js 的 bonus 层）',
        'force_threshold': 0.60,
        'token_dictionary': {
            '<card>_used': '本回合自己出牌阶段已打出该卡（读取本回合动作序列）',
            '<card>_in_hand': '手牌中存在该卡（comboChain.js detectChains 的 handNames 判定）',
            'sha_count_ge_2': '手牌杀数量 >= 2（me.countCards("hs","sha")）',
            'enemy_hp_le_2': '存在 HP<=2 的敌方（对应训练特征 f20>0）',
            'enemy_linked': '存在被横置的敌方（playerState.isPlayerLinked）',
            'zhuge_equipped': '已装备诸葛连弩（me.getEquip("zhuge")）',
        },
        'rules': rules,
        'pair_evidence': ev,
    }
    with open(COMBO_JSON, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    print('combo_rules.json 已写入:', COMBO_JSON)


def merge_basic(rules):
    with open(BASIC_JSON, 'r', encoding='utf-8') as f:
        basic = json.load(f)
    bak = BASIC_JSON + '.bak_' + dt.datetime.now().strftime('%Y%m%d_%H%M%S')
    shutil.copy2(BASIC_JSON, bak)
    print('basic_rules.json 已备份:', bak)
    basic['combo_rules_layer'] = {
        'layer': 'pre_model_force',
        'order': '前置规则层：先于 LGBM 模型评估；命中即强制 action，模型不再参与',
        'source_file': 'combo_rules.json',
        'merged_at': dt.datetime.now().isoformat(timespec='seconds'),
        'rules': rules,
    }
    with open(BASIC_JSON, 'w', encoding='utf-8') as f:
        json.dump(basic, f, ensure_ascii=False, indent=2)
    print('combo 规则已合并进 basic_rules.json（原 %d 条白盒规则保留）'
          % len(basic.get('rules', [])))


def print_summary(rules):
    print('\n===== combo_rules.json 内容 =====')
    for r in rules:
        print('[%s] %s' % (r['id'], r['name']))
        print('  condition=%s  ->  %s  confidence=%.4f priority=%d'
              % (r['condition'], r['action'], r['confidence'], r['priority']))
        e = r['evidence']
        if 'n' in e and e['n']:
            print('  evidence: %d/%d = %.1f%%' % (e['hits'], e['n'], 100 * r['confidence']))
        else:
            print('  evidence:', {k: v for k, v in e.items() if 'wins' in k or 'note' in k})


def self_test():
    try:
        with open(COMBO_JSON, encoding='utf-8') as f:
            doc = json.load(f)
        with open(BASIC_JSON, encoding='utf-8') as f:
            basic = json.load(f)
        rules = doc['rules']
        need = {'CR_jiu_sha', 'CR_guohe_sha_lowhp', 'CR_tiesuo_huogong'}
        ids = {r['id'] for r in rules}
        errs = []
        if not need <= ids:
            errs.append('缺少必备规则: %s' % (need - ids))
        for r in rules:
            for t in r['condition']:
                if t not in VALID_TOKENS:
                    errs.append('%s 含未知 token: %s' % (r['id'], t))
            if not (0 <= r['confidence'] <= 1):
                errs.append('%s confidence 越界: %s' % (r['id'], r['confidence']))
            if r['layer'] != 'pre_model_force':
                errs.append('%s layer 非 pre_model_force' % r['id'])
        merged = basic.get('combo_rules_layer', {}).get('rules', [])
        if len(merged) != len(rules):
            errs.append('basic_rules.json 合并条数不一致（%d vs %d）'
                        % (len(merged), len(rules)))
        ok = not errs
        return {'ok': ok, 'msg': 'combo 规则自检: ' + ('; '.join(errs) or '全部通过'),
                'data': {'rule_count': len(rules), 'ids': sorted(ids),
                         'min_confidence': min(r['confidence'] for r in rules),
                         'merged_in_basic': len(merged)}}
    except Exception as e:
        return {'ok': False, 'msg': 'combo 规则自检异常: %s' % e, 'data': None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--self-test', action='store_true')
    args = ap.parse_args()
    if args.self_test:
        print(json.dumps(self_test(), ensure_ascii=False, indent=1))
        return 0
    t0 = time.time()
    print('扫描 aggregate 计算条件概率...', flush=True)
    stat = scan()
    for a in PAIR_STATS:
        n = stat[a]['n']
        print('  %-9s 作为前置动作 %7d 次，下一步分布 top3: %s'
              % (a, n, stat[a]['next'].most_common(3)), flush=True)
    rules, ev = build_rules(stat)
    write_combo(rules, ev)
    merge_basic(rules)
    print_summary(rules)
    print('\n耗时 %.1fs' % (time.time() - t0))
    res = self_test()
    print(json.dumps(res, ensure_ascii=False, indent=1))
    return 0 if res['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
