# -*- coding: utf-8 -*-
"""
无名AI扩展 - 数据上报接收服务
功能：接收扩展上报的对局数据，SHA-256去重，单IP每小时限流12次，并限制单请求大小
按小时存储到 aggregate 目录，同时实时合并去重到 merged_samples.json
"""
import json
import os
import time
import threading
import hashlib
from datetime import datetime
from http.server import ThreadingHTTPServer, HTTPServer, BaseHTTPRequestHandler
from collections import defaultdict
import re

# 配置
PORT = 8787
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "aggregate")
MERGED_FILE = os.path.join(BASE_DIR, "merged_samples.json")
RATE_LIMIT_PER_HOUR = 12  # 正常IP：每小时最多12次（2026-10-16 用户指令）
MAX_REQUEST_BYTES = 8 * 1024 * 1024  # 公网上报请求上限，避免异常大请求占满内存
BLACKLIST = set()  # 黑名单IP：传古早无标签重复数据的IP，单独严格限流
BLACKLIST_LIMIT_PER_DAY = 999999  # 黑名单IP：每天不限流
BLACKLIST_FILE = os.path.join(BASE_DIR, "ip_blacklist.json")
_reqlog_path = os.path.join(BASE_DIR, "post_requests.log")   # ★1015uploadfix 请求日志（成功+失败全记）
_legacy_pool_total = 0   # ★1015：超大池降级启动时保留的历史条数（GET / 展示用）

# 加载黑名单
try:
    with open(BLACKLIST_FILE, "r", encoding="utf-8") as f:
        BLACKLIST = set(json.load(f))
except Exception:
    pass
POOL_SAVE_INTERVAL = 60   # 合并池最小落盘间隔秒（节流：大池全量 dump 慢，逐请求 dump 会拖住响应致客户端超时断开）
_last_pool_save = [0.0]   # 上次池落盘时间戳
_pool_dirty = [False]     # 池有无未落盘增量
_pool_saving = [False]    # 后台落盘进行中守卫（PR6-4：落盘已移出请求路径）

# === shadowV5 decisionId 去重（PR7c：客户端存储满时游标写不进 → 重传循环，服务端兜底闸） ===
_shadow_seen_ids = set()
_shadow_seen_path = os.path.join(BASE_DIR, "shadow_seen_ids.json")

def _load_shadow_seen():
    global _shadow_seen_ids
    try:
        with open(_shadow_seen_path, "r", encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, list):
            _shadow_seen_ids = set(x for x in d if isinstance(x, str))
    except Exception:
        pass

def _save_shadow_seen():
    try:
        with open(_shadow_seen_path, "w", encoding="utf-8") as f:
            json.dump(list(_shadow_seen_ids)[-5000:], f)
    except Exception:
        pass

_load_shadow_seen()
_post_lock = threading.Lock()  # POST 状态操作临界区锁（限流/去重/小时文件/合并池）

# 确保数据目录存在
os.makedirs(DATA_DIR, exist_ok=True)

# 内存中的去重集合和限流计数
dedup_hashes = set()
ip_hourly_counts = defaultdict(int)
last_hour_key = datetime.now().strftime("%Y-%m-%dT%H")  # 按小时重置

# 自动合并池：内存中维护全局去重样本
merged_samples = []
merged_hashes = set()
total_deduped_count = 0  # 累计去掉的重复条数


