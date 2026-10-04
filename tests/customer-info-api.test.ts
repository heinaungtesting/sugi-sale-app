import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  getCustomerInfoCard: vi.fn(),
  getCustomerInfoBundle: vi.fn(),
  ingestCustomerInfo: vi.fn(),
  reviewCustomerInfoRow: vi.fn(),
  reserveRateLimit: vi.fn(),
  logSale: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  currentUser: mocks.currentUser,
  requireUserResponse: () => Response.json({ error: 'login required' }, { status: 401 }),
}));
vi.mock('@/lib/sugi-admin-db', () => ({ requireAdmin: async (user: { role: string } | null) => user?.role === 'admin' }));
vi.mock('@/lib/sugi-db', () => ({ logSale: mocks.logSale }));
vi.mock('@/repositories/customer-info-repository', () => ({
  getCustomerInfoCard: mocks.getCustomerInfoCard,
  getCustomerInfoBundle: mocks.getCustomerInfoBundle,
  ingestCustomerInfo: mocks.ingestCustomerInfo,
  reviewCustomerInfoRow: mocks.reviewCustomerInfoRow,
}));
vi.mock('@/infrastructure/rate-limit/postgres-rate-limit', () => ({ reserveRateLimit: mocks.reserveRateLimit }));
vi.mock('@/infrastructure/logging/structured-logger', () => ({ logEvent: vi.fn(), requestId: () => 'test' }));

import { GET as readCard } from '@/app/api/products/[id]/customer-info/route';
import { POST as ingest } from '@/app/api/admin/customer-info/ingest/route';
import { PATCH as review } from '@/app/api/admin/customer-info/[rowId]/route';

const TOKEN = 'a'.repeat(40);
const staff = { id: 2, username: 'staff', role: 'user' };
const admin = { id: 1, username: 'admin', role: 'admin' };
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

