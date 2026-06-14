const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const csv = `Product,Variant,Points
コンドロイチンZS錠,60錠,200
コンドロイチンZS錠,108錠,300
コンドロイチンZS錠,180錠,450
コンドロイチンZS錠,270錠,600
コンドロイチンZS錠,270錠×2個パック,1200
コンドロイチンZS錠,270錠×5個パック,3400
エミネトン,80錠,30
エミネトン,200錠,70
ハイゼリー顆粒EX,15包,30
ハイゼリー顆粒EX,30包,60
新ウィズワン,10包,20
新ウィズワン,30包,50
エスセレクト 酸化マグネシウムSG便秘薬,200錠,40
エスセレクト 酸化マグネシウムSG便秘薬,400錠,70
新セルベール整胃プレミアム,18錠,10
新セルベール整胃プレミアム,36錠,20
新セルベール整胃プレミアム,72錠,30
新セルベール整胃プレミアム,12包,10
新セルベール整胃プレミアム,24包,20
タケフール,22包,20
ザ・ガード整腸錠α3+,150錠,120
ザ・ガード整腸錠α3+,350錠,250
ザ・ガード整腸錠α3+,550錠,500
ビオスリーHi錠,42錠,40
ビオスリーHi錠,180錠,60
ビオスリーHi錠,270錠,120
ビオスリーHi錠,540錠,240
ビオスリーHi錠,540錠×2個パック,240
ビオスリーH,36包,60
スクラート胃腸薬S,36錠,20
スクラート胃腸薬S,102錠,10
スクラート胃腸薬S,12包,20
スクラート胃腸薬S,34包,10
クラシエ当帰芍薬散錠,288錠,40
新ハリーゴールド液α,30ml×3本,60
新ハリーゴールド液α,30ml×6本,120
新ハリーゴールド液α,30ml×10本,200
ハリーゴールド液Sジュニア,30ml×3本,40
ハリーエースプレミアムα,36錠,80
ハリーエースプレミアムα,54錠,120
ハリープレミアムNX,36錠,80
ハリープレミアムNX,54錠,120
エスセレクト ハリーVせき止め錠,,100
エスセレクト ハリーVせき止め液,,100
エスセレクト のどスッキリトローチ,24錠,10
エスセレクト のどスッキリトローチAZ,24錠,10
パブロンプレミアムDXクイック+,20錠,120
パブロンプレミアムDXクイック+,40錠,180
パブロンプレミアムDXクイック+,60錠,250
パブロンプレミアムDXクイック+,60錠+20錠,370
トリステアEX,8錠30ml,60
トリステアEX8クリーム,30g,60
トリステアLクリーム,,40
エスセレクト ピロールプレミアム液,40ml,30
エスセレクト ピロールプレミアムゲル,20g,30
ウィンテルダンPCローションX,,30
ウィンテルダンPCジェルX,,30
エンクロン軟膏EX,12g,50
エンクロンクリームEX,12g,50
エンクロンUクリームEX,12g,50
エスセレクト ベタメタゾンSG軟膏,,100
エスセレクト ベタメタゾンSGクリーム,,100
エスセレクト ワムナールEXクリーム,120g,20
クラチナミビエイドα,15g,30
クラチナミビエイドα,35g,10
フェイタスZαジクサス,7枚,20
フェイタスZαジクサス,14枚,50
フェイタスZαジクサス,21枚,100
フェイタスZαジクサス,大判サイズ7枚,150
フェイタスZαジクサス温感,7枚,100
フェイタスZαジクサス温感,14枚,50
フェイタスZαジクサス温感,7枚+14枚,100
フェイタスZαジクサス温感,大判サイズ7枚,150
ヘパリナクリーム,100g,100
ヘパリナローション,120g,120
エスセレクト 防風通聖散エキスZ錠,330錠,50
エスセレクト 防風通聖散エキスZ錠,450錠,60
エスセレクト 防風通聖散エキスZ錠,330錠×2個パック,360
エスセレクト 防風通聖散エキスZ錠,450錠×2個パック,450
ツッコデル錠,312錠,720
クラシエ八味地黄丸A,540錠,900
八味地黄丸A,180錠,40
八味地黄丸A,360錠,200
ハリー鼻炎FX,30錠,100
ハリー鼻炎FX,60錠,150
ハリー鼻炎FX,120錠,120
ロートアルガードクリニカルショット,,180
ロートアルガードクリニカルショット マイルド,,300
サジールαAR 0.1%,,20
サジールαAR 0.1% クールaページ,,20
ナシビンメディ,,20`;

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).slice(1);
  return lines.map((line, i) => {
    const parts = line.split(',');
    if (parts.length !== 3) throw new Error(`Bad CSV line ${i + 2}: ${line}`);
    const [product, variant, points] = parts.map(s => s.trim());
    const point_value = Number(points);
    if (!product || !Number.isInteger(point_value)) throw new Error(`Invalid row ${i + 2}: ${line}`);
    return { product, variant, point_value, fullName: variant ? `${product} ${variant}` : product };
  });
}

function compact(s) { return s.toLowerCase().replace(/[\s　]/g, ''); }
function uniq(arr) { return [...new Set(arr.map(String).map(s => s.trim()).filter(Boolean))]; }
function unitCount(label, fallback) {
  if (!label) return fallback;
  const nums = [...label.matchAll(/\d+/g)].map(m => Number(m[0]));
  if (!nums.length) return fallback;
  const packMatch = label.match(/[×x]\s*(\d+)/i);
  if (packMatch) return nums[0] * Number(packMatch[1]);
  if (label.includes('+') && nums.length >= 2) return nums[0] + nums[1];
  return nums[0];
}

async function main() {
  const rows = parseCsv(csv);
  const pool = new Pool({ connectionString: process.env.SIGMA_RAG_PG_DSN || 'postgresql://sigma_rag@127.0.0.1:5433/sigma_rag' });
  const client = await pool.connect();
  const productNames = uniq(rows.flatMap(r => [r.product, r.fullName]));
  const backupDir = path.join(process.cwd(), 'backups', 'manual-imports');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    await client.query('BEGIN');
    const backup = await client.query(`
      SELECT p.*, COALESCE(json_agg(pv.*) FILTER (WHERE pv.id IS NOT NULL), '[]') AS variants
      FROM products p
      LEFT JOIN product_variants pv ON pv.product_id = p.id
      WHERE p.product_name = ANY($1)
      GROUP BY p.id
      ORDER BY p.product_name
    `, [productNames]);
    const backupPath = path.join(backupDir, `sugi-points-before-${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup.rows, null, 2));

    const familyFirstPoints = new Map();
    for (const r of rows) {
      if (r.variant && !familyFirstPoints.has(r.product)) familyFirstPoints.set(r.product, r.point_value);
    }

    let productsCreated = 0, productsUpdated = 0, variantsCreated = 0, variantsUpdated = 0, flatUpdated = 0;
    const results = [];
    for (const r of rows) {
      if (!r.variant) {
        const nicks = uniq([r.product, compact(r.product)]);
        const up = await client.query(`
          INSERT INTO products (product_name, category, point_value, nicknames, is_active, user_id)
          VALUES ($1, 'ポイント商品', $2, $3, TRUE, NULL)
          ON CONFLICT (product_name) DO UPDATE SET
            category = COALESCE(NULLIF(products.category, ''), EXCLUDED.category),
            point_value = EXCLUDED.point_value,
            nicknames = (SELECT ARRAY(SELECT DISTINCT x FROM unnest(products.nicknames || EXCLUDED.nicknames) AS x)),
            is_active = TRUE,
            updated_at = now()
          RETURNING id, (xmax = 0) AS inserted
        `, [r.product, r.point_value, nicks]);
        if (up.rows[0].inserted) productsCreated++; else productsUpdated++;
        results.push({ type: 'product', product: r.product, points: r.point_value, product_id: up.rows[0].id });
        continue;
      }

      const familyNicks = uniq([r.product, compact(r.product)]);
      const family = await client.query(`
        INSERT INTO products (product_name, category, point_value, nicknames, is_active, user_id)
        VALUES ($1, 'ポイント商品', $2, $3, TRUE, NULL)
        ON CONFLICT (product_name) DO UPDATE SET
          category = COALESCE(NULLIF(products.category, ''), EXCLUDED.category),
          point_value = CASE WHEN products.point_value = 0 OR products.point_value IS NULL THEN EXCLUDED.point_value ELSE products.point_value END,
          nicknames = (SELECT ARRAY(SELECT DISTINCT x FROM unnest(products.nicknames || EXCLUDED.nicknames) AS x)),
          is_active = TRUE,
          updated_at = now()
        RETURNING id, (xmax = 0) AS inserted
      `, [r.product, familyFirstPoints.get(r.product) ?? r.point_value, familyNicks]);
      if (family.rows[0].inserted) productsCreated++; else productsUpdated++;
      const productId = family.rows[0].id;
      const vNicks = uniq([r.variant, r.fullName, compact(r.fullName), compact(`${r.product}${r.variant}`)]);
      const variant = await client.query(`
        INSERT INTO product_variants (product_id, variant_label, display_shortcut, unit_count, point_value, nicknames, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
        ON CONFLICT (product_id, variant_label) DO UPDATE SET
          display_shortcut = EXCLUDED.display_shortcut,
          unit_count = EXCLUDED.unit_count,
          point_value = EXCLUDED.point_value,
          nicknames = (SELECT ARRAY(SELECT DISTINCT x FROM unnest(product_variants.nicknames || EXCLUDED.nicknames) AS x)),
          is_active = TRUE,
          updated_at = now()
        RETURNING id, (xmax = 0) AS inserted
      `, [productId, r.variant, r.variant, unitCount(r.variant, rows.indexOf(r) + 1), r.point_value, vNicks]);
      if (variant.rows[0].inserted) variantsCreated++; else variantsUpdated++;

      const flat = await client.query(`
        UPDATE products SET point_value=$2, is_active=TRUE, updated_at=now(),
          nicknames = (SELECT ARRAY(SELECT DISTINCT x FROM unnest(products.nicknames || $3::text[]) AS x))
        WHERE product_name=$1
        RETURNING id
      `, [r.fullName, r.point_value, vNicks]);
      if (flat.rowCount) flatUpdated += flat.rowCount;
      results.push({ type: 'variant', product: r.product, variant: r.variant, points: r.point_value, product_id: productId, variant_id: variant.rows[0].id, flat_updated: flat.rowCount });
    }

    const verify = await client.query(`
      WITH expected(product_name, variant_label, point_value) AS (
        SELECT * FROM json_to_recordset($1::json) AS x(product_name text, variant_label text, point_value int)
      )
      SELECT e.product_name, e.variant_label, e.point_value,
             p.id AS product_id, p.point_value AS product_points,
             pv.id AS variant_id, pv.point_value AS variant_points,
             CASE WHEN e.variant_label = '' THEN (p.id IS NOT NULL AND p.point_value=e.point_value)
                  ELSE (p.id IS NOT NULL AND pv.id IS NOT NULL AND pv.point_value=e.point_value)
             END AS ok
      FROM expected e
      LEFT JOIN products p ON p.product_name=e.product_name AND p.is_active=TRUE
      LEFT JOIN product_variants pv ON pv.product_id=p.id AND pv.variant_label=e.variant_label AND pv.is_active=TRUE
      ORDER BY e.product_name, e.variant_label
    `, [JSON.stringify(rows.map(r => ({ product_name: r.product, variant_label: r.variant, point_value: r.point_value })))]);
    const missing = verify.rows.filter(r => !r.ok);
    if (missing.length) throw new Error(`Verification failed: ${JSON.stringify(missing.slice(0, 10))}`);

    await client.query('COMMIT');
    console.log(JSON.stringify({
      inputRows: rows.length,
      distinctProducts: new Set(rows.map(r => r.product)).size,
      productsCreated, productsUpdated, variantsCreated, variantsUpdated, flatUpdated,
      verifiedRows: verify.rows.length,
      backupPath,
      sample: verify.rows.slice(0, 5),
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
