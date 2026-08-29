-- This migration is intentionally schema-only. Seed data and historical-data
-- repairs belong in separate, explicitly approved operations.

CREATE SCHEMA IF NOT EXISTS "sugi";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "sugi"."sugi_users" (
    "id" BIGSERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    "feedback_prompt_seen_at" TIMESTAMPTZ,
    "navigation_v9_prompt_seen_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "sugi_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sugi"."sugi_sessions" (
    "jti" TEXT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "last_used_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "user_agent" TEXT NOT NULL DEFAULT '',
    "device_label" TEXT NOT NULL DEFAULT 'Unknown device',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "sugi_sessions_pkey" PRIMARY KEY ("jti")
);

CREATE UNLOGGED TABLE "sugi"."sugi_rate_limits" (
    "scope" TEXT NOT NULL,
    "subject_key" TEXT NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    "window_started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sugi_rate_limits_pkey" PRIMARY KEY ("scope", "subject_key")
);

CREATE TABLE "sugi"."sugi_point_campaigns" (
    "campaign_month" TEXT NOT NULL,
    "replace_all" BOOLEAN NOT NULL DEFAULT TRUE,
    "status" TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'applied')),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_at" TIMESTAMPTZ,

    CONSTRAINT "sugi_point_campaigns_pkey" PRIMARY KEY ("campaign_month")
);

