import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { requireDirectUrl } from '@/lib/database-url';

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

export const expectedSchemaSemantics = {
  checkConstraints: [
    { name: 'sugi_users_role_check', definitionIncludes: ['check', 'role', 'admin', 'user'] },
    { name: 'sugi_rate_limits_request_count_check', definitionIncludes: ['request_count', '>=', '0'] },
    { name: 'sugi_point_campaigns_status_check', definitionIncludes: ['status', 'staged', 'applied'] },
    { name: 'sugi_point_campaign_items_target_type_check', definitionIncludes: ['target_type', 'product', 'variant'] },
    { name: 'sugi_point_campaign_items_point_value_check', definitionIncludes: ['point_value', '>=', '0'] },
    { name: 'sugi_feedback_category_check', definitionIncludes: ['category', 'any'] },
    { name: 'sugi_feedback_message_check', definitionIncludes: ['char_length', 'message', '10', '1000'] },
    { name: 'sugi_feedback_status_check', definitionIncludes: ['status', 'any'] },
    { name: 'products_point_value_check', definitionIncludes: ['point_value', '>=', '0'] },
    { name: 'product_variants_unit_count_check', definitionIncludes: ['unit_count', '>', '0'] },
    { name: 'product_variants_point_value_check', definitionIncludes: ['point_value', '>=', '0'] },
    { name: 'sales_logs_quantity_check', definitionIncludes: ['quantity > 0'] },
    { name: 'sales_logs_points_per_item_check', definitionIncludes: ['points_per_item', '>=', '0'] },
    { name: 'enrichment_sources_source_type_check', definitionIncludes: ['source_type', 'product_page', 'manual'] },
    { name: 'enrichment_sources_fetch_status_check', definitionIncludes: ['fetch_status', 'pending', 'parse_error'] },
    { name: 'enrichment_jobs_status_check', definitionIncludes: ['status', 'queued', 'blocked'] },
    { name: 'product_unique_feature_items_confidence_check', definitionIncludes: ['confidence >= 0', 'confidence <= 1'] },
    { name: 'product_unique_summaries_confidence_check', definitionIncludes: ['confidence >= 0', 'confidence <= 1'] },
  ],
  foreignKeys: [
    { name: 'sugi_sessions_user_id_fkey', targetTable: 'sugi_users', deleteAction: 'CASCADE' },
    { name: 'sugi_point_campaign_items_campaign_month_fkey', targetTable: 'sugi_point_campaigns', deleteAction: 'CASCADE' },
    { name: 'sugi_point_campaign_items_product_id_fkey', targetTable: 'products', deleteAction: 'CASCADE' },
    { name: 'sugi_point_campaign_items_variant_id_fkey', targetTable: 'product_variants', deleteAction: 'CASCADE' },
    { name: 'sugi_activity_logs_user_id_fkey', targetTable: 'sugi_users', deleteAction: 'SET NULL' },
    { name: 'sugi_activity_logs_actor_user_id_fkey', targetTable: 'sugi_users', deleteAction: 'SET NULL' },
    { name: 'sugi_feedback_user_id_fkey', targetTable: 'sugi_users', deleteAction: 'CASCADE' },
    { name: 'products_user_id_fkey', targetTable: 'sugi_users', deleteAction: 'NO ACTION' },
    { name: 'product_variants_product_id_fkey', targetTable: 'products', deleteAction: 'CASCADE' },
    { name: 'sales_logs_user_id_fkey', targetTable: 'sugi_users', deleteAction: 'NO ACTION' },
    { name: 'sales_logs_product_id_fkey', targetTable: 'products', deleteAction: 'SET NULL' },
    { name: 'sale_idempotency_receipts_user_id_fkey', targetTable: 'sugi_users', deleteAction: 'CASCADE' },
    { name: 'sale_idempotency_receipts_sale_id_fkey', targetTable: 'sales_logs', deleteAction: 'CASCADE' },
    { name: 'enrichment_sources_product_id_fkey', targetTable: 'products', deleteAction: 'CASCADE' },
    { name: 'enrichment_jobs_product_id_fkey', targetTable: 'products', deleteAction: 'CASCADE' },
    { name: 'product_unique_feature_items_product_id_fkey', targetTable: 'products', deleteAction: 'CASCADE' },
    { name: 'product_unique_feature_items_variant_id_fkey', targetTable: 'product_variants', deleteAction: 'CASCADE' },
    { name: 'product_unique_feature_items_reviewed_by_fkey', targetTable: 'sugi_users', deleteAction: 'NO ACTION' },
    { name: 'product_unique_summaries_product_id_fkey', targetTable: 'products', deleteAction: 'CASCADE' },
    { name: 'enrichment_audit_job_id_fkey', targetTable: 'enrichment_jobs', deleteAction: 'SET NULL' },
    { name: 'enrichment_audit_product_id_fkey', targetTable: 'products', deleteAction: 'CASCADE' },
  ],
  generatedColumns: [
    { identifier: 'sales_logs.total_points', generation: 's', expressionIncludes: ['quantity', '*', 'points_per_item'] },
    { identifier: 'enrichment_sources.domain', generation: 's', expressionIncludes: ['lower', 'split_part', 'url', '3'] },
  ],
  tablePersistence: [{ tableName: 'sugi_rate_limits', persistence: 'u' }],
  indexDefinitions: [
    { name: 'idx_sugi_activity_logs_created', definitionIncludes: ['created_at desc'] },
    { name: 'idx_sugi_activity_logs_user', definitionIncludes: ['created_at desc'] },
    { name: 'idx_sugi_feedback_user_created', definitionIncludes: ['created_at desc'] },
    { name: 'idx_sugi_feedback_status_created', definitionIncludes: ['created_at desc'] },
    { name: 'idx_sales_logs_user_date', definitionIncludes: ['created_at desc'] },
    { name: 'idx_enrichment_audit_product', definitionIncludes: ['created_at desc'] },
    { name: 'uniq_sales_logs_user_idem', definitionIncludes: ['create unique index', 'where', 'idempotency_key', 'is not null'] },
    { name: 'uniq_sales_logs_daily_product', definitionIncludes: ['create unique index', 'where', 'user_id', 'product_id', 'is not null'] },
    { name: 'idx_products_name_trgm', definitionIncludes: ['using gin', 'gin_trgm_ops'] },
    { name: 'idx_products_nicknames_gin', definitionIncludes: ['using gin', 'nicknames'] },
    { name: 'idx_product_variants_product_active', definitionIncludes: ['where', 'is_active', 'true'] },
    { name: 'idx_product_variants_nicknames_gin', definitionIncludes: ['using gin', 'nicknames'] },
    { name: 'idx_product_variants_label_trgm', definitionIncludes: ['using gin', 'gin_trgm_ops'] },
    { name: 'idx_product_variants_shortcut_trgm', definitionIncludes: ['using gin', 'gin_trgm_ops'] },
    { name: 'idx_sugi_sessions_user_active', definitionIncludes: ['where', 'revoked_at', 'is null'] },
    { name: 'idx_sugi_sessions_user_last_used', definitionIncludes: ['last_used_at desc', 'where', 'revoked_at', 'is null'] },
    { name: 'idx_enrichment_jobs_claim', definitionIncludes: ['where', 'queued', 'failed'] },
    { name: 'uq_puf_variant', definitionIncludes: ['create unique index', 'where', 'variant_id', 'is not null'] },
    { name: 'uq_puf_product', definitionIncludes: ['create unique index', 'where', 'variant_id', 'is null'] },
    { name: 'idx_puf_published', definitionIncludes: ['where', 'is_published', 'true'] },
  ],
  primaryUniqueKeys: [
    { name: 'sugi_users_pkey', constraintType: 'p', keyColumns: ['id'] },
    { name: 'sugi_sessions_pkey', constraintType: 'p', keyColumns: ['jti'] },
    { name: 'sugi_rate_limits_pkey', constraintType: 'p', keyColumns: ['scope', 'subject_key'] },
    { name: 'sugi_point_campaigns_pkey', constraintType: 'p', keyColumns: ['campaign_month'] },
    { name: 'sugi_point_campaign_items_pkey', constraintType: 'p', keyColumns: ['id'] },
    { name: 'sugi_activity_logs_pkey', constraintType: 'p', keyColumns: ['id'] },
    { name: 'sugi_feedback_pkey', constraintType: 'p', keyColumns: ['id'] },
    { name: 'products_pkey', constraintType: 'p', keyColumns: ['id'] },
    { name: 'product_variants_pkey', constraintType: 'p', keyColumns: ['id'] },
    { name: 'sales_logs_pkey', constraintType: 'p', keyColumns: ['id'] },
    { name: 'sale_idempotency_receipts_pkey', constraintType: 'p', keyColumns: ['user_id', 'idempotency_key'] },
    { name: 'enrichment_sources_pkey', constraintType: 'p', keyColumns: ['id'] },
    { name: 'enrichment_jobs_pkey', constraintType: 'p', keyColumns: ['id'] },
    { name: 'product_unique_feature_items_pkey', constraintType: 'p', keyColumns: ['id'] },
    { name: 'product_unique_summaries_pkey', constraintType: 'p', keyColumns: ['product_id'] },
    { name: 'enrichment_audit_pkey', constraintType: 'p', keyColumns: ['id'] },
    { name: 'sugi_users_username_key', constraintType: 'u', keyColumns: ['username'] },
    { name: 'products_product_name_key', constraintType: 'u', keyColumns: ['product_name'] },
    { name: 'product_variants_product_id_variant_label_key', constraintType: 'u', keyColumns: ['product_id', 'variant_label'] },
    { name: 'enrichment_sources_product_id_url_key', constraintType: 'u', keyColumns: ['product_id', 'url'] },
    { name: 'enrichment_jobs_product_id_run_id_key', constraintType: 'u', keyColumns: ['product_id', 'run_id'] },
  ],
  columns: [
    { identifier: 'sugi_users.id', dataType: 'bigint', udtName: 'int8', isNullable: 'NO', defaultIncludes: 'nextval' },
    { identifier: 'sugi_users.username', dataType: 'text', udtName: 'text', isNullable: 'NO', defaultIncludes: null },
    { identifier: 'sugi_sessions.revoked_at', dataType: 'timestamp with time zone', udtName: 'timestamptz', isNullable: 'YES', defaultIncludes: null },
    { identifier: 'sugi_rate_limits.request_count', dataType: 'integer', udtName: 'int4', isNullable: 'NO', defaultIncludes: '0' },
    { identifier: 'products.nicknames', dataType: 'ARRAY', udtName: '_text', isNullable: 'NO', defaultIncludes: 'array[]' },
    { identifier: 'product_variants.unit_count', dataType: 'integer', udtName: 'int4', isNullable: 'NO', defaultIncludes: '1' },
    { identifier: 'sales_logs.sold_date', dataType: 'date', udtName: 'date', isNullable: 'NO', defaultIncludes: 'asia/tokyo' },
    { identifier: 'sales_logs.total_points', dataType: 'integer', udtName: 'int4', isNullable: 'YES', defaultIncludes: null },
    { identifier: 'sale_idempotency_receipts.sale_id', dataType: 'bigint', udtName: 'int8', isNullable: 'YES', defaultIncludes: null },
    { identifier: 'enrichment_sources.fetch_status', dataType: 'text', udtName: 'text', isNullable: 'NO', defaultIncludes: 'pending' },
    { identifier: 'enrichment_jobs.priority', dataType: 'smallint', udtName: 'int2', isNullable: 'NO', defaultIncludes: '100' },
    { identifier: 'sugi_point_campaign_items.source', dataType: 'jsonb', udtName: 'jsonb', isNullable: 'YES', defaultIncludes: null },
    { identifier: 'sugi_activity_logs.details', dataType: 'jsonb', udtName: 'jsonb', isNullable: 'NO', defaultIncludes: '{}' },
    { identifier: 'product_unique_feature_items.source_ids', dataType: 'ARRAY', udtName: '_int8', isNullable: 'NO', defaultIncludes: 'array[]' },
    { identifier: 'product_unique_feature_items.confidence', dataType: 'real', udtName: 'float4', isNullable: 'NO', defaultIncludes: null },
    { identifier: 'product_unique_summaries.bullet_points', dataType: 'ARRAY', udtName: '_text', isNullable: 'NO', defaultIncludes: null },
    { identifier: 'product_unique_summaries.source_ids', dataType: 'ARRAY', udtName: '_int8', isNullable: 'NO', defaultIncludes: 'array[]' },
    { identifier: 'enrichment_audit.details', dataType: 'jsonb', udtName: 'jsonb', isNullable: 'NO', defaultIncludes: '{}' },
  ],
} as const;

