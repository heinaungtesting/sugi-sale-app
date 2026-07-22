import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('calendar add and full logbook contract', () => {
  it('keeps calendar add-product simple and posts to the selected sold_date', () => {
    const page = source('app/sales/page.tsx');
    const client = source('components/SalesCalendarClient.tsx');
    expect(page).toContain('listSearchableProducts');
    expect(page).toContain('products={products}');
    expect(client).toContain('選択日に商品を追加');
    expect(client).toContain('soldDate: selectedDate');
    expect(client).toContain('enqueueSale');
    expect(client).not.toContain('sales-add-drawer');
    expect(client).not.toContain('showAddProduct');
  });

  it('makes every history-page product reachable without a nested result scroller', () => {
    const page = source('app/sales/page.tsx');
    const client = source('components/SalesCalendarClient.tsx');
    const css = source('app/globals.css');
    const resultsCss = css.slice(css.indexOf('.calendar-add-results'), css.indexOf('.calendar-add-family'));

    expect(page).toContain("listSearchableProducts(user.id, '', 1000)");
    expect(client).toContain('ADD_FAMILY_PAGE_SIZE = 12');
    expect(client).toContain('allAddFamilies');
    expect(client).toContain('setVisibleFamilyLimit');
    expect(client).toContain('もっと見る');
    expect(client).toContain('全{allAddFamilies.length}件');
    expect(resultsCss).not.toContain('max-height');
    expect(resultsCss).not.toContain('overflow-y');
    expect(css).toContain('.calendar-add-more');
  });

  it('shows a top-30 mostly-used product area under the home search bar', () => {
    const page = source('app/page.tsx');
    const logger = source('components/SearchProductLogger.tsx');
    expect(page).toContain("listSearchableProducts(user.id, '', 300)");
    expect(logger).toContain('mostlyUsedFamilies');
    expect(logger).toContain('Mostly used');
    expect(logger).toContain('よく使う商品');
    expect(logger).toContain('groupProductsIntoFamilies(rankedPopular, 30)');
  });

  it('removes history KPIs and lets every selected-day log expand naturally', () => {
    const page = source('app/sales/page.tsx');
    const header = source('components/AppHeader.tsx');
    const css = source('app/globals.css');
    const logBlocks = [...css.matchAll(/\.sales-log-scroll\s*\{([^}]*)\}/g)].map((match) => match[1]);

    expect(page).toContain('showMetrics={false}');
    expect(header).toContain('showMetrics?: boolean');
    expect(header).toContain('showMetrics = true');
    expect(header).toContain('{showMetrics && (');
    expect(logBlocks.length).toBeGreaterThan(0);
    for (const block of logBlocks) {
      expect(block).not.toMatch(/max-height:\s*\d/);
      expect(block).not.toContain('overflow-y: auto');
      expect(block).not.toContain('overscroll-behavior: contain');
    }
  });

  it('adds a same-layer read-only current-month Japanese log page', () => {
    expect(existsSync(join(process.cwd(), 'app/logs/page.tsx'))).toBe(true);
    const logsPage = source('app/logs/page.tsx');
    const db = source('lib/sugi-db.ts');
    const header = source('components/AppHeader.tsx');
    expect(logsPage).toContain('<AppShell>');
    expect(logsPage).toContain('<AppHeader');
    expect(logsPage).toContain('<PageCard');
    expect(logsPage).toContain('todaySaleDate().slice(0, 7)');
    expect(logsPage).toContain('listSalesHistory(user.id, 500, currentMonth)');
    expect(logsPage).toContain('const logbookTotalPoints = logs.reduce');
    expect(logsPage).toContain('const logbookTotalItems = logs.reduce');
    expect(logsPage).toContain('const logbookCategoryTotals = categoryTotals(logs)');
    expect(logsPage).toContain('const dayCategoryTotals = categoryTotals(dayLogs)');
    expect(logsPage).toContain('totalPoints={logbookTotalPoints}');
    expect(logsPage).toContain('totalItems={logbookTotalItems}');
    expect(logsPage).toContain('summaryLabel="今月の記録"');
    expect(logsPage).toContain('pointsScopeLabel="合計"');
    expect(logsPage).toContain('今月の商品記録');
    expect(logsPage).toContain('月合計（カテゴリ別）');
    expect(logsPage).toContain('カテゴリ別');
    expect(logsPage).toContain('PRODUCT_CATEGORIES');
    expect(logsPage).toContain('今月の記録はまだありません');
    expect(logsPage).toContain('1点あたり');
    expect(logsPage).not.toContain('PATCH');
    expect(logsPage).not.toContain('DELETE');
    expect(db).toContain('export async function listSalesHistory');
    expect(db).toContain('category: string');
    expect(db).toContain('LEFT JOIN products p ON p.id = sales_logs.product_id');
    expect(db).toContain('normalizeProductCategory(sale.category)');
    expect(db).toContain('month?: string');
    expect(db).toContain("sold_date >= ($3 || '-01')::date");
    expect(db).toContain('ORDER BY sold_date ASC, created_at ASC, id ASC');
    expect(header).toContain("type ActivePage = 'home' | 'sales' | 'logs' | 'feedback' | 'sessions' | 'admin'");
    expect(header).toContain('summaryLabel?: string');
    expect(header).toContain('pointsScopeLabel?: string');
  });
});
