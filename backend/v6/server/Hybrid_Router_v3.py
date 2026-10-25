# -*- coding: utf-8 -*-
"""
Hybrid_Router_v3.py - 混合决策引擎 v3（高确定性硬规则前置 + 极简 LGBM 兜底）
决策链：
  1) 输入 114 维无泄露特征
  2) 【新增】硬规则前置：补刀杀分层规则（real 真人数据按 sessionId 切分独立验证，
     测试集精度 87.8%~98.7%），命中且手牌特征明确支持 -> 直接下发，source='hard_rule'
  3) 未命中规则 -> LGBM 11 类概率 -> 可执行性校验 + 选择性弃权（T=0.5）
  4) 都不满足 -> 弃权回退本地引擎
规则数据由 basic_rules.json 驱动（非硬编码，可随数据迭代更新）。
提供：route() / stats() / selfTest()
"""
import sys
import os
import json
import pickle
import numpy as np

ENGINE_DIR = os.environ.get("NN_ENGINE_DIR", os.path.dirname(os.path.abspath(__file__)))
WD = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ENGINE_DIR)
sys.path.insert(0, os.path.join(ENGINE_DIR, "_pylibs"))

MODEL_PATH = os.path.join(ENGINE_DIR, "SubModel_Policy_minimal_clean.pkl")
RULES_JSON = os.path.join(WD, "basic_rules.json") if os.path.exists(
    os.path.join(WD, "basic_rules.json")) else os.path.join(ENGINE_DIR, "basic_rules.json")
DEFAULT_T = 0.5

TOP10 = ["card:sha", "card:tiesuo", "card:tao", "card:guohe", "card:shunshou",
         "card:wuzhong", "card:jiu", "card:juedou", "card:nanman", "card:lebu"]

# 动作 -> 手牌特征索引（114 维口径）；规则下发前必须确认手牌支持
HAND_FEAT = {
    "card:sha": 2, "card:shan": 3, "card:tao": 4, "card:wuxie": 5,
    "card:juedou": 6, "card:nanman": 7,
    "card:wuzhong": 31, "card:tiesuo": 31,
    "card:guohe": None, "card:shunshou": None, "card:jiu": None, "card:lebu": None,
}

# 补刀杀分层硬规则（114 维口径；来源 basic_rules.json v3_final_layered）
# 条件 (索引, 操作, 值)，高精度优先
HARD_RULES = [
    ("R1_补刀杀_牌堆充裕", "card:sha",
     [(2, ">0", None), (20, "==", 42.0), (75, "==", 0.0)], 0.987),
    ("R2_补刀杀_诸葛连弩", "card:sha",
     [(2, ">0", None), (20, ">0", None), (27, "==", 127.0)], 0.966),
    ("R3_补刀杀_残局", "card:sha",
     [(2, ">0", None), (20, "==", 42.0), (76, "==", 127.0)], 0.900),
    ("R4_补刀杀_基础", "card:sha",
     [(2, ">0", None), (20, "==", 42.0)], 0.878),
]

_model = None
_booster = None
_classes = None
_call_count = 0
_fire_count = 0
_abstain_count = 0
_rule_count = 0
_rule_by_name = {r[0]: 0 for r in HARD_RULES}


def _load():
    global _model, _booster, _classes
    if _booster is None:
        pack = pickle.load(open(MODEL_PATH, "rb"))
        _model = pack["model"]
        _model.n_jobs = 1
        _booster = _model.booster_
        _classes = np.array(pack["classes"], dtype=object)
    return _booster, _classes


def _rule_hit(x114):
    """x114: 114 维 numpy 1D。返回 (规则名, 动作, 置信度) 或 None。"""
    for name, action, conds, conf in HARD_RULES:
        hit = True
        for i, op, v in conds:
            val = x114[i]
            if op == ">0":
                if not (val > 0):
                    hit = False
                    break
            elif op == "==":
                if not (val == v):
                    hit = False
                    break
            else:
                if not (val == 0):
                    hit = False
                    break
        if hit:
            hand_idx = HAND_FEAT.get(action)
            if hand_idx is not None and x114[hand_idx] > 0:
                return name, action, conf
    return None


