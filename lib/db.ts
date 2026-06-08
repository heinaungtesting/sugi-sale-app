import { Pool } from 'pg';

const connectionString = process.env.SIGMA_RAG_PG_DSN ?? 'postgresql://sigma_rag@127.0.0.1:5433/sigma_rag';

declare global {
  // eslint-disable-next-line no-var
  var sugiSalePool: Pool | undefined;
}

export const pool = globalThis.sugiSalePool ?? new Pool({ connectionString, max: 5 });

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
