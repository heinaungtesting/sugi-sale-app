import { logSale } from '@/lib/sugi-db';

export type CreateSaleRecord = Awaited<ReturnType<typeof logSale>>;

export const saleRepository = {
  create(
    userId: number,
    productId: number,
    quantity: number,
    variantId: number | null,
    soldDate: string | null,
    idempotencyKey: string | null,
  ) {
    return logSale(userId, productId, quantity, variantId, soldDate, idempotencyKey);
  },
};
