import { validateIngestPayload } from '@/domain/customer-info/customer-info';
import { ingestCustomerInfo } from '@/repositories/customer-info-repository';
import { verifyServiceToken } from '@/infrastructure/auth/service-token';
import { reserveRateLimit } from '@/infrastructure/rate-limit/postgres-rate-limit';
import { logEvent, requestId } from '@/infrastructure/logging/structured-logger';
import { incrementMetric } from '@/infrastructure/observability/metrics';

const MAX_BODY_BYTES = 256 * 1024;

// Hermes writes drafts here with a service token, never a staff session.
// Nothing posted here can publish: review fields are refused outright.
export async function POST(req: Request) {
  if (!verifyServiceToken(req, process.env.CUSTOMER_INFO_INGEST_TOKEN)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const allowed = await reserveRateLimit('customer-info-ingest', 'hermes', 60_000, 60);
  if (!allowed) return Response.json({ error: 'too many requests' }, { status: 429 });

  const raw = await req.text().catch(() => '');
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: 'payload too large' }, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const validation = validateIngestPayload(parsed);
  if (!validation.ok) return Response.json({ error: validation.error }, { status: 400 });

  const result = await ingestCustomerInfo(validation.value);
  const reqId = requestId(req);
  if (!result.ok) {
    const status = result.code === 'not_found' ? 404 : result.code === 'invalid_sources' ? 400 : 409;
    logEvent('customer_info_ingest_rejected', { requestId: reqId, productId: validation.value.product_id, code: result.code }, 'warn');
    return Response.json({ error: result.code, detail: result.detail ?? null }, { status });
  }
  incrementMetric('customer_info.ingested', result.written.filter((row) => row.outcome === 'drafted').length);
  if (result.staled_row_ids.length > 0) {
    incrementMetric('customer_info.stale', result.staled_row_ids.length);
    logEvent('customer_info_stale', { requestId: reqId, productId: validation.value.product_id, staleCount: result.staled_row_ids.length });
  }
  logEvent('customer_info_ingested', { requestId: reqId, productId: validation.value.product_id, rowCount: result.written.length });
  return Response.json(result);
}
