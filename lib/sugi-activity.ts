import { query } from './db';

export type AdminActivity = {
  id: string;
  created_at: string;
  user_id: number | null;
  username: string | null;
  display_name: string | null;
  action: string;
  summary: string;
  details: Record<string, unknown>;
};

export async function logActivity(input: {
  userId?: number | null;
  actorUserId?: number | null;
  action: string;
  summary?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `INSERT INTO sugi_activity_logs (user_id, actor_user_id, action, summary, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      input.userId ?? null,
      input.actorUserId ?? input.userId ?? null,
      input.action,
      input.summary ?? input.action,
      JSON.stringify(input.details ?? {}),
    ],
  );
}

export async function listAdminActivity(options: { userId?: number | null; limit?: number } = {}): Promise<AdminActivity[]> {
  const userId = Number.isFinite(Number(options.userId)) && Number(options.userId) > 0 ? Number(options.userId) : null;
  const limit = Math.max(1, Math.min(Number(options.limit) || 80, 200));
  const rows = await query<AdminActivity>(
    `WITH activity AS (
       SELECT
         ('sale:' || s.id)::text AS id,
         s.created_at,
         s.user_id,
         'sale_logged'::text AS action,
         (s.product_name || ' ×' || s.quantity || ' / ' || s.total_points || 'pt')::text AS summary,
         jsonb_build_object(
           'sale_id', s.id,
           'product_name', s.product_name,
           'quantity', s.quantity,
           'points_per_item', s.points_per_item,
           'total_points', s.total_points,
           'sold_date', s.sold_date
         ) AS details
       FROM sales_logs s
       WHERE ($1::bigint IS NULL OR s.user_id = $1::bigint)

       UNION ALL

       SELECT
         ('session-login:' || ss.jti)::text AS id,
         ss.created_at,
         ss.user_id,
         'login'::text AS action,
         'ログイン'::text AS summary,
         jsonb_build_object('session_jti', ss.jti, 'expires_at', ss.expires_at) AS details
       FROM sugi_sessions ss
       WHERE ($1::bigint IS NULL OR ss.user_id = $1::bigint)

       UNION ALL

       SELECT
         ('session-logout:' || ss.jti)::text AS id,
         ss.revoked_at AS created_at,
         ss.user_id,
         'logout'::text AS action,
         'ログアウト'::text AS summary,
         jsonb_build_object('session_jti', ss.jti) AS details
       FROM sugi_sessions ss
       WHERE ss.revoked_at IS NOT NULL
       AND ($1::bigint IS NULL OR ss.user_id = $1::bigint)

       UNION ALL

       SELECT
         ('audit:' || al.id)::text AS id,
         al.created_at,
         al.user_id,
         al.action,
         al.summary,
         al.details
       FROM sugi_activity_logs al
       WHERE ($1::bigint IS NULL OR al.user_id = $1::bigint OR al.actor_user_id = $1::bigint)
     )
     SELECT
       activity.id,
       activity.created_at::text,
       activity.user_id,
       u.username,
       u.display_name,
       activity.action,
       activity.summary,
       activity.details
     FROM activity
     LEFT JOIN sugi_users u ON u.id = activity.user_id
     ORDER BY activity.created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows.map((row) => ({
    ...row,
    user_id: row.user_id === null ? null : Number(row.user_id),
    details: row.details ?? {},
  }));
}
