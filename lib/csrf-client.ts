'use client';

/**
 * Compatibility name retained to avoid touching every caller. CSRF token issuance,
 * cookie reads, custom headers, refreshes, and request replays have been removed.
 */
export function csrfFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const method = (init.method ?? request?.method ?? 'GET').toUpperCase();
  const headers = new Headers(request?.headers);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('X-Sugi-Request', 'same-origin');
  }
  return fetch(input, {
    ...init,
    headers,
    credentials: init.credentials ?? 'same-origin',
  });
}
