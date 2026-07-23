import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('csrfFetch client retry behavior', () => {
  let cookieValue = 'sugi_csrf=stale-token';

  beforeEach(() => {
    vi.resetModules();
    cookieValue = 'sugi_csrf=stale-token';
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

  it('refreshes the CSRF cookie and retries once when a mutation gets invalid csrf token', async () => {
    const fetchMock = vi
      .fn()
      // First mutation uses a stale token and is rejected by the server.
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'invalid csrf token' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      // Refresh endpoint sets a new readable CSRF cookie in the browser.
      .mockImplementationOnce(async () => {
        cookieValue = 'sugi_csrf=fresh-token';
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      })
      // Retried mutation should use the fresh token and succeed.
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { csrfFetch } = await import('../lib/csrf-client');
    const res = await csrfFetch('/api/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sales');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers as Headers).toEqual(expect.any(Headers));
    expect(((fetchMock.mock.calls[0][1] as RequestInit).headers as Headers).get('x-csrf-token')).toBe('stale-token');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/csrf');
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'GET' }));
    expect(((fetchMock.mock.calls[2][1] as RequestInit).headers as Headers).get('x-csrf-token')).toBe('fresh-token');
  });

  it('uses the token returned by refresh when document.cookie remains stale', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'invalid csrf token' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      // Installed PWAs can retain a duplicate stale cookie even after Set-Cookie.
      // The refresh response is therefore the authoritative fresh token.
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, token: 'fresh-signed-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { csrfFetch } = await import('../lib/csrf-client');
    const res = await csrfFetch('/api/products', { method: 'POST', body: '{}' });

    expect(res.ok).toBe(true);
    expect(cookieValue).toBe('sugi_csrf=stale-token');
    expect(((fetchMock.mock.calls[2][1] as RequestInit).headers as Headers).get('x-csrf-token')).toBe('fresh-signed-token');
  });
});
