import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('production readiness contract', () => {
  it('fails fast when the production session secret is missing', () => {
    const auth = source('lib/auth.ts');
    expect(auth).toContain('SUGI_SESSION_SECRET is required in production');
    expect(auth).toContain("process.env.NODE_ENV === 'production'");
    expect(auth).toContain("return secret || 'dev-change-this-sugi-secret'");
    expect(auth).toContain('SUGI_COOKIE_SECURE');
    expect(auth).toContain('secureSessionCookie()');
  });

  it('exposes a database-backed health endpoint', () => {
    const healthPath = 'app/api/health/route.ts';
    expect(existsSync(join(process.cwd(), healthPath))).toBe(true);
    const health = source(healthPath);
    expect(health).toContain("SELECT 1 AS ok");
    expect(health).toContain('status: 503');
    expect(health).toContain('database');
  });

  it('keeps login sessions in httpOnly cookies and rate-limits failed attempts', () => {
    const loginRoute = source('app/api/auth/login/route.ts');
    const loginPage = source('app/login/page.tsx');
    expect(loginRoute).toContain('MAX_FAILED_ATTEMPTS');
    expect(loginRoute).toContain('too many login attempts');
    expect(loginRoute).toContain('await setSession(user)');
    expect(loginRoute).toContain('return Response.json({ ok: true, user })');
    expect(loginRoute).not.toContain('sessionTokenForUser');
    expect(loginRoute).not.toContain('token:');
    expect(loginPage).not.toContain('document.cookie');
    expect(loginPage).not.toContain('data.token');
  });

  it('documents colleague rollout, backup, restore, and rollback', () => {
    const doc = source('PRODUCTION.md');
    expect(doc).toContain('Create colleague accounts');
    expect(doc).toContain('npm run seed:user');
    expect(doc).toContain('npm run backup');
    expect(doc).toContain('npm run restore');
    expect(doc).toContain('Rollback');
    expect(doc).toContain('/api/health');
  });

  it('ships executable backup and restore scripts', () => {
    for (const path of ['scripts/backup-db.sh', 'scripts/restore-db.sh']) {
      const fullPath = join(process.cwd(), path);
      expect(existsSync(fullPath)).toBe(true);
      if (process.platform !== 'win32') {
        expect(statSync(fullPath).mode & 0o111).toBeTruthy();
      }
      expect(source(path)).toContain('SIGMA_RAG_PG_DSN');
    }
    expect(source('scripts/backup-db.sh')).toContain('pg_dump');
    expect(source('scripts/restore-db.sh')).toContain('TRUNCATE TABLE sales_logs, product_variants, products, sugi_users');
  });
});
