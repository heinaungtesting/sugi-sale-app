import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'prisma',
  'migrations',
  '20260829_pgroonga_product_search',
  'migration.sql',
);
const privilegeBoundaryMigrationPath = join(
  process.cwd(),
  'prisma',
  'migrations',
  '20260831_isolate_pgroonga_search_privileges',
  'migration.sql',
);

describe('PGroonga product search migration', () => {
  it('ships a forward-only Japanese search migration', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migration = readFileSync(migrationPath, 'utf8');
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).not.toContain('CREATE SCHEMA');
    expect(migration).toContain('aclexplode');
    expect(migration).toContain("privilege_type = 'CREATE'");
    expect(migration).toContain("has_schema_privilege(role_row.oid, extension_schema.oid, 'CREATE')");
    expect(migration).toContain("role_row.rolname = 'dashboard_user'");
    expect(migration).toContain('role_row.rolcreaterole');
    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS pgroonga');
    expect(migration).toContain('PGroonga 3.2.1 or newer is required');
    expect(migration).toContain('GRANT USAGE ON SCHEMA extensions TO sugi_app');
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION extensions.pgroonga_command(TEXT) FROM PUBLIC');
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION extensions.pgroonga_set_writable(BOOLEAN) FROM PUBLIC');
    expect(migration).toContain('idx_products_search_pgroonga');
    expect(migration).toContain('idx_product_variants_search_pgroonga');
    expect(migration).toMatch(/USING\s+pgroonga/i);
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });

  it('isolates PGroonga behind a least-privilege search function', () => {
    expect(existsSync(privilegeBoundaryMigrationPath)).toBe(true);
    if (!existsSync(privilegeBoundaryMigrationPath)) return;

    const migration = readFileSync(privilegeBoundaryMigrationPath, 'utf8');
    expect(migration).toContain('CREATE FUNCTION sugi.search_product_candidates');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, extensions');
    expect(migration).toContain('REVOKE ALL ON FUNCTION sugi.search_product_candidates');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION sugi.search_product_candidates');
    expect(migration).toContain('REVOKE USAGE ON SCHEMA extensions FROM sugi_app');
    expect(migration).toContain('search_user_id BIGINT');
    expect(migration).toContain('product_id BIGINT');
    expect(migration).toContain('variant_id BIGINT');
    expect(migration).toContain("has_schema_privilege('sugi_app', 'extensions', 'USAGE')");
    expect(migration).toContain('cardinality(requested_terms), 0) <= 8');
    expect(migration).toContain('MAX(char_length(input_term)) <= 32');
    expect(migration).toContain('SUM(char_length(input_term)) <= 128');
    expect(migration).toContain('(p.user_id IS NULL OR p.user_id = search_user_id)');
    expect(migration).toContain('(variant_parent.user_id IS NULL OR variant_parent.user_id = search_user_id)');
  });
});
