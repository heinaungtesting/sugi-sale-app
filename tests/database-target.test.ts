import { describe, expect, it, vi } from 'vitest';
import {
  databaseTargetInspectionFailureMessage,
  describeDatabaseTarget,
  formatDatabaseTargetInspection,
  inspectDatabaseTarget,
  loadDatabaseTargetEnvironment,
  selectDatabaseTargetUrl,
  summarizeDatabaseTargetInspection,
} from '@/scripts/inspect-database-target';

describe('database target inspection', () => {
  it('redacts a transaction-pooler URL while identifying its target', () => {
    const password = 'pooler-secret';

    const target = describeDatabaseTarget(
      `postgresql://app%40project:${password}@aws-0-ap-northeast-1.pooler.supabase.com:6543/sugi_sale`,
    );

    expect(target).toEqual({
      protocol: 'postgresql',
      host: 'aws-0-ap-northeast-1.pooler.supabase.com',
      port: '6543',
      database: 'sugi_sale',
      user: 'app@project',
      mode: 'transaction',
    });
    expect(JSON.stringify(target)).not.toContain(password);
  });

  it('identifies a direct or session URL and decodes its user and database', () => {
    expect(
      describeDatabaseTarget(
        'postgres://user%40project:session-secret@db.project.supabase.co:5432/sugi%20sale',
      ),
    ).toEqual({
      protocol: 'postgres',
      host: 'db.project.supabase.co',
      port: '5432',
      database: 'sugi sale',
      user: 'user@project',
      mode: 'session-or-direct',
    });
  });

  it('normalizes a PostgreSQL URL without a port to the default session-or-direct port', () => {
    expect(
      describeDatabaseTarget('postgresql://app:session-secret@db.project.supabase.co/sugi_sale'),
    ).toMatchObject({
      port: '5432',
      mode: 'session-or-direct',
    });
  });

  it('rejects missing passwords without echoing the URL', () => {
    const value = 'postgresql://app@db.project.supabase.co:5432/sugi_sale';

    expect(() => describeDatabaseTarget(value)).toThrow('Database target URL must include a password');
    expect(() => describeDatabaseTarget(value)).not.toThrow(value);
  });

  it('rejects malformed URLs without echoing them', () => {
    const value = 'not a database url with secret-value';

    expect(() => describeDatabaseTarget(value)).toThrow('Database target URL is invalid');
    expect(() => describeDatabaseTarget(value)).not.toThrow(value);
  });

  it('loads a selected target after the dotenv loader without reading a real environment file', () => {
    const environment = {} as NodeJS.ProcessEnv;

    loadDatabaseTargetEnvironment(environment, () => {
      environment.DIRECT_URL = 'postgresql://app:controlled-secret@db.project.supabase.co/postgres';
    });

    expect(selectDatabaseTargetUrl('DIRECT_URL', environment)).toBe(
      'postgresql://app:controlled-secret@db.project.supabase.co/postgres',
    );
  });

  it('loads dotenv quietly so JSON is the only successful CLI output', () => {
    const dotenvLoader = vi.fn();

    loadDatabaseTargetEnvironment({} as NodeJS.ProcessEnv, dotenvLoader);

    expect(dotenvLoader).toHaveBeenCalledWith({ quiet: true });
  });

  it('formats only safe fields and sorts inspection identifiers', () => {
    const password = 'do-not-print-this';
    const summary = summarizeDatabaseTargetInspection({
      target: describeDatabaseTarget(
        `postgresql://app:${password}@db.project.supabase.co:5432/postgres`,
      ),
      currentDatabase: 'postgres',
      currentUser: 'app',
      currentSchema: 'public',
      migrationHistoryCount: 99,
      migrationHistories: [
        { schema: 'public', count: 1 },
        { schema: 'sugi', count: 2 },
      ],
      applicationTableNames: ['sales_logs', 'products', 'products'],
      roleCapabilities: {
        isSuperuser: false,
        canBypassRls: false,
        canCreateRole: false,
        canCreateDatabase: false,
        inheritsRole: true,
        hasConnectPrivilege: true,
        sugiSchemaExists: true,
        hasSugiUsage: true,
        hasSugiCreate: false,
        applicationTablePrivileges: {
          selectCount: 2,
          insertCount: 1,
          updateCount: 1,
          deleteCount: 0,
        },
        sequencePrivileges: {
          sequenceCount: 2,
          usageCount: 1,
          selectCount: 1,
        },
      },
      membershipRoleNames: ['app_read', 'app_admin', 'app_read'],
    });

    expect(summary.applicationTableNames).toEqual(['products', 'sales_logs']);
    expect(summary.membershipRoleNames).toEqual(['app_admin', 'app_read']);
    expect(summary.migrationHistories).toEqual([
      { schema: 'public', count: 1 },
      { schema: 'sugi', count: 2 },
    ]);
    expect(summary.migrationHistoryCount).toBe(3);
    expect(formatDatabaseTargetInspection(summary)).not.toContain(password);
  });

  it('closes its single max-one pool and reports every allowlisted migration history', async () => {
    const queries: string[] = [];
    let poolClosed = false;
    const rows = [
      [{ current_database: 'postgres', current_user: 'app', current_schema: 'public' }],
      [{ table_name: 'sales_logs' }, { table_name: 'products' }],
      [{
        is_superuser: false,
        can_bypass_rls: false,
        can_create_role: false,
        can_create_database: false,
        inherits_role: true,
        has_connect_privilege: true,
        sugi_schema_exists: true,
        has_sugi_usage: true,
        has_sugi_create: false,
        application_table_select_count: 2,
        application_table_insert_count: 1,
        application_table_update_count: 1,
        application_table_delete_count: 0,
        sequence_count: 2,
        sequence_usage_count: 1,
        sequence_select_count: 1,
      }],
      [{ role_name: 'app_read' }, { role_name: 'app_admin' }, { role_name: 'app_read' }],
      [{ schema_name: 'sugi' }, { schema_name: 'public' }],
      [{ count: 2 }],
      [{ count: 1 }],
    ];

    const inspection = await inspectDatabaseTarget(
      'postgresql://app:pool-secret@db.project.supabase.co/postgres',
      (config) => ({
        query: async <T>(query: string) => {
          queries.push(query);
          return { rows: rows.shift() as T[] };
        },
        end: async () => {
          poolClosed = true;
        },
        config,
      }),
    );

    expect(inspection.migrationHistories).toEqual([
      { schema: 'public', count: 1 },
      { schema: 'sugi', count: 2 },
    ]);
    expect(inspection.migrationHistoryCount).toBe(3);
    expect(inspection.membershipRoleNames).toEqual(['app_admin', 'app_read']);
    expect(poolClosed).toBe(true);
    expect(queries.join('\n')).not.toContain('information_schema');
    expect(queries.join('\n')).toContain('FROM sugi._prisma_migrations');
    expect(queries.join('\n')).toContain('FROM public._prisma_migrations');
  });

  it('uses a generic executable failure message without a database error', () => {
    const rawError = 'password=do-not-expose connection refused';

    expect(databaseTargetInspectionFailureMessage(new Error(rawError))).toBe(
      'Database target inspection failed.',
    );
    expect(databaseTargetInspectionFailureMessage(new Error(rawError))).not.toContain(rawError);
  });
});
