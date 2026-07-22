import { loginUser, setSession } from '@/lib/auth';
import { setCsrfCookie } from '@/lib/csrf';
import { logEvent, requestId } from '@/infrastructure/logging/structured-logger';
import { incrementMetric, observeMetric } from '@/infrastructure/observability/metrics';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 10;

type LoginAttempt = { count: number; firstAttemptAt: number };

declare global {
  // eslint-disable-next-line no-var
  var sugiLoginAttempts: Map<string, LoginAttempt> | undefined;
}

const attempts = globalThis.sugiLoginAttempts ?? new Map<string, LoginAttempt>();
globalThis.sugiLoginAttempts = attempts;

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

function isRateLimited(key: string, now = Date.now()) {
  const current = attempts.get(key);
  if (!current) return false;
  if (now - current.firstAttemptAt > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return current.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailedAttempt(key: string, now = Date.now()) {
  const current = attempts.get(key);
  if (!current || now - current.firstAttemptAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAttemptAt: now });
    return;
  }
  current.count += 1;
}

export async function POST(req: Request) {
  const started = performance.now();
  const reqId = requestId(req);
  const body = await req.json().catch(() => ({}));
  const username = String(body.username ?? '');
  const pin = String(body.pin ?? '');
  const key = clientKey(req, username);
  if (isRateLimited(key)) {
    incrementMetric('login.rate_limited');
    logEvent('login_rate_limited', { requestId: reqId, username: username.trim().toLowerCase() }, 'warn');
    return Response.json({ error: 'too many login attempts' }, { status: 429 });
  }
  const user = await loginUser(username, pin);
  if (!user) {
    recordFailedAttempt(key);
    incrementMetric('login.failed');
    observeMetric('login.duration_ms', performance.now() - started);
    logEvent('login_failed', { requestId: reqId, username: username.trim().toLowerCase() }, 'warn');
    return Response.json({ error: 'invalid credentials' }, { status: 401 });
  }
  attempts.delete(key);
  await setSession(user, req);
  await setCsrfCookie();
  incrementMetric('login.success');
  observeMetric('login.duration_ms', performance.now() - started);
  logEvent('login_success', { requestId: reqId, userId: user.id, durationMs: Math.round(performance.now() - started) });
  return Response.json({ ok: true, user });
}
