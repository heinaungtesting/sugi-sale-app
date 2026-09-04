import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('page loading performance contracts', () => {
  it('uses Next.js client navigation for the persistent app menu', () => {
    const header = source('components/AppHeader.tsx');

    expect(header).toContain("import Link from 'next/link'");
    expect(header).toContain('<Link href="/"');
    expect(header).toContain('<Link href="/sales"');
    expect(header).toContain('<Link href="/logs"');
    expect(header).toContain('<Link href="/feedback"');
    expect(header).toContain('<Link href="/sessions"');
    expect(header).not.toMatch(/<a href="\/(?:sales|logs|feedback|sessions)"/);
  });

  it('provides an immediate loading state for dynamic route transitions', () => {
    const loadingPath = join(process.cwd(), 'app/loading.tsx');

    expect(existsSync(loadingPath)).toBe(true);
    expect(source('app/loading.tsx')).toContain('aria-busy="true"');
  });

  it('limits initial product payloads on home and sales pages', () => {
    expect(source('app/page.tsx')).toContain("listSearchableProducts(user.id, '', 60)");
    expect(source('app/sales/page.tsx')).toContain("listSearchableProducts(user.id, '', 60)");
  });

  it('debounces remote product search on home and sales pages', () => {
    for (const path of ['components/SearchProductLogger.tsx', 'components/SalesCalendarClient.tsx']) {
      const component = source(path);
      expect(component).toContain('SEARCH_DEBOUNCE_MS = 200');
      expect(component).toContain('window.setTimeout');
      expect(component).toContain('window.clearTimeout');
      expect(component).toContain("fetch(`/api/products?q=${encodeURIComponent(normalizedQuery)}`");
    }
  });
});
