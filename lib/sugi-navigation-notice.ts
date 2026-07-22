import { query, queryOne } from './db';

export async function shouldShowNavigationPrompt(userId: number): Promise<boolean> {
  const row = await queryOne<{ should_show: boolean }>(
    'SELECT navigation_v9_prompt_seen_at IS NULL AS should_show FROM sugi_users WHERE id = $1',
    [userId],
  );
  return row?.should_show ?? false;
}

export async function markNavigationPromptSeen(userId: number): Promise<void> {
  await query(
    'UPDATE sugi_users SET navigation_v9_prompt_seen_at = COALESCE(navigation_v9_prompt_seen_at, now()) WHERE id = $1',
    [userId],
  );
}
