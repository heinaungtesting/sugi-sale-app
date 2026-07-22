import { loginUser, setSession } from '@/lib/auth';
import { setCsrfCookie } from '@/lib/csrf';
import { logEvent, requestId } from '@/infrastructure/logging/structured-logger';
import { incrementMetric, observeMetric } from '@/infrastructure/observability/metrics';
import {
  clearFailedLogins,
  MAX_FAILED_ATTEMPTS,
  reserveLoginAttempt,
} from '@/infrastructure/rate-limit/login-throttle';

function clientIp(req: Request) {
  const trustedProxy = process.env.TRUSTED_PROXY === 'true';
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (trustedProxy && realIp) return realIp;
  return 'direct-client';
}

function clientKey(req: Request, username: string) {
  const ip = clientIp(req);
  return `${ip}:${username.trim().toLowerCase()}`;
}

export async function POST(req: Request) {
  const started = performance.now();
  const reqId = requestId(req);
  const body = await req.json().catch(() => ({}));
  const username = String(body.username ?? '');
  const pin = String(body.pin ?? '');
  const key = clientKey(req, username);
  if (!(await reserveLoginAttempt(key))) {
    incrementMetric('login.rate_limited');
    logEvent('login_rate_limited', {
      requestId: reqId,
      username: username.trim().toLowerCase(),
      maximum: MAX_FAILED_ATTEMPTS,
    }, 'warn');
    return Response.json({ error: 'too many login attempts' }, { status: 429 });
  }
  const user = await loginUser(username, pin);
  if (!user) {
    incrementMetric('login.failed');
    observeMetric('login.duration_ms', performance.now() - started);
    logEvent('login_failed', { requestId: reqId, username: username.trim().toLowerCase() }, 'warn');
    return Response.json({ error: 'invalid credentials' }, { status: 401 });
  }
  await clearFailedLogins(key);
  await setSession(user, req);
  await setCsrfCookie();
  incrementMetric('login.success');
  observeMetric('login.duration_ms', performance.now() - started);
  logEvent('login_success', { requestId: reqId, userId: user.id, durationMs: Math.round(performance.now() - started) });
  return Response.json({ ok: true, user });
}
