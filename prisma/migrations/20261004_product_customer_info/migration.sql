BEGIN;

-- Customer-facing product info cards (parent products only).
-- Every customer-visible row is reviewed by an admin before it is published;
-- Hermes can only write drafts through the ingest endpoint.

ALTER TABLE "sugi"."products"
  ADD COLUMN IF NOT EXISTS "product_type" TEXT NOT NULL DEFAULT 'other'
    CONSTRAINT "products_product_type_check"
    CHECK ("product_type" IN ('medicine', 'kampo', 'supplement', 'other')),
  ADD COLUMN IF NOT EXISTS "risk_class" TEXT
    CONSTRAINT "products_risk_class_check"
    CHECK ("risk_class" IN ('class2', 'designated2', 'class3', 'quasi_drug', 'food'));

-- Monotonic version stamped on every change that can alter a published card.
-- The offline bundle syncs with ?since=<version>.
CREATE SEQUENCE IF NOT EXISTS "sugi"."customer_info_content_version_seq";

CREATE TABLE "sugi"."product_customer_info" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "language" TEXT NOT NULL
        CHECK ("language" IN ('ja', 'en', 'zh-Hans')),
    "field_key" TEXT NOT NULL
        CHECK ("field_key" IN ('display_name', 'unique_features', 'purpose', 'risks', 'ingredients', 'kampo_formula', 'claim')),
    "body" TEXT NOT NULL
        CHECK (char_length("body") BETWEEN 1 AND 4000),
    "status" TEXT NOT NULL DEFAULT 'draft'
        CHECK ("status" IN ('draft', 'published', 'rejected', 'stale')),
    "reject_reason" TEXT,
    "source_ids" BIGINT[] NOT NULL DEFAULT '{}',
    "ja_source_hash" TEXT,
    "generated_by" TEXT NOT NULL DEFAULT 'hermes',
    "model_id" TEXT,
    "prompt_version" TEXT,
    "reviewed_by" BIGINT,
    "reviewed_at" TIMESTAMPTZ,
    "content_version" BIGINT NOT NULL DEFAULT nextval('"sugi"."customer_info_content_version_seq"'),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "product_customer_info_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_customer_info_published_reviewed"
        CHECK ("status" <> 'published' OR ("reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL)),
    CONSTRAINT "product_customer_info_product_id_fkey"
        FOREIGN KEY ("product_id") REFERENCES "sugi"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "product_customer_info_reviewed_by_fkey"
        FOREIGN KEY ("reviewed_by") REFERENCES "sugi"."sugi_users"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

ALTER SEQUENCE "sugi"."customer_info_content_version_seq"
  OWNED BY "sugi"."product_customer_info"."content_version";

CREATE UNIQUE INDEX "product_customer_info_product_language_field_key"
  ON "sugi"."product_customer_info" ("product_id", "language", "field_key");
CREATE INDEX "idx_pci_published"
  ON "sugi"."product_customer_info" ("product_id", "language") WHERE "status" = 'published';
CREATE INDEX "idx_pci_review_queue"
  ON "sugi"."product_customer_info" ("status", "updated_at") WHERE "status" IN ('draft', 'stale');
CREATE INDEX "idx_pci_content_version"
  ON "sugi"."product_customer_info" ("content_version");

-- The runtime role needs DML on the new table only. Role creation stays in
-- infrastructure setup; skip quietly where that role does not exist (local Docker).
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sugi_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "sugi"."product_customer_info" TO sugi_app;
    GRANT USAGE, SELECT ON SEQUENCE "sugi"."product_customer_info_id_seq" TO sugi_app;
    GRANT USAGE, SELECT ON SEQUENCE "sugi"."customer_info_content_version_seq" TO sugi_app;
  END IF;
END
$grants$;

COMMIT;
