import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), updateSalePoints: vi.fn(), logActivity: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  currentUser: mocks.currentUser,
  requireUserResponse: () => Response.json({ error: 'unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/sugi-db', () => ({ updateSalePoints: mocks.updateSalePoints, updateSaleQuantity: vi.fn(), deleteSaleById: vi.fn() }));
vi.mock('@/lib/sugi-activity', () => ({ logActivity: mocks.logActivity }));

import { PATCH } from '@/app/api/sales/[id]/route';

function request(points: unknown) {
  return new Request('http://localhost/api/sales/12', {
    method: 'PATCH',
    headers: { origin: 'http://localhost', 'x-sugi-request': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({ point_value: points }),
  });
}
const params = { params: Promise.resolve({ id: '12' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: 7 });
});

describe('calendar sale point corrections', () => {
  it('returns recalculated points and audits the authenticated owner', async () => {
    const sale = { id: 12, product_name: 'Cream', quantity: 3, points_per_item: 120, total_points: 360 };
    mocks.updateSalePoints.mockResolvedValue(sale);
    const response = await PATCH(request(120), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(sale);
    expect(mocks.updateSalePoints).toHaveBeenCalledWith(7, 12, 120);
    expect(mocks.logActivity).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, action: 'sale_points_corrected' }));
  });

  it.each([0, -1, 1.5, 10000, 'bad', null])('rejects invalid points %s before changing records', async (points) => {
    expect((await PATCH(request(points), params)).status).toBe(400);
    expect(mocks.updateSalePoints).not.toHaveBeenCalled();
  });

  it.each([1, 9999])('accepts boundary value %s', async (points) => {
    mocks.updateSalePoints.mockResolvedValue({ id: 12, points_per_item: points });
    expect((await PATCH(request(points), params)).status).toBe(200);
  });

  it('refuses unauthenticated and cross-origin changes', async () => {
    mocks.currentUser.mockResolvedValue(null);
    expect((await PATCH(request(120), params)).status).toBe(401);
    expect((await PATCH(new Request('http://localhost/api/sales/12', { method: 'PATCH', body: '{"point_value":120}' }), params)).status).toBe(403);
    expect(mocks.updateSalePoints).not.toHaveBeenCalled();
  });

  it('returns not found when the record is missing or belongs to another user', async () => {
    mocks.updateSalePoints.mockResolvedValue(null);
    expect((await PATCH(request(120), params)).status).toBe(404);
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });
});
