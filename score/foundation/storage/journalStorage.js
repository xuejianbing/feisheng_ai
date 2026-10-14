/* One bounded journal snapshot in IndexedDB; small-storage fallback for older hosts. */
const DB_NAME = 'wumingai-journal-v1';
const STORE = 'snapshots';
let db = null;
export const journalStorage = {
    initial: null,
    available: false,
    write(value, onSaved) {
        if (!db) return false;
        try {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(value, 'current');
            tx.onerror = () => { journalStorage.error = '日志数据库写入失败，请检查可用空间'; };
            tx.oncomplete = () => { journalStorage.error = ''; if(onSaved)onSaved(); };
            return true;
        } catch (_) { journalStorage.error = '日志数据库不可写'; return false; }
    },
    error: '',
};
await new Promise(resolve => {
    if (typeof indexedDB === 'undefined') { resolve(); return; }
    let finished = false;
    const timer = setTimeout(() => { finished = true; resolve(); }, 3000);
    const done = () => { clearTimeout(timer); if (!finished) { finished = true; resolve(); } };
    try {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onerror = done;
        request.onblocked = done;
        request.onsuccess = () => {
            if (finished) { request.result.close(); return; }
            db = request.result;
            db.onversionchange = () => { db.close(); db = null; journalStorage.available = false; };
            const tx = db.transaction(STORE, 'readonly');
            const read = tx.objectStore(STORE).get('current');
            read.onsuccess = () => { if(finished){db.close();db=null;return;} journalStorage.initial = read.result || null; journalStorage.available = true; done(); };
            read.onerror = () => { db.close(); db = null; done(); };
        };
    } catch (_) { done(); }
});
