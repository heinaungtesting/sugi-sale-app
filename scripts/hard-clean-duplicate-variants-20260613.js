const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function normExpr(sql) {
  return `lower(regexp_replace(${sql}, '[\\s　]+', '', 'g'))`;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.SIGMA_RAG_PG_DSN || 'postgresql://sigma_rag@127.0.0.1:5433/sigma_rag' });
  const client = await pool.connect();
  const backupDir = path.join(process.cwd(), 'backups', 'manual-imports');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    await client.query('BEGIN');

    const dupes = await client.query(`
      SELECT flat.id, flat.product_name, flat.point_value, flat.is_active,
             fam.id AS family_id, fam.product_name AS family_name,
             pv.id AS variant_id, pv.variant_label, pv.point_value AS variant_points,
             (SELECT COUNT(*)::int FROM sales_logs s WHERE s.product_id = flat.id) AS sale_count
      FROM products flat
      JOIN products fam ON fam.id <> flat.id AND fam.is_active = TRUE
      JOIN product_variants pv ON pv.product_id = fam.id AND pv.is_active = TRUE
      WHERE ${normExpr('flat.product_name')} = ${normExpr("fam.product_name || pv.variant_label")}
         OR ${normExpr('flat.product_name')} = ${normExpr("fam.product_name || ' ' || pv.variant_label")}
      ORDER BY flat.id
    `);

    const backupPath = path.join(backupDir, `hard-clean-duplicate-variants-before-${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(dupes.rows, null, 2));

    const deleteIds = dupes.rows.filter(r => Number(r.sale_count) === 0).map(r => Number(r.id));
    const deactivateIds = dupes.rows.filter(r => Number(r.sale_count) > 0).map(r => Number(r.id));

    let deletedProducts = [];
    if (deleteIds.length) {
      const del = await client.query(`DELETE FROM products WHERE id = ANY($1::bigint[]) RETURNING id, product_name`, [deleteIds]);
      deletedProducts = del.rows;
    }

    let deactivatedProducts = [];
    if (deactivateIds.length) {
      const upd = await client.query(`UPDATE products SET is_active = FALSE, updated_at = now() WHERE id = ANY($1::bigint[]) RETURNING id, product_name`, [deactivateIds]);
      deactivatedProducts = upd.rows;
    }

    const remaining = await client.query(`
      SELECT flat.id, flat.product_name, flat.is_active,
             (SELECT COUNT(*)::int FROM sales_logs s WHERE s.product_id = flat.id) AS sale_count
      FROM products flat
      JOIN products fam ON fam.id <> flat.id AND fam.is_active = TRUE
      JOIN product_variants pv ON pv.product_id = fam.id AND pv.is_active = TRUE
      WHERE flat.is_active = TRUE AND (
        ${normExpr('flat.product_name')} = ${normExpr("fam.product_name || pv.variant_label")}
        OR ${normExpr('flat.product_name')} = ${normExpr("fam.product_name || ' ' || pv.variant_label")}
      )
      ORDER BY flat.id
    `);

    if (remaining.rows.length) throw new Error(`Active duplicate flat products remain: ${JSON.stringify(remaining.rows.slice(0, 20))}`);

    await client.query('COMMIT');
    console.log(JSON.stringify({
      backupPath,
      detectedDuplicates: dupes.rowCount,
      deleteIds,
      deactivateIds,
      deletedCount: deletedProducts.length,
      deactivatedCount: deactivatedProducts.length,
      deletedProducts,
      deactivatedProducts,
      remainingActiveDuplicates: remaining.rowCount
    }, null, 2));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
