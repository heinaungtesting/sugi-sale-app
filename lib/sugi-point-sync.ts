import { query, queryOne } from './db';

function normalizePointValue(pointValue: number): number | null {
  const points = Math.floor(Number(pointValue));
  if (!Number.isFinite(points) || points <= 0 || points > 9999) return null;
  return points;
}

const NORMALIZED_PRODUCT_NAME = "regexp_replace(lower(product_name), '\\s+', '', 'g')";
const NORMALIZED_SQL = "regexp_replace(lower($$VALUE$$), '\\s+', '', 'g')";

function normalizedExpr(sql: string): string {
  if (sql === 'product_name') return NORMALIZED_PRODUCT_NAME;
  return NORMALIZED_SQL.replace('$$VALUE$$', sql);
}

async function syncFlatProductsForVariant(productId: number | string, variantId: number | string, points: number) {
  const variant = await queryOne<{ product_name: string; variant_label: string; display_shortcut: string | null }>(`
    SELECT p.product_name, pv.variant_label, pv.display_shortcut
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.id = $1 AND p.id = $2
    LIMIT 1
  `, [variantId, productId]);
  if (!variant) return;

  await query(`
    UPDATE products
    SET point_value = $1, updated_at = now()
    WHERE id <> $2
      AND is_active = TRUE
      AND (
        ${normalizedExpr('product_name')} = ${normalizedExpr("$3")}
        OR ${normalizedExpr('product_name')} = ${normalizedExpr("$4")}
      )
  `, [points, productId, `${variant.product_name} ${variant.variant_label}`, `${variant.product_name} ${variant.display_shortcut || variant.variant_label}`]);
}

async function syncFamilyVariantForFlatProduct(productId: number | string, productName: string, points: number) {
  await query(`
    UPDATE product_variants pv
    SET point_value = $1, updated_at = now()
    FROM products p
    WHERE p.id = pv.product_id
      AND p.is_active = TRUE
      AND pv.is_active = TRUE
      AND p.id <> $2
      AND (
        ${normalizedExpr("p.product_name || ' ' || pv.variant_label")} = ${normalizedExpr('$3')}
        OR ${normalizedExpr("p.product_name || ' ' || COALESCE(NULLIF(pv.display_shortcut, ''), pv.variant_label)")} = ${normalizedExpr('$3')}
      )
  `, [points, productId, productName]);
}

export async function syncProductPointValue(productId: number, pointValue: number) {
  const points = normalizePointValue(pointValue);
  if (points === null) return null;

  const product = await queryOne<{ id: string; product_name: string }>(`
    UPDATE products SET point_value = $1, updated_at = now()
    WHERE id = $2
    RETURNING id, product_name
  `, [points, productId]);
  if (!product) return null;

  await syncFamilyVariantForFlatProduct(product.id, product.product_name, points);
  return { id: Number(product.id), point_value: points };
}

export async function syncVariantPointValue(productId: number, variantId: number, pointValue: number) {
  const points = normalizePointValue(pointValue);
  if (points === null) return null;

  const variant = await queryOne<{ id: string; product_id: string }>(`
    UPDATE product_variants SET point_value = $1, updated_at = now()
    WHERE id = $2 AND product_id = $3
    RETURNING id, product_id
  `, [points, variantId, productId]);
  if (!variant) return null;

  await syncFlatProductsForVariant(productId, variantId, points);
  return { id: Number(variant.id), product_id: Number(variant.product_id), point_value: points };
}

export async function syncVariantPointValueBySaleName(productId: number, saleProductName: string, pointValue: number) {
  const points = normalizePointValue(pointValue);
  if (points === null) return null;

  const variant = await queryOne<{ id: string; product_id: string }>(`
    UPDATE product_variants pv
    SET point_value = $1, updated_at = now()
    FROM products p
    WHERE pv.product_id = p.id
      AND p.id = $2
      AND pv.is_active = TRUE
      AND (
        ${normalizedExpr("p.product_name || ' ' || pv.variant_label")} = ${normalizedExpr('$3')}
        OR ${normalizedExpr("p.product_name || ' ' || COALESCE(NULLIF(pv.display_shortcut, ''), pv.variant_label)")} = ${normalizedExpr('$3')}
      )
    RETURNING pv.id, pv.product_id
  `, [points, productId, saleProductName]);
  if (!variant) return null;

  await syncFlatProductsForVariant(productId, variant.id, points);
  return { id: Number(variant.id), product_id: Number(variant.product_id), point_value: points };
}
