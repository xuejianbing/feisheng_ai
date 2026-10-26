# -*- coding: utf-8 -*-
"""
Cloud_Inference_Server_v2.py - 云端决策大脑 v2
- 标准库 HTTPServer（与 v1 一致，无新增依赖）
- 接入 Hybrid_Router：可执行性校验 + 高置信下发 + 否则弃权回退
- 兼容 142 / 150 维请求：统一取前 130 维 -> 提取 114 维无泄露特征
- 端点：GET /health, GET /selfcheck, POST /api/v1/predict
"""
import os
import sys
import json
import numpy as np
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

WD = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WD)
sys.path.insert(0, os.path.join(WD, '_pylibs'))
import Hybrid_Router as HR

API_KEY = os.environ.get("NONAMEAI_API_KEY", "<YOUR_API_KEY>")  # [REDACTED] 密钥改环境变量，切勿硬编码
PORT = 8000
KEEP = list(range(0, 32)) + list(range(48, 130))   # 114 维

print("加载 Hybrid_Router ...")
print("引擎就绪:", HR.stats())


class Handler(BaseHTTPRequestHandler):
    def send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "ok", "service": "NoNameAI Cloud Brain v2",
                                 "stats": HR.stats()})
        elif self.path == "/selfcheck":
            self.send_json(200, HR.selfTest())
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.headers.get("Authorization", "") != "Bearer " + API_KEY:
            self.send_json(401, {"error": "Unauthorized"})
            return
        if self.path != "/api/v1/predict":
            self.send_json(404, {"error": "not found"})
            return

        n = int(self.headers.get("Content-Length", 0))
        try:
            req = json.loads(self.rfile.read(n))
            features = req["features"]
        except Exception:
            self.send_json(400, {"error": "invalid request"})
            return

        if not isinstance(features, list) or len(features) < 130:
            self.send_json(400, {"error": "feature dim must be >=130 (142/150), got %d"
                                  % len(features)})
            return

        # 统一：前130维 -> 114维（纯 Python 索引，避免 numpy 转换）
        f114 = [features[i] for i in KEEP]

        result = HR.route(f114)
        if not result.get("ok"):
            self.send_json(400, result)
            return

        self.send_json(200, {
            "execute_action_id": result["execute_action_id"],
            "source": result["source"],
            "abstain": result["abstain"],
            "confidence": result["confidence"],
            "critic": None
        })

    def log_message(self, *a):
        pass


class HighBacklogServer(ThreadingHTTPServer):
    request_queue_size = 1024
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    srv = HighBacklogServer(("0.0.0.0", PORT), Handler)
    print("=" * 46)
    print("NoNameAI 云端决策大脑 v2 -> http://0.0.0.0:%d" % PORT)
    print("=" * 46)
    srv.serve_forever()
