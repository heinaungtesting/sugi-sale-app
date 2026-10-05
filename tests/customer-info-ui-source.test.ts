import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('customer info UI contract', () => {
  it('keeps the info button away from the sale flow', () => {
    const card = source('components/CustomerInfoCard.tsx');
    expect(card).not.toContain('enqueueSale');
    expect(card).not.toContain('/api/sales');
    expect(card).toContain('event.stopPropagation()');
    expect(card).toContain('onPointerDown={(event) => event.stopPropagation()}');
    expect(card).toContain('準備中');

    const logger = source('components/SearchProductLogger.tsx');
    // The ⓘ button sits beside the family title, never inside a variant (sale) button.
    expect(logger.match(/<h3>\{family\.name\}<\/h3>\n\s+\{infoButtonFor\(family\)\}/g)).toHaveLength(2);
    expect(logger).toContain("variant.scope !== 'private'");

    const tapList = source('components/ProductTapList.tsx');
    expect(tapList).toContain("product.scope !== 'private'");
    expect(tapList).toMatch(/<\/button>\s+\{product\.scope !== 'private' && \(\s+<CustomerInfoButton/);
  });

  it('opens from the device cache first and syncs the bundle every 6 hours', () => {
    const card = source('components/CustomerInfoCard.tsx');
    expect(card.indexOf('getCachedCards(productId)')).toBeLessThan(card.indexOf('fetchCards(productId)'));
    const cache = source('lib/customer-info-cache.ts');
    expect(cache).toContain("openDB<CustomerInfoDb>(DB_NAME");
    expect(cache).toContain('6 * 60 * 60 * 1000');
    expect(cache).toContain('/api/customer-info/bundle?since=');
    expect(cache).toContain('carded_product_ids');
  });

  it('shows EN and 中文 with a remembered choice and the fixed section order', () => {
    const card = source('components/CustomerInfoCard.tsx');
    const domain = source('domain/customer-info/customer-info.ts');
    expect(card).toContain('saveCardLanguage(next)');
    expect(domain).toContain("toggle: 'EN'");
    expect(domain).toContain("toggle: '中文'");
    expect(domain).toContain("'unique_features', 'purpose', 'risks', 'ingredients'");
    expect(card).toContain('card.product_name');
    expect(card).toContain('copy.disclaimer');
  });

  it('meets the readability and touch-target rules', () => {
    const css = source('app/globals.css');
    expect(css).toMatch(/\.customer-info-body, \.customer-info-status \{ font-size: max\(20px, 1\.25rem\); line-height: 1\.6; \}/);
    expect(css).toMatch(/\.customer-info-button \{[^}]*min-width: 44px;[^}]*min-height: 44px;/s);
    expect(css).toMatch(/\.customer-info-close \{[^}]*min-height: 48px;/s);
    expect(css).toContain('Noto Sans SC');
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s+\.customer-info-overlay/);
  });

  it('reviews field by field with no bulk approval', () => {
    const admin = source('components/AdminCustomerInfoClient.tsx');
    expect(admin).toContain("action: 'approve'");
    expect(admin).toContain("action: 'reject'");
    expect(admin).not.toMatch(/approve all|一括承認する/i);
    expect(admin).toContain('findBlockedClaims(body)');
    expect(source('app/admin/page.tsx')).toContain('/admin/customer-info');
  });

  it('never auto-publishes customer info from the enrichment publisher', () => {
    expect(source('scripts/enrich/publish.ts')).not.toContain('product_customer_info');
    const ingest = source('app/api/admin/customer-info/ingest/route.ts');
    expect(ingest).not.toContain("'published'");
  });

  it('lets admins set the Hermes endpoint and request drafts', () => {
    const admin = source('components/AdminCustomerInfoClient.tsx');
    expect(admin).toContain('Hermes APIエンドポイント');
    expect(admin).toContain('type="url"');
    expect(admin).toContain('type="password"');
    expect(admin).toContain("'/api/admin/customer-info/hermes'");
    expect(admin).toContain('/draft-request');
    expect(admin).toContain('Hermesに下書きを依頼');
  });
});
