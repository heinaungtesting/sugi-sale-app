import { afterEach, describe, expect, it, vi } from 'vitest';

describe('mutation fetch wrapper without CSRF tokens', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('performs exactly one same-origin fetch without issuing or attaching a token', async () => {
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { csrfFetch } = await import('../lib/csrf-client');
    const response = await csrfFetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/products');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe('same-origin');
    expect(new Headers(init.headers).has('x-csrf-token')).toBe(false);
  });
});
