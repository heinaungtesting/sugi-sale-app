import { currentUser, requireUserResponse } from '@/lib/auth';
import { logSale } from '@/lib/sugi-db';

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const body = await req.json().catch(() => ({}));
  const productId = Number(body.product_id);
  const quantity = Number(body.quantity ?? 1);
  if (!Number.isInteger(productId) || productId <= 0) return Response.json({ error: 'invalid product_id' }, { status: 400 });
  const sale = await logSale(user.id, productId, quantity);
  if (!sale) return Response.json({ error: 'product not found' }, { status: 404 });
  return Response.json(sale);
}
