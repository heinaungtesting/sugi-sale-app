const SALE_WINDOW_MS = 60 * 1000;
const MAX_SALES_PER_WINDOW = 30;

type SaleWriteWindow = { count: number; firstWriteAt: number };

declare global {
  // eslint-disable-next-line no-var
  var sugiSaleWrites: Map<number, SaleWriteWindow> | undefined;
}

const saleWrites = globalThis.sugiSaleWrites ?? new Map<number, SaleWriteWindow>();
globalThis.sugiSaleWrites = saleWrites;

export function reserveSaleWrite(userId: number, now = Date.now()): boolean {
  const current = saleWrites.get(userId);
  if (!current || now - current.firstWriteAt > SALE_WINDOW_MS) {
    saleWrites.set(userId, { count: 1, firstWriteAt: now });
    return true;
  }
  if (current.count >= MAX_SALES_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

export function releaseSaleWrite(userId: number): void {
  const current = saleWrites.get(userId);
  if (!current) return;
  if (current.count <= 1) {
    saleWrites.delete(userId);
    return;
  }
  current.count -= 1;
}