export type ConstraintRow = { name: string; definition: string };
export type ForeignKeyRow = { name: string; targetTable?: string; deleteAction: string };
export type GeneratedColumnRow = { tableName: string; columnName: string; generation: string; expression: string };
export type TablePersistenceRow = { tableName: string; persistence: string };
export type IndexDefinitionRow = { name: string; definition: string };
export type PrimaryUniqueKeyRow = { name: string; constraintType: string; keyColumns: readonly string[] };
export type ColumnRow = { tableName: string; columnName: string; dataType: string; udtName: string; isNullable: string; columnDefault: string | null };

export type SchemaSemanticsRows = {
  checkConstraints: readonly ConstraintRow[];
  foreignKeys: readonly ForeignKeyRow[];
  generatedColumns: readonly GeneratedColumnRow[];
  tablePersistence: readonly TablePersistenceRow[];
  indexDefinitions: readonly IndexDefinitionRow[];
  primaryUniqueKeys: readonly PrimaryUniqueKeyRow[];
  columns: readonly ColumnRow[];
};

export type SchemaSemanticsSummary = {
  ok: boolean;
  missingCheckConstraints: string[];
  mismatchedCheckConstraints: string[];
  missingForeignKeys: string[];
  mismatchedForeignKeys: string[];
  missingGeneratedColumns: string[];
  mismatchedGeneratedColumns: string[];
  missingTablePersistence: string[];
  mismatchedTablePersistence: string[];
  missingIndexDefinitions: string[];
  mismatchedIndexDefinitions: string[];
  missingPrimaryUniqueKeys: string[];
  mismatchedPrimaryUniqueKeys: string[];
  missingColumns: string[];
  mismatchedColumns: string[];
};

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

