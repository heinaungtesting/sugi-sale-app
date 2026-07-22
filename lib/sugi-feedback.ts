import { query, queryOne } from './db';
import type { AdminFeedback, FeedbackCategory, FeedbackStatus, UserFeedback } from './sugi-feedback-types';

export { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from './sugi-feedback-types';
export type { AdminFeedback, FeedbackCategory, FeedbackStatus, UserFeedback } from './sugi-feedback-types';

export async function shouldShowFeedbackPrompt(userId: number): Promise<boolean> {
  const row = await queryOne<{ should_show: boolean }>(
    'SELECT feedback_prompt_seen_at IS NULL AS should_show FROM sugi_users WHERE id = $1',
    [userId],
  );
  return row?.should_show ?? false;
}

export async function markFeedbackPromptSeen(userId: number): Promise<void> {
  await query(
    'UPDATE sugi_users SET feedback_prompt_seen_at = COALESCE(feedback_prompt_seen_at, now()) WHERE id = $1',
    [userId],
  );
}

export async function createFeedback(userId: number, category: FeedbackCategory, message: string): Promise<UserFeedback> {
  const row = await queryOne<UserFeedback>(
    `INSERT INTO sugi_feedback (user_id, category, message)
     VALUES ($1, $2, $3)
     RETURNING id::int, category, message, status, created_at::text`,
    [userId, category, message],
  );
  if (!row) throw new Error('feedback insert returned no row');
  return row;
}

export async function listOwnFeedback(userId: number, limit = 10): Promise<UserFeedback[]> {
  return query<UserFeedback>(
    `SELECT id::int, category, message, status, created_at::text
     FROM sugi_feedback
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
}

export async function feedbackCountSince(userId: number, since: Date): Promise<number> {
  const row = await queryOne<{ count: string }>(
    'SELECT count(*)::text AS count FROM sugi_feedback WHERE user_id = $1 AND created_at >= $2',
    [userId, since],
  );
  return Number(row?.count ?? 0);
}

export async function listAdminFeedback(limit = 100): Promise<AdminFeedback[]> {
  return query<AdminFeedback>(
    `SELECT f.id::int, f.user_id::int, u.username, u.display_name,
            f.category, f.message, f.status, f.created_at::text
     FROM sugi_feedback f
     JOIN sugi_users u ON u.id = f.user_id
     ORDER BY CASE f.status WHEN '未確認' THEN 0 WHEN '対応中' THEN 1 WHEN '確認済み' THEN 2 ELSE 3 END,
              f.created_at DESC
     LIMIT $1`,
    [limit],
  );
}

export async function updateFeedbackStatus(id: number, status: FeedbackStatus): Promise<AdminFeedback | null> {
  return queryOne<AdminFeedback>(
    `WITH updated AS (
       UPDATE sugi_feedback SET status = $2 WHERE id = $1
       RETURNING *
     )
     SELECT f.id::int, f.user_id::int, u.username, u.display_name,
            f.category, f.message, f.status, f.created_at::text
     FROM updated f
     JOIN sugi_users u ON u.id = f.user_id`,
    [id, status],
  );
}
