import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCsrfToken, verifyCsrfRequest } from '../lib/csrf';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const UNSAFE_ROUTES = [
  'app/api/auth/logout/route.ts',
  'app/api/products/route.ts',
  'app/api/sales/route.ts',
  'app/api/sales/[id]/route.ts',
  'app/api/sales/latest/route.ts',
  'app/api/sales/today/product/route.ts',
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

  it('guards every authenticated state-changing route with requireCsrf', () => {
    for (const path of UNSAFE_ROUTES) {
      const text = source(path);
      expect(text, `${path} must import requireCsrf`).toContain('requireCsrf');
      expect(text, `${path} must call requireCsrf(req)`).toContain('requireCsrf(req)');
    }
  });

  it('client state-changing fetches use csrfFetch', () => {
    for (const path of [
      'components/AppHeader.tsx',
      'components/SearchProductLogger.tsx',
      'components/HomeShiftLoggerClient.tsx',
      'components/SalesCalendarClient.tsx',
      'components/AdminClient.tsx',
      'lib/sale-queue.ts',
    ]) {
      const text = source(path);
      expect(text, `${path} should use csrfFetch for mutations`).toContain('csrfFetch');
    }
  });

  it('login route issues a CSRF cookie for the logged-in browser', () => {
    const loginRoute = source('app/api/auth/login/route.ts');
    expect(loginRoute).toContain('setCsrfCookie');
  });
});
