import { describe, expect, it } from 'vitest';
import { applyAcceptedSales, type QueueEntry } from '../lib/sale-queue';

describe('sale queue server receipt reconciliation', () => {
  it('marks only server-confirmed idempotency keys as synced', () => {
    const entries: QueueEntry[] = [
      {
        idempotencyKey: 'accepted-key-12345678',
        productId: 1,
        productName: 'accepted',
        pointValue: 100,
        pointsSnapshot: 100,
        quantity: 1,
        soldDate: '2026-07-23',
        enqueuedAt: 1,
        occurredAt: '2026-07-23T00:00:00.000Z',
        createdAt: '2026-07-23T00:00:00.000Z',
        attempts: 3,
        status: 'sending',
        leaseOwner: 'service-worker',
        leaseExpiresAt: Date.now() + 90_000,
      },
      {
        idempotencyKey: 'unknown-key-12345678',
        productId: 2,
        productName: 'unknown',
        pointValue: 50,
        pointsSnapshot: 50,
        quantity: 1,
        soldDate: '2026-07-23',
        enqueuedAt: 2,
        occurredAt: '2026-07-23T00:00:01.000Z',
        createdAt: '2026-07-23T00:00:01.000Z',
        attempts: 1,
        status: 'pending',
      },
    ];

    const changed = applyAcceptedSales(entries, [{
      idempotency_key: 'accepted-key-12345678',
      sale: {
        id: 42,
        product_name: 'accepted',
        quantity: 1,
        points_per_item: 100,
        total_points: 100,
        today_total: 100,
        today_items: 1,
        idempotent_replay: true,
      },
    }]);

    expect(changed).toBe(1);
    expect(entries[0]).toMatchObject({ status: 'synced', lastError: undefined, sale: { id: 42 } });
    expect(entries[0].leaseOwner).toBeUndefined();
    expect(entries[0].leaseExpiresAt).toBeUndefined();
    expect(entries[1].status).toBe('pending');
  });
});