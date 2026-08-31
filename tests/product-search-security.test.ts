import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('product search security contract', () => {
  it('bounds and rate limits authenticated search before querying PGroonga', () => {
    const route = source('app/api/products/route.ts');
    expect(route).toContain('prepareProductSearchQuery(search)');
    expect(route).toContain("reserveRateLimit('product-search'");
    expect(route).toContain("status: 400");
    expect(route).toContain("status: 429");
  });

  it('uses a short database timeout and filters visibility inside match CTEs', () => {
    const db = source('lib/sugi-db.ts');
    const boundary = source('prisma/migrations/20260831_isolate_pgroonga_search_privileges/migration.sql');
    expect(db).toContain("set_config('statement_timeout', $1, true)");
    expect(db).toContain('PRODUCT_SEARCH_TIMEOUT_MS = 2_000');
    expect(boundary).toContain('p.is_active = TRUE');
    expect(boundary).toContain('(p.user_id IS NULL OR p.user_id = search_user_id)');
    expect(boundary).toContain('variant_parent.is_active = TRUE');
    expect(boundary).toContain('(variant_parent.user_id IS NULL OR variant_parent.user_id = search_user_id)');
  });

  it('isolates schema-qualified PGroonga APIs from the runtime search path', () => {
    const db = source('lib/sugi-db.ts');
    const databaseUrl = source('lib/database-url.ts');
    const migration = source('prisma/migrations/20260829_pgroonga_product_search/migration.sql');
    const boundary = source('prisma/migrations/20260831_isolate_pgroonga_search_privileges/migration.sql');
    const verifier = source('scripts/verify-prisma-schema.ts');
    expect(db).toContain('sugi.search_product_candidates');
    expect(db).not.toContain('extensions.pgroonga_command');
    expect(boundary).toContain('extensions.pgroonga_query_escape');
    expect(boundary).toContain('extensions.pgroonga_condition');
    expect(boundary).toContain('extensions.pgroonga_score');
    expect(boundary).toContain('OPERATOR(extensions.&@~)');
    expect(databaseUrl).toContain('search_path=pg_catalog,sugi');
    expect(databaseUrl).not.toContain('search_path=pg_catalog,sugi,extensions');
    expect(databaseUrl).not.toContain('search_path=sugi,public');
    expect(migration).toContain("has_schema_privilege(role_row.oid, extension_schema.oid, 'CREATE')");
    expect(migration).toContain("role_row.rolname = 'dashboard_user'");
    expect(verifier).toContain("role_row.rolname = 'dashboard_user'");
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION extensions.pgroonga_command(TEXT) FROM PUBLIC');
    expect(migration).toContain('GRANT USAGE ON SCHEMA extensions TO sugi_app');
    expect(boundary).toContain('REVOKE USAGE ON SCHEMA extensions FROM sugi_app');
    expect(verifier).toContain('runtimeCanExecuteDangerousPgroongaFunctions');
    expect(verifier).toContain('searchFunctionIsSecurityDefiner');
    expect(verifier).toContain('runtimeCanExecuteSearchFunction');
  });
});
