import { createHash, timingSafeEqual } from 'node:crypto';

const MIN_TOKEN_LENGTH = 32;

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Bearer-token check for machine callers such as Hermes. Fails closed when the
 * token is unset or too short, and compares digests in constant time.
 */
export function verifyServiceToken(req: Request, expected: string | undefined): boolean {
  if (!expected || expected.length < MIN_TOKEN_LENGTH) return false;
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/.exec(header);
  if (!match) return false;
  return timingSafeEqual(digest(match[1]), digest(expected));
}
