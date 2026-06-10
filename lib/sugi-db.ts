import { query, queryOne } from './db';
import { applyDefaultProductAliases, categoryLabel, isLoggableProduct, rankProductsForSearch, type Category, type Product, type SearchableProduct, type TodaySale } from './sugi-domain';

export type DatedSale = TodaySale & { sold_date: string; created_at?: string };
export type MonthSaleTotal = { sold_date: string; total_points: number; total_items: number };

export function todaySaleDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function validSaleDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

export async function listCategories(userId: number): Promise<Category[]> {
  const rows = await query<{ name: string | null; count: string }>(
    `SELECT COALESCE(NULLIF(TRIM(category), ''), 'その他') AS name, COUNT(*)::text AS count
     FROM products
     WHERE is_active = TRUE AND (user_id IS NULL OR user_id = $1)
     GROUP BY COALESCE(NULLIF(TRIM(category), ''), 'その他')
     ORDER BY name`,
    [userId]
  );
  return rows.map((r) => ({ name: categoryLabel(r.name), count: Number(r.count) }));
}

export async function listProductsByCategory(userId: number, category: string): Promise<Product[]> {
  const normalized = categoryLabel(category);
  const rows = await query<{ id: string; product_name: string; point_value: number; category: string | null; user_id: string | null }>(
    `SELECT id, product_name, point_value, COALESCE(NULLIF(TRIM(category), ''), 'その他') AS category, user_id
     FROM products
     WHERE is_active = TRUE
       AND (user_id IS NULL OR user_id = $1)
       AND COALESCE(NULLIF(TRIM(category), ''), 'その他') = $2
     ORDER BY product_name`,
    [userId, normalized]
  );
  return rows.map((r) => ({ id: Number(r.id), product_name: r.product_name, point_value: Number(r.point_value), category: categoryLabel(r.category), scope: r.user_id === null ? 'global' : 'private' }));
}

function rowToProduct(r: {
  id: string;
  product_name: string;
  point_value: number;
  category: string | null;
  user_id: string | null;
  nicknames?: string[] | null;
  variant_id?: string | null;
  variant_label?: string | null;
  variant_display_shortcut?: string | null;
  variant_point_value?: number | null;
  variant_nicknames?: string[] | null;
}): SearchableProduct {
  return {
    id: Number(r.id),
    product_name: r.product_name,
    point_value: Number(r.variant_point_value ?? r.point_value),
    category: categoryLabel(r.category),
    scope: r.user_id === null ? 'global' : 'private',
    aliases: [...new Set([...(r.nicknames ?? []), ...(r.variant_nicknames ?? [])])],
    variant_id: r.variant_id ? Number(r.variant_id) : null,
    variant_label: r.variant_label ?? null,
    variant_display_shortcut: r.variant_display_shortcut ?? null,
    variant_point_value: r.variant_point_value === null || r.variant_point_value === undefined ? null : Number(r.variant_point_value),
    variant_aliases: r.variant_nicknames ?? [],
  };
}

export async function listSearchableProducts(userId: number, search = '', limit = 60): Promise<SearchableProduct[]> {
  const rows = await query<{
    id: string;
    product_name: string;
    point_value: number;
    category: string | null;
    user_id: string | null;
    sale_count: string | null;
    nicknames: string[] | null;
    variant_id: string | null;
    variant_label: string | null;
    variant_display_shortcut: string | null;
    variant_point_value: number | null;
    variant_nicknames: string[] | null;
  }>(
    `SELECT p.id, p.product_name, p.point_value, COALESCE(NULLIF(TRIM(p.category), ''), 'その他') AS category, p.user_id,
            p.nicknames,
            pv.id AS variant_id,
            pv.variant_label,
            pv.display_shortcut AS variant_display_shortcut,
            pv.point_value AS variant_point_value,
            pv.nicknames AS variant_nicknames,
            COALESCE(COUNT(s.id), 0)::text AS sale_count
     FROM products p
     LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = TRUE
     LEFT JOIN sales_logs s ON s.product_id = p.id AND s.user_id = $1
     WHERE p.is_active = TRUE AND (p.user_id IS NULL OR p.user_id = $1)
     GROUP BY p.id, p.product_name, p.point_value, p.category, p.user_id, p.nicknames, pv.id, pv.variant_label, pv.display_shortcut, pv.point_value, pv.nicknames, pv.unit_count
     ORDER BY sale_count DESC, p.product_name, pv.unit_count NULLS LAST, pv.id
     LIMIT 300`,
    [userId]
  );
  const products = applyDefaultProductAliases(rows.map((r) => rowToProduct(r))).map((product, index) => ({ ...product, sale_count: Number(rows[index]?.sale_count ?? 0) }));
  return rankProductsForSearch(products, search, limit);
}

