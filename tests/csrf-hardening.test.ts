import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyCsrfRequest } from '../lib/csrf';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const UNSAFE_ROUTES = [
  'app/api/auth/logout/route.ts',
  'app/api/sales/route.ts',
  'app/api/sales/[id]/route.ts',
  'app/api/sales/latest/route.ts',
  'app/api/sales/today/product/route.ts',
  'app/api/sales/status/route.ts',
  'app/api/products/route.ts',
  'app/api/admin/import/route.ts',
  'app/api/admin/points/route.ts',
  'app/api/admin/products/route.ts',
  'app/api/admin/users/route.ts',
  'app/api/admin/variants/route.ts',
];

describe('tokenless same-origin mutation guard', () => {
  it('accepts an allowed same-origin request without CSRF cookies or headers', () => {
    const request = new Request('http://localhost/api/sales', {
      method: 'POST',
      headers: { host: 'localhost', origin: 'http://localhost' },
    });
    expect(verifyCsrfRequest(request)).toBe(true);
  });

  it('accepts the public HTTPS origin behind the internal Tailscale HTTP proxy', () => {
    const request = new Request('http://100.111.161.73:8080/api/products', {
      method: 'POST',
      headers: {
        host: 'herme-agents.tail71ac56.ts.net',
        origin: 'https://herme-agents.tail71ac56.ts.net',
      },
    });
    expect(verifyCsrfRequest(request)).toBe(true);
  });

  it('rejects cross-origin and unlisted-host requests', () => {
    const crossOrigin = new Request('http://localhost/api/sales', {
      method: 'POST',
      headers: { host: 'localhost', origin: 'https://evil.example' },
    });
    const badHost = new Request('https://evil.example/api/sales', {
      method: 'POST',
      headers: { host: 'evil.example', origin: 'https://evil.example' },
    });
    expect(verifyCsrfRequest(crossOrigin)).toBe(false);
    expect(verifyCsrfRequest(badHost)).toBe(false);
  });

  it('contains no signed double-submit token machinery', () => {
    const server = source('lib/csrf.ts');
    const client = source('lib/csrf-client.ts');
    const endpoint = source('app/api/auth/csrf/route.ts');
    const login = source('app/api/auth/login/route.ts');
    expect(server).not.toContain('createHmac');
    expect(server).not.toContain('sugi_csrf');
    expect(server).not.toContain('x-csrf-token');
    expect(server).not.toContain('setCsrfCookie');
    expect(client).not.toContain('/api/auth/csrf');
    expect(client).not.toContain('x-csrf-token');
    expect(endpoint).not.toContain('setCsrfCookie');
    expect(endpoint).not.toContain('Set-Cookie');
    expect(login).not.toContain('setCsrfCookie');
  });

  it('keeps a lightweight same-origin guard on authenticated mutation routes', () => {
    for (const path of UNSAFE_ROUTES) {
      const text = source(path);
      expect(text, `${path} must keep the same-origin guard`).toContain('requireCsrf(req)');
    }
  });

  it('keeps explicit browser submit handlers for admin CRUD', () => {
    const adminClient = source('components/AdminClient.tsx');
    expect(adminClient).toContain('submitAdminForm');
    expect(adminClient).toContain('event.preventDefault()');
    expect(adminClient).toContain('onSubmit={(event) => submitAdminForm(event, saveProduct)}');
    expect(adminClient).toContain('onSubmit={(event) => submitAdminForm(event, saveVariant)}');
    expect(adminClient).toContain('onSubmit={(event) => submitAdminForm(event, saveUser)}');
  });
});