export function requireVerifierDirectUrl(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return requireDirectUrl(environment);
}

export function normalizePrimaryUniqueKeyColumns(keyColumns: unknown): string[] {
  if (Array.isArray(keyColumns) && keyColumns.every((column) => typeof column === 'string')) {
    return keyColumns;
  }

  if (typeof keyColumns === 'string' && keyColumns.startsWith('{') && keyColumns.endsWith('}')) {
    const contents = keyColumns.slice(1, -1);
    return contents === '' ? [] : contents.split(',').map((column) => column.replace(/^"|"$/g, ''));
  }

  return [];
}

function normalized(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function byName<T extends { name: string }>(rows: readonly T[]) {
  return new Map(rows.map((row) => [row.name, row]));
}

function byIdentifier<T extends { tableName: string; columnName: string }>(rows: readonly T[]) {
  return new Map(rows.map((row) => [`${row.tableName}.${row.columnName}`, row]));
}

function splitSemanticRows<E extends { name: string }, T>(
  expected: readonly E[],
  actual: ReadonlyMap<string, T>,
  matches: (expectedRow: E, actualRow: T) => boolean,
) {
  const missing: string[] = [];
  const mismatched: string[] = [];

  for (const expectedRow of expected) {
    const actualRow = actual.get(expectedRow.name);
    if (!actualRow) {
      missing.push(expectedRow.name);
    } else if (!matches(expectedRow, actualRow)) {
      mismatched.push(expectedRow.name);
    }
  }

  return { missing, mismatched };
}

export function summarizeSchemaSemantics(
  schemaSemantics: SchemaSemanticsRows,
): SchemaSemanticsSummary {
  const checks = splitSemanticRows(
    expectedSchemaSemantics.checkConstraints,
    byName(schemaSemantics.checkConstraints),
    (expected, actual) =>
      expected.definitionIncludes.every((term) => normalized(actual.definition).includes(normalized(term))),
  );
  const foreignKeys = splitSemanticRows(
    expectedSchemaSemantics.foreignKeys,
    byName(schemaSemantics.foreignKeys),
    (expected, actual) =>
      actual.deleteAction === expected.deleteAction && actual.targetTable === expected.targetTable,
  );
  const generatedColumns = splitSemanticRows(
    expectedSchemaSemantics.generatedColumns.map((column) => ({
      ...column,
      name: column.identifier,
    })),
    byIdentifier(schemaSemantics.generatedColumns),
    (expected, actual) =>
      actual.generation === expected.generation &&
      expected.expressionIncludes.every((term) => normalized(actual.expression).includes(normalized(term))),
  );
  const tablePersistence = splitSemanticRows(
    expectedSchemaSemantics.tablePersistence.map((table) => ({
      ...table,
      name: table.tableName,
    })),
    new Map(schemaSemantics.tablePersistence.map((table) => [table.tableName, table])),
    (expected, actual) => actual.persistence === expected.persistence,
  );
  const indexDefinitions = splitSemanticRows(
    expectedSchemaSemantics.indexDefinitions,
    byName(schemaSemantics.indexDefinitions),
    (expected, actual) =>
      expected.definitionIncludes.every((term) => normalized(actual.definition).includes(normalized(term))),
  );
  const primaryUniqueKeys = splitSemanticRows(
    expectedSchemaSemantics.primaryUniqueKeys,
    byName(schemaSemantics.primaryUniqueKeys),
    (expected, actual) =>
      actual.constraintType === expected.constraintType &&
      actual.keyColumns.length === expected.keyColumns.length &&
      actual.keyColumns.every((column, index) => column === expected.keyColumns[index]),
  );
  const columns = splitSemanticRows(
    expectedSchemaSemantics.columns.map((column) => ({
      ...column,
      name: column.identifier,
    })),
    byIdentifier(schemaSemantics.columns),
    (expected, actual) => {
      const defaultMatches =
        expected.defaultIncludes === null
          ? actual.columnDefault === null
          : actual.columnDefault !== null &&
            normalized(actual.columnDefault).includes(normalized(expected.defaultIncludes));

      return (
        actual.dataType === expected.dataType &&
        actual.udtName === expected.udtName &&
        actual.isNullable === expected.isNullable &&
        defaultMatches
      );
    },
  );

  const groups = [
    checks,
    foreignKeys,
    generatedColumns,
    tablePersistence,
    indexDefinitions,
    primaryUniqueKeys,
    columns,
  ];

  return {
    ok: groups.every((group) => group.missing.length === 0 && group.mismatched.length === 0),
    missingCheckConstraints: checks.missing,
    mismatchedCheckConstraints: checks.mismatched,
    missingForeignKeys: foreignKeys.missing,
    mismatchedForeignKeys: foreignKeys.mismatched,
    missingGeneratedColumns: generatedColumns.missing,
    mismatchedGeneratedColumns: generatedColumns.mismatched,
    missingTablePersistence: tablePersistence.missing,
    mismatchedTablePersistence: tablePersistence.mismatched,
    missingIndexDefinitions: indexDefinitions.missing,
    mismatchedIndexDefinitions: indexDefinitions.mismatched,
    missingPrimaryUniqueKeys: primaryUniqueKeys.missing,
    mismatchedPrimaryUniqueKeys: primaryUniqueKeys.mismatched,
    missingColumns: columns.missing,
    mismatchedColumns: columns.mismatched,
  };
}

async function verifySchema(): Promise<void> {
  const directUrl = requireVerifierDirectUrl();

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
    const constraints = await pool.query<{
      name: string;
      table_name: string;
      target_table: string | null;
      delete_action: string | null;
      definition: string;
      constraint_type: string;
    }>(`
      SELECT
        constraint_row.conname AS name,
        source_table.relname AS table_name,
        target_table.relname AS target_table,
        CASE constraint_row.confdeltype
          WHEN 'a' THEN 'NO ACTION'
          WHEN 'r' THEN 'RESTRICT'
          WHEN 'c' THEN 'CASCADE'
          WHEN 'n' THEN 'SET NULL'
          WHEN 'd' THEN 'SET DEFAULT'
        END AS delete_action,
        pg_get_constraintdef(constraint_row.oid, true) AS definition,
        constraint_row.contype AS constraint_type
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS source_table ON source_table.oid = constraint_row.conrelid
      JOIN pg_namespace AS source_schema ON source_schema.oid = source_table.relnamespace
      LEFT JOIN pg_class AS target_table ON target_table.oid = constraint_row.confrelid
      WHERE source_schema.nspname = 'sugi'
        AND constraint_row.contype IN ('c', 'f')
      ORDER BY constraint_row.conname
    `);
    const generatedColumns = await pool.query<{
      table_name: string;
      column_name: string;
      generation: string;
      expression: string;
    }>(`
      SELECT
        table_row.relname AS table_name,
        attribute_row.attname AS column_name,
        attribute_row.attgenerated AS generation,
        pg_get_expr(attribute_default.adbin, attribute_default.adrelid) AS expression
      FROM pg_attribute AS attribute_row
      JOIN pg_class AS table_row ON table_row.oid = attribute_row.attrelid
      JOIN pg_namespace AS table_schema ON table_schema.oid = table_row.relnamespace
      JOIN pg_attrdef AS attribute_default
        ON attribute_default.adrelid = attribute_row.attrelid
        AND attribute_default.adnum = attribute_row.attnum
      WHERE table_schema.nspname = 'sugi'
        AND attribute_row.attgenerated = 's'
      ORDER BY table_row.relname, attribute_row.attname
    `);
    const tablePersistence = await pool.query<{
      table_name: string;
      persistence: string;
    }>(`
      SELECT table_row.relname AS table_name, table_row.relpersistence AS persistence
      FROM pg_class AS table_row
      JOIN pg_namespace AS table_schema ON table_schema.oid = table_row.relnamespace
      WHERE table_schema.nspname = 'sugi' AND table_row.relkind = 'r'
      ORDER BY table_row.relname
    `);
    const indexDefinitions = await pool.query<{
      name: string;
      definition: string;
    }>(`
      SELECT indexname AS name, indexdef AS definition
      FROM pg_indexes
      WHERE schemaname = 'sugi'
      ORDER BY indexname
    `);
    const primaryUniqueKeys = await pool.query<{
      name: string;
      constraint_type: string;
      key_columns: unknown;
    }>(`
      SELECT
        index_name.relname AS name,
        CASE WHEN index_row.indisprimary THEN 'p' ELSE 'u' END AS constraint_type,
        array_agg(attribute_row.attname::text ORDER BY key_column.ordinality) AS key_columns
      FROM pg_index AS index_row
      JOIN pg_class AS index_name ON index_name.oid = index_row.indexrelid
      JOIN pg_class AS table_row ON table_row.oid = index_row.indrelid
      JOIN pg_namespace AS table_schema ON table_schema.oid = table_row.relnamespace
      JOIN LATERAL unnest(index_row.indkey) WITH ORDINALITY AS key_column(attribute_number, ordinality)
        ON TRUE
      JOIN pg_attribute AS attribute_row
        ON attribute_row.attrelid = table_row.oid
        AND attribute_row.attnum = key_column.attribute_number
      WHERE table_schema.nspname = 'sugi'
        AND (index_row.indisprimary OR (index_row.indisunique AND index_row.indpred IS NULL))
      GROUP BY index_name.relname, index_row.indisprimary
      ORDER BY index_name.relname
    `);
    const columns = await pool.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(`
      SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'sugi'
      ORDER BY table_name, ordinal_position
    `);
    const schemaObjects = {
      tables: tables.rows.map((row) => row.table_name),
      indexes: indexes.rows.map((row) => row.indexname),
      extensions: extensions.rows.map((row) => row.extname),
    };
    const summary = summarizeSchemaVerification(schemaObjects);
    const semanticSummary = summarizeSchemaSemantics({
      checkConstraints: constraints.rows
        .filter((constraint) => constraint.constraint_type === 'c')
        .map((constraint) => ({ name: constraint.name, definition: constraint.definition })),
      foreignKeys: constraints.rows
        .filter((constraint) => constraint.constraint_type === 'f')
        .map((constraint) => ({
          name: constraint.name,
          targetTable: constraint.target_table ?? undefined,
          deleteAction: constraint.delete_action ?? '',
        })),
      generatedColumns: generatedColumns.rows.map((column) => ({
        tableName: column.table_name,
        columnName: column.column_name,
        generation: column.generation,
        expression: column.expression,
      })),
      tablePersistence: tablePersistence.rows.map((table) => ({
        tableName: table.table_name,
        persistence: table.persistence,
      })),
      indexDefinitions: indexDefinitions.rows,
      primaryUniqueKeys: primaryUniqueKeys.rows.map((key) => ({
        name: key.name,
        constraintType: key.constraint_type,
        keyColumns: normalizePrimaryUniqueKeyColumns(key.key_columns),
      })),
      columns: columns.rows.map((column) => ({
        tableName: column.table_name,
        columnName: column.column_name,
        dataType: column.data_type,
        udtName: column.udt_name,
        isNullable: column.is_nullable,
        columnDefault: column.column_default,
      })),
    });

    console.log(
      JSON.stringify({
        ok: summary.ok && semanticSummary.ok,
        tableCount: schemaObjects.tables.length,
        indexCount: schemaObjects.indexes.length,
        extensionCount: schemaObjects.extensions.length,
        checkConstraintCount: constraints.rows.filter((constraint) => constraint.constraint_type === 'c').length,
        foreignKeyCount: constraints.rows.filter((constraint) => constraint.constraint_type === 'f').length,
        generatedColumnCount: generatedColumns.rows.length,
        primaryUniqueKeyCount: primaryUniqueKeys.rows.length,
        columnCount: columns.rows.length,
        missingTables: summary.missingTables,
        missingIndexes: summary.missingIndexes,
        missingExtensions: summary.missingExtensions,
        missingCheckConstraints: semanticSummary.missingCheckConstraints,
        mismatchedCheckConstraints: semanticSummary.mismatchedCheckConstraints,
        missingForeignKeys: semanticSummary.missingForeignKeys,
        mismatchedForeignKeys: semanticSummary.mismatchedForeignKeys,
        missingGeneratedColumns: semanticSummary.missingGeneratedColumns,
        mismatchedGeneratedColumns: semanticSummary.mismatchedGeneratedColumns,
        missingTablePersistence: semanticSummary.missingTablePersistence,
        mismatchedTablePersistence: semanticSummary.mismatchedTablePersistence,
        missingIndexDefinitions: semanticSummary.missingIndexDefinitions,
        mismatchedIndexDefinitions: semanticSummary.mismatchedIndexDefinitions,
        missingPrimaryUniqueKeys: semanticSummary.missingPrimaryUniqueKeys,
        mismatchedPrimaryUniqueKeys: semanticSummary.mismatchedPrimaryUniqueKeys,
        missingColumns: semanticSummary.missingColumns,
        mismatchedColumns: semanticSummary.mismatchedColumns,
      }),
    );

    if (!summary.ok || !semanticSummary.ok) {
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
