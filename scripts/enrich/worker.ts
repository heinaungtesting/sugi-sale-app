/**
 * scripts/enrich/worker.ts
 *
 * Bulk product unique-features enrichment worker.
 *
 * Usage:
 *   tsx scripts/enrich/worker.ts --run-id 2026-07-06T08:00Z --limit 50
 *
 * Required env:
 *   SIGMA_RAG_PG_DSN        Postgres connection string
 *   FIRECRAWL_API_KEY      Firecrawl auth
 *   SUMMARIZER_PROVIDER    'minimax' | 'parent-agent' | 'heuristic'
 *   SUMMARIZER_MODEL       e.g. MiniMax-M3
 *   MINIMAX_API_URL        required when SUMMARIZER_PROVIDER=minimax
 *   MINIMAX_API_KEY        required when SUMMARIZER_PROVIDER=minimax
 *
 * Optional env:
 *   FIRECRAWL_QPS=3               token-bucket refill rate
 *   FIRECRAWL_CONCURRENCY=4
 *   SUMMARIZER_CONCURRENCY=2
 *   MIN_CONFIDENCE=0.55
 *   PROMPT_VERSION=usp.v1
 *   SOURCE_CACHE_TTL_DAYS=7
 *   BRAND_DOMAIN_MAP_PATH=./config/brand-domains.json
 */

import { Pool, PoolClient } from 'pg';
import { setTimeout as sleep } from 'node:timers/promises';
import { hostname } from 'node:os';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// ── Tiny arg parser ──────────────────────────────────────────────────────────
function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else { out[key] = true; }
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const RUN_ID = String(args['run-id'] ?? new Date().toISOString().replace(/[:.]/g, '-'));
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const FETCH_ONLY = Boolean(args['fetch-only']);

// ── Config ───────────────────────────────────────────────────────────────────
const PG_DSN = process.env.SIGMA_RAG_PG_DSN;
if (!PG_DSN) throw new Error('SIGMA_RAG_PG_DSN is required');

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY is required');

const SUMMARIZER_PROVIDER = process.env.SUMMARIZER_PROVIDER ?? 'parent-agent';
const SUMMARIZER_MODEL    = process.env.SUMMARIZER_MODEL    ?? 'MiniMax-M3';
const PROMPT_VERSION      = process.env.PROMPT_VERSION      ?? 'usp.v1';
const MIN_CONFIDENCE      = Number(process.env.MIN_CONFIDENCE ?? '0.55');
const FIRECRAWL_QPS       = Number(process.env.FIRECRAWL_QPS  ?? '3');
const SOURCE_CACHE_TTL    = Number(process.env.SOURCE_CACHE_TTL_DAYS ?? '7') * 86_400_000;

const HOST = `${hostname()}:${process.pid}`;
const pool = new Pool({ connectionString: PG_DSN, max: 4 });

// ── Token bucket ─────────────────────────────────────────────────────────────
class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(private rate: number, private burst = rate) {
    this.tokens = burst; this.last = Date.now();
  }
  async take(cost = 1) {
    while (true) {
      const now = Date.now();
      const refill = ((now - this.last) / 1000) * this.rate;
      this.tokens = Math.min(this.burst, this.tokens + refill);
      this.last = now;
      if (this.tokens >= cost) { this.tokens -= cost; return; }
      const wait = ((cost - this.tokens) / this.rate) * 1000;
      await sleep(wait);
    }
  }
}
const firecrawlBucket = new TokenBucket(FIRECRAWL_QPS);

// ── Firecrawl client ─────────────────────────────────────────────────────────
type FirecrawlResult = { ok: boolean; status?: number; markdown?: string; error?: string };

async function firecrawlScrape(url: string): Promise<FirecrawlResult> {
  await firecrawlBucket.take();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        timeout: 25000,
      }),
      signal: controller.signal,
    });
    const status = res.status;
    if (!res.ok) return { ok: false, status, error: await res.text() };
    const body = await res.json() as { data?: { markdown?: string } };
    return { ok: true, status, markdown: body.data?.markdown ?? '' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Summarizer clients ───────────────────────────────────────────────────────
type SummaryOut = {
  one_liner: string;
  bullets: string[];
  features: Array<{
    key: string;
    headline: string;
    detail?: string;
    source_indexes: number[];
    variant_id?: number | null;
  }>;
  confidence: number;
};

async function summarizeMinimax(productName: string, category: string, markdown: string): Promise<SummaryOut> {
  const url = process.env.MINIMAX_API_URL;
  const key = process.env.MINIMAX_API_KEY;
  if (!url || !key) throw new Error('MINIMAX_API_URL / MINIMAX_API_KEY required');
  const payload = {
    model: SUMMARIZER_MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content:
        'You are a Japanese cosmetics/healthcare copywriter. Use ONLY facts present in the supplied markdown. ' +
        'If a claim is not supported, omit it. Reply with strict JSON per the schema.' },
      { role: 'user', content: JSON.stringify({
        product_name: productName, category, markdown: markdown.slice(0, 8000),
        instructions: [
          'Output 3-5 unique selling points.',
          'Each USP must cite at least one source_index from the list.',
          'headline <= 80 chars, detail <= 600 chars, Japanese.',
          'No marketing fluff not present in the source.',
          'If nothing unique is supported, return {"features":[]}',
        ],
      }) },
    ],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`minimax HTTP ${res.status}: ${await res.text()}`);
  const j = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = j.choices?.[0]?.message?.content ?? '{}';
  return validateSummary(JSON.parse(content));
}

