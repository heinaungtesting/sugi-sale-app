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

  it('preserves the previous-month point value on each grouped variant', () => {
    const [family] = groupProductsIntoFamilies([
      { ...product(1, '口内炎パッチ', 100), previous_point_value: 80 },
    ]);

    expect(family.variants[0]).toMatchObject({
      productId: 1,
      pointValue: 100,
      previousPointValue: 80,
    });
  });

  it('keeps 0pt variants visible so Home can ask for points before logging', () => {
    const families = groupProductsIntoFamilies([
      product(1, 'フェイタスZα 7枚', 0),
      product(2, 'フェイタスZα 14枚', 120),
    ]);

    expect(families[0].variants.map((variant) => ({ label: variant.label, pointValue: variant.pointValue }))).toEqual([
      { label: '7枚', pointValue: 0 },
      { label: '14枚', pointValue: 120 },
    ]);
  });

  it('deduplicates identical family variants and keeps the pointed variant', () => {
    const families = groupProductsIntoFamilies([
      product(20, 'ヒビエイド35g', 0, 9),
      product(21, 'ヒビエイド 35g', 100, 1),
    ]);

    expect(families[0].variants).toHaveLength(1);
    expect(families[0].variants[0]).toMatchObject({ productId: 21, pointValue: 100, label: '35g' });
  });

  it('orders families by their strongest sale frequency for quick empty-search use', () => {
    const families = groupProductsIntoFamilies([
      product(1, 'フェイタスゲル', 120, 2),
      product(2, '口内炎パッチ', 80, 8),
      product(3, 'ヒビエイド35g', 100, 4),
    ]);

    expect(families.map((family) => family.name)).toEqual(['口内炎パッチ', 'ヒビエイド', 'フェイタス']);
  });

  it('prefers DB product_variants under the base product and hides duplicate product rows', () => {
    const families = groupProductsIntoFamilies([
      { ...product(7, 'フェイタスZα ジクサス', 50), variant_id: 7, variant_label: '7錠', variant_point_value: 50, variant_aliases: ['feitas7'] },
      { ...product(7, 'フェイタスZα ジクサス', 100), variant_id: 8, variant_label: '14錠', variant_point_value: 100, variant_aliases: ['feitas14'] },
      { ...product(7, 'フェイタスZα ジクサス', 150), variant_id: 9, variant_label: '21錠', variant_point_value: 150, variant_aliases: ['feitas21'] },
      { ...product(7, 'フェイタスZα ジクサス', 120), variant_id: 31, variant_label: 'gel', variant_point_value: 120, variant_aliases: ['fetiasgel'] },
      product(47, 'フェイタスゲル', 120),
      product(48, 'フェイタスZα ジクサス 7枚', 80),
      product(49, 'フェイタスZα ジクサス 14枚', 120),
    ]);

    expect(families).toHaveLength(1);
    expect(families[0].name).toBe('フェイタス');
    expect(families[0].variants.map((variant) => ({ productId: variant.productId, variantId: variant.variantId, label: variant.label, pointValue: variant.pointValue }))).toEqual([
      { productId: 7, variantId: 7, label: '7', pointValue: 50 },
      { productId: 7, variantId: 8, label: '14', pointValue: 100 },
      { productId: 7, variantId: 9, label: '21', pointValue: 150 },
      { productId: 7, variantId: 31, label: 'gel', pointValue: 120 },
    ]);
  });

  it('sorts DB display shortcuts by pharmacy tap order: normal sizes, gel, warm sizes, big warm', () => {
    const families = groupProductsIntoFamilies([
      { ...product(7, 'フェイタスZα ジクサス', 150), variant_id: 1, variant_label: '21枚', variant_display_shortcut: '21枚', variant_point_value: 150 },
      { ...product(7, 'フェイタスZα ジクサス', 150), variant_id: 2, variant_label: '大温7枚', variant_display_shortcut: '大温7枚', variant_point_value: 150 },
      { ...product(7, 'フェイタスZα ジクサス', 100), variant_id: 3, variant_label: '温14枚', variant_display_shortcut: '温14枚', variant_point_value: 100 },
      { ...product(7, 'フェイタスZα ジクサス', 120), variant_id: 4, variant_label: 'gel', variant_display_shortcut: 'ジェル', variant_point_value: 120 },
      { ...product(7, 'フェイタスZα ジクサス', 50), variant_id: 5, variant_label: '7枚', variant_display_shortcut: '7枚', variant_point_value: 50 },
      { ...product(7, 'フェイタスZα ジクサス', 50), variant_id: 6, variant_label: '温7枚', variant_display_shortcut: '温7枚', variant_point_value: 50 },
      { ...product(7, 'フェイタスZα ジクサス', 100), variant_id: 7, variant_label: '14枚', variant_display_shortcut: '14枚', variant_point_value: 100 },
      { ...product(7, 'フェイタスZα ジクサス', 150), variant_id: 8, variant_label: '温21枚', variant_display_shortcut: '温21枚', variant_point_value: 150 },
    ]);

    expect(families[0].variants.map((variant) => variant.label)).toEqual(['7枚', '14枚', '21枚', 'ジェル', '温7枚', '温14枚', '温21枚', '大温7枚']);
  });
});
