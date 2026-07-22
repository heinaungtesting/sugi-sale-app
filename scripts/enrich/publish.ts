/**
 * scripts/enrich/publish.ts
 *   tsx scripts/enrich/publish.ts --min-confidence 0.7 --dry-run
 *
 * Flips product_unique_feature_items.is_published = TRUE where confidence >= threshold
 * AND source_ids are all resolvable AND no manual review was previously rejected.
 */
import { Pool } from 'pg';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const min = Number(args.find(a => a.startsWith('--min-confidence='))?.split('=')[1] ?? '0.7');

const DSN = process.env.SIGMA_RAG_PG_DSN;
if (!DSN) throw new Error('SIGMA_RAG_PG_DSN is required');
const pool = new Pool({ connectionString: DSN });

(async () => {
  // 1. Detect orphans
  const orphans = await pool.query<{ id: number; product_id: number; feature_key: string; missing: number[] }>(`
    SELECT f.id, f.product_id, f.feature_key,
           array_agg(sid) FILTER (WHERE NOT EXISTS (SELECT 1 FROM enrichment_sources s WHERE s.id = sid)) AS missing
    FROM product_unique_feature_items f,
         LATERAL unnest(f.source_ids) AS sid
    GROUP BY f.id
    HAVING bool_or(NOT EXISTS (SELECT 1 FROM enrichment_sources s WHERE s.id = sid))
  `);
  if ((orphans.rowCount ?? 0) > 0) {
    console.warn(`[publish] ${orphans.rowCount} features reference missing sources; skipping them.`);
  }
  const orphanIds = new Set(orphans.rows.map(r => r.id));

  // 2. Eligible rows
  const eligible = await pool.query<{ id: number; product_id: number; confidence: number; feature_key: string }>(`
    SELECT id, product_id, confidence, feature_key
    FROM product_unique_feature_items
    WHERE confidence >= $1
      AND is_published = FALSE
      AND language = 'ja'
      AND reviewed_at IS NULL
  `, [min]);
  const safe = eligible.rows.filter(r => !orphanIds.has(r.id));
  console.log(`[publish] eligible=${eligible.rowCount} orphans=${orphans.rowCount} to_publish=${safe.length} (dry=${dry})`);
  if (dry || safe.length === 0) { await pool.end(); return; }

  const ids = safe.map(r => r.id);
  const { rowCount } = await pool.query(`
    UPDATE product_unique_feature_items SET is_published = TRUE, updated_at = now()
    WHERE id = ANY($1::bigint[])`, [ids]);
  console.log(`[publish] updated=${rowCount}`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });