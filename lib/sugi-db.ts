import { query, queryOne } from './db';
import { applyDefaultProductAliases, categoryLabel, isLoggableProduct, normalizeProductCategory, rankProductsForSearch, type Category, type Product, type SearchableProduct, type TodaySale } from './sugi-domain';

export type DatedSale = TodaySale & { sold_date: string; category: string; created_at?: string };
export type MonthSaleTotal = { sold_date: string; total_points: number; total_items: number };

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && IDEMPOTENCY_KEY_PATTERN.test(value);
}

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
    `SELECT category AS name, COUNT(*)::text AS count
    FROM products
    WHERE is_active = TRUE AND (user_id IS NULL OR user_id = $1)
    GROUP BY category
    ORDER BY name`,
    [userId]
  );
  return rows.map((r) => ({ name: categoryLabel(r.name), count: Number(r.count) }));
}

export async function listProductsByCategory(userId: number, category: string): Promise<Product[]> {
  const normalized = categoryLabel(category);
  const rows = await query<{ id: string; product_name: string; point_value: number; category: string | null; user_id: string | null }>(
    `SELECT id, product_name, point_value, category, user_id
    FROM products
    WHERE is_active = TRUE
    AND (user_id IS NULL OR user_id = $1)
    AND category = $2
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

type SearchableProductRow = {
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
};

function normalizeSearchParam(search: string): string {
  return search.normalize('NFKC').trim().replace(/\s+/g, '').toLowerCase();
}

function hydrateSearchRows(rows: SearchableProductRow[]): SearchableProduct[] {
  return applyDefaultProductAliases(rows.map((r) => rowToProduct(r))).map((product, index) => ({ ...product, sale_count: Number(rows[index]?.sale_count ?? 0) }));
}

export async function listSearchableProducts(userId: number, search = '', limit = 60): Promise<SearchableProduct[]> {
  const normalizedSearch = normalizeSearchParam(search);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 60, normalizedSearch ? 200 : 1000));
  const rows = await query<SearchableProductRow>(
    `WITH sale_counts AS (
       SELECT product_id, COUNT(*)::int AS sale_count
       FROM sales_logs
       WHERE user_id = $1
       GROUP BY product_id
     )
     SELECT p.id, p.product_name, p.point_value, COALESCE(NULLIF(TRIM(p.category), ''), 'その他') AS category, p.user_id,
            p.nicknames,
            pv.id AS variant_id,
            pv.variant_label,
            pv.display_shortcut AS variant_display_shortcut,
            pv.point_value AS variant_point_value,
            pv.nicknames AS variant_nicknames,
            COALESCE(sc.sale_count, 0)::text AS sale_count
     FROM products p
     LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = TRUE
     LEFT JOIN sale_counts sc ON sc.product_id = p.id
     WHERE p.is_active = TRUE
       AND (p.user_id IS NULL OR p.user_id = $1)
       AND (
         $2 = '' OR
         regexp_replace(lower(p.product_name), '\\s+', '', 'g') LIKE '%' || $2 || '%' OR
         EXISTS (SELECT 1 FROM unnest(COALESCE(p.nicknames, ARRAY[]::text[])) AS nick WHERE regexp_replace(lower(nick), '\\s+', '', 'g') LIKE '%' || $2 || '%') OR
         regexp_replace(lower(COALESCE(pv.variant_label, '')), '\\s+', '', 'g') LIKE '%' || $2 || '%' OR
         regexp_replace(lower(COALESCE(pv.display_shortcut, '')), '\\s+', '', 'g') LIKE '%' || $2 || '%' OR
         EXISTS (SELECT 1 FROM unnest(COALESCE(pv.nicknames, ARRAY[]::text[])) AS vnick WHERE regexp_replace(lower(vnick), '\\s+', '', 'g') LIKE '%' || $2 || '%')
       )
     ORDER BY COALESCE(sc.sale_count, 0) DESC, p.product_name, pv.unit_count NULLS LAST, pv.id
     LIMIT $3`,
    [userId, normalizedSearch, normalizedSearch ? Math.max(safeLimit * 5, 100) : 1000]
  );
  const products = hydrateSearchRows(rows);
  return rankProductsForSearch(products, search, safeLimit);
}

export async function getVisibleProduct(userId: number, productId: number): Promise<Product | null> {
  const row = await queryOne<{ id: string; product_name: string; point_value: number; category: string | null; user_id: string | null }>(
    `SELECT id, product_name, point_value, category, user_id
     FROM products
     WHERE id = $1 AND is_active = TRUE AND (user_id IS NULL OR user_id = $2)`,
    [productId, userId]
  );
  if (!row) return null;
  return { id: Number(row.id), product_name: row.product_name, point_value: Number(row.point_value), category: categoryLabel(row.category), scope: row.user_id === null ? 'global' : 'private' };
}

export async function createQuickProduct(input: { userId: number; productName: string; pointValue: number }): Promise<Product | null> {
  const name = input.productName.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const pointValue = Math.floor(Number(input.pointValue));
  if (name.length < 2 || name.length > 120 || !Number.isFinite(pointValue) || pointValue <= 0 || pointValue > 9999) return null;
  const aliases = [...new Set([name.toLowerCase(), normalizeSearchParam(name)].filter(Boolean))];
  const row = await queryOne<{ id: string; product_name: string; point_value: number; category: string | null; user_id: string | null }>(
    `INSERT INTO products (product_name, category, point_value, nicknames, is_active, user_id)
     VALUES ($1, 'ヘルスケア', $2, $3, TRUE, NULL)
     ON CONFLICT (product_name) DO UPDATE SET
       point_value = EXCLUDED.point_value,
       nicknames = (SELECT array(SELECT DISTINCT x FROM unnest(COALESCE(products.nicknames, ARRAY[]::text[]) || EXCLUDED.nicknames) x WHERE x IS NOT NULL AND trim(x) <> '')),
       is_active = TRUE,
       updated_at = now()
     RETURNING id, product_name, point_value, category, user_id`,
    [name, pointValue, aliases]
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

export type LoggedSale = TodaySale & { today_total: number; today_items: number; idempotent_replay: boolean };

export async function logSale(
  userId: number,
  productId: number,
  quantity = 1,
  variantId?: number | null,
  soldDate?: string | null,
  idempotencyKey?: string | null,
): Promise<LoggedSale | null> {
  const validDate = validSaleDate(soldDate) ?? todaySaleDate();
  const product = variantId ? await getVisibleProductVariant(userId, productId, variantId) : await getVisibleProduct(userId, productId);
  if (!product || !isLoggableProduct(product)) return null;
  const qty = quantity;

  // If a key is supplied, try to claim it with an idempotent INSERT. A conflict means
  // an earlier request from the same user already wrote this sale; replay it instead of
  // creating a duplicate. The first request wins — payload mismatches are not allowed
  // to mutate the original sale.
  const key = idempotencyKey && isValidIdempotencyKey(idempotencyKey) ? idempotencyKey : null;
  let inserted: TodaySale | null = null;
  let replay = false;
  if (key) {
    inserted = await queryOne<TodaySale>(
      `INSERT INTO sales_logs (sold_date, user_id, product_id, product_name, quantity, points_per_item, idempotency_key)
       VALUES ($6::date, $1, $2, $3, $4, $5, $7)
       ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING id, product_name, quantity, points_per_item, total_points`,
      [userId, product.id, product.product_name, qty, product.point_value, validDate, key],
    );
    if (!inserted) {
      inserted = await queryOne<TodaySale>(
        `SELECT id, product_name, quantity, points_per_item, total_points
         FROM sales_logs WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1`,
        [userId, key],
      );
      replay = true;
    }
  } else {
    inserted = await queryOne<TodaySale>(
      `INSERT INTO sales_logs (sold_date, user_id, product_id, product_name, quantity, points_per_item)
       VALUES ($6::date, $1, $2, $3, $4, $5)
       RETURNING id, product_name, quantity, points_per_item, total_points`,
      [userId, product.id, product.product_name, qty, product.point_value, validDate],
    );
  }
  if (!inserted) return null;
  const today = await todaySummary(userId);
  return {
    id: Number(inserted.id),
    product_name: inserted.product_name,
    quantity: Number(inserted.quantity),
    points_per_item: Number(inserted.points_per_item),
    total_points: Number(inserted.total_points),
    today_total: today.total_points,
    today_items: today.total_items,
    idempotent_replay: replay,
  };
}

function normalizeSale<T extends TodaySale | DatedSale>(sale: T): T {
 return { ...sale, id: Number(sale.id), quantity: Number(sale.quantity), points_per_item: Number(sale.points_per_item), total_points: Number(sale.total_points) };
}

function normalizeDatedSale(sale: DatedSale): DatedSale {
 return { ...normalizeSale(sale), category: normalizeProductCategory(sale.category) };
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
  return { total_points: Number(summary?.total_points ?? 0), total_items: Number(summary?.total_items ?? 0), logs: logs.map(normalizeDatedSale) };
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

export async function listSalesHistory(userId: number, limit = 300, month?: string): Promise<DatedSale[]> {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 300, 1000));
  const validMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : null;
  const rows = await query<DatedSale>(
    `SELECT sales_logs.id, sales_logs.sold_date::text, sales_logs.product_name, sales_logs.quantity, sales_logs.points_per_item, sales_logs.total_points, COALESCE(p.category, 'ヘルスケア') AS category, sales_logs.created_at::text
    FROM sales_logs
    LEFT JOIN products p ON p.id = sales_logs.product_id
    WHERE sales_logs.user_id = $1
    AND ($3::text IS NULL OR (sold_date >= ($3 || '-01')::date AND sold_date < (($3 || '-01')::date + interval '1 month')))
    ORDER BY sold_date ASC, created_at ASC, id ASC
    LIMIT $2`,
    [userId, safeLimit, validMonth]
    );
    return rows.map(normalizeDatedSale);
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

export async function updateSalePoints(userId: number, saleId: number, pointValue: number): Promise<TodaySale | null> {
  const points = Math.floor(Number(pointValue));
  if (!Number.isFinite(points) || points <= 0 || points > 9999) return null;
  const saleBefore = await queryOne<{ product_id: string; product_name: string }>(
    `SELECT product_id, product_name FROM sales_logs WHERE id = $1 AND user_id = $2`,
    [saleId, userId]
  );
  if (!saleBefore) return null;

  const base = await queryOne<{ product_name: string }>(`SELECT product_name FROM products WHERE id = $1`, [saleBefore.product_id]);
  if (base?.product_name && saleBefore.product_name !== base.product_name && saleBefore.product_name.startsWith(`${base.product_name} `)) {
    const variantLabel = saleBefore.product_name.slice(base.product_name.length).trim();
    await query(
      `UPDATE product_variants SET point_value = $1, updated_at = now()
       WHERE product_id = $2 AND variant_label = $3`,
      [points, saleBefore.product_id, variantLabel]
    );
  } else {
    await query(`UPDATE products SET point_value = $1, updated_at = now() WHERE id = $2`, [points, saleBefore.product_id]);
  }

  const sale = await queryOne<TodaySale>(
    `UPDATE sales_logs SET points_per_item = $3
     WHERE id = $1 AND user_id = $2 RETURNING id, product_name, quantity, points_per_item, total_points`,
    [saleId, userId, points]
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
