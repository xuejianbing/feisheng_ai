# -*- coding: utf-8 -*-
"""
Rebuild_Merged_Shards.py — 从 aggregate 全量重建分片合并池。
不修改 aggregate；只写 E:/NoNameAI/merged_shards 与 E:/NoNameAI/merged_samples.json。
"""
import json
import os
import sys

wd = r"C:\Users\123\Doubao\chats\2026-10-18\new-chat-1"
sys.path.insert(0, wd)

import AggregateReader as ar
import server_sharded as ss


def main():
    ss.merged_samples = []
    ss.merged_hashes = set()
    ss.total_deduped_count = 0
    ss._legacy_pool_total = 0
    ss._pool_degraded = False
    ss._pool_dirty[0] = True

    total = 0
    rejected = 0
    duplicates = 0
    for date, hour, sample in ar.iter_dates_samples(ar.list_dates()):
        total += 1
        m = sample.get("m", {})
        has_result = ("gameOutcome" in m) or ("outcomeTarget" in m) or ("observedReward" in m)
        if not has_result:
            rejected += 1
            continue
        h = ss.compute_sample_hash(sample)
        if h in ss.merged_hashes:
            duplicates += 1
            continue
        ss.merged_hashes.add(h)
        ss.merged_samples.append(sample)

    print("total_samples", total)
    print("rejected_unlabeled", rejected)
    print("duplicates_after_hash", duplicates)
    print("unique_to_merge", len(ss.merged_samples))
    print("saving shards...")
    ss._save_merged_pool_inner()

    with open(ss.MERGED_FILE, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    verified = 0
    shard_stats = []
    for rel in manifest.get("shards", []):
        path = ss._safe_shard_path(rel)
        with open(path, "r", encoding="utf-8") as f:
            sd = json.load(f)
        n = len(sd.get("samples", []))
        verified += n
        shard_stats.append({
            "shard": rel,
            "samples": n,
            "MB": round(os.path.getsize(path) / 1024 / 1024, 3)
        })
    print("manifest_total_unique", manifest.get("total_unique"))
    print("verified_samples", verified)
    print("manifest_MB", round(os.path.getsize(ss.MERGED_FILE) / 1024 / 1024, 3))
    print("shard_stats", json.dumps(shard_stats, ensure_ascii=False))
    if verified != len(ss.merged_samples) or manifest.get("total_unique") != verified:
        raise RuntimeError("shard verification failed")


if __name__ == "__main__":
    main()
