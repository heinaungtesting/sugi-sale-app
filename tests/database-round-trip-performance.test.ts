import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyDueMonthlyPointCampaigns: vi.fn(),
  clientQuery: vi.fn(),
  connect: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  release: vi.fn(),
}));

vi.mock('../lib/db', () => ({
  pool: { connect: mocks.connect },
  query: mocks.query,
  queryOne: mocks.queryOne,
}));

vi.mock('../lib/sugi-admin-db', () => ({
  applyDueMonthlyPointCampaigns: mocks.applyDueMonthlyPointCampaigns,
  getPreviousTokyoMonthKey: () => '2026-08',
}));

import { listSearchableProducts, salesByDate } from '../lib/sugi-db';

describe('database round-trip performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.release });
    mocks.clientQuery.mockResolvedValue({ rows: [] });
  });

  it('does not run monthly campaign writes while reading products', async () => {
    await listSearchableProducts(7, '', 60);

    expect(mocks.applyDueMonthlyPointCampaigns).not.toHaveBeenCalled();
  });

  it('caps an empty product bootstrap query at the requested limit', async () => {
    await listSearchableProducts(7, '', 60);

    const searchCall = mocks.clientQuery.mock.calls.find(([sql]) => String(sql).includes('WITH search_terms'));
    expect(searchCall?.[1]?.[2]).toBe(60);
  });

  it('returns a daily sales summary and logs from one database query', async () => {
    mocks.query.mockResolvedValue([
      {
        id: '11',
        sold_date: '2026-09-03',
        product_name: 'Product A',
        quantity: 2,
        points_per_item: 25,
        total_points: 50,
        created_at: '2026-09-03T01:00:00.000Z',
        day_total_points: '50',
        day_total_items: '2',
      },
    ]);

    const result = await salesByDate(7, '2026-09-03');

    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      total_points: 50,
      total_items: 2,
      logs: [
        {
          id: 11,
          sold_date: '2026-09-03',
          product_name: 'Product A',
          quantity: 2,
          points_per_item: 25,
          total_points: 50,
          created_at: '2026-09-03T01:00:00.000Z',
          category: '\u30d8\u30eb\u30b9\u30b1\u30a2',
        },
      ],
    });
  });
});
