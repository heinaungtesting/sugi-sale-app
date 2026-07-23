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

function parseCookies(header: string | null, name: string): string[] {
  if (!header) return [];
  const values: string[] = [];
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) values.push(decodeURIComponent(rest.join('=')));
  }
  return values;
}

const DEFAULT_ALLOWED_HOSTS = new Set([
  'herme-agents.tail71ac56.ts.net',
  '100.111.161.73',
  'localhost',
  '127.0.0.1',
]);

function normalizedHostname(value: string): string | null {
  try {
    const withScheme = value.includes('://') ? value : `http://${value}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

function allowedHostnames(): Set<string> {
  const configured = (process.env.SUGI_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((value) => normalizedHostname(value.trim()))
    .filter((value): value is string => Boolean(value));
  return new Set([...DEFAULT_ALLOWED_HOSTS, ...configured]);
}

function allowedRequestHost(req: Request): boolean {
  const allowed = allowedHostnames();
  const requestUrl = new URL(req.url);
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const effectiveHost = forwardedHost || req.headers.get('host')?.trim() || requestUrl.host;
  const requestHostname = normalizedHostname(effectiveHost);
  if (!requestHostname || !allowed.has(requestHostname)) return false;

  // Origin/Referer is a secondary signal. It may legitimately differ from the
  // internal upstream URL behind Tailscale, but it must still be explicitly allowed.
  const browserSource = req.headers.get('origin') || req.headers.get('referer');
  if (!browserSource) return true;
  const sourceHostname = normalizedHostname(browserSource);
  return Boolean(sourceHostname && allowed.has(sourceHostname));
}

export function verifyCsrfRequest(req: Request, secret = csrfSecret()): boolean {
  // The signed double-submit token is the primary CSRF control. Host validation is
  // deliberately secondary so Tailscale proxy scheme/port changes cannot silently
  // break valid devices.
  const cookieTokens = parseCookies(req.headers.get('cookie'), CSRF_COOKIE);
  const headerToken = req.headers.get(CSRF_HEADER);
  if (cookieTokens.length === 0 || !headerToken) return false;
  if (!isSignedCsrfToken(headerToken, secret)) return false;
  if (!cookieTokens.some((cookieToken) => constantEqual(cookieToken, headerToken))) return false;
  return allowedRequestHost(req);
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
