import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDraftRequest, normalizeHermesEndpoint, validateHermesSettings } from '@/domain/customer-info/hermes';

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  getHermesSettings: vi.fn(),
  saveHermesSettings: vi.fn(),
  getDraftRequestProduct: vi.fn(),
  recordDraftRequest: vi.fn(),
  reserveRateLimit: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  currentUser: mocks.currentUser,
  requireUserResponse: () => Response.json({ error: 'login required' }, { status: 401 }),
}));
vi.mock('@/lib/sugi-admin-db', () => ({ requireAdmin: async (user: { role: string } | null) => user?.role === 'admin' }));
vi.mock('@/lib/sugi-activity', () => ({ logActivity: mocks.logActivity }));
vi.mock('@/repositories/app-settings-repository', async () => {
  const actual = await vi.importActual<typeof import('@/repositories/app-settings-repository')>('@/repositories/app-settings-repository');
  return { publicHermesSettings: actual.publicHermesSettings, getHermesSettings: mocks.getHermesSettings, saveHermesSettings: mocks.saveHermesSettings };
});
vi.mock('@/repositories/customer-info-repository', () => ({
  getDraftRequestProduct: mocks.getDraftRequestProduct,
  recordDraftRequest: mocks.recordDraftRequest,
}));
vi.mock('@/infrastructure/rate-limit/postgres-rate-limit', () => ({ reserveRateLimit: mocks.reserveRateLimit }));
vi.mock('@/infrastructure/logging/structured-logger', () => ({ logEvent: vi.fn(), requestId: () => 'test' }));
vi.mock('@/lib/db', () => ({ query: vi.fn(), queryOne: vi.fn() }));

import { GET as getSettings, PUT as putSettings } from '@/app/api/admin/customer-info/hermes/route';
import { POST as requestDraft } from '@/app/api/admin/customer-info/products/[id]/draft-request/route';

const admin = { id: 1, username: 'manager', role: 'admin' };
const sameOrigin = { host: 'localhost', origin: 'http://localhost', 'sec-fetch-site': 'same-origin', 'x-sugi-request': 'same-origin', 'content-type': 'application/json' };
const product = {
  product_id: 12, product_name: '葛根湯エキス顆粒', category: 'ヘルスケア', product_type: 'kampo', risk_class: 'class2',
  existing: [], sources: [{ id: 41, url: 'https://example.jp/insert.pdf', source_type: 'official_pdf' }],
};
const stored = { endpoint_url: 'http://100.64.0.5:8787/drafts', token: 'secret-token-0123456789', updated_at: null, updated_by: null };

