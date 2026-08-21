import { describe, expect, it } from 'vitest';
import {
  expectedSchemaObjects,
  summarizeSchemaVerification,
} from '@/scripts/verify-prisma-schema';

describe('Prisma schema verifier', () => {
  it('requires every core and enrichment table plus PostgreSQL-specific indexes', () => {
    expect(expectedSchemaObjects.tables).toEqual([
      'sugi_users',
      'sugi_sessions',
      'sugi_rate_limits',
      'sugi_point_campaigns',
      'sugi_point_campaign_items',
      'sugi_activity_logs',
      'sugi_feedback',
      'products',
      'product_variants',
      'sales_logs',
      'sale_idempotency_receipts',
      'enrichment_sources',
      'enrichment_jobs',
      'product_unique_feature_items',
      'product_unique_summaries',
      'enrichment_audit',
    ]);
    expect(expectedSchemaObjects.indexes).toEqual([
      'sugi_users_username_key',
      'idx_sugi_rate_limits_expiry',
      'idx_sugi_point_campaign_items_month',
      'idx_sugi_activity_logs_created',
      'idx_sugi_activity_logs_user',
      'idx_sugi_feedback_user_created',
      'idx_sugi_feedback_status_created',
      'products_product_name_key',
      'idx_products_user_category',
      'idx_products_active_visible',
      'product_variants_product_id_variant_label_key',
      'idx_sales_logs_user_date',
      'idx_sales_logs_user_product',
      'idx_sale_idempotency_receipts_sale',
      'idx_enrichment_sources_product',
      'enrichment_sources_product_id_url_key',
      'enrichment_jobs_product_id_run_id_key',
      'idx_enrichment_audit_product',
      'uniq_sales_logs_user_idem',
      'uniq_sales_logs_daily_product',
      'idx_products_name_trgm',
      'idx_products_nicknames_gin',
      'idx_product_variants_product_active',
      'idx_product_variants_nicknames_gin',
      'idx_product_variants_label_trgm',
      'idx_product_variants_shortcut_trgm',
      'idx_sugi_sessions_user_active',
      'idx_sugi_sessions_user_last_used',
      'idx_enrichment_jobs_claim',
      'uq_puf_variant',
      'uq_puf_product',
      'idx_puf_published',
    ]);
    expect(expectedSchemaObjects.extensions).toEqual(['pg_trgm']);
  });

  it('reports every missing object without exposing connection details', () => {
    expect(
      summarizeSchemaVerification({
        tables: [],
        indexes: [],
        extensions: [],
      }),
    ).toEqual({
      ok: false,
      missingTables: expectedSchemaObjects.tables,
      missingIndexes: expectedSchemaObjects.indexes,
      missingExtensions: ['pg_trgm'],
    });
  });

  it('treats repeated database rows as present only once', () => {
    expect(
      summarizeSchemaVerification({
        tables: [...expectedSchemaObjects.tables, 'sales_logs'],
        indexes: [...expectedSchemaObjects.indexes, 'idx_puf_published'],
        extensions: ['pg_trgm', 'pg_trgm'],
      }),
    ).toEqual({
      ok: true,
      missingTables: [],
      missingIndexes: [],
      missingExtensions: [],
    });
  });
});