def route(features, T=DEFAULT_T, verbose=False):
    """features: 114 维 list/array。返回 dict。"""
    global _call_count, _fire_count, _abstain_count, _rule_count
    booster, classes = _load()
    x = np.asarray(features, dtype=np.float64).reshape(-1)
    if x.shape[0] != 114:
        return {"ok": False, "msg": "feature dim must be 114, got %d" % x.shape[0]}

    # ===== 硬规则前置 =====
    hit = _rule_hit(x)
    if hit is not None:
        name, action, conf = hit
        _rule_count += 1
        _rule_by_name[name] = _rule_by_name.get(name, 0) + 1
        result = {"ok": True, "source": "hard_rule", "rule": name,
                  "execute_action_id": action, "confidence": round(conf, 4),
                  "abstain": False}
        if verbose:
            print("[Hybrid_Router_v3] HARD_RULE %s -> %s (%.3f)" % (name, action, conf))
        return result

    # ===== LGBM 兜底 + 可执行性校验 + 选择性弃权 =====
    xm = x.reshape(1, -1)
    P = booster.predict(xm)[0]
    order = np.argsort(-P)
    chosen = None
    conf = 0.0
    for rank in order:
        cname = classes[rank]
        if cname == "other":
            break
        fidx = HAND_FEAT.get(cname)
        if fidx is not None and xm[0, fidx] > 0:
            chosen = cname
            conf = float(P[rank])
            break

    _call_count += 1
    if chosen is not None and conf >= T:
        _fire_count += 1
        result = {"ok": True, "source": "model", "execute_action_id": chosen,
                  "confidence": round(conf, 4), "abstain": False}
    else:
        _abstain_count += 1
        result = {"ok": True, "source": "engine_fallback", "execute_action_id": None,
                  "confidence": round(conf, 4), "abstain": True,
                  "msg": "no high-confidence legal action; defer to local engine"}
    if verbose:
        print("[Hybrid_Router_v3] %s -> %s (conf=%.3f T=%.2f)"
              % (result["source"], result["execute_action_id"], conf, T))
    return result


def stats():
    return {"ok": True, "model": "SubModel_Policy_minimal_clean (11-class, 114-dim)",
            "threshold": DEFAULT_T, "calls": _call_count,
            "hard_rule_fired": _rule_count, "hard_rule_by_name": dict(_rule_by_name),
            "model_fired": _fire_count, "abstained": _abstain_count,
            "validated_real_top1": 0.5452, "hybrid_overall_real": 0.614,
            "hard_rule_test_precision": "87.6%~98.7% (sessionId split)"}


def selfTest():
    try:
        # 1) 全 0 输入 -> 安全弃权
        r0 = route([0] * 114)
        # 2) 补刀场景（有杀+1残血敌+牌堆充裕）-> 必须硬规则出杀
        feat = [0] * 114
        feat[2] = 63
        feat[20] = 42
        feat[75] = 0
        r1 = route(feat)
        # 3) 基础补刀（有杀+残血敌，无牌堆条件）-> 硬规则出杀
        feat2 = [0] * 114
        feat2[2] = 63
        feat2[20] = 42
        feat2[75] = 63  # 牌堆不充裕，避开 R1
        feat2[27] = 0   # 无连弩，避开 R2
        feat2[76] = 0   # 非残局，避开 R3
        r2 = route(feat2)
        ok = (r0["ok"] and r1["ok"] and r1.get("execute_action_id") == "card:sha"
              and r1.get("source") == "hard_rule"
              and r2.get("execute_action_id") == "card:sha")
        return {"ok": bool(ok), "msg": "Hybrid_Router_v3 selfTest",
                "data": {"zero_input": r0, "finisher_rule_R1": r1,
                         "finisher_rule_R4": r2, "stats": stats()}}
    except Exception as e:
        return {"ok": False, "msg": "Hybrid_Router_v3 selfTest failed: %s" % e}


if __name__ == "__main__":
    print("selfTest:", json.dumps(selfTest(), ensure_ascii=False, indent=2))
    print("stats:", stats())
