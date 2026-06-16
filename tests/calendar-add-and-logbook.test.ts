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

  it('shows a top-30 mostly-used product area under the home search bar', () => {
    const page = source('app/page.tsx');
    const logger = source('components/SearchProductLogger.tsx');
    expect(page).toContain("listSearchableProducts(user.id, '', 300)");
    expect(logger).toContain('mostlyUsedFamilies');
    expect(logger).toContain('Mostly used');
    expect(logger).toContain('よく使う商品');
    expect(logger).toContain('groupProductsIntoFamilies(rankedPopular, 30)');
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
    expect(logsPage).toContain('今月の商品記録');
    expect(logsPage).toContain('今月の記録はまだありません');
    expect(logsPage).toContain('1点あたり');
    expect(logsPage).not.toContain('PATCH');
    expect(logsPage).not.toContain('DELETE');
    expect(db).toContain('export async function listSalesHistory');
    expect(db).toContain('month?: string');
    expect(db).toContain("sold_date >= ($3 || '-01')::date");
    expect(db).toContain('ORDER BY sold_date ASC, created_at ASC, id ASC');
    expect(header).toContain("type ActivePage = 'home' | 'sales' | 'logs' | 'admin'");
  });
});
