import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';

type DatabaseTargetMode = 'transaction' | 'session-or-direct' | 'unknown';
type MigrationHistorySchema = 'public' | 'sugi';

export type DatabaseTargetDescription = {
  protocol: string;
  host: string;
  port: string;
  database: string;
  user: string;
  mode: DatabaseTargetMode;
};

export type MigrationHistory = {
  schema: MigrationHistorySchema;
  count: number;
};

export type DatabaseTargetInspection = {
  target: DatabaseTargetDescription;
  currentDatabase: string;
  currentUser: string;
  currentSchema: string;
  migrationHistoryCount: number;
  migrationHistories: MigrationHistory[];
  applicationTableNames: string[];
  membershipRoleNames: string[];
  roleCapabilities: {
    isSuperuser: boolean;
    canBypassRls: boolean;
    canCreateRole: boolean;
    canCreateDatabase: boolean;
    inheritsRole: boolean;
    hasConnectPrivilege: boolean;
    sugiSchemaExists: boolean;
    hasSugiUsage: boolean;
    hasSugiCreate: boolean;
    applicationTablePrivileges: {
      selectCount: number;
      insertCount: number;
      updateCount: number;
      deleteCount: number;
    };
    sequencePrivileges: {
      sequenceCount: number;
      usageCount: number;
      selectCount: number;
    };
  };
};

export type DatabaseTargetPool = {
  query<T extends Record<string, unknown>>(query: string): Promise<{ rows: T[] }>;
  end(): Promise<void>;
};

type DatabaseTargetPoolOptions = {
  connectionString: string;
  max: 1;
};

export type DatabaseTargetPoolFactory = (
  options: DatabaseTargetPoolOptions,
) => DatabaseTargetPool;

export function describeDatabaseTarget(url: string): DatabaseTargetDescription {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Database target URL is invalid');
  }

  if (
    (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') ||
    parsed.hostname === '' ||
    parsed.username === '' ||
    parsed.pathname === '' ||
    parsed.pathname === '/'
  ) {
    throw new Error('Database target URL is invalid');
  }

  if (parsed.password === '') {
    throw new Error('Database target URL must include a password');
  }

  const port = parsed.port || '5432';
  const mode: DatabaseTargetMode =
    port === '6543'
      ? 'transaction'
      : port === '5432'
        ? 'session-or-direct'
        : 'unknown';

  try {
    return {
      protocol: parsed.protocol.slice(0, -1),
      host: parsed.hostname,
      port,
      database: decodeURIComponent(parsed.pathname.slice(1)),
      user: decodeURIComponent(parsed.username),
      mode,
    };
  } catch {
    throw new Error('Database target URL is invalid');
  }
}

export function loadDatabaseTargetEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  dotenvLoader: (options: { quiet: true }) => void = loadDotenv,
): NodeJS.ProcessEnv {
  dotenvLoader({ quiet: true });
  return environment;
}

export function selectDatabaseTargetUrl(
  source: string | undefined,
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): string {
  if (source !== 'DATABASE_URL' && source !== 'DIRECT_URL') {
    throw new Error('Database target source must be explicitly selected');
  }

  const url = environment[source];
  if (!url) {
    throw new Error('Database target URL is missing');
  }

  return url;
}

export function summarizeDatabaseTargetInspection(
  inspection: DatabaseTargetInspection,
): DatabaseTargetInspection {
  const migrationHistories = [...inspection.migrationHistories].sort((left, right) =>
    left.schema.localeCompare(right.schema),
  );

  return {
    ...inspection,
    migrationHistories,
    migrationHistoryCount: migrationHistories.reduce((total, history) => total + history.count, 0),
    applicationTableNames: [...new Set(inspection.applicationTableNames)].sort(),
    membershipRoleNames: [...new Set(inspection.membershipRoleNames)].sort(),
  };
}

export function formatDatabaseTargetInspection(
  inspection: DatabaseTargetInspection,
): string {
  return JSON.stringify(summarizeDatabaseTargetInspection(inspection));
}

export function databaseTargetInspectionFailureMessage(_error: unknown): string {
  return 'Database target inspection failed.';
}

