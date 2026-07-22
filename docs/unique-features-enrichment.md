# Unique-Features Enrichment Worker — Design

Status: design (ready to implement). Target: ~331 products / ~826 variants in `sugi_sale`.

## 1. Goal

For every active product (and, optionally, each variant) generate **customer-facing
unique selling points (USPs)** with **provenance** and **confidence**, so staff can
explain a product in one line at the register. No hallucinated facts: every claim is
traceable to a Firecrawl-extracted source, with a numeric confidence score.

## 2. Non-goals

- Not a content generator for marketing pages.
- Not a price / inventory crawler.
- Not a replacement for human-edited notes (manual overrides always win).

## 3. Architecture at a glance

```
  Postgres                  Node worker                    External
 +-----------+   SELECT    +-------------------+   POST    +-----------+
 | products  | ----------> |  enrich-worker    | --------> | Firecrawl |
 | variants  |             |  (orchestrator)   | <-------  | /scrape  |
 | job_queue | <---------  |                   |   JSON    +-----------+
 | sources   |  UPSERT     |  subagent loop    |
 | features  |             |  (per-product)    |   POST    +-----------+
 | summary   |             |     |             | --------> | MiniMax-M3|
 | audit     |             |     v             | <-------  | (optional)|
 +-----------+             |  summarizer       |   text    +-----------+
                           +-------------------+
```

Single Node process (`tsx scripts/enrich/worker.ts`) owns:

1. A claim queue (`enrichment_jobs`, row-locked with `SELECT … FOR UPDATE SKIP LOCKED`).
2. A Firecrawl client (rate-limited, retried, idempotent via cached pages).
3. A summarizer client — `MiniMax-M3` when `SUMMARIZER_PROVIDER=minimax`, otherwise the parent agent decides; never both at once.
4. A Postgres writer using a transaction per product so a partial failure leaves the row untouched.

Subagents = "child worker tasks" the orchestrator dispatches per product. They share
the same Postgres handle and Firecrawl cache; they do **not** pick their own model
unless explicitly told to (see §8).

## 4. PostgreSQL schema

All tables live next to `products` / `product_variants`. The migration is additive
and idempotent; run it via `npm run migrate` (it executes `scripts/migrate.ts`).

