# -*- coding: utf-8 -*-
"""
AggregateReader.py — aggregate 冷热数据透明读取器
背景：冷数据日期(10-08~10-18) 已归档为 YYYY-MM-DD_raw.tar.gz；热数据日期(10-19+) 保持散装 .json。
本模块对上层屏蔽差异：
  - 热数据：直接读散装 .json
  - 冷数据：从 tar.gz 内流式读取（tar.extractfile），不解压到磁盘、不写临时目录
  - 若散装 json 与 tar.gz 同时存在，散装 json 优先（避免重复计数）
小时文件结构：list，每个 item 为 dict，样本在 item['samples']。
特征兼容：
  - 130 维：旧 schema，原样返回
  - 134 维：f130~f133 为目标身份 one-hot，规范化到旧 130 维时丢弃尾部，训练侧按 featureVersion 隔离
接入：清洗管线 `from AggregateReader import iter_dates_samples` 即可按日期遍历。
自检：stats() / selfTest() 返回 {ok, ...}，符合可验证代码全接入自检要求。
"""
import os
import re
import json
import tarfile

AGG_ROOT = r'E:\NoNameAI\aggregate'
ARCH_SUFFIX = '_raw.tar.gz'
LEGACY_FEATURE_DIM = 130
TARGET_IDENTITY_FEATURE_DIM = 134
SUPPORTED_FEATURE_DIMS = (LEGACY_FEATURE_DIM, TARGET_IDENTITY_FEATURE_DIM)
TARGET_IDENTITY_IDX = [130, 131, 132, 133]


def _hour_sources(date):
    """
    返回该日期全部小时文件来源 [(hour_name, kind, handle)]
      kind='json' -> handle=散装文件绝对路径
      kind='tar'  -> handle=(归档包路径, 成员名)
    去重：散装 json 优先；仅当无散装时才用 tar.gz。
    """
    d = os.path.join(AGG_ROOT, date)
    arch = os.path.join(d, date + ARCH_SUFFIX)
    loose = {}
    if os.path.isdir(d):
        for name in os.listdir(d):
            full = os.path.join(d, name)
            if name.lower().endswith('.json') and os.path.isfile(full):
                loose[name] = full
    if loose:
        return [(name, 'json', full) for name, full in sorted(loose.items())]
    if os.path.exists(arch):
        with tarfile.open(arch, 'r:gz') as tar:
            names = sorted([m.name for m in tar.getmembers()
                           if m.isfile() and m.name.lower().endswith('.json')])
        return [(name, 'tar', (arch, name)) for name in names]
    return []


def _load_hour(kind, handle):
    """加载一个小时文件，返回解析后的 Python 对象（list/dict）。"""
    if kind == 'json':
        with open(handle, 'r', encoding='utf-8') as f:
            return json.load(f)
    else:
        arch, member_name = handle
        with tarfile.open(arch, 'r:gz') as tar:
            m = tar.getmember(member_name)
            fobj = tar.extractfile(m)
            return json.loads(fobj.read().decode('utf-8'))


def _iter_samples(data):
    """从小时文件对象中迭代样本，兼容 list-of-item 与 dict 两种结构。"""
    if isinstance(data, dict):
        ss = data.get('samples')
        if isinstance(ss, list):
            for s in ss:
                yield s
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                ss = item.get('samples')
                if isinstance(ss, list):
                    for s in ss:
                        yield s
                else:
                    # item 本身可能就是一条样本
                    yield item
            else:
                yield item


def list_dates():
    """列出 aggregate 根目录下全部 YYYY-MM-DD 日期目录，按日期升序。"""
    out = []
    if not os.path.isdir(AGG_ROOT):
        return out
    for name in os.listdir(AGG_ROOT):
        full = os.path.join(AGG_ROOT, name)
        if os.path.isdir(full) and re.match(r'^\d{4}-\d{2}-\d{2}$', name):
            out.append(name)
    return sorted(out)


def list_hour_names(date):
    """返回该日期可读取的小时文件名列表（如 ['00.json','01.json']）。"""
    return [name for name, kind, handle in _hour_sources(date)]


def feature_version(sample):
    """
    推断样本特征版本：优先使用 gen.fv；缺失时用 f 长度兜底。
    """
    f = sample.get('f')
    if not isinstance(f, list):
        return None
    gen = sample.get('gen') or {}
    fv = gen.get('fv')
    if fv is not None:
        try:
            return int(fv)
        except (TypeError, ValueError):
            return len(f)
    return len(f)


def normalize_features(sample):
    """
    将样本特征规范化到旧 130 维 schema。
    返回：(f130, feature_version, target_identity_tail)
      - 130 维：原样返回，tail=[]
      - 134 维：取 f[0:130]，tail=f[130:134]
    其他维度抛出 ValueError，由上层计入跳过原因。
    """
    f = sample.get('f')
    if not isinstance(f, list):
        raise ValueError('特征 f 不是数组')
    fv = feature_version(sample)
    if len(f) == LEGACY_FEATURE_DIM:
        return list(f), fv if fv is not None else LEGACY_FEATURE_DIM, []
    if len(f) == TARGET_IDENTITY_FEATURE_DIM:
        tail = list(f[130:134])
        return list(f[:130]), fv if fv is not None else TARGET_IDENTITY_FEATURE_DIM, tail
    raise ValueError('不支持的特征维度: %d' % len(f))


