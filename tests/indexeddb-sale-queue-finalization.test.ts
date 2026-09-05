import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakeIndexedDb = vi.hoisted(() => ({
  records: new Map<string, Record<string, unknown>>(),
}));

vi.mock('idb', () => ({
  openDB: vi.fn(async () => ({
    transaction: () => ({
      store: {
        get: async (key: string) => fakeIndexedDb.records.get(key),
        put: async (record: Record<string, unknown>) => {
          fakeIndexedDb.records.set(String(record.idempotencyKey), { ...record });
        },
      },
      done: Promise.resolve(),
    }),
  })),
}));

describe('IndexedDB sale queue lease finalization', () => {
  beforeEach(() => {
    vi.resetModules();
    fakeIndexedDb.records.clear();
    vi.stubGlobal('indexedDB', {});
  });

  afterEach(() => vi.unstubAllGlobals());

  it('writes the final transient state and clears the active page lease atomically', async () => {
    fakeIndexedDb.records.set('leased-entry', {
      idempotencyKey: 'leased-entry',
      ownerUserId: 1,
      status: 'sending',
      leaseOwner: 'page-owner',
      leaseExpiresAt: Date.now() + 90_000,
    });
    const store = await import('../infrastructure/queue/indexeddb-sale-queue-store');

    const finalized = await store.finalizeQueueRecord(
      {
        idempotencyKey: 'leased-entry',
        ownerUserId: 1,
        status: 'pending',
        lastError: 'network',
        retryable: true,
      },
      'page-owner',
    );

    expect(finalized).toMatchObject({
      idempotencyKey: 'leased-entry',
      ownerUserId: 1,
      status: 'pending',
      lastError: 'network',
      retryable: true,
    });
    expect(finalized).not.toHaveProperty('leaseOwner');
    expect(finalized).not.toHaveProperty('leaseExpiresAt');
    expect(fakeIndexedDb.records.get('leased-entry')).toEqual(finalized);
  });

  it('does not finalize a lease owned by another queue worker', async () => {
    const original = {
      idempotencyKey: 'foreign-lease',
      ownerUserId: 1,
      status: 'sending',
      leaseOwner: 'service-worker',
      leaseExpiresAt: Date.now() + 90_000,
    };
    fakeIndexedDb.records.set('foreign-lease', original);
    const store = await import('../infrastructure/queue/indexeddb-sale-queue-store');

    await expect(store.finalizeQueueRecord({
      ...original,
      status: 'pending',
      retryable: true,
    }, 'page-owner')).resolves.toBeNull();
    expect(fakeIndexedDb.records.get('foreign-lease')).toEqual(original);
  });
});
