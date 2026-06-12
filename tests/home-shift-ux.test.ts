import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('home shift-speed UI contract', () => {
  it('makes the daily logging summary the shared product header', () => {
    const header = source('components/AppHeader.tsx');
    expect(header).toContain('home-hero');
    expect(header).toContain('hero-metric primary');
    expect(header).toContain('Today logged');
    expect(header).toContain('activePage');
  });

  it('removes quick log and keeps home search-focused', () => {
    const logger = source('components/SearchProductLogger.tsx');
    expect(logger).not.toContain('quick-log-strip');
    expect(logger).not.toContain('quick-log-button');
    expect(logger).not.toContain('topVariants');
    expect(logger).toContain('mostlyUsedFamilies');
    expect(logger).not.toContain('記録できます');
    expect(logger).not.toContain('商品名またはショートカット');
    expect(logger).not.toContain('検索中心なので');
    expect(logger).toContain('if (!hasQuery) return []');
  });

  it('uses sticky search and intentional empty states on the home page', () => {
    const logger = source('components/SearchProductLogger.tsx');
    const client = source('components/HomeShiftLoggerClient.tsx');
    const css = source('app/globals.css');
    expect(logger).toContain('search-sticky-card');
    expect(logger).toContain('Type hibi, kuchi, fetas, pripink');
    expect(client).toContain('recent-empty-state');
    expect(css).toMatch(/\.search-sticky-card\s*{[^}]*position:\s*sticky/s);
    expect(css).toContain('.page-card');
  });
});