function summarizeHeuristic(productName: string, markdown: string): SummaryOut {
  // Smoke-test fallback only. Extracts up to 5 sentences containing "配合" or "特徴".
  const sentences = markdown.split(/[。\n]/).map(s => s.trim()).filter(s => s.length >= 12 && s.length <= 120);
  const picked = sentences.filter(s => /(配合|特徴|成分|保湿|美容|トーン|uv|uvケア)/i.test(s)).slice(0, 5);
  return {
    one_liner: picked[0] ?? `${productName} の特徴を抽出できませんでした。`,
    bullets: picked.slice(0, 3),
    features: picked.slice(0, 5).map((s, i) => ({
      key: `auto_${i + 1}`,
      headline: s.slice(0, 80),
      detail: s,
      source_indexes: [0],
    })),
    confidence: picked.length ? 0.4 : 0,
  };
}

function validateSummary(o: any): SummaryOut {
  if (!o || typeof o !== 'object') throw new Error('summary: not an object');
  return {
    one_liner: String(o.one_liner ?? '').slice(0, 140),
    bullets: Array.isArray(o.bullets) ? o.bullets.slice(0, 5).map((s: any) => String(s).slice(0, 120)) : [],
    features: Array.isArray(o.features)
      ? o.features.slice(0, 8).map((f: any) => ({
          key: String(f.key ?? '').slice(0, 80),
          headline: String(f.headline ?? '').slice(0, 80),
          detail: f.detail ? String(f.detail).slice(0, 600) : undefined,
          source_indexes: Array.isArray(f.source_indexes) ? f.source_indexes.slice(0, 8).map(Number) : [],
        }))
      : [],
    confidence: Math.max(0, Math.min(1, Number(o.confidence ?? 0))),
  };
}

// ── Job claim ────────────────────────────────────────────────────────────────
async function claimJob(client: PoolClient, runId: string): Promise<{ id: number; product_id: number } | null> {
  const { rows } = await client.query<{ id: number; product_id: number }>(`
    UPDATE enrichment_jobs j
    SET status='fetching', locked_by=$1, locked_at=now(), attempts=attempts+1,
        started_at=COALESCE(started_at, now())
    WHERE j.id = (
      SELECT id FROM enrichment_jobs
      WHERE run_id=$2 AND status IN ('queued','failed')
        AND next_run_at <= now()
      ORDER BY priority, next_run_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, product_id
  `, [HOST, runId]);
  return rows[0] ?? null;
}

