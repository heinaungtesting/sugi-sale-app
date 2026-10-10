BEGIN;

-- Small key/value store for admin-editable integration settings
-- (e.g. the Hermes draft endpoint). Secrets stored here are never
-- returned to the browser by the API.
CREATE TABLE "sugi"."app_settings" (
    "key" TEXT NOT NULL
        CHECK ("key" ~ '^[a-z0-9_.-]{1,64}$'),
    "value" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "app_settings_updated_by_fkey"
        FOREIGN KEY ("updated_by") REFERENCES "sugi"."sugi_users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sugi_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "sugi"."app_settings" TO sugi_app;
  END IF;
END
$grants$;

COMMIT;
