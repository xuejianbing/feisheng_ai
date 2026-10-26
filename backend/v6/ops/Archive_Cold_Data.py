# -*- coding: utf-8 -*-
"""
Archive_Cold_Data.py  —  冷数据归档压缩（冷热分离）
作用：将 E:\\NoNameAI\\aggregate 下 2026-10-08 ~ 2026-10-18 日期目录中的散装 .json
      打包为同目录下 YYYY-MM-DD_raw.tar.gz。

自动识别三种状态：
  A) 已有归档包 + 散装 json 已删除  -> 读包校验成员数 + 打印包 sha256
  B) 已有归档包 + 散装 json 仍在   -> 校验包完整性，通过则删除散装；不通过则重新打包
  C) 无归档包                      -> 打包 + 全量校验，通过后删除散装

安全：
  1) 热数据 10-19 / 10-20 / 10-21 与 merged_samples.json 绝对不碰（硬护栏）；
  2) 打包先写 .tmp 临时文件，成功后原子 rename，杜绝半拉包；
  3) 校验「文件数量 + 文件名 + 原始大小 + 逐文件 sha256（解压后比对）」全部通过后，
     才删除散装 .json；
  4) 只处理 .json 文件，.bak / 其他文件保留原位不动。
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
# 安全护栏：这些日期一律拒绝压缩
HOT_DATES = {'2026-10-19', '2026-10-20', '2026-10-21'}
MB = 1024 * 1024
BUF = 4 * 1024 * 1024
ARCH_SUFFIX = '_raw.tar.gz'


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


def list_json(d):
    """返回散装 json 文件名列表（仅文件、小写 .json 后缀），不递归。"""
    return sorted([f for f in os.listdir(d)
                   if f.lower().endswith('.json') and os.path.isfile(os.path.join(d, f))])


def pack_archive(d, date, jsons):
    """打包为 tar.gz（先写 .tmp 再 rename）。返回 (归档路径, 压缩前大小, 逐文件sha256)。"""
    arch_path = os.path.join(d, date + ARCH_SUFFIX)
    before = 0
    orig = {}
    for f in jsons:
        fp = os.path.join(d, f)
        size = os.path.getsize(fp)
        before += size
        orig[f] = {'size': size, 'sha256': sha256_file(fp)}

    fd, tmp_path = tempfile.mkstemp(suffix='.tmp', prefix=date + '_', dir=d)
    os.close(fd)
    try:
        with tarfile.open(tmp_path, 'w:gz', compresslevel=6) as tar:
            for f in jsons:
                # 包内只存文件名（与既有归档包结构一致）
                tar.add(os.path.join(d, f), arcname=f)
        os.replace(tmp_path, arch_path)
    except Exception:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        raise
    return arch_path, before, orig


def verify_archive(d, jsons, orig):
    """
    全量校验归档包：
      - 成员数量 / 文件名 / 大小
      - 解压到临时目录，逐文件 sha256 比对
    全部通过返回 True。
    """
    arch_path = os.path.join(d, os.path.basename(d) + ARCH_SUFFIX)
    with tarfile.open(arch_path, 'r:gz') as tar:
        members = [m for m in tar.getmembers() if m.isfile()]
    mnames = sorted([m.name for m in members])
    if len(members) != len(jsons):
        log('  [校验失败] 包内文件数量不一致: %d != %d' % (len(members), len(jsons)))
        return False
    if mnames != sorted(jsons):
        log('  [校验失败] 包内文件名不一致: 包内 %s' % mnames)
        return False
    msize = dict((m.name, m.size) for m in members)
    for f in jsons:
        if msize[f] != orig[f]['size']:
            log('  [校验失败] %s 大小不一致: 包内 %d vs 原始 %d' % (f, msize[f], orig[f]['size']))
            return False

    with tempfile.TemporaryDirectory() as td:
        with tarfile.open(arch_path, 'r:gz') as tar:
            tar.extractall(td)
        for f in jsons:
            if sha256_file(os.path.join(td, f)) != orig[f]['sha256']:
                log('  [校验失败] %s 解压后 sha256 不一致' % f)
                return False
    return True


def process_date(date):
    """处理一个日期目录。返回 (before, after, n_files, action)。"""
    if date in HOT_DATES:
        raise RuntimeError('安全护栏触发：拒绝压缩热数据目录 %s' % date)
    d = os.path.join(AGG, date)
    if not os.path.isdir(d):
        raise RuntimeError('目录不存在: %s' % d)

    arch_path = os.path.join(d, date + ARCH_SUFFIX)
    jsons = list_json(d)
    arch_exists = os.path.exists(arch_path)

    log('-' * 78)
    log('[%s] 散装 json %d 个 | 归档包 %s' % (date, len(jsons), '已存在' if arch_exists else '不存在'))

    # 状态 A：已有包 + 无散装 -> 读包校验
    if arch_exists and not jsons:
        try:
            with tarfile.open(arch_path, 'r:gz') as tar:
                members = [m for m in tar.getmembers() if m.isfile()]
        except (tarfile.TarError, EOFError, OSError) as e:
            log('  [严重] 状态 A: 归档包损坏且散装 json 已不存在，无法本地恢复: %s' % e)
            log('  需人工介入（从备份/网盘恢复），本轮不覆盖、不删除任何文件')
            return 0, 0, 0, 'broken-archive'
        arch_size = os.path.getsize(arch_path)
        arch_sha = sha256_file(arch_path)
        log('  状态 A: 已归档（散装已删除）。包内 json %d 个，包 %.2f MB' % (len(members), arch_size / MB))
        log('  压缩包 sha256: %s' % arch_sha)
        return 0, arch_size, len(members), 'already-archived'

    # 状态 B：已有包 + 散装还在 -> 校验包
    if arch_exists and jsons:
        orig = {}
        before = 0
        for f in jsons:
            fp = os.path.join(d, f)
            size = os.path.getsize(fp)
            before += size
            orig[f] = {'size': size, 'sha256': sha256_file(fp)}
        try:
            ok = verify_archive(d, jsons, orig)
        except (tarfile.TarError, EOFError, OSError) as e:
            log('  状态 B: 已有归档包无法读取（%s），判定为坏包，删除并重新打包' % e)
            ok = False
        if ok:
            log('  状态 B: 已有归档包校验通过（数量/文件名/大小/逐文件 sha256 一致）')
        else:
            if os.path.exists(arch_path):
                os.remove(arch_path)
            t0 = time.time()
            arch_path, before, orig = pack_archive(d, date, jsons)
            if not verify_archive(d, jsons, orig):
                raise RuntimeError('[%s] 重新打包后校验仍失败，保留散装文件' % date)
            log('  重新打包完成，耗时 %.1fs' % (time.time() - t0))
        arch_size = os.path.getsize(arch_path)
        arch_sha = sha256_file(arch_path)
        log('  压缩前 %.2f MB -> 压缩后 %.2f MB (压缩率 %.2fx)'
            % (before / MB, arch_size / MB, before / arch_size))
        log('  压缩包 sha256: %s' % arch_sha)
        for f in jsons:
            os.remove(os.path.join(d, f))
        log('  已删除散装 json %d 个' % len(jsons))
        return before, arch_size, len(jsons), 'verified-and-deleted'

    # 状态 C：无包 + 无 json
    if not jsons:
        log('  状态: 无 json 且无归档包，跳过')
        return 0, 0, 0, 'empty'

    # 状态 C：无包 + 有散装 -> 打包
    t0 = time.time()
    arch_path, before, orig = pack_archive(d, date, jsons)
    log('  状态 C: 打包完成，耗时 %.1fs' % (time.time() - t0))
    if not verify_archive(d, jsons, orig):
        raise RuntimeError('[%s] 校验失败，保留散装文件，不删除' % date)
    log('  校验通过：数量/文件名/大小/逐文件 sha256 全部一致')
    arch_size = os.path.getsize(arch_path)
    arch_sha = sha256_file(arch_path)
    log('  压缩前 %.2f MB -> 压缩后 %.2f MB (压缩率 %.2fx)'
        % (before / MB, arch_size / MB, before / arch_size))
    log('  压缩包 sha256: %s' % arch_sha)
    for f in jsons:
        os.remove(os.path.join(d, f))
    log('  已删除散装 json %d 个' % len(jsons))
    return before, arch_size, len(jsons), 'packed-and-deleted'


def main():
    log('=' * 78)
    log('冷数据归档开始 | 范围 %s ~ %s | 热数据 %s 不碰'
        % (COLD_DATES[0], COLD_DATES[-1], sorted(HOT_DATES)))
    log('=' * 78)
    total_before = 0
    total_after = 0
    total_files = 0
    actions = {}
    t_start = time.time()
    for date in COLD_DATES:
        b, a, n, action = process_date(date)
        total_before += b
        total_after += a
        total_files += n
        actions.setdefault(action, []).append(date)
    log('=' * 78)
    log('归档完成，总耗时 %.1f 分钟' % ((time.time() - t_start) / 60))
    for action, dates in actions.items():
        log('  %-20s : %s' % (action, dates))
    log('-' * 78)
    log('压缩前总大小: %.2f MB (%.2f GB)' % (total_before / MB, total_before / 1024 / MB))
    log('压缩后总大小: %.2f MB (%.2f GB)' % (total_after / MB, total_after / 1024 / MB))
    if total_before:
        log('整体压缩率  : %.2fx | 释放空间: %.2f GB | 覆盖 json 文件数: %d'
            % (total_before / total_after, (total_before - total_after) / 1024 / MB, total_files))
    else:
        log('覆盖 json 文件数: %d（本轮无新增压缩，仅校验既有包）' % total_files)
    log('=' * 78)


if __name__ == '__main__':
    main()
