import { describe, expect, it } from 'vitest';
import { summarizeSales, tokyoDateKey, validateLocalBackup } from '../lib/local-only-model';

const sale = (overrides: Record<string, unknown> = {}) => ({
  id: 'sale-1',
  productId: '10',
  productName: 'テスト商品',
  quantity: 1,
  pointsPerItem: 120,
  createdAt: '2026-07-17T01:00:00.000Z',
  saleDate: '2026-07-17',
  ...overrides,
});

describe('local-only data model', () => {
  it('uses Tokyo calendar dates at the UTC day boundary', () => {
    expect(tokyoDateKey(new Date('2026-07-17T14:59:59.000Z'))).toBe('2026-07-17');
    expect(tokyoDateKey(new Date('2026-07-17T15:00:00.000Z'))).toBe('2026-07-18');
  });

  it('summarizes only the selected local business date', () => {
    const result = summarizeSales([
      sale(),
      sale({ id: 'sale-2', quantity: 2, pointsPerItem: 50 }),
      sale({ id: 'sale-3', saleDate: '2026-07-16', pointsPerItem: 999 }),
    ], '2026-07-17');
    expect(result.totalItems).toBe(3);
    expect(result.totalPoints).toBe(220);
    expect(result.sales).toHaveLength(2);
  });

  it('accepts a valid versioned backup and rejects malformed records', () => {
    const valid = {
      version: 1,
      exportedAt: '2026-07-17T02:00:00.000Z',
      profile: { id: 'local', displayName: 'Hein', createdAt: '2026-07-17T01:00:00.000Z' },
      sales: [sale()],
      customProducts: [],
    };
    expect(validateLocalBackup(valid).ok).toBe(true);
    expect(validateLocalBackup({ ...valid, sales: [sale({ quantity: 0 })] }).ok).toBe(false);
    expect(validateLocalBackup({ ...valid, version: 2 }).ok).toBe(false);
  });
});
