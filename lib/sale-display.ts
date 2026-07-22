export type DisplaySaleRow = {
  id: number;
  product_name: string;
  quantity: number;
  points_per_item: number;
  total_points: number;
  _queueKey?: string;
  _queueStatus?: 'pending' | 'sending' | 'failed';
  _queueError?: string;
};

/**
 * Collapse repeated taps into one visible row per product/point combination.
 *
 * Different positive/temporary IDs are separate tap records, so their quantities
 * add together. Repeated appearances of the same canonical server ID are queue
 * snapshots of one cumulative row, so only the highest quantity is retained.
 */
export function mergeDisplayedSales<T extends DisplaySaleRow>(rows: T[]): T[] {
  const groups = new Map<string, { row: T; quantities: Map<number, number> }>();

  for (const input of rows) {
    const points = Number(input.points_per_item);
    const key = `${input.product_name}\u0000${points}`;
    const quantity = Math.max(0, Number(input.quantity) || 0);
    const existing = groups.get(key);

    if (!existing) {
      const row = { ...input, quantity, total_points: quantity * points } as T;
      groups.set(key, { row, quantities: new Map([[Number(input.id), quantity]]) });
      continue;
    }

    const id = Number(input.id);
    existing.quantities.set(id, Math.max(existing.quantities.get(id) ?? 0, quantity));
    const mergedQuantity = [...existing.quantities.values()].reduce((sum, value) => sum + value, 0);
    existing.row = {
      ...existing.row,
      ...((input._queueKey || input._queueStatus || input._queueError)
        ? { _queueKey: input._queueKey, _queueStatus: input._queueStatus, _queueError: input._queueError }
        : {}),
      quantity: mergedQuantity,
      total_points: mergedQuantity * points,
    } as T;
  }

  return [...groups.values()].map((group) => group.row);
}
