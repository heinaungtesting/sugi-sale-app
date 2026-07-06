import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireAdmin, upsertProductVariant } from '@/lib/sugi-admin-db';
import { requireCsrf } from '@/lib/csrf';
import { logActivity } from '@/lib/sugi-activity';

export async function POST(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  if (!(await requireAdmin(user))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const b = await req.json();
  const point_value = Number(b.point_value ?? 0);
  const row = await upsertProductVariant({ id: b.id ? Number(b.id) : undefined, product_id: Number(b.product_id), variant_label: b.variant_label, display_shortcut: b.display_shortcut, unit_count: Number(b.unit_count ?? 1), point_value, nicknames: b.nicknames, is_active: b.is_active !== false });
  await logActivity({ userId: user.id, actorUserId: user.id, action: 'admin_variant_point_updated', summary: `バリアント点数更新: ${b.variant_label} → ${point_value}pt`, details: { product_id: Number(b.product_id), variant_id: Number((row as any)?.id ?? b.id), variant_label: b.variant_label, point_value, is_active: b.is_active !== false } });
  return Response.json(row);
}
