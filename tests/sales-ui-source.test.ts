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

  it('adds polished day activity dots and stronger selected-date summary chips', () => {
    const client = source('components/SalesCalendarClient.tsx');
    const css = source('app/globals.css');
    expect(client).toContain('sales-day-dot');
    expect(client).toContain('sales-summary-strip');
    expect(client).toContain('summary-chip primary');
    expect(css).toMatch(/\.sales-day-dot\s*{/s);
    expect(css).toMatch(/\.summary-chip\.primary\s*{/s);
  });

  it('uses polished empty/add states for fast mobile logging', () => {
    const client = source('components/SalesCalendarClient.tsx');
    const css = source('app/globals.css');
    expect(client).toContain('No products logged yet');
    expect(client).toContain('Tap a variant to log ×1');
    expect(client).toContain('Add product');
    expect(css).toMatch(/\.sales-empty-state\s*{/s);
    expect(css).toMatch(/\.sales-family-card h3\s*{/s);
  });
});
