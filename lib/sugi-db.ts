import { query, queryOne } from './db';
import { applyDefaultProductAliases, categoryLabel, isLoggableProduct, rankProductsForSearch, type Category, type Product, type SearchableProduct, type TodaySale } from './sugi-domain';

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
  const rows = await query<{
    id: string;
    product_name: string;
    point_value: number;
    category: string | null;
    user_id: string | null;
  }>(
    `SELECT id, product_name, point_value, COALESCE(NULLIF(TRIM(category), ''), 'その他') AS category, user_id
     FROM products
     WHERE is_active = TRUE
       AND (user_id IS NULL OR user_id = $1)
       AND COALESCE(NULLIF(TRIM(category), ''), 'その他') = $2
     ORDER BY product_name`,
    [userId, normalized]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    product_name: r.product_name,
    point_value: Number(r.point_value),
    category: categoryLabel(r.category),
    scope: r.user_id === null ? 'global' : 'private',
  }));
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
    variant_point_value: number | null;
    variant_nicknames: string[] | null;
  }>(
    `SELECT p.id, p.product_name, p.point_value, COALESCE(NULLIF(TRIM(p.category), ''), 'その他') AS category, p.user_id,
            p.nicknames,
            pv.id AS variant_id,
            pv.variant_label,
            pv.point_value AS variant_point_value,
            pv.nicknames AS variant_nicknames,
            COALESCE(COUNT(s.id), 0)::text AS sale_count
     FROM products p
     LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = TRUE
     LEFT JOIN sales_logs s ON s.product_id = p.id AND s.user_id = $1
     WHERE p.is_active = TRUE AND (p.user_id IS NULL OR p.user_id = $1)
     GROUP BY p.id, p.product_name, p.point_value, p.category, p.user_id, p.nicknames, pv.id, pv.variant_label, pv.point_value, pv.nicknames, pv.unit_count
     ORDER BY sale_count DESC, p.product_name, pv.unit_count NULLS LAST, pv.id
     LIMIT 300`,
    [userId]
  );
  const products = applyDefaultProductAliases(rows.map((r) => rowToProduct(r))).map((product, index) => ({
    ...product,
    sale_count: Number(rows[index]?.sale_count ?? 0),
  }));
  return rankProductsForSearch(products, search, limit);
}

export async function getVisibleProduct(userId: number, productId: number): Promise<Product | null> {
  const row = await queryOne<{
    id: string;
    product_name: string;
    point_value: number;
    category: string | null;
    user_id: string | null;
  }>(
    `SELECT id, product_name, point_value, COALESCE(NULLIF(TRIM(category), ''), 'その他') AS category, user_id
     FROM products
     WHERE id = $1 AND is_active = TRUE AND (user_id IS NULL OR user_id = $2)`,
    [productId, userId]
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    product_name: row.product_name,
    point_value: Number(row.point_value),
    category: categoryLabel(row.category),
    scope: row.user_id === null ? 'global' : 'private',
  };
}

export async function getVisibleProductVariant(userId: number, productId: number, variantId: number): Promise<Product | null> {
  const row = await queryOne<{
    id: string;
    product_name: string;
    point_value: number;
    category: string | null;
    user_id: string | null;
    variant_label: string;
    variant_point_value: number;
  }>(
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
  return {
    id: Number(row.id),
    product_name: `${row.product_name} ${row.variant_label}`,
    point_value: Number(row.variant_point_value),
    category: categoryLabel(row.category),
    scope: row.user_id === null ? 'global' : 'private',
  };
}

export async function logSale(userId: number, productId: number, quantity = 1, variantId?: number | null) {
  const product = variantId ? await getVisibleProductVariant(userId, productId, variantId) : await getVisibleProduct(userId, productId);
  if (!product || !isLoggableProduct(product)) return null;
  const qty = Math.max(1, Math.min(Number(quantity) || 1, 99));
  const sale = await queryOne<TodaySale>(
    `INSERT INTO sales_logs (sold_date, user_id, product_id, product_name, quantity, points_per_item)
     VALUES (CURRENT_DATE, $1, $2, $3, $4, $5)
     RETURNING id, product_name, quantity, points_per_item, total_points`,
    [userId, product.id, product.product_name, qty, product.point_value]
  );
  const today = await todaySummary(userId);
  if (!sale) return null;
  return {
    id: Number(sale.id),
    product_name: sale.product_name,
    quantity: Number(sale.quantity),
    points_per_item: Number(sale.points_per_item),
    total_points: Number(sale.total_points),
    today_total: today.total_points,
    today_items: today.total_items,
  };
}

export async function todaySummary(userId: number): Promise<{ total_points: number; total_items: number; recent: TodaySale[] }> {
  const summary = await queryOne<{ total_points: string | null; total_items: string | null }>(
    `SELECT COALESCE(SUM(total_points), 0)::text AS total_points, COALESCE(SUM(quantity), 0)::text AS total_items
     FROM sales_logs
     WHERE user_id = $1 AND sold_date = CURRENT_DATE`,
    [userId]
  );
  const recent = await query<TodaySale>(
    `SELECT id, product_name, quantity, points_per_item, total_points
     FROM sales_logs
     WHERE user_id = $1 AND sold_date = CURRENT_DATE
     ORDER BY created_at DESC, id DESC
     LIMIT 8`,
    [userId]
  );
  return {
    total_points: Number(summary?.total_points ?? 0),
    total_items: Number(summary?.total_items ?? 0),
    recent: recent.map((r) => ({ ...r, id: Number(r.id), quantity: Number(r.quantity), points_per_item: Number(r.points_per_item), total_points: Number(r.total_points) })),
  };
}

export async function undoLatestSale(userId: number): Promise<TodaySale | null> {
  const deleted = await queryOne<TodaySale>(
    `DELETE FROM sales_logs WHERE id = (
       SELECT id FROM sales_logs WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1
     ) RETURNING id, product_name, quantity, points_per_item, total_points`,
    [userId]
  );
  return deleted ? { ...deleted, id: Number(deleted.id), quantity: Number(deleted.quantity), points_per_item: Number(deleted.points_per_item), total_points: Number(deleted.total_points) } : null;
}

export async function deleteTodaySaleByProduct(userId: number, productId: number): Promise<TodaySale | null> {
  const deleted = await queryOne<TodaySale>(
    `DELETE FROM sales_logs WHERE id = (
       SELECT id FROM sales_logs
       WHERE user_id = $1 AND sold_date = CURRENT_DATE AND product_id = $2
       ORDER BY created_at DESC, id DESC LIMIT 1
     ) RETURNING id, product_name, quantity, points_per_item, total_points`,
    [userId, productId]
  );
  return deleted ? { ...deleted, id: Number(deleted.id), quantity: Number(deleted.quantity), points_per_item: Number(deleted.points_per_item), total_points: Number(deleted.total_points) } : null;
}
