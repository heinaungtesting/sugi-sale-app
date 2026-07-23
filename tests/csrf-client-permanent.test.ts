import { afterEach, describe, expect, it, vi } from 'vitest';

describe('mutation fetch wrapper response handling', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns a server 403 directly without CSRF refresh or replay', async () => {
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { csrfFetch } = await import('../lib/csrf-client');
    const response = await csrfFetch('/api/sales', { method: 'POST' });

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/auth/csrf'))).toBe(false);
  });
});
