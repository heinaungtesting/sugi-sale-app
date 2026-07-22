import { releaseRateLimit, reserveRateLimit } from './postgres-rate-limit';

const SALE_WINDOW_MS = 60 * 1000;
const MAX_SALES_PER_WINDOW = 30;
const SCOPE = 'sale-write';

export async function reserveSaleWrite(userId: number): Promise<boolean> {
  return reserveRateLimit(SCOPE, String(userId), SALE_WINDOW_MS, MAX_SALES_PER_WINDOW);
}

export async function releaseSaleWrite(userId: number): Promise<void> {
  await releaseRateLimit(SCOPE, String(userId));
}
