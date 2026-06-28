import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionToken, verifySessionToken } from '../lib/session-token';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Sugi auth/security regressions from beta test', () => {
  it('rejects expired signed session tokens', () => {
    const payload = Buffer.from(JSON.stringify({
      id: 1,
      username: 'hein',
      displayName: 'Hein',
      role: 'admin',
      iat: Math.floor(Date.now() / 1000) - 120,
      exp: Math.floor(Date.now() / 1000) - 60,
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', 'secret').update(payload).digest('base64url');
    const expiredToken = `${payload}.${signature}`;

    expect(verifySessionToken(expiredToken, 'secret')).toBeNull();
  });

  it('creates session tokens with exp and iat claims', () => {
    const token = createSessionToken({ id: 1, username: 'hein', displayName: 'Hein', role: 'admin' }, 'secret');
    const [payload] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

    expect(decoded.iat).toEqual(expect.any(Number));
    expect(decoded.exp).toEqual(expect.any(Number));
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
  });

  it('currentUser revalidates signed cookie claims against live sugi_users DB state', () => {
    const auth = source('lib/auth.ts');

    expect(auth).toContain('getSessionUserFromClaims');
    expect(auth).toContain('FROM sugi_users');
    expect(auth).toContain('is_active = TRUE');
    expect(auth).not.toContain('return verifySessionToken(token, sessionSecret());');
  });

  it('login path performs bcrypt dummy comparison for missing users to close timing oracle', () => {
    const auth = source('lib/auth.ts');

    expect(auth).toContain('DUMMY_PIN_HASH');
    expect(auth).toContain('await bcrypt.compare(pin, row?.pin_hash ?? DUMMY_PIN_HASH)');
  });

  it('login enforces 6+ digit numeric PINs', () => {
    const auth = source('lib/auth.ts');
    const loginRoute = source('app/api/auth/login/route.ts');

    expect(auth + loginRoute).toMatch(/\^\\d\{6,\}\$/);
  });

  it('login rate limit does not trust user-supplied X-Forwarded-For directly', () => {
    const loginRoute = source('app/api/auth/login/route.ts');

    expect(loginRoute).not.toContain("req.headers.get('x-forwarded-for')");
    expect(loginRoute).toContain('TRUSTED_PROXY');
  });
});
