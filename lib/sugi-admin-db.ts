import bcrypt from 'bcryptjs';
import { query, queryOne } from './db';

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

export async function listAdminProducts() {
  const products = await query<any>(`SELECT id, product_name, category, point_value, nicknames, is_active FROM products ORDER BY product_name LIMIT 200`);
  const variants = await query<any>(`SELECT id, product_id, variant_label, display_shortcut, unit_count, point_value, nicknames, is_active FROM product_variants ORDER BY product_id, unit_count, id`);
  const byProduct = new Map<number, any[]>();
  for (const variant of variants) {
    const key = Number(variant.product_id);
    byProduct.set(key, [...(byProduct.get(key) ?? []), { ...variant, id: Number(variant.id), product_id: key, point_value: Number(variant.point_value), unit_count: Number(variant.unit_count) }]);
  }
  return products.map((product) => ({ ...product, id: Number(product.id), point_value: Number(product.point_value), variants: byProduct.get(Number(product.id)) ?? [] }));
}

export async function upsertProduct(input: { id?: number; product_name: string; category: string; point_value: number; nicknames: unknown; is_active: boolean }) {
  const nicks = aliases(input.nicknames);
  if (input.id) return queryOne(`UPDATE products SET product_name=$2, category=$3, point_value=$4, nicknames=$5, is_active=$6, updated_at=now() WHERE id=$1 RETURNING id`, [input.id, input.product_name.trim(), input.category.trim() || null, input.point_value, nicks, input.is_active]);
  return queryOne(`INSERT INTO products (product_name, category, point_value, nicknames, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [input.product_name.trim(), input.category.trim() || null, input.point_value, nicks, input.is_active]);
}

export async function upsertProductVariant(input: { id?: number; product_id: number; variant_label: string; display_shortcut?: string; unit_count: number; point_value: number; nicknames: unknown; is_active: boolean }) {
  const nicks = aliases(input.nicknames);
  if (input.id) return queryOne(`UPDATE product_variants SET variant_label=$2, display_shortcut=$3, unit_count=$4, point_value=$5, nicknames=$6, is_active=$7, updated_at=now() WHERE id=$1 RETURNING id`, [input.id, input.variant_label.trim(), (input.display_shortcut ?? '').trim() || input.variant_label.trim(), input.unit_count, input.point_value, nicks, input.is_active]);
  return queryOne(`INSERT INTO product_variants (product_id, variant_label, display_shortcut, unit_count, point_value, nicknames, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [input.product_id, input.variant_label.trim(), (input.display_shortcut ?? '').trim() || input.variant_label.trim(), input.unit_count, input.point_value, nicks, input.is_active]);
}
