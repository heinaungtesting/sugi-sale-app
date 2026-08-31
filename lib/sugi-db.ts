import { pool, query, queryOne } from './db';
import { applyDueMonthlyPointCampaigns, getPreviousTokyoMonthKey } from './sugi-admin-db';
import { applyDefaultProductAliases, categoryLabel, isLoggableProduct, normalizeProductCategory, prepareProductSearchQuery, rankProductsForSearch, type Category, type Product, type SearchableProduct, type TodaySale } from './sugi-domain';
import { buildQuickProductPlan } from './product-creation';
import { syncProductPointValue, syncVariantPointValue, syncVariantPointValueBySaleName } from './sugi-point-sync';

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

export async function listVisibleProductParents(userId: number): Promise<Product[]> {
  const rows = await query<{ id: string; product_name: string; point_value: number; category: string | null; user_id: string | null }>(
    `SELECT id, product_name, point_value, category, user_id
     FROM products
     WHERE is_active = TRUE AND (user_id IS NULL OR user_id = $1)
     ORDER BY product_name`,
    [userId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    product_name: row.product_name,
    point_value: Number(row.point_value),
    category: categoryLabel(row.category),
    scope: row.user_id === null ? 'global' : 'private',
  }));
}

export async function updateVisibleProductPoint(
  userId: number,
  productId: number,
  variantId: number | null,
  pointValue: number,
) {
  const points = Math.floor(Number(pointValue));
  if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(productId) || productId <= 0 || !Number.isFinite(points) || points <= 0 || points > 9999) return null;

  if (variantId !== null) {
    if (!Number.isInteger(variantId) || variantId <= 0) return null;
    const visibleVariant = await queryOne<{ id: string }>(`
      SELECT pv.id
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE p.id = $2
        AND pv.id = $3
        AND p.is_active = TRUE
        AND pv.is_active = TRUE
        AND (p.user_id IS NULL OR p.user_id = $1)
      LIMIT 1
    `, [userId, productId, variantId]);
    if (!visibleVariant) return null;
    return syncVariantPointValue(productId, variantId, points);
  }

  const visibleProduct = await queryOne<{ id: string }>(`
    SELECT p.id
    FROM products p
    WHERE p.id = $2
      AND p.is_active = TRUE
      AND (p.user_id IS NULL OR p.user_id = $1)
    LIMIT 1
  `, [userId, productId]);
  if (!visibleProduct) return null;
  return syncProductPointValue(productId, points);
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
  previous_point_value?: number | null;
  search_score?: number | string | null;
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
    previous_point_value: r.previous_point_value === null || r.previous_point_value === undefined ? null : Number(r.previous_point_value),
    search_score: Number(r.search_score ?? 0),
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
  previous_point_value: number | null;
  search_score: number | string | null;
};

function hydrateSearchRows(rows: SearchableProductRow[]): SearchableProduct[] {
  return applyDefaultProductAliases(rows.map((r) => rowToProduct(r))).map((product, index) => ({ ...product, sale_count: Number(rows[index]?.sale_count ?? 0) }));
}

const PRODUCT_SEARCH_TIMEOUT_MS = 2_000;
const PRODUCT_SEARCH_CANDIDATE_LIMIT = 1_000;

