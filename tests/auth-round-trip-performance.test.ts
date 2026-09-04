import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  touchSession: vi.fn(),
}));

vi.mock('../lib/db', () => ({ queryOne: mocks.queryOne }));
vi.mock('../repositories/session-repository', () => ({
  createSessionRecord: vi.fn(),
  revokeSession: vi.fn(),
  touchSession: mocks.touchSession,
}));

import { getSessionUserFromClaims } from '../lib/auth';

describe('authenticated request database round trips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates and conditionally touches a session in one query', async () => {
    mocks.queryOne.mockResolvedValue({
      id: 7,
      username: 'staff',
      display_name: 'Staff',
      pin_hash: 'unused',
      role: 'user',
    });

    const user = await getSessionUserFromClaims({
      id: 7,
      jti: 'session-id',
      username: 'staff',
      displayName: 'Staff',
      role: 'user',
      iat: 1,
      exp: 2,
    });

    expect(user).toEqual({ id: 7, username: 'staff', displayName: 'Staff', role: 'user' });
    expect(mocks.queryOne).toHaveBeenCalledTimes(1);
    expect(String(mocks.queryOne.mock.calls[0]?.[0])).toContain('expires_at > now()');
    expect(mocks.touchSession).not.toHaveBeenCalled();
  });
});
