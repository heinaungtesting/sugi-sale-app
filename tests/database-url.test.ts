import { describe, expect, it } from 'vitest';
import { requireDatabaseUrl, requireDirectUrl, runtimeDatabasePoolOptions } from '@/lib/database-url';

describe('requireDatabaseUrl', () => {
  it('returns the private runtime PostgreSQL URL', () => {
    expect(requireDatabaseUrl({ DATABASE_URL: 'postgresql://runtime.example/db' }))
      .toBe('postgresql://runtime.example/db');
  });

  it('rejects non-PostgreSQL runtime URLs without echoing the URL', () => {
    const value = 'https://user:secret@example.test/database';

    expect(() => requireDatabaseUrl({ DATABASE_URL: value })).toThrow('DATABASE_URL must use a PostgreSQL URL');
    expect(() => requireDatabaseUrl({ DATABASE_URL: value })).not.toThrow(value);
  });

  it('requires the Supabase transaction pooler for runtime traffic', () => {
    expect(() => requireDatabaseUrl({
      DATABASE_URL: 'postgresql://runtime:secret@db.project.supabase.co:5432/postgres',
    })).toThrow('DATABASE_URL must use Supabase transaction pooling on port 6543');

    expect(requireDatabaseUrl({
      DATABASE_URL: 'postgresql://runtime:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres',
    })).toContain('pooler.supabase.com:6543');
  });

  it('keeps direct Supabase administration URLs off the transaction pooler', () => {
    expect(() => requireDirectUrl({
      DIRECT_URL: 'postgresql://admin:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres',
    })).toThrow('DIRECT_URL must use a direct or session-pooled Supabase connection, not port 6543');

    expect(requireDirectUrl({
      DIRECT_URL: 'postgresql://admin:secret@127.0.0.1:5432/sugi_sale',
    })).toContain('127.0.0.1:5432');
  });

  it('configures each runtime pool for one connection in the application schema', () => {
    expect(runtimeDatabasePoolOptions('postgresql://runtime.example/db')).toEqual({
      connectionString: 'postgresql://runtime.example/db',
      max: 1,
      options: '-c search_path=pg_catalog,sugi',
    });
  });

  it('fails clearly when DATABASE_URL is missing', () => {
    expect(() => requireDatabaseUrl({})).toThrow('DATABASE_URL is required for database access');
  });
});
