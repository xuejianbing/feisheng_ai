/* 只管理连接；恢复连接不会重新加载或替换训练缓冲。 */
export function createTrainingDBConnection({ provider, lost = () => {}, timeoutMs = 8000,
 setTimer = setTimeout, clearTimer = clearTimeout }) {
 let current = null, opening = null;
 function invalidate() {
  const old = current; current = null;
  if (old) { try { old.close(); } catch (_) {} }
  lost();
 }
 function open() {
  if (current) return Promise.resolve(current);
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
   let expired = false, timer;
   const fail = e => { if (expired) return; expired = true; clearTimer(timer); reject(e); };
   timer = setTimer(() => { const e = new Error('训练数据库打开超时'); e.name = 'TimeoutError'; fail(e); }, timeoutMs);
   try {
    const api = provider();
    if (!api) throw new Error('IndexedDB 不可用');
    const request = api.open('djsc_ai_db', 1);
    request.onupgradeneeded = e => {
     const db = e.target.result;
     if (!db.objectStoreNames.contains('samples')) db.createObjectStore('samples', { autoIncrement: true });
    };
    request.onerror = () => fail(request.error || new Error('训练数据库打开失败'));
    request.onsuccess = e => {
     const db = e && e.target ? e.target.result : request.result;
     if (expired) { try { db.close(); } catch (_) {} return; }
     expired = true; clearTimer(timer); current = db;
     const dropped = () => { if (current === db) invalidate(); };
     db.onversionchange = dropped; db.onclose = dropped;
     resolve(db);
    };
   } catch (e) { fail(e); }
  }).finally(() => { opening = null; });
  return opening;
 }
 return { open, invalidate, current: () => current };
}
