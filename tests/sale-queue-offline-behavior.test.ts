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

describe('sale queue real offline behavior', () => {
  let listeners: Record<string, Array<() => void>>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    listeners = {};
    const localStorage = makeStorage();
    vi.stubGlobal('window', {
      localStorage,
      addEventListener: vi.fn((event: string, cb: () => void) => {
        listeners[event] = [...(listeners[event] ?? []), cb];
      }),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('crypto', { randomUUID: () => 'offline-test-key-12345678' });
    vi.stubGlobal('BroadcastChannel', undefined);
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    const queue = await import('../lib/sale-queue');
    queue.__resetForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not POST queued sales while the browser is offline after an offline event', async () => {
    const queue = await import('../lib/sale-queue');
    queue.initSaleQueue();

    // Initial health probe may call fetch. The regression is about sale POSTs after
    // the browser fires `offline`, so clear the probe call evidence first.
    await vi.runOnlyPendingTimersAsync();
    fetchMock.mockClear();

    vi.stubGlobal('navigator', { onLine: false });
    for (const cb of listeners.offline ?? []) cb();

    queue.enqueueSale({
      productId: 50,
      productName: 'brain',
      pointValue: 120,
      quantity: 1,
    });

    await vi.runOnlyPendingTimersAsync();

    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/sales',
      expect.objectContaining({ method: 'POST' })
    );
    expect(queue.getSnapshot()).toMatchObject({ online: false, healthy: false, pendingCount: 1 });
  });
});
