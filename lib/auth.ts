import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { queryOne } from './db';
import { createSessionToken, verifySessionToken } from './session-token';
import type { SessionUser } from './sugi-domain';

export const SESSION_COOKIE = 'sugi_session';

function sessionSecret(): string {
  return process.env.SUGI_SESSION_SECRET || 'dev-change-this-sugi-secret';
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

export async function loginUser(username: string, pin: string): Promise<SessionUser | null> {
  const normalizedUsername = username.trim().toLowerCase();
  const row = await queryOne<UserRow>(
    'SELECT id, username, display_name, pin_hash, role FROM sugi_users WHERE lower(username) = $1 AND is_active = TRUE',
    [normalizedUsername]
  );
  if (!row) return null;
  const ok = await bcrypt.compare(pin, row.pin_hash);
  if (!ok) return null;
  return { id: Number(row.id), username: row.username, displayName: row.display_name, role: row.role };
}

export async function setSession(user: SessionUser): Promise<void> {
  const token = createSessionToken(user, sessionSecret());
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return verifySessionToken(token, sessionSecret());
}

export function requireUserResponse(): Response {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}
