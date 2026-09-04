import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { queryOne } from './db';
import { createSessionToken, verifySessionToken, type SessionClaims } from './session-token';
import { logActivity } from './sugi-activity';
import type { SessionUser } from './sugi-domain';
import { describeDevice } from '../infrastructure/auth/device-description';
import { createSessionRecord, revokeSession } from '../repositories/session-repository';

export const SESSION_COOKIE = 'sugi_session';
export const PIN_POLICY = /^\d{6,}$/;

// bcrypt hash for a non-secret dummy PIN. Keeps missing-user login timing close to real-user wrong-PIN timing.
const DUMMY_PIN_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8a8VIpyr6eL5N2E1LKDpi5E2f6QfCa';

function sessionSecret(): string {
  const secret = process.env.SUGI_SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('SUGI_SESSION_SECRET is required in production');
  }
  return secret || 'dev-change-this-sugi-secret';
}

function secureSessionCookie(): boolean {
  if (process.env.SUGI_COOKIE_SECURE === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

export function sessionTokenForUser(user: SessionUser): string {
  return createSessionToken(user, sessionSecret());
}

type UserRow = {
  id: number;
  username: string;
  display_name: string;
  pin_hash: string;
  role: 'admin' | 'user';
};

function rowToSessionUser(row: UserRow): SessionUser {
  return { id: Number(row.id), username: row.username, displayName: row.display_name, role: row.role };
}

export async function loginUser(username: string, pin: string): Promise<SessionUser | null> {
  const normalizedUsername = username.trim().toLowerCase();
  if (!PIN_POLICY.test(pin)) {
    await bcrypt.compare(pin, DUMMY_PIN_HASH);
    return null;
  }
  const row = await queryOne<UserRow>(
    'SELECT id, username, display_name, pin_hash, role FROM sugi_users WHERE lower(username) = $1 AND is_active = TRUE',
    [normalizedUsername]
  );
  const ok = await bcrypt.compare(pin, row?.pin_hash ?? DUMMY_PIN_HASH);
  if (!row || !ok) return null;
  return rowToSessionUser(row);
}

export async function setSession(user: SessionUser, request?: Request): Promise<void> {
  const token = createSessionToken(user, sessionSecret());
  const claims = verifySessionToken(token, sessionSecret());
  if (!claims) throw new Error('created invalid session token');
  const userAgent = request?.headers.get('user-agent') ?? '';
  await createSessionRecord({
    jti: claims.jti,
    userId: claims.id,
    expiresAtEpoch: claims.exp,
    userAgent,
    deviceLabel: describeDevice(userAgent),
  });
  void logActivity({ userId: user.id, actorUserId: user.id, action: 'login', summary: 'ログイン', details: { username: user.username } }).catch(() => {});
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureSessionCookie(),
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const claims = verifySessionToken(token, sessionSecret());
  if (claims) {
  await revokeSession(claims.jti);
  void logActivity({ userId: claims.id, actorUserId: claims.id, action: 'logout', summary: 'ログアウト', details: { jti: claims.jti } }).catch(() => {});
  }
  jar.delete(SESSION_COOKIE);
}

export async function getSessionUserFromClaims(claims: SessionClaims): Promise<SessionUser | null> {
  const row = await queryOne<UserRow>(
    `WITH valid_session AS MATERIALIZED (
       SELECT user_id
       FROM sugi_sessions
       WHERE user_id = $1
         AND jti = $2
         AND revoked_at IS NULL
         AND expires_at > now()
     ), touched AS (
       UPDATE sugi_sessions
       SET last_used_at = now()
       WHERE user_id = $1
         AND jti = $2
         AND last_used_at < now() - interval '5 minutes'
         AND EXISTS (SELECT 1 FROM valid_session)
       RETURNING user_id
     )
     SELECT u.id, u.username, u.display_name, u.role, u.pin_hash
     FROM sugi_users u
     JOIN valid_session s ON s.user_id = u.id
     LEFT JOIN touched ON touched.user_id = s.user_id
     WHERE u.is_active = TRUE`,
    [claims.id, claims.jti]
  );
  if (!row) return null;
  return rowToSessionUser(row);
}

export async function currentSessionClaims(): Promise<SessionClaims | null> {
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value, sessionSecret());
}

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const claims = verifySessionToken(token, sessionSecret());
  if (!claims) return null;
  return getSessionUserFromClaims(claims);
}

export function requireUserResponse(): Response {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}
