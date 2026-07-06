import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireCsrf } from '@/lib/csrf';
import { requireAdmin, stageNextMonthPointCampaignFromJson } from '@/lib/sugi-admin-db';

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

  const result = await stageNextMonthPointCampaignFromJson(payload);
  const errors = result.results.filter((item: any) => item.kind === 'error');
  return Response.json({ ok: errors.length === 0, ...result }, { status: errors.length ? 207 : 200 });
}