export async function getVisibleProduct(userId: number, productId: number): Promise<Product | null> {
  const row = await queryOne<{ id: string; product_name: string; point_value: number; category: string | null; user_id: string | null }>(
    `SELECT id, product_name, point_value, COALESCE(NULLIF(TRIM(category), ''), 'その他') AS category, user_id
     FROM products
     WHERE id = $1 AND is_active = TRUE AND (user_id IS NULL OR user_id = $2)`,
    [productId, userId]
  );
  if (!row) return null;
  return { id: Number(row.id), product_name: row.product_name, point_value: Number(row.point_value), category: categoryLabel(row.category), scope: row.user_id === null ? 'global' : 'private' };
}

export async function getVisibleProductVariant(userId: number, productId: number, variantId: number): Promise<Product | null> {
  const row = await queryOne<{ id: string; product_name: string; point_value: number; category: string | null; user_id: string | null; variant_label: string; variant_point_value: number }>(
    `SELECT p.id, p.product_name, p.category, p.user_id,
            pv.variant_label,
            pv.point_value AS variant_point_value,
            pv.point_value AS point_value
     FROM products p
     JOIN product_variants pv ON pv.product_id = p.id
     WHERE p.id = $1 AND p.is_active = TRUE AND (p.user_id IS NULL OR p.user_id = $2)
       AND pv.id = $3 AND pv.is_active = TRUE`,
    [productId, userId, variantId]
  );
  if (!row) return null;
  return { id: Number(row.id), product_name: `${row.product_name} ${row.variant_label}`, point_value: Number(row.variant_point_value), category: categoryLabel(row.category), scope: row.user_id === null ? 'global' : 'private' };
}

export async function logSale(userId: number, productId: number, quantity = 1, variantId?: number | null, soldDate?: string | null) {
  const validDate = validSaleDate(soldDate) ?? todaySaleDate();
  const product = variantId ? await getVisibleProductVariant(userId, productId, variantId) : await getVisibleProduct(userId, productId);
  if (!product || !isLoggableProduct(product)) return null;
  const qty = Math.max(1, Math.min(Number(quantity) || 1, 99));
  const sale = await queryOne<TodaySale>(
    `INSERT INTO sales_logs (sold_date, user_id, product_id, product_name, quantity, points_per_item)
     VALUES ($6::date, $1, $2, $3, $4, $5)
     RETURNING id, product_name, quantity, points_per_item, total_points`,
    [userId, product.id, product.product_name, qty, product.point_value, validDate]
  );
  const today = await todaySummary(userId);
  if (!sale) return null;
  return { id: Number(sale.id), product_name: sale.product_name, quantity: Number(sale.quantity), points_per_item: Number(sale.points_per_item), total_points: Number(sale.total_points), today_total: today.total_points, today_items: today.total_items };
}

function normalizeSale<T extends TodaySale | DatedSale>(sale: T): T {
  return { ...sale, id: Number(sale.id), quantity: Number(sale.quantity), points_per_item: Number(sale.points_per_item), total_points: Number(sale.total_points) };
}

