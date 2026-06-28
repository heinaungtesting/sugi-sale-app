import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Sugi sales API beta-test regressions', () => {
  it('validates quantity as an integer in the API route before calling logSale', () => {
    const route = source('app/api/sales/route.ts');

    expect(route).toContain('validateSaleQuantity');
    expect(route).toContain('quantity must be an integer between 1 and 99');
    expect(route).toContain('Number.isInteger(quantity)');
    expect(route).toContain('quantity <= 0');
    expect(route).toContain('quantity > 99');
  });

  it('does not silently clamp quantity in logSale', () => {
    const db = source('lib/sugi-db.ts');

    expect(db).not.toContain('Math.max(1, Math.min(Number(quantity) || 1, 99))');
    expect(db).toContain('const qty = quantity;');
  });

  it('rate-limits rapid sale writes per user', () => {
    const route = source('app/api/sales/route.ts');

    expect(route).toContain('MAX_SALES_PER_WINDOW');
    expect(route).toContain('too many sales');
    expect(route).toContain('recordSaleWrite');
  });

  it('returns JSON for failed sales writes instead of empty 500 bodies', () => {
    const route = source('app/api/sales/route.ts');

    expect(route).toContain('try {');
    expect(route).toContain("return Response.json({ error: 'failed to log sale' }");
  });
});
