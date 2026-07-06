import { currentUser, requireUserResponse } from '@/lib/auth';
import { createSugiUser, deleteSugiUserForAdmin, listAdminUsers, requireAdmin, updateSugiUser } from '@/lib/sugi-admin-db';
import { logActivity } from '@/lib/sugi-activity';
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
  const targetUserId = id || Number((row as any)?.id ?? 0) || null;
  await logActivity({ userId: targetUserId, actorUserId: user.id, action: id ? 'admin_user_updated' : 'admin_user_created', summary: id ? `ユーザー更新: ${b.display_name}` : `ユーザー作成: ${b.display_name}`, details: { username: b.username, role: b.role, is_active: b.is_active !== false } });
  return Response.json(row);
}

export async function DELETE(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) return Response.json({ error: 'invalid_id' }, { status: 400 });
  const result = await deleteSugiUserForAdmin(id, user.id);
  await logActivity({ userId: id, actorUserId: user.id, action: 'admin_user_deleted', summary: `ユーザー削除/停止: ${id}`, details: result as any });
  return Response.json(result, { status: result.reason ? 400 : 200 });
}
