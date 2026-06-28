import { currentUser, requireUserResponse } from '@/lib/auth';
import { importProductsFromJson, requireAdmin } from '@/lib/sugi-admin-db';
import { requireCsrf } from '@/lib/csrf';

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

  const results = await importProductsFromJson(payload);
  const errors = results.filter((result: any) => result.kind === 'error');
  return Response.json({ ok: errors.length === 0, count: results.length, results }, { status: errors.length ? 207 : 200 });
}
