import { query } from '@/lib/db';
import { logSale, todaySummary, type LoggedSale } from '@/lib/sugi-db';
import type { TodaySale } from '@/lib/sugi-domain';

export type CreateSaleRecord = Awaited<ReturnType<typeof logSale>>;

type AcceptedReceiptRow = TodaySale & { idempotency_key: string };

export async function findAcceptedByIdempotencyKeys(
  userId: number,
  idempotencyKeys: string[],
): Promise<Array<{ idempotency_key: string; sale: LoggedSale }>> {
  if (idempotencyKeys.length === 0) return [];
  const [rows, today] = await Promise.all([
    query<AcceptedReceiptRow>(
      `SELECT receipt.idempotency_key,
              sale.id, sale.product_name, sale.quantity,
              sale.points_per_item, sale.total_points
       FROM sale_idempotency_receipts receipt
       JOIN sales_logs sale ON sale.id = receipt.sale_id
       WHERE receipt.user_id = $1
         AND receipt.idempotency_key = ANY($2::text[])`,
      [userId, idempotencyKeys],
    ),
    todaySummary(userId),
  ]);
  return rows.map((row) => ({
    idempotency_key: row.idempotency_key,
    sale: {
      id: Number(row.id),
      product_name: row.product_name,
      quantity: Number(row.quantity),
      points_per_item: Number(row.points_per_item),
      total_points: Number(row.total_points),
      today_total: today.total_points,
      today_items: today.total_items,
      idempotent_replay: true,
    },
  }));
}

export const saleRepository = {
  findAcceptedByIdempotencyKeys,
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