```sql
-- 4.1 Per-product web sources we trust
CREATE TABLE IF NOT EXISTS enrichment_sources (
  id              BIGSERIAL PRIMARY KEY,
  product_id      BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url             TEXT   NOT NULL,
  domain          TEXT   GENERATED ALWAYS AS (lower(split_part(url, '/', 3))) STORED,
  source_type     TEXT   NOT NULL DEFAULT 'product_page'
                    CHECK (source_type IN ('product_page','brand_page','review_aggregate','official_pdf','manual')),
  is_official     BOOLEAN NOT NULL DEFAULT FALSE,
  fetched_at      TIMESTAMPTZ,
  fetch_status    TEXT   NOT NULL DEFAULT 'pending'
                    CHECK (fetch_status IN ('pending','ok','http_error','timeout','blocked','parse_error')),
  http_status     INTEGER,
  raw_markdown    TEXT,            -- cached, capped at 200 KB
  raw_bytes       INTEGER,
  content_hash    TEXT,            -- sha256 of normalized markdown for dedup
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, url)
);
CREATE INDEX IF NOT EXISTS idx_enrichment_sources_product
  ON enrichment_sources(product_id, fetch_status);

-- 4.2 The job queue (one row per (product_id, run_id))
CREATE TABLE IF NOT EXISTS enrichment_jobs (
  id              BIGSERIAL PRIMARY KEY,
  product_id      BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  run_id          TEXT   NOT NULL,                 -- e.g. '2026-07-06T08:00Z'
  status          TEXT   NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','fetching','summarizing',
                                      'persisting','done','failed','skipped','blocked')),
  priority        SMALLINT NOT NULL DEFAULT 100,   -- smaller = earlier
  attempts        SMALLINT NOT NULL DEFAULT 0,
  max_attempts    SMALLINT NOT NULL DEFAULT 3,
  next_run_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by       TEXT,                            -- worker hostname + pid
  locked_at       TIMESTAMPTZ,
  last_error      TEXT,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, run_id)
);
-- Hot index for the claim query: oldest queued/ready work first, never grabbed twice.
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_claim
  ON enrichment_jobs(status, next_run_at)
  WHERE status IN ('queued','failed');

-- 4.3 The actual customer-facing USPs.
CREATE TABLE IF NOT EXISTS product_unique_features (
  id              BIGSERIAL PRIMARY KEY,
  product_id      BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id      BIGINT REFERENCES product_variants(id) ON DELETE CASCADE,  -- nullable
  feature_key     TEXT   NOT NULL,  -- stable slug, e.g. 'fragrance_longevity'
  headline        TEXT   NOT NULL,  -- <= 80 chars, customer-facing
  detail          TEXT,             -- <= 600 chars, longer explainer
  language        TEXT   NOT NULL DEFAULT 'ja',
  confidence      REAL   NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source_ids      BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  is_manual       BOOLEAN NOT NULL DEFAULT FALSE,
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by     BIGINT REFERENCES sugi_users(id),
  reviewed_at     TIMESTAMPTZ,
  generated_by    TEXT   NOT NULL DEFAULT 'enrich-worker',
  model_id        TEXT,             -- 'MiniMax-M3' | 'human' | 'heuristic'
  prompt_version  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Functional uniqueness: UNIQUE constraint can't take COALESCE(), so use two
-- partial unique indexes. The worker UPSERTs with matching WHERE predicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_puf_variant
  ON product_unique_features(product_id, variant_id, feature_key, language)
  WHERE variant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_puf_product
  ON product_unique_features(product_id, feature_key, language)
  WHERE variant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_puf_published
  ON product_unique_features(product_id, is_published)
  WHERE is_published = TRUE;

-- 4.4 One customer-facing short summary (rendered in product lists)
CREATE TABLE IF NOT EXISTS product_unique_summaries (
  product_id      BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  one_liner       TEXT   NOT NULL,           -- <= 140 chars
  bullet_points   TEXT[] NOT NULL,           -- up to 5, each <= 120 chars
  language        TEXT   NOT NULL DEFAULT 'ja',
  confidence      REAL   NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source_ids      BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  generated_by    TEXT   NOT NULL DEFAULT 'enrich-worker',
  model_id        TEXT,
  prompt_version  TEXT,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4.5 Audit / lineage (every summarize + every publish toggle)
CREATE TABLE IF NOT EXISTS enrichment_audit (
  id              BIGSERIAL PRIMARY KEY,
  job_id          BIGINT REFERENCES enrichment_jobs(id) ON DELETE SET NULL,
  product_id      BIGINT REFERENCES products(id) ON DELETE CASCADE,
  event           TEXT   NOT NULL,   -- 'fetch.ok','summarize.ok','publish','reject','retry','fail'
  actor           TEXT   NOT NULL,   -- worker hostname or 'admin:hein'
  details         JSONB  NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enrichment_audit_product
  ON enrichment_audit(product_id, created_at DESC);
```

> The migration block above is appended to `scripts/migrate.ts` (or shipped as
> `scripts/enrich/001_enrichment.sql` and executed from the same file).

## 5. Rate-limit + batching plan

| Stage          | Concurrency | Batch | QPS cap         | Backoff              |
|----------------|-------------|-------|-----------------|----------------------|
| Firecrawl fetch| 4 workers   | 1 URL | 3 req/s, token-bucket | exponential, jitter, honor `Retry-After` |
| Summarize      | 2 workers   | 1 prod| 1 req/s         | exponential up to 60s |
| Persist        | 1 writer    | 1 prod| n/a             | PG advisory lock per product_id |

Defaults fit a free-tier Firecrawl account; tunable via env vars
`FIRECRAWL_QPS`, `FIRECRAWL_CONCURRENCY`, `SUMMARIZER_CONCURRENCY`.

Idempotency:

- **Fetch**: `enrichment_sources(content_hash)` + `enrichment_sources(product_id, url)` UNIQUE.
  Re-running the worker reuses cached `raw_markdown` when `fetched_at < now() - 7d` AND `fetch_status='ok'`.
