import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('modular monolith and observability boundaries', () => {
  it('keeps the sale route thin and separates policy, service, repository, and infrastructure', () => {
    const route = source('app/api/sales/route.ts');
    expect(route).toContain('validateCreateSale');
    expect(route).toContain('createSale');
    expect(route).not.toContain('sales_logs');
    expect(source('domain/sales/sale-policy.ts')).toContain('validateCreateSale');
    expect(source('domain/sales/sale-service.ts')).toContain('saleRepository.create');
    expect(source('repositories/sale-repository.ts')).toContain('logSale');
    expect(source('infrastructure/rate-limit/sale-write-budget.ts')).toContain('reserveSaleWrite');
  });

  it('uses IndexedDB as the primary authenticated queue store with legacy migration', () => {
    const store = source('infrastructure/queue/indexeddb-sale-queue-store.ts');
    const queue = source('lib/sale-queue.ts');
    expect(store).toContain('indexedDB.open');
    expect(store).toContain("createObjectStore(STORE_NAME, { keyPath: 'idempotencyKey' })");
    expect(store).toContain('localStorage.removeItem(LEGACY_KEY)');
    expect(queue).toContain('hydratePersistedQueue');
    expect(queue).toContain('pointsSnapshot');
    expect(queue).toContain('occurredAt');
    expect(queue).toContain('BroadcastChannel');
  });

  it('records structured events and exposes admin metrics', () => {
    expect(source('infrastructure/logging/structured-logger.ts')).toContain('JSON.stringify(payload)');
    const service = source('domain/sales/sale-service.ts');
    expect(service).toContain("logEvent('sale_created'");
    expect(service).toContain("observeMetric('sale.create.duration_ms'");
    expect(source('app/api/products/route.ts')).toContain("observeMetric('search.duration_ms'");
    expect(source('app/api/auth/login/route.ts')).toContain("incrementMetric('login.failed'");
    expect(source('app/api/admin/metrics/route.ts')).toContain('metricsSnapshot');
    expect(source('scripts/backup-db.sh')).toContain('backup_completed');
    expect(source('scripts/verify-backup-restore.sh')).toContain('restore_verification_completed');
    expect(source('ops/systemd/sugi-sale-backup.service')).toContain('OnFailure=sugi-ops-alert@%n.service');
  });
});
