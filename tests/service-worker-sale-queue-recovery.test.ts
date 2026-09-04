import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type StoredEntry = {
  idempotencyKey: string;
  status: 'pending' | 'sending' | 'synced' | 'failed';
  enqueuedAt: number;
  lastError?: string;
  retryable?: boolean;
  leaseExpiresAt?: number;
  leaseOwner?: string;
};

function queueDb(records: StoredEntry[]) {
  const store = {
    getAll() {
      const request: { result?: StoredEntry[]; onsuccess?: () => void } = {};
      queueMicrotask(() => {
        request.result = records;
        request.onsuccess?.();
      });
      return request;
    },
    put(entry: StoredEntry) {
      const index = records.findIndex((record) => record.idempotencyKey === entry.idempotencyKey);
      if (index >= 0) records[index] = entry;
      else records.push(entry);
    },
  };
  return {
    transaction() {
      const transaction = { objectStore: () => store } as {
        objectStore: () => typeof store;
        oncomplete?: () => void;
        onerror?: () => void;
        onabort?: () => void;
      };
      Object.defineProperty(transaction, 'oncomplete', {
        set(callback: () => void) { queueMicrotask(callback); },
      });
      return transaction;
    },
  };
}

function loadWorkerQueueInternals() {
  const worker = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');
  const context = {
    self: {
      addEventListener: vi.fn(),
      location: { origin: 'https://example.test' },
      clients: { matchAll: vi.fn(), claim: vi.fn() },
      skipWaiting: vi.fn(),
    },
    caches: {},
    indexedDB: {},
    fetch: vi.fn(),
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    queueMicrotask,
  } as Record<string, unknown>;
  runInNewContext(`${worker}\n;globalThis.__workerQueue = {
    claimNext: claimNextSaleQueueEntry,
    applyHttpFailure: typeof applySaleQueueHttpFailure === 'function' ? applySaleQueueHttpFailure : undefined,
  };`, context);
  return context.__workerQueue as {
    claimNext: (db: ReturnType<typeof queueDb>) => Promise<StoredEntry | null>;
    applyHttpFailure?: (entry: StoredEntry, status: number, error: string) => void;
  };
}

describe('service-worker sale queue recovery', () => {
  it('claims a legacy failed entry when its stored error was transient', async () => {
    const records: StoredEntry[] = [{
      idempotencyKey: 'legacy-network-failure',
      status: 'failed',
      enqueuedAt: 1,
      lastError: 'network',
    }];

    const claimed = await loadWorkerQueueInternals().claimNext(queueDb(records));

    expect(claimed).toMatchObject({
      idempotencyKey: 'legacy-network-failure',
      status: 'sending',
      leaseOwner: 'service-worker',
    });
  });

  it('does not claim an explicitly permanent failed entry', async () => {
    const records: StoredEntry[] = [{
      idempotencyKey: 'permanent-request-failure',
      status: 'failed',
      enqueuedAt: 1,
      lastError: 'invalid product_id',
      retryable: false,
    }];

    await expect(loadWorkerQueueInternals().claimNext(queueDb(records))).resolves.toBeNull();
  });

  it('only reclaims a sending entry after its lease expires', async () => {
    const activeLease: StoredEntry = {
      idempotencyKey: 'active-lease',
      status: 'sending',
      enqueuedAt: 1,
      leaseExpiresAt: Date.now() + 60_000,
    };
    await expect(loadWorkerQueueInternals().claimNext(queueDb([activeLease]))).resolves.toBeNull();

    const expiredLease: StoredEntry = {
      idempotencyKey: 'expired-lease',
      status: 'sending',
      enqueuedAt: 2,
      leaseExpiresAt: Date.now() - 1,
    };
    await expect(loadWorkerQueueInternals().claimNext(queueDb([expiredLease]))).resolves.toMatchObject({
      idempotencyKey: 'expired-lease',
      status: 'sending',
      leaseOwner: 'service-worker',
    });
  });

  it('persists whether an HTTP failure is retryable', () => {
    const { applyHttpFailure } = loadWorkerQueueInternals();
    expect(applyHttpFailure).toBeTypeOf('function');

    const transient: StoredEntry = {
      idempotencyKey: 'server-outage',
      status: 'sending',
      enqueuedAt: 1,
    };
    applyHttpFailure?.(transient, 500, 'failed to log sale');
    expect(transient).toMatchObject({
      status: 'pending',
      lastError: 'failed to log sale',
      retryable: true,
    });

    const permanent: StoredEntry = {
      idempotencyKey: 'bad-request',
      status: 'sending',
      enqueuedAt: 2,
    };
    applyHttpFailure?.(permanent, 400, 'invalid product_id');
    expect(permanent).toMatchObject({
      status: 'failed',
      lastError: 'invalid product_id',
      retryable: false,
    });

    const ownerMismatch: StoredEntry = {
      idempotencyKey: 'wrong-owner',
      status: 'sending',
      enqueuedAt: 3,
    };
    applyHttpFailure?.(ownerMismatch, 409, 'queued sale owner mismatch');
    expect(ownerMismatch).toMatchObject({
      status: 'failed',
      retryable: false,
    });
  });
});
