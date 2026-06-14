import { currentUser, requireUserResponse } from '@/lib/auth';
import { createQuickProduct, listProductsByCategory, listSearchableProducts, logSale } from '@/lib/sugi-db';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const url = new URL(req.url);
  const search = url.searchParams.get('q');
  if (search !== null) {
    return Response.json(await listSearchableProducts(user.id, search));
  }
  const category = url.searchParams.get('category') ?? 'その他';
  return Response.json(await listProductsByCategory(user.id, category));
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const body = await req.json().catch(() => null);
  const product = await createQuickProduct({
    userId: user.id,
    productName: String(body?.product_name ?? body?.productName ?? ''),
    pointValue: Number(body?.point_value ?? body?.pointValue),
  });
  if (!product) return Response.json({ error: 'invalid_product' }, { status: 400 });
  if (body?.log === true) {
    const sale = await logSale(user.id, product.id, 1);
    if (!sale) return Response.json({ error: 'could_not_log', product }, { status: 400 });
    return Response.json({ product, sale });
  }
  return Response.json({ product });
}
