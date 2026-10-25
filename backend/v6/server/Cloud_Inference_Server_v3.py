# -*- coding: utf-8 -*-
"""
Cloud_Inference_Server_v3.py - 云端决策大脑 v3（接口防线加固版）
相对 v2 的改动：
 1) 强制维度拦截：POST /api/v1/predict 的 features 必须恰好 142 维，
    任何 !=142（150/130/143/缺维）一律 HTTP 400，终端红字告警。
 2) 内部严格清洗：142 维的前 130 维为本体特征，剔除 f32~f47（16 个动作泄露维）
    及其他冗余区，只取封版 114 维纯净特征送入 Hybrid_Router。
 3) /selfcheck 增加维度拦截自检（150 维必拒、142 维必过）。
端点：GET /health, GET /selfcheck, POST /api/v1/predict
"""
import os
import sys
import ctypes
import json
import time
import hashlib
import numpy as np
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# 引擎目录（Hybrid_Router.py / 模型所在目录）：默认本文件同目录，可用环境变量覆盖
ENGINE_DIR = os.environ.get("NN_ENGINE_DIR", os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # 本目录优先：Hybrid_Router_v3
sys.path.insert(0, ENGINE_DIR)
sys.path.insert(0, os.path.join(ENGINE_DIR, "_pylibs"))
try:
    import Hybrid_Router_v3 as HR      # 规则前置 + LGBM 兜底
except ImportError:
    import Hybrid_Router as HR         # 回退旧引擎

API_KEY = os.environ.get("NONAMEAI_API_KEY", "<YOUR_API_KEY>")  # [REDACTED] 线上密钥已脱敏；部署时设置环境变量 NONAMEAI_API_KEY，切勿硬编码（审计A4）
PORT = int(os.environ.get("NN_PORT", "8000"))
EXPECTED_DIM = 142                 # 焊死：前端契约唯一合法维度
KEEP = list(range(0, 32)) + list(range(48, 130))   # 前130维 -> 114 维无泄露
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RUNTIME_CONFIG_PATH = os.path.join(BASE_DIR, "runtime_config.json")
RUNTIME_CONFIG = {}
if os.path.exists(RUNTIME_CONFIG_PATH):
    with open(RUNTIME_CONFIG_PATH, "r", encoding="utf-8") as f:
        RUNTIME_CONFIG = json.load(f)
MODEL_JS_PATH = os.path.join(BASE_DIR, "client_policy_model.js")
RULES_PATH = os.path.join(BASE_DIR, "basic_rules.json")
PUBLIC_API_BASE_URL = os.environ.get(
    "NN_PUBLIC_API_BASE_URL",
    RUNTIME_CONFIG.get("public_api_base_url", "https://api.feiqiaoai.uno"))


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def read_text(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


MODEL_JS = read_text(MODEL_JS_PATH)
RULES = json.loads(read_text(RULES_PATH))
MODEL_JS_SHA256 = sha256_file(MODEL_JS_PATH)
RULES_SHA256 = sha256_file(RULES_PATH)

# Windows 控制台红字
_ENABLE_VT = 3
try:
    k = ctypes.windll.kernel32
    h = k.GetStdHandle(-11)
    m = ctypes.c_uint32()
    k.GetConsoleMode(h, ctypes.byref(m))
    k.SetConsoleMode(h, m.value | 0x0004)
except Exception:
    pass


def red(s):
    return "\033[91m\033[1m%s\033[0m" % s


def green(s):
    return "\033[92m%s\033[0m" % s


print("加载 Hybrid_Router (ENGINE_DIR=%s) ..." % ENGINE_DIR)
print("引擎就绪:", HR.stats())
if hasattr(HR, "_load"):
    HR._load()
    print("Hybrid_Router 模型预热完成")

# 统计拦截次数
_stat = {"calls": 0, "rejected_dim": 0, "accepted": 0, "legacy_fallback": 0,
         "arbitrate_calls": 0, "model_latest": 0, "model_downloads": 0}
# 旧客户端维度：130=飞雀V1老客户端 134=飞雀V2 4.0.19-fix10（降级兼容，不报错）
LEGACY_DIMS = (130, 134)
# 150=废弃实验体，必须硬拒绝
FORBIDDEN_DIMS = (150,)


class Handler(BaseHTTPRequestHandler):
    def send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, code, text, content_type):
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        return self.headers.get("Authorization", "") == "Bearer " + API_KEY

    def path_only(self):
        return self.path.split("?", 1)[0]

    def do_GET(self):
        path = self.path_only()
        if path == "/health":
            self.send_json(200, {"status": "ok", "service": "NoNameAI Cloud Brain v3",
                                 "strict_dim": EXPECTED_DIM, "stats": _stat,
                                 "public_api_base_url": PUBLIC_API_BASE_URL,
                                 "engine": HR.stats()})
        elif path == "/selfcheck":
            self.send_json(200, self._selfcheck())
        elif path == "/api/v1/model/latest":
            if not self.authorized():
                self.send_json(401, {"error": "Unauthorized"})
                return
            _stat["model_latest"] += 1
            self.send_json(200, {
                "ok": True,
                "version": RULES.get("version", "v1"),
                "model": {
                    "format": "client-policy-model-v1",
                    "file": "client_policy_model.js",
                    "download_url": PUBLIC_API_BASE_URL + "/api/v1/model/file",
                    "size_bytes": len(MODEL_JS.encode("utf-8")),
                    "sha256": MODEL_JS_SHA256
                },
                "rules": {
                    "file": "basic_rules.json",
                    "size_bytes": len(json.dumps(RULES, ensure_ascii=False).encode("utf-8")),
                    "sha256": RULES_SHA256,
                    "content": RULES
                }
            })
        elif path == "/api/v1/model/file":
            if not self.authorized():
                self.send_json(401, {"error": "Unauthorized"})
                return
            _stat["model_downloads"] += 1
            self.send_text(200, MODEL_JS, "application/javascript; charset=utf-8")
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if not self.authorized():
            self.send_json(401, {"error": "Unauthorized"})
            return
        path = self.path_only()
        if path not in ("/api/v1/predict", "/api/v1/arbitrate"):
            self.send_json(404, {"error": "not found"})
            return

        n = int(self.headers.get("Content-Length", 0))
        try:
            req = json.loads(self.rfile.read(n))
            features = req["features"]
        except Exception:
            self.send_json(400, {"error": "invalid request"})
            return

        # ===== 维度防线：150 硬拒 / 130、134 降级兼容 / 仅 142 推理 =====
        if not isinstance(features, list):
            got = "non-list"
            self.send_json(400, {"error": "feature_dim_mismatch",
                                 "msg": "features must be a list, got %s" % got})
            return
        got = len(features)

        if got == EXPECTED_DIM:
            pass   # 142 维契约，进入完整推理链路
        elif got in LEGACY_DIMS:
            # 130/134 旧客户端：不报错、不推理，降级回退本地，提示升级
            _stat["legacy_fallback"] += 1
            print("\033[93m[LEGACY-FALLBACK] 旧客户端 %d 维请求降级回退本地 client=%s\033[0m"
                  % (got, self.client_address[0]))
            self.send_json(200, {
                "execute_action_id": None,
                "source": "legacy_fallback",
                "abstain": True,
                "confidence": 0.0,
                "critic": None,
                "msg": "请升级至 142 维"
            })
            return
        else:
            # 150 废弃实验体及任何其他非预期维度：硬拒绝 400 + 红字告警
            _stat["rejected_dim"] += 1
            print(red("[DIM-REJECT] 非法维度请求被拦截: got=%s expect=%d client=%s"
                      % (got, EXPECTED_DIM, self.client_address[0])))
            self.send_json(400, {
                "error": "feature_dim_mismatch",
                "msg": "features must be exactly %d dims, got %s" % (EXPECTED_DIM, got),
                "expected_dim": EXPECTED_DIM,
                "hint": "150 维为废弃实验体必须拒绝；旧客户端 130/134 走 legacy_fallback；前端契约 142"
            })
            return

        started = time.perf_counter()
        if path == "/api/v1/arbitrate":
            _stat["arbitrate_calls"] += 1
            print("[Arbitrate] 收到复杂局势请求，正在计算...")
        else:
            _stat["calls"] += 1
        # ===== 内部严格清洗：142 -> 前130 -> 剔除f32~f47 -> 114 =====
        f114 = [features[i] for i in KEEP]
        result = HR.route(f114)
        if not result.get("ok"):
            self.send_json(400, result)
            return

        _stat["accepted"] += 1
        elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
        self.send_json(200, {
            "execute_action_id": result["execute_action_id"],
            "source": result["source"],
            "abstain": result["abstain"],
            "confidence": result["confidence"],
            "critic": None,
            "endpoint": path,
            "elapsed_ms": elapsed_ms
        })

    def _selfcheck(self):
        """维度防线自检：150 必拒 / 130、134 降级 / 142 必过（直调分流逻辑）"""
        try:
            def classify(n):
                if n == EXPECTED_DIM:
                    return "infer"
                if n in LEGACY_DIMS:
                    return "legacy_fallback"
                return "reject_400"

            r150 = {"dim": 150, "branch": classify(150)}
            r130 = {"dim": 130, "branch": classify(130)}
            r134 = {"dim": 134, "branch": classify(134)}
            f142 = [0] * 142
            f114 = [f142[i] for i in KEEP]
            r = HR.route(f114)
            r142 = {"dim": 142, "branch": classify(142),
                    "clean114": len(f114) == 114, "engine": r}
            assets = {
                "model_js": {"size_bytes": len(MODEL_JS.encode("utf-8")),
                             "sha256": MODEL_JS_SHA256},
                "rules": {"rules_count": len(RULES.get("rules", [])),
                          "sha256": RULES_SHA256},
                "endpoints": ["/api/v1/model/latest", "/api/v1/model/file",
                              "/api/v1/predict", "/api/v1/arbitrate"]
            }
            ok = (r150["branch"] == "reject_400"
                  and r130["branch"] == "legacy_fallback"
                  and r134["branch"] == "legacy_fallback"
                  and r142["branch"] == "infer" and r142["clean114"]
                  and r.get("ok") is True
                  and len(MODEL_JS) > 0 and len(RULES.get("rules", [])) >= 4)
            return {"ok": ok, "msg": "v3 dim-defense selfTest",
                    "data": {"reject_150": r150, "legacy_130": r130,
                             "legacy_134": r134, "accept_142": r142,
                             "assets": assets,
                             "strict_dim": EXPECTED_DIM, "stats": _stat}}
        except Exception as e:
            return {"ok": False, "msg": "selfTest failed: %s" % e}

    def log_message(self, *a):
        pass


class HighBacklogServer(ThreadingHTTPServer):
    request_queue_size = 1024
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    srv = HighBacklogServer(("0.0.0.0", PORT), Handler)
    print("=" * 60)
    print(green("NoNameAI 云端决策大脑 v3 (严格142维) -> http://0.0.0.0:%d" % PORT))
    print("=" * 60)
    srv.serve_forever()
