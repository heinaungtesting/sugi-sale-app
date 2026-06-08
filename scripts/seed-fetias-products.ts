import { Pool } from 'pg';

const connectionString = process.env.SIGMA_RAG_PG_DSN ?? 'postgresql://sigma_rag@127.0.0.1:5433/sigma_rag';
const pool = new Pool({ connectionString });

type SeedProduct = {
  product_name: string;
  category: string;
  point_value: number;
  nicknames: string[];
};

const products: SeedProduct[] = [
  {
    product_name: 'フェイタスゲル',
    category: '外用鎮痛・湿布',
    point_value: 120,
    nicknames: ['fetas', 'fetias', 'fetiasgel', 'feitas', 'gel', 'フェイ', 'フェイタス', 'ジェル'],
  },
];

async function upsertProduct(product: SeedProduct) {
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM products WHERE product_name = $1 AND user_id IS NULL LIMIT 1`,
    [product.product_name]
  );

  if (existing.rows[0]) {
    await pool.query(
      `UPDATE products
       SET category = $2,
           point_value = $3,
           nicknames = $4,
           is_active = TRUE,
           updated_at = now()
       WHERE id = $1`,
      [existing.rows[0].id, product.category, product.point_value, product.nicknames]
    );
    return { action: 'updated', id: existing.rows[0].id, product_name: product.product_name };
  }

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO products (product_name, category, point_value, nicknames, is_active, user_id)
     VALUES ($1, $2, $3, $4, TRUE, NULL)
     RETURNING id`,
    [product.product_name, product.category, product.point_value, product.nicknames]
  );
  return { action: 'inserted', id: inserted.rows[0].id, product_name: product.product_name };
}

async function main() {
  const results = [];
  for (const product of products) {
    results.push(await upsertProduct(product));
  }
  console.log(JSON.stringify(results, null, 2));
}

main().finally(() => pool.end());
