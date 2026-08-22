import { Pool } from 'pg';
import { requireDatabaseUrl, runtimeDatabasePoolOptions } from './database-url';

const connectionString = requireDatabaseUrl();

declare global {
  // eslint-disable-next-line no-var
  var sugiSalePool: Pool | undefined;
}

export const pool = globalThis.sugiSalePool ?? new Pool(runtimeDatabasePoolOptions(connectionString));

if (process.env.NODE_ENV !== 'production') {
  globalThis.sugiSalePool = pool;
}

export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | null> {
  const result = await pool.query(text, params);
  return (result.rows[0] as T | undefined) ?? null;
}
