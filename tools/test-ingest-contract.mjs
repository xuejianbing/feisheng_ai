#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  INGEST_RECEIPT_SCHEMA,
  createIngestReceiptSummary,
  normalizeIngestReceipt,
  addIngestReceipt,
  describeIngestReceipt,
  parseIngestHttpResponse,
} from '../score/foundation/cloud/ingestReceipt.js';

const response = {
  ok: true,
  duplicate_request: false,
  receipt: {
    schema: INGEST_RECEIPT_SCHEMA,
    receivedSamples: 4,
    archivedSamples: 4,
    mergedNewSamples: 2,
    duplicateSamples: 1,
    rejectedUnlabeledSamples: 1,
    mergedPoolTotal: 12,
    hour: '2026-10-20T12',
  },
};

assert.equal(normalizeIngestReceipt(response).archivedSamples, 4);
assert.equal(normalizeIngestReceipt({ ok: true }), null, 'legacy response has no receipt');
assert.equal(normalizeIngestReceipt({ ...response, receipt: { ...response.receipt, mergedNewSamples: -1 } }), null,
  'negative counters are rejected');

let summary = createIngestReceiptSummary();
summary = addIngestReceipt(summary, response);
summary = addIngestReceipt(summary, { ...response, duplicate_request: true });
assert.equal(summary.batches, 2);
assert.equal(summary.receiptBatches, 2);
assert.equal(summary.duplicateRequests, 1);
assert.equal(summary.archivedSamples, 4, 'replayed receipts do not double-count archived samples');
assert.equal(summary.mergedNewSamples, 2, 'replayed receipts do not double-count merged samples');
assert.match(describeIngestReceipt(summary), /重试回执 1 批未重复计数/);
assert.match(describeIngestReceipt(summary), /最终训练资格尚未由接收服务判断/);

summary = addIngestReceipt(summary, { ok: true });
assert.equal(summary.supported, false, 'mixed old/new server batches are called out');
assert.match(describeIngestReceipt(summary), /回执覆盖 2\/3 批/);

const oldOnly = addIngestReceipt(createIngestReceiptSummary(), { ok: true });
assert.match(describeIngestReceipt(oldOnly), /归档和入池数量未知/);

const parsed = await parseIngestHttpResponse({ ok: true, status: 200, json: async () => response });
assert.deepEqual(parsed, response, 'HTTP success preserves the backend receipt body');
assert.deepEqual(await parseIngestHttpResponse({ ok: true, status: 200, json: async () => { throw new Error('empty'); } }),
  { ok: true, receiptUnavailable: true }, 'empty legacy success remains compatible');
await assert.rejects(
  parseIngestHttpResponse({ ok: false, status: 429 }),
  error => error.rateLimited === true,
  '429 remains explicitly marked for backoff',
);
await assert.rejects(
  parseIngestHttpResponse({ ok: true, status: 200, json: async () => ({ ok: false, error: 'invalid_samples' }) }),
  /invalid_samples/,
  'application errors in 2xx responses are not acknowledged',
);

console.log('PASS ingest receipt contract');
