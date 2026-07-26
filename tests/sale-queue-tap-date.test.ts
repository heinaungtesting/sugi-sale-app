import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const QUEUE_KEY = 'sugi-sale-queue-v1';

function makeStorage(initial?: unknown) {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set(QUEUE_KEY, JSON.stringify(initial));
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
  };
}

function stubBrowser(localStorage: ReturnType<typeof makeStorage>) {
  vi.stubGlobal('window', {
    localStorage,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('navigator', { onLine: false });
  vi.stubGlobal('crypto', { randomUUID: () => 'tap-date-test-key-12345678' });
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('fetch', vi.fn());
}

describe('sale queue preserves the Tokyo date of the original tap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(async () => {
    const queue = await import('../lib/sale-queue');
    queue.__resetForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stamps a home-page tap with its Asia/Tokyo date before it can wait offline', async () => {
    vi.setSystemTime(new Date('2026-07-13T15:30:00.000Z')); // 2026-07-14 00:30 JST
    stubBrowser(makeStorage());
    const queue = await import('../lib/sale-queue');

    const entry = queue.enqueueSale({
      ownerUserId: 1,
      productId: 1,
      productName: 'queued-before-sync',
      pointValue: 100,
      quantity: 1,
    });

    expect(entry.soldDate).toBe('2026-07-14');
  });

  it('backfills a legacy pending entry from enqueuedAt instead of the later sync date', async () => {
    const tappedAt = new Date('2026-07-13T14:55:00.000Z').getTime(); // 2026-07-13 23:55 JST
    vi.setSystemTime(new Date('2026-07-13T23:30:00.000Z')); // 2026-07-14 08:30 JST
    stubBrowser(makeStorage([{
      idempotencyKey: 'legacy-tap-date-key-12345678',
      ownerUserId: 1,
      productId: 1,
      variantId: null,
      productName: 'legacy-offline-tap',
      pointValue: 100,
      quantity: 1,
      soldDate: null,
      enqueuedAt: tappedAt,
      attempts: 0,
      status: 'pending',
    }]));
    const queue = await import('../lib/sale-queue');

    queue.initSaleQueue(1);

    expect(queue.getSnapshot().entries[0]?.soldDate).toBe('2026-07-13');
  });

  it('excludes yesterday queue entries from the today view', async () => {
    stubBrowser(makeStorage());
    const queue = await import('../lib/sale-queue');

    vi.setSystemTime(new Date('2026-07-13T14:55:00.000Z')); // 2026-07-13 23:55 JST
    queue.enqueueSale({ ownerUserId: 1, productId: 1, productName: 'yesterday', pointValue: 100, quantity: 1 });
    vi.setSystemTime(new Date('2026-07-13T15:05:00.000Z')); // 2026-07-14 00:05 JST
    queue.enqueueSale({ ownerUserId: 1, productId: 2, productName: 'today', pointValue: 200, quantity: 1 });

    expect(queue.entriesForSaleDate(queue.getSnapshot().entries, '2026-07-14').map((entry) => entry.productName)).toEqual(['today']);
  });
});
