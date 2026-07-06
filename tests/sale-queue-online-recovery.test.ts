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

describe('sale queue online recovery via health probe', () => {
  let listeners: Record<string, Array<() => void>>;
  let navigatorOnline: boolean;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    listeners = {};
    navigatorOnline = true;
    const localStorage = makeStorage();
    vi.stubGlobal('window', {
      localStorage,
      addEventListener: vi.fn((event: string, cb: () => void) => {
        listeners[event] = [...(listeners[event] ?? []), cb];
      }),
      removeEventListener: vi.fn(),
    });
    // Use a getter so we can flip `navigatorOnline` mid-test without restubbing.
    vi.stubGlobal('navigator', { get onLine() { return navigatorOnline; } });
    vi.stubGlobal('crypto', { randomUUID: () => 'recovery-test-key-12345678' });
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

  it('recovers from a stuck-offline state when the health probe sees the server', async () => {
    const queue = await import('../lib/sale-queue');
    queue.initSaleQueue();
    await vi.runOnlyPendingTimersAsync();

    // Simulate iPhone Safari flap: navigator.onLine flips to false and the
    // 'offline' event fires. The browser's 'online' event will NOT re-fire,
    // which is the bug the user reported.
    navigatorOnline = false;
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    for (const cb of listeners.offline ?? []) cb();
    expect(queue.getSnapshot().online).toBe(false);

    // User taps a product while the browser still says it is offline.
    queue.enqueueSale({
      productId: 1,
      productName: 'recovery-item',
      pointValue: 1,
      quantity: 1,
    });
    await vi.runOnlyPendingTimersAsync();
    expect(queue.getSnapshot().pendingCount).toBe(1);

    // Wi-Fi is back, but the browser's `online` event is unreliable (the
    // classic iPhone Safari bug). Restore real connectivity. The next
    // periodic health probe should detect this and flip the queue back to
    // online, draining the queued sale.
    navigatorOnline = false; // browser flag is still lying
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/health')) return { ok: true } as Response;
      if (url.includes('/api/sales')) {
        return {
          ok: true,
          json: async () => ({
            id: 9001,
            product_name: 'recovery',
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

    await vi.advanceTimersByTimeAsync(31_000);
    // Drain is scheduled with a 0ms delay after recovery — flush timers.
    await vi.runOnlyPendingTimersAsync();
    // Allow any nested async chains (sendEntry → postOnce → fetch → json) to
    // complete; vi fake timers can take a few microtask flushes.
    for (let i = 0; i < 5; i += 1) {
      await vi.runOnlyPendingTimersAsync();
    }
    const snap = queue.getSnapshot();
    expect(snap.online, 'health probe should have flipped queue back to online').toBe(true);
    expect(snap.pendingCount, 'queued sale should have drained after recovery').toBe(0);
  });
});