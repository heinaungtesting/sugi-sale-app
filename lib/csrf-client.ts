'use client';

const CSRF_COOKIE = 'sugi_csrf';
const CSRF_HEADER = 'x-csrf-token';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return null;
}

async function getCsrfToken(forceRefresh = false): Promise<string> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing && !forceRefresh) return existing;
  const res = await fetch('/api/auth/csrf', { method: 'GET', cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) throw new Error('could not issue csrf token');
  const token = readCookie(CSRF_COOKIE);
  if (!token) throw new Error('csrf token cookie missing');
  return token;
}

async function isInvalidCsrfResponse(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  try {
    const body = (await res.clone().json()) as { error?: string };
    return body?.error === 'invalid csrf token';
  } catch {
    return false;
  }
}

async function fetchWithCsrf(input: RequestInfo | URL, init: RequestInit, token: string): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(CSRF_HEADER, token);
  return fetch(input, {
    ...init,
    headers,
    credentials: init.credentials ?? 'same-origin',
  });
}

export async function csrfFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await getCsrfToken();
  const res = await fetchWithCsrf(input, init, token);
  if (!(await isInvalidCsrfResponse(res))) return res;

  // A tab can keep a stale/non-HMAC CSRF cookie after deploys, secret rotation,
  // or old pre-hardening browser state. Refresh once and replay the same mutation;
  // callers such as the offline queue still use idempotency keys, so this retry is
  // safe for sale logging.
  const freshToken = await getCsrfToken(true);
  return fetchWithCsrf(input, init, freshToken);
}
