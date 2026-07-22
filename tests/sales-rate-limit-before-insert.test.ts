import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('rate-limit-before-insert (BUG-001 regression)', () => {
  const route = source('app/api/sales/route.ts');
  const service = source('domain/sales/sale-service.ts');
  const budget = source('infrastructure/rate-limit/sale-write-budget.ts');

  it('keeps the API route thin: validate, call domain service, map result', () => {
    expect(route).toContain('validateCreateSale');
    expect(route).toContain('await createSale(');
    expect(route).not.toContain('logSale(');
    expect(route).not.toContain('sales_logs');
  });

  it('reserves the rate-limit budget before repository insertion', () => {
    const reserveIdx = service.indexOf('reserveSaleWrite(userId)');
    const insertIdx = service.indexOf('await saleRepository.create(');
    expect(reserveIdx).toBeGreaterThan(0);
    expect(insertIdx).toBeGreaterThan(0);
    expect(reserveIdx).toBeLessThan(insertIdx);
  });

  it('returns rate_limited before reaching the repository', () => {
    const limitedIdx = service.indexOf("kind: 'rate_limited'");
    const insertIdx = service.indexOf('await saleRepository.create(');
    expect(limitedIdx).toBeGreaterThan(0);
    expect(limitedIdx).toBeLessThan(insertIdx);
  });

  it('refunds idempotent replays and failures', () => {
    expect(service).toMatch(/idempotent_replay[\s\S]{0,200}releaseSaleWrite/);
    expect(service).toMatch(/catch\s*\(error\)[\s\S]{0,200}releaseSaleWrite/);
  });

  it('keeps the rate budget in shared Postgres infrastructure with an atomic decrement', () => {
    const postgresBudget = source('infrastructure/rate-limit/postgres-rate-limit.ts');
    expect(budget).toContain('export async function releaseSaleWrite');
    expect(postgresBudget).toContain('GREATEST(0, request_count - 1)');
    expect(postgresBudget).toContain('ON CONFLICT (scope, subject_key)');
  });
});
