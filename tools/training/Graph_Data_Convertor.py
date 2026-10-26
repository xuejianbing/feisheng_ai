# -*- coding: utf-8 -*-
"""
Graph_Data_Convertor.py - 原始 JSON 样本 -> PyG 图结构转换器

设计依据（P0 指令「写 Graph_Data_Convertor.py，把原始 JSON 转成 PyG 图结构」）：
  输入：E:\\NoNameAI\\merged_shards\\shard_XXX.json 原始上报样本
        每条 sample = {f: 130维特征, m: {action,id,gameOutcome,sessionId,...}}
  输出：PyG 图样本（torch_geometric.data.Data 列表）

  节点（4 个，固定角色）：
    0 self   己方  —— 特征：血量(f8-f11) 手牌(f0-f5) 装备(f24-f27) 身份(f12-f15)
    1 ally   队友  —— 特征：人数(f18) 濒死(f19) HP占比(f70) 手牌占比(f71) 均值差(f64-f66) 协同(f112,f113)
    2 enemy  敌方  —— 特征：人数(f17) 濒死(f20) 诸葛/藤甲(f21,f22) 占比(f70,f71) 均值差(f64-f66) 牌堆(f88-f91)
    3 target 目标  —— 特征：目标手牌概率(f80-f84 闪/桃/无懈/杀/酒) 距离(f85) 座位压力(f86)
                       目标技能(f100,f101,f129) 对手倾向(f103)
  边：4x4 全连接有向（含 4 条自环）= 16 条；edge_attr 4 维 = [is_ally, is_enemy, self_loop, focus]

  ★ 泄露控制：严格排除 f32-f47（动作泄露段：动作类型/牌种/目标侧直读）。
    图节点与边只使用 f0-f31 与 f48-f129，与 114 维 KEEP 同源，
    保证 GAT 与 FT-Transformer(114维) 与 LGBM 基线三者口径一致、可公平对比。

CLI：
  python Graph_Data_Convertor.py --n-samples 60000 --demo 1000
"""
import argparse
import collections
import json
import os
import pickle
import re
import sys
import time

import numpy as np

# ===== 口径常量（与 P2_Human_Slot_Retrain.py 完全一致，保证与 LGBM 基线同口径） =====
KEEP = list(range(0, 32)) + list(range(48, 130))   # 114 维无泄露特征
TOP_CARDS = 14                                      # 14 高频出牌 + 武器槽 + 非武器槽 + other = 17 类
WEAPONS = {'zhuge', 'guanshi', 'zhangba', 'guding', 'cixiong', 'qinggang',
           'qinglong', 'hanbing', 'qilin', 'zhuque', 'fangtian', 'muniu'}
ARMORS = {'bagua', 'renwang', 'tengjia', 'baiyin'}
HORSES = {'jueying', 'dilu', 'zhuahuang', 'hualiu', 'chitu', 'zixin', 'dawan'}

DEFAULT_SHARD_DIR = os.environ.get('TRAIN_HUMAN_SHARD_DIR', r'E:\NoNameAI\merged_shards')
DEFAULT_OUT_DIR = os.environ.get('TRAIN_GRAPH_DIR', r'E:\NoNameAI\gdata')

# ===== 图结构常量 =====
NUM_NODES = 4          # self, ally, enemy, target
NODE_DIM = 20          # 统一节点特征维度（self 20 / ally 11 / enemy 15 / target 11，不足补零）
EDGE_DIM = 4           # [is_ally, is_enemy, self_loop, focus]
NODE_ROLE = ['self', 'ally', 'enemy', 'target']

# 每个节点的原始 130 维特征索引（严格避开 32-47 泄露段）
SELF_FEATS = [8, 9, 10, 11,          # 血量：HP比例/濒死/1血/0血
              0, 1, 2, 3, 4, 5,      # 手牌：手牌数/占上限/有杀/有闪/有桃/有无懈
              24, 25, 26, 27,        # 装备：武器/防具/坐骑/连弩
              12, 13, 14, 15,        # 身份：主公/忠臣/反贼/内奸
              16, 65]                # 存活比例 / HP vs 敌均
ALLY_FEATS = [18, 19, 70, 71, 112, 113, 64, 65, 66, 67, 68]
ENEMY_FEATS = [17, 20, 21, 22, 70, 71, 64, 65, 66, 67, 68, 88, 89, 90, 91]
TARGET_FEATS = [80, 81, 82, 83, 84, 85, 86, 100, 101, 103, 129]
NODE_FEATS = [SELF_FEATS, ALLY_FEATS, ENEMY_FEATS, TARGET_FEATS]

FEATURE_DESC = {
    'self': '血量(f8-f11)+手牌(f0-f5)+装备(f24-f27)+身份(f12-f15)+存活/HP差',
    'ally': '人数(f18)+濒死(f19)+HP占比(f70)+手牌占比(f71)+均值差(f64-f66)+协同(f112,f113)',
    'enemy': '人数(f17)+濒死(f20)+诸葛/藤甲(f21,f22)+占比(f70,f71)+均值差(f64-f66)+牌堆(f88-f91)',
    'target': '手牌概率(f80-f84)+距离(f85)+压力(f86)+技能(f100,f101,f129)+倾向(f103)',
}


