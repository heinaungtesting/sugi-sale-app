import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('csrfFetch permanent CSRF failure', () => {
  let cookieValue = 'sugi_csrf=stale-token';
  let csrfEndpointCalls = 0;

  beforeEach(() => {
    vi.resetModules();
    cookieValue = 'sugi_csrf=stale-token';
    csrfEndpointCalls = 0;
    vi.stubGlobal('document', {
      get cookie() {
        return cookieValue;
      },
      set cookie(value: string) {
        cookieValue = value;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces a permanent CSRF failure (403 from /api/auth/csrf too) rather than swallowing it', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/csrf')) {
        csrfEndpointCalls += 1;
        // The refresh endpoint never issues a usable cookie (e.g. session was
        // revoked mid-request). The browser keeps its stale cookie.
        cookieValue = 'sugi_csrf=stale-token';
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'invalid csrf token' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { csrfFetch } = await import('../lib/csrf-client');
    const res = await csrfFetch('/api/sales', { method: 'POST' });
    expect(res.status).toBe(403);
    // The first refresh path should fire only once; we do NOT want a permanent
    // rejection to loop forever inside csrfFetch.
    expect(csrfEndpointCalls).toBe(1);
  });

  it('returns a non-ok response when retries are exhausted so the queue can fall back to retry-with-backoff', async () => {
    let firstCall = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/csrf')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (firstCall) {
        firstCall = false;
        return new Response(JSON.stringify({ error: 'invalid csrf token' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // After refresh the request still hits a 5xx — this is a transient
      // server error, NOT a permanent CSRF failure. The queue should retry.
      return new Response(JSON.stringify({ error: 'boom' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { csrfFetch } = await import('../lib/csrf-client');
    const res = await csrfFetch('/api/sales', { method: 'POST' });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
  });
});