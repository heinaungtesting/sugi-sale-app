import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireAdmin, upsertProductVariant } from '@/lib/sugi-admin-db';
import { requireCsrf } from '@/lib/csrf';

export async function POST(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const b = await req.json();
  const row = await upsertProductVariant({ id: b.id ? Number(b.id) : undefined, product_id: Number(b.product_id), variant_label: b.variant_label, display_shortcut: b.display_shortcut, unit_count: Number(b.unit_count ?? 1), point_value: Number(b.point_value ?? 0), nicknames: b.nicknames, is_active: b.is_active !== false });
  return Response.json(row);
}
