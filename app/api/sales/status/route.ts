import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireCsrf } from '@/lib/csrf';
import { isValidIdempotencyKey } from '@/lib/sugi-db';
import { saleRepository } from '@/repositories/sale-repository';

const MAX_STATUS_KEYS = 100;

export async function POST(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();

  const body = await req.json().catch(() => null) as { idempotency_keys?: unknown } | null;
  if (!Array.isArray(body?.idempotency_keys)) {
    return Response.json({ error: 'invalid idempotency_keys' }, { status: 400 });
  }
  const keys = [...new Set(body.idempotency_keys.map(String))];
  if (keys.length === 0 || keys.length > MAX_STATUS_KEYS || keys.some((key) => !isValidIdempotencyKey(key))) {
    return Response.json({ error: 'invalid idempotency_keys' }, { status: 400 });
  }

  const accepted = await saleRepository.findAcceptedByIdempotencyKeys(user.id, keys);
  return Response.json({ accepted });
}
