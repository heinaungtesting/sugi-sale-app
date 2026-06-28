import { loginUser, setSession } from '@/lib/auth';
import { setCsrfCookie } from '@/lib/csrf';

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
  const body = await req.json().catch(() => ({}));
  const username = String(body.username ?? '');
  const pin = String(body.pin ?? '');
  const key = clientKey(req, username);
  if (isRateLimited(key)) return Response.json({ error: 'too many login attempts' }, { status: 429 });
  const user = await loginUser(username, pin);
  if (!user) {
    recordFailedAttempt(key);
    return Response.json({ error: 'invalid credentials' }, { status: 401 });
  }
  attempts.delete(key);
  await setSession(user);
  await setCsrfCookie();
  return Response.json({ ok: true, user });
}
