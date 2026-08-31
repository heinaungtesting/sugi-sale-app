import { describe, expect, it } from 'vitest';
import {
  expectedSchemaObjects,
  expectedSchemaSemantics,
  isSupportedPgroongaVersion,
  normalizePrimaryUniqueKeyColumns,
  requireVerifierDirectUrl,
  summarizePgroongaRuntime,
  summarizeSchemaSemantics,
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
      'idx_products_search_pgroonga',
      'idx_product_variants_search_pgroonga',
    ]);
    expect(expectedSchemaObjects.extensions).toEqual(['pg_trgm', 'pgroonga']);
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
      missingExtensions: ['pg_trgm', 'pgroonga'],
    });
  });

  it('treats repeated database rows as present only once', () => {
    expect(
      summarizeSchemaVerification({
        tables: [...expectedSchemaObjects.tables, 'sales_logs'],
        indexes: [...expectedSchemaObjects.indexes, 'idx_puf_published'],
        extensions: ['pg_trgm', 'pg_trgm', 'pgroonga', 'pgroonga'],
      }),
    ).toEqual({
      ok: true,
      missingTables: [],
      missingIndexes: [],
      missingExtensions: [],
    });
  });

  it('requires PostgreSQL-only constraints, generated columns, persistence, indexes, and native columns', () => {
    expect(expectedSchemaSemantics.checkConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'sales_logs_quantity_check' }),
        expect.objectContaining({ name: 'enrichment_sources_fetch_status_check' }),
      ]),
    );
    expect(expectedSchemaSemantics.foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'sales_logs_product_id_fkey', deleteAction: 'SET NULL' }),
        expect.objectContaining({ name: 'enrichment_audit_job_id_fkey', deleteAction: 'SET NULL' }),
      ]),
    );
    expect(expectedSchemaSemantics.generatedColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ identifier: 'sales_logs.total_points' }),
        expect.objectContaining({ identifier: 'enrichment_sources.domain' }),
      ]),
    );
    expect(expectedSchemaSemantics.tablePersistence).toEqual([
      { tableName: 'sugi_rate_limits', persistence: 'u' },
    ]);
    expect(expectedSchemaSemantics.indexDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'idx_products_name_trgm' }),
        expect.objectContaining({ name: 'uniq_sales_logs_daily_product' }),
        expect.objectContaining({ name: 'idx_enrichment_jobs_claim' }),
        expect.objectContaining({ name: 'idx_puf_published' }),
        expect.objectContaining({ name: 'idx_products_search_pgroonga' }),
        expect.objectContaining({ name: 'idx_product_variants_search_pgroonga' }),
      ]),
    );
    expect(expectedSchemaSemantics.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ identifier: 'sales_logs.sold_date', udtName: 'date' }),
        expect.objectContaining({ identifier: 'sugi_activity_logs.details', udtName: 'jsonb' }),
        expect.objectContaining({ identifier: 'product_unique_feature_items.source_ids', udtName: '_int8' }),
      ]),
    );
    expect(expectedSchemaSemantics.primaryUniqueKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'sugi_rate_limits_pkey', constraintType: 'p', keyColumns: ['scope', 'subject_key'] }),
        expect.objectContaining({ name: 'sale_idempotency_receipts_pkey', constraintType: 'p', keyColumns: ['user_id', 'idempotency_key'] }),
        expect.objectContaining({ name: 'product_variants_product_id_variant_label_key', constraintType: 'u', keyColumns: ['product_id', 'variant_label'] }),
      ]),
    );
  });

  it('rejects a Supabase transaction pooler direct URL without exposing credentials', () => {
    const transactionPooler = 'postgresql://admin:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres';

    expect(() => requireVerifierDirectUrl({ DIRECT_URL: transactionPooler }))
      .toThrow('DIRECT_URL must use a direct or session-pooled Supabase connection, not port 6543');
  });

  it('normalizes an unparsed PostgreSQL name array before comparing ordered key columns', () => {
    expect(normalizePrimaryUniqueKeyColumns('{scope,subject_key}')).toEqual([
      'scope',
      'subject_key',
    ]);
  });

  it('requires PGroonga behind a security-definer function without runtime schema usage', () => {
    expect(isSupportedPgroongaVersion('3.2.5')).toBe(true);
    expect(isSupportedPgroongaVersion('3.2.0')).toBe(false);
    expect(summarizePgroongaRuntime({
      version: '3.2.5',
      schemaName: 'extensions',
      runtimeHasSchemaUsage: false,
      extensionSchemaUntrustedCreate: false,
      pgTrgmSchemaName: 'public',
      runtimeCanExecuteDangerousPgroongaFunctions: true,
      searchFunctionIsSecurityDefiner: true,
      searchFunctionHasSafePath: true,
      runtimeCanExecuteSearchFunction: true,
    })).toEqual({ ok: true, issues: [] });
    expect(summarizePgroongaRuntime({
      version: '3.2.0',
      schemaName: 'public',
      runtimeHasSchemaUsage: true,
      extensionSchemaUntrustedCreate: true,
      pgTrgmSchemaName: 'extensions',
      runtimeCanExecuteDangerousPgroongaFunctions: true,
      searchFunctionIsSecurityDefiner: false,
      searchFunctionHasSafePath: false,
      runtimeCanExecuteSearchFunction: false,
    })).toEqual({
      ok: false,
      issues: [
        'unsupported_version',
        'wrong_schema',
        'runtime_extension_schema_usage',
        'extension_schema_untrusted_create',
        'pg_trgm_wrong_schema',
        'dangerous_pgroonga_function_execute',
        'search_function_not_security_definer',
        'search_function_unsafe_path',
        'runtime_search_function_execute_missing',
      ],
    });
  });

  it('identifies semantic mismatches by object identifier', () => {
    const summary = summarizeSchemaSemantics({
      checkConstraints: [
        { name: 'sales_logs_quantity_check', definition: 'CHECK (quantity >= 0)' },
      ],
      foreignKeys: [
        { name: 'sales_logs_product_id_fkey', deleteAction: 'CASCADE' },
      ],
      generatedColumns: [
        {
          tableName: 'sales_logs',
          columnName: 'total_points',
          generation: 's',
          expression: 'quantity + points_per_item',
        },
      ],
      tablePersistence: [{ tableName: 'sugi_rate_limits', persistence: 'p' }],
      indexDefinitions: [
        {
          name: 'uniq_sales_logs_daily_product',
          definition: 'CREATE INDEX uniq_sales_logs_daily_product ON sales_logs (id)',
          isValid: true,
        },
        {
          name: 'idx_products_search_pgroonga',
          definition: 'CREATE INDEX idx_products_search_pgroonga ON products USING pgroonga (product_name)',
          isValid: false,
        },
      ],
      primaryUniqueKeys: [
        {
          name: 'product_variants_product_id_variant_label_key',
          constraintType: 'p',
          keyColumns: ['variant_label', 'product_id'],
        },
      ],
      columns: [
        {
          tableName: 'sales_logs',
          columnName: 'sold_date',
          dataType: 'text',
          udtName: 'text',
          isNullable: 'YES',
          columnDefault: null,
        },
      ],
    });

    expect(summary.mismatchedCheckConstraints).toContain('sales_logs_quantity_check');
    expect(summary.mismatchedForeignKeys).toContain('sales_logs_product_id_fkey');
    expect(summary.mismatchedGeneratedColumns).toContain('sales_logs.total_points');
    expect(summary.mismatchedTablePersistence).toEqual(['sugi_rate_limits']);
    expect(summary.mismatchedIndexDefinitions).toContain('uniq_sales_logs_daily_product');
    expect(summary.mismatchedIndexDefinitions).toContain('idx_products_search_pgroonga');
    expect(summary.mismatchedPrimaryUniqueKeys).toContain('product_variants_product_id_variant_label_key');
    expect(summary.mismatchedColumns).toContain('sales_logs.sold_date');
    expect(summary.ok).toBe(false);
  });
});
