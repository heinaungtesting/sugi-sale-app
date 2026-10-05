import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireAdmin } from '@/lib/sugi-admin-db';
import { requireCsrf } from '@/lib/csrf';
import { buildDraftRequest } from '@/domain/customer-info/hermes';
import { getDraftRequestProduct, recordDraftRequest } from '@/repositories/customer-info-repository';
import { getHermesSettings } from '@/repositories/app-settings-repository';
import { sendHermesDraftRequest } from '@/infrastructure/hermes/hermes-client';
import { reserveRateLimit } from '@/infrastructure/rate-limit/postgres-rate-limit';
import { logEvent, requestId } from '@/infrastructure/logging/structured-logger';

const INGEST_PATH = '/api/admin/customer-info/ingest';

// Asks Hermes to draft (or re-draft) one product. Hermes replies later by
// POSTing drafts to the ingest route; nothing here writes card content.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isSafeInteger(productId) || productId <= 0) return Response.json({ error: 'invalid product id' }, { status: 400 });

  const settings = await getHermesSettings();
  if (!settings.endpoint_url) return Response.json({ error: 'hermes_not_configured' }, { status: 409 });
  if (!(await reserveRateLimit('hermes-draft-request', String(user.id), 60_000, 20))) {
    return Response.json({ error: 'too many requests' }, { status: 429 });
  }
  const product = await getDraftRequestProduct(productId);
  if (!product) return Response.json({ error: 'product not found' }, { status: 404 });

  // requireCsrf has already checked that Origin matches this app's host.
  const origin = req.headers.get('origin') ?? new URL(req.url).origin;
  const payload = buildDraftRequest(product, new URL(INGEST_PATH, origin).toString(), user.username);
  const result = await sendHermesDraftRequest(settings.endpoint_url, settings.token, payload);
  await recordDraftRequest(productId, user, result.ok
    ? { outcome: 'accepted', hermes_status: result.status, job_id: result.job_id }
    : { outcome: result.reason, hermes_status: result.status ?? null });
  logEvent('customer_info_draft_requested', { requestId: requestId(req), userId: user.id, productId, ok: result.ok, reason: result.ok ? null : result.reason }, result.ok ? 'info' : 'warn');

  if (!result.ok) {
    return Response.json({ error: `hermes_${result.reason}`, hermes_status: result.status ?? null }, { status: 502 });
  }
  return Response.json({ product_id: productId, job_id: result.job_id, source_count: product.sources.length }, { status: 202 });
}
