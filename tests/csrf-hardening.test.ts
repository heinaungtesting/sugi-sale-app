import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCsrfToken, verifyCsrfRequest } from '../lib/csrf';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const UNSAFE_ROUTES = [
  'app/api/auth/logout/route.ts',
  'app/api/sales/route.ts',
  'app/api/sales/[id]/route.ts',
  'app/api/sales/latest/route.ts',
  'app/api/sales/today/product/route.ts',
  'app/api/products/route.ts',
  'app/api/admin/import/route.ts',
  'app/api/admin/points/route.ts',
  'app/api/admin/products/route.ts',
  'app/api/admin/users/route.ts',
  'app/api/admin/variants/route.ts',
];

describe('CSRF hardening', () => {
  it('uses signed double-submit CSRF tokens', () => {
    const token = createCsrfToken('secret');
    expect(token.split('.')).toHaveLength(2);

    const cookie = `sugi_csrf=${token}`;
    const request = new Request('http://localhost/api/sales', {
      method: 'POST',
      headers: {
        cookie,
        'x-csrf-token': token,
        origin: 'http://localhost',
      },
    });

    expect(verifyCsrfRequest(request, 'secret')).toBe(true);
  });

  it('accepts the public HTTPS origin when Next.js runs behind an internal HTTP reverse proxy', () => {
    const token = createCsrfToken('secret');
    const request = new Request('http://100.111.161.73:8080/api/feedback', {
      method: 'POST',
      headers: {
        cookie: `sugi_csrf=${token}`,
        'x-csrf-token': token,
        host: 'herme-agents.tail71ac56.ts.net',
        origin: 'https://herme-agents.tail71ac56.ts.net',
      },
    });
    expect(verifyCsrfRequest(request, 'secret')).toBe(true);
  });

  it('accepts a signed header token when a stale duplicate CSRF cookie is also present', () => {
    const staleToken = createCsrfToken('old-secret');
    const freshToken = createCsrfToken('secret');
    const request = new Request('http://localhost/api/products', {
      method: 'POST',
      headers: {
        cookie: `sugi_csrf=${staleToken}; sugi_csrf=${freshToken}`,
        'x-csrf-token': freshToken,
        origin: 'http://localhost',
      },
    });

    expect(verifyCsrfRequest(request, 'secret')).toBe(true);
  });

  it('rejects missing, mismatched, or cross-origin CSRF requests', () => {
    const token = createCsrfToken('secret');
    const missing = new Request('http://localhost/api/sales', { method: 'POST' });
    const mismatch = new Request('http://localhost/api/sales', {
      method: 'POST',
      headers: { cookie: `sugi_csrf=${token}`, 'x-csrf-token': createCsrfToken('secret'), origin: 'http://localhost' },
    });
    const crossOrigin = new Request('http://localhost/api/sales', {
      method: 'POST',
      headers: { cookie: `sugi_csrf=${token}`, 'x-csrf-token': token, origin: 'https://evil.example' },
    });

    expect(verifyCsrfRequest(missing, 'secret')).toBe(false);
    expect(verifyCsrfRequest(mismatch, 'secret')).toBe(false);
    expect(verifyCsrfRequest(crossOrigin, 'secret')).toBe(false);
  });

  it('guards authenticated state-changing routes with requireCsrf', () => {
    for (const path of UNSAFE_ROUTES) {
      const text = source(path);
      expect(text, `${path} must import requireCsrf`).toContain('requireCsrf');
      expect(text, `${path} must call requireCsrf(req)`).toContain('requireCsrf(req)');
    }
  });

  it('protects frontline sale routes with double-submit CSRF', () => {
    for (const path of [
      'app/api/sales/route.ts',
      'app/api/sales/[id]/route.ts',
      'app/api/sales/latest/route.ts',
      'app/api/sales/today/product/route.ts',
    ]) {
      const text = source(path);
      expect(text, `${path} must call requireCsrf`).toContain('requireCsrf(req)');
      expect(text, `${path} must still require a logged-in user`).toContain('currentUser()');
    }
    expect(source('domain/sales/sale-service.ts')).toContain('reserveSaleWrite(userId)');
    expect(source('domain/sales/sale-policy.ts')).toContain('isValidIdempotencyKey');
    const productsRoute = source('app/api/products/route.ts');
    const productPost = productsRoute.slice(productsRoute.indexOf('export async function POST'), productsRoute.indexOf('export async function PATCH'));
    const productPatch = productsRoute.slice(productsRoute.indexOf('export async function PATCH'));
    expect(productPost).toContain('isValidIdempotencyKey');
    expect(productPost).toContain('requireCsrf(req)');
    expect(productPatch).toContain('requireCsrf(req)');
  });

  it('frontline today-by-product undo uses Tokyo today, not database CURRENT_DATE', () => {
    const db = source('lib/sugi-db.ts');
    const fnStart = db.indexOf('export async function deleteTodaySaleByProduct');
    const fn = db.slice(fnStart, fnStart + 700);
    expect(fn).toContain('todaySaleDate()');
    expect(fn).not.toContain('CURRENT_DATE');
  });

  it('guarded client mutations use csrfFetch', () => {
    for (const path of [
      'components/AppHeader.tsx',
      'components/AdminClient.tsx',
    ]) {
      const text = source(path);
      expect(text, `${path} should use csrfFetch for guarded mutations`).toContain('csrfFetch');
    }
  });

  it('frontline sale clients use csrfFetch', () => {
    for (const path of [
      'components/HomeShiftLoggerClient.tsx',
      'components/SalesCalendarClient.tsx',
      'lib/sale-queue.ts',
    ]) {
      const text = source(path);
      expect(text, `${path} should use csrfFetch for frontline sale operations`).toContain('csrfFetch');
    }
    const logger = source('components/SearchProductLogger.tsx');
    expect(logger).toContain("csrfFetch('/api/products'");
    expect(source('components/HomeShiftLoggerClient.tsx')).toContain('csrfFetch(`/api/sales/${id}`');
    expect(source('components/SalesCalendarClient.tsx')).toContain('csrfFetch(`/api/sales/${id}`');
    expect(source('lib/sale-queue.ts')).toContain("csrfFetch('/api/sales'");
  });

  it('sales queue uses csrfFetch with automatic token refresh', () => {
    const text = source('lib/sale-queue.ts');
    expect(text).toContain('csrfFetch');
    expect(text).toContain("csrfFetch('/api/sales'");
  });

  it('login route issues a CSRF cookie for the logged-in browser', () => {
    const loginRoute = source('app/api/auth/login/route.ts');
    expect(loginRoute).toContain('setCsrfCookie');
  });

  it('admin CRUD forms use explicit submit handlers so CSRF fetch runs in the browser', () => {
    const adminClient = source('components/AdminClient.tsx');
    expect(adminClient).toContain('submitAdminForm');
    expect(adminClient).toContain('event.preventDefault()');
    expect(adminClient).toContain('csrfFetch');
    expect(adminClient).toContain('onSubmit={(event) => submitAdminForm(event, saveProduct)}');
    expect(adminClient).toContain('onSubmit={(event) => submitAdminForm(event, saveVariant)}');
    expect(adminClient).toContain('onSubmit={(event) => submitAdminForm(event, saveUser)}');
    expect(adminClient).not.toContain('action={saveProduct}');
    expect(adminClient).not.toContain('action={saveVariant}');
    expect(adminClient).not.toContain('action={saveUser}');
  });
});
