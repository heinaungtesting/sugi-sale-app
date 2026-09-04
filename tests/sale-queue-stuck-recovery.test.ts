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
  let localStorage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    listeners = {};
    cookieJar = 'sugi_csrf=initial-csrf-token';
    localStorage = makeStorage();
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

  it('classifies transient stored failures for automatic recovery', async () => {
    const queue = await import('../lib/sale-queue');

    for (const error of [
      undefined,
      'network',
      'timeout',
      'offline',
      'invalid csrf token',
      'http_408',
      'http_429',
      'http_500',
      'failed to log sale',
    ]) {
      expect(queue.isRetryableStoredQueueError(error), error ?? 'missing error').toBe(true);
    }

    for (const error of [
      'invalid product_id',
      'product not found',
      'queued sale owner mismatch',
    ]) {
      expect(queue.isRetryableStoredQueueError(error), error).toBe(false);
    }
  });

  it('restores a persisted transient failure to pending without changing its key', async () => {
    localStorage.setItem('sugi-sale-queue-v1', JSON.stringify([{
      idempotencyKey: 'persisted-transient-key',
      ownerUserId: 1,
      productId: 91,
      productName: 'persisted item',
      pointValue: 7,
      pointsSnapshot: 7,
      quantity: 1,
      enqueuedAt: 1_700_000_000_000,
      occurredAt: '2023-11-14T22:13:20.000Z',
      createdAt: '2023-11-14T22:13:20.000Z',
      attempts: 8,
      lastError: 'network',
      status: 'failed',
    }]));

    const queue = await import('../lib/sale-queue');
    queue.initSaleQueue(1);

    expect(queue.getSnapshot().entries[0]).toMatchObject({
      idempotencyKey: 'persisted-transient-key',
      status: 'pending',
    });
  });

  it('keeps a persisted permanent request failure failed', async () => {
    localStorage.setItem('sugi-sale-queue-v1', JSON.stringify([{
      idempotencyKey: 'persisted-permanent-key',
      ownerUserId: 1,
      productId: 0,
      productName: 'invalid item',
      pointValue: 7,
      pointsSnapshot: 7,
      quantity: 1,
      enqueuedAt: 1_700_000_000_000,
      occurredAt: '2023-11-14T22:13:20.000Z',
      createdAt: '2023-11-14T22:13:20.000Z',
      attempts: 1,
      lastError: 'invalid product_id',
      retryable: false,
      status: 'failed',
    }]));

    const queue = await import('../lib/sale-queue');
    queue.initSaleQueue(1);

    expect(queue.getSnapshot()).toMatchObject({ pendingCount: 0, failedCount: 1 });
    expect(queue.getSnapshot().entries[0]?.status).toBe('failed');
  });

  it('keeps an exhausted HTTP 500 failure pending for a later automatic retry', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/health')) return { ok: true } as Response;
      if (url.includes('/api/sales/status')) {
        return { ok: true, json: async () => ({ accepted: [] }) } as Response;
      }
      if (url.includes('/api/sales')) {
        return new Response(JSON.stringify({ error: 'failed to log sale' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return { ok: true } as Response;
    });

    const queue = await import('../lib/sale-queue');
    queue.initSaleQueue(1);
    const entry = queue.enqueueSale({
      ownerUserId: 1,
      productId: 92,
      productName: 'outage item',
      pointValue: 9,
      quantity: 1,
    });
    entry.attempts = 3;

    await vi.advanceTimersByTimeAsync(14_600);

    expect(queue.getSnapshot()).toMatchObject({ pendingCount: 1, failedCount: 0 });
    expect(queue.getSnapshot().entries[0]).toMatchObject({
      idempotencyKey: 'stuck-test-key-12345678',
      status: 'pending',
    });
  });

  it('marks a permanently invalid HTTP 400 request failed without retrying it', async () => {
    let saleAttempts = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/health')) return { ok: true } as Response;
      if (url.includes('/api/sales/status')) {
        return { ok: true, json: async () => ({ accepted: [] }) } as Response;
      }
      if (url.includes('/api/sales')) {
        saleAttempts += 1;
        return new Response(JSON.stringify({ error: 'invalid product_id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return { ok: true } as Response;
    });

    const queue = await import('../lib/sale-queue');
    queue.initSaleQueue(1);
    queue.enqueueSale({
      ownerUserId: 1,
      productId: 94,
      productName: 'invalid item',
      pointValue: 12,
      quantity: 1,
    });

    await vi.advanceTimersByTimeAsync(1);

    expect(saleAttempts).toBe(1);
    expect(queue.getSnapshot()).toMatchObject({ pendingCount: 0, failedCount: 1 });
    expect(queue.getSnapshot().entries[0]).toMatchObject({
      status: 'failed',
      lastError: 'invalid product_id',
      retryable: false,
    });
  });

  it('automatically syncs with the same idempotency key after a long outage recovers', async () => {
    let serverRecovered = false;
    const sentKeys: string[] = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/health')) return { ok: true } as Response;
      if (url.includes('/api/sales/status')) {
        return { ok: true, json: async () => ({ accepted: [] }) } as Response;
      }
      if (url.includes('/api/sales')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { idempotency_key?: string };
        if (body.idempotency_key) sentKeys.push(body.idempotency_key);
        if (!serverRecovered) {
          return new Response(JSON.stringify({ error: 'failed to log sale' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return {
          ok: true,
          json: async () => ({
            id: 9001,
            product_name: 'eventual item',
            quantity: 1,
            points_per_item: 11,
            total_points: 11,
            today_total: 11,
            today_items: 1,
            idempotent_replay: false,
          }),
        } as Response;
      }
      return { ok: true } as Response;
    });

    const queue = await import('../lib/sale-queue');
    queue.initSaleQueue(1);
    queue.enqueueSale({
      ownerUserId: 1,
      productId: 93,
      productName: 'eventual item',
      pointValue: 11,
      quantity: 1,
    });

    await vi.advanceTimersByTimeAsync(65_000);
    expect(sentKeys.length).toBeGreaterThan(4);
    expect(queue.getSnapshot().failedCount).toBe(0);

    serverRecovered = true;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(queue.getSnapshot().entries[0]).toMatchObject({
      idempotencyKey: 'stuck-test-key-12345678',
      status: 'synced',
      sale: { id: 9001 },
    });
    expect(new Set(sentKeys)).toEqual(new Set(['stuck-test-key-12345678']));
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
    queue.initSaleQueue(1);
    await vi.runOnlyPendingTimersAsync();
    salefetchAttempts = 0;

    queue.enqueueSale({
      ownerUserId: 1,
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
    queue.initSaleQueue(1);
    await vi.runOnlyPendingTimersAsync();

    queue.enqueueSale({ ownerUserId: 1, productId: 1, productName: 'csrffail', pointValue: 5, quantity: 1 });
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
    queue.initSaleQueue(1);
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
