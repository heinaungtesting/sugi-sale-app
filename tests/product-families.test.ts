import { describe, expect, it } from 'vitest';
import { groupProductsIntoFamilies, type SearchableProduct } from '../lib/sugi-domain';

const product = (id: number, product_name: string, point_value = 100, sale_count = 0): SearchableProduct => ({
  id,
  product_name,
  point_value,
  category: 'test',
  scope: 'global',
  aliases: [],
  sale_count,
});

describe('product family grouping for main-page variant logger', () => {
  it('groups related products under one Japanese family title with short variant labels', () => {
    const families = groupProductsIntoFamilies([
      product(1, 'フェイタスZα 7枚', 80),
      product(2, 'フェイタスZα 14枚', 120),
      product(3, 'フェイタスゲル', 120),
      product(4, 'ヒビエイド35g', 100),
      product(5, 'ヒビエイド', 50),
    ]);

    expect(families.map((family) => family.name)).toEqual(['フェイタス', 'ヒビエイド']);
    expect(families[0].variants.map((variant) => variant.label)).toEqual(['7枚', '14枚', 'ジェル']);
    expect(families[1].variants.map((variant) => variant.label)).toEqual(['35g', '標準']);
  });

  it('keeps point values available for logging but does not put points in button labels', () => {
    const [family] = groupProductsIntoFamilies([
      product(1, '口内炎パッチ', 80),
    ]);

    expect(family.name).toBe('口内炎パッチ');
    expect(family.variants[0]).toMatchObject({ productId: 1, pointValue: 80, label: 'パッチ' });
    expect(family.variants[0].label).not.toContain('80');
    expect(family.variants[0].label).not.toContain('pt');
  });

  it('filters out 0pt variants from tappable family cards', () => {
    const families = groupProductsIntoFamilies([
      product(1, 'フェイタスZα 7枚', 0),
      product(2, 'フェイタスZα 14枚', 120),
    ]);

    expect(families[0].variants.map((variant) => variant.label)).toEqual(['14枚']);
  });

  it('orders families by their strongest sale frequency for quick empty-search use', () => {
    const families = groupProductsIntoFamilies([
      product(1, 'フェイタスゲル', 120, 2),
      product(2, '口内炎パッチ', 80, 8),
      product(3, 'ヒビエイド35g', 100, 4),
    ]);

    expect(families.map((family) => family.name)).toEqual(['口内炎パッチ', 'ヒビエイド', 'フェイタス']);
  });
});
