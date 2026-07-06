import { currentUser, requireUserResponse } from '@/lib/auth';
import { deleteProductForAdmin, listAdminProducts, requireAdmin, upsertProduct } from '@/lib/sugi-admin-db';
import { logActivity } from '@/lib/sugi-activity';
import { requireCsrf } from '@/lib/csrf';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const url = new URL(req.url);
  return Response.json(await listAdminProducts(url.searchParams.get('q') ?? ''));
}

export async function POST(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const b = await req.json();
  const point_value = Number(b.point_value ?? 0);
  const row = await upsertProduct({ id: b.id ? Number(b.id) : undefined, product_name: b.product_name, category: b.category ?? '', point_value, nicknames: b.nicknames, is_active: b.is_active !== false });
  await logActivity({ userId: user.id, actorUserId: user.id, action: b.id ? 'admin_product_point_updated' : 'admin_product_created', summary: b.id ? `商品点数更新: ${b.product_name} → ${point_value}pt` : `商品作成: ${b.product_name} → ${point_value}pt`, details: { product_id: Number((row as any)?.id ?? b.id), product_name: b.product_name, point_value, is_active: b.is_active !== false } });
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
  const result = await deleteProductForAdmin(id);
  await logActivity({ userId: user.id, actorUserId: user.id, action: 'admin_product_deleted', summary: `商品削除/停止: ${id}`, details: { product_id: id, result } });
  return Response.json(result);
}