function ingestRequest(body: unknown, token = TOKEN) {
  return new Request('http://localhost/api/admin/customer-info/ingest', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function reviewRequest(body: unknown) {
  return new Request('http://localhost/api/admin/customer-info/7', {
    method: 'PATCH',
    headers: { host: 'localhost', origin: 'http://localhost', 'sec-fetch-site': 'same-origin', 'x-sugi-request': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CUSTOMER_INFO_INGEST_TOKEN = TOKEN;
  mocks.reserveRateLimit.mockResolvedValue(true);
});

describe('GET /api/products/[id]/customer-info', () => {
  it('requires a staff session', async () => {
    mocks.currentUser.mockResolvedValue(null);
    expect((await readCard(new Request('http://localhost/api/products/12/customer-info'), params({ id: '12' }))).status).toBe(401);
  });

  it('returns 404 for private, inactive, or missing products', async () => {
    mocks.currentUser.mockResolvedValue(staff);
    mocks.getCustomerInfoCard.mockResolvedValue({ status: 'not_found' });
    const response = await readCard(new Request('http://localhost/api/products/12/customer-info?lang=en'), params({ id: '12' }));
    expect(response.status).toBe(404);
  });

  it('returns 204 when the language has no complete published card', async () => {
    mocks.currentUser.mockResolvedValue(staff);
    mocks.getCustomerInfoCard.mockResolvedValue({ status: 'unavailable', available_languages: ['en'] });
    const response = await readCard(new Request('http://localhost/api/products/12/customer-info?lang=zh-Hans'), params({ id: '12' }));
    expect(response.status).toBe(204);
    expect(response.headers.get('x-available-languages')).toBe('en');
  });

  it('returns the published card and rejects unknown languages', async () => {
    mocks.currentUser.mockResolvedValue(staff);
    mocks.getCustomerInfoCard.mockResolvedValue({ status: 'ok', card: { product_id: 12, language: 'en' } });
    const ok = await readCard(new Request('http://localhost/api/products/12/customer-info?lang=en'), params({ id: '12' }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ product_id: 12, language: 'en' });
    const bad = await readCard(new Request('http://localhost/api/products/12/customer-info?lang=ko'), params({ id: '12' }));
    expect(bad.status).toBe(400);
  });

  it('never logs a sale', async () => {
    mocks.currentUser.mockResolvedValue(staff);
    mocks.getCustomerInfoCard.mockResolvedValue({ status: 'ok', card: {} });
    await readCard(new Request('http://localhost/api/products/12/customer-info?lang=en'), params({ id: '12' }));
    expect(mocks.logSale).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/customer-info/ingest', () => {
  const draft = { product_id: 12, rows: [{ language: 'ja', field_key: 'purpose', body: '風邪のひきはじめに', source_ids: [3] }] };

  it('refuses a missing or wrong token, and fails closed when none is configured', async () => {
    expect((await ingest(ingestRequest(draft, 'b'.repeat(40)))).status).toBe(401);
    delete process.env.CUSTOMER_INFO_INGEST_TOKEN;
    expect((await ingest(ingestRequest(draft))).status).toBe(401);
    expect(mocks.ingestCustomerInfo).not.toHaveBeenCalled();
  });

  it('returns 400 and writes nothing when the body tries to publish', async () => {
    const response = await ingest(ingestRequest({ ...draft, rows: [{ ...draft.rows[0], status: 'published' }] }));
    expect(response.status).toBe(400);
    expect(mocks.ingestCustomerInfo).not.toHaveBeenCalled();
  });

  it('rate-limits under its own scope', async () => {
    mocks.reserveRateLimit.mockResolvedValue(false);
    expect((await ingest(ingestRequest(draft))).status).toBe(429);
    expect(mocks.reserveRateLimit).toHaveBeenCalledWith('customer-info-ingest', 'hermes', 60_000, 60);
  });

  it('writes drafts and maps repository refusals to status codes', async () => {
    mocks.ingestCustomerInfo.mockResolvedValueOnce({ ok: true, written: [{ language: 'ja', field_key: 'purpose', outcome: 'drafted' }], staled_row_ids: [] });
    expect((await ingest(ingestRequest(draft))).status).toBe(200);
    mocks.ingestCustomerInfo.mockResolvedValueOnce({ ok: false, code: 'invalid_sources' });
    expect((await ingest(ingestRequest(draft))).status).toBe(400);
    mocks.ingestCustomerInfo.mockResolvedValueOnce({ ok: false, code: 'ja_source_changed' });
    expect((await ingest(ingestRequest(draft))).status).toBe(409);
  });
});

describe('PATCH /api/admin/customer-info/[rowId]', () => {
  it('is admin only', async () => {
    mocks.currentUser.mockResolvedValue(staff);
    expect((await review(reviewRequest({ action: 'approve' }), params({ rowId: '7' }))).status).toBe(403);
    expect(mocks.reviewCustomerInfoRow).not.toHaveBeenCalled();
  });

  it('requires the same-origin guard', async () => {
    mocks.currentUser.mockResolvedValue(admin);
    const crossSite = new Request('http://localhost/api/admin/customer-info/7', { method: 'PATCH', body: '{}' });
    expect((await review(crossSite, params({ rowId: '7' }))).status).toBe(403);
  });

  it('approves through the repository and reports conflicts', async () => {
    mocks.currentUser.mockResolvedValue(admin);
    mocks.reviewCustomerInfoRow.mockResolvedValueOnce({ ok: true, status: 'published', product_id: 12, language: 'en', field_key: 'purpose', staled_row_ids: [] });
    expect((await review(reviewRequest({ action: 'approve' }), params({ rowId: '7' }))).status).toBe(200);
    expect(mocks.reviewCustomerInfoRow).toHaveBeenCalledWith(7, { action: 'approve', body: null }, { id: 1, username: 'admin' });

    mocks.reviewCustomerInfoRow.mockResolvedValueOnce({ ok: false, code: 'blocked_claims', blocked: ['cures'] });
    const blocked = await review(reviewRequest({ action: 'approve' }), params({ rowId: '7' }));
    expect(blocked.status).toBe(422);
    expect((await blocked.json()).blocked).toEqual(['cures']);

    mocks.reviewCustomerInfoRow.mockResolvedValueOnce({ ok: false, code: 'ja_source_changed' });
    expect((await review(reviewRequest({ action: 'approve' }), params({ rowId: '7' }))).status).toBe(409);
  });

  it('rejects malformed actions', async () => {
    mocks.currentUser.mockResolvedValue(admin);
    expect((await review(reviewRequest({ action: 'reject' }), params({ rowId: '7' }))).status).toBe(400);
  });
});