def load_merged_pool():
    """启动时加载已有的合并数据"""
    global merged_samples, merged_hashes, _legacy_pool_total
    if os.path.exists(MERGED_FILE):
        try:
            _pool_size = os.path.getsize(MERGED_FILE)
            if _pool_size > 50 * 1024 * 1024:
                # ★1015：超大池不整载（600MB+ json.loads 拖死启动/OOM）——读头部 total_unique 保留计数，池从空重建
                try:
                    with open(MERGED_FILE, "r", encoding="utf-8") as f:
                        _head = f.read(2048)
                    _m = re.search(r'"total_unique":\s*(\d+)', _head)
                    if _m:
                        _legacy_pool_total = int(_m.group(1))
                except Exception:
                    pass
                print(f"  合并池过大({_pool_size // 1024 // 1024}MB, 历史 {_legacy_pool_total} 条)——降级启动：计数展示保留，新池从空重建")
                merged_samples = []
                merged_hashes = set()
                return
            with open(MERGED_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                merged_samples = data.get("samples", [])
                for s in merged_samples:
                    h = compute_sample_hash(s)
                    merged_hashes.add(h)
            print(f"  加载合并池: {len(merged_samples)} 条样本")
        except Exception as e:
            print(f"  合并池加载失败: {e}")
            merged_samples = []
            merged_hashes = set()


def compute_sample_hash(sample):
    """计算单条样本的哈希"""
    s = json.dumps(sample, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def save_merged_pool():
    """保存合并池到文件（PR6-4：后台线程调用；先快照再 dump，避免 dump 期间主线程 append 引发迭代异常/数据撕裂）"""
    if _pool_saving[0]:
        return
    _pool_saving[0] = True
    try:
        _save_merged_pool_inner()
    finally:
        _pool_saving[0] = False


def _save_merged_pool_inner():
    samples_snapshot = list(merged_samples)
    # 统计置信度分布（用快照）
    conf_dist = {}
    for s in samples_snapshot:
        conf = s.get("conf", 0)
        key = f"{conf:.1f}"
        conf_dist[key] = conf_dist.get(key, 0) + 1

    output = {
        "merged_at": datetime.now().isoformat(),
        "total_unique": len(samples_snapshot),
        "confidence_distribution": conf_dist,
        "samples": samples_snapshot
    }
    # 原子写：先写临时文件再替换，进程中途被杀不会写坏正式池文件（2026-10-14 修复）
    tmp_file = MERGED_FILE + ".tmp"
    with open(tmp_file, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_file, MERGED_FILE)
    _last_pool_save[0] = time.time()
    _pool_dirty[0] = False


def get_hour_key():
    return datetime.now().strftime("%Y-%m-%dT%H")


def get_hour_filepath(hour_key):
    """根据小时key获取文件路径，按日期分目录"""
    date_part = hour_key.split("T")[0]
    date_dir = os.path.join(DATA_DIR, date_part)
    os.makedirs(date_dir, exist_ok=True)
    hour_part = hour_key.split("T")[1]
    return os.path.join(date_dir, f"{hour_part}.json")


def _salvage_hour_array(raw_bytes):
    """★1015：从损坏的小时文件抢救完整 JSON 数组元素前缀（坏尾巴截掉）。"""
    try:
        text = raw_bytes.decode("utf-8", "replace")
        dec = json.JSONDecoder()
        i = text.find("[")
        if i < 0:
            return []
        i += 1
        objs = []
        n = len(text)
        while i < n:
            while i < n and text[i] in " \t\r\n,":
                i += 1
            if i >= n or text[i] == "]":
                break
            try:
                obj, j = dec.raw_decode(text, i)
            except Exception:
                break
            if isinstance(obj, dict):
                objs.append(obj)
            i = j
        return objs
    except Exception:
        return []


def compute_hash(data_str):
    return hashlib.sha256(data_str.encode("utf-8")).hexdigest()


class IngestHandler(BaseHTTPRequestHandler):
    timeout = 30  # 半开连接兜底：socket 读写 30s 超时抛异常关闭，线程退出不拖垮服务（2026-10-14）
    def _set_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self._set_cors()
        self.end_headers()

    def do_GET(self):
        # 更新检查接口
        if self.path.startswith("/update/check"):
            self._handle_update_check()
            return
        # 更新下载接口
        if self.path.startswith("/update/download"):
            self._handle_update_download()
            return
        # ★1015：/update/ 受限静态文件（正式包直链 /update/xxx.zip、热更 manifest.json）
        if self.path.startswith("/update/"):
            if self._handle_update_static():
                return

        self.send_response(200)
        self._set_cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        stats = {
            "status": "ok",
            "service": "wuming-ingest",
            "time": datetime.now().isoformat(),
            "merged_samples": len(merged_samples),
            "legacy_pool_total": _legacy_pool_total,
            "total_deduped": total_deduped_count
        }
        self.wfile.write(json.dumps(stats, ensure_ascii=False).encode("utf-8"))

    def _handle_update_static(self):
        """★1015：/update/ 受限静态服务——仅 update 目录内 .zip/.json，防穿越；命中返回 True。"""
        try:
            from urllib.parse import unquote
            update_dir = os.path.normpath(os.path.join(BASE_DIR, "update"))
            rel = self.path.split("?", 1)[0].split("#", 1)[0]
            rel = unquote(rel)
            rel = rel[len("/update/"):]
            rel = rel.replace("\\", "/").lstrip("/")
            cand = os.path.normpath(os.path.join(update_dir, rel))
            if not cand.startswith(update_dir + os.sep) or not os.path.isfile(cand):
                return False
            ext = os.path.splitext(cand)[1].lower()
            if ext == ".zip":
                ctype = "application/zip"
            elif ext == ".json":
                ctype = "application/json; charset=utf-8"
            else:
                return False
            with open(cand, "rb") as f:
                content = f.read()
            self.send_response(200)
            self._set_cors()
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")  # 防 CF 边缘缓存旧包 - 1015
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return True
        except Exception:
            return False

    def _handle_update_check(self):
        """返回最新版本信息（utf-8-sig 兼容 BOM；坏 JSON 返回 500 JSON 而非崩连接——★1015 修复 502）"""
        update_dir = os.path.join(BASE_DIR, "update")
        latest_json = os.path.join(update_dir, "latest.json")
        if os.path.exists(latest_json):
            try:
                with open(latest_json, "r", encoding="utf-8-sig") as f:
                    data = json.load(f)
            except Exception as eLJ:
                self.send_response(500)
                self._set_cors()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "latest.json invalid", "detail": str(eLJ)}, ensure_ascii=False).encode("utf-8"))
                return
            self.send_response(200)
            self._set_cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))
        else:
            self.send_response(404)
            self._set_cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "no update info"}, ensure_ascii=False).encode("utf-8"))

    def _handle_update_download(self):
        """返回最新扩展zip（★1015：优先按 latest.json.downloadUrl 动态分发；缺省/异常回退 latest.zip）
        仅接受 update 目录内的相对路径（/update/xxx 或 update/xxx），防目录穿越。"""
        update_dir = os.path.join(BASE_DIR, "update")
        latest_zip = os.path.join(update_dir, "latest.zip")
        target_zip = latest_zip
        try:
            lj_path = os.path.join(update_dir, "latest.json")
            if os.path.exists(lj_path):
                with open(lj_path, "r", encoding="utf-8-sig") as f:
                    _cfg = json.load(f)
                _du = str(_cfg.get("downloadUrl") or "").strip()
                if _du and not _du.lower().startswith(("http://", "https://")):
                    _rel = _du.lstrip("/").replace("\\", "/")
                    if _rel.startswith("update/"):
                        _rel = _rel[len("update/"):]
                    _cand = os.path.normpath(os.path.join(update_dir, _rel))
                    if _cand.startswith(os.path.normpath(update_dir)) and os.path.exists(_cand) and os.path.isfile(_cand):
                        target_zip = _cand
        except Exception as eDU:
            try:
                sys.stderr.write("[update] downloadUrl resolve failed, fallback latest.zip: %r\n" % eDU)
            except Exception:
                pass
        latest_zip = target_zip
        if os.path.exists(latest_zip):
            with open(latest_zip, "rb") as f:
                content = f.read()
            self.send_response(200)
            self._set_cors()
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", "attachment; filename=" + os.path.basename(latest_zip))
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        else:
            self.send_response(404)
            self._set_cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "no update package"}, ensure_ascii=False).encode("utf-8"))

    def do_POST(self):
        global ip_hourly_counts, last_hour_key

        # 真实客户端 IP：Cloudflare Tunnel 转发时 client_address 恒为 127.0.0.1，
        # 必须优先取 Cloudflare 注入的 CF-Connecting-IP（X-Forwarded-For 兜底），否则全用户共享限流
        client_ip = (self.headers.get("CF-Connecting-IP")
                     or (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
                     or self.client_address[0])

        # 先读完请求体（锁外网络 IO）：半开/中断连接由 handler timeout 兜底，异常直接放弃
        try:
            content_length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            self._safe_send(400, {"ok": False, "error": "invalid_content_length"})
            return
        if content_length <= 0:
            self._safe_send(400, {"ok": False, "error": "empty_body"})
            return
        if content_length > MAX_REQUEST_BYTES:
            self.close_connection = True
            self._safe_send(413, {"ok": False, "error": "request_too_large", "maxBytes": MAX_REQUEST_BYTES})
            return
        try:
            raw = self.rfile.read(content_length)
        except Exception:
            self.close_connection = True
            return
        # ★1015uploadfix 截断识别：对端（移动弱网/游戏切后台杀 socket）中途断流时 read 返回不足量，
        # 此前直接进 json.loads 抛 Unterminated string traceback；现在明确回 400+retryable，
        # 客户端 catch 后游标不推进、数据保留稍后自动重传（数据不丢）
        if len(raw) < content_length:
            self._safe_send(400, {"ok": False, "error": "truncated_body", "retryable": True,
                                  "got": len(raw), "want": content_length})
            return
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            self._safe_send(400, {"ok": False, "error": "invalid_json"})
            return
        if not isinstance(payload, (dict, list)):
            self._safe_send(400, {"ok": False, "error": "invalid_payload"})
            return
        samples = payload.get("samples", []) if isinstance(payload, dict) else payload
        if not isinstance(samples, list) or any(not isinstance(sample, dict) for sample in samples):
            self._safe_send(400, {"ok": False, "error": "invalid_samples"})
            return

        # 临界区：限流/去重/小时文件/合并池 串行化（并发线程下读-改-写会互相覆盖丢记录，2026-10-14 审查修复）
        _resp = None   # (status, obj, logline)
        with _post_lock:
            current_hour = get_hour_key()
            if current_hour != last_hour_key:
                ip_hourly_counts.clear()
                last_hour_key = current_hour

            # 区分黑名单IP和正常IP
            is_blacklisted = client_ip in BLACKLIST
            limit = BLACKLIST_LIMIT_PER_DAY if is_blacklisted else RATE_LIMIT_PER_HOUR
            limit_desc = "每天" if is_blacklisted else "每小时"

            # 限流检查（请求体已在锁外读完，锁内无网络 IO）
            if ip_hourly_counts[client_ip] >= limit:
                _resp = (429, {
                    "ok": False,
                    "error": "rate_limit",
                    "msg": f"{limit_desc}最多上报{limit}次"
                }, None)
            else:
                # 去重（整个请求级别）
                data_str = json.dumps(payload, sort_keys=True, ensure_ascii=False)
                h = compute_hash(data_str)
                if h in dedup_hashes:
                    ip_hourly_counts[client_ip] += 1
                    _resp = (200, {
                        "ok": True,
                        "deduped": True,
                        "msg": "重复数据已跳过"
                    }, None)
                else:
                    dedup_hashes.add(h)

                    # 追加到小时文件
                    hour_file = get_hour_filepath(current_hour)
                    samples = payload.get("samples", []) if isinstance(payload, dict) else payload

                    record = {
                        "hour": current_hour,
                        "panelStats": payload.get("panelStats", {}) if isinstance(payload, dict) else {},
                        "samples": samples
                    }
                    # v2 envelope 扩展字段落盘（shadow 决策摘要/连招/存储快照/诊断），存在才存
                    if isinstance(payload, dict):
                        for extra in ("shadowV5", "comboChains", "storage", "skillDiag", "skillBreakdown", "sampleDiag", "zipEnv", "config"):
                            if extra in payload:
                                if extra == "shadowV5" and isinstance(payload[extra], list):
                                    # PR7c: 按 decisionId 去重（重复=客户端游标写不进的重传，服务端只收首次）
                                    fresh = []
                                    for it in payload[extra]:
                                        did = it.get("decisionId") if isinstance(it, dict) else None
                                        if did:
                                            if did in _shadow_seen_ids:
                                                continue
                                            _shadow_seen_ids.add(did)
                                        fresh.append(it)
                                    if fresh:
                                        record[extra] = fresh
                                    _save_shadow_seen()
                                else:
                                    record[extra] = payload[extra]

                    # 读取现有文件，追加记录
                    existing = []
                    if os.path.exists(hour_file):
                        try:
                            with open(hour_file, "r", encoding="utf-8") as f:
                                existing = json.load(f)
                        except Exception:
                            # ★1015 修复：损坏文件不再静默清空（旧逻辑会丢整小时数据）——备份后抢救完整前缀
                            try:
                                with open(hour_file, "rb") as fr:
                                    _corrupt = fr.read()
                                _bak = hour_file + ".corrupt_%d.bak" % int(time.time())
                                with open(_bak, "wb") as fw:
                                    fw.write(_corrupt)
                                existing = _salvage_hour_array(_corrupt)
                                print("[ingest] 小时文件损坏已备份 %s（抢救 %d 条）" % (os.path.basename(_bak), len(existing)))
                            except Exception:
                                existing = []

                    existing.append(record)

                    # ★1015：原子写（tmp+replace）——写中途被杀不再损坏正式文件
                    _tmpf = hour_file + ".tmp"
                    with open(_tmpf, "w", encoding="utf-8") as f:
                        json.dump(existing, f, ensure_ascii=False, indent=2)
                        f.flush()
                        os.fsync(f.fileno())
                    os.replace(_tmpf, hour_file)

                    # === 自动合并到全局池 ===
                    new_count = 0
                    dup_in_batch = 0
                    rejected_unlabeled = 0
                    for sample in samples:
                        # 过滤古早无标签样本：没有对局结果标签的不收
                        m = sample.get('m', {})
                        has_result = ('gameOutcome' in m) or ('outcomeTarget' in m) or ('observedReward' in m)
                        if not has_result:
                            rejected_unlabeled += 1
                            continue
                        sh = compute_sample_hash(sample)
                        if sh not in merged_hashes:
                            merged_hashes.add(sh)
                            merged_samples.append(sample)
                            new_count += 1
                        else:
                            dup_in_batch += 1

                    global total_deduped_count
                    total_deduped_count += dup_in_batch

                    if new_count > 0:
                        _pool_dirty[0] = True
                        # PR6-4：落盘已移到响应发送之后的后台线程（临界区内同步 dump 373MB 池实测 27s，
                        # 会把响应拖到被移动网络掐断 → 客户端 Failed to fetch）

                    ip_hourly_counts[client_ip] += 1

                    _resp = (200, {
                        "ok": True,
                        "deduped": False,
                        "samples": len(samples),
                        "new_unique": new_count,
                        "deduped_in_batch": dup_in_batch,
                        "rejected_unlabeled": rejected_unlabeled,
                        "total_merged": len(merged_samples),
                        "total_deduped": total_deduped_count,
                        "hour": current_hour
                    }, f"[{datetime.now().strftime('%H:%M:%S')}] 收到 {client_ip}，{len(samples)}条样本，新增{new_count}条，去重{dup_in_batch}条，过滤古早无标签{rejected_unlabeled}条，池内{len(merged_samples)}条")

        # 响应发送（锁外网络 IO）
        status, obj, logline = _resp
        try:
            self.send_response(status)
            self._set_cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(obj, ensure_ascii=False).encode("utf-8"))
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, OSError):
            # ★1019crashfix：客户端断连(弱网/切后台杀socket)不再击穿进程，仅关闭连接；
            # 数据已入库，下方落盘逻辑照常执行
            self.close_connection = True
        if logline:
            print(logline)

        # PR6-4：响应已回客户端，落盘放后台线程执行（毫秒级响应 + 最多 60s 一次 + 防重入）
        if _pool_dirty[0] and time.time() - _last_pool_save[0] >= POOL_SAVE_INTERVAL:
            threading.Thread(target=save_merged_pool, daemon=True).start()

    def _safe_send(self, status, obj):
        # ★1015uploadfix：错误响应统一走这里，写 socket 全程 try——对端早断不再冒 ConnectionResetError
        try:
            self.send_response(status)
            self._set_cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(obj, ensure_ascii=False).encode("utf-8"))
        except Exception:
            self.close_connection = True

    def log_message(self, format, *args):
        # ★1015uploadfix 恢复请求日志（此前 pass 导致成功率盲区）：一行一请求落 post_requests.log
        try:
            with open(_reqlog_path, "a", encoding="utf-8") as f:
                f.write("%s %s%s" % (self.log_date_time_string(), format % args, nl))
        except Exception:
            pass


if __name__ == "__main__":
    print(f"=" * 50)
    print(f"无名AI数据接收服务已启动")
    print(f"监听端口: {PORT}")
    print(f"数据目录: {DATA_DIR}")
    print(f"合并文件: {MERGED_FILE}")
    print(f"限流: 每IP每小时 {RATE_LIMIT_PER_HOUR} 次")
    print(f"=" * 50)

    # 启动时加载已有合并池
    load_merged_pool()

    # 多线程 + _post_lock 串行化状态操作：并发处理连接（慢客户端/半开不阻塞他人），状态读-改-写互斥
    server = ThreadingHTTPServer(("0.0.0.0", PORT), IngestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")
        server.server_close()