async function countMigrationHistory(
  pool: DatabaseTargetPool,
  schema: MigrationHistorySchema,
): Promise<MigrationHistory> {
  const result = await pool.query<{ count: number }>(
    schema === 'sugi'
      ? 'SELECT COUNT(*)::int AS count FROM sugi._prisma_migrations'
      : 'SELECT COUNT(*)::int AS count FROM public._prisma_migrations',
  );
  const count = result.rows[0]?.count;

  if (typeof count !== 'number') {
    throw new Error('Migration history count metadata is missing');
  }

  return { schema, count };
}

async function inspectMigrationHistories(pool: DatabaseTargetPool): Promise<MigrationHistory[]> {
  const migrationTables = await pool.query<{ schema_name: MigrationHistorySchema }>(`
    SELECT namespace_row.nspname AS schema_name
    FROM pg_class AS relation_row
    JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace
    WHERE namespace_row.nspname IN ('sugi', 'public')
      AND relation_row.relname = '_prisma_migrations'
      AND relation_row.relkind IN ('r', 'p')
    ORDER BY namespace_row.nspname
  `);

  const histories: MigrationHistory[] = [];
  for (const schema of ['sugi', 'public'] as const) {
    if (migrationTables.rows.some((table) => table.schema_name === schema)) {
      histories.push(await countMigrationHistory(pool, schema));
    }
  }

  return histories;
}

