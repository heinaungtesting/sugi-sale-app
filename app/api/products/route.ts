import { currentUser, requireUserResponse } from '@/lib/auth';
import { createQuickProduct, isValidIdempotencyKey, listProductsByCategory, listSearchableProducts, listVisibleProductParents, logSale, updateVisibleProductPoint } from '@/lib/sugi-db';
import { requireCsrf } from '@/lib/csrf';
import { logActivity } from '@/lib/sugi-activity';
import { logEvent, requestId } from '@/infrastructure/logging/structured-logger';
import { incrementMetric, observeMetric } from '@/infrastructure/observability/metrics';

export async function GET(req: Request) {
  const started = performance.now();
  const reqId = requestId(req);
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const url = new URL(req.url);
  if (url.searchParams.get('parents') === '1') {
    return Response.json(await listVisibleProductParents(user.id));
  }
  const search = url.searchParams.get('q');
  if (search !== null) {
    try {
      const products = await listSearchableProducts(user.id, search);
      const durationMs = performance.now() - started;
      incrementMetric('search.success');
      observeMetric('search.duration_ms', durationMs);
      logEvent('product_search', { requestId: reqId, userId: user.id, durationMs: Math.round(durationMs), resultCount: products.length });
      return Response.json(products);
    } catch (error) {
      incrementMetric('search.failed');
      logEvent('product_search_failed', { requestId: reqId, userId: user.id, error: error instanceof Error ? error.name : 'unknown' }, 'error');
      return Response.json({ error: 'search failed' }, { status: 500 });
    }
  }
  const category = url.searchParams.get('category') ?? 'その他';
  return Response.json(await listProductsByCategory(user.id, category));
}

export async function POST(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const body = await req.json().catch(() => null);
  const idempotencyKeyRaw = body?.idempotency_key ?? body?.idempotencyKey;
  const idempotencyKey = idempotencyKeyRaw === undefined || idempotencyKeyRaw === null || idempotencyKeyRaw === '' ? null : String(idempotencyKeyRaw);
  if (idempotencyKey !== null && !isValidIdempotencyKey(idempotencyKey)) {
    return Response.json({ error: 'invalid idempotency_key' }, { status: 400 });
  }
  const product = await createQuickProduct({
    userId: user.id,
    productName: String(body?.product_name ?? body?.productName ?? ''),
    pointValue: Number(body?.point_value ?? body?.pointValue),
    aliases: body?.aliases,
    parentProductId: body?.parent_product_id ?? body?.parentProductId ?? null,
    variantLabel: body?.variant_label ?? body?.variantLabel ?? null,
  });
  if (!product) return Response.json({ error: 'invalid_product' }, { status: 400 });
  if (body?.log === true) {
    const sale = await logSale(user.id, product.id, 1, product.variant_id ?? null, null, idempotencyKey);
    if (!sale) return Response.json({ error: 'could_not_log', product }, { status: 400 });
    return Response.json({ product, sale });
  }
  return Response.json({ product });
}

export async function PATCH(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const body = await req.json().catch(() => null);
  const productId = Number(body?.product_id ?? body?.productId);
  const variantRaw = body?.variant_id ?? body?.variantId;
  const variantId = variantRaw === null || variantRaw === undefined || variantRaw === '' ? null : Number(variantRaw);
  const pointValue = Number(body?.point_value ?? body?.pointValue);
  if (!Number.isInteger(productId) || productId <= 0 || (variantId !== null && (!Number.isInteger(variantId) || variantId <= 0)) || !Number.isFinite(pointValue) || pointValue <= 0 || pointValue > 9999) {
    return Response.json({ error: 'invalid request' }, { status: 400 });
  }

  const updated = await updateVisibleProductPoint(user.id, productId, variantId, pointValue);
  if (!updated) return Response.json({ error: 'product not found' }, { status: 404 });
  await logActivity({
    userId: user.id,
    actorUserId: user.id,
    action: 'home_variant_point_updated',
    summary: `ホーム長押し点数更新: product ${productId}${variantId ? ` variant ${variantId}` : ''} → ${Math.floor(pointValue)}pt`,
    details: { product_id: productId, variant_id: variantId, point_value: Math.floor(pointValue) },
  });
  return Response.json(updated);
}
