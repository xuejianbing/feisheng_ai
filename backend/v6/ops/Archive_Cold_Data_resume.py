# -*- coding: utf-8 -*-
"""
Archive_Cold_Data_resume.py — 冷数据归档断点续跑
1) 已完成且无 json 的日期：跳过；
2) 压缩包已存在但 json 未删（如 10-14）：独立验证压缩包完整性
   （数量/文件名/大小/逐文件 sha256），完整则删 json，损坏则删包重压；
3) 未处理的日期（10-15~10-18）：正常压缩 + 校验 + 删除。
热数据硬护栏不变。
"""
import os
import tarfile
import hashlib
import tempfile
import time

AGG = r'E:\NoNameAI\aggregate'
COLD_DATES = [
    '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12',
    '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17',
    '2026-10-18',
]
HOT_DATES = {'2026-10-19', '2026-10-20', '2026-10-21'}
MB = 1024 * 1024
BUF = 4 * 1024 * 1024


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while True:
            b = f.read(BUF)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def log(msg):
    print(msg, flush=True)


def verify_arch(arch_path, d, jsons):
    """用现有 json 对压缩包做完整验证，返回 (ok, reason)"""
    try:
        with tarfile.open(arch_path, 'r:gz') as tar:
            members = [m for m in tar.getmembers() if m.isfile()]
        if sorted([m.name for m in members]) != sorted(jsons):
            return False, '文件名/数量不一致'
        msize = dict((m.name, m.size) for m in members)
        with tempfile.TemporaryDirectory() as td:
            with tarfile.open(arch_path, 'r:gz') as tar:
                tar.extractall(td)
            for f in jsons:
                fp = os.path.join(d, f)
                if msize[f] != os.path.getsize(fp):
                    return False, '%s 大小不一致' % f
                if sha256_file(os.path.join(td, f)) != sha256_file(fp):
                    return False, '%s 内容 sha256 不一致' % f
        return True, 'ok'
    except Exception as e:
        return False, '压缩包无法打开或损坏: %r' % e


def build_arch(d, date, jsons, arch_path):
    before = 0
    orig = {}
    for f in jsons:
        fp = os.path.join(d, f)
        size = os.path.getsize(fp)
        before += size
        orig[f] = {'size': size, 'sha256': sha256_file(fp)}
    log('[%s] %d 个 json | 压缩前 %.2f MB | 原文件 sha256 已记录' % (date, len(jsons), before / MB))
    t0 = time.time()
    with tarfile.open(arch_path, 'w:gz', compresslevel=6) as tar:
        for f in jsons:
            tar.add(os.path.join(d, f), arcname=f)
    arch_size = os.path.getsize(arch_path)
    log('  打包完成，耗时 %.1fs | 压缩后 %.2f MB | 压缩率 %.2fx'
        % (time.time() - t0, arch_size / MB, before / arch_size))
    log('  压缩包 sha256: %s' % sha256_file(arch_path))
    ok, reason = verify_arch(arch_path, d, jsons)
    if not ok:
        raise RuntimeError('[%s] 新压缩包自检失败: %s' % (date, reason))
    return before, arch_size


def archive_date(date):
    if date in HOT_DATES:
        raise RuntimeError('安全护栏触发：拒绝压缩热数据目录 %s' % date)
    d = os.path.join(AGG, date)
    if not os.path.isdir(d):
        raise RuntimeError('目录不存在: %s' % d)
    jsons = sorted([f for f in os.listdir(d)
                    if f.endswith('.json') and os.path.isfile(os.path.join(d, f))])
    arch_path = os.path.join(d, '%s_raw.tar.gz' % date)

    if not jsons:
        if os.path.exists(arch_path):
            log('[%s] 已完成（无散装 json，压缩包在），跳过' % date)
        else:
            log('[%s] 无 json 且无压缩包，跳过' % date)
        return 0, 0

    if os.path.exists(arch_path):
        log('[%s] 压缩包已存在，先独立验证完整性...' % date)
        ok, reason = verify_arch(arch_path, d, jsons)
        if ok:
            before = sum(os.path.getsize(os.path.join(d, f)) for f in jsons)
            arch_size = os.path.getsize(arch_path)
            log('  验证通过：压缩包与现有 json 完全一致（%s）' % reason)
            for f in jsons:
                os.remove(os.path.join(d, f))
            log('  已删除 %d 个散装 json' % len(jsons))
            return before, arch_size
        log('  验证失败（%s）-> 删除损坏压缩包后重新压缩' % reason)
        os.remove(arch_path)

    before, arch_size = build_arch(d, date, jsons, arch_path)
    log('  校验通过：数量/文件名/大小/逐文件 sha256 全部一致')
    for f in jsons:
        os.remove(os.path.join(d, f))
    log('  已删除 %d 个散装 json' % len(jsons))
    return before, arch_size


def main():
    log('=' * 72)
    log('断点续跑开始 | 范围 %s ~ %s' % (COLD_DATES[0], COLD_DATES[-1]))
    log('=' * 72)
    total_before = 0
    total_after = 0
    t_start = time.time()
    for date in COLD_DATES:
        b, a = archive_date(date)
        total_before += b
        total_after += a
    log('=' * 72)
    log('续跑完成，总耗时 %.1f 分钟' % ((time.time() - t_start) / 60))
    if total_after:
        log('压缩前总大小: %.2f MB (%.2f GB)' % (total_before / MB, total_before / 1024 / MB))
        log('压缩后总大小: %.2f MB (%.2f GB)' % (total_after / MB, total_after / 1024 / MB))
        log('整体压缩率: %.2fx | 释放空间: %.2f GB'
            % (total_before / total_after, (total_before - total_after) / 1024 / MB))
    log('=' * 72)


if __name__ == '__main__':
    main()