export async function inspectDatabaseTarget(
  url: string,
  createPool: DatabaseTargetPoolFactory = (options) => new Pool(options),
): Promise<DatabaseTargetInspection> {
  const target = describeDatabaseTarget(url);
  const pool = createPool({ connectionString: url, max: 1 });

  try {
    const identity = await pool.query<{
      current_database: string;
      current_user: string;
      current_schema: string;
    }>(`
      SELECT
        current_database() AS current_database,
        current_user AS current_user,
        current_schema() AS current_schema
    `);
    const tables = await pool.query<{ table_name: string }>(`
      SELECT relation_row.relname AS table_name
      FROM pg_class AS relation_row
      JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace
      WHERE namespace_row.nspname = 'sugi'
        AND relation_row.relkind IN ('r', 'p')
        AND relation_row.relname <> '_prisma_migrations'
      ORDER BY relation_row.relname
    `);
    const capabilities = await pool.query<{
      is_superuser: boolean;
      can_bypass_rls: boolean;
      can_create_role: boolean;
      can_create_database: boolean;
      inherits_role: boolean;
      has_connect_privilege: boolean;
      sugi_schema_exists: boolean;
      has_sugi_usage: boolean;
      has_sugi_create: boolean;
      application_table_select_count: number;
      application_table_insert_count: number;
      application_table_update_count: number;
      application_table_delete_count: number;
      sequence_count: number;
      sequence_usage_count: number;
      sequence_select_count: number;
    }>(`
      SELECT
        role_row.rolsuper AS is_superuser,
        role_row.rolbypassrls AS can_bypass_rls,
        role_row.rolcreaterole AS can_create_role,
        role_row.rolcreatedb AS can_create_database,
        role_row.rolinherit AS inherits_role,
        has_database_privilege(current_database(), 'CONNECT') AS has_connect_privilege,
        EXISTS (
          SELECT 1
          FROM pg_namespace
          WHERE nspname = 'sugi'
        ) AS sugi_schema_exists,
        COALESCE((
          SELECT has_schema_privilege(current_user, namespace_row.oid, 'USAGE')
          FROM pg_namespace AS namespace_row
          WHERE namespace_row.nspname = 'sugi'
        ), false) AS has_sugi_usage,
        COALESCE((
          SELECT has_schema_privilege(current_user, namespace_row.oid, 'CREATE')
          FROM pg_namespace AS namespace_row
          WHERE namespace_row.nspname = 'sugi'
        ), false) AS has_sugi_create,
        (
          SELECT COUNT(*) FILTER (WHERE has_table_privilege(current_user, relation_row.oid, 'SELECT'))::int
          FROM pg_class AS relation_row
          JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace
          WHERE namespace_row.nspname = 'sugi'
            AND relation_row.relkind IN ('r', 'p')
            AND relation_row.relname <> '_prisma_migrations'
        ) AS application_table_select_count,
        (
          SELECT COUNT(*) FILTER (WHERE has_table_privilege(current_user, relation_row.oid, 'INSERT'))::int
          FROM pg_class AS relation_row
          JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace
          WHERE namespace_row.nspname = 'sugi'
            AND relation_row.relkind IN ('r', 'p')
            AND relation_row.relname <> '_prisma_migrations'
        ) AS application_table_insert_count,
        (
          SELECT COUNT(*) FILTER (WHERE has_table_privilege(current_user, relation_row.oid, 'UPDATE'))::int
          FROM pg_class AS relation_row
          JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace
          WHERE namespace_row.nspname = 'sugi'
            AND relation_row.relkind IN ('r', 'p')
            AND relation_row.relname <> '_prisma_migrations'
        ) AS application_table_update_count,
        (
          SELECT COUNT(*) FILTER (WHERE has_table_privilege(current_user, relation_row.oid, 'DELETE'))::int
          FROM pg_class AS relation_row
          JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace
          WHERE namespace_row.nspname = 'sugi'
            AND relation_row.relkind IN ('r', 'p')
            AND relation_row.relname <> '_prisma_migrations'
        ) AS application_table_delete_count,
        (
          SELECT COUNT(*)::int
          FROM pg_class AS relation_row
          JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace
          WHERE namespace_row.nspname = 'sugi' AND relation_row.relkind = 'S'
        ) AS sequence_count,
        (
          SELECT COUNT(*) FILTER (WHERE has_sequence_privilege(current_user, relation_row.oid, 'USAGE'))::int
          FROM pg_class AS relation_row
          JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace
          WHERE namespace_row.nspname = 'sugi' AND relation_row.relkind = 'S'
        ) AS sequence_usage_count,
        (
          SELECT COUNT(*) FILTER (WHERE has_sequence_privilege(current_user, relation_row.oid, 'SELECT'))::int
          FROM pg_class AS relation_row
          JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace
          WHERE namespace_row.nspname = 'sugi' AND relation_row.relkind = 'S'
        ) AS sequence_select_count
      FROM pg_roles AS role_row
      WHERE role_row.rolname = current_user
    `);
    const memberships = await pool.query<{ role_name: string }>(`
      SELECT DISTINCT granted_role.rolname AS role_name
      FROM pg_auth_members AS membership
      JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
      WHERE membership.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      ORDER BY granted_role.rolname
    `);
    const migrationHistories = await inspectMigrationHistories(pool);

    const identityRow = identity.rows[0];
    const capabilityRow = capabilities.rows[0];
    if (!identityRow || !capabilityRow) {
      throw new Error('Database target inspection did not return required metadata');
    }

    return summarizeDatabaseTargetInspection({
      target,
      currentDatabase: identityRow.current_database,
      currentUser: identityRow.current_user,
      currentSchema: identityRow.current_schema,
      migrationHistoryCount: 0,
      migrationHistories,
      applicationTableNames: tables.rows.map((row) => row.table_name),
      membershipRoleNames: memberships.rows.map((row) => row.role_name),
      roleCapabilities: {
        isSuperuser: capabilityRow.is_superuser,
        canBypassRls: capabilityRow.can_bypass_rls,
        canCreateRole: capabilityRow.can_create_role,
        canCreateDatabase: capabilityRow.can_create_database,
        inheritsRole: capabilityRow.inherits_role,
        hasConnectPrivilege: capabilityRow.has_connect_privilege,
        sugiSchemaExists: capabilityRow.sugi_schema_exists,
        hasSugiUsage: capabilityRow.has_sugi_usage,
        hasSugiCreate: capabilityRow.has_sugi_create,
        applicationTablePrivileges: {
          selectCount: capabilityRow.application_table_select_count,
          insertCount: capabilityRow.application_table_insert_count,
          updateCount: capabilityRow.application_table_update_count,
          deleteCount: capabilityRow.application_table_delete_count,
        },
        sequencePrivileges: {
          sequenceCount: capabilityRow.sequence_count,
          usageCount: capabilityRow.sequence_usage_count,
          selectCount: capabilityRow.sequence_select_count,
        },
      },
    });
  } finally {
    await pool.end();
  }
}

async function run(): Promise<void> {
  const environment = loadDatabaseTargetEnvironment();
  const url = selectDatabaseTargetUrl(process.argv[2], environment);
  console.log(formatDatabaseTargetInspection(await inspectDatabaseTarget(url)));
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
  run().catch((error: unknown) => {
    console.error(databaseTargetInspectionFailureMessage(error));
    process.exitCode = 1;
  });
}
