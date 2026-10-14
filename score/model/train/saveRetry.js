/* 单一写入任务、有限退避重试；新动作不会重置连续失败预算。 */
export function createSaveRetry({ pending, save, backup, failed = () => {}, delays = [2000, 5000, 15000],
 setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now }) {
 let active = null, timer = null, attempts = 0, phase = 'idle', error = '', nextRetryAt = null, suspended = false, generation = 0;
 function cancelTimer() { if (timer !== null) clearTimer(timer); timer = null; nextRetryAt = null; }
 function run({ manual = false, retry = false } = {}) {
  if (suspended) return Promise.resolve({ ok: false, deferred: true, err: '正在清空训练样本' });
  if (manual) { cancelTimer(); attempts = 0; }
  if (active) return active;
  if (!pending()) { cancelTimer(); attempts = 0; phase = 'saved'; error = ''; return Promise.resolve({ ok: true }); }
  if (!manual && !retry && (timer !== null || phase === 'paused')) return Promise.resolve({ ok: false, deferred: true, err: error });
  const started = generation;
  phase = 'saving';
  active = Promise.resolve().then(async () => {
   try {
    const result = await save();
    if (started !== generation) return { ok: false, cancelled: true };
    attempts = 0; error = ''; phase = result.pending ? 'pending' : 'saved';
    return { ok: true, ...result };
   } catch (e) {
    if (started !== generation) return { ok: false, cancelled: true };
    error = String(e.message || e);
    try { failed(e); } catch (_) {}
    try { backup(); } catch (_) {}
    if (attempts < delays.length) {
     const delay = delays[attempts++]; phase = 'retrying'; nextRetryAt = now() + delay;
     timer = setTimer(() => { timer = null; nextRetryAt = null; void run({ retry: true }); }, delay);
    } else { phase = 'paused'; }
    return { ok: false, err: error };
   } finally { active = null; }
  });
  return active;
 }
 async function suspend() { suspended = true; generation++; cancelTimer(); phase = 'clearing'; if (active) await active; }
 function resume() { suspended = false; generation++; cancelTimer(); attempts = 0; error = ''; phase = 'idle'; }
 return { run, suspend, resume, status: () => ({ phase, retries: attempts, lastError: error, nextRetryAt }) };
}
