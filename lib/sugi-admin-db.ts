import bcrypt from 'bcryptjs';
import { query, queryOne } from './db';
import { normalizeProductCategory } from './sugi-domain';

export async function requireAdmin(user: { role: string } | null) {
  return Boolean(user && user.role === 'admin');
}

function aliases(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  return String(value ?? '').split(',').map((v) => v.trim()).filter(Boolean);
}

export async function listAdminUsers() {
  return query(`SELECT id, username, display_name, role, is_active, created_at::text, updated_at::text FROM sugi_users ORDER BY id`);
}

export async function createSugiUser(input: { username: string; display_name: string; pin: string; role: string }) {
  const pin_hash = await bcrypt.hash(input.pin, 10);
  return queryOne(`INSERT INTO sugi_users (username, display_name, pin_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`, [
    input.username.trim().toLowerCase(),
    input.display_name.trim(),
    pin_hash,
    input.role === 'admin' ? 'admin' : 'user',
  ]);
}

export async function updateSugiUser(input: { id: number; username: string; display_name: string; pin?: string; role: string; is_active: boolean }) {
  if (input.pin) {
    const pin_hash = await bcrypt.hash(input.pin, 10);
    return queryOne(`UPDATE sugi_users SET username=$2, display_name=$3, pin_hash=$4, role=$5, is_active=$6, updated_at=now() WHERE id=$1 RETURNING id`, [input.id, input.username.trim().toLowerCase(), input.display_name.trim(), pin_hash, input.role === 'admin' ? 'admin' : 'user', input.is_active]);
  }
  return queryOne(`UPDATE sugi_users SET username=$2, display_name=$3, role=$4, is_active=$5, updated_at=now() WHERE id=$1 RETURNING id`, [input.id, input.username.trim().toLowerCase(), input.display_name.trim(), input.role === 'admin' ? 'admin' : 'user', input.is_active]);
}

export async function listAdminProducts(search = '') {
  const term = String(search ?? '').normalize('NFKC').trim().toLowerCase();
  const products = await query<any>(`
    SELECT id, product_name, category, point_value, nicknames, is_active
    FROM products
    WHERE is_active = TRUE AND (
      $1 = '' OR
      regexp_replace(lower(product_name), '\\s+', '', 'g') LIKE '%' || regexp_replace($1, '\\s+', '', 'g') || '%' OR
      EXISTS (SELECT 1 FROM unnest(COALESCE(nicknames, ARRAY[]::text[])) AS nick WHERE regexp_replace(lower(nick), '\\s+', '', 'g') LIKE '%' || regexp_replace($1, '\\s+', '', 'g') || '%')
    )
    ORDER BY is_active DESC, product_name
    LIMIT 120
  `, [term]);
  const ids = products.map((product) => Number(product.id));
  const variants = ids.length === 0 ? [] : await query<any>(`
    SELECT id, product_id, variant_label, display_shortcut, unit_count, point_value, nicknames, is_active
    FROM product_variants
    WHERE product_id = ANY($1::bigint[]) AND is_active = TRUE
    ORDER BY product_id, is_active DESC, unit_count, id
  `, [ids]);
  const byProduct = new Map<number, any[]>();
  for (const variant of variants) {
    const key = Number(variant.product_id);
    byProduct.set(key, [...(byProduct.get(key) ?? []), { ...variant, id: Number(variant.id), product_id: key, point_value: Number(variant.point_value), unit_count: Number(variant.unit_count) }]);
  }
  return products.map((product) => ({ ...product, id: Number(product.id), point_value: Number(product.point_value), variants: byProduct.get(Number(product.id)) ?? [] }));
}

export async function upsertProduct(input: { id?: number; product_name: string; category: string; point_value: number; nicknames: unknown; is_active: boolean }) {
 const nicks = aliases(input.nicknames);
 const name = input.product_name.trim();
 const category = normalizeProductCategory(input.category);
 if (input.id) return queryOne(`UPDATE products SET product_name=$2, category=$3, point_value=$4, nicknames=$5, is_active=$6, updated_at=now() WHERE id=$1 RETURNING id`, [input.id, name, category, input.point_value, nicks, input.is_active]);
 return queryOne(`
 INSERT INTO products (product_name, category, point_value, nicknames, is_active)
 VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (product_name) DO UPDATE SET
      category = COALESCE(EXCLUDED.category, products.category),
      point_value = EXCLUDED.point_value,
      nicknames = (SELECT array(SELECT DISTINCT x FROM unnest(COALESCE(products.nicknames, ARRAY[]::text[]) || COALESCE(EXCLUDED.nicknames, ARRAY[]::text[])) x WHERE x IS NOT NULL AND trim(x) <> '')),
      is_active = EXCLUDED.is_active,
      updated_at = now()
      RETURNING id
      `, [name, category, input.point_value, nicks, input.is_active]);
      }