// ── Per-product pipeline ─────────────────────────────────────────────────────
async function processProduct(runId: string, limit: number) {
  let processed = 0;
  const client = await pool.connect();
  try {
    while (processed < limit) {
      await client.query('BEGIN');
      const job = await claimJob(client, runId);
      if (!job) { await client.query('COMMIT'); break; }
      const jobId = job.id;
      const productId = job.product_id;

      try {
        // Load product
        const { rows: prodRows } = await client.query<{
          product_name: string; category: string; is_active: boolean;
          source_url: string | null;
        }>(`SELECT product_name, category, is_active, source_url
            FROM products WHERE id=$1`, [productId]);
        const product = prodRows[0];
        if (!product || !product.is_active) {
          await client.query(`UPDATE enrichment_jobs SET status='skipped', finished_at=now() WHERE id=$1`, [jobId]);
          await client.query('COMMIT');
          processed++;
          continue;
        }

        // 2. Resolve URLs (up to 3)
        const urls = await resolveUrls(client, productId, product.source_url);
        await audit(client, jobId, productId, 'resolve.ok', { urls });

        // 3. Fetch
        const sources = await fetchUrls(client, productId, urls);
        const good = sources.filter(s => s.fetch_status === 'ok' && (s.raw_markdown?.length ?? 0) >= 600);

        // 4. Skip gate
        if (good.length === 0) {
          await client.query(`UPDATE enrichment_jobs SET status='blocked', finished_at=now() WHERE id=$1`, [jobId]);
          await audit(client, jobId, productId, 'blocked', { reason: 'no good sources', urls });
          await client.query('COMMIT');
          processed++;
          continue;
        }

        if (FETCH_ONLY) {
          await client.query(`UPDATE enrichment_jobs SET status='done', finished_at=now() WHERE id=$1`, [jobId]);
          await audit(client, jobId, productId, 'fetch.only.done', {});
          await client.query('COMMIT');
          processed++;
          continue;
        }

        // 5. Summarize
        await client.query(`UPDATE enrichment_jobs SET status='summarizing' WHERE id=$1`, [jobId]);
        const concat = good.map((s, i) => `[source ${i}] (${s.url})\n${s.raw_markdown}`).join('\n\n');
        let summary: SummaryOut;
        try {
          summary = SUMMARIZER_PROVIDER === 'minimax'
            ? await summarizeMinimax(product.product_name, product.category, concat)
            : SUMMARIZER_PROVIDER === 'heuristic'
              ? summarizeHeuristic(product.product_name, concat)
              : await summarizeParentAgent(product.product_name, product.category, concat);
        } catch (e) {
          await client.query(`UPDATE enrichment_jobs SET status='failed', last_error=$2, finished_at=now() WHERE id=$1`,
            [jobId, (e as Error).message]);
          await audit(client, jobId, productId, 'summarize.fail', { err: (e as Error).message });
          await client.query('COMMIT');
          processed++;
          continue;
        }

        // 6. Persist
        await client.query(`UPDATE enrichment_jobs SET status='persisting' WHERE id=$1`, [jobId]);
        await persistSummary(client, productId, good, summary, SUMMARIZER_MODEL, PROMPT_VERSION);

        await client.query(`UPDATE enrichment_jobs SET status='done', finished_at=now() WHERE id=$1`, [jobId]);
        await audit(client, jobId, productId, 'persist.ok', { features: summary.features.length });
        await client.query('COMMIT');
        processed++;
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[product ${productId}] error`, e);
        await pool.query(`UPDATE enrichment_jobs
                          SET status='failed', last_error=$2, next_run_at=now() + interval '5 minutes'
                          WHERE id=$1`, [jobId, (e as Error).message]);
        processed++;
      }
    }
  } finally {
    client.release();
  }
  return processed;
}

async function resolveUrls(client: PoolClient, productId: number, sourceUrl: string | null): Promise<string[]> {
  if (sourceUrl) return [sourceUrl];
  // TODO: brand-domain map lookup, then Firecrawl search fallback.
  return [];
}

type SourceRow = { id: number; url: string; fetch_status: string; raw_markdown: string | null };

async function fetchUrls(client: PoolClient, productId: number, urls: string[]): Promise<SourceRow[]> {
  const out: SourceRow[] = [];
  for (const url of urls.slice(0, 3)) {
    const existing = await client.query<SourceRow>(`
      SELECT id, url, fetch_status, raw_markdown FROM enrichment_sources
      WHERE product_id=$1 AND url=$2`, [productId, url]);
    if (existing.rows[0]?.fetch_status === 'ok'
        && (existing.rows[0].raw_markdown?.length ?? 0) >= 600) {
      out.push(existing.rows[0]); continue;
    }
    const result = await firecrawlScrape(url);
    const status = result.ok ? 'ok'
      : (result.status === 429 || /timeout|abort/i.test(result.error ?? '')) ? 'timeout'
      : result.status && result.status >= 400 ? 'http_error'
      : 'parse_error';
    const merged = await client.query(`
      INSERT INTO enrichment_sources (product_id, url, fetched_at, fetch_status, http_status,
                                      raw_markdown, raw_bytes, content_hash)
      VALUES ($1,$2, CASE WHEN $3 THEN now() ELSE NULL END, $4, $5, $6, $7, encode(sha256($6::bytea),'hex'))
      ON CONFLICT (product_id, url) DO UPDATE
        SET fetched_at = EXCLUDED.fetched_at,
            fetch_status = EXCLUDED.fetch_status,
            http_status = EXCLUDED.http_status,
            raw_markdown = EXCLUDED.raw_markdown,
            raw_bytes = EXCLUDED.raw_bytes,
            content_hash = EXCLUDED.content_hash
      RETURNING id, url, fetch_status, raw_markdown
    `, [productId, url, result.ok, status, result.status ?? null,
        result.markdown ?? null, result.markdown?.length ?? 0]);
    out.push(merged.rows[0]);
    await sleep(200);
  }
  return out;
}

async function persistSummary(
  client: PoolClient,
  productId: number,
  sources: SourceRow[],
  summary: SummaryOut,
  modelId: string,
  promptVersion: string,
) {
  // Map source indexes to real ids. Each feature carries the real BIGINT[].
  const realIds = sources.map(s => s.id);
  const summary_source_ids = realIds;

  for (const f of summary.features) {
    const sourceIds = (f.source_indexes || [])
      .map(i => realIds[i])
      .filter((x): x is number => typeof x === 'number');
    if (sourceIds.length === 0) continue;
    // Two variants: variant_id IS NULL vs IS NOT NULL → different unique indexes,
    // so the ON CONFLICT predicate must match the partial-index WHERE clause.
    if (f.variant_id == null) {
      await client.query(`
        INSERT INTO product_unique_feature_items
          (product_id, variant_id, feature_key, headline, detail, language, confidence,
           source_ids, generated_by, model_id, prompt_version)
        VALUES ($1,NULL,$2,$3,$4,'ja',$5,$6,'enrich-worker',$7,$8)
        ON CONFLICT (product_id, feature_key, language) WHERE variant_id IS NULL
        DO UPDATE SET
          headline = EXCLUDED.headline,
          detail = EXCLUDED.detail,
          confidence = EXCLUDED.confidence,
          source_ids = EXCLUDED.source_ids,
          model_id = EXCLUDED.model_id,
          prompt_version = EXCLUDED.prompt_version,
          generated_by = 'enrich-worker',
          updated_at = now()
      `, [productId, f.key || 'auto', f.headline, f.detail ?? null, summary.confidence,
          sourceIds, modelId, promptVersion]);
    } else {
      await client.query(`
        INSERT INTO product_unique_feature_items
          (product_id, variant_id, feature_key, headline, detail, language, confidence,
           source_ids, generated_by, model_id, prompt_version)
        VALUES ($1,$2,$3,$4,$5,'ja',$6,$7,'enrich-worker',$8,$9)
        ON CONFLICT (product_id, variant_id, feature_key, language) WHERE variant_id IS NOT NULL
        DO UPDATE SET
          headline = EXCLUDED.headline,
          detail = EXCLUDED.detail,
          confidence = EXCLUDED.confidence,
          source_ids = EXCLUDED.source_ids,
          model_id = EXCLUDED.model_id,
          prompt_version = EXCLUDED.prompt_version,
          generated_by = 'enrich-worker',
          updated_at = now()
      `, [productId, f.variant_id, f.key || 'auto', f.headline, f.detail ?? null,
          summary.confidence, sourceIds, modelId, promptVersion]);
    }
  }

  await client.query(`
    INSERT INTO product_unique_summaries
      (product_id, one_liner, bullet_points, confidence, source_ids, model_id, prompt_version)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (product_id) DO UPDATE SET
      one_liner = EXCLUDED.one_liner,
      bullet_points = EXCLUDED.bullet_points,
      confidence = EXCLUDED.confidence,
      source_ids = EXCLUDED.source_ids,
      model_id = EXCLUDED.model_id,
      prompt_version = EXCLUDED.prompt_version,
      generated_at = now(),
      updated_at = now()
  `, [productId, summary.one_liner, summary.bullets, summary.confidence,
      summary_source_ids, modelId, promptVersion]);
}

async function audit(client: PoolClient, jobId: number | null, productId: number, event: string, details: unknown) {
  await client.query(`INSERT INTO enrichment_audit (job_id, product_id, event, actor, details)
                      VALUES ($1,$2,$3,$4,$5)`,
    [jobId, productId, event, HOST, JSON.stringify(details ?? {})]);
}

async function summarizeParentAgent(productName: string, category: string, markdown: string): Promise<SummaryOut> {
  // Emits a JSON file under out/pending-summary/<product>.json; parent agent fills it in.
  const dir = path.resolve('out/pending-summary');
  const fs = await import('node:fs/promises');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2,8)}.json`);
  await fs.writeFile(file, JSON.stringify({ productName, category, markdown }, null, 2));
  throw new Error(`parent-agent pending file written: ${file} (re-run worker after parent fills it in)`);
}

// ── Entrypoint ───────────────────────────────────────────────────────────────
process.on('SIGINT',  async () => { console.log('\n[drain]'); await pool.end(); process.exit(0); });
process.on('SIGTERM', async () => { console.log('\n[drain]'); await pool.end(); process.exit(0); });

(async () => {
  console.log(`[worker] run=${RUN_ID} provider=${SUMMARIZER_PROVIDER} model=${SUMMARIZER_MODEL} limit=${LIMIT}`);
  const processed = await processProduct(RUN_ID, LIMIT);
  console.log(`[worker] processed=${processed}`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });