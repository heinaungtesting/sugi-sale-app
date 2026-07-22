import crypto from 'node:crypto';
import { cookies } from 'next/headers';

export const CSRF_COOKIE = 'sugi_csrf';
export const CSRF_HEADER = 'x-csrf-token';
const CSRF_BYTES = 32;
const CSRF_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function csrfSecret(): string {
  const secret = process.env.SUGI_SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('SUGI_SESSION_SECRET is required in production');
  }
  return secret || 'dev-change-this-sugi-secret';
}

function secureCookie(): boolean {
  if (process.env.SUGI_COOKIE_SECURE === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

function sign(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function constantEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function createCsrfToken(secret = csrfSecret()): string {
  const nonce = crypto.randomBytes(CSRF_BYTES).toString('base64url');
  return `${nonce}.${sign(nonce, secret)}`;
}

function isSignedCsrfToken(token: string | null | undefined, secret = csrfSecret()): token is string {
  if (!token) return false;
  const [nonce, mac, extra] = token.split('.');
  if (!nonce || !mac || extra !== undefined) return false;
  return constantEqual(mac, sign(nonce, secret));
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function sameOrigin(req: Request): boolean {
  const url = new URL(req.url);
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const requestHost = forwardedHost || req.headers.get('host')?.trim();

  function matchesRequestOrigin(value: string): boolean {
    try {
      const candidate = new URL(value);
      // Next.js may see the internal HTTP upstream URL while the browser uses the
      // public HTTPS Tailscale origin. The browser-controlled Host header cannot be
      // changed cross-origin, so an exact host match safely handles that proxy hop.
      return candidate.origin === url.origin || Boolean(requestHost && candidate.host === requestHost);
    } catch {
      return false;
    }
  }

  const origin = req.headers.get('origin');
  if (origin) return matchesRequestOrigin(origin);
  const referer = req.headers.get('referer');
  if (referer) return matchesRequestOrigin(referer);
  // Non-browser clients may omit both. Token validation still protects browser CSRF.
  return true;
}

export function verifyCsrfRequest(req: Request, secret = csrfSecret()): boolean {
  if (!sameOrigin(req)) return false;
  const cookieToken = parseCookie(req.headers.get('cookie'), CSRF_COOKIE);
  const headerToken = req.headers.get(CSRF_HEADER);
  if (!cookieToken || !headerToken) return false;
  if (!constantEqual(cookieToken, headerToken)) return false;
  return isSignedCsrfToken(cookieToken, secret);
}

export function csrfErrorResponse(): Response {
  return Response.json({ error: 'invalid csrf token' }, { status: 403 });
}

export function requireCsrf(req: Request): Response | null {
  return verifyCsrfRequest(req) ? null : csrfErrorResponse();
}

export async function setCsrfCookie(): Promise<string> {
  const token = createCsrfToken();
  const jar = await cookies();
  jar.set(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: 'strict',
    secure: secureCookie(),
    path: '/',
    maxAge: CSRF_MAX_AGE_SECONDS,
  });
  return token;
}
