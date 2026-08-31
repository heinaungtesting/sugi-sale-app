BEGIN;

-- PGroonga is PostgreSQL-specific and Prisma cannot represent its access method,
-- operators, or expression indexes in schema.prisma. Supabase provisions the
-- extensions schema; refuse to install executable extension code into a schema
-- where an application role can create shadow objects.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    RAISE EXCEPTION 'trusted extensions schema is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_namespace AS extension_schema
    CROSS JOIN LATERAL aclexplode(
      COALESCE(extension_schema.nspacl, acldefault('n', extension_schema.nspowner))
    ) AS schema_acl
    WHERE extension_schema.nspname = 'extensions'
      AND schema_acl.grantee = 0
      AND schema_acl.privilege_type = 'CREATE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC must not have CREATE on extensions schema';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles AS role_row
    CROSS JOIN pg_namespace AS extension_schema
    WHERE extension_schema.nspname = 'extensions'
      AND role_row.oid <> extension_schema.nspowner
      AND NOT role_row.rolsuper
      AND NOT (
        role_row.rolname = 'dashboard_user'
        AND role_row.rolcreaterole
      )
      AND has_schema_privilege(role_row.oid, extension_schema.oid, 'CREATE')
  ) THEN
    RAISE EXCEPTION 'an untrusted role may CREATE in extensions schema';
  END IF;
END
$migration$;

CREATE EXTENSION IF NOT EXISTS pgroonga WITH SCHEMA "extensions";

DO $migration$
DECLARE
  installed_version TEXT;
BEGIN
  SELECT extension_row.extversion
  INTO installed_version
  FROM pg_extension AS extension_row
  JOIN pg_namespace AS extension_schema ON extension_schema.oid = extension_row.extnamespace
  WHERE extension_row.extname = 'pgroonga'
    AND extension_schema.nspname = 'extensions';

  IF installed_version IS NULL THEN
    RAISE EXCEPTION 'PGroonga must be installed in extensions schema';
  END IF;

  IF string_to_array(regexp_replace(installed_version, '[^0-9.].*$', ''), '.')::INT[] < ARRAY[3, 2, 1] THEN
    RAISE EXCEPTION 'PGroonga 3.2.1 or newer is required';
  END IF;
END
$migration$;

GRANT USAGE ON SCHEMA extensions TO sugi_app;

-- PGroonga grants EXECUTE to PUBLIC by default. Search only needs its matching,
-- scoring, and escaping APIs, so keep raw commands and maintenance controls away
-- from the least-privileged runtime role (including through PUBLIC membership).
REVOKE EXECUTE ON FUNCTION extensions.pgroonga_command(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION extensions.pgroonga_command(TEXT, TEXT[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION extensions.pgroonga_set_writable(BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION extensions.pgroonga_vacuum() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION extensions.pgroonga_wal_apply() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION extensions.pgroonga_wal_apply(CSTRING) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION extensions.pgroonga_wal_truncate() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION extensions.pgroonga_wal_truncate(CSTRING) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION extensions.pgroonga_wal_set_applied_position() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION extensions.pgroonga_wal_set_applied_position(BIGINT, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION extensions.pgroonga_wal_set_applied_position(CSTRING) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION extensions.pgroonga_wal_set_applied_position(CSTRING, BIGINT, BIGINT) FROM PUBLIC;

-- These transactional builds briefly block writes to the two catalog tables.
-- The current catalog is small; re-evaluate a concurrent rollout if it grows.
CREATE INDEX "idx_products_search_pgroonga"
ON "sugi"."products"
USING pgroonga (
  (ARRAY["product_name"] || COALESCE("nicknames", ARRAY[]::TEXT[]))
);

CREATE INDEX "idx_product_variants_search_pgroonga"
ON "sugi"."product_variants"
USING pgroonga (
  (ARRAY["variant_label", COALESCE("display_shortcut", '')] || COALESCE("nicknames", ARRAY[]::TEXT[]))
);

COMMIT;
