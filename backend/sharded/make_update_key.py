# -*- coding: utf-8 -*-
"""
生成更新通道授权密钥（与 server_sharded.py 的 update/keys.json 配套）。

用法：
  python make_update_key.py --note "首批内测" --expires 2028-01-01
  python make_update_key.py --revoke k3f9a1

行为：
  - 随机生成 32 字符密钥，只在标准输出打印一次（磁盘上只存 sha256）
  - 追加到 update/keys.json（默认 E:\\NoNameAI\\update\\keys.json）
"""
import argparse
import hashlib
import json
import os
import secrets
import string
import sys
from datetime import datetime

DEFAULT_KEYS = os.path.join(os.environ.get("INGEST_BASE_DIR", r"E:\NoNameAI"), "update", "keys.json")
ALPHABET = string.ascii_letters + string.digits


def load(path):
    if not os.path.exists(path):
        return {"keys": []}
    with open(path, "r", encoding="utf-8-sig") as f:
        data = json.load(f)
    if isinstance(data, list):
        data = {"keys": data}
    data.setdefault("keys", [])
    return data


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", default=DEFAULT_KEYS, help="keys.json 路径")
    ap.add_argument("--note", default="", help="备注，例如购买人/渠道")
    ap.add_argument("--expires", default="", help="到期日 YYYY-MM-DD，空表示永久")
    ap.add_argument("--revoke", default="", help="吊销指定 id")
    ap.add_argument("--length", type=int, default=32)
    args = ap.parse_args()

    data = load(args.keys)

    if args.revoke:
        hit = False
        for item in data["keys"]:
            if item.get("id") == args.revoke:
                item["revoked"] = True
                hit = True
        if not hit:
            sys.stderr.write("未找到 id=%s\n" % args.revoke)
            return 2
        save(args.keys, data)
        print("已吊销 %s" % args.revoke)
        return 0

    key = "".join(secrets.choice(ALPHABET) for _ in range(args.length))
    kid = "k" + secrets.token_hex(3)
    data["keys"].append({
        "id": kid,
        "sha256": hashlib.sha256(key.encode("utf-8")).hexdigest(),
        "note": args.note,
        "created": datetime.now().strftime("%Y-%m-%d"),
        "expires": args.expires,
        "revoked": False,
    })
    save(args.keys, data)

    print("已写入 %s" % args.keys)
    print("id:  %s" % kid)
    print("key: %s" % key)
    print("（这串 key 只显示这一次，请立即发给用户；服务端只保存 sha256）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