# ===== 标签口径（与 P2 一致） =====
def slot_of(eid):
    if eid in WEAPONS:
        return 'weapon'
    if eid in ARMORS:
        return 'armor'
    if eid in HORSES:
        return 'horse'
    return 'other'


def label_of(lab, cards):
    if lab in cards:
        return lab
    if lab.startswith('equip:'):
        eid = lab.split(':', 1)[1]
        if slot_of(eid) == 'weapon':
            return 'equip:weapon'
        if slot_of(eid) in ('armor', 'horse'):
            return 'equip:nonweapon'
    return 'other'


def build_classes(raw_labels):
    cnt = collections.Counter(raw_labels)
    cards = [k for k, v in cnt.most_common() if k.startswith('card:')][:TOP_CARDS]
    ysl = np.array([label_of(l, cards) for l in raw_labels], dtype=object)
    classes = sorted(c for c in set(ysl.tolist()) if c != 'other') + ['other']
    return classes, ysl, cards


# ===== 原始 JSON -> 扁平数组 =====
def load_human(shard_dir, max_samples=None):
    """读取 shard，返回 X130 / 原始标签 / sessionId / actorId / targetId"""
    X, labs, groups, actors, targets = [], [], [], [], []
    skipped = 0
    for fn in sorted(os.listdir(shard_dir)):
        if not re.match(r'^shard_\d{3}\.json$', fn):
            continue
        with open(os.path.join(shard_dir, fn), encoding='utf-8') as f:
            d = json.load(f)
        for s in d.get('samples', []):
            m = s.get('m') or {}
            fv = s.get('f')
            if not fv or not isinstance(fv, list) or len(fv) < 130:
                skipped += 1
                continue
            if m.get('gameOutcome') not in ('win', 'lose'):
                skipped += 1
                continue
            X.append(fv[:130])
            labs.append(str(m.get('action')) + ':' + str(m.get('id')))
            groups.append(m.get('sessionId'))
            actors.append(m.get('actorId'))
            targets.append(m.get('target'))
            if max_samples and len(X) >= max_samples:
                break
        if max_samples and len(X) >= max_samples:
            break
    return (np.asarray(X, dtype=np.float32),
            np.asarray(labs, dtype=object),
            np.asarray(groups, dtype=object),
            np.asarray(actors, dtype=object),
            np.asarray(targets, dtype=object),
            skipped)


# ===== 图构建 =====
def build_graphs(X130):
    """X130: [N,130] -> x [N,4,18], edge_index [N,2,16], edge_attr [N,16,4]"""
    N = X130.shape[0]
    x = np.zeros((N, NUM_NODES, NODE_DIM), dtype=np.float32)
    for nid, feats in enumerate(NODE_FEATS):
        x[:, nid, :len(feats)] = X130[:, feats]
    # 边：全连接有向 (i -> j)，含自环
    src, dst = [], []
    for i in range(NUM_NODES):
        for j in range(NUM_NODES):
            src.append(i)
            dst.append(j)
    E = len(src)
    edge_index = np.zeros((N, 2, E), dtype=np.int64)
    edge_index[:, 0, :] = np.asarray(src, dtype=np.int64)
    edge_index[:, 1, :] = np.asarray(dst, dtype=np.int64)
    edge_attr = np.zeros((N, E, EDGE_DIM), dtype=np.float32)
    for k in range(E):
        i, j = src[k], dst[k]
        if i == j:
            edge_attr[:, k, 2] = 1.0                       # self_loop
        if (i == 0 and j == 1) or (i == 1 and j == 0):    # self <-> ally
            edge_attr[:, k, 0] = 1.0                       # is_ally
        if ((i == 0 and j == 2) or (i == 2 and j == 0) or
                (i == 1 and j == 2) or (i == 2 and j == 1)):
            edge_attr[:, k, 1] = 1.0                       # is_enemy
        if (i == 0 and j == 3) or (i == 3 and j == 0):    # self <-> target
            edge_attr[:, k, 3] = X130[:, 87] / 127.0       # focus（f87 集火目标，无泄露）
    return x, edge_index, edge_attr


def graph_stats():
    return {
        'num_nodes': NUM_NODES,
        'node_dim': NODE_DIM,
        'num_edges': NUM_NODES * NUM_NODES,
        'edge_dim': EDGE_DIM,
        'node_roles': NODE_ROLE,
        'node_feature_desc': FEATURE_DESC,
        'excluded_leaky_range': [32, 47],
    }


