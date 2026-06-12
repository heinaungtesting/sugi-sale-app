import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

type HealthRow = { ok: number };

export async function GET() {
  try {
    const db = await queryOne<HealthRow>('SELECT 1 AS ok');
    if (db?.ok !== 1) {
      return Response.json({ ok: false, database: 'unexpected-result' }, { status: 503 });
    }
    return Response.json({ ok: true, database: 'ok' });
  } catch {
    return Response.json({ ok: false, database: 'unreachable' }, { status: 503 });
  }
}
