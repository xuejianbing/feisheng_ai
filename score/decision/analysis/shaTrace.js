const buffer = [];
let sequence = 0;

export function beginShaTrace(actor, mode, phase) {
 const api = typeof window !== 'undefined' ? window.__DJSC : null;
 if (api?.shaTraceEnabled !== true || mode !== 'identity' || phase !== 'phase') return null;
 const entry = { traceId: ++sequence, actor, mode, phase, rows: [], truncated: false };
 if (buffer.length === 16) buffer.shift();
 buffer.push(entry);
 api.shaTraceSnapshot = () => JSON.parse(JSON.stringify(buffer));
 return {
  record(stage, fields = {}) {
   if (entry.rows.length >= 64) {
    entry.truncated = true;
    return;
   }
   const row = { stage };
   for (const key of ['id', 'target', 'tier', 'source', 'reason', 'entity', 'before', 'after', 'priority', 'selected', 'executed']) {
    const value = fields[key];
    if (value === null || typeof value === 'boolean' || Number.isFinite(value)) row[key] = value;
    else if (typeof value === 'string') row[key] = value.slice(0, 96);
   }
   if (Number.isFinite(row.before) && Number.isFinite(row.after)) row.delta = row.after - row.before;
   entry.rows.push(row);
  },
 };
}
