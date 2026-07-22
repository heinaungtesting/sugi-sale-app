import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireCsrf } from '@/lib/csrf';
import { requireAdmin } from '@/lib/sugi-admin-db';
import { campaignService } from '@/domain/campaigns/campaign-service';
import { incrementMetric } from '@/infrastructure/observability/metrics';
import { logEvent, requestId } from '@/infrastructure/logging/structured-logger';

export async function POST(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const result = await campaignService.stageNextMonth(payload);
  const errors = result.results.filter((item: any) => item.kind === 'error');
  incrementMetric('campaign.imported');
  if (errors.length) incrementMetric('campaign.import_mismatch', errors.length);
  logEvent('campaign_imported', { requestId: requestId(req), userId: user.id, resultCount: result.count, mismatchCount: errors.length }, errors.length ? 'warn' : 'info');
  return Response.json({ ok: errors.length === 0, ...result }, { status: errors.length ? 207 : 200 });
}
