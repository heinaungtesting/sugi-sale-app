import { describe, expect, it } from 'vitest';
import {
  describeDatabaseTarget,
  formatDatabaseTargetInspection,
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

  it('formats only safe fields and sorts application table names', () => {
    const password = 'do-not-print-this';
    const summary = summarizeDatabaseTargetInspection({
      target: describeDatabaseTarget(
        `postgresql://app:${password}@db.project.supabase.co:5432/postgres`,
      ),
      currentDatabase: 'postgres',
      currentUser: 'app',
      currentSchema: 'public',
      migrationHistoryCount: 3,
      applicationTableNames: ['sales_logs', 'products', 'products'],
      roleCapabilities: {
        isSuperuser: false,
        canBypassRls: false,
        canCreateRole: false,
        canCreateDatabase: false,
        hasConnectPrivilege: true,
        sugiSchemaExists: true,
        hasSugiUsage: true,
      },
    });

    expect(summary.applicationTableNames).toEqual(['products', 'sales_logs']);
    expect(formatDatabaseTargetInspection(summary)).toBe(
      '{"target":{"protocol":"postgresql","host":"db.project.supabase.co","port":"5432","database":"postgres","user":"app","mode":"session-or-direct"},"currentDatabase":"postgres","currentUser":"app","currentSchema":"public","migrationHistoryCount":3,"applicationTableNames":["products","sales_logs"],"roleCapabilities":{"isSuperuser":false,"canBypassRls":false,"canCreateRole":false,"canCreateDatabase":false,"hasConnectPrivilege":true,"sugiSchemaExists":true,"hasSugiUsage":true}}',
    );
    expect(formatDatabaseTargetInspection(summary)).not.toContain(password);
  });
});
