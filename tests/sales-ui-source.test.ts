import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('sales page mobile UI source', () => {
  it('uses a compact sales-only shell instead of the heavy AppHeader stats header', () => {
    const page = source('app/sales/page.tsx');
    expect(page).toContain('sales-shell');
    expect(page).not.toContain('<AppHeader');
  });

  it('renders calendar and selected-date details as separate rounded cards', () => {
    const client = source('components/SalesCalendarClient.tsx');
    expect(client).toContain('sales-calendar-card');
    expect(client).toContain('sales-detail-card');
    expect(client).toContain('selected-day-pill');
  });

  it('keeps product add collapsed and makes selected-date entries scrollable', () => {
    const client = source('components/SalesCalendarClient.tsx');
    const css = source('app/globals.css');
    expect(client).toContain('showAddProduct');
    expect(client).toContain('+ Add product');
    expect(css).toMatch(/\.sales-log-scroll\s*{[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.sales-add-drawer\s*{[^}]*max-height/s);
  });
});
