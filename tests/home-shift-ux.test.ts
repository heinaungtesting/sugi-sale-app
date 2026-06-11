import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('home shift-speed UI contract', () => {
  it('makes the daily logging summary the primary hero instead of a weak header stat', () => {
    const header = source('components/AppHeader.tsx');
    expect(header).toContain('home-hero');
    expect(header).toContain('hero-metric primary');
    expect(header).toContain('Today logged');
    expect(header).toContain('Open calendar');
  });

  it('adds a one-tap quick log strip above the full product grid', () => {
    const logger = source('components/SearchProductLogger.tsx');
    expect(logger).toContain('quick-log-strip');
    expect(logger).toContain('.slice(0, 6)');
    expect(logger).toContain('quick-log-button');
    expect(logger).toContain('topVariants');
  });

  it('uses sticky search and intentional card empty states on the home page', () => {
    const logger = source('components/SearchProductLogger.tsx');
    const client = source('components/HomeShiftLoggerClient.tsx');
    const css = source('app/globals.css');
    expect(logger).toContain('search-sticky-card');
    expect(logger).toContain('Search product or shortcut');
    expect(client).toContain('recent-empty-state');
    expect(css).toMatch(/\.search-sticky-card\s*{[^}]*position:\s*sticky/s);
    expect(css).toMatch(/\.quick-log-strip\s*{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
    expect(css).not.toMatch(/\.quick-log-strip\s*{[^}]*overflow-x:\s*auto/s);
    expect(css).toMatch(/\.quick-log-button span\s*{[^}]*-webkit-line-clamp:\s*2/s);
    expect(css).not.toMatch(/\.quick-log-button span\s*{[^}]*white-space:\s*nowrap/s);
  });
});
