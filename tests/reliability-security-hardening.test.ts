import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCsrfToken, verifyCsrfRequest } from '../lib/csrf';

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
    expect(worker).toContain('entry.leaseExpiresAt <= now');
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

describe('mixed-origin CSRF host policy', () => {
  it('accepts explicitly allowed MagicDNS and Tailscale-IP hosts', () => {
    const token = createCsrfToken('secret');
    for (const [url, host, origin] of [
      ['http://100.111.161.73:8080/api/feedback', '100.111.161.73:8080', 'http://100.111.161.73:8080'],
      ['http://100.111.161.73:8080/api/feedback', 'herme-agents.tail71ac56.ts.net', 'https://herme-agents.tail71ac56.ts.net'],
    ]) {
      const request = new Request(url, {
        method: 'POST',
        headers: {
          cookie: `sugi_csrf=${token}`,
          'x-csrf-token': token,
          host,
          origin,
        },
      });
      expect(verifyCsrfRequest(request, 'secret')).toBe(true);
    }
  });

  it('rejects an unlisted host even with a valid double-submit token', () => {
    const token = createCsrfToken('secret');
    const request = new Request('https://evil.example/api/feedback', {
      method: 'POST',
      headers: {
        cookie: `sugi_csrf=${token}`,
        'x-csrf-token': token,
        host: 'evil.example',
        origin: 'https://evil.example',
      },
    });
    expect(verifyCsrfRequest(request, 'secret')).toBe(false);
  });

  it('checks the double-submit token before applying the secondary host policy', () => {
    const csrf = source('lib/csrf.ts');
    const verifyStart = csrf.indexOf('export function verifyCsrfRequest');
    const verifyBody = csrf.slice(verifyStart, verifyStart + 700);
    expect(verifyBody.indexOf('constantEqual(cookieToken, headerToken)')).toBeLessThan(verifyBody.indexOf('allowedRequestHost'));
  });
});
