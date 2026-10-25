/* 训练样本增量保存：版本在内存维护，内部主键随兜底恢复，不进入训练特征/导出标签。 */
export function createSamplePersistence({ timeoutMs = 8000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
 const WRITE_BATCH_SIZE = 1000;
 let sequence = 0;
 function transaction(db, enqueue, commit) {
  return new Promise((resolve, reject) => {
   let tx, done = false;
   const finish = (error, value) => { if (done) return; done = true; clearTimer(timer); error ? reject(error) : resolve(value); };
   const timer = setTimer(() => {
    const error = new Error('训练数据库事务超时，样本保留'); error.name = 'TimeoutError';
    // 先封住迟到回调，再中止事务；后续重试仍使用同一个样本键。
    finish(error);
    if (tx) { try { tx.abort(); } catch (_) {} }
   }, timeoutMs);
   try {
    tx = db.transaction('samples', 'readwrite');
    tx.oncomplete = () => { if (!done) { try { finish(null, commit()); } catch (e) { finish(e); } } };
    tx.onerror = tx.onabort = () => finish(tx.error || new Error('训练样本事务失败，清理事务失败时样本保留'));
    enqueue(tx.objectStore('samples'), tx);
   } catch (e) { finish(e); if (tx) { try { tx.abort(); } catch (_) {} } }
  });
 }
 const states = new WeakMap();
 let queue = Promise.resolve();
 function state(sample) {
  if (!states.has(sample)) {
   states.set(sample, { key: sample._storageKey, revision: 0 });
   delete sample._storageKey; // 本地兜底携带的内部键不进入训练标签或导出。
  }
  return states.get(sample);
 }
 function loaded(sample, key) {
  state(sample).key = key;
  sample._persisted = true;
 }
 function dirty(sample) {
  const current = state(sample);
  current.revision++;
  sample._dataRevision = (Number.isSafeInteger(sample._dataRevision) ? sample._dataRevision : 0) + 1;
  sample._modifiedAt = Date.now();
  if (current.retiringTx) { try { current.retiringTx.abort(); } catch (_) {} }
  sample._persisted = false;
 }
 function flush(db, getSamples) {
  const task = queue.catch(() => {}).then(async () => {
   const samples = getSamples().filter(sample => !sample._persisted);
   let written = 0;
   // Bound native commit work and temporary clones; the 8000ms transaction limit
   // stays unchanged. A later failure does not revoke earlier committed chunks.
   for (let offset = 0; offset < samples.length; offset += WRITE_BATCH_SIZE) {
    const entries = samples.slice(offset, offset + WRITE_BATCH_SIZE).map(sample => {
     const current = state(sample);
     return { sample, key: reserveKey(sample), revision: current.revision,
      value: JSON.parse(JSON.stringify({ ...sample, _persisted: true })) };
    });
    written += await transaction(db, store => {
     for (const entry of entries) store.put(entry.value, entry.key);
    }, () => {
     for (const entry of entries) {
      const current = state(entry.sample);
      if (current.revision === entry.revision) entry.sample._persisted = true;
     }
     return entries.length;
    });
   }
   return { written, pending: getSamples().some(sample => !sample._persisted) };
  });
  queue = task;
  return task;
 }
 function reserveKey(sample) {
  const current = state(sample);
  if (current.key === undefined) current.key = 'sample_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '_' + (++sequence);
  return current.key;
 }
 function fallbackValue(sample) { return { ...sample, _storageKey: reserveKey(sample) }; }
 function signature(sample) {
  const { _persisted, ...value } = sample;
  return JSON.stringify(value);
 }
 function capture(sample) {
  return { sample, revision: state(sample).revision, signature: signature(sample) };
 }
 function unchanged(entry) {
  return state(entry.sample).revision === entry.revision && signature(entry.sample) === entry.signature;
 }
 function retire(db, entries, getSamples, eligible, remove) {
  const task = queue.catch(() => {}).then(() => {
   const live = new Set(getSamples());
   const selected = entries.filter(entry => live.has(entry.sample) && unchanged(entry) && eligible(entry.sample));
   if (!selected.length) return 0;
   const release = () => { for (const entry of selected) state(entry.sample).retiringTx = null; };
   return transaction(db, (store, tx) => {
    for (const entry of selected) {
     const current = state(entry.sample); current.retiringTx = tx;
     if (current.key !== undefined) store.delete(current.key);
    }
   }, () => {
    remove(new Set(selected.map(entry => entry.sample)));
    return selected.length;
   }).catch(error => {
    release();
    // 超时中止不确定时仍安排覆盖写入，迟到删除不能让内存误认为数据库已有数据。
    selected.forEach(entry => dirty(entry.sample));
    throw error;
   }).finally(release);
  });
  queue = task;
  return task;
 }
 function clear(db) {
  const task = queue.catch(() => {}).then(() => transaction(db, store => store.clear(), () => true));
  queue = task;
  return task;
 }
 return { loaded, dirty, flush, capture, unchanged, retire, fallbackValue, clear };
}
