import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('sales page mobile UI source', () => {
  it('uses the same AppShell and AppHeader as home', () => {
    const page = source('app/sales/page.tsx');
    expect(page).toContain('<AppShell>');
    expect(page).toContain('<AppHeader');
    expect(page).toContain('activePage="sales"');
    expect(page).not.toContain('sales-shell');
  });

  it('renders calendar and selected-date details as separate shared rounded cards', () => {
    const client = source('components/SalesCalendarClient.tsx');
    expect(client).toContain('PageCard');
    expect(client).toContain('sales-calendar-card');
    expect(client).toContain('sales-detail-card');
    expect(client).toContain('selected-day-pill');
  });

  it('keeps selected-date entries scrollable without product-add drawer complexity', () => {
    const client = source('components/SalesCalendarClient.tsx');
    const css = source('app/globals.css');
    expect(client).not.toContain('showAddProduct');
    expect(client).not.toContain('sales-add-drawer');
    expect(css).toMatch(/\.sales-log-scroll\s*{[^}]*overflow-y:\s*auto/s);
    expect(css).not.toContain('sales-add-drawer');
  });

  it('keeps simple activity dots and one selected-date total line', () => {
    const client = source('components/SalesCalendarClient.tsx');
    const css = source('app/globals.css');
    expect(client).toContain('sales-day-dot');
    expect(client).toContain('selected-day-total');
    expect(client).not.toContain('sales-summary-strip');
    expect(css).toMatch(/\.sales-day-dot\s*{/s);
    expect(css).toMatch(/\.selected-day-total\s*{/s);
  });

  it('uses clean Japanese empty state copy', () => {
    const client = source('components/SalesCalendarClient.tsx');
    const css = source('app/globals.css');
    expect(client).toContain('記録はありません');
    expect(client).toContain('別の日付を選ぶか、ここから商品を追加してください。');
    expect(css).toMatch(/\.sales-empty-state\s*{/s);
  });
});
