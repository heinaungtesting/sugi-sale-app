import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mergeDisplayedSales } from '../lib/sale-display';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const sale = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  product_name: 'テスト商品 60錠',
  quantity: 1,
  points_per_item: 120,
  total_points: 120,
  ...overrides,
});

describe('same-product sale coalescing', () => {
  it('shows repeated persisted rows as one product with the summed quantity', () => {
    const rows = mergeDisplayedSales([
      sale({ id: 11, quantity: 1 }),
      sale({ id: 12, quantity: 2, total_points: 240 }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 11, quantity: 3, total_points: 360 });
  });

  it('uses the latest cumulative quantity when queue responses reference the same sale row', () => {
    const rows = mergeDisplayedSales([
      sale({ id: 21, quantity: 1 }),
      sale({ id: 21, quantity: 2, total_points: 240 }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 21, quantity: 2, total_points: 240 });
  });

  it('does not merge rows whose product points differ', () => {
    const rows = mergeDisplayedSales([
      sale({ id: 31, points_per_item: 120 }),
      sale({ id: 32, points_per_item: 200, total_points: 200 }),
    ]);

    expect(rows).toHaveLength(2);
  });

  it('uses durable idempotency receipts and one unique daily product row', () => {
    const migration = source('scripts/migrate.ts');
    const db = source('lib/sugi-db.ts');
    const home = source('components/HomeShiftLoggerClient.tsx');
    const calendar = source('components/SalesCalendarClient.tsx');

    expect(migration).toContain('sale_idempotency_receipts');
    expect(migration).toContain('uniq_sales_logs_daily_product');
    expect(db).toContain('ON CONFLICT (user_id, sold_date, product_id, product_name)');
    expect(db).toContain('sale_idempotency_receipts');
    expect(home).toContain('mergeDisplayedSales');
    expect(calendar).toContain('mergeDisplayedSales');
  });
});
