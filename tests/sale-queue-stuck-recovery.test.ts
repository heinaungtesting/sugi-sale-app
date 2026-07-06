import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function makeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => store.clear()),
  };
}

describe('sale queue stuck-pending recovery', () => {
  let listeners: Record<string, Array<() => void>>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let cookieJar: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    listeners = {};
    cookieJar = 'sugi_csrf=initial-csrf-token';
    const localStorage = makeStorage();
    vi.stubGlobal('window', {
      localStorage,
      addEventListener: vi.fn((event: string, cb: () => void) => {
        listeners[event] = [...(listeners[event] ?? []), cb];
      }),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', {
      get cookie() {
        return cookieJar;
      },
      set cookie(value: string) {
        cookieJar = value;
      },
    });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('crypto', { randomUUID: () => 'stuck-test-key-12345678' });
    vi.stubGlobal('BroadcastChannel', undefined);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    const queue = await import('../lib/sale-queue');
    queue.__resetForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries pending entries via the periodic safety-net, not just on user taps', async () => {
    let salefetchAttempts = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/health')) return { ok: true } as Response;
      if (url.includes('/api/auth/csrf')) {
        cookieJar = 'sugi_csrf=initial-csrf-token';
        return { ok: true } as Response;
      }
      if (url.includes('/api/sales')) {
        salefetchAttempts += 1;
        // First 2 /api/sales fetches (initial + csrf refresh retry) 403.
        // The 3rd fetch, triggered by the safety-net without a user tap,
        // succeeds. This is the regression we are pinning.
        if (salefetchAttempts <= 2) {
          return new Response(JSON.stringify({ error: 'invalid csrf token' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return {
          ok: true,
          json: async () => ({
            id: 7001,
            product_name: 'stuck-recovery',
            quantity: 1,
            points_per_item: 5,
            total_points: 5,
            today_total: 5,
            today_items: 1,
            idempotent_replay: false,
          }),
        } as Response;
      }
      return { ok: true } as Response;
    });

    const queue = await import('../lib/sale-queue');
    queue.initSaleQueue();
    await vi.runOnlyPendingTimersAsync();
    salefetchAttempts = 0;

    queue.enqueueSale({
      productId: 1,
      productName: 'stuck-item',
      pointValue: 5,
      quantity: 1,
    });
    await vi.runOnlyPendingTimersAsync();
    // csrfFetch fetches /api/sales twice during the first drain (initial
    // POST + csrf-retry POST). Both 403s. The safety-net may also kick in
    // (vitest fires intervals during runOnlyPendingTimersAsync), so by the
    // time we get here the queue has likely already retried and succeeded.
    // We assert that AT LEAST 3 /api/sales fetches happened, which proves
    // the queue re-attempted without a new user tap.
    expect(
      salefetchAttempts,
      `csrffetch retry produced at least 2 fetches, safety-net produced a 3rd; got ${salefetchAttempts}`
    ).toBeGreaterThanOrEqual(3);
    let snap = queue.getSnapshot();
    // The eventual outcome: the entry has been drained successfully without
    // the user tapping again.
    expect(snap.pendingCount, 'safety-net drains the entry automatically').toBe(0);
  });

  it('keeps invalid-csrf-token entries pending (not failed) so the safety-net can recover', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/health')) return { ok: true } as Response;
      if (url.includes('/api/auth/csrf')) {
        cookieJar = 'sugi_csrf=initial-csrf-token';
        return { ok: true } as Response;
      }
      if (url.includes('/api/sales')) {
        // Every /api/sales call permanently 403s. The queue MUST keep the
        // entry pending (not failed) so the safety-net keeps retrying —
        // otherwise a long-lived tab with a stale CSRF cookie would lose
        // sales to the "syncing failed" pill state.
        return new Response(JSON.stringify({ error: 'invalid csrf token' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return { ok: true } as Response;
    });

    const queue = await import('../lib/sale-queue');
    queue.initSaleQueue();
    await vi.runOnlyPendingTimersAsync();

    queue.enqueueSale({ productId: 1, productName: 'csrffail', pointValue: 5, quantity: 1 });
    await vi.runOnlyPendingTimersAsync();
    const snap = queue.getSnapshot();
    expect(snap.failedCount, 'transient CSRF failures must not mark the entry failed').toBe(0);
    expect(snap.pendingCount, 'transient CSRF failures must keep the entry pending').toBeGreaterThanOrEqual(1);
  });

  it('does not run the safety-net when there are no pending entries', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/health')) return { ok: true } as Response;
      if (url.includes('/api/auth/csrf')) {
        cookieJar = 'sugi_csrf=initial-csrf-token';
        return { ok: true } as Response;
      }
      if (url.includes('/api/sales')) {
        return {
          ok: true,
          json: async () => ({
            id: 8001,
            product_name: 'happy',
            quantity: 1,
            points_per_item: 1,
            total_points: 1,
            today_total: 1,
            today_items: 1,
            idempotent_replay: false,
          }),
        } as Response;
      }
      return { ok: true } as Response;
    });

    const queue = await import('../lib/sale-queue');
    queue.initSaleQueue();
    await vi.runOnlyPendingTimersAsync();
    expect(queue.getSnapshot().pendingCount).toBe(0);

    // Advance way past the safety-net interval. With zero pending entries,
    // no /api/sales fetch should fire from the safety-net timer.
    const callsBefore = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    for (let i = 0; i < 5; i += 1) {
      await vi.runOnlyPendingTimersAsync();
    }
    const salesCallsAfter = fetchMock.mock.calls.filter((c: unknown[]) => String(c[0]).includes('/api/sales')).length;
    expect(salesCallsAfter, 'no /api/sales when queue is empty').toBe(0);
  });
});