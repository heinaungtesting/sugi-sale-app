-- 001_enrichment.sql
-- Idempotent; safe to re-run. Appended to scripts/migrate.ts via fs.readFileSync.

-- 4.1 Sources
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
  raw_markdown    TEXT,
  raw_bytes       INTEGER,
  content_hash    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, url)
);
CREATE INDEX IF NOT EXISTS idx_enrichment_sources_product
  ON enrichment_sources(product_id, fetch_status);

-- 4.2 Jobs
CREATE TABLE IF NOT EXISTS enrichment_jobs (
  id              BIGSERIAL PRIMARY KEY,
  product_id      BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  run_id          TEXT   NOT NULL,
  status          TEXT   NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','fetching','summarizing','persisting','done','failed','skipped','blocked')),
  priority        SMALLINT NOT NULL DEFAULT 100,
  attempts        SMALLINT NOT NULL DEFAULT 0,
  max_attempts    SMALLINT NOT NULL DEFAULT 3,
  next_run_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by       TEXT,
  locked_at       TIMESTAMPTZ,
  last_error      TEXT,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, run_id)
);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_claim
  ON enrichment_jobs(status, next_run_at)
  WHERE status IN ('queued','failed');

-- 4.3 Features
CREATE TABLE IF NOT EXISTS product_unique_feature_items (
  id              BIGSERIAL PRIMARY KEY,
  product_id      BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id      BIGINT REFERENCES product_variants(id) ON DELETE CASCADE,
  feature_key     TEXT   NOT NULL,
  headline        TEXT   NOT NULL,
  detail          TEXT,
  language        TEXT   NOT NULL DEFAULT 'ja',
  confidence      REAL   NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source_ids      BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  is_manual       BOOLEAN NOT NULL DEFAULT FALSE,
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by     BIGINT REFERENCES sugi_users(id),
  reviewed_at     TIMESTAMPTZ,
  generated_by    TEXT   NOT NULL DEFAULT 'enrich-worker',
  model_id        TEXT,
  prompt_version  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Older installations created this table before variant-specific features existed.
ALTER TABLE product_unique_feature_items
  ADD COLUMN IF NOT EXISTS variant_id BIGINT REFERENCES product_variants(id) ON DELETE CASCADE;
-- Functional unique key: variant_id NULL handled by COALESCE. UNIQUE constraint
-- can't take expressions, so use two partial indexes instead.
CREATE UNIQUE INDEX IF NOT EXISTS uq_puf_variant
  ON product_unique_feature_items(product_id, variant_id, feature_key, language)
  WHERE variant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_puf_product
  ON product_unique_feature_items(product_id, feature_key, language)
  WHERE variant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_puf_published
  ON product_unique_feature_items(product_id, is_published)
  WHERE is_published = TRUE;

-- 4.4 Customer-facing short summary
CREATE TABLE IF NOT EXISTS product_unique_summaries (
  product_id      BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  one_liner       TEXT   NOT NULL,
  bullet_points   TEXT[] NOT NULL,
  language        TEXT   NOT NULL DEFAULT 'ja',
  confidence      REAL   NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source_ids      BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  generated_by    TEXT   NOT NULL DEFAULT 'enrich-worker',
  model_id        TEXT,
  prompt_version  TEXT,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4.5 Audit
CREATE TABLE IF NOT EXISTS enrichment_audit (
  id              BIGSERIAL PRIMARY KEY,
  job_id          BIGINT REFERENCES enrichment_jobs(id) ON DELETE SET NULL,
  product_id      BIGINT REFERENCES products(id) ON DELETE CASCADE,
  event           TEXT   NOT NULL,
  actor           TEXT   NOT NULL,
  details         JSONB  NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enrichment_audit_product
  ON enrichment_audit(product_id, created_at DESC);