import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildQuickProductPlan } from '../lib/product-creation';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('upgraded product creation', () => {
  it('normalizes user search words and generates useful aliases', () => {
    const plan = buildQuickProductPlan({
      productName: '  New   Health 35g  ',
      pointValue: 120,
      aliases: 'newhealth、nh35, red tube\nHealth cream',
    });

    expect(plan).toEqual({
      mode: 'standalone',
      productName: 'New Health 35g',
      pointValue: 120,
      aliases: ['new health 35g', 'new', 'health', '35g', 'newhealth', 'nh35', 'red tube', 'health cream'],
    });
  });

  it('creates a variant plan when an existing main product is selected', () => {
    const plan = buildQuickProductPlan({
      productName: '60錠',
      variantLabel: ' 60錠 ',
      parentProductId: 42,
      pointValue: 200,
      aliases: ['large', '60 tabs'],
    });

    expect(plan).toEqual({
      mode: 'variant',
      parentProductId: 42,
      variantLabel: '60錠',
      pointValue: 200,
      aliases: ['60錠', 'large', '60 tabs'],
    });
  });

  it('rejects an invalid selected parent instead of creating a new main product', () => {
    expect(buildQuickProductPlan({
      productName: '60錠',
      parentProductId: -1,
      pointValue: 200,
    })).toBeNull();
  });

  it('shows product name and points directly only when search has no matches', () => {
    const logger = source('components/SearchProductLogger.tsx');
    expect(logger).toContain('quickAddName');
    expect(logger).toContain('quickAddPoints');
    expect(logger).toContain('{!isSearching && families.length === 0 && (');
    expect(logger).toContain('<form className="quick-add-card quick-add-form"');
    expect(logger).not.toContain('<details');
    expect(logger).not.toContain('noMatchTitle');
    expect(logger).not.toContain('noMatchHelp');
    expect(logger).not.toContain('quickAddParentId');
    expect(logger).not.toContain('quickAddAliases');
    expect(logger).not.toContain('parent_product_id');
    expect(logger).not.toContain('variant_label');
    expect(logger).not.toContain("fetch('/api/products?parents=1')");
    expect(logger).not.toContain('onToggle');
  });

  it('routes variant creation into product_variants and preserves a standard option', () => {
    const route = source('app/api/products/route.ts');
    const db = source('lib/sugi-db.ts');

    expect(route).toContain('parentProductId');
    expect(route).toContain('variantLabel');
    expect(route).toContain('aliases: body?.aliases');
    expect(route).toContain('product.variant_id');
    expect(route).toContain("url.searchParams.get('parents')");
    expect(route).toContain('listVisibleProductParents');
    expect(db).toContain('buildQuickProductPlan');
    expect(db).toContain('INSERT INTO product_variants');
    expect(db).toContain("'標準'");
    expect(db).toContain('ON CONFLICT (product_id, variant_label)');
  });
});
