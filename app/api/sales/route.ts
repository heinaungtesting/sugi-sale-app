import { currentUser, requireUserResponse } from '@/lib/auth';
import { isValidIdempotencyKey, logSale, validSaleDate } from '@/lib/sugi-db';
import { requireCsrf } from '@/lib/csrf';

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

/**
 * Refund one slot of the per-user rate budget. Used when a sale is not
 * actually written (rate-limit error caught upstream, product not found,
 * logSale threw, or the request was an idempotent replay from the
 * offline queue that should not count against the budget).
 */
function releaseSaleWrite(userId: number): void {
  const current = saleWrites.get(userId);
  if (!current) return;
  if (current.count <= 1) {
    // Budget window has no real consumption left; drop the entry so the
    // next call starts a fresh window.
    saleWrites.delete(userId);
    return;
  }
  current.count -= 1;
}

function validateSaleQuantity(raw: unknown): number | null {
  const quantity = raw === undefined || raw === null || raw === '' ? 1 : Number(raw);
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 99) return null;
  return quantity;
}

export async function POST(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
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
  // Reserve a rate-limit slot BEFORE calling logSale. If the budget is
  // exhausted, return 429 without touching the DB so we never leave an
  // orphan row in sales_logs. Any path that does not actually persist a
  // new sale (idempotent replay, product not found, or thrown error)
  // must refund the slot via releaseSaleWrite.
  if (!recordSaleWrite(user.id)) {
    return Response.json({ error: 'too many sales' }, { status: 429 });
  }
  try {
    const sale = await logSale(user.id, productId, quantity, variantId, soldDate, idempotencyKey);
    if (!sale) {
      releaseSaleWrite(user.id);
      return Response.json({ error: 'product not found' }, { status: 404 });
    }
    // Idempotent replays from the offline queue must not consume the
    // rate budget — refund the slot we reserved above.
    if (sale.idempotent_replay) releaseSaleWrite(user.id);
    return Response.json(sale);
  } catch (error) {
    releaseSaleWrite(user.id);
    console.error('failed to log sale', error);
    return Response.json({ error: 'failed to log sale' }, { status: 500 });
  }
}
