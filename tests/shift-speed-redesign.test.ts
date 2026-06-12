import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('shift-speed redesign contract', () => {
  it('defaults the home logger to Japanese and persists the preferred language', () => {
    const client = source('components/HomeShiftLoggerClient.tsx');
    expect(client).toContain("useState<Language>('ja')");
    expect(client).toContain('sugi-language');
    expect(client).toContain('localStorage.getItem');
    expect(client).toContain('localStorage.setItem');
  });

  it('removes quick log and renders results only after search input', () => {
    const logger = source('components/SearchProductLogger.tsx');
    expect(logger).toContain('const hasQuery = normalizedQuery.length > 0');
    expect(logger).toContain('if (!hasQuery) return []');
    expect(logger).not.toContain('search-idle-state');
    expect(logger).toContain('mostlyUsedFamilies');
    expect(logger).not.toContain('quick-log-card');
    expect(logger).not.toContain('PREFERRED_QUICK_LOG_MATCHERS');
  });

  it('replaces ambiguous standard variant labels with action labels for single-variant cards', () => {
    const logger = source('components/SearchProductLogger.tsx');
    expect(logger).toContain('variantDisplayLabel');
    expect(logger).toContain("variant.label === '標準'");
    expect(logger).toContain("language === 'ja' ? '記録' : 'Log'");
  });

  it('adds inline correction controls to recent home logs', () => {
    const client = source('components/HomeShiftLoggerClient.tsx');
    expect(client).toContain('changeRecentQty');
    expect(client).toContain('deleteRecentSale');
    expect(client).toContain('recent-actions');
    expect(client).toContain('aria-label={`${t.increase} ${sale.product_name}`');
  });

  it('simplifies sales history to checking dates without add-product controls', () => {
    const sales = source('components/SalesCalendarClient.tsx');
    const css = source('app/globals.css');
    expect(sales).toContain('日付をタップして記録を確認');
    expect(sales).toContain('別の日付を選ぶか、ここから商品を追加してください。');
    expect(sales).not.toContain('showAddProduct');
    expect(sales).not.toContain('Add product to');
    expect(css).toMatch(/\.sales-day\.muted-day\s*{[^}]*opacity:\s*\.38/s);
    expect(css).not.toContain('sticky-add-product-toggle');
  });
});
