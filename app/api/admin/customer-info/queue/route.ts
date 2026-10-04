import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireAdmin } from '@/lib/sugi-admin-db';
import { listReviewQueue } from '@/repositories/customer-info-repository';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const status = new URL(req.url).searchParams.get('status');
  const statuses = status === 'published' ? ['published' as const] : status === 'rejected' ? ['rejected' as const] : ['draft' as const, 'stale' as const];
  return Response.json(await listReviewQueue(statuses));
}
