import { currentUser, requireUserResponse } from '@/lib/auth';
import { createSugiUser, listAdminUsers, requireAdmin, updateSugiUser } from '@/lib/sugi-admin-db';
import { requireCsrf } from '@/lib/csrf';

export async function GET() {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });
  return Response.json(await listAdminUsers());
}

export async function POST(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const b = await req.json();
  const id = Number(b.id);
  const row = id
    ? await updateSugiUser({ id, username: b.username, display_name: b.display_name, pin: b.pin || undefined, role: b.role, is_active: b.is_active !== false })
    : await createSugiUser({ username: b.username, display_name: b.display_name, pin: b.pin, role: b.role });
  return Response.json(row);
}
