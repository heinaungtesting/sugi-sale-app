import crypto from 'node:crypto';
import type { SessionUser } from './sugi-domain';

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken(user: SessionUser, secret: string): string {
  const payload = base64url(JSON.stringify(user));
  const signature = sign(payload, secret);
  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string | undefined | null, secret: string): SessionUser | null {
  if (!token || !secret) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = sign(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionUser;
    if (!parsed.id || !parsed.username || !parsed.displayName || !parsed.role) return null;
    return parsed;
  } catch {
    return null;
  }
}
