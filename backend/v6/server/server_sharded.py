# -*- coding: utf-8 -*-
"""
无名AI扩展 - 数据上报接收服务 (SQLite 持久化版)
在 server_sharded.py 基础上改造：
  - 样本去重哈希 merged_hashes    → SQLite `sample_hashes` (主存，重启不重建)
  - 请求去重回执 dedup_hashes     → SQLite `request_receipts`
  - shadow decisionId 去重        → SQLite `shadow_ids`
  - 样本本体仍按分片 JSON 落盘（merged_shards/shard_XXX.json），不迁移样本
对外 HTTP 契约与 server_sharded.py 完全等价（/update/* GET、/ POST、回执 v1）。
"""
import json
import os
import time
import threading
import hashlib
import sqlite3
from datetime import datetime
from http.server import ThreadingHTTPServer, HTTPServer, BaseHTTPRequestHandler
from collections import defaultdict
import re

# 配置
PORT = 8787
BASE_DIR = os.environ.get("INGEST_BASE_DIR")
if not BASE_DIR:
    raise RuntimeError("E_EXPLICIT_INGEST_BASE_REQUIRED: set INGEST_BASE_DIR; no implicit production path")
from trusted_ingest import DurableInbox, IngestError, decode
from source_auth import SourceAuthority, AuthError
from ingest_access import client_ip as verified_client_ip, proxy_networks, capabilities, UPLOAD_PATHS
TRUSTED_PROXIES = proxy_networks(os.environ.get("INGEST_TRUSTED_PROXIES", ""))
AUTH_DB_PATH = os.environ.get("INGEST_AUTH_DB")
PUBLIC_ENDPOINT = os.environ.get("INGEST_PUBLIC_ENDPOINT")
ALLOW_LOOPBACK_HTTP = os.environ.get("INGEST_ALLOW_LOOPBACK_HTTP") == "1"
_authority = None
def source_authority():
    global _authority
    path = AUTH_DB_PATH
    if not path: return None
    if not PUBLIC_ENDPOINT:raise AuthError('E_SOURCE_ENDPOINT_CONFIG',503)
    if _authority is None: _authority = SourceAuthority(path,expected_endpoint=PUBLIC_ENDPOINT,allow_loopback_http=ALLOW_LOOPBACK_HTTP)
    _authority.require_endpoint()
    return _authority
_trusted = None
def trusted_inbox():
    global _trusted
    if _trusted is None:
        def guard(proof):
            authority=source_authority()
            if authority is None:raise AuthError('E_AUTH_NOT_CONFIGURED',503)
            return authority.prepared_guard(proof)
        _trusted = DurableInbox(os.path.join(BASE_DIR, "trusted_ingest"),authorization_guard=guard)
    return _trusted
DATA_DIR = os.path.join(BASE_DIR, "aggregate")
MERGED_FILE = os.path.join(BASE_DIR, "merged_samples.json")
SHARD_DIR = os.path.join(BASE_DIR, "merged_shards")
SHARD_SIZE = 50000
SQLITE_FILE = os.path.join(BASE_DIR, "dedup.sqlite")
RATE_LIMIT_PER_HOUR = 12  # 正常IP：每小时最多12次（2026-10-16 用户指令）
MAX_REQUEST_BYTES = 8 * 1024 * 1024  # 公网上报请求上限，避免异常大请求占满内存
BLACKLIST = set()  # 黑名单IP：传古早无标签重复数据的IP，单独严格限流
BLACKLIST_LIMIT_PER_DAY = 999999  # 黑名单IP：每天不限流
BLACKLIST_FILE = os.path.join(BASE_DIR, "ip_blacklist.json")
_reqlog_path = os.path.join(BASE_DIR, "post_requests.log")   # 1015uploadfix 请求日志（成功失败全记录）
_legacy_pool_total = 0   # 1015：超大池降级启动时保留的历史条数（GET / 展示用）

# 加载黑名单
try:
    with open(BLACKLIST_FILE, "r", encoding="utf-8") as f:
        BLACKLIST = set(json.load(f))
except Exception:
    pass
POOL_SAVE_INTERVAL = 60   # 合并池最小落盘间隔秒（大池快照移出请求路径）
MAX_MERGED_POOL_LOAD_BYTES = 256 * 1024 * 1024  # 超过此值时避免启动高峰内存膨胀；小时归档仍是完整数据源
_last_pool_save = [0.0]   # 上次池落盘时间戳
_pool_dirty = [False]     # 池有无未落盘增量
_pool_saving = [False]    # 后台落盘进行中守卫（PR6-4：落盘已移出请求路径）

