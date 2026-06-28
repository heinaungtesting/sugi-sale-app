import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Sugi app production hardening regressions', () => {
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
