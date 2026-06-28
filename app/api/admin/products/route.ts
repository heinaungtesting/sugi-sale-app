import { currentUser, requireUserResponse } from '@/lib/auth';
import { listAdminProducts, requireAdmin, upsertProduct } from '@/lib/sugi-admin-db';
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
  const row = await upsertProduct({ id: b.id ? Number(b.id) : undefined, product_name: b.product_name, category: b.category ?? '', point_value: Number(b.point_value ?? 0), nicknames: b.nicknames, is_active: b.is_active !== false });
  return Response.json(row);
}
