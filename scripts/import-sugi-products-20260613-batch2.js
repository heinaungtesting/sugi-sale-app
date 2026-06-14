const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATA = [
  {
    "productName": "モンダミン プレミアムケア",
    "variants": [
      {"name": "センシティブ 1300ml", "points": 80},
      {"name": "センシティブ パウチ 1700ml", "points": 80},
      {"name": "センシティブ 1300ml 2P", "points": 120},
      {"name": "通常 1300ml", "points": 80},
      {"name": "通常 パウチ 1700ml", "points": 80},
      {"name": "ストロングミント 1300ml", "points": 80},
      {"name": "ゴールド 1000ml", "points": 80},
      {"name": "ゴールド パウチ 1700ml", "points": 80},
      {"name": "ゴールド 1000ml 2P", "points": 120},
      {"name": "ゴールド 1000ml 2P+250ml", "points": 120},
      {"name": "ホワイト 1000ml", "points": 80},
      {"name": "ホワイト パウチ 1700ml", "points": 80},
      {"name": "ホワイト 1000ml 2P", "points": 120},
      {"name": "ホワイト 1000ml 2P+250ml", "points": 120},
      {"name": "シトラス 1000ml", "points": 80},
      {"name": "フッ素コート 1000ml", "points": 80},
      {"name": "プロッシュ 1000ml", "points": 80}
    ]
  },
  {
    "productName": "青汁",
    "variants": [
      {"name": "食物繊維 15包", "points": 50},
      {"name": "食物繊維 60包", "points": 250},
      {"name": "納豆 15包", "points": 250},
      {"name": "納豆 60包", "points": 250},
      {"name": "豆乳入り 56包", "points": 250},
      {"name": "野菜 50包", "points": 50},
      {"name": "野菜 お試し 12包", "points": 200},
      {"name": "ゴールド乳酸菌 150包", "points": 50}
    ]
  },
  {"productName": "乳酸菌EX", "variants": [{"name": "60粒", "points": 40}]},
  {
    "productName": "ミルク生活プラス",
    "variants": [
      {"name": "スティック", "points": 100},
      {"name": "スティック 3箱", "points": 60},
      {"name": "缶", "points": 100},
      {"name": "300g×2袋", "points": 100}
    ]
  },
  {
    "productName": "iMUSE 免疫ケア",
    "variants": [
      {"name": "7日分", "points": 10},
      {"name": "30日分", "points": 30},
      {"name": "60日分", "points": 60},
      {"name": "30日分 3個", "points": 100}
    ]
  },
  {
    "productName": "iMUSE マルチビタミン",
    "variants": [
      {"name": "7日分", "points": 10},
      {"name": "30日分", "points": 40},
      {"name": "30日分 3個", "points": 120}
    ]
  },
  {"productName": "iMUSE 脂肪ダウン", "variants": [{"name": "7日分", "points": 10}, {"name": "30日分", "points": 20}]},
  {"productName": "iMUSE 糖脂肪ダウン", "variants": [{"name": "14粒 7日分", "points": 10}, {"name": "60粒 30日分", "points": 70}]},
  {"productName": "オルニチン", "variants": [{"name": "2包 7日分", "points": 10}, {"name": "120粒 30日分", "points": 30}]},
  {"productName": "オルニチンPRO", "variants": [{"name": "42粒 7日分", "points": 10}, {"name": "180粒 30日分", "points": 70}]},
  {"productName": "コラーゲンドリンク", "variants": [{"name": "50本", "points": 250}]},
  {"productName": "Wラクトプラス", "variants": [{"name": "5000 10包", "points": 60}]},
  {"productName": "Wプラセンタ", "variants": [{"name": "90粒", "points": 100}]}
];

