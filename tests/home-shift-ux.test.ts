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

  it('supports quick product creation from missing search results', () => {
    const logger = source('components/SearchProductLogger.tsx');
    const route = source('app/api/products/route.ts');
    const db = source('lib/sugi-db.ts');
    expect(logger).toContain('quick-add-form');
    expect(logger).toContain('Create & log');
    expect(logger).toContain("fetch('/api/products'");
    expect(route).toContain('export async function POST');
    expect(route).toContain('createQuickProduct');
    expect(route).toContain('logSale');
    expect(db).toContain('クイック追加');
  });

  it('supports quick home-page point correction for wrong product points', () => {
    const client = source('components/HomeShiftLoggerClient.tsx');
    const route = source('app/api/sales/[id]/route.ts');
    const db = source('lib/sugi-db.ts');
    expect(client).toContain('point-fix-inline');
    expect(client).toContain('点数保存');
    expect(client).toContain('point_value: nextPoints');
    expect(route).toContain('updateSalePoints');
    expect(db).toContain('UPDATE sales_logs SET points_per_item');
    expect(db).toContain('UPDATE product_variants SET point_value');
  });
});