async function querySearchProducts(text: string, params: unknown[]): Promise<SearchableProductRow[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SELECT set_config('statement_timeout', $1, true)", [String(PRODUCT_SEARCH_TIMEOUT_MS)]);
    const result = await client.query<SearchableProductRow>(text, params);
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listSearchableProducts(userId: number, search = '', limit = 60): Promise<SearchableProduct[]> {
 await applyDueMonthlyPointCampaigns();
 const preparedSearch = prepareProductSearchQuery(search);
 if (!preparedSearch) throw new RangeError('invalid product search query');
 const previousMonth = getPreviousTokyoMonthKey();
  const hasSearch = preparedSearch.terms.length > 0;
  const safeLimit = Math.max(1, Math.min(Number(limit) || 60, hasSearch ? 200 : 1000));
  const rows = await querySearchProducts(
    `WITH search_terms AS MATERIALIZED (
       SELECT DISTINCT term,
              CASE WHEN char_length(term) >= 4 THEN 0.34::real ELSE 0::real END AS fuzzy_ratio
       FROM unnest($2::text[]) AS term
       WHERE term <> ''
     ),
     search_candidates AS MATERIALIZED (
       SELECT *
       FROM sugi.search_product_candidates($1, $2::text[])
     ),
     product_matches AS MATERIALIZED (
       SELECT product_id, term, search_score
       FROM search_candidates
       WHERE product_id IS NOT NULL
     ),
     variant_matches AS MATERIALIZED (
       SELECT variant_id, term, search_score
       FROM search_candidates
       WHERE variant_id IS NOT NULL
     ),
     sale_counts AS (
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
            previous_campaign.point_value AS previous_point_value,
            COALESCE(sc.sale_count, 0)::text AS sale_count,
            CASE
              WHEN cardinality($2::text[]) = 0 THEN 0
              ELSE GREATEST(COALESCE(search_match.search_score, 0), 1)
            END AS search_score
     FROM products p
     LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = TRUE
     LEFT JOIN sale_counts sc ON sc.product_id = p.id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS matched_terms,
              SUM(term_match.search_score)::double precision AS search_score
       FROM (
         SELECT search_terms.term,
                GREATEST(
                  COALESCE(product_matches.search_score, 0),
                  COALESCE(variant_matches.search_score, 0)
                ) AS search_score
         FROM search_terms
         LEFT JOIN product_matches
           ON product_matches.product_id = p.id
          AND product_matches.term = search_terms.term
         LEFT JOIN variant_matches
           ON variant_matches.variant_id = pv.id
          AND variant_matches.term = search_terms.term
         WHERE product_matches.product_id IS NOT NULL
            OR variant_matches.variant_id IS NOT NULL
       ) AS term_match
     ) AS search_match ON TRUE
     LEFT JOIN sugi_point_campaign_items previous_campaign
       ON previous_campaign.campaign_month = $4
      AND previous_campaign.product_id = p.id
      AND (
        (pv.id IS NULL AND previous_campaign.target_type = 'product' AND previous_campaign.variant_id IS NULL) OR
        (pv.id IS NOT NULL AND previous_campaign.target_type = 'variant' AND previous_campaign.variant_id = pv.id)
      )
     WHERE p.is_active = TRUE
       AND (p.user_id IS NULL OR p.user_id = $1)
       AND (
         cardinality($2::text[]) = 0 OR
         search_match.matched_terms = (SELECT COUNT(*) FROM search_terms)
       )
     ORDER BY search_score DESC, COALESCE(sc.sale_count, 0) DESC, p.product_name, pv.unit_count NULLS LAST, pv.id
     LIMIT $3`,
    [userId, preparedSearch.terms, PRODUCT_SEARCH_CANDIDATE_LIMIT, previousMonth]
  );
  const products = hydrateSearchRows(rows);
  return rankProductsForSearch(products, preparedSearch.query, safeLimit);
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

export type QuickCreatedProduct = Product & { variant_id?: number | null; variant_label?: string | null };

export async function createQuickProduct(input: {
  userId: number;
  productName: string;
  pointValue: number;
  aliases?: unknown;
  parentProductId?: number | null;
  variantLabel?: string | null;
}): Promise<QuickCreatedProduct | null> {
  const plan = buildQuickProductPlan(input);
  if (!plan) return null;

  if (plan.mode === 'variant') {
    // Once a product has DB variants, the family UI intentionally hides its base row.
    // Preserve the original base points as a standard variant before adding the first
    // custom option, so upgrading a main product never makes its old option disappear.
    await query(
      `INSERT INTO product_variants
         (product_id, variant_label, display_shortcut, unit_count, point_value, nicknames, is_active)
       SELECT p.id, '標準', '標準', 1, p.point_value, p.nicknames, TRUE
       FROM products p
       WHERE p.id = $1 AND p.is_active = TRUE AND (p.user_id IS NULL OR p.user_id = $2)
         AND p.point_value > 0
         AND NOT EXISTS (
           SELECT 1 FROM product_variants existing
           WHERE existing.product_id = p.id AND existing.is_active = TRUE
         )
       ON CONFLICT (product_id, variant_label) DO UPDATE SET
         point_value = EXCLUDED.point_value,
         nicknames = EXCLUDED.nicknames,
         is_active = TRUE,
         updated_at = now()`,
      [plan.parentProductId, input.userId]
    );

    const variantRow = await queryOne<{
      id: string;
      product_id: string;
      product_name: string;
      category: string | null;
      user_id: string | null;
      variant_label: string;
      point_value: number;
    }>(
      `INSERT INTO product_variants
         (product_id, variant_label, display_shortcut, unit_count, point_value, nicknames, is_active)
       SELECT p.id, $3, NULL, 1, $4, $5, TRUE
       FROM products p
       WHERE p.id = $1 AND p.is_active = TRUE AND (p.user_id IS NULL OR p.user_id = $2)
       ON CONFLICT (product_id, variant_label) DO UPDATE SET
         point_value = EXCLUDED.point_value,
         nicknames = (
           SELECT array(
             SELECT DISTINCT x
             FROM unnest(COALESCE(product_variants.nicknames, ARRAY[]::text[]) || EXCLUDED.nicknames) x
             WHERE x IS NOT NULL AND trim(x) <> ''
           )
         ),
         is_active = TRUE,
         updated_at = now()
       RETURNING id, product_id,
         (SELECT product_name FROM products WHERE id = product_id) AS product_name,
         (SELECT category FROM products WHERE id = product_id) AS category,
         (SELECT user_id FROM products WHERE id = product_id) AS user_id,
         variant_label, point_value`,
      [plan.parentProductId, input.userId, plan.variantLabel, plan.pointValue, plan.aliases]
    );
    if (!variantRow) return null;
    return {
      id: Number(variantRow.product_id),
      product_name: variantRow.product_name,
      point_value: Number(variantRow.point_value),
      category: categoryLabel(variantRow.category),
      scope: variantRow.user_id === null ? 'global' : 'private',
      variant_id: Number(variantRow.id),
      variant_label: variantRow.variant_label,
    };
  }

  const row = await queryOne<{ id: string; product_name: string; point_value: number; category: string | null; user_id: string | null }>(
    `INSERT INTO products (product_name, category, point_value, nicknames, is_active, user_id)
     VALUES ($1, 'ヘルスケア', $2, $3, TRUE, NULL)
     ON CONFLICT (product_name) DO UPDATE SET
       point_value = EXCLUDED.point_value,
       nicknames = (SELECT array(SELECT DISTINCT x FROM unnest(COALESCE(products.nicknames, ARRAY[]::text[]) || EXCLUDED.nicknames) x WHERE x IS NOT NULL AND trim(x) <> '')),
       is_active = TRUE,
       updated_at = now()
     RETURNING id, product_name, point_value, category, user_id`,
    [plan.productName, plan.pointValue, plan.aliases]
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
 await applyDueMonthlyPointCampaigns();
 const validDate = validSaleDate(soldDate) ?? todaySaleDate();
  const product = variantId ? await getVisibleProductVariant(userId, productId, variantId) : await getVisibleProduct(userId, productId);
  if (!product || !isLoggableProduct(product)) return null;
  const qty = quantity;

  // Every distinct tap claims its own receipt. The sale row itself is coalesced by
  // user/date/product, so repeated taps increase quantity while retries remain safe.
  const key = idempotencyKey && isValidIdempotencyKey(idempotencyKey) ? idempotencyKey : null;
  let inserted: TodaySale | null = null;
  let replay = false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (key) {
      const claimed = await client.query(
        `INSERT INTO sale_idempotency_receipts (user_id, idempotency_key)
         VALUES ($1, $2)
         ON CONFLICT (user_id, idempotency_key) DO NOTHING
         RETURNING idempotency_key`,
        [userId, key],
      );
      if (claimed.rowCount === 0) {
        const replayed = await client.query<TodaySale>(
          `SELECT sale.id, sale.product_name, sale.quantity, sale.points_per_item, sale.total_points
           FROM sale_idempotency_receipts receipt
           JOIN sales_logs sale ON sale.id = receipt.sale_id
           WHERE receipt.user_id = $1 AND receipt.idempotency_key = $2
           LIMIT 1`,
          [userId, key],
        );
        inserted = replayed.rows[0] ?? null;
        replay = true;
      }
    }

    if (!replay) {
      const merged = await client.query<TodaySale>(
        `INSERT INTO sales_logs (sold_date, user_id, product_id, product_name, quantity, points_per_item, idempotency_key)
         VALUES ($6::date, $1, $2, $3, $4, $5, $7)
         ON CONFLICT (user_id, sold_date, product_id, product_name)
         WHERE user_id IS NOT NULL AND product_id IS NOT NULL
         DO UPDATE SET
           quantity = sales_logs.quantity + EXCLUDED.quantity,
           points_per_item = EXCLUDED.points_per_item,
           idempotency_key = COALESCE(sales_logs.idempotency_key, EXCLUDED.idempotency_key),
           created_at = now()
         RETURNING id, product_name, quantity, points_per_item, total_points`,
        [userId, product.id, product.product_name, qty, product.point_value, validDate, key],
      );
      inserted = merged.rows[0] ?? null;
      if (key && inserted) {
        await client.query(
          `UPDATE sale_idempotency_receipts
           SET sale_id = $3
           WHERE user_id = $1 AND idempotency_key = $2`,
          [userId, key, Number(inserted.id)],
        );
      }
    }

    if (!inserted) throw new Error('sale receipt exists without a sale row');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
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

  const base = await queryOne<{ id: string; product_name: string }>(`SELECT id, product_name FROM products WHERE id = $1`, [saleBefore.product_id]);
  if (base?.product_name && saleBefore.product_name !== base.product_name && saleBefore.product_name.startsWith(`${base.product_name} `)) {
    await syncVariantPointValueBySaleName(Number(base.id), saleBefore.product_name, points);
  } else {
    await syncProductPointValue(Number(saleBefore.product_id), points);
  }

  const sale = await queryOne<TodaySale>(
    `UPDATE sales_logs SET points_per_item = $3
     WHERE id = $1 AND user_id = $2 RETURNING id, product_name, quantity, points_per_item, total_points`,
    [saleId, userId, points]
  );
  return sale ? normalizeSale(sale) : null;
}

export async function deleteTodaySaleByProduct(userId: number, productId: number): Promise<TodaySale | null> {
  const today = todaySaleDate();
  const deleted = await queryOne<TodaySale>(
    `DELETE FROM sales_logs WHERE id = (
       SELECT id FROM sales_logs WHERE user_id = $1 AND sold_date = $3::date AND product_id = $2 ORDER BY created_at DESC, id DESC LIMIT 1
     ) RETURNING id, product_name, quantity, points_per_item, total_points`,
    [userId, productId, today]
  );
  return deleted ? normalizeSale(deleted) : null;
}