def to_pyg(x, edge_index, edge_attr, y=None):
    """转成 torch_geometric.data.Data 列表（惰性导入，没装 PyG 也能跑转换）"""
    from torch_geometric.data import Data
    import torch
    datas = []
    for i in range(x.shape[0]):
        d = Data()
        d.x = torch.from_numpy(x[i])
        d.edge_index = torch.from_numpy(edge_index[i])
        d.edge_attr = torch.from_numpy(edge_attr[i])
        d.num_nodes = NUM_NODES
        if y is not None:
            d.y = torch.tensor(int(y[i]), dtype=torch.long)
        datas.append(d)
    return datas


# ===== 主流程 =====
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shards-dir', default=DEFAULT_SHARD_DIR)
    ap.add_argument('--out-dir', default=DEFAULT_OUT_DIR)
    ap.add_argument('--n-samples', type=int, default=60000, help='转换样本数（0=全量）')
    ap.add_argument('--demo', type=int, default=1000, help='额外导出的 PyG 图样本数')
    ap.add_argument('--test-size', type=float, default=0.2)
    ap.add_argument('--seed', type=int, default=42)
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    t0 = time.time()
    print('读取原始 JSON: %s' % args.shards_dir)
    X130, labs, groups, actors, targets, skipped = load_human(
        args.shards_dir, max_samples=(args.n_samples or None))
    print('样本 %d (跳过 %d), 特征 %d 维, session %d 个, 耗时 %.1fs'
          % (len(X130), skipped, X130.shape[1], len(set(groups.tolist())), time.time() - t0))

    classes, ysl, cards = build_classes(labs.tolist())
    c2i = {c: i for i, c in enumerate(classes)}
    yi = np.array([c2i[l] for l in ysl], dtype=np.int64)
    print('类别 %d 个: %s' % (len(classes), classes))

    # 按 sessionId 切分（整局不跨），与 P2 口径一致
    from sklearn.model_selection import GroupShuffleSplit
    tr, te = next(GroupShuffleSplit(n_splits=1, test_size=args.test_size,
                                    random_state=args.seed).split(
        np.zeros(len(X130)), np.zeros(len(X130)), groups=groups))
    print('训练 %d / 测试 %d（按 sessionId 切分）' % (len(tr), len(te)))

    # 归一化统计量（训练集上 min-max），供 NN 与 JS 侧共用
    Xk = X130[:, KEEP]
    mn = Xk[tr].min(axis=0)
    mx = Xk[tr].max(axis=0)
    rng = np.where(mx - mn > 1e-6, mx - mn, 1.0)
    print('114 维归一化范围: min[%.4f,%.4f] max[%.4f,%.4f]'
          % (mn.min(), mn.max(), mx.max(), mx.max()))

    # 图
    print('\n构建 PyG 图结构 ...')
    gx, gei, gea = build_graphs(X130)
    st = graph_stats()
    print('节点数 %d, 节点特征维度 %d, 边数 %d, 边特征维度 %d'
          % (st['num_nodes'], st['node_dim'], st['num_edges'], st['edge_dim']))
    for r in NODE_ROLE:
        print('  node[%d] %-7s %s' % (NODE_ROLE.index(r), r, FEATURE_DESC[r]))

    # 导出
    np.savez_compressed(os.path.join(args.out_dir, 'graph_flat.npz'),
                        X130=X130, feat114=X130[:, KEEP], y=yi, groups=groups,
                        classes=np.asarray(classes, dtype=object),
                        cards=np.asarray(cards, dtype=object),
                        mn=mn, mx=mx, rng=rng,
                        tr=tr, te=te)
    print('已保存 %s' % os.path.join(args.out_dir, 'graph_flat.npz'))

    # 1000 个 PyG 图样本
    demo_n = min(args.demo, len(X130))
    datas = to_pyg(gx[:demo_n], gei[:demo_n], gea[:demo_n], yi[:demo_n])
    pt_path = os.path.join(args.out_dir, 'graph_samples_%d.pt' % demo_n)
    torch = __import__('torch')
    torch.save(datas, pt_path)
    print('已导出 %d 个 PyG 图样本 -> %s' % (demo_n, pt_path))

    d0 = datas[0]
    print('\n=== 图样本结构（PyG Data） ===')
    print('  样本数     : %d' % len(datas))
    print('  x          : %s  (节点数 x 节点维度)' % (tuple(d0.x.shape),))
    print('  edge_index : %s  (2 x 边数)' % (tuple(d0.edge_index.shape),))
    print('  edge_attr  : %s  (边数 x 边维度)' % (tuple(d0.edge_attr.shape),))
    print('  y          : %s  (标签)' % (tuple(d0.y.shape),))
    print('  节点数/图  : %d' % st['num_nodes'])
    print('  边数/图    : %d' % st['num_edges'])
    print('  节点维度   : %d' % st['node_dim'])
    print('  边维度     : %d' % st['edge_dim'])
    with open(os.path.join(args.out_dir, 'graph_stats.json'), 'w', encoding='utf-8') as f:
        json.dump(st, f, ensure_ascii=False, indent=1)
    print('耗时 %.1fs' % (time.time() - t0))


if __name__ == '__main__':
    main()
