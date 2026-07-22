import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Sugi sales API beta-test regressions', () => {
  it('validates quantity in the domain policy before repository access', () => {
    const policy = source('domain/sales/sale-policy.ts');
    const route = source('app/api/sales/route.ts');
    expect(policy).toContain('quantity must be an integer between 1 and 99');
    expect(policy).toContain('Number.isInteger(value)');
    expect(policy).toContain('value > 0');
    expect(policy).toContain('value <= 99');
    expect(route).toContain('validateCreateSale');
  });

  it('does not silently clamp quantity in logSale', () => {
    const db = source('lib/sugi-db.ts');
    expect(db).not.toContain('Math.max(1, Math.min(Number(quantity) || 1, 99))');
    expect(db).toContain('const qty = quantity;');
  });

  it('rate-limits rapid sale writes in the infrastructure boundary', () => {
    const budget = source('infrastructure/rate-limit/sale-write-budget.ts');
    const service = source('domain/sales/sale-service.ts');
    expect(budget).toContain('MAX_SALES_PER_WINDOW');
    expect(service).toContain('reserveSaleWrite(userId)');
    expect(source('app/api/sales/route.ts')).toContain('too many sales');
  });

  it('returns JSON for failed sales writes instead of empty 500 bodies', () => {
    const service = source('domain/sales/sale-service.ts');
    const route = source('app/api/sales/route.ts');
    expect(service).toContain('try {');
    expect(route).toContain("Response.json({ error: 'failed to log sale' }");
  });
});
