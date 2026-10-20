/* Stable client-side parser for ingest receipts. Older servers may omit them. */
export const INGEST_RECEIPT_SCHEMA = 'ingest-receipt-v1';

const COUNTERS = [
  'receivedSamples',
  'archivedSamples',
  'mergedNewSamples',
  'duplicateSamples',
  'rejectedUnlabeledSamples',
];

export async function parseIngestHttpResponse(response) {
  if (response && response.ok) {
    let payload = null;
    try { payload = await response.json(); } catch (_) {}
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.ok === false) {
      throw new Error(payload.error || '服务端拒绝接收');
    }
    return payload && typeof payload === 'object'
      ? payload
      : { ok: true, receiptUnavailable: true };
  }
  if (response && response.status === 429) {
    const error = new Error('HTTP 429 触发服务端限流，请稍后自动重试，数据已保留待传，稍后自动重试');
    error.rateLimited = true;
    throw error;
  }
  throw new Error('HTTP ' + (response ? response.status : '?'));
}

export function createIngestReceiptSummary() {
  return {
    supported: true,
    batches: 0,
    receiptBatches: 0,
    duplicateRequests: 0,
    receivedSamples: 0,
    archivedSamples: 0,
    mergedNewSamples: 0,
    duplicateSamples: 0,
    rejectedUnlabeledSamples: 0,
  };
}

export function normalizeIngestReceipt(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  const receipt = response.receipt;
  if (!receipt || receipt.schema !== INGEST_RECEIPT_SCHEMA) return null;
  for (const key of COUNTERS) {
    if (!Number.isSafeInteger(receipt[key]) || receipt[key] < 0) return null;
  }
  return {
    schema: INGEST_RECEIPT_SCHEMA,
    duplicateRequest: response.duplicate_request === true,
    ...Object.fromEntries(COUNTERS.map(key => [key, receipt[key]])),
  };
}

export function addIngestReceipt(summary, response) {
  const current = summary || createIngestReceiptSummary();
  const receipt = normalizeIngestReceipt(response);
  if (!receipt) return { ...current, supported: false, batches: current.batches + 1 };
  return {
    ...current,
    batches: current.batches + 1,
    receiptBatches: current.receiptBatches + 1,
    duplicateRequests: current.duplicateRequests + (receipt.duplicateRequest ? 1 : 0),
    /* A replay returns the original receipt for idempotency; don't count its historical work twice. */
    receivedSamples: current.receivedSamples + (receipt.duplicateRequest ? 0 : receipt.receivedSamples),
    archivedSamples: current.archivedSamples + (receipt.duplicateRequest ? 0 : receipt.archivedSamples),
    mergedNewSamples: current.mergedNewSamples + (receipt.duplicateRequest ? 0 : receipt.mergedNewSamples),
    duplicateSamples: current.duplicateSamples + (receipt.duplicateRequest ? 0 : receipt.duplicateSamples),
    rejectedUnlabeledSamples: current.rejectedUnlabeledSamples + (receipt.duplicateRequest ? 0 : receipt.rejectedUnlabeledSamples),
  };
}

export function describeIngestReceipt(summary) {
  if (!summary || summary.batches === 0) return '';
  if (summary.receiptBatches === 0) {
    return '服务端未提供样本明细回执，归档和入池数量未知；最终训练资格尚未由接收服务判断';
  }
  const prefix = summary.supported ? '' : '回执覆盖 ' + summary.receiptBatches + '/' + summary.batches + ' 批；';
  const replay = summary.duplicateRequests ? '（重试回执 ' + summary.duplicateRequests + ' 批未重复计数）' : '';
  return prefix + '服务端归档 ' + summary.archivedSamples + ' 条，合并池新增 ' + summary.mergedNewSamples +
    ' 条，重复 ' + summary.duplicateSamples + ' 条，未标记结果而未入池 ' +
    summary.rejectedUnlabeledSamples + ' 条' + replay + '；最终训练资格尚未由接收服务判断';
}
