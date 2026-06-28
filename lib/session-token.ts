import crypto from 'node:crypto';
import type { SessionUser } from './sugi-domain';

export type SessionClaims = SessionUser & {
  jti: string;
  iat: number;
  exp: number;
};

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken(user: SessionUser, secret: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = {
    jti: crypto.randomUUID(),
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    iat: now,
    exp: now + ttlSeconds,
  };
  const payload = base64url(JSON.stringify(claims));
  const signature = sign(payload, secret);
  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string | undefined | null, secret: string): SessionClaims | null {
  if (!token || !secret) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = sign(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<SessionClaims>;
    if (!parsed.id || !parsed.username || !parsed.displayName || !parsed.role || !parsed.jti) return null;
    if (parsed.role !== 'admin' && parsed.role !== 'user') return null;
    if (typeof parsed.jti !== 'string') return null;
    if (typeof parsed.iat !== 'number' || typeof parsed.exp !== 'number') return null;
    if (!Number.isInteger(parsed.iat) || !Number.isInteger(parsed.exp)) return null;
    const iat = parsed.iat;
    const exp = parsed.exp;
    if (exp <= Math.floor(Date.now() / 1000)) return null;
    return {
      jti: parsed.jti,
      id: Number(parsed.id),
      username: String(parsed.username),
      displayName: String(parsed.displayName),
      role: parsed.role,
      iat,
      exp,
    };
  } catch {
    return null;
  }
}
