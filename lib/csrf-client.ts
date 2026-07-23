'use client';

/**
 * Compatibility name retained to avoid touching every caller. CSRF token issuance,
 * cookie reads, custom headers, refreshes, and request replays have been removed.
 */
export function csrfFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: init.credentials ?? 'same-origin',
  });
}