CREATE TABLE "sugi"."sugi_point_campaign_items" (
    "id" BIGSERIAL NOT NULL,
    "campaign_month" TEXT NOT NULL,
    "target_type" TEXT NOT NULL CHECK (target_type IN ('product', 'variant')),
    "product_id" BIGINT NOT NULL,
    "variant_id" BIGINT,
    "product_name" TEXT NOT NULL,
    "variant_label" TEXT,
    "point_value" INTEGER NOT NULL CHECK (point_value >= 0),
    "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "source" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "sugi_point_campaign_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sugi"."sugi_activity_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT,
    "actor_user_id" BIGINT,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "sugi_activity_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sugi"."sugi_feedback" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "category" TEXT NOT NULL CHECK (category IN ('改善案', '不具合', 'その他')),
    "message" TEXT NOT NULL CHECK (char_length(message) BETWEEN 10 AND 1000),
    "status" TEXT NOT NULL DEFAULT '未確認' CHECK (status IN ('未確認', '確認済み', '対応中', '完了')),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "sugi_feedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sugi"."products" (
    "id" BIGSERIAL NOT NULL,
    "product_name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'ヘルスケア',
    "point_value" INTEGER NOT NULL DEFAULT 0 CHECK (point_value >= 0),
    "nicknames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    "user_id" BIGINT,
    "source_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sugi"."product_variants" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "variant_label" TEXT NOT NULL,
    "display_shortcut" TEXT,
    "unit_count" INTEGER NOT NULL DEFAULT 1 CHECK (unit_count > 0),
    "point_value" INTEGER NOT NULL DEFAULT 0 CHECK (point_value >= 0),
    "nicknames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sugi"."sales_logs" (
    "id" BIGSERIAL NOT NULL,
    "sold_date" DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Tokyo')::date),
    "user_id" BIGINT,
    "product_id" BIGINT,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    "points_per_item" INTEGER NOT NULL CHECK (points_per_item >= 0),
    "total_points" INTEGER GENERATED ALWAYS AS (quantity * points_per_item) STORED,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "sales_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sugi"."sale_idempotency_receipts" (
    "user_id" BIGINT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "sale_id" BIGINT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "sale_idempotency_receipts_pkey" PRIMARY KEY ("user_id", "idempotency_key")
);

CREATE TABLE "sugi"."enrichment_sources" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT GENERATED ALWAYS AS (lower(split_part(url, '/', 3))) STORED,
    "source_type" TEXT NOT NULL DEFAULT 'product_page'
        CHECK (source_type IN ('product_page', 'brand_page', 'review_aggregate', 'official_pdf', 'manual')),
    "is_official" BOOLEAN NOT NULL DEFAULT FALSE,
    "fetched_at" TIMESTAMPTZ,
    "fetch_status" TEXT NOT NULL DEFAULT 'pending'
        CHECK (fetch_status IN ('pending', 'ok', 'http_error', 'timeout', 'blocked', 'parse_error')),
    "http_status" INTEGER,
    "raw_markdown" TEXT,
    "raw_bytes" INTEGER,
    "content_hash" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "enrichment_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sugi"."enrichment_jobs" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "run_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'fetching', 'summarizing', 'persisting', 'done', 'failed', 'skipped', 'blocked')),
    "priority" SMALLINT NOT NULL DEFAULT 100,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "max_attempts" SMALLINT NOT NULL DEFAULT 3,
    "next_run_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "locked_by" TEXT,
    "locked_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "enrichment_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sugi"."product_unique_feature_items" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "variant_id" BIGINT,
    "feature_key" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "detail" TEXT,
    "language" TEXT NOT NULL DEFAULT 'ja',
    "confidence" REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    "source_ids" BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
    "is_manual" BOOLEAN NOT NULL DEFAULT FALSE,
    "is_published" BOOLEAN NOT NULL DEFAULT FALSE,
    "reviewed_by" BIGINT,
    "reviewed_at" TIMESTAMPTZ,
    "generated_by" TEXT NOT NULL DEFAULT 'enrich-worker',
    "model_id" TEXT,
    "prompt_version" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "product_unique_feature_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sugi"."product_unique_summaries" (
    "product_id" BIGINT NOT NULL,
    "one_liner" TEXT NOT NULL,
    "bullet_points" TEXT[] NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'ja',
    "confidence" REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    "source_ids" BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
    "generated_by" TEXT NOT NULL DEFAULT 'enrich-worker',
    "model_id" TEXT,
    "prompt_version" TEXT,
    "generated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "product_unique_summaries_pkey" PRIMARY KEY ("product_id")
);

CREATE TABLE "sugi"."enrichment_audit" (
    "id" BIGSERIAL NOT NULL,
    "job_id" BIGINT,
    "product_id" BIGINT,
    "event" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "enrichment_audit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sugi_users_username_key" ON "sugi"."sugi_users" ("username");
CREATE INDEX "idx_sugi_rate_limits_expiry" ON "sugi"."sugi_rate_limits" ("expires_at");
CREATE INDEX "idx_sugi_point_campaign_items_month" ON "sugi"."sugi_point_campaign_items" ("campaign_month");
CREATE INDEX "idx_sugi_activity_logs_created" ON "sugi"."sugi_activity_logs" ("created_at" DESC);
CREATE INDEX "idx_sugi_activity_logs_user" ON "sugi"."sugi_activity_logs" ("user_id", "created_at" DESC);
CREATE INDEX "idx_sugi_feedback_user_created" ON "sugi"."sugi_feedback" ("user_id", "created_at" DESC);
CREATE INDEX "idx_sugi_feedback_status_created" ON "sugi"."sugi_feedback" ("status", "created_at" DESC);
CREATE UNIQUE INDEX "products_product_name_key" ON "sugi"."products" ("product_name");
CREATE INDEX "idx_products_user_category" ON "sugi"."products" ("user_id", "category", "is_active");
CREATE INDEX "idx_products_active_visible" ON "sugi"."products" ("user_id", "is_active", "product_name");
CREATE UNIQUE INDEX "product_variants_product_id_variant_label_key" ON "sugi"."product_variants" ("product_id", "variant_label");
CREATE INDEX "idx_sales_logs_user_date" ON "sugi"."sales_logs" ("user_id", "sold_date", "created_at" DESC);
CREATE INDEX "idx_sales_logs_user_product" ON "sugi"."sales_logs" ("user_id", "product_id");
CREATE INDEX "idx_sale_idempotency_receipts_sale" ON "sugi"."sale_idempotency_receipts" ("sale_id");
CREATE INDEX "idx_enrichment_sources_product" ON "sugi"."enrichment_sources" ("product_id", "fetch_status");
CREATE UNIQUE INDEX "enrichment_sources_product_id_url_key" ON "sugi"."enrichment_sources" ("product_id", "url");
CREATE UNIQUE INDEX "enrichment_jobs_product_id_run_id_key" ON "sugi"."enrichment_jobs" ("product_id", "run_id");
CREATE INDEX "idx_enrichment_audit_product" ON "sugi"."enrichment_audit" ("product_id", "created_at" DESC);

CREATE UNIQUE INDEX "uniq_sales_logs_user_idem"
    ON "sugi"."sales_logs" ("user_id", "idempotency_key")
    WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX "uniq_sales_logs_daily_product"
    ON "sugi"."sales_logs" ("user_id", "sold_date", "product_id", "product_name")
    WHERE "user_id" IS NOT NULL AND "product_id" IS NOT NULL;
CREATE INDEX "idx_products_name_trgm"
    ON "sugi"."products" USING GIN ("product_name" gin_trgm_ops);
CREATE INDEX "idx_products_nicknames_gin"
    ON "sugi"."products" USING GIN ("nicknames");
CREATE INDEX "idx_product_variants_product_active"
    ON "sugi"."product_variants" ("product_id", "unit_count")
    WHERE "is_active" = TRUE;
CREATE INDEX "idx_product_variants_nicknames_gin"
    ON "sugi"."product_variants" USING GIN ("nicknames");
CREATE INDEX "idx_product_variants_label_trgm"
    ON "sugi"."product_variants" USING GIN ("variant_label" gin_trgm_ops);
CREATE INDEX "idx_product_variants_shortcut_trgm"
    ON "sugi"."product_variants" USING GIN ("display_shortcut" gin_trgm_ops);
CREATE INDEX "idx_sugi_sessions_user_active"
    ON "sugi"."sugi_sessions" ("user_id", "expires_at")
    WHERE "revoked_at" IS NULL;
CREATE INDEX "idx_sugi_sessions_user_last_used"
    ON "sugi"."sugi_sessions" ("user_id", "last_used_at" DESC)
    WHERE "revoked_at" IS NULL;
CREATE INDEX "idx_enrichment_jobs_claim"
    ON "sugi"."enrichment_jobs" ("status", "next_run_at")
    WHERE "status" IN ('queued', 'failed');
CREATE UNIQUE INDEX "uq_puf_variant"
    ON "sugi"."product_unique_feature_items" ("product_id", "variant_id", "feature_key", "language")
    WHERE "variant_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_puf_product"
    ON "sugi"."product_unique_feature_items" ("product_id", "feature_key", "language")
    WHERE "variant_id" IS NULL;
CREATE INDEX "idx_puf_published"
    ON "sugi"."product_unique_feature_items" ("product_id", "is_published")
    WHERE "is_published" = TRUE;

ALTER TABLE "sugi"."sugi_sessions"
    ADD CONSTRAINT "sugi_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "sugi"."sugi_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sugi"."sugi_point_campaign_items"
    ADD CONSTRAINT "sugi_point_campaign_items_campaign_month_fkey"
    FOREIGN KEY ("campaign_month") REFERENCES "sugi"."sugi_point_campaigns"("campaign_month") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sugi"."sugi_point_campaign_items"
    ADD CONSTRAINT "sugi_point_campaign_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "sugi"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sugi"."sugi_point_campaign_items"
    ADD CONSTRAINT "sugi_point_campaign_items_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "sugi"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sugi"."sugi_activity_logs"
    ADD CONSTRAINT "sugi_activity_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "sugi"."sugi_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sugi"."sugi_activity_logs"
    ADD CONSTRAINT "sugi_activity_logs_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "sugi"."sugi_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sugi"."sugi_feedback"
    ADD CONSTRAINT "sugi_feedback_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "sugi"."sugi_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sugi"."products"
    ADD CONSTRAINT "products_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "sugi"."sugi_users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "sugi"."product_variants"
    ADD CONSTRAINT "product_variants_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "sugi"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sugi"."sales_logs"
    ADD CONSTRAINT "sales_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "sugi"."sugi_users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "sugi"."sales_logs"
    ADD CONSTRAINT "sales_logs_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "sugi"."products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sugi"."sale_idempotency_receipts"
    ADD CONSTRAINT "sale_idempotency_receipts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "sugi"."sugi_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sugi"."sale_idempotency_receipts"
    ADD CONSTRAINT "sale_idempotency_receipts_sale_id_fkey"
    FOREIGN KEY ("sale_id") REFERENCES "sugi"."sales_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sugi"."enrichment_sources"
    ADD CONSTRAINT "enrichment_sources_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "sugi"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sugi"."enrichment_jobs"
    ADD CONSTRAINT "enrichment_jobs_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "sugi"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sugi"."product_unique_feature_items"
    ADD CONSTRAINT "product_unique_feature_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "sugi"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sugi"."product_unique_feature_items"
    ADD CONSTRAINT "product_unique_feature_items_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "sugi"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sugi"."product_unique_feature_items"
    ADD CONSTRAINT "product_unique_feature_items_reviewed_by_fkey"
    FOREIGN KEY ("reviewed_by") REFERENCES "sugi"."sugi_users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "sugi"."product_unique_summaries"
    ADD CONSTRAINT "product_unique_summaries_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "sugi"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sugi"."enrichment_audit"
    ADD CONSTRAINT "enrichment_audit_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "sugi"."enrichment_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sugi"."enrichment_audit"
    ADD CONSTRAINT "enrichment_audit_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "sugi"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
