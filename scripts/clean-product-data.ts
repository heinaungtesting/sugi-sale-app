import { Pool } from 'pg';

const connectionString = process.env.SIGMA_RAG_PG_DSN ?? 'postgresql://sigma_rag@127.0.0.1:5433/sigma_rag';
const pool = new Pool({ connectionString });

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inactiveVariants = await client.query(`
      UPDATE product_variants pv
      SET is_active = FALSE, updated_at = now()
      WHERE pv.is_active = TRUE
        AND pv.point_value <= 0
        AND NOT EXISTS (
          SELECT 1
          FROM sales_logs s
          JOIN products p ON p.id = pv.product_id
          WHERE s.product_id = pv.product_id
            AND s.product_name = p.product_name || ' ' || pv.variant_label
        )
      RETURNING pv.id, pv.product_id, pv.variant_label, pv.point_value
    `);

    const inactiveProducts = await client.query(`
      UPDATE products p
      SET is_active = FALSE, updated_at = now()
      WHERE p.is_active = TRUE
        AND p.point_value <= 0
        AND NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = TRUE AND pv.point_value > 0)
        AND NOT EXISTS (SELECT 1 FROM sales_logs s WHERE s.product_id = p.id)
      RETURNING p.id, p.product_name, p.point_value
    `);

    const stats = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM products) AS products_total,
        (SELECT COUNT(*) FROM products WHERE is_active = TRUE) AS products_active,
        (SELECT COUNT(*) FROM products WHERE is_active = TRUE AND point_value <= 0) AS active_zero_point_products,
        (SELECT COUNT(*) FROM product_variants) AS variants_total,
        (SELECT COUNT(*) FROM product_variants WHERE is_active = TRUE) AS variants_active,
        (SELECT COUNT(*) FROM product_variants WHERE is_active = TRUE AND point_value <= 0) AS active_zero_point_variants
    `);

    await client.query('COMMIT');
    console.log(JSON.stringify({
      deactivated_products: inactiveProducts.rows,
      deactivated_variants: inactiveVariants.rows,
      stats: stats.rows[0],
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
