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

async function getCsrfToken(): Promise<string> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;
  const res = await fetch('/api/auth/csrf', { method: 'GET', cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) throw new Error('could not issue csrf token');
  const token = readCookie(CSRF_COOKIE);
  if (!token) throw new Error('csrf token cookie missing');
  return token;
}

export async function csrfFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await getCsrfToken();
  const headers = new Headers(init.headers);
  headers.set(CSRF_HEADER, token);
  return fetch(input, {
    ...init,
    headers,
    credentials: init.credentials ?? 'same-origin',
  });
}
