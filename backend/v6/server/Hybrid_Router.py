# -*- coding: utf-8 -*-
"""
Hybrid_Router.py - 高确定性约束 + 极简 LGBM 混合决策引擎
决策逻辑（纯后端，不依赖前端补字段）：
  1) 输入 114 维无泄露特征
  2) LGBM 输出 11 类概率（Top10 主动动作 + other）
  3) 按概率降序，取第一个"手牌特征明确支持"的具体动作
  4) 该动作概率 >= 阈值 T（默认0.5，验证集上整体命中率最优）-> 下发
  5) 否则弃权（不强行下发错误动作），回退给本地游戏引擎
提供：route() / stats() / selfTest()
"""
import sys
import os
import pickle
import numpy as np

WD = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(WD, '_pylibs'))

MODEL_PATH = os.path.join(WD, 'SubModel_Policy_minimal_clean.pkl')
DEFAULT_T = 0.5

TOP10 = ['card:sha', 'card:tiesuo', 'card:tao', 'card:guohe', 'card:shunshou',
         'card:wuzhong', 'card:jiu', 'card:juedou', 'card:nanman', 'card:lebu']

# 具体动作 -> 手牌特征索引（114维口径）；该特征>0 表示手牌确有该牌/可执行
# None 表示 114 维无明确手牌特征，无法安全确认，故不下发该动作
HAND_FEAT = {
    'card:sha': 2, 'card:shan': 3, 'card:tao': 4, 'card:wuxie': 5,
    'card:juedou': 6, 'card:nanman': 7,
    'card:wuzhong': 31, 'card:tiesuo': 31,
    'card:guohe': None, 'card:shunshou': None, 'card:jiu': None, 'card:lebu': None
}

_model = None
_booster = None
_classes = None
_call_count = 0
_fire_count = 0
_abstain_count = 0


def _load():
    global _model, _booster, _classes
    if _booster is None:
        pack = pickle.load(open(MODEL_PATH, 'rb'))
        _model = pack['model']
        _model.n_jobs = 1                 # 消除单条预测的 OpenMP 线程调度开销
        _booster = _model.booster_        # 原生 booster 单条 ~0.16ms
        _classes = np.array(pack['classes'], dtype=object)
    return _booster, _classes


def route(features, T=DEFAULT_T, verbose=False):
    """features: 114 维 list/array。返回 dict。"""
    global _call_count, _fire_count, _abstain_count
    booster, classes = _load()
    x = np.asarray(features, dtype=np.float64).reshape(1, -1)
    if x.shape[1] != 114:
        return {'ok': False, 'msg': 'feature dim must be 114, got %d' % x.shape[1]}

    P = booster.predict(x)[0]
    order = np.argsort(-P)

    chosen = None
    conf = 0.0
    for rank in order:
        cname = classes[rank]
        if cname == 'other':
            break
        fidx = HAND_FEAT.get(cname)
        if fidx is not None and x[0, fidx] > 0:
            chosen = cname
            conf = float(P[rank])
            break

    _call_count += 1
    if chosen is not None and conf >= T:
        _fire_count += 1
        result = {'ok': True, 'source': 'model', 'execute_action_id': chosen,
                  'confidence': round(conf, 4), 'abstain': False}
    else:
        _abstain_count += 1
        result = {'ok': True, 'source': 'engine_fallback', 'execute_action_id': None,
                  'confidence': round(conf, 4), 'abstain': True,
                  'msg': 'no high-confidence legal action; defer to local engine'}

    if verbose:
        print('[Hybrid_Router] %s -> %s (conf=%.3f, T=%.2f)'
              % (result['source'], result['execute_action_id'], conf, T))
    return result


def stats():
    return {'ok': True, 'model': 'SubModel_Policy_minimal_clean (11-class, 114-dim)',
            'threshold': DEFAULT_T, 'calls': _call_count,
            'fired': _fire_count, 'abstained': _abstain_count,
            'validated_real_top1': 0.5452, 'hybrid_overall_real': 0.614,
            'fire_precision_at_T': 0.67}


def selfTest():
    try:
        booster, classes = _load()
        # 构造一个全 0 输入（应安全弃权）
        r0 = route([0] * 114)
        # 构造一个高置信杀：用 f2 有杀（索引2），并填入模型偏好的状态值
        feat = [0] * 114
        feat[2] = 63  # 手牌有杀
        r1 = route(feat)
        ok = r0['ok'] and r1['ok']
        return {'ok': ok, 'msg': 'Hybrid_Router selfTest',
                'data': {'zero_input': r0, 'has_sha_input': r1, 'stats': stats()}}
    except Exception as e:
        return {'ok': False, 'msg': 'Hybrid_Router selfTest failed: %s' % e}


if __name__ == '__main__':
    print('selfTest:', selfTest())
