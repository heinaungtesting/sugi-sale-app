import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireCsrf } from '@/lib/csrf';
import { requireAdmin } from '@/lib/sugi-admin-db';
import { FEEDBACK_STATUSES, listAdminFeedback, updateFeedbackStatus, type FeedbackStatus } from '@/lib/sugi-feedback';

export async function GET() {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });
  return Response.json(await listAdminFeedback());
}

export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  const status = String(body.status ?? '') as FeedbackStatus;
  if (!Number.isInteger(id) || id <= 0 || !FEEDBACK_STATUSES.includes(status)) {
    return Response.json({ error: 'invalid feedback update' }, { status: 400 });
  }
  const updated = await updateFeedbackStatus(id, status);
  if (!updated) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(updated);
}
