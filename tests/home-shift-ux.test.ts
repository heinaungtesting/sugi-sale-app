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

  it('uses reference-style dog/cat mascots without changing the home logging flow', () => {
    const header = source('components/AppHeader.tsx');
    const logger = source('components/SearchProductLogger.tsx');
    const client = source('components/HomeShiftLoggerClient.tsx');
    const css = source('app/globals.css');
    expect(header).toContain('nav-pet dog');
    expect(header).toContain('nav-pet cat');
    expect(header).toContain('metric-mascot dog');
    expect(header).toContain('metric-mascot cat');
    expect(logger).toContain('featured-family-card');
    expect(client).not.toContain('home-mascot dog');
    expect(client).not.toContain('home-mascot cat');
    expect(client).toContain('aria-hidden="true"');
    expect(client).toContain('<SearchProductLogger');
    expect(css).toContain('.nav-pet');
    expect(css).toContain("url('/cute/v2-head-dog-excited.webp')");
    expect(css).toContain("url('/cute/v2-head-cat-grinning.webp')");
    expect(css).toContain('.featured-family-card');
    expect(css).toContain('.cute-empty-state');
    expect(css).toContain('pointer-events: none');
  });

  it('supports quick product creation from missing search results', () => {
    const logger = source('components/SearchProductLogger.tsx');
    const route = source('app/api/products/route.ts');
    const db = source('lib/sugi-db.ts');
    expect(logger).toContain('quick-add-form');
    expect(logger).toContain('Create & log');
    expect(logger).toContain("csrfFetch('/api/products'");
    expect(route).toContain('export async function POST');
    expect(route).toContain('createQuickProduct');
    expect(route).toContain('logSale');
    expect(db).toContain("VALUES ($1, 'ヘルスケア', $2, $3, TRUE, NULL)");
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

  it('normalizes full-width Japanese numeric input before saving point corrections', () => {
    const client = source('components/HomeShiftLoggerClient.tsx');
    expect(client).toContain("normalize('NFKC')");
    expect(client).toContain('const rawPointEdit');
    expect(client).toContain('const nextPoints = Number(normalizedPointEdit);');
  });

  it('syncs refreshed server props back into the client home state after point correction', () => {
    const client = source('components/HomeShiftLoggerClient.tsx');
    expect(client).toContain('setServerToday(today);');
    expect(client).toContain('[today]');
  });

  it('keeps synced queued sales editable/deletable on Home instead of showing them as error/sync-only rows', () => {
    const client = source('components/HomeShiftLoggerClient.tsx');
    expect(client).toContain("q.status === 'pending' || q.status === 'sending' || q.status === 'failed'");
    expect(client).toContain("_queueStatus: undefined");
    expect(client).not.toContain("_queueStatus: 'synced'");
  });

  it('removes Home recent rows optimistically after delete and clears stale 404 rows', () => {
    const client = source('components/HomeShiftLoggerClient.tsx');
    expect(client).toContain('setServerToday((current) => ({');
    expect(client).toContain('recent: current.recent.filter((item) => item.id !== id)');
    expect(client).toContain('res.ok || res.status === 404');
    expect(client).toContain('setPointError(null);');
  });
});
