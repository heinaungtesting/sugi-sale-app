import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'prisma/migrations/20260821_initial_sugi_schema/migration.sql',
);

describe('Prisma initial migration contract', () => {
  it('preserves the PostgreSQL-only schema behavior without data mutations', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const requiredSql = [
      'CREATE SCHEMA IF NOT EXISTS "sugi"',
      'CREATE EXTENSION IF NOT EXISTS pg_trgm',
      'CREATE UNLOGGED TABLE "sugi"."sugi_rate_limits"',
      'GENERATED ALWAYS AS (quantity * points_per_item) STORED',
      'uniq_sales_logs_user_idem',
      'uniq_sales_logs_daily_product',
      'idx_products_name_trgm',
      'idx_product_variants_label_trgm',
      'idx_enrichment_jobs_claim',
      'CHECK (request_count >= 0)',
      'CHECK (quantity > 0)',
      'CHECK (points_per_item >= 0)',
    ];

    for (const sql of requiredSql) {
      expect(migration).toContain(sql);
    }

    expect(migration).not.toContain('INSERT INTO "sugi"."sugi_users"');
    expect(migration).not.toContain('SUGI_DEFAULT_PIN');
    expect(migration).not.toContain('UPDATE "sugi"."products" SET category');
    expect(migration).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE)\b/im);
    expect(migration).not.toMatch(/^\s*WITH\b/im);
  });
});
