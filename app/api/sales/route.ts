import { currentUser, requireUserResponse } from '@/lib/auth';
import { logSale, validSaleDate } from '@/lib/sugi-db';

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const body = await req.json().catch(() => ({}));
  const productId = Number(body.product_id);
  const variantId = body.variant_id === undefined || body.variant_id === null ? null : Number(body.variant_id);
  const quantity = Number(body.quantity ?? 1);
  const soldDate = body.sold_date === undefined || body.sold_date === null || body.sold_date === '' ? null : String(body.sold_date);
  if (!Number.isInteger(productId) || productId <= 0) return Response.json({ error: 'invalid product_id' }, { status: 400 });
  if (variantId !== null && (!Number.isInteger(variantId) || variantId <= 0)) return Response.json({ error: 'invalid variant_id' }, { status: 400 });
  if (soldDate !== null && !validSaleDate(soldDate)) return Response.json({ error: 'invalid sold_date' }, { status: 400 });
  const sale = await logSale(user.id, productId, quantity, variantId, soldDate);
  if (!sale) return Response.json({ error: 'product not found' }, { status: 404 });
  return Response.json(sale);
}
