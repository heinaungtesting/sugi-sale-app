import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionToken, verifySessionToken } from '../lib/session-token';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('logout session revocation regression', () => {
  it('session tokens carry a unique jti claim for server-side revocation', () => {
    const first = verifySessionToken(
      createSessionToken({ id: 1, username: 'hein', displayName: 'Hein', role: 'admin' }, 'secret'),
      'secret'
    );
    const second = verifySessionToken(
      createSessionToken({ id: 1, username: 'hein', displayName: 'Hein', role: 'admin' }, 'secret'),
      'secret'
    );

    expect(first?.jti).toEqual(expect.any(String));
    expect(first?.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(second?.jti).toEqual(expect.any(String));
    expect(second?.jti).not.toBe(first?.jti);
  });

  it('persists issued session jtis and rejects revoked sessions in currentUser', () => {
    const auth = source('lib/auth.ts');

    expect(auth).toContain('createSessionRecord');
    expect(auth).toContain('revokeSession');
    expect(auth).toContain('claims.jti');
    expect(auth).toContain('FROM sugi_sessions');
    expect(auth).toContain('JOIN valid_session');
    expect(auth).toContain('revoked_at IS NULL');
  });

  it('logout revokes the presented session before clearing the browser cookie', () => {
    const logoutRoute = source('app/api/auth/logout/route.ts');
    const auth = source('lib/auth.ts');

    expect(logoutRoute).toContain('clearSession');
    expect(auth).toContain('await revokeSession(claims.jti)');
    expect(auth.indexOf('await revokeSession(claims.jti)')).toBeLessThan(auth.indexOf('jar.delete(SESSION_COOKIE)'));
  });

  it('migration creates a sugi_sessions table keyed by jti', () => {
    const migrate = source('scripts/migrate.ts');

    expect(migrate).toContain('CREATE TABLE IF NOT EXISTS sugi_sessions');
    expect(migrate).toContain('jti TEXT PRIMARY KEY');
    expect(migrate).toContain('revoked_at TIMESTAMPTZ');
    expect(migrate).toContain('idx_sugi_sessions_user_active');
  });
});
