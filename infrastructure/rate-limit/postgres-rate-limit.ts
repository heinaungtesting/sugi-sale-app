import { query, queryOne } from '@/lib/db';

type CounterRow = { request_count: number };

export async function reserveRateLimit(
  scope: string,
  subjectKey: string,
  windowMs: number,
  maximum: number,
): Promise<boolean> {
  const row = await queryOne<CounterRow>(`
    INSERT INTO sugi_rate_limits (
      scope, subject_key, request_count, window_started_at, expires_at
    ) VALUES ($1, $2, 1, now(), now() + ($3 * interval '1 millisecond'))
    ON CONFLICT (scope, subject_key) DO UPDATE SET
      request_count = CASE
        WHEN sugi_rate_limits.expires_at <= now() THEN 1
        ELSE sugi_rate_limits.request_count + 1
      END,
      window_started_at = CASE
        WHEN sugi_rate_limits.expires_at <= now() THEN now()
        ELSE sugi_rate_limits.window_started_at
      END,
      expires_at = CASE
        WHEN sugi_rate_limits.expires_at <= now() THEN now() + ($3 * interval '1 millisecond')
        ELSE sugi_rate_limits.expires_at
      END
    WHERE sugi_rate_limits.expires_at <= now()
       OR sugi_rate_limits.request_count < $4
    RETURNING request_count
  `, [scope, subjectKey, windowMs, maximum]);
  return Number(row?.request_count ?? maximum + 1) <= maximum;
}

export async function rateLimitCount(scope: string, subjectKey: string): Promise<number> {
  const row = await queryOne<CounterRow>(`
    SELECT CASE WHEN expires_at <= now() THEN 0 ELSE request_count END AS request_count
    FROM sugi_rate_limits
    WHERE scope = $1 AND subject_key = $2
  `, [scope, subjectKey]);
  return Number(row?.request_count ?? 0);
}

export async function releaseRateLimit(scope: string, subjectKey: string): Promise<void> {
  await query(`
    UPDATE sugi_rate_limits
    SET request_count = GREATEST(0, request_count - 1)
    WHERE scope = $1 AND subject_key = $2 AND expires_at > now()
  `, [scope, subjectKey]);
}

export async function clearRateLimit(scope: string, subjectKey: string): Promise<void> {
  await query('DELETE FROM sugi_rate_limits WHERE scope = $1 AND subject_key = $2', [scope, subjectKey]);
}
