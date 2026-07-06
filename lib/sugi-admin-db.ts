import bcrypt from 'bcryptjs';
import { pool, query, queryOne } from './db';
import { normalizeProductCategory } from './sugi-domain';
import { syncProductPointValue, syncVariantPointValue } from './sugi-point-sync';

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

export async function deleteSugiUserForAdmin(id: number, actorId: number) {
 if (id === actorId) return { id, deleted: false, reason: 'cannot_delete_self' };
 const refs = await queryOne<{ sale_count: string; product_count: string; session_count: string }>(`
 SELECT
 (SELECT COUNT(*) FROM sales_logs WHERE user_id=$1)::text AS sale_count,
 (SELECT COUNT(*) FROM products WHERE user_id=$1)::text AS product_count,
 (SELECT COUNT(*) FROM sugi_sessions WHERE user_id=$1)::text AS session_count
 `, [id]);
 const hasHistory = Number(refs?.sale_count ?? 0) > 0 || Number(refs?.product_count ?? 0) > 0;
 await query('DELETE FROM sugi_sessions WHERE user_id=$1', [id]);
 if (hasHistory) {
 const row = await queryOne(`UPDATE sugi_users SET is_active=FALSE, updated_at=now() WHERE id=$1 RETURNING id`, [id]);
 return { id: Number((row as any)?.id ?? id), deleted: Boolean(row), mode: 'deactivated' };
 }
 const row = await queryOne(`DELETE FROM sugi_users WHERE id=$1 RETURNING id`, [id]);
 return { id: Number((row as any)?.id ?? id), deleted: Boolean(row), mode: 'deleted' };
}

