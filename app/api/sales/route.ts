import { currentUser, requireUserResponse } from '@/lib/auth';
import { isValidIdempotencyKey, logSale, validSaleDate } from '@/lib/sugi-db';

const SALE_WINDOW_MS = 60 * 1000;
const MAX_SALES_PER_WINDOW = 30;

type SaleWriteWindow = { count: number; firstWriteAt: number };

declare global {
  // eslint-disable-next-line no-var
  var sugiSaleWrites: Map<number, SaleWriteWindow> | undefined;
}

const saleWrites = globalThis.sugiSaleWrites ?? new Map<number, SaleWriteWindow>();
globalThis.sugiSaleWrites = saleWrites;

function recordSaleWrite(userId: number, now = Date.now()): boolean {
  const current = saleWrites.get(userId);
  if (!current || now - current.firstWriteAt > SALE_WINDOW_MS) {
    saleWrites.set(userId, { count: 1, firstWriteAt: now });
    return true;
  }
  if (current.count >= MAX_SALES_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

function validateSaleQuantity(raw: unknown): number | null {
  const quantity = raw === undefined || raw === null || raw === '' ? 1 : Number(raw);
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 99) return null;
  return quantity;
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return requireUserResponse();

  const body = await req.json().catch(() => ({}));
  const productId = Number(body.product_id);
  const variantId = body.variant_id === undefined || body.variant_id === null ? null : Number(body.variant_id);
  const quantity = validateSaleQuantity(body.quantity);
  const soldDate = body.sold_date === undefined || body.sold_date === null || body.sold_date === '' ? null : String(body.sold_date);
  const idempotencyKeyRaw = body.idempotency_key ?? body.idempotencyKey;
  const idempotencyKey = idempotencyKeyRaw === undefined || idempotencyKeyRaw === null || idempotencyKeyRaw === '' ? null : String(idempotencyKeyRaw);
  if (idempotencyKey !== null && !isValidIdempotencyKey(idempotencyKey)) return Response.json({ error: 'invalid idempotency_key' }, { status: 400 });
  if (!Number.isInteger(productId) || productId <= 0) return Response.json({ error: 'invalid product_id' }, { status: 400 });
  if (variantId !== null && (!Number.isInteger(variantId) || variantId <= 0)) return Response.json({ error: 'invalid variant_id' }, { status: 400 });
  if (quantity === null) return Response.json({ error: 'quantity must be an integer between 1 and 99' }, { status: 400 });
  if (soldDate !== null && !validSaleDate(soldDate)) return Response.json({ error: 'invalid sold_date' }, { status: 400 });
  try {
    const sale = await logSale(user.id, productId, quantity, variantId, soldDate, idempotencyKey);
    if (!sale) return Response.json({ error: 'product not found' }, { status: 404 });
    // Only count new sales against the rate budget — idempotent replays from a retry
    // queue must not be penalised.
    if (!sale.idempotent_replay && !recordSaleWrite(user.id)) {
      return Response.json({ error: 'too many sales' }, { status: 429 });
    }
    return Response.json(sale);
  } catch (error) {
    console.error('failed to log sale', error);
    return Response.json({ error: 'failed to log sale' }, { status: 500 });
  }
}
