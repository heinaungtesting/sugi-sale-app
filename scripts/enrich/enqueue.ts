/**
 * scripts/enrich/enqueue.ts
 *   tsx scripts/enrich/enqueue.ts --all
 *   tsx scripts/enrich/enqueue.ts --product-ids 1,2,3 --priority 50
 */
import { Pool } from 'pg';

const DSN = process.env.SIGMA_RAG_PG_DSN;
if (!DSN) throw new Error('SIGMA_RAG_PG_DSN is required');

const args = process.argv.slice(2);
const all = args.includes('--all');
const idsArg = args.find(a => a.startsWith('--product-ids='));
const priority = Number(args.find(a => a.startsWith('--priority='))?.split('=')[1] ?? '100');

const productIds = idsArg
  ? idsArg.split('=')[1]!.split(',').map(s => Number(s.trim())).filter(Boolean)
  : null;

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const pool = new Pool({ connectionString: DSN });

(async () => {
  const where = all
    ? `is_active = TRUE`
    : productIds
      ? `id = ANY($1::bigint[]) AND is_active = TRUE`
      : `FALSE`;
  const params = productIds ? [productIds] : [];
  const { rowCount } = await pool.query(`
    INSERT INTO enrichment_jobs (product_id, run_id, priority)
    SELECT id, $${productIds ? 2 : 1}, ${priority} FROM products
    WHERE ${where}
    ON CONFLICT (product_id, run_id) DO NOTHING
  `, productIds ? [productIds, runId] : [runId]);
  console.log(`[enqueue] run_id=${runId} inserted_or_existing=${rowCount}`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });