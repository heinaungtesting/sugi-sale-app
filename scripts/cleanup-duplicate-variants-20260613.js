const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const importCsv = `Product,Variant,Points
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
function rows() { return importCsv.trim().split(/\r?\n/).slice(1).map(l=>{const [p,v,pts]=l.split(',').map(s=>s.trim()); return {p,v,pts:Number(pts), full:v?`${p} ${v}`:p};}); }
function uniq(a){return [...new Set(a)]}
async function main(){
 const pool=new Pool({connectionString:process.env.SIGMA_RAG_PG_DSN||'postgresql://sigma_rag@127.0.0.1:5433/sigma_rag'});
 const client=await pool.connect();
 const data=rows();
 const flatNames=uniq(data.filter(r=>r.v).map(r=>r.full));
 const familyNames=uniq(data.map(r=>r.p));
 const backupDir=path.join(process.cwd(),'backups','manual-imports'); fs.mkdirSync(backupDir,{recursive:true});
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 try{
  await client.query('BEGIN');
  const duplicateFlat=await client.query(`
    SELECT flat.id, flat.product_name, flat.point_value, flat.category, flat.nicknames, flat.is_active,
           fam.id AS family_id, pv.id AS variant_id, pv.variant_label, pv.point_value AS variant_points,
           (SELECT COUNT(*) FROM sales_logs s WHERE s.product_id=flat.id) AS sale_count
    FROM products flat
    JOIN products fam ON fam.product_name = ANY($2::text[]) AND flat.product_name = fam.product_name || ' ' || (
      SELECT pv2.variant_label FROM product_variants pv2 WHERE pv2.product_id=fam.id AND flat.product_name=fam.product_name || ' ' || pv2.variant_label LIMIT 1
    )
    JOIN product_variants pv ON pv.product_id=fam.id AND flat.product_name=fam.product_name || ' ' || pv.variant_label
    WHERE flat.product_name = ANY($1::text[]) AND flat.is_active=true
    ORDER BY flat.id
  `,[flatNames,familyNames]);
  const exactDupes=await client.query(`
    SELECT product_name, array_agg(id ORDER BY id) ids, count(*)::int n
    FROM products WHERE is_active=true GROUP BY product_name HAVING count(*)>1
  `);
  const backup={duplicateFlat: duplicateFlat.rows, exactDupes: exactDupes.rows};
  const backupPath=path.join(backupDir,`duplicate-variants-before-${stamp}.json`);
  fs.writeFileSync(backupPath,JSON.stringify(backup,null,2));

  // Do not delete products that have sales history; deactivate instead to preserve historical FK integrity/search cleanliness.
  const flatIds=duplicateFlat.rows.map(r=>Number(r.id));
  let deactivated=0;
  if(flatIds.length){
    const upd=await client.query(`UPDATE products SET is_active=false, updated_at=now() WHERE id=ANY($1::bigint[]) RETURNING id, product_name`,[flatIds]);
    deactivated=upd.rowCount;
  }

  // For exact duplicate active product names, keep lowest id, deactivate others only if any exist (unlikely due unique constraint).
  let exactDeactivated=0;
  for(const d of exactDupes.rows){
    const ids=d.ids.map(Number);
    const extras=ids.slice(1);
    if(extras.length){
      const upd=await client.query(`UPDATE products SET is_active=false, updated_at=now() WHERE id=ANY($1::bigint[]) RETURNING id`,[extras]);
      exactDeactivated+=upd.rowCount;
    }
  }

  const remaining=await client.query(`
    SELECT flat.id, flat.product_name
    FROM products flat
    JOIN products fam ON fam.product_name=ANY($2::text[]) AND fam.is_active=true
    JOIN product_variants pv ON pv.product_id=fam.id AND pv.is_active=true AND flat.product_name=fam.product_name || ' ' || pv.variant_label
    WHERE flat.product_name=ANY($1::text[]) AND flat.is_active=true
    ORDER BY flat.id
  `,[flatNames,familyNames]);
  const verify=await client.query(`
    WITH expected(product_name, variant_label, point_value) AS (
      SELECT * FROM json_to_recordset($1::json) AS x(product_name text, variant_label text, point_value int)
    )
    SELECT count(*) filter (where ok) ok_count, count(*) total FROM (
      SELECT CASE WHEN e.variant_label='' THEN p.id IS NOT NULL AND p.point_value=e.point_value
                  ELSE p.id IS NOT NULL AND pv.id IS NOT NULL AND pv.point_value=e.point_value END ok
      FROM expected e
      LEFT JOIN products p ON p.product_name=e.product_name AND p.is_active=true
      LEFT JOIN product_variants pv ON pv.product_id=p.id AND pv.variant_label=e.variant_label AND pv.is_active=true
    ) x
  `,[JSON.stringify(data.map(r=>({product_name:r.p,variant_label:r.v,point_value:r.pts})))]);
  if(remaining.rows.length) throw new Error(`Still duplicated flat variant rows: ${JSON.stringify(remaining.rows.slice(0,10))}`);
  if(verify.rows[0].ok_count !== verify.rows[0].total) throw new Error(`Expected row verification failed: ${JSON.stringify(verify.rows[0])}`);
  await client.query('COMMIT');
  console.log(JSON.stringify({backupPath, detectedFlatDuplicates: duplicateFlat.rowCount, deactivatedFlatProducts: deactivated, exactDuplicateGroups: exactDupes.rowCount, exactDeactivated, remainingFlatDuplicates: remaining.rowCount, expectedRowsVerified: verify.rows[0]},null,2));
 } catch(e){ await client.query('ROLLBACK'); throw e; }
 finally{ client.release(); await pool.end(); }
}
main().catch(e=>{console.error(e);process.exit(1)});
