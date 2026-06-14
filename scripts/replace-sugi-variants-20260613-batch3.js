const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATA = [
  { productName: 'サンテメディカルプラス12', variants: [
    ['通常', 100], ['企画品', 100], ['メディカル限定企画品 12ml', 100], ['ミニPR限定企画品', 100],
    ['F-EX', 100], ['F-EX スティック', 100], ['F-EX スティック 企画品', 100], ['F-EX スティック 企画品+12ml', 100],
    ['アクティブ', 100], ['アクティブ 企画品', 100], ['2個パック', 200], ['F-EX 2個パック', 200],
    ['F-EX スティック 2個パック', 200], ['アクティブ 2個パック', 200], ['3個パック', 300], ['F-EX 3個パック', 300], ['アクティブ 3個パック', 300]
  ]},
  { productName: 'ピアレインS', variants: [['通常', 100], ['ミニ商品', 100], ['5ml×2本', 100]] },
  { productName: 'ソフトサンティア', variants: [['ひとみストレッチ 5ml×2本', 10], ['ひとみストレッチ 5ml×4本', 20]] },
  { productName: 'クリアデュー プロケアソリューション', variants: [['60ml', 10], ['360ml', 10], ['360ml×2', 10], ['360ml×3', 20]] },
  { productName: 'クリアデュー ハイドロワンステップ', variants: [['5日分', 10], ['28日分', 10], ['28日分×2', 20], ['28日分×3', 30]] },
  { productName: 'デントヘルスR', variants: [['10g', 30], ['20g', 60], ['40g', 100]] },
  { productName: 'デントヘルスBb', variants: [['45g', 60], ['90g', 100]] },
  { productName: 'デントヘルス 薬用ハミガキDX', variants: [['28g', 30], ['85g', 60], ['110g+94g', 60], ['115g', 100], ['115g×2', 200], ['115g×2+28g', 200]] },
  { productName: 'デントヘルス しみるブロック', variants: [['85g', 60], ['115g', 100]] },
  { productName: 'デントヘルス 口臭ブロック', variants: [['28g', 30], ['85g', 60], ['115g', 100]] },
  { productName: 'デントヘルス 無研磨ゲル', variants: [['85g', 60], ['115g', 100]] },
  { productName: 'デントヘルス DXプレミアム', variants: [['30g', 100], ['90g', 40], ['120g', 80]] },
  { productName: 'ブラウン オーラルB', variants: [
    ['すみずみクリーン マルチアクション 替えブラシ1本付', 80], ['すみずみクリーン フロス', 80],
    ['すみずみクリーン PRO', 80], ['すみずみクリーン PRO マルチアクション 替えブラシ1本付', 80],
    ['すみずみクリーン PRO クロス', 100], ['PRO1', 100], ['PRO2', 140], ['iO2 ホワイト', 200], ['iO3 マットブラック', 200]
  ]}
].map(p => ({ ...p, variants: p.variants.map(([name, points]) => ({ name, points })) }));

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
    variantsDeleted: 0,
    variantsInserted: 0,
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
      GROUP BY p.id
      ORDER BY p.product_name, p.id
    `, [productNames, fullNames, normalizedTargets]);

    const backupDir = path.join(process.cwd(), 'backups', 'manual-imports');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `batch3-replace-variants-before-${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), data: DATA, rows: before.rows }, null, 2));
    summary.backupPath = backupPath;

    for (const item of DATA) {
      const minPoints = Math.min(...item.variants.map(v => v.points));
      const found = await client.query(`SELECT id FROM products WHERE product_name=$1 AND user_id IS NULL ORDER BY id LIMIT 1`, [item.productName]);
      let productId;
      if (found.rowCount === 0) {
        const ins = await client.query(`
          INSERT INTO products (product_name, category, point_value, nicknames, is_active, user_id)
          VALUES ($1, 'point-campaign', $2, $3, true, NULL)
          RETURNING id
        `, [item.productName, minPoints, nick(item.productName)]);
        productId = ins.rows[0].id;
        summary.productsCreated++;
      } else {
        productId = found.rows[0].id;
        await client.query(`
          UPDATE products
          SET point_value=$2, category=COALESCE(category, 'point-campaign'), nicknames=$3, is_active=true, updated_at=now()
          WHERE id=$1
        `, [productId, minPoints, nick(item.productName)]);
        summary.productsUpdated++;
      }

      const del = await client.query(`DELETE FROM product_variants WHERE product_id=$1`, [productId]);
      summary.variantsDeleted += del.rowCount;

      for (const v of item.variants) {
        await client.query(`
          INSERT INTO product_variants (product_id, variant_label, unit_count, point_value, nicknames, is_active, display_shortcut)
          VALUES ($1, $2, $3, $4, $5, true, $6)
        `, [productId, v.name, unitCount(v.name), v.points, nick(`${item.productName} ${v.name}`), v.name]);
        summary.variantsInserted++;
      }
    }

    // Remove/deactivate flat products like "family variant" when they duplicate inserted variants.
    const flatTargets = new Set(DATA.flatMap(d => d.variants.map(v => norm(`${d.productName}${v.name}`))));
    const possible = await client.query(`
      SELECT p.id, p.product_name,
             COALESCE((SELECT count(*)::int FROM sales_logs sl WHERE sl.product_id = p.id), 0) AS sale_count
      FROM products p
      WHERE p.user_id IS NULL
    `);
    for (const row of possible.rows) {
      if (!flatTargets.has(norm(row.product_name))) continue;
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
