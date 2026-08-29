import { afterEach, describe, expect, it, vi } from 'vitest';

describe('tokenless mutation fetch wrapper', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('performs exactly one same-origin fetch with a non-simple mutation marker', async () => {
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
    expect(new Headers(init.headers).get('x-sugi-request')).toBe('same-origin');
  });

  it('does not add the mutation marker to safe requests', async () => {
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { csrfFetch } = await import('../lib/csrf-client');
    await csrfFetch('/api/products');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).has('x-sugi-request')).toBe(false);
  });

  it('preserves a Request method and headers while adding the mutation marker', async () => {
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { csrfFetch } = await import('../lib/csrf-client');
    const request = new Request('http://localhost/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    await csrfFetch(request);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-sugi-request')).toBe('same-origin');
  });
});
