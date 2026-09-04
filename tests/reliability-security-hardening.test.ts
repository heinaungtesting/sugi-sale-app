import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyCsrfRequest } from '../lib/csrf';
import { shouldWriteQueueRecord } from '../infrastructure/queue/indexeddb-sale-queue-store';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('offline queue durability', () => {
  it('uses the idb Promise wrapper without a localStorage write fallback', () => {
    const store = source('infrastructure/queue/indexeddb-sale-queue-store.ts');
    expect(store).toContain("from 'idb'");
    expect(store).toContain('openDB<');
    expect(store).not.toContain('localStorage.setItem');
  });

  it('treats Service Worker records as authoritative when hydrating matching entries', () => {
    const queue = source('lib/sale-queue.ts');
    expect(queue).toContain('const persistedKeys = new Set(persisted.map');
    expect(queue).toContain('...persisted,');
    expect(queue).toContain('!persistedKeys.has(entry.idempotencyKey)');
  });

  it('registers ordered sale replay with Background Sync', () => {
    const queue = source('lib/sale-queue.ts');
    const worker = source('public/sw.js');
    expect(queue).toContain("sync.register('sugi-sale-queue-sync')");
    expect(worker).toContain("self.addEventListener('sync'");
    expect(worker).toContain("event.tag === 'sugi-sale-queue-sync'");
    expect(worker).toContain('a.enqueuedAt - b.enqueuedAt');
    expect(worker).toContain("fetch('/api/sales'");
  });

  it('reconciles accepted receipts inside the Service Worker before replay', () => {
    const worker = source('public/sw.js');
    expect(worker).toContain('async function reconcileAcceptedQueue');
    expect(worker).toContain("fetch('/api/sales/status'");
    expect(worker).toContain('await reconcileAcceptedQueue(db)');
    expect(worker).toContain("entry.status = 'synced'");
    expect(worker).toContain('entry.sale = accepted.sale');
  });

  it('atomically leases queue entries across the page and Service Worker', () => {
    const store = source('infrastructure/queue/indexeddb-sale-queue-store.ts');
    const queue = source('lib/sale-queue.ts');
    const worker = source('public/sw.js');
    expect(store).toContain('export async function claimQueueRecord');
    expect(store).toContain("db.transaction(STORE_NAME, 'readwrite')");
    expect(store).toContain('leaseExpiresAt');
    expect(queue).toContain('await claimQueueRecord(');
    expect(queue).toContain("restored.status === 'sending' && leaseExpired");
    expect(worker).toContain('async function claimNextSaleQueueEntry');
  });

  it('never lets a stale page snapshot downgrade a Service Worker synced record', () => {
    const now = Date.now();
    expect(shouldWriteQueueRecord(
      { idempotencyKey: 'sale-1', status: 'synced' },
      { idempotencyKey: 'sale-1', status: 'sending', leaseOwner: 'page', leaseExpiresAt: now + 90_000 },
      now,
    )).toBe(false);
    expect(shouldWriteQueueRecord(
      { idempotencyKey: 'sale-1', status: 'synced' },
      { idempotencyKey: 'sale-1', status: 'pending' },
      now,
    )).toBe(false);
    expect(shouldWriteQueueRecord(
      { idempotencyKey: 'sale-1', status: 'sending' },
      { idempotencyKey: 'sale-1', status: 'synced' },
      now,
    )).toBe(true);
  });

  it('periodically reconciles active queue UI state from authoritative IndexedDB', () => {
    const queue = source('lib/sale-queue.ts');
    const timerStart = queue.indexOf('staleDrainTimer = setInterval');
    const timerBody = queue.slice(timerStart, timerStart + 500);
    expect(timerBody).toContain("entries.some((e) => e.status === 'pending' || e.status === 'sending' || e.status === 'failed')");
    expect(timerBody).toContain('void hydratePersistedQueue()');
  });
});

describe('Postgres-backed throttling', () => {
  it('creates an unlogged shared rate-limit table', () => {
    const migration = source('scripts/migrate.ts');
    expect(migration).toContain('CREATE UNLOGGED TABLE IF NOT EXISTS sugi_rate_limits');
    expect(migration).toContain('PRIMARY KEY (scope, subject_key)');
  });

  it('uses atomic Postgres counters for sale and login limits', () => {
    const limiter = source('infrastructure/rate-limit/postgres-rate-limit.ts');
    const saleBudget = source('infrastructure/rate-limit/sale-write-budget.ts');
    const login = source('app/api/auth/login/route.ts');
    expect(limiter).toContain('ON CONFLICT (scope, subject_key)');
    expect(limiter).toContain('RETURNING request_count');
    expect(limiter).toContain('sugi_rate_limits.request_count < $4');
    expect(saleBudget).not.toContain('new Map');
    expect(login).not.toContain('new Map');
    expect(login).toContain('await reserveLoginAttempt');
    expect(login.indexOf('await reserveLoginAttempt')).toBeLessThan(login.indexOf('await loginUser'));
    expect(login).toContain('await clearFailedLogins');
  });
});

describe('mixed-origin mutation host policy', () => {
  it('accepts explicitly allowed MagicDNS and Tailscale-IP hosts', () => {
    for (const [url, host, origin] of [
      ['http://100.111.161.73:8080/api/feedback', '100.111.161.73:8080', 'http://100.111.161.73:8080'],
      ['http://100.111.161.73:8080/api/feedback', 'herme-agents.tail71ac56.ts.net', 'https://herme-agents.tail71ac56.ts.net'],
    ]) {
      const request = new Request(url, {
        method: 'POST',
        headers: {
          host,
          origin,
          'sec-fetch-site': 'same-origin',
          'x-sugi-request': 'same-origin',
        },
      });
      expect(verifyCsrfRequest(request)).toBe(true);
    }
  });

  it('rejects an unlisted host', () => {
    const request = new Request('https://evil.example/api/feedback', {
      method: 'POST',
      headers: {
        host: 'evil.example',
        origin: 'https://evil.example',
      },
    });
    expect(verifyCsrfRequest(request)).toBe(false);
  });

  it('contains no double-submit cookie comparison', () => {
    const csrf = source('lib/csrf.ts');
    expect(csrf).not.toContain('constantEqual');
    expect(csrf).not.toContain('cookieToken');
    expect(csrf).toContain('allowedRequestHost(req)');
  });
});