- **Summarize**: `product_unique_features` UNIQUE on `(product_id, variant_id, feature_key, language)`.
  Re-summaries `UPSERT` with new `confidence`, `model_id`, `prompt_version`.
- **Run resume**: a job is `done` only after the persist transaction commits. Kill the worker
  mid-run, restart it with the same `--run-id` flag; it reclaims only `queued`/`failed` rows.

## 6. Pipeline steps (per product)

1. **Claim** — `SELECT … FROM enrichment_jobs WHERE status IN ('queued','failed')
   AND next_run_at <= now() ORDER BY priority, next_run_at LIMIT 1 FOR UPDATE SKIP LOCKED`.
   Set `status='fetching', locked_by, locked_at, attempts = attempts + 1`.
2. **Resolve URLs** — deterministic order:
   1. `products.source_url` (if column exists, see §10 TODO).
   2. Brand official site via configured `BRAND_DOMAIN_MAP` JSON.
   3. Fallback: Google site-search via Firecrawl `search` endpoint (1 query, then stop).
   Up to 3 URLs per product.
3. **Fetch** — `POST /v1/scrape` with `formats: ['markdown']`, `onlyMainContent: true`,
   `timeout: 25000`. Persist to `enrich_sources` inside a per-URL transaction.
   On 4xx/5xx: write status, set `next_run_at = now() + backoff`, exit without summarising.
4. **Skip gate** — if no source ended in `status='ok'` with ≥ 600 bytes of markdown,
   mark job `blocked`, write `enrichment_audit('blocked')`. Do **not** hallucinate.
5. **Summarize** — call the configured summarizer (§8) with a strict prompt
   (Appendix A). Require JSON output `{features:[{key,headline,detail,sources_used}], one_liner, bullets}`.
   Validate: every `sources_used` must exist in `enrichment_sources` for this product;
   reject and retry once if not.
6. **Persist** — single PG transaction:
   - `UPSERT` each feature row in `product_unique_features` with `is_published=FALSE`,
     `confidence = model-reported (clamped 0..1)`.
   - `UPSERT` `product_unique_summaries`.
   - Mark job `done`, write audit rows.
7. **Publish gate** — features are **never auto-published**. A separate step
   (`scripts/enrich/publish.ts --min-confidence 0.7`) flips `is_published=TRUE`,
   gated by `confidence >= MIN` AND `reviewed_by IS NULL OR reviewed_by <> 0`.
8. **Audit** — every status transition logs to `enrichment_audit`.

## 7. CLI

```bash
# One-shot enqueue for all active products, fresh run-id
tsx scripts/enrich/enqueue.ts --all

# Resume a run, process 50 jobs then exit (cron-friendly)
tsx scripts/enrich/worker.ts --run-id 2026-07-06T08:00Z --limit 50

# Dry-run: fetch only, no summarization
tsx scripts/enrich/worker.ts --run-id 2026-07-06T08:00Z --fetch-only

# Publish pass
tsx scripts/enrich/publish.ts --min-confidence 0.7 --dry-run

# Roll back a feature row to manual-only
tsx scripts/enrich/reject.ts --product-id 123 --feature-key fragrance_longevity --by hein
```

Flags `--limit`, `--product-ids`, `--only-stale-since 30d` all work.

## 8. Model selection (no hallucination rule)

Configurable via env, **never picked per-call by a subagent**:

```
SUMMARIZER_PROVIDER  = minimax   # or 'parent-agent' | 'heuristic'
SUMMARIZER_MODEL     = MiniMax-M3
FIRECRAWL_API_KEY    = …
MIN_CONFIDENCE       = 0.55
PROMPT_VERSION       = usp.v1
```

- `minimax` → HTTP call to the configured MiniMax-M3 endpoint (see §10 verification step).
- `parent-agent` → emit a JSON file under `out/pending-summary/<product_id>.json`
  and exit; the parent Hermes agent picks them up and writes back the result.
- `heuristic` → regex/keyword extraction; used as a smoke-test fallback.

Subagents **must not** assume a direct `model.select()` API. The worker reads
`SUMMARIZER_PROVIDER` once at startup and refuses to start if it is unset.

## 9. No-hallucination guarantees (enforced, not promised)

