import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireAdmin } from '@/lib/sugi-admin-db';
import { listAdminActivity } from '@/lib/sugi-activity';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const url = new URL(req.url);
  const userIdParam = url.searchParams.get('user_id');
  const limitParam = url.searchParams.get('limit');
  const userId = userIdParam ? Number(userIdParam) : null;
  const limit = limitParam ? Number(limitParam) : 80;
  return Response.json(await listAdminActivity({ userId, limit }));
}
