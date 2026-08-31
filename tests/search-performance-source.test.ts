import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('search performance source contract', () => {
  it('filters product search in SQL before JS ranking', () => {
    const db = source('lib/sugi-db.ts');
    const searchBoundary = source('prisma/migrations/20260831_isolate_pgroonga_search_privileges/migration.sql');
    expect(db).toContain('prepareProductSearchQuery(search)');
    expect(db).toContain('product_matches AS');
    expect(db).toContain('variant_matches AS');
    expect(db).toContain('sugi.search_product_candidates');
    expect(searchBoundary).toContain('product_trigram_matches AS');
    expect(searchBoundary).toContain('variant_trigram_matches AS');
    expect(searchBoundary).toContain('public.similarity');
    expect(searchBoundary).toContain('search_score >= 0.4');
    expect(db).toContain('SELECT DISTINCT term');
    expect(searchBoundary).toContain('pgroonga_query_escape');
    expect(searchBoundary).toContain('pgroonga_condition');
    expect(searchBoundary).toContain('fuzzy_max_distance_ratio');
    expect(searchBoundary).toContain('char_length(requested_term) >= 4');
    expect(searchBoundary).toContain('0.34::REAL');
    expect(searchBoundary).toContain('&@~');
    expect(searchBoundary).toContain('pgroonga_score');
    expect(db).not.toContain('normalize(p.product_name, NFKC)');
    expect(db).not.toContain("LIKE '%' || $2 || '%'");
    expect(db).toContain('LIMIT $3');
  });

  it('pre-aggregates sale counts instead of multiplying rows through sales_logs joins', () => {
    const db = source('lib/sugi-db.ts');
    expect(db).toContain('sale_counts AS (');
    expect(db).toContain('GROUP BY product_id');
    expect(db).not.toContain('COALESCE(COUNT(s.id), 0)::text AS sale_count');
  });

  it('migration keeps search and sales indexes present', () => {
    const migrate = source('scripts/migrate.ts');
    expect(migrate).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    expect(migrate).toContain('idx_products_active_visible');
    expect(migrate).toContain('idx_product_variants_label_trgm');
    expect(migrate).toContain('idx_sales_logs_user_product');
  });
});
