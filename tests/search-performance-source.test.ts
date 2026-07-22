import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('search performance source contract', () => {
  it('filters product search in SQL before JS ranking', () => {
    const db = source('lib/sugi-db.ts');
    expect(db).toContain('normalizeSearchParam(search)');
    expect(db).toContain('$2 = \'\' OR');
    expect(db).toContain("regexp_replace(lower(normalize(p.product_name, NFKC))");
    expect(db).toContain("regexp_replace(lower(normalize(COALESCE(pv.variant_label, ''), NFKC))");
    expect(db).toContain("normalize(p.product_name || ' ' || COALESCE(pv.variant_label, ''), NFKC)");
    expect(db).toContain('unnest(COALESCE(p.nicknames');
    expect(db).toContain('unnest(COALESCE(pv.nicknames');
    expect(db).toContain('LIMIT $3');
  });

  it('pre-aggregates sale counts instead of multiplying rows through sales_logs joins', () => {
    const db = source('lib/sugi-db.ts');
    expect(db).toContain('WITH sale_counts AS');
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
