import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RecordShape = Record<string, unknown> & {
  idempotencyKey: string;
  ownerUserId: number;
  status: string;
  leaseOwner?: string;
  leaseExpiresAt?: number;
};

const fakeStore = vi.hoisted(() => ({
  records: new Map<string, RecordShape>(),
}));

vi.mock('../infrastructure/queue/indexeddb-sale-queue-store', () => ({
  loadLegacyQueueRecords: () => [],
  loadQueueRecords: async () => [...fakeStore.records.values()],
  queueStorageBackend: async () => 'indexeddb' as const,
  saveQueueRecords: async (records: readonly unknown[]) => {
    const now = Date.now();
    for (const value of records) {
      const incoming = value as RecordShape;
      const current = fakeStore.records.get(incoming.idempotencyKey);
      const foreignActiveLease = Boolean(
        current?.leaseOwner
        && Number(current.leaseExpiresAt ?? 0) > now
        && current.leaseOwner !== incoming.leaseOwner,
      );
      if (!foreignActiveLease) fakeStore.records.set(incoming.idempotencyKey, { ...incoming });
    }
    return 'indexeddb' as const;
  },
  claimQueueRecord: async (
    idempotencyKey: string,
    ownerUserId: number,
    owner: string,
    now: number,
    leaseMs: number,
  ) => {
    const current = fakeStore.records.get(idempotencyKey);
    if (!current || current.ownerUserId !== ownerUserId || current.status !== 'pending') return null;
    const claimed = {
      ...current,
      status: 'sending',
      leaseOwner: owner,
      leaseExpiresAt: now + leaseMs,
    };
    fakeStore.records.set(idempotencyKey, claimed);
    return claimed;
  },
  finalizeQueueRecord: async (record: RecordShape, owner: string) => {
    const current = fakeStore.records.get(record.idempotencyKey);
    if (!current || current.leaseOwner !== owner) return null;
    const finalized = { ...record };
    delete finalized.leaseOwner;
    delete finalized.leaseExpiresAt;
    fakeStore.records.set(finalized.idempotencyKey, finalized);
    return finalized;
  },
}));

function localStorageStub() {
  return {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
}

describe('page sale queue IndexedDB lease finalization', () => {
  let listeners: Record<string, Array<() => void>>;
  let syncRegister: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    fakeStore.records.clear();
    listeners = {};
    syncRegister = vi.fn(async () => undefined);
    vi.stubGlobal('window', {
      localStorage: localStorageStub(),
      addEventListener: vi.fn((event: string, callback: () => void) => {
        listeners[event] = [...(listeners[event] ?? []), callback];
      }),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', { cookie: 'sugi_csrf=test-token' });
    vi.stubGlobal('navigator', {
      onLine: true,
      serviceWorker: {
        ready: Promise.resolve({ sync: { register: syncRegister } }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    vi.stubGlobal('crypto', { randomUUID: () => 'indexeddb-finalize-key' });
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/health')) return { ok: true } as Response;
      if (url.includes('/api/sales/status')) {
        return { ok: true, json: async () => ({ accepted: [] }) } as Response;
      }
      return new Response(JSON.stringify({ error: 'failed to log sale' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
  });

  afterEach(async () => {
    const queue = await import('../lib/sale-queue');
    queue.__resetForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('atomically stores pending after a transient failure while the page lease is active', async () => {
    const queue = await import('../lib/sale-queue');
    queue.initSaleQueue(1);
    const entry = queue.enqueueSale({
      ownerUserId: 1,
      productId: 101,
      productName: 'leased outage item',
      pointValue: 13,
      quantity: 1,
    });
    entry.attempts = 3;

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    syncRegister.mockClear();
    for (const callback of listeners.offline ?? []) callback();
    await vi.advanceTimersByTimeAsync(1_600);

    expect(fakeStore.records.get('indexeddb-finalize-key')).toMatchObject({
      idempotencyKey: 'indexeddb-finalize-key',
      status: 'pending',
      lastError: 'offline',
      retryable: true,
    });
    expect(fakeStore.records.get('indexeddb-finalize-key')).not.toHaveProperty('leaseOwner');
    expect(fakeStore.records.get('indexeddb-finalize-key')).not.toHaveProperty('leaseExpiresAt');
    expect(syncRegister).toHaveBeenCalledTimes(1);
    expect(syncRegister).toHaveBeenCalledWith('sugi-sale-queue-sync');
  });

  it('atomically stores a permanent failure and releases the page lease', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/health')) return { ok: true } as Response;
      if (url.includes('/api/sales/status')) {
        return { ok: true, json: async () => ({ accepted: [] }) } as Response;
      }
      return new Promise<Response>((resolve) => setTimeout(() => resolve(
        new Response(JSON.stringify({ error: 'invalid product_id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ), 100));
    }));
    const queue = await import('../lib/sale-queue');
    queue.initSaleQueue(1);
    queue.enqueueSale({
      ownerUserId: 1,
      productId: 102,
      productName: 'invalid leased item',
      pointValue: 14,
      quantity: 1,
    });

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    syncRegister.mockClear();
    await vi.advanceTimersByTimeAsync(100);

    expect(fakeStore.records.get('indexeddb-finalize-key')).toMatchObject({
      status: 'failed',
      lastError: 'invalid product_id',
      retryable: false,
    });
    expect(fakeStore.records.get('indexeddb-finalize-key')).not.toHaveProperty('leaseOwner');
    expect(syncRegister).not.toHaveBeenCalled();
  });

  it('atomically stores a successful sale and releases the page lease', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/health')) return { ok: true } as Response;
      if (url.includes('/api/sales/status')) {
        return { ok: true, json: async () => ({ accepted: [] }) } as Response;
      }
      return new Promise<Response>((resolve) => setTimeout(() => resolve({
        ok: true,
        json: async () => ({
          id: 9101,
          product_name: 'synced leased item',
          quantity: 1,
          points_per_item: 15,
          total_points: 15,
          today_total: 15,
          today_items: 1,
          idempotent_replay: false,
        }),
      } as Response), 100));
    }));
    const queue = await import('../lib/sale-queue');
    queue.initSaleQueue(1);
    queue.enqueueSale({
      ownerUserId: 1,
      productId: 103,
      productName: 'synced leased item',
      pointValue: 15,
      quantity: 1,
    });

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    syncRegister.mockClear();
    await vi.advanceTimersByTimeAsync(100);

    expect(fakeStore.records.get('indexeddb-finalize-key')).toMatchObject({
      status: 'synced',
      sale: { id: 9101 },
    });
    expect(fakeStore.records.get('indexeddb-finalize-key')).not.toHaveProperty('retryable');
    expect(fakeStore.records.get('indexeddb-finalize-key')).not.toHaveProperty('leaseOwner');
    expect(syncRegister).not.toHaveBeenCalled();
  });
});
