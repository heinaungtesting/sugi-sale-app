import { describe, expect, it } from 'vitest';
import { createSessionToken, verifySessionToken } from '../lib/session-token';

describe('session token', () => {
  it('round-trips signed user session payloads', () => {
    const token = createSessionToken({ id: 1, username: 'hein', displayName: 'Hein', role: 'admin' }, 'secret');
    expect(verifySessionToken(token, 'secret')).toEqual({ id: 1, username: 'hein', displayName: 'Hein', role: 'admin' });
  });

  it('rejects tampered tokens', () => {
    const token = createSessionToken({ id: 1, username: 'hein', displayName: 'Hein', role: 'admin' }, 'secret');
    const [payload, signature] = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ id: 2, username: 'staff', displayName: 'Staff', role: 'user' })).toString('base64url');
    expect(verifySessionToken(`${tamperedPayload}.${signature}`, 'secret')).toBeNull();
  });
});
