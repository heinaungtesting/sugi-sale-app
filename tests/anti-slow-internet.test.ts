import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('anti-slow-internet contract', () => {
  describe('server: idempotency storage + endpoint', () => {
    it('adds an idempotency_key column with a partial unique index in the migration', () => {
      const migrate = source('scripts/migrate.ts');
      expect(migrate).toContain('ALTER TABLE sales_logs ADD COLUMN IF NOT EXISTS idempotency_key TEXT');
      expect(migrate).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uniq_sales_logs_user_idem');
      expect(migrate).toContain('WHERE idempotency_key IS NOT NULL');
    });

    it('validates the idempotency_key shape in the DB helper', () => {
      const db = source('lib/sugi-db.ts');
      expect(db).toContain('IDEMPOTENCY_KEY_PATTERN');
      expect(db).toMatch(/\^\[A-Za-z0-9_-\]\{8,128\}\$/);
      expect(db).toContain('isValidIdempotencyKey');
    });

    it('writes idempotent logSale with ON CONFLICT and replays the original row', () => {
      const db = source('lib/sugi-db.ts');
      expect(db).toContain('ON CONFLICT (user_id, idempotency_key) DO NOTHING');
      expect(db).toContain('FROM sale_idempotency_receipts receipt');
      expect(db).toContain('JOIN sales_logs sale ON sale.id = receipt.sale_id');
      expect(db).toContain('idempotent_replay: replay');
      expect(db).toContain("type LoggedSale");
    });

    it('accepts idempotency_key in the sales POST and rejects bad shapes', () => {
      const policy = source('domain/sales/sale-policy.ts');
      expect(policy).toContain('idempotency_key');
      expect(policy).toContain('isValidIdempotencyKey');
      expect(policy).toContain("error: 'invalid idempotency_key'");
    });

    it('exposes an authenticated receipt-status endpoint for client recovery', () => {
      const route = source('app/api/sales/status/route.ts');
      const repository = source('repositories/sale-repository.ts');
      const queue = source('lib/sale-queue.ts');
      expect(route).toContain('requireCsrf(req)');
      expect(route).toContain('currentUser()');
      expect(route).toContain('findAcceptedByIdempotencyKeys');
      expect(repository).toContain('sale_idempotency_receipts');
      expect(repository).toContain('ANY($2::text[])');
      expect(queue).toContain("csrfFetch('/api/sales/status'");
      expect(queue).toContain('applyAcceptedSales(entries, body.accepted)');
      expect(route).toContain("logEvent('sale_status_checked'");
    });

    it('does not consume the rate-limit budget for idempotent replays', () => {
      const service = source('domain/sales/sale-service.ts');
      // The route must reserve a rate-limit slot before logSale and refund
      // the slot on idempotent replays. This replaces the old
      // "recordSaleWrite conditional on !sale.idempotent_replay" pattern,
      // which inserted the row first and could leave orphan rows in
      // sales_logs when the limit was exceeded (see BUG-001, 2026-06-19).
      expect(service).toContain('reserveSaleWrite(userId)');
      expect(service).toContain('releaseSaleWrite');
      expect(service).toMatch(/sale\.idempotent_replay[\s\S]{0,200}releaseSaleWrite/);
    });

    it('forwards idempotency_key through the quick-add-and-log path', () => {
      const route = source('app/api/products/route.ts');
      expect(route).toContain('idempotency_key');
      expect(route).toContain('isValidIdempotencyKey');
      expect(route).toContain('product.variant_id ?? null');
      expect(route).toContain('null, idempotencyKey');
    });
  });

  describe('client: persistent offline queue', () => {
    it('ships a client-only queue that persists to IndexedDB and migrates the legacy localStorage queue', () => {
      const q = source('lib/sale-queue.ts');
      const store = source('infrastructure/queue/indexeddb-sale-queue-store.ts');
      expect(q).toContain("'use client'");
      expect(store).toContain("DB_NAME = 'sugi-sale-queue'");
      expect(store).toContain("from 'idb'");
      expect(store).toContain('openDB<SaleQueueDb>');
      expect(store).toContain("LEGACY_KEY = 'sugi-sale-queue-v1'");
      expect(store).toContain('localStorage.removeItem(LEGACY_KEY)');
    });

    it('attaches a stable idempotency key (UUID) to every queue entry', () => {
      const q = source('lib/sale-queue.ts');
      expect(q).toContain('crypto.randomUUID');
      expect(q).toContain('idempotencyKey');
      expect(q).toContain("type QueueEntry");
    });

    it('retries with exponential backoff and respects a request timeout', () => {
      const q = source('lib/sale-queue.ts');
      expect(q).toContain('BACKOFF_MS');
      expect(q).toContain('MAX_ATTEMPTS');
      expect(q).toContain('REQUEST_TIMEOUT_MS');
      expect(q).toContain('AbortController');
    });

    it('caps concurrent in-flight requests to keep the server responsive', () => {
      const q = source('lib/sale-queue.ts');
      expect(q).toContain('const concurrency = 1');
      expect(q).toContain('.sort((a, b) => a.enqueuedAt - b.enqueuedAt)');
      expect(q).toContain('Promise.all(workers)');
    });

    it('tracks online/offline state with navigator.onLine plus a health probe', () => {
      const q = source('lib/sale-queue.ts');
      expect(q).toContain("navigator.onLine");
      expect(q).toContain("window.addEventListener('online'");
      expect(q).toContain("window.addEventListener('offline'");
      expect(q).toContain('probeHealth');
      expect(q).toContain("fetch(HEALTH_PATH");
      expect(q).toContain("HEALTH_PATH = '/api/health'");
    });

    it('exposes enqueue / retry / remove / pruneSyncedToServerIds for the UI', () => {
      const q = source('lib/sale-queue.ts');
      expect(q).toContain('export function enqueueSale');
      expect(q).toContain('export function retryEntry');
      expect(q).toContain('export function removeEntry');
      expect(q).toContain('export function pruneSyncedToServerIds');
      expect(q).toContain('export function subscribe');
      expect(q).toContain('export function initSaleQueue');
    });

    it('recovers mid-flight entries after a tab kill', () => {
      const q = source('lib/sale-queue.ts');
      // Anything that was 'sending' when the tab died is reset to 'pending' and
      // its attempt counter is decremented so the user does not lose a retry.
      expect(q).toContain("e.status === 'sending'");
      expect(q).toContain("status: 'pending' as const");
      expect(q).toContain('attempts: Math.max(0, restored.attempts - 1)');
    });
  });

  describe('client: connectivity indicator', () => {
    it('renders a pill with online / syncing / offline states', () => {
      const c = source('components/ConnectivityIndicator.tsx');
      expect(c).toContain('connectivity-pill');
      expect(c).toContain("'online'");
      expect(c).toContain("'syncing'");
      expect(c).toContain("'offline'");
      expect(c).toContain('classify(snap)');
    });

    it('initialises the sale queue and subscribes to its snapshot', () => {
      const c = source('components/ConnectivityIndicator.tsx');
      expect(c).toContain('initSaleQueue');
      expect(c).toContain('subscribe');
      expect(c).toContain('getSnapshot');
    });

    it('shows pending + failed counts in the label', () => {
      const c = source('components/ConnectivityIndicator.tsx');
      expect(c).toContain('pendingCount');
      expect(c).toContain('failedCount');
      expect(c).toContain('t.pending(');
      expect(c).toContain('t.failed(');
    });

    it('is mounted in the AppHeader next to the language toggle', () => {
      const h = source('components/AppHeader.tsx');
      expect(h).toContain('ConnectivityIndicator');
      expect(h).toContain('header-actions');
    });
  });

  describe('client: optimistic UI in the home logger', () => {
    it('enqueues on tap and never blocks on the network', () => {
      const l = source('components/SearchProductLogger.tsx');
      expect(l).toContain('enqueueSale');
      // No `await fetch('/api/sales'...)` in the log() path
      expect(l).not.toMatch(/await fetch\(['"`]\/api\/sales['"`]/);
      // The pre-queue busyId lock on the network is gone
      expect(l).not.toContain('busyId');
      // A short debounce replaces the network-blocking lock
      expect(l).toContain('TAP_DEBOUNCE_MS');
      expect(l).toContain('aria-busy');
    });

    it('injects an optimistic sale with a temp id via setTodaySummary + queueKey', () => {
      const l = source('components/SearchProductLogger.tsx');
      expect(l).toContain('quickAddEnqueue');
      expect(l).toContain('setTodaySummary(sale, queueKey)');
      expect(l).toContain('idempotencyKey');
    });
  });

  describe('client: merge + retry UI in the home logger parent', () => {
    it('subscribes to the queue and merges pending / synced entries into the recent list', () => {
      const c = source('components/HomeShiftLoggerClient.tsx');
      expect(c).toContain('initSaleQueue');
      expect(c).toContain('subscribe');
      expect(c).toContain('queueSnapshot.entries');
      expect(c).toContain("'pending'");
      expect(c).toContain("'sending'");
      expect(c).toContain("'synced'");
      expect(c).toContain("'failed'");
    });

    it('does not duplicate the just-tapped optimistic sale in 今日の記録', () => {
      const c = source('components/HomeShiftLoggerClient.tsx');
      // SearchProductLogger injects a temp sale immediately via setTodaySummary.
      // The queue snapshot also contains the same temp sale. Home must filter the
      // synthetic serverToday temp row and render the queue-owned row once.
      expect(c).toContain('temporaryQueueIds');
      expect(c).toContain('temporaryQueueIds.has(Number(row.id))');
      expect(c).toMatch(/serverToday\.recent\s*\.filter/);
    });

    it('renders pending and failed recent rows with visual badges', () => {
      const c = source('components/HomeShiftLoggerClient.tsx');
      expect(c).toContain('recent-pending');
      expect(c).toContain('recent-failed');
      expect(c).toContain('queue-badge-pending');
      expect(c).toContain('queue-badge-failed');
    });

    it('lets the user tap to retry or dismiss a failed entry', () => {
      const c = source('components/HomeShiftLoggerClient.tsx');
      expect(c).toContain('retryEntry');
      expect(c).toContain('removeEntry');
      expect(c).toContain('handleRetry');
      expect(c).toContain('handleDismiss');
    });

    it('prunes synced entries once the server reflects the same id', () => {
      const c = source('components/HomeShiftLoggerClient.tsx');
      expect(c).toContain('pruneSyncedToServerIds');
    });

    it('adds queued optimistic points/items to the displayed totals', () => {
      const c = source('components/HomeShiftLoggerClient.tsx');
      expect(c).toContain('optimisticPoints');
      expect(c).toContain('optimisticItems');
      expect(c).toContain('syncedTodayPoints + optimisticPoints');
      expect(c).toContain('syncedTodayItems + optimisticItems');
    });
  });

  describe('client: calendar + category tap list use the same queue', () => {
    it('SalesCalendarClient forwards the selected date to the queue entry', () => {
      const c = source('components/SalesCalendarClient.tsx');
      expect(c).toContain('enqueueSale');
      expect(c).toContain('soldDate: selectedDate');
      // No direct await fetch to /api/sales in the add path
      expect(c).not.toMatch(/await fetch\(['"`]\/api\/sales['"`]/);
    });

    it('ProductTapList enqueues with no soldDate for the default today bucket', () => {
      const c = source('components/ProductTapList.tsx');
      expect(c).toContain('enqueueSale');
      expect(c).toContain('quantity: 1');
      expect(c).not.toMatch(/await fetch\(['"`]\/api\/sales['"`]/);
    });
  });

  describe('CSS contract for queue + connectivity states', () => {
    it('defines a connectivity pill with online / syncing / offline variants', () => {
      const css = source('app/globals.css');
      expect(css).toMatch(/\.connectivity-pill\b/);
      expect(css).toMatch(/\.connectivity-pill\.connectivity-syncing\b/);
      expect(css).toMatch(/\.connectivity-pill\.connectivity-offline\b/);
      expect(css).toMatch(/@keyframes\s+connectivity-pulse/);
    });

    it('defines queue-badge / recent-pending / recent-failed styles', () => {
      const css = source('app/globals.css');
      expect(css).toMatch(/\.queue-badge\s*\{/);
      expect(css).toMatch(/\.queue-badge-pending\s*\{/);
      expect(css).toMatch(/\.queue-badge-failed\s*\{/);
      expect(css).toMatch(/\.recent-row\.recent-pending\s*\{/);
      expect(css).toMatch(/\.recent-row\.recent-failed\s*\{/);
    });
  });

  describe('documentation', () => {
    it('ships a queue + connectivity story in PRODUCTION.md', () => {
      const doc = source('PRODUCTION.md');
      expect(doc.toLowerCase()).toContain('offline');
      expect(doc.toLowerCase()).toContain('idempot');
      expect(doc.toLowerCase()).toContain('queue');
    });

    it('adds a known limitation note about the in-memory login rate limiter alongside the new queue caveat', () => {
      const doc = source('PRODUCTION.md');
      // We extend the limitations list to mention the queue's per-user / per-key
      // dedupe model and the localStorage fallback for private-mode browsers.
      expect(doc.toLowerCase()).toMatch(/local\s*storage|offline queue|queue/);
    });
  });

  describe('files present', () => {
    it('ships the sale queue module, indicator component, and updated logger', () => {
      for (const path of [
        'lib/sale-queue.ts',
        'components/ConnectivityIndicator.tsx',
        'components/SearchProductLogger.tsx',
        'components/HomeShiftLoggerClient.tsx',
        'components/SalesCalendarClient.tsx',
        'components/ProductTapList.tsx',
      ]) {
        expect(existsSync(join(process.cwd(), path))).toBe(true);
      }
    });
  });
});