const pool = new Pool({ connectionString: process.env.SIGMA_RAG_PG_DSN || 'postgresql://sigma_rag@127.0.0.1:5433/sigma_rag' });
const norm = s => String(s || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const nick = s => Array.from(new Set([s, norm(s)].filter(Boolean)));
function unitCount(label) {
  const nums = String(label).match(/\d+/g);
  if (!nums) return 1;
  return nums.map(Number).reduce((a, b) => a * b, 1);
}

async function main() {
  const client = await pool.connect();
  const summary = {
    productsCreated: 0,
    productsUpdated: 0,
    variantsCreated: 0,
    variantsUpdated: 0,
    extraVariantsDeleted: 0,
    extraVariantsDeactivated: 0,
    flatProductsDeleted: 0,
    flatProductsDeactivated: 0,
    backupPath: null,
  };
  try {
    await client.query('BEGIN');
    const productNames = DATA.map(d => d.productName);
    const fullNames = DATA.flatMap(d => d.variants.map(v => `${d.productName} ${v.name}`));
    const normalizedTargets = [...productNames, ...fullNames].map(norm);

    const before = await client.query(`
      SELECT p.*,
             COALESCE(json_agg(to_jsonb(pv) ORDER BY pv.id) FILTER (WHERE pv.id IS NOT NULL), '[]'::json) AS variants,
             COALESCE((SELECT count(*)::int FROM sales_logs sl WHERE sl.product_id = p.id), 0) AS sale_count
      FROM products p
      LEFT JOIN product_variants pv ON pv.product_id = p.id
      WHERE p.product_name = ANY($1)
         OR p.product_name = ANY($2)
         OR regexp_replace(lower(p.product_name), '\\s+', '', 'g') = ANY($3)
         OR EXISTS (
           SELECT 1 FROM product_variants pv2
           WHERE pv2.product_id = p.id
             AND regexp_replace(lower(p.product_name || ' ' || pv2.variant_label), '\\s+', '', 'g') = ANY($3)
         )
      GROUP BY p.id
      ORDER BY p.product_name, p.id
    `, [productNames, fullNames, normalizedTargets]);

    const backupDir = path.join(process.cwd(), 'backups', 'manual-imports');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `batch2-before-${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), data: DATA, rows: before.rows }, null, 2));
    summary.backupPath = backupPath;

    for (const item of DATA) {
      const minPoints = Math.min(...item.variants.map(v => v.points));
      let p = await client.query(`SELECT * FROM products WHERE product_name=$1 AND user_id IS NULL ORDER BY id LIMIT 1`, [item.productName]);
      let productId;
      if (p.rowCount === 0) {
        const ins = await client.query(`
          INSERT INTO products (product_name, category, point_value, nicknames, is_active, user_id)
          VALUES ($1, 'point-campaign', $2, $3, true, NULL)
          RETURNING id
        `, [item.productName, minPoints, nick(item.productName)]);
        productId = ins.rows[0].id;
        summary.productsCreated++;
      } else {
        productId = p.rows[0].id;
        await client.query(`
          UPDATE products
          SET point_value=$2, category=COALESCE(category, 'point-campaign'), nicknames=$3, is_active=true, updated_at=now()
          WHERE id=$1
        `, [productId, minPoints, nick(item.productName)]);
        summary.productsUpdated++;
      }

      const expectedLabels = item.variants.map(v => v.name);
      for (const v of item.variants) {
        const existing = await client.query(`SELECT id FROM product_variants WHERE product_id=$1 AND variant_label=$2`, [productId, v.name]);
        if (existing.rowCount === 0) {
          await client.query(`
            INSERT INTO product_variants (product_id, variant_label, unit_count, point_value, nicknames, is_active, display_shortcut)
            VALUES ($1, $2, $3, $4, $5, true, $6)
          `, [productId, v.name, unitCount(v.name), v.points, nick(`${item.productName} ${v.name}`), v.name]);
          summary.variantsCreated++;
        } else {
          await client.query(`
            UPDATE product_variants
            SET unit_count=$3, point_value=$4, nicknames=$5, is_active=true, display_shortcut=$6, updated_at=now()
            WHERE id=$1 AND product_id=$2
          `, [existing.rows[0].id, productId, unitCount(v.name), v.points, nick(`${item.productName} ${v.name}`), v.name]);
          summary.variantsUpdated++;
        }
      }

      // Replace same-family variants not in the pasted list.
      const extraVariants = await client.query(`
        SELECT pv.id, pv.variant_label,
               COALESCE((SELECT count(*)::int FROM sales_logs sl WHERE sl.product_name = p.product_name || ' ' || pv.variant_label), 0) AS sale_count
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        WHERE pv.product_id=$1 AND NOT (pv.variant_label = ANY($2))
      `, [productId, expectedLabels]);
      for (const ev of extraVariants.rows) {
        if (ev.sale_count === 0) {
          await client.query(`DELETE FROM product_variants WHERE id=$1`, [ev.id]);
          summary.extraVariantsDeleted++;
        } else {
          await client.query(`UPDATE product_variants SET is_active=false, updated_at=now() WHERE id=$1`, [ev.id]);
          summary.extraVariantsDeactivated++;
        }
      }
    }

    // Remove/deactivate flat products like "family variant" or exact normalized equivalent.
    const targets = new Map();
    for (const item of DATA) for (const v of item.variants) targets.set(norm(`${item.productName}${v.name}`), `${item.productName} ${v.name}`);
    const possible = await client.query(`
      SELECT p.id, p.product_name,
             COALESCE((SELECT count(*)::int FROM sales_logs sl WHERE sl.product_id = p.id), 0) AS sale_count
      FROM products p
      WHERE p.user_id IS NULL
    `);
    for (const row of possible.rows) {
      const n = norm(row.product_name);
      if (!targets.has(n)) continue;
      // Do not delete/deactivate the canonical family row if one bizarrely normalizes equal.
      if (DATA.some(d => d.productName === row.product_name)) continue;
      if (row.sale_count === 0) {
        await client.query(`DELETE FROM product_variants WHERE product_id=$1`, [row.id]);
        await client.query(`DELETE FROM products WHERE id=$1`, [row.id]);
        summary.flatProductsDeleted++;
      } else {
        await client.query(`UPDATE products SET is_active=false, updated_at=now() WHERE id=$1`, [row.id]);
        summary.flatProductsDeactivated++;
      }
    }

    await client.query('COMMIT');
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