# === SQLite 持久层 ===
_db = None          # 全局连接（受 _post_lock 保护）
_db_lock = threading.Lock()

def _db_connect():
    global _db
    if _db is not None:
        return _db
    conn = sqlite3.connect(SQLITE_FILE, timeout=15, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sample_hashes (
            sha TEXT PRIMARY KEY,
            first_seen TEXT NOT NULL
        ) WITHOUT ROWID;
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS request_receipts (
            sha TEXT PRIMARY KEY,
            receipt TEXT
        ) WITHOUT ROWID;
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS shadow_ids (
            decision_id TEXT PRIMARY KEY
        ) WITHOUT ROWID;
    """)
    conn.commit()
    _db = conn
    return conn

def _db_exec(conn, sql, args=()):
    cur = conn.execute(sql, args)
    conn.commit()
    return cur

def db_sample_has_seen(sha):
    """样本哈希是否已存在（SQLite 主存）"""
    try:
        conn = _db_connect()
        cur = conn.execute("SELECT 1 FROM sample_hashes WHERE sha=?", (sha,))
        return cur.fetchone() is not None
    except Exception:
        # 兜底：SQLite 异常时回退到内存集
        return sha in _mem_merged_hashes

def db_sample_hash_add(sha, now_iso):
    """原子插入样本哈希；返回 True=新增, False=已存在"""
    try:
        conn = _db_connect()
        cur = conn.execute("INSERT OR IGNORE INTO sample_hashes(sha, first_seen) VALUES(?,?)", (sha, now_iso))
        conn.commit()
        return cur.rowcount > 0
    except Exception:
        if sha not in _mem_merged_hashes:
            _mem_merged_hashes.add(sha)
            return True
        return False

def db_request_get(sha):
    """取请求去重回执；None=未见过该请求"""
    try:
        conn = _db_connect()
        cur = conn.execute("SELECT receipt FROM request_receipts WHERE sha=?", (sha,))
        row = cur.fetchone()
        if row and row[0]:
            try:
                return json.loads(row[0])
            except Exception:
                return None
        return None if not row else None
    except Exception:
        return _mem_dedup_hashes.get(sha)

def db_request_put(sha, receipt):
    try:
        conn = _db_connect()
        conn.execute("INSERT OR REPLACE INTO request_receipts(sha, receipt) VALUES(?,?)",
                     (sha, json.dumps(receipt, ensure_ascii=False) if receipt else None))
        conn.commit()
    except Exception:
        _mem_dedup_hashes[sha] = receipt

def db_request_contains(sha):
    try:
        conn = _db_connect()
        cur = conn.execute("SELECT 1 FROM request_receipts WHERE sha=?", (sha,))
        return cur.fetchone() is not None
    except Exception:
        return sha in _mem_dedup_hashes

def db_shadow_has(decision_id):
    try:
        conn = _db_connect()
        cur = conn.execute("SELECT 1 FROM shadow_ids WHERE decision_id=?", (decision_id,))
        return cur.fetchone() is not None
    except Exception:
        return decision_id in _mem_shadow_ids

def db_shadow_add(decision_id):
    try:
        conn = _db_connect()
        cur = conn.execute("INSERT OR IGNORE INTO shadow_ids(decision_id) VALUES(?)", (decision_id,))
        conn.commit()
        return cur.rowcount > 0
    except Exception:
        if decision_id not in _mem_shadow_ids:
            _mem_shadow_ids.add(decision_id)
            return True
        return False

def db_init_schema():
    _db_connect()

# === shadowV5 decisionId 去重（PR7c：客户端存储满时游标写不进→重传循环，服务端兜底闸） ===
_shadow_seen_path = os.path.join(BASE_DIR, "shadow_seen_ids.json")
_mem_shadow_ids = set()
_mem_dedup_hashes = {}
_mem_merged_hashes = set()

def _load_shadow_seen():
    global _mem_shadow_ids
    try:
        with open(_shadow_seen_path, "r", encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, list):
            _mem_shadow_ids = set(x for x in d if isinstance(x, str))
    except Exception:
        pass

def _save_shadow_seen():
    try:
        with open(_shadow_seen_path, "w", encoding="utf-8") as f:
            json.dump(list(_mem_shadow_ids)[-5000:], f)
    except Exception:
        pass

# Legacy indices remain read-only; new inbox initializes lazily.

_post_lock = threading.Lock()  # POST 状态操作临界区锁（限流/去重/小时文件/合并池）

# 确保数据目录存在
# No implicit writes to legacy archive directories.

# 内存中的请求去重回执和限流计数；请求重试可取回原批次统计（SQLite 为持久主存）
dedup_hashes = {}  # 兼容引用：保留内存缓存（SQLite 优先）
ip_hourly_counts = defaultdict(int)
last_hour_key = datetime.now().strftime("%Y-%m-%dT%H")  # 按小时重置

# 自动合并池：内存中维护全局去重样本（用于分片重写落盘；哈希判定走 SQLite）
merged_samples = []
merged_hashes = set()  # 兼容引用：启动后不再全量重建，仅作为 SQLite 异常兜底
total_deduped_count = 0  # 累计去掉的重复条数
_pool_degraded = False  # 大池降级时保护旧快照，避免用不完整内存池覆盖历史数据


def _safe_shard_path(rel):
    shard_root = os.path.normpath(SHARD_DIR)
    path = os.path.normpath(os.path.join(BASE_DIR, rel))
    if not path.startswith(shard_root + os.sep):
        raise ValueError("invalid shard path: %s" % rel)
    return path


def load_merged_pool():
    """启动时加载分片合并池；样本哈希灌入 SQLite（主存），样本本体保留内存用于分片重写。"""
    global merged_samples, merged_hashes, _legacy_pool_total, _pool_degraded
    _legacy_pool_total = 0
    _pool_degraded = False
    merged_samples = []
    merged_hashes = set()
    if not os.path.exists(MERGED_FILE):
        return
    try:
        _pool_size = os.path.getsize(MERGED_FILE)
        if _pool_size > MAX_MERGED_POOL_LOAD_BYTES:
            try:
                with open(MERGED_FILE, "r", encoding="utf-8") as f:
                    _head = f.read(2048)
                _m = re.search(r'"total_unique":\s*(\d+)', _head)
                if _m:
                    _legacy_pool_total = int(_m.group(1))
            except Exception:
                pass
            _pool_degraded = True
            print(f"  旧版单文件合并池过大({_pool_size // 1024 // 1024}MB, 历史 {_legacy_pool_total} 条)——保留旧快照")
            return

        with open(MERGED_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        shards = data.get("shards")
        conn = _db_connect()
        now_iso = datetime.now().isoformat()
        inserted = 0
        if isinstance(shards, list):
            for rel in shards:
                path = _safe_shard_path(rel)
                with open(path, "r", encoding="utf-8") as sf:
                    sd = json.load(sf)
                rows = []
                for s in sd.get("samples", []):
                    # 仅存档有训练价值的样本哈希；无标签的也一并去重（保持与原 merged_hashes 行为一致）
                    h = compute_sample_hash(s)
                    rows.append(h)
                    merged_samples.append(s)
                if rows:
                    conn.executemany("INSERT OR IGNORE INTO sample_hashes(sha, first_seen) VALUES(?,?)",
                                     [(r, now_iso) for r in rows])
                    conn.commit()
                    inserted += len(rows)
            merged_hashes.update(conn.execute("SELECT sha FROM sample_hashes").fetchall() and
                                 [r[0] for r in conn.execute("SELECT sha FROM sample_hashes").fetchall()] or [])
            print(f"  加载分片合并池: {len(merged_samples)} 条样本，{len(shards)} 个分片，SQLite 哈希 {inserted} 条")
            return
        else:
            merged_samples = data.get("samples", [])
            rows = []
            for s in merged_samples:
                h = compute_sample_hash(s)
                rows.append(h)
            if rows:
                conn.executemany("INSERT OR IGNORE INTO sample_hashes(sha, first_seen) VALUES(?,?)",
                                 [(r, now_iso) for r in rows])
                conn.commit()
            merged_hashes.update([r[0] for r in conn.execute("SELECT sha FROM sample_hashes").fetchall()])
            print(f"  加载旧版单文件合并池: {len(merged_samples)} 条样本，SQLite 哈希 {len(rows)} 条")
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
    if _pool_degraded:
        # 小时归档是完整源数据；绝不能用降级后只含增量的内存池覆盖历史快照
        _pool_dirty[0] = False
        return
    if _pool_saving[0]:
        return
    _pool_saving[0] = True
    try:
        _save_merged_pool_inner()
    finally:
        _pool_saving[0] = False


def _atomic_write_json(path, obj, compact=True):
    tmp_file = path + ".tmp"
    with open(tmp_file, "w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_file, path)


def _save_merged_pool_inner():
    samples_snapshot = list(merged_samples)
    conf_dist = {}
    for s in samples_snapshot:
        conf = s.get("conf", 0)
        try:
            key = f"{float(conf):.1f}"
        except Exception:
            key = str(conf)
        conf_dist[key] = conf_dist.get(key, 0) + 1

    os.makedirs(SHARD_DIR, exist_ok=True)
    written_shards = []
    for start in range(0, len(samples_snapshot), SHARD_SIZE):
        chunk = samples_snapshot[start:start + SHARD_SIZE]
        shard_idx = start // SHARD_SIZE
        rel = f"merged_shards/shard_{shard_idx:03d}.json"
        path = _safe_shard_path(rel)
        shard_obj = {
            "shard": f"shard_{shard_idx:03d}",
            "shard_index": shard_idx,
            "start": start,
            "total_unique": len(chunk),
            "samples": chunk
        }
        _atomic_write_json(path, shard_obj, compact=True)
        written_shards.append(rel)

    for name in os.listdir(SHARD_DIR):
        rel = os.path.join("merged_shards", name).replace("\\", "/")
        if re.match(r"^shard_\d{3}\.json$", name) and rel not in written_shards:
            os.remove(os.path.join(SHARD_DIR, name))

    output = {
        "format": "merged-pool-shards-v1",
        "merged_at": datetime.now().isoformat(),
        "total_unique": len(samples_snapshot),
        "shard_size": SHARD_SIZE,
        "shards": written_shards,
        "confidence_distribution": conf_dist,
        "samples": []
    }
    _atomic_write_json(MERGED_FILE, output, compact=False)
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
    """1015：从损坏的小时文件抢救完整 JSON 数组元素前缀（坏尾巴截掉）"""
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


def _find_last_non_whitespace(file_obj):
    """从文件尾部按块定位 JSON 数组的最后一个非空白字节"""
    end = file_obj.seek(0, os.SEEK_END)
    while end > 0:
        start = max(0, end - 4096)
        file_obj.seek(start)
        block = file_obj.read(end - start)
        for offset in range(len(block) - 1, -1, -1):
            if block[offset] not in b" \t\r\n":
                return start + offset, block[offset:offset + 1]
        end = start
    return None, None


def _array_has_items(file_obj, closing_pos):
    """判断首尾括号之间是否已有内容，兼容格式化空数组"""
    remaining = max(0, closing_pos - 1)
    file_obj.seek(1)
    while remaining:
        block = file_obj.read(min(4096, remaining))
        if not block:
            break
        if any(byte not in b" \t\r\n" for byte in block):
            return True
        remaining -= len(block)
    return False


def _write_hour_array_atomic(path, records):
    """损坏恢复时使用原子重写；正常请求走追加写"""
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, path)


def append_hour_record(path, record):
    """O(新增记录大小) 追加 JSON 数组元素，避免每个请求重写整小时文件"""
    encoded = json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if not os.path.exists(path):
        with open(path, "wb") as f:
            f.write(b"[" + encoded + b"]\n")
            f.flush()
            os.fsync(f.fileno())
        return

    with open(path, "r+b") as f:
        f.seek(0)
        if f.read(1) != b"[":
            closing_pos, closing_byte = None, None
        else:
            closing_pos, closing_byte = _find_last_non_whitespace(f)
        if closing_byte == b"]":
            has_items = _array_has_items(f, closing_pos)
            f.seek(closing_pos)
            f.write((b"," if has_items else b"") + encoded + b"]\n")
            f.truncate()
            f.flush()
            os.fsync(f.fileno())
            return

    # 文件尾部不完整时保留原件，再抢救所有完整前缀项后原子修复
    with open(path, "rb") as f:
        corrupt = f.read()
    backup = path + ".corrupt_%d.bak" % int(time.time())
    with open(backup, "wb") as f:
        f.write(corrupt)
        f.flush()
        os.fsync(f.fileno())
    recovered = _salvage_hour_array(corrupt)
    print("[ingest] 小时文件尾部异常，已备份 %s（抢救 %d 条）" % (os.path.basename(backup), len(recovered)))
    recovered.append(record)
    _write_hour_array_atomic(path, recovered)


def compute_hash(data_str):
    return hashlib.sha256(data_str.encode("utf-8")).hexdigest()


class IngestHandler(BaseHTTPRequestHandler):
    timeout = 30  # 半开连接兜底：socket 读写 30s 超时抛异常关闭，线程退出不拖垮服务（2026-10-14）
    def _set_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Expose-Headers", "Retry-After")

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

        try: self._safe_send(200, capabilities(source_authority()))
        except AuthError as exc: self._safe_send(exc.status, {"ok":False,"error":exc.code,"retryable":True})

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

        if self.path.split("?",1)[0] not in UPLOAD_PATHS:
            self.close_connection = True
            self._safe_send(404, {"ok":False,"error":"E_UPLOAD_ROUTE","retryable":False})
            return
        try: client_ip = verified_client_ip(self.client_address[0], self.headers, TRUSTED_PROXIES)
        except (AuthError, ValueError):
            self.close_connection = True
            self._safe_send(400, {"ok":False,"error":"E_PROXY_ADDRESS","retryable":False})
            return
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
        # Reserve before parsing or authenticating, including failed/replayed attempts.
        with _post_lock:
            current_hour = get_hour_key()
            if current_hour != last_hour_key:
                ip_hourly_counts.clear(); last_hour_key = current_hour
            limit = RATE_LIMIT_PER_HOUR  # Legacy "blacklist" is not an unlimited ingestion authorization.
            if ip_hourly_counts[client_ip] >= limit:
                retry = max(1, 3600 - int(time.time()) % 3600)
                self.close_connection = True
                self._safe_send(429, {"ok":False,"error":"rate_limit","retryAfterSeconds":retry}, {"Retry-After":str(retry)})
                return
            ip_hourly_counts[client_ip] += 1
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
            envelope, _ = decode(raw)
            if isinstance(envelope, dict) and envelope.get("v",2) not in (2,3):
                self._safe_send(400, {"ok":False,"error":"E_PROTOCOL_VERSION","retryable":False})
                return
        except IngestError as exc:
            self._safe_send(400, {"ok":False,"error":exc.code,"retryable":False})
            return
        with _post_lock:
            try:
                if self.headers.get("Authorization") or isinstance(envelope,dict) and "source" in envelope:
                    authority = source_authority()
                    if authority is None: raise AuthError("E_AUTH_NOT_CONFIGURED",503)
                    inbox = trusted_inbox()  # Recover under its own authorization guard before taking the live credential lock.
                    with authority.authorize(self.headers.get("Authorization"),envelope) as proof:
                        response = inbox.receive(raw, authorization=proof)
                else:
                    if isinstance(envelope,dict) and envelope.get("v")==3: raise AuthError("E_SOURCE_AUTH_REQUIRED")
                    response = trusted_inbox().receive(raw)
            except AuthError as exc:
                self._safe_send(exc.status, {"ok":False,"error":exc.code,"retryable":exc.status>=500})
                return
            except IngestError as exc:
                self._safe_send(503, {"ok":False,"error":exc.code,"retryable":True})
                return
            except (OSError, sqlite3.Error):
                self._safe_send(503, {"ok":False,"error":"E_INBOX_UNAVAILABLE","retryable":True})
                return
        self._safe_send(200, response)

    def _safe_send(self, status, obj, headers=None):
        # ★1015uploadfix：错误响应统一走这里，写 socket 全程 try——对端早断不再冒 ConnectionResetError
        try:
            self.send_response(status)
            self._set_cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            for name, value in (headers or {}).items(): self.send_header(name, value)
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
    print(f"SQLite去重库: {SQLITE_FILE}")
    print(f"限流: 每IP每小时 {RATE_LIMIT_PER_HOUR} 次")
    print(f"=" * 50)

    # 启动时加载已有合并池（哈希灌 SQLite）
    trusted_inbox()  # Recover only the separate durable inbox; never migrate legacy pools.

    # 多线程 + _post_lock 串行化状态操作：并发处理连接（慢客户端/半开不阻塞他人），状态读-改-写互斥
    server = ThreadingHTTPServer((os.environ.get("INGEST_BIND", "127.0.0.1"), PORT), IngestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")
        server.server_close()
