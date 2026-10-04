import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireAdmin } from '@/lib/sugi-admin-db';
import { requireCsrf } from '@/lib/csrf';
import { validateReviewAction } from '@/domain/customer-info/customer-info';
import { reviewCustomerInfoRow } from '@/repositories/customer-info-repository';
import { logEvent, requestId } from '@/infrastructure/logging/structured-logger';
import { incrementMetric } from '@/infrastructure/observability/metrics';

const CONFLICT_MESSAGES = {
  ja_not_published: 'Approve the Japanese source for this field first.',
  ja_source_changed: 'The Japanese source changed after this translation was made. Re-translate it first.',
  blocked_claims: 'Effect claims are not allowed on a plain health food.',
} as const;

// The only path that publishes customer-visible text (FR-11, Integrity NFR).
export async function PATCH(req: Request, { params }: { params: Promise<{ rowId: string }> }) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const { rowId } = await params;
  const id = Number(rowId);
  const action = validateReviewAction(await req.json().catch(() => null));
  if (!Number.isSafeInteger(id) || id <= 0 || !action) return Response.json({ error: 'invalid request' }, { status: 400 });

  const result = await reviewCustomerInfoRow(id, action, { id: user.id, username: user.username });
  if (!result.ok) {
    if (result.code === 'not_found') return Response.json({ error: 'row not found' }, { status: 404 });
    const status = result.code === 'blocked_claims' ? 422 : 409;
    return Response.json({ error: result.code, message: CONFLICT_MESSAGES[result.code], blocked: result.blocked ?? [] }, { status });
  }

  const reqId = requestId(req);
  if (result.status === 'published') {
    incrementMetric('customer_info.published');
    logEvent('customer_info_published', { requestId: reqId, userId: user.id, rowId: id, productId: result.product_id, language: result.language, fieldKey: result.field_key });
  }
  if (result.staled_row_ids.length > 0) {
    incrementMetric('customer_info.stale', result.staled_row_ids.length);
    logEvent('customer_info_stale', { requestId: reqId, userId: user.id, productId: result.product_id, fieldKey: result.field_key, staleCount: result.staled_row_ids.length });
  }
  return Response.json(result);
}