describe('Hermes settings rules', () => {
  it('accepts http(s) URLs and blank, refuses other schemes and credentials in the URL', () => {
    expect(normalizeHermesEndpoint('http://100.64.0.5:8787/drafts')).toEqual({ ok: true, value: 'http://100.64.0.5:8787/drafts' });
    expect(normalizeHermesEndpoint('  ')).toEqual({ ok: true, value: null });
    expect(normalizeHermesEndpoint('ftp://example.com').ok).toBe(false);
    expect(normalizeHermesEndpoint('https://user:pass@example.com/').ok).toBe(false);
    expect(normalizeHermesEndpoint('not a url').ok).toBe(false);
  });

  it('keeps, replaces, or clears the token', () => {
    expect(validateHermesSettings({ endpoint_url: 'https://h.example/drafts' })).toEqual({ ok: true, value: { endpoint_url: 'https://h.example/drafts', token: undefined } });
    expect(validateHermesSettings({ endpoint_url: '', token: 'x'.repeat(20) })).toEqual({ ok: true, value: { endpoint_url: null, token: 'x'.repeat(20) } });
    expect(validateHermesSettings({ endpoint_url: '', clear_token: true })).toEqual({ ok: true, value: { endpoint_url: null, token: null } });
    expect(validateHermesSettings({ endpoint_url: '', token: 'short' }).ok).toBe(false);
  });

  it('tells Hermes what to draft and where to send it back', () => {
    const body = buildDraftRequest(product as never, 'http://localhost/api/admin/customer-info/ingest', 'manager');
    expect(body).toMatchObject({
      kind: 'customer_info_draft_request',
      product_id: 12,
      languages: ['ja', 'en', 'zh-Hans'],
      required_fields: ['display_name', 'unique_features', 'purpose', 'risks', 'ingredients'],
      official_sources: [{ id: 41 }],
      callback: { method: 'POST', url: 'http://localhost/api/admin/customer-info/ingest' },
    });
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});

describe('Hermes settings API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser.mockResolvedValue(admin);
  });

  it('never returns the token to the browser', async () => {
    mocks.getHermesSettings.mockResolvedValue(stored);
    const data = await (await getSettings()).json();
    expect(data).toEqual({ endpoint_url: stored.endpoint_url, token_set: true, updated_at: null, updated_by: null });
  });

  it('is admin only and CSRF protected', async () => {
    mocks.currentUser.mockResolvedValue({ ...admin, role: 'user' });
    expect((await getSettings()).status).toBe(403);
    const crossSite = new Request('http://localhost/api/admin/customer-info/hermes', { method: 'PUT', body: '{}' });
    expect((await putSettings(crossSite)).status).toBe(403);
    expect(mocks.saveHermesSettings).not.toHaveBeenCalled();
  });

  it('validates and saves the endpoint', async () => {
    const bad = new Request('http://localhost/api/admin/customer-info/hermes', { method: 'PUT', headers: sameOrigin, body: JSON.stringify({ endpoint_url: 'file:///etc/passwd' }) });
    expect((await putSettings(bad)).status).toBe(400);
    mocks.saveHermesSettings.mockResolvedValue(stored);
    const good = new Request('http://localhost/api/admin/customer-info/hermes', { method: 'PUT', headers: sameOrigin, body: JSON.stringify({ endpoint_url: stored.endpoint_url, token: stored.token }) });
    const response = await putSettings(good);
    expect(response.status).toBe(200);
    expect(mocks.saveHermesSettings).toHaveBeenCalledWith({ endpoint_url: stored.endpoint_url, token: stored.token }, 1);
    expect(JSON.stringify(await response.json())).not.toContain(stored.token);
  });
});

describe('POST draft-request', () => {
  const fetchMock = vi.fn();
  const call = () => requestDraft(
    new Request('http://localhost/api/admin/customer-info/products/12/draft-request', { method: 'POST', headers: sameOrigin }),
    { params: Promise.resolve({ id: '12' }) },
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    mocks.currentUser.mockResolvedValue(admin);
    mocks.reserveRateLimit.mockResolvedValue(true);
    mocks.getHermesSettings.mockResolvedValue(stored);
    mocks.getDraftRequestProduct.mockResolvedValue(product);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts the product to Hermes with the stored token and no redirects', async () => {
    fetchMock.mockResolvedValue(Response.json({ job_id: 'job-7' }, { status: 202 }));
    const response = await call();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ product_id: 12, job_id: 'job-7', source_count: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(stored.endpoint_url);
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual' });
    expect(init.headers.authorization).toBe(`Bearer ${stored.token}`);
    expect(JSON.parse(init.body).callback.url).toBe('http://localhost/api/admin/customer-info/ingest');
    expect(mocks.recordDraftRequest).toHaveBeenCalledWith(12, admin, expect.objectContaining({ outcome: 'accepted', job_id: 'job-7' }));
  });

  it('refuses when no endpoint is saved', async () => {
    mocks.getHermesSettings.mockResolvedValue({ ...stored, endpoint_url: null });
    expect((await call()).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports Hermes failures without echoing the response body', async () => {
    fetchMock.mockResolvedValue(new Response('internal secret page', { status: 500 }));
    const response = await call();
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toContain('hermes_rejected');
    expect(text).not.toContain('internal secret page');

    fetchMock.mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    expect(await (await call()).json()).toMatchObject({ error: 'hermes_timeout' });
  });

  it('is admin only and refuses private or unknown products', async () => {
    mocks.getDraftRequestProduct.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    mocks.currentUser.mockResolvedValue({ ...admin, role: 'user' });
    expect((await call()).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
