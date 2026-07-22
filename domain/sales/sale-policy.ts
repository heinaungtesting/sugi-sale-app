import { isValidIdempotencyKey, validSaleDate } from '@/lib/sugi-db';

export type CreateSaleCommand = {
  productId: number;
  variantId: number | null;
  quantity: number;
  soldDate: string | null;
  idempotencyKey: string | null;
};

export type SaleValidation =
  | { ok: true; command: CreateSaleCommand }
  | { ok: false; error: string };

function quantity(raw: unknown): number | null {
  const value = raw === undefined || raw === null || raw === '' ? 1 : Number(raw);
  return Number.isInteger(value) && value > 0 && value <= 99 ? value : null;
}

export function validateCreateSale(input: Record<string, unknown>): SaleValidation {
  const productId = Number(input.product_id);
  const variantId = input.variant_id === undefined || input.variant_id === null ? null : Number(input.variant_id);
  const saleQuantity = quantity(input.quantity);
  const soldDate = input.sold_date === undefined || input.sold_date === null || input.sold_date === '' ? null : String(input.sold_date);
  const rawKey = input.idempotency_key ?? input.idempotencyKey;
  const idempotencyKey = rawKey === undefined || rawKey === null || rawKey === '' ? null : String(rawKey);

  if (idempotencyKey !== null && !isValidIdempotencyKey(idempotencyKey)) return { ok: false, error: 'invalid idempotency_key' };
  if (!Number.isInteger(productId) || productId <= 0) return { ok: false, error: 'invalid product_id' };
  if (variantId !== null && (!Number.isInteger(variantId) || variantId <= 0)) return { ok: false, error: 'invalid variant_id' };
  if (saleQuantity === null) return { ok: false, error: 'quantity must be an integer between 1 and 99' };
  if (soldDate !== null && !validSaleDate(soldDate)) return { ok: false, error: 'invalid sold_date' };

  return { ok: true, command: { productId, variantId, quantity: saleQuantity, soldDate, idempotencyKey } };
}
