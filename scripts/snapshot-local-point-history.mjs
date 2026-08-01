import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const root = process.cwd();
const catalogPath = resolve(root, 'data/local-product-catalog.json');
const metaPath = resolve(root, 'data/local-product-catalog-meta.json');
const connectionString = process.env.SIGMA_RAG_PG_DSN ?? 'postgresql://sigma_rag@127.0.0.1:5433/sigma_rag';
const pool = new Pool({ connectionString, max: 1 });

try {
  const result = await pool.query(`
    SELECT campaign_month, target_type, product_id, variant_id, point_value
    FROM sugi_point_campaign_items
    WHERE campaign_month = (
      SELECT MAX(campaign_month)
      FROM sugi_point_campaigns
      WHERE status = 'applied'
        AND campaign_month < to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo'), 'YYYY-MM')
    )
    ORDER BY product_id, variant_id NULLS FIRST
  `);
  if (result.rows.length === 0) throw new Error('No applied previous-month point campaign found');

  const previousMonth = String(result.rows[0].campaign_month);
  const productPoints = new Map();
  const variantPoints = new Map();
  for (const row of result.rows) {
    if (row.target_type === 'variant' && row.variant_id) {
      variantPoints.set(`${row.product_id}:${row.variant_id}`, Number(row.point_value));
    } else if (row.target_type === 'product') {
      productPoints.set(Number(row.product_id), Number(row.point_value));
    }
  }

  const catalog = JSON.parse(await (await import('node:fs/promises')).readFile(catalogPath, 'utf8'));
  let matchedPositiveRows = 0;
  for (const item of catalog) {
    const previousPointValue = item.variant_id
      ? (variantPoints.get(`${item.id}:${item.variant_id}`) ?? 0)
      : (productPoints.get(Number(item.id)) ?? 0);
    item.previous_point_value = previousPointValue;
    if (previousPointValue > 0) matchedPositiveRows += 1;
  }

  await writeFile(catalogPath, `${JSON.stringify(catalog)}\n`);
  await writeFile(metaPath, `${JSON.stringify({ previous_month: previousMonth }, null, 2)}\n`);
  console.log(JSON.stringify({
    previousMonth,
    campaignItems: result.rows.length,
    catalogRows: catalog.length,
    matchedPositiveRows,
    unmatchedOrZeroRows: catalog.length - matchedPositiveRows,
  }));
} finally {
  await pool.end();
}
