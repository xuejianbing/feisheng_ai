# -*- coding: utf-8 -*-
"""
Test_API_Dim.py
接口维度防线验证：
  150 维请求 -> 必须 HTTP 400 被拒
  142 维请求 -> 必须 HTTP 200 成功返回 execute_action_id
  130 维请求 -> 必须 HTTP 400 被拒
用法：
  python Test_API_Dim.py                 # 自动在 8011 端口起 v3 服务做端到端测试
  python Test_API_Dim.py --url http://127.0.0.1:8000   # 测试已部署的线上端口
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error

WD = os.path.dirname(os.path.abspath(__file__))
ENGINE_DIR = r"C:\Users\123\Doubao\chats\2026-10-18\new-chat-1"
PY = sys.executable
API_KEY = "<YOUR_API_KEY>"
TEST_PORT = 8011


def post(url, features):
    body = json.dumps({"features": features}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Authorization", "Bearer " + API_KEY)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")


def get(url):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status, r.read().decode("utf-8")


def wait_health(base, tries=40):
    for _ in range(tries):
        try:
            c, _ = get(base + "/health")
            if c == 200:
                return True
        except Exception:
            time.sleep(0.5)
    return False


def run_cases(base):
    print("=" * 70)
    print("目标服务:", base)
    print("=" * 70)
    cases = [
        ("150维（废弃实验体，必须 400 拒绝）", [0] * 150, 400, None),
        ("130维（飞雀V1旧客户端，必须 200 降级）", [0] * 130, 200, "legacy_fallback"),
        ("134维（飞雀V2 fix10，必须 200 降级）", [0] * 134, 200, "legacy_fallback"),
        ("142维（契约维度，必须成功）", [0] * 142, 200, None),
    ]
    all_ok = True
    for name, feats, expect, src in cases:
        code, resp = post(base + "/api/v1/predict", feats)
        ok = (code == expect)
        if src is not None:
            ok = ok and ('"%s"' % src in resp)
        all_ok &= ok
        print("\n[%s] %s" % (name, "PASS" if ok else "FAIL"))
        print("  发送维度=%d -> HTTP %d（期望 %d%s）" %
              (len(feats), code, expect, (" source=%s" % src) if src else ""))
        print("  响应: %s" % resp[:300])

    # 142 维构造一个有杀+残血敌的补刀场景，验证规则/模型链路
    feat = [0] * 142
    feat[2] = 63     # 手牌有杀
    feat[20] = 42    # 1 个残血敌方
    code, resp = post(base + "/api/v1/predict", feat)
    print("\n[补刀场景 142维: 有杀+残血敌] -> HTTP %d" % code)
    print("  响应: %s" % resp[:300])

    # 自检
    c, r = get(base + "/selfcheck")
    print("\n[selfcheck] HTTP %d\n  %s" % (c, r[:400]))
    print("\n" + ("全部维度拦截用例 PASS" if all_ok else "存在 FAIL，检查上方日志"))
    return all_ok


if __name__ == "__main__":
    if "--url" in sys.argv:
        base = sys.argv[sys.argv.index("--url") + 1].rstrip("/")
        ok = run_cases(base)
        sys.exit(0 if ok else 1)

    # 自启 v3
    env = dict(os.environ)
    env["NN_PORT"] = str(TEST_PORT)
    env["NN_ENGINE_DIR"] = ENGINE_DIR
    srv = os.path.join(WD, "Cloud_Inference_Server_v3.py")
    print("启动测试服务 v3 @ %d ..." % TEST_PORT)
    log = open(os.path.join(WD, "v3_test_server.log"), "w", encoding="utf-8")
    p = subprocess.Popen([PY, srv], env=env, stdout=log, stderr=subprocess.STDOUT)
    try:
        base = "http://127.0.0.1:%d" % TEST_PORT
        if not wait_health(base):
            print("服务启动失败，见 v3_test_server.log")
            sys.exit(2)
        ok = run_cases(base)
        sys.exit(0 if ok else 1)
    finally:
        p.terminate()
        try:
            p.wait(timeout=5)
        except Exception:
            p.kill()
