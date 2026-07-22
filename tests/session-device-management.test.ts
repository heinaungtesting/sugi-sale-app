import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeDevice } from '../infrastructure/auth/device-description';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('active device and session lifecycle', () => {
  it('describes common devices without storing a second tracking identifier', () => {
    expect(describeDevice('Mozilla/5.0 (iPhone) AppleWebKit Safari/604.1')).toBe('iPhone · Safari');
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0) Chrome/126')).toBe('Windows · Chrome');
  });

  it('migrates session metadata and indexes last use', () => {
    const migration = source('scripts/migrate.ts');
    expect(migration).toContain('last_used_at TIMESTAMPTZ');
    expect(migration).toContain('user_agent TEXT');
    expect(migration).toContain('device_label TEXT');
    expect(migration).toContain('idx_sugi_sessions_user_last_used');
  });

  it('caps active sessions, cleans expiry, and supports targeted revocation', () => {
    const repository = source('repositories/session-repository.ts');
    expect(repository).toContain('MAX_ACTIVE_SESSIONS = 10');
    expect(repository).toContain('DELETE FROM sugi_sessions WHERE expires_at <= now()');
    expect(repository).toContain('revokeOwnedSession');
    expect(repository).toContain('revokeUserSessions');
    expect(repository).toContain("interval '5 minutes'");
  });

  it('revokes all sessions after a PIN change and exposes active-device controls', () => {
    expect(source('lib/sugi-admin-db.ts')).toMatch(/if \(input\.pin\)[\s\S]{0,700}revokeUserSessions\(input\.id\)/);
    const api = source('app/api/sessions/route.ts');
    expect(api).toContain("body.action === 'revoke_others'");
    expect(api).toContain('revokeOwnedSession');
    expect(source('components/ActiveDevicesClient.tsx')).toContain('他の端末をすべてログアウト');
    expect(source('components/AppHeader.tsx')).toContain('href="/sessions"');
  });
});
