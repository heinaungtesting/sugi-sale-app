import { queryOne } from '@/lib/db';
import { getBuildInfo } from '@/lib/build-info';

export const dynamic = 'force-dynamic';

type HealthRow = { ok: number };

export async function GET() {
  const build = getBuildInfo();
  try {
    const db = await queryOne<HealthRow>('SELECT 1 AS ok');
    if (db?.ok !== 1) {
      return Response.json({ ok: false, database: 'unexpected-result', ...build }, { status: 503 });
    }
    return Response.json({ ok: true, database: 'ok', ...build });
  } catch {
    return Response.json({ ok: false, database: 'unreachable', ...build }, { status: 503 });
  }
}
