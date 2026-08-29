import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Sugi app production hardening regressions', () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.SUGI_COOKIE_SECURE;
  });

  it('ships standard security headers from next.config.ts', () => {
    const config = source('next.config.ts');

    for (const header of [
      'Content-Security-Policy',
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]) {
      expect(config).toContain(header);
    }
    expect(config).toContain('headers()');
    expect(config).toContain("{ key: 'Strict-Transport-Security'");
    expect(config).toContain("const isDev = process.env.NODE_ENV === 'development'");
    expect(config).toContain("const isHttpsDeployment = process.env.SUGI_COOKIE_SECURE !== 'false'");
    expect(config).toContain("isDev ? \" 'unsafe-eval'\" : ''");
  });

  it('emits HTTPS-only policy only when secure cookies are enabled', async () => {
    process.env.SUGI_COOKIE_SECURE = 'false';
    vi.resetModules();
    const httpConfig = (await import('../next.config')).default;
    const httpHeaders = JSON.stringify(await httpConfig.headers?.());
    expect(httpHeaders).not.toContain('Strict-Transport-Security');
    expect(httpHeaders).not.toContain('upgrade-insecure-requests');

    process.env.SUGI_COOKIE_SECURE = 'true';
    vi.resetModules();
    const httpsConfig = (await import('../next.config')).default;
    const httpsHeaders = JSON.stringify(await httpsConfig.headers?.());
    expect(httpsHeaders).toContain('Strict-Transport-Security');
    expect(httpsHeaders).toContain('upgrade-insecure-requests');
  });

  it('sets document lang dynamically when the visible UI locale changes', () => {
    const language = source('components/AppHeader.tsx');

    expect(language).toContain('document.documentElement.lang');
    expect(language).toContain('setAttribute');
  });

  it('home counter search supports Enter/Search key submission on the search box itself', () => {
    const search = source('components/SearchProductLogger.tsx');

    expect(search).toContain('function submitSearch');
    expect(search).toContain('<form className="search-form" onSubmit={submitSearch}>');
    expect(search).toContain('type="search"');
  });

  it('home counter uses optimistic update response instead of router.refresh hot path', () => {
    const search = source('components/SearchProductLogger.tsx');

    expect(search).toContain('setTodaySummary');
    expect(search).not.toContain('router.refresh();');
  });
});