def iter_hour_samples(date, hour_name):
    """读取指定日期 + 小时文件，yield 每条样本。"""
    for name, kind, handle in _hour_sources(date):
        if name == hour_name:
            data = _load_hour(kind, handle)
            for s in _iter_samples(data):
                yield s
            return
    raise FileNotFoundError('未找到 %s / %s' % (date, hour_name))


def iter_date_samples(date):
    """遍历某日期全部小时文件，yield (hour_name, sample)。"""
    for name, kind, handle in _hour_sources(date):
        data = _load_hour(kind, handle)
        for s in _iter_samples(data):
            yield name, s


def iter_dates_samples(dates):
    """遍历多个日期，yield (date, hour_name, sample)。"""
    for date in dates:
        for hour_name, s in iter_date_samples(date):
            yield date, hour_name, s


def iter_date_normalized_samples(date):
    """遍历某日期全部小时文件，并将每条样本特征规范化到 130 维，yield (hour_name, sample)。"""
    for hour_name, s in iter_date_samples(date):
        f130, fv, tail = normalize_features(s)
        s2 = dict(s)
        s2['f'] = f130
        s2['_featureVersion'] = fv
        s2['_targetIdentityTail'] = tail
        yield hour_name, s2


def iter_dates_normalized_samples(dates):
    """遍历多个日期并规范化特征，yield (date, hour_name, sample)。"""
    for date in dates:
        for hour_name, s in iter_date_normalized_samples(date):
            yield date, hour_name, s


def _scan_date(date):
    """扫描一个日期，统计原始样本数、可规范化样本数、维度分布与 134 维尾部。"""
    out = {
        'date': date,
        'hour_files': len(_hour_sources(date)),
        'raw_samples': 0,
        'normalized_samples': 0,
        'malformed_features': 0,
        'dimensions': {},
        'feature_versions': {},
        'target_identity_rows': 0,
        'tail_134_preserved': True,
    }
    dims = {}
    fvs = {}
    for hour_name, s in iter_date_samples(date):
        out['raw_samples'] += 1
        f = s.get('f')
        dim = len(f) if isinstance(f, list) else -1
        dims[dim] = dims.get(dim, 0) + 1
        try:
            f130, fv, tail = normalize_features(s)
            out['normalized_samples'] += 1
            fvs[fv] = fvs.get(fv, 0) + 1
            if dim == TARGET_IDENTITY_FEATURE_DIM:
                out['target_identity_rows'] += 1
                if f130 != f[:130] or tail != f[130:134]:
                    out['tail_134_preserved'] = False
        except Exception:
            out['malformed_features'] += 1
    out['dimensions'] = dims
    out['feature_versions'] = fvs
    return out


def stats():
    """
    自检统计：分别读取一个冷日期(10-14，tar.gz) 和一个热日期(10-21，散装)，
    返回文件数、原始样本数、规范化后样本数与维度分布。
    """
    cold_date = '2026-10-14'
    hot_date = '2026-10-21'
    cold_hours = _hour_sources(cold_date)
    hot_hours = _hour_sources(hot_date)
    out = {
        'ok': bool(cold_hours and hot_hours),
        'cold': _scan_date(cold_date) if cold_hours else {
            'date': cold_date, 'hour_files': 0, 'raw_samples': 0,
            'normalized_samples': 0, 'malformed_features': 0,
        },
        'hot': _scan_date(hot_date) if hot_hours else {
            'date': hot_date, 'hour_files': 0, 'raw_samples': 0,
            'normalized_samples': 0, 'malformed_features': 0,
        },
    }
    if out['cold']['normalized_samples'] <= 0 or out['hot']['normalized_samples'] <= 0:
        out['ok'] = False
    if not out['cold'].get('tail_134_preserved', True):
        out['ok'] = False
    return out


def selfTest():
    """自检入口，返回 {ok, msg, data}，任何异常都转成 ok=False 而不是抛出。"""
    try:
        st = stats()
        if not st['ok']:
            return {'ok': False, 'msg': '冷/热日期读取或特征规范化失败', 'data': st}
        cold = st['cold']
        hot = st['hot']
        return {
            'ok': True,
            'msg': 'AggregateReader 冷热读取与134维规范化正常: 冷 %s raw=%d normalized=%d, '
                   '热 %s raw=%d normalized=%d'
                   % (cold['date'], cold['raw_samples'], cold['normalized_samples'],
                      hot['date'], hot['raw_samples'], hot['normalized_samples']),
            'data': st,
        }
    except Exception as e:
        return {'ok': False, 'msg': 'AggregateReader 自检异常: %s' % e, 'data': None}


if __name__ == '__main__':
    r = selfTest()
    print(json.dumps(r, ensure_ascii=False, indent=1))
