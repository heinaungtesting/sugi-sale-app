import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireCsrf } from '@/lib/csrf';
import { incrementMetric, setGauge } from '@/infrastructure/observability/metrics';
import { logEvent, requestId } from '@/infrastructure/logging/structured-logger';

const STORAGE_VALUES = new Set(['indexeddb', 'localstorage', 'memory', 'loading']);

export async function POST(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const body = await req.json().catch(() => ({}));
  const pending = Math.max(0, Math.min(200, Number(body.pending) || 0));
  const failed = Math.max(0, Math.min(200, Number(body.failed) || 0));
  const storage = STORAGE_VALUES.has(String(body.storage)) ? String(body.storage) : 'unknown';
  setGauge('queue.pending.last_report', pending);
  setGauge('queue.failed.last_report', failed);
  incrementMetric(`queue.storage.${storage}`);
  if (failed > 0) logEvent('sale_queue_failed_entries', { requestId: requestId(req), userId: user.id, pending, failed, storage }, 'warn');
  return Response.json({ ok: true });
}
