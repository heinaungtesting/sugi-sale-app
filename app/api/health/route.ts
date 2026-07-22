import { queryOne } from '@/lib/db';
import { getBuildInfo } from '@/lib/build-info';
import { incrementMetric, observeMetric } from '@/infrastructure/observability/metrics';
import { logEvent } from '@/infrastructure/logging/structured-logger';

export const dynamic = 'force-dynamic';

type HealthRow = { ok: number };

export async function GET() {
  const started = performance.now();
  const build = getBuildInfo();
  try {
    const db = await queryOne<HealthRow>('SELECT 1 AS ok');
    if (db?.ok !== 1) {
      return Response.json({ ok: false, database: 'unexpected-result', ...build }, { status: 503 });
    }
    observeMetric('health.duration_ms', performance.now() - started);
    return Response.json({ ok: true, database: 'ok', ...build });
  } catch (error) {
    incrementMetric('database.connection_failure');
    logEvent('database_health_failed', { error: error instanceof Error ? error.name : 'unknown' }, 'error');
    return Response.json({ ok: false, database: 'unreachable', ...build }, { status: 503 });
  }
}
