import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireAdmin, bulkSetPoints } from '@/lib/sugi-admin-db';
import { requireCsrf } from '@/lib/csrf';

export async function POST(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json();
  const updates = Array.isArray(body?.updates) ? body.updates : [];
  if (updates.length === 0) {
    return Response.json({ error: 'no updates provided' }, { status: 400 });
  }

  // Normalize: support {query, point_value} or {name, pts} etc.
  const normalized = updates.map((u: any) => ({
    query: u.query ?? u.name ?? u.product ?? '',
    point_value: Number(u.point_value ?? u.pts ?? u.points ?? 0),
  })).filter((u: any) => u.query);

  const results = await bulkSetPoints(normalized);
  return Response.json({ results, count: results.length });
}
