import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

export const expectedSchemaObjects = {
  tables: [
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
  ],
  indexes: [
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
  ],
  extensions: ['pg_trgm'],
} as const;

export type SchemaObjectRows = {
  tables: readonly string[];
  indexes: readonly string[];
  extensions: readonly string[];
};

export type SchemaVerificationSummary = {
  ok: boolean;
  missingTables: string[];
  missingIndexes: string[];
  missingExtensions: string[];
};

function missingObjects(expected: readonly string[], actual: readonly string[]) {
  const actualSet = new Set(actual);
  return expected.filter((objectName) => !actualSet.has(objectName));
}

export function summarizeSchemaVerification(
  schemaObjects: SchemaObjectRows,
): SchemaVerificationSummary {
  const missingTables = missingObjects(
    expectedSchemaObjects.tables,
    schemaObjects.tables,
  );
  const missingIndexes = missingObjects(
    expectedSchemaObjects.indexes,
    schemaObjects.indexes,
  );
  const missingExtensions = missingObjects(
    expectedSchemaObjects.extensions,
    schemaObjects.extensions,
  );

  return {
    ok:
      missingTables.length === 0 &&
      missingIndexes.length === 0 &&
      missingExtensions.length === 0,
    missingTables,
    missingIndexes,
    missingExtensions,
  };
}

async function verifySchema(): Promise<void> {
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    throw new Error('DIRECT_URL is required for Prisma schema verification.');
  }

  const pool = new Pool({ connectionString: directUrl, max: 1 });

  try {
    const tables = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'sugi' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const indexes = await pool.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'sugi'
      ORDER BY indexname
    `);
    const extensions = await pool.query<{ extname: string }>(`
      SELECT extname
      FROM pg_extension
      ORDER BY extname
    `);
    const schemaObjects = {
      tables: tables.rows.map((row) => row.table_name),
      indexes: indexes.rows.map((row) => row.indexname),
      extensions: extensions.rows.map((row) => row.extname),
    };
    const summary = summarizeSchemaVerification(schemaObjects);

    console.log(
      JSON.stringify({
        ok: summary.ok,
        tableCount: schemaObjects.tables.length,
        indexCount: schemaObjects.indexes.length,
        extensionCount: schemaObjects.extensions.length,
        missingTables: summary.missingTables,
        missingIndexes: summary.missingIndexes,
        missingExtensions: summary.missingExtensions,
      }),
    );

    if (!summary.ok) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
  verifySchema().catch(() => {
    console.error('Prisma schema verification failed without printing connection details.');
    process.exitCode = 1;
  });
}
