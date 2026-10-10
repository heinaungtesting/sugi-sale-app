import { query, queryOne } from '@/lib/db';
import { HERMES_SETTINGS_KEY, type HermesSettingsInput } from '@/domain/customer-info/hermes';

type StoredHermes = { endpoint_url?: string | null; token?: string | null };

export type HermesSettings = { endpoint_url: string | null; token: string | null; updated_at: string | null; updated_by: string | null };

export async function getHermesSettings(): Promise<HermesSettings> {
  const row = await queryOne<{ value: StoredHermes; updated_at: Date | null; updated_by: string | null }>(
    `SELECT s.value, s.updated_at, u.display_name AS updated_by
     FROM app_settings s LEFT JOIN sugi_users u ON u.id = s.updated_by
     WHERE s.key = $1`,
    [HERMES_SETTINGS_KEY],
  );
  return {
    endpoint_url: row?.value.endpoint_url ?? null,
    token: row?.value.token ?? process.env.HERMES_API_TOKEN ?? null,
    updated_at: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    updated_by: row?.updated_by ?? null,
  };
}

/** What the browser may see: never the token itself. */
export function publicHermesSettings(settings: HermesSettings) {
  return { endpoint_url: settings.endpoint_url, token_set: Boolean(settings.token), updated_at: settings.updated_at, updated_by: settings.updated_by };
}

export async function saveHermesSettings(input: HermesSettingsInput, userId: number): Promise<HermesSettings> {
  const current = await queryOne<{ value: StoredHermes }>('SELECT value FROM app_settings WHERE key = $1', [HERMES_SETTINGS_KEY]);
  const token = input.token === undefined ? current?.value.token ?? null : input.token;
  await query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [HERMES_SETTINGS_KEY, JSON.stringify({ endpoint_url: input.endpoint_url, token }), userId],
  );
  return getHermesSettings();
}
