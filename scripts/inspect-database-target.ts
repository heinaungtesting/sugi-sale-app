import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

type DatabaseTargetMode = 'transaction' | 'session-or-direct' | 'unknown';

export type DatabaseTargetDescription = {
  protocol: string;
  host: string;
  port: string;
  database: string;
  user: string;
  mode: DatabaseTargetMode;
};

export type DatabaseTargetInspection = {
  target: DatabaseTargetDescription;
  currentDatabase: string;
  currentUser: string;
  currentSchema: string;
  migrationHistoryCount: number;
  applicationTableNames: string[];
  roleCapabilities: {
    isSuperuser: boolean;
    canBypassRls: boolean;
    canCreateRole: boolean;
    canCreateDatabase: boolean;
    hasConnectPrivilege: boolean;
    sugiSchemaExists: boolean;
    hasSugiUsage: boolean;
  };
};

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

  const port = parsed.port;
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

export function summarizeDatabaseTargetInspection(
  inspection: DatabaseTargetInspection,
): DatabaseTargetInspection {
  return {
    ...inspection,
    applicationTableNames: [...new Set(inspection.applicationTableNames)].sort(),
  };
}

export function formatDatabaseTargetInspection(
  inspection: DatabaseTargetInspection,
): string {
  return JSON.stringify(summarizeDatabaseTargetInspection(inspection));
}

async function countMigrationHistory(pool: Pool): Promise<number> {
  const migrationTable = await pool.query<{ table_schema: 'sugi' | 'public' }>(`
    SELECT table_schema
    FROM information_schema.tables
    WHERE table_schema IN ('sugi', 'public')
      AND table_name = '_prisma_migrations'
    ORDER BY CASE table_schema WHEN 'sugi' THEN 0 ELSE 1 END
    LIMIT 1
  `);

  if (migrationTable.rows[0]?.table_schema === 'sugi') {
    const result = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM sugi._prisma_migrations',
    );
    return result.rows[0]?.count ?? 0;
  }

  if (migrationTable.rows[0]?.table_schema === 'public') {
    const result = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM public._prisma_migrations',
    );
    return result.rows[0]?.count ?? 0;
  }

  return 0;
}

async function inspectDatabaseTarget(url: string): Promise<DatabaseTargetInspection> {
  const target = describeDatabaseTarget(url);
  const pool = new Pool({ connectionString: url, max: 1 });

  try {
    const [identity, tables, capabilities, migrationHistoryCount] = await Promise.all([
      pool.query<{
        current_database: string;
        current_user: string;
        current_schema: string;
      }>(`
        SELECT
          current_database() AS current_database,
          current_user AS current_user,
          current_schema() AS current_schema
      `),
      pool.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'sugi'
          AND table_type = 'BASE TABLE'
          AND table_name <> '_prisma_migrations'
        ORDER BY table_name
      `),
      pool.query<{
        is_superuser: boolean;
        can_bypass_rls: boolean;
        can_create_role: boolean;
        can_create_database: boolean;
        has_connect_privilege: boolean;
        sugi_schema_exists: boolean;
        has_sugi_usage: boolean;
      }>(`
        SELECT
          role_row.rolsuper AS is_superuser,
          role_row.rolbypassrls AS can_bypass_rls,
          role_row.rolcreaterole AS can_create_role,
          role_row.rolcreatedb AS can_create_database,
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
          ), false) AS has_sugi_usage
        FROM pg_roles AS role_row
        WHERE role_row.rolname = current_user
      `),
      countMigrationHistory(pool),
    ]);

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
      migrationHistoryCount,
      applicationTableNames: tables.rows.map((row) => row.table_name),
      roleCapabilities: {
        isSuperuser: capabilityRow.is_superuser,
        canBypassRls: capabilityRow.can_bypass_rls,
        canCreateRole: capabilityRow.can_create_role,
        canCreateDatabase: capabilityRow.can_create_database,
        hasConnectPrivilege: capabilityRow.has_connect_privilege,
        sugiSchemaExists: capabilityRow.sugi_schema_exists,
        hasSugiUsage: capabilityRow.has_sugi_usage,
      },
    });
  } finally {
    await pool.end();
  }
}

async function run(): Promise<void> {
  const source = process.argv[2];
  if (source !== 'DATABASE_URL' && source !== 'DIRECT_URL') {
    throw new Error('Database target source must be explicitly selected');
  }

  const url = process.env[source];
  if (!url) {
    throw new Error('Database target URL is missing');
  }

  console.log(formatDatabaseTargetInspection(await inspectDatabaseTarget(url)));
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
  run().catch(() => {
    console.error('Database target inspection failed.');
    process.exitCode = 1;
  });
}
