import { currentUser, requireUserResponse } from '@/lib/auth';
import { validateCreateSale } from '@/domain/sales/sale-policy';
import { createSale } from '@/domain/sales/sale-service';
import { requestId } from '@/infrastructure/logging/structured-logger';
import { requireCsrf } from '@/lib/csrf';

export async function POST(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const validation = validateCreateSale(body);
  if (!validation.ok) return Response.json({ error: validation.error }, { status: 400 });
  if (validation.command.idempotencyKey) {
    const queuedOwnerUserId = Number(body.owner_user_id);
    if (!Number.isInteger(queuedOwnerUserId) || queuedOwnerUserId !== user.id) {
      return Response.json({ error: 'queued sale owner mismatch' }, { status: 409 });
    }
  }

  const result = await createSale(user.id, validation.command, {
    requestId: requestId(req),
    queueAttempt: Number(req.headers.get('x-queue-attempt') || 0) || undefined,
  });
  if (result.kind === 'rate_limited') return Response.json({ error: 'too many sales' }, { status: 429 });
  if (result.kind === 'not_found') return Response.json({ error: 'product not found' }, { status: 404 });
  if (result.kind === 'failed') return Response.json({ error: 'failed to log sale' }, { status: 500 });
  return Response.json(result.sale);
}