export async function upsertProductVariant(input: { id?: number; product_id: number; variant_label: string; display_shortcut?: string; unit_count: number; point_value: number; nicknames: unknown; is_active: boolean }) {
  const nicks = aliases(input.nicknames);
  const label = input.variant_label.trim();
  const shortcut = (input.display_shortcut ?? '').trim() || label;
  if (input.id) return queryOne(`UPDATE product_variants SET variant_label=$2, display_shortcut=$3, unit_count=$4, point_value=$5, nicknames=$6, is_active=$7, updated_at=now() WHERE id=$1 RETURNING id`, [input.id, label, shortcut, input.unit_count, input.point_value, nicks, input.is_active]);
  return queryOne(`
    INSERT INTO product_variants (product_id, variant_label, display_shortcut, unit_count, point_value, nicknames, is_active)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (product_id, variant_label) DO UPDATE SET
      display_shortcut = EXCLUDED.display_shortcut,
      unit_count = EXCLUDED.unit_count,
      point_value = EXCLUDED.point_value,
      nicknames = (SELECT array(SELECT DISTINCT x FROM unnest(COALESCE(product_variants.nicknames, ARRAY[]::text[]) || COALESCE(EXCLUDED.nicknames, ARRAY[]::text[])) x WHERE x IS NOT NULL AND trim(x) <> '')),
      is_active = EXCLUDED.is_active,
      updated_at = now()
    RETURNING id
  `, [input.product_id, label, shortcut, input.unit_count, input.point_value, nicks, input.is_active]);
}

function pickString(input: any, keys: string[], fallback = ''): string {
  for (const key of keys) {
    if (typeof input?.[key] === 'string' && input[key].trim()) return input[key].trim();
  }
  return fallback;
}

function pickNumber(input: any, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = Number(input?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

export async function importProductsFromJson(payload: unknown) {
  const items = Array.isArray(payload) ? payload : [payload];
  const results: any[] = [];
  for (const item of items as any[]) {
    const product_name = pickString(item, ['product_name', 'name_ja', 'name', 'productName']);
    if (!product_name) {
      results.push({ kind: 'error', error: 'missing product_name' });
      continue;
    }
    const product = await upsertProduct({
      product_name,
      category: pickString(item, ['category'], 'ヘルスケア'),
      point_value: pickNumber(item, ['point_value', 'points', 'pointValue'], 0),
      nicknames: item?.nicknames ?? item?.aliases ?? [],
      is_active: item?.is_active !== false,
    });
    const productId = Number((product as any)?.id);
    const variants = Array.isArray(item?.variants) ? item.variants : [];
    const variantResults = [];
    for (const variant of variants) {
      const variant_label = pickString(variant, ['variant_label', 'label', 'name', 'variantLabel']);
      if (!variant_label) continue;
      const saved = await upsertProductVariant({
        product_id: productId,
        variant_label,
        display_shortcut: pickString(variant, ['display_shortcut', 'shortcut', 'displayShortcut'], variant_label),
        unit_count: pickNumber(variant, ['unit_count', 'unitCount'], 1),
        point_value: pickNumber(variant, ['point_value', 'points', 'pointValue'], pickNumber(item, ['point_value', 'points', 'pointValue'], 0)),
        nicknames: variant?.nicknames ?? variant?.aliases ?? [],
        is_active: variant?.is_active !== false,
      });
      variantResults.push({ id: Number((saved as any)?.id), variant_label });
    }
    results.push({ kind: 'product', id: productId, product_name, variants: variantResults });
  }
  return results;
}

export async function bulkSetPoints(updates: Array<{ query: string; point_value: number }>) {
  const results: any[] = [];
  for (const { query: q, point_value: pts } of updates) {
    const name = (q || '').trim();
    if (!name || typeof pts !== 'number') {
      results.push({ kind: 'error', query: q, error: 'invalid' });
      continue;
    }
    // Try matching variant by nickname, label or display_shortcut
    let vrow = await queryOne<any>(`
      SELECT pv.id, p.product_name, pv.variant_label
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.is_active = TRUE AND (
        $1 = ANY(pv.nicknames) OR $1 ILIKE ANY(pv.nicknames) OR
        lower(pv.variant_label) = lower($1) OR pv.variant_label ILIKE '%' || $1 || '%' OR
        lower(pv.display_shortcut) = lower($1)
      )
      LIMIT 1
    `, [name]);
    if (vrow) {
      await query(`UPDATE product_variants SET point_value = $1, updated_at = now() WHERE id = $2`, [pts, vrow.id]);
      results.push({ kind: 'variant', product_name: vrow.product_name, variant_label: vrow.variant_label, point_value: pts });
      continue;
    }
    // Try product by nickname or name
    let prow = await queryOne<any>(`
      SELECT id, product_name FROM products
      WHERE is_active = TRUE AND (
        $1 = ANY(nicknames) OR lower(product_name) = lower($1) OR product_name ILIKE '%' || $1 || '%'
      )
      LIMIT 1
    `, [name]);
    if (prow) {
      await query(`UPDATE products SET point_value = $1, updated_at = now() WHERE id = $2`, [pts, prow.id]);
      results.push({ kind: 'product', product_name: prow.product_name, point_value: pts });
      continue;
    }
    // Create minimal point-only product (like SugiBot set command)
    const created = await queryOne<any>(`
    INSERT INTO products (product_name, category, point_value, nicknames, is_active, user_id)
    VALUES ($1, 'ヘルスケア', $2, $3, TRUE, NULL)
    RETURNING id, product_name, point_value
    `, [name, pts, [name.toLowerCase()]]);
    if (created) {
      results.push({ kind: 'created', product_name: created.product_name, point_value: pts });
    } else {
      results.push({ kind: 'error', query: name });
    }
  }
  return results;
}