1. Every `feature_key` row carries `source_ids BIGINT[]` referencing rows that
   actually exist in `enrichment_sources` (FK-style check via app code + a
   nightly SQL check, see §11).
2. The summarizer prompt forbids claims not present in the supplied markdown
   (Appendix A). The output schema requires `sources_used` per feature.
3. `confidence` is the model-reported value clamped to `[0,1]`. Auto-publish
   requires `confidence >= MIN_CONFIDENCE`.
4. `is_published=FALSE` by default. Manual review (or a separate confidence
   gate run) flips it.
5. `enrichment_audit` records the exact `prompt_version`, `model_id`, and raw
   JSON, so any disputed claim can be replayed.

## 10. TODO / verification before first run

These items must be confirmed in the live env before flipping the switch:

- [ ] Confirm `products` table has (or can be extended with) `source_url TEXT` to
      avoid scraping for every product. If not, add via the same migration.
- [ ] Confirm the MiniMax-M3 HTTP endpoint + auth header. Subagent cannot
      assume; test with one product first.
- [ ] Confirm Firecrawl plan QPS / monthly credit covers 331 products × 3 URLs
      (~1000 fetches). Default cadence: 3 QPS ⇒ ~6 minutes per pass.
- [ ] Seed `BRAND_DOMAIN_MAP` from the existing category list (see migrate.ts
      category detection for cosmetics/healthcare).
- [ ] Run `npm run migrate`, then `tsx scripts/enrich/enqueue.ts --all`,
      then `tsx scripts/enrich/worker.ts --limit 5 --fetch-only` as a smoke
      test before the real pass.

## 11. Verification queries (run after the worker finishes)

```sql
-- 11.1 Coverage
SELECT
  COUNT(*) FILTER (WHERE uf.product_id IS NOT NULL) AS enriched,
  COUNT(*) FILTER (WHERE uf.product_id IS NULL)     AS missing
FROM products p
LEFT JOIN product_unique_features uf
  ON uf.product_id = p.id AND uf.is_published AND uf.language = 'ja';

-- 11.2 Orphan source references (should be zero)
SELECT f.id, f.product_id, f.feature_key
FROM product_unique_features f
WHERE EXISTS (
  SELECT 1 FROM unnest(f.source_ids) AS sid
  WHERE NOT EXISTS (SELECT 1 FROM enrichment_sources s WHERE s.id = sid)
);

-- 11.3 Confidence histogram
SELECT width_bucket(confidence, 0, 1, 10) AS bucket, COUNT(*)
FROM product_unique_features GROUP BY 1 ORDER BY 1;

-- 11.4 Stuck jobs
SELECT status, COUNT(*) FROM enrichment_jobs
WHERE run_id = '2026-07-06T08:00Z' GROUP BY status;

-- 11.5 Freshness
SELECT product_id, MAX(updated_at) FROM product_unique_features GROUP BY 1 ORDER BY 2;
```

Acceptance:

- 11.1 missing ≤ 5% of active products.
- 11.2 returns 0 rows.
- 11.3 ≥ 80% of rows in buckets 7..10 (confidence ≥ 0.6).
- 11.4 no rows in `fetching` / `summarizing` / `persisting` after the run completes.
- 11.5 every product touched within the run window.

## Appendix A — summarizer prompt (sketch)

System: "You are a Japanese cosmetics/healthcare copywriter. Use ONLY facts present in the supplied markdown. If a claim is not supported, omit it. Reply with strict JSON."

User: ```json
{
  "product_name": "...",
  "category": "...",
  "markdown": "...",                // up to 8 KB
  "instructions": [
    "Output 3-5 unique selling points.",
    "Each USP must cite at least one source_index from the list.",
    "headline <= 80 chars, detail <= 600 chars, Japanese.",
    "No marketing fluff not present in the source.",
    "If nothing unique is supported, return {\"features\":[]}"
  ]
}
```

JSON shape returned:
```json
{
  "one_liner": "...",
  "bullets": ["...", "...", "..."],
  "features": [
    { "key": "...", "headline": "...", "detail": "...", "source_indexes": [0,2] }
  ],
  "confidence": 0.0
}
```