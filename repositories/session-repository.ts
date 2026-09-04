import { pool, query, queryOne } from '../infrastructure/postgres/client';

export type SessionDevice = {
  jti: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  device_label: string;
  user_agent: string;
  current: boolean;
};

const MAX_ACTIVE_SESSIONS = 10;

export async function cleanupExpiredSessions(): Promise<number> {
  const rows = await query<{ jti: string }>('DELETE FROM sugi_sessions WHERE expires_at <= now() RETURNING jti');
  return rows.length;
}

export async function createSessionRecord(input: {
  jti: string;
  userId: number;
  expiresAtEpoch: number;
  userAgent: string;
  deviceLabel: string;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM sugi_sessions WHERE expires_at <= now()');
    await client.query(
      `WITH ranked AS (
         SELECT jti, row_number() OVER (ORDER BY last_used_at DESC, created_at DESC) AS rn
         FROM sugi_sessions
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       )
       UPDATE sugi_sessions SET revoked_at = now()
       WHERE jti IN (SELECT jti FROM ranked WHERE rn >= $2)`,
      [input.userId, MAX_ACTIVE_SESSIONS],
    );
    await client.query(
      `INSERT INTO sugi_sessions (jti, user_id, expires_at, last_used_at, user_agent, device_label)
       VALUES ($1, $2, to_timestamp($3), now(), $4, $5)
       ON CONFLICT (jti) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           expires_at = EXCLUDED.expires_at,
           revoked_at = NULL,
           last_used_at = now(),
           user_agent = EXCLUDED.user_agent,
           device_label = EXCLUDED.device_label`,
      [input.jti, input.userId, input.expiresAtEpoch, input.userAgent.slice(0, 500), input.deviceLabel.slice(0, 120)],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeSession(jti: string): Promise<void> {
  await query('UPDATE sugi_sessions SET revoked_at = now() WHERE jti = $1', [jti]);
}

export async function revokeUserSessions(userId: number, exceptJti?: string): Promise<number> {
  const rows = await query<{ jti: string }>(
    `UPDATE sugi_sessions SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR jti <> $2)
     RETURNING jti`,
    [userId, exceptJti ?? null],
  );
  return rows.length;
}

export async function revokeOwnedSession(userId: number, jti: string): Promise<boolean> {
  const row = await queryOne<{ jti: string }>(
    `UPDATE sugi_sessions SET revoked_at = now()
     WHERE user_id = $1 AND jti = $2 AND revoked_at IS NULL RETURNING jti`,
    [userId, jti],
  );
  return Boolean(row);
}

export async function listUserSessions(userId: number, currentJti: string): Promise<SessionDevice[]> {
  await cleanupExpiredSessions();
  const rows = await query<Omit<SessionDevice, 'current'>>(
    `SELECT jti, created_at::text, last_used_at::text, expires_at::text,
            COALESCE(device_label, 'Unknown device') AS device_label,
            COALESCE(user_agent, '') AS user_agent
     FROM sugi_sessions
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
     ORDER BY last_used_at DESC, created_at DESC`,
    [userId],
  );
  return rows.map((row) => ({ ...row, current: row.jti === currentJti }));
}