export async function listAdminProducts(search = '') {
 await applyDueMonthlyPointCampaigns();
 const term = String(search ?? '').normalize('NFKC').trim().toLowerCase();
  const products = await query<any>(`
    SELECT id, product_name, category, point_value, nicknames, is_active
    FROM products
    WHERE (
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
    WHERE product_id = ANY($1::bigint[])
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
 if (input.id) {
  const row = await queryOne(`UPDATE products SET product_name=$2, category=$3, nicknames=$4, is_active=$5, updated_at=now() WHERE id=$1 RETURNING id`, [input.id, name, category, nicks, input.is_active]);
  await syncProductPointValue(input.id, input.point_value);
  return row;
 }
 const row = await queryOne(`
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
 if (row) await syncProductPointValue(Number((row as any).id), input.point_value);
 return row;
 }

export async function deleteProductForAdmin(id: number) {
 const refs = await queryOne<{ sale_count: string }>(`SELECT COUNT(*)::text AS sale_count FROM sales_logs WHERE product_id=$1`, [id]);
 const hasSales = Number(refs?.sale_count ?? 0) > 0;
 if (hasSales) {
 await query('UPDATE product_variants SET is_active=FALSE, updated_at=now() WHERE product_id=$1', [id]);
 const row = await queryOne(`UPDATE products SET is_active=FALSE, updated_at=now() WHERE id=$1 RETURNING id`, [id]);
 return { id: Number((row as any)?.id ?? id), deleted: Boolean(row), mode: 'deactivated' };
 }
 const row = await queryOne(`DELETE FROM products WHERE id=$1 RETURNING id`, [id]);
 return { id: Number((row as any)?.id ?? id), deleted: Boolean(row), mode: 'deleted' };
}

export async function upsertProductVariant(input: { id?: number; product_id: number; variant_label: string; display_shortcut?: string; unit_count: number; point_value: number; nicknames: unknown; is_active: boolean }) {
  const nicks = aliases(input.nicknames);
  const label = input.variant_label.trim();
  const shortcut = (input.display_shortcut ?? '').trim() || label;
  if (input.id) {
    const row = await queryOne(`UPDATE product_variants SET variant_label=$2, display_shortcut=$3, unit_count=$4, nicknames=$5, is_active=$6, updated_at=now() WHERE id=$1 RETURNING id`, [input.id, label, shortcut, input.unit_count, nicks, input.is_active]);
    await syncVariantPointValue(input.product_id, input.id, input.point_value);
    return row;
  }
  const row = await queryOne(`
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
  if (row) await syncVariantPointValue(input.product_id, Number((row as any).id), input.point_value);
  return row;
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

type CampaignJsonProduct = Record<string, any>;
type CampaignJsonVariant = Record<string, any>;

export function getTokyoMonthKey(now = new Date()): string {
 const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).formatToParts(now);
 const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
 const month = parts.find((part) => part.type === 'month')?.value ?? '01';
 return `${year}-${month}`;
}

export function getNextTokyoMonthKey(now = new Date()): string {
 const [year, month] = getTokyoMonthKey(now).split('-').map(Number);
 const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
 return `${next.year}-${String(next.month).padStart(2, '0')}`;
}

function normalizeKey(value: string): string {
 return value.normalize('NFKC').replace(/\s+/g, '').trim().toLowerCase();
}

function jsonItems(payload: unknown): CampaignJsonProduct[] {
 return Array.isArray(payload) ? payload as CampaignJsonProduct[] : [payload as CampaignJsonProduct];
}

async function findOrCreateCampaignProduct(client: any, item: CampaignJsonProduct) {
 const product_name = pickString(item, ['product_name', 'name_ja', 'name', 'productName']);
 if (!product_name) return null;
 const category = normalizeProductCategory(pickString(item, ['category'], 'ヘルスケア'));
 const nicks = aliases(item?.nicknames ?? item?.aliases ?? []);
 const normalized = normalizeKey(product_name);
 let row = await client.query(`
 SELECT id, product_name FROM products
 WHERE regexp_replace(lower(product_name), '\\s+', '', 'g') = $1
 OR regexp_replace(lower(product_name), '\\s+', '', 'g') LIKE '%' || $1 || '%'
 OR $1 LIKE '%' || regexp_replace(lower(product_name), '\\s+', '', 'g') || '%'
 OR EXISTS (SELECT 1 FROM unnest(COALESCE(nicknames, ARRAY[]::text[])) AS nick WHERE regexp_replace(lower(nick), '\\s+', '', 'g') = $1)
 ORDER BY length(product_name) ASC
 LIMIT 1
 `, [normalized]);
 if (row.rows[0]) {
  const updated = await client.query(`
  UPDATE products SET category=$2,
  nicknames=(SELECT array(SELECT DISTINCT x FROM unnest(COALESCE(products.nicknames, ARRAY[]::text[]) || $3::text[]) x WHERE x IS NOT NULL AND trim(x) <> '')),
  is_active=TRUE,
  updated_at=now()
  WHERE id=$1 RETURNING id, product_name
  `, [row.rows[0].id, category, nicks]);
  return updated.rows[0];
 }
 row = await client.query(`
 INSERT INTO products (product_name, category, point_value, nicknames, is_active, user_id)
 VALUES ($1, $2, 0, $3, TRUE, NULL)
 RETURNING id, product_name
 `, [product_name.trim(), category, nicks]);
 return row.rows[0];
}

async function findOrCreateCampaignVariant(client: any, productId: number, variant: CampaignJsonVariant, fallbackPointValue: number) {
 const shortcut = pickString(variant, ['display_shortcut', 'shortcut', 'displayShortcut'], '通常');
 const variant_label = pickString(variant, ['variant_label', 'label', 'name', 'variantLabel'], shortcut);
 if (!variant_label) return null;
 const unitCount = pickNumber(variant, ['unit_count', 'unitCount'], 1);
 const nicks = aliases(variant?.nicknames ?? variant?.aliases ?? []);
 const normalized = normalizeKey(variant_label);
 let row = await client.query(`
 SELECT id, variant_label FROM product_variants
 WHERE product_id=$1 AND (
 regexp_replace(lower(variant_label), '\\s+', '', 'g') = $2 OR
 regexp_replace(lower(COALESCE(display_shortcut, '')), '\\s+', '', 'g') = $2 OR
 EXISTS (SELECT 1 FROM unnest(COALESCE(nicknames, ARRAY[]::text[])) AS nick WHERE regexp_replace(lower(nick), '\\s+', '', 'g') = $2)
 )
 LIMIT 1
 `, [productId, normalized]);
 if (row.rows[0]) {
  const updated = await client.query(`
  UPDATE product_variants SET display_shortcut=$2, unit_count=$3,
  nicknames=(SELECT array(SELECT DISTINCT x FROM unnest(COALESCE(product_variants.nicknames, ARRAY[]::text[]) || $4::text[]) x WHERE x IS NOT NULL AND trim(x) <> '')),
  is_active=TRUE,
  updated_at=now()
  WHERE id=$1 RETURNING id, variant_label
  `, [row.rows[0].id, shortcut, unitCount, nicks]);
  return updated.rows[0];
 }
 row = await client.query(`
 INSERT INTO product_variants (product_id, variant_label, display_shortcut, unit_count, point_value, nicknames, is_active)
 VALUES ($1,$2,$3,$4,0,$5,TRUE)
 RETURNING id, variant_label
 `, [productId, variant_label.trim(), shortcut, unitCount, nicks]);
 return row.rows[0];
}

export async function stageNextMonthPointCampaignFromJson(payload: unknown, now = new Date()) {
 const campaignMonth = getNextTokyoMonthKey(now);
 const client = await pool.connect();
 const results: any[] = [];
 try {
  await client.query('BEGIN');
  await client.query(`
  INSERT INTO sugi_point_campaigns (campaign_month, replace_all, status, created_at, applied_at)
  VALUES ($1, TRUE, 'staged', now(), NULL)
  ON CONFLICT (campaign_month) DO UPDATE SET replace_all=TRUE, status='staged', created_at=now(), applied_at=NULL
  `, [campaignMonth]);
  await client.query('DELETE FROM sugi_point_campaign_items WHERE campaign_month=$1', [campaignMonth]);

  for (const item of jsonItems(payload)) {
   const productName = pickString(item, ['product_name', 'name_ja', 'name', 'productName']);
   if (!productName) {
    results.push({ kind: 'error', error: 'missing product_name' });
    continue;
   }
   const product = await findOrCreateCampaignProduct(client, item);
   if (!product) {
    results.push({ kind: 'error', product_name: productName, error: 'product not saved' });
    continue;
   }
   const variants = Array.isArray(item?.variants) ? item.variants : [];
   if (variants.length === 0) {
    const pointValue = pickNumber(item, ['point_value', 'points', 'pointValue'], 0);
    await client.query(`
    INSERT INTO sugi_point_campaign_items (campaign_month, target_type, product_id, product_name, point_value, aliases, source)
    VALUES ($1, 'product', $2, $3, $4, $5, $6::jsonb)
    `, [campaignMonth, product.id, product.product_name, pointValue, aliases(item?.nicknames ?? item?.aliases ?? []), JSON.stringify(item)]);
    results.push({ kind: 'staged_product', campaign_month: campaignMonth, product_name: product.product_name, point_value: pointValue });
    continue;
   }
   const variantResults = [];
   for (const variant of variants) {
    const savedVariant = await findOrCreateCampaignVariant(client, Number(product.id), variant, pickNumber(item, ['point_value', 'points', 'pointValue'], 0));
    if (!savedVariant) continue;
    const pointValue = pickNumber(variant, ['point_value', 'points', 'pointValue'], pickNumber(item, ['point_value', 'points', 'pointValue'], 0));
    await client.query(`
    INSERT INTO sugi_point_campaign_items (campaign_month, target_type, product_id, variant_id, product_name, variant_label, point_value, aliases, source)
    VALUES ($1, 'variant', $2, $3, $4, $5, $6, $7, $8::jsonb)
    `, [campaignMonth, product.id, savedVariant.id, product.product_name, savedVariant.variant_label, pointValue, aliases(variant?.nicknames ?? variant?.aliases ?? []), JSON.stringify(variant)]);
    variantResults.push({ variant_label: savedVariant.variant_label, point_value: pointValue });
   }
   results.push({ kind: 'staged_product', campaign_month: campaignMonth, product_name: product.product_name, variants: variantResults });
  }
  await client.query('COMMIT');
  return { campaign_month: campaignMonth, count: results.length, results };
 } catch (error) {
  await client.query('ROLLBACK');
  throw error;
 } finally {
  client.release();
 }
}

export async function applyDueMonthlyPointCampaigns(now = new Date()) {
 const currentMonth = getTokyoMonthKey(now);
 const client = await pool.connect();
 const applied: string[] = [];
 try {
  await client.query('BEGIN');
  const campaigns = await client.query(`
  SELECT campaign_month, replace_all FROM sugi_point_campaigns
  WHERE status = 'staged' AND campaign_month <= $1
  ORDER BY campaign_month ASC
  FOR UPDATE
  `, [currentMonth]);
  for (const campaign of campaigns.rows) {
   if (campaign.replace_all) {
    await client.query(`UPDATE product_variants SET point_value = 0, updated_at = now() WHERE is_active = TRUE`);
    await client.query(`UPDATE products SET point_value = 0, updated_at = now() WHERE is_active = TRUE`);
   }
   await client.query(`
   UPDATE products p
   SET point_value = item.point_value, is_active = TRUE, updated_at = now()
   FROM sugi_point_campaign_items item
   WHERE item.campaign_month = $1 AND item.target_type = 'product' AND item.product_id = p.id
   `, [campaign.campaign_month]);
   await client.query(`
   UPDATE product_variants pv
   SET point_value = item.point_value, is_active = TRUE, updated_at = now()
   FROM sugi_point_campaign_items item
   WHERE item.campaign_month = $1 AND item.target_type = 'variant' AND item.variant_id = pv.id
   `, [campaign.campaign_month]);
   await client.query(`UPDATE sugi_point_campaigns SET status='applied', applied_at=now() WHERE campaign_month=$1`, [campaign.campaign_month]);
   applied.push(campaign.campaign_month);
  }
  await client.query('COMMIT');
  return applied;
 } catch (error) {
  await client.query('ROLLBACK');
  throw error;
 } finally {
  client.release();
 }
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
      SELECT pv.id, pv.product_id, p.product_name, pv.variant_label
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
      await syncVariantPointValue(Number(vrow.product_id), Number(vrow.id), pts);
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
      await syncProductPointValue(Number(prow.id), pts);
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
