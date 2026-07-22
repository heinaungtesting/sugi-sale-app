import { currentUser, requireUserResponse } from '@/lib/auth';
import { deleteTodaySaleByProduct } from '@/lib/sugi-db';
import { requireCsrf } from '@/lib/csrf';

export async function DELETE(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const body = await req.json().catch(() => ({}));
  const productId = Number(body.product_id);
  if (!Number.isInteger(productId) || productId <= 0) return Response.json({ error: 'invalid product_id' }, { status: 400 });
  const deleted = await deleteTodaySaleByProduct(user.id, productId);
  if (!deleted) return Response.json({ error: 'nothing to delete' }, { status: 404 });
  return Response.json(deleted);
}
