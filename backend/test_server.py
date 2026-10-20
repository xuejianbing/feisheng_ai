"""HTTP-level tests for the public ingest receipt contract."""
import http.client
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from collections import defaultdict
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(__file__))
import server as ingest_server


class IngestReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = self.temp_dir.name
        ingest_server.BASE_DIR = root
        ingest_server.DATA_DIR = os.path.join(root, "aggregate")
        ingest_server.MERGED_FILE = os.path.join(root, "merged_samples.json")
        ingest_server.BLACKLIST_FILE = os.path.join(root, "ip_blacklist.json")
        ingest_server._reqlog_path = os.path.join(root, "post_requests.log")
        ingest_server._shadow_seen_path = os.path.join(root, "shadow_seen_ids.json")
        os.makedirs(ingest_server.DATA_DIR, exist_ok=True)

        ingest_server._post_lock = threading.Lock()
        ingest_server.dedup_hashes.clear()
        ingest_server.ip_hourly_counts = defaultdict(int)
        ingest_server.last_hour_key = ""
        ingest_server.merged_samples = []
        ingest_server.merged_hashes = set()
        ingest_server.total_deduped_count = 0
        ingest_server._legacy_pool_total = 0
        ingest_server._pool_degraded = False
        ingest_server._pool_dirty[0] = False
        ingest_server._pool_saving[0] = False
        ingest_server._last_pool_save[0] = time.time()
        ingest_server._shadow_seen_ids.clear()
        ingest_server.RATE_LIMIT_PER_HOUR = 100
        ingest_server.BLACKLIST = set()

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), ingest_server.IngestHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=3)
        self.temp_dir.cleanup()

    def post(self, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=3)
        conn.request("POST", "/", body=body, headers={"Content-Type": "text/plain;charset=UTF-8"})
        response = conn.getresponse()
        result = json.loads(response.read().decode("utf-8"))
        status = response.status
        conn.close()
        return status, result

    def test_receipt_distinguishes_archive_pool_and_rejection(self):
        labeled = {"f": [0] * 134, "m": {"gameOutcome": 1}}
        unlabeled = {"f": [0] * 134, "m": {"sessionId": "s-1"}}
        payload = {"v": 2, "samples": [labeled, labeled, unlabeled]}

        status, response = self.post(payload)

        self.assertEqual(status, 200)
        self.assertEqual(response["samples"], 3)  # legacy field remains available
        self.assertEqual(response["new_unique"], 1)
        self.assertEqual(response["deduped_in_batch"], 1)
        self.assertEqual(response["rejected_unlabeled"], 1)
        self.assertEqual(response["receipt"], {
            "schema": "ingest-receipt-v1",
            "receivedSamples": 3,
            "archivedSamples": 3,
            "mergedNewSamples": 1,
            "duplicateSamples": 1,
            "rejectedUnlabeledSamples": 1,
            "mergedPoolTotal": 1,
            "hour": response["hour"],
        })

    def test_replayed_request_returns_original_receipt_without_second_archive(self):
        payload = {"v": 2, "samples": [{"f": [1] * 134, "m": {"gameOutcome": 0}}]}
        first_status, first = self.post(payload)
        second_status, second = self.post(payload)

        self.assertEqual(first_status, 200)
        self.assertEqual(second_status, 200)
        self.assertFalse(first["duplicate_request"])
        self.assertTrue(second["duplicate_request"])
        self.assertEqual(second["receipt"], first["receipt"])
        self.assertEqual(len(ingest_server.dedup_hashes), 1)
        hour_files = [
            os.path.join(root, name)
            for root, _, names in os.walk(ingest_server.DATA_DIR)
            for name in names
            if name.endswith(".json")
        ]
        self.assertEqual(len(hour_files), 1)
        with open(hour_files[0], encoding="utf-8") as stream:
            self.assertEqual(len(json.load(stream)), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
