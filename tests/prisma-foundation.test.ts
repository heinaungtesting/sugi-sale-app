import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Prisma foundation', () => {
  it('separates the CLI and runtime database connections', () => {
    expect(existsSync(join(process.cwd(), 'prisma.config.ts'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'prisma/schema.prisma'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'lib/prisma.ts'))).toBe(true);

    const config = source('prisma.config.ts');
    expect(config).toContain('env("DIRECT_URL")');
    expect(config).not.toContain('NEXT_PUBLIC_');

    const runtime = source('lib/prisma.ts');
    expect(runtime).toContain('requireDatabaseUrl()');
    expect(runtime).toContain('new PrismaPg');
    expect(runtime).toContain("schema: 'sugi'");
    expect(runtime).toContain('runtimeDatabasePoolOptions');
    expect(runtime).not.toContain('NEXT_PUBLIC_');
  });

  it('generates the client into an ignored project directory', () => {
    const schema = source('prisma/schema.prisma');
    expect(schema).toContain('provider = "prisma-client"');
    expect(schema).toContain('output   = "../generated/prisma"');
    expect(schema).toContain('provider = "postgresql"');
    expect(source('.gitignore')).toContain('generated/prisma/');
    const packageJson = JSON.parse(source('package.json')) as { scripts: { prebuild: string } };
    expect(packageJson.scripts.prebuild).toContain('prisma generate');
  });

  it('keeps transitional pg access private and documents placeholder URLs', () => {
    const legacyDb = source('lib/db.ts');
    expect(legacyDb).toContain('requireDatabaseUrl()');
    expect(legacyDb).toContain('runtimeDatabasePoolOptions');
    expect(legacyDb).not.toContain('NEXT_PUBLIC_SUPABASE_URL');

    const envExample = source('.env.example');
    expect(envExample).toContain('DATABASE_URL=postgresql://');
    expect(envExample).toContain('DIRECT_URL=postgresql://');
    expect(envExample).not.toMatch(/supabase\.co/);
  });

  it('uses one database for Prisma and transitional pg in local Docker', () => {
    const compose = source('docker-compose.yml');
    expect(compose).toContain('DATABASE_URL: &database_url');
    expect(compose).toContain('DIRECT_URL: *database_url');
    expect(compose).toContain('SIGMA_RAG_PG_DSN: *database_url');
  });

  it('validates the direct Prisma URL before the CLI consumes it', () => {
    const config = source('prisma.config.ts');
    expect(config).toContain('requireDirectUrl');
    expect(config).toContain('DIRECT_URL');
  });
});
