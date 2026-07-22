import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireAdmin } from '@/lib/sugi-admin-db';
import { metricsSnapshot } from '@/infrastructure/observability/metrics';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });
  return Response.json(metricsSnapshot());
}