export async function salesByDate(userId: number, soldDate: string): Promise<{ total_points: number; total_items: number; logs: DatedSale[] }> {
  const validDate = validSaleDate(soldDate);
  if (!validDate) return { total_points: 0, total_items: 0, logs: [] };
  const summary = await queryOne<{ total_points: string | null; total_items: string | null }>(
    `SELECT COALESCE(SUM(total_points), 0)::text AS total_points, COALESCE(SUM(quantity), 0)::text AS total_items
     FROM sales_logs WHERE user_id = $1 AND sold_date = $2::date`,
    [userId, validDate]
  );
  const logs = await query<DatedSale>(
    `SELECT id, sold_date::text, product_name, quantity, points_per_item, total_points, created_at::text
     FROM sales_logs WHERE user_id = $1 AND sold_date = $2::date ORDER BY created_at DESC, id DESC`,
    [userId, validDate]
  );
  return { total_points: Number(summary?.total_points ?? 0), total_items: Number(summary?.total_items ?? 0), logs: logs.map(normalizeSale) };
}

export async function salesByMonth(userId: number, month: string): Promise<MonthSaleTotal[]> {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const rows = await query<MonthSaleTotal>(
    `SELECT sold_date::text, COALESCE(SUM(total_points), 0)::int AS total_points, COALESCE(SUM(quantity), 0)::int AS total_items
     FROM sales_logs
     WHERE user_id = $1 AND sold_date >= ($2 || '-01')::date AND sold_date < (($2 || '-01')::date + interval '1 month')
     GROUP BY sold_date ORDER BY sold_date`,
    [userId, month]
  );
  return rows.map((r) => ({ sold_date: r.sold_date, total_points: Number(r.total_points), total_items: Number(r.total_items) }));
}

export async function todaySummary(userId: number): Promise<{ total_points: number; total_items: number; recent: TodaySale[] }> {
  const today = todaySaleDate();
  const byDate = await salesByDate(userId, today);
  return { total_points: byDate.total_points, total_items: byDate.total_items, recent: byDate.logs.slice(0, 8) };
}

export async function undoLatestSale(userId: number): Promise<TodaySale | null> {
  const deleted = await queryOne<TodaySale>(
    `DELETE FROM sales_logs WHERE id = (SELECT id FROM sales_logs WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1)
     RETURNING id, product_name, quantity, points_per_item, total_points`,
    [userId]
  );
  return deleted ? normalizeSale(deleted) : null;
}

export async function deleteSaleById(userId: number, saleId: number): Promise<TodaySale | null> {
  const deleted = await queryOne<TodaySale>(
    `DELETE FROM sales_logs WHERE id = $1 AND user_id = $2 RETURNING id, product_name, quantity, points_per_item, total_points`,
    [saleId, userId]
  );
  return deleted ? normalizeSale(deleted) : null;
}

export async function updateSaleQuantity(userId: number, saleId: number, delta: number): Promise<TodaySale | null> {
  const sale = await queryOne<TodaySale>(
    `UPDATE sales_logs SET quantity = GREATEST(1, LEAST(99, quantity + $3))
     WHERE id = $1 AND user_id = $2 RETURNING id, product_name, quantity, points_per_item, total_points`,
    [saleId, userId, delta]
  );
  return sale ? normalizeSale(sale) : null;
}

export async function deleteTodaySaleByProduct(userId: number, productId: number): Promise<TodaySale | null> {
  const deleted = await queryOne<TodaySale>(
    `DELETE FROM sales_logs WHERE id = (
       SELECT id FROM sales_logs WHERE user_id = $1 AND sold_date = CURRENT_DATE AND product_id = $2 ORDER BY created_at DESC, id DESC LIMIT 1
     ) RETURNING id, product_name, quantity, points_per_item, total_points`,
    [userId, productId]
  );
  return deleted ? normalizeSale(deleted) : null;
}
