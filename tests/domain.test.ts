import { describe, expect, it } from 'vitest';
import { categoryLabel, normalizeProductCategory, productVisibilityWhere, saleOwnershipWhere, isLoggableProduct } from '../lib/sugi-domain';

describe('sugi domain helpers', () => {
  it('normalizes product categories to the two Sugi reporting buckets', () => {
    expect(categoryLabel(null)).toBe('ヘルスケア');
    expect(categoryLabel('')).toBe('ヘルスケア');
    expect(categoryLabel('栄養剤')).toBe('ヘルスケア');
    expect(categoryLabel('point-campaign')).toBe('ヘルスケア');
    expect(categoryLabel('日焼け止め美容液・化粧下地')).toBe('化粧品');
    expect(categoryLabel('Cosmetic')).toBe('化粧品');
    expect(normalizeProductCategory('化粧品')).toBe('化粧品');
  });

  it('uses shared-or-owned product visibility, never another user private product', () => {
    expect(productVisibilityWhere('$1')).toBe('(user_id IS NULL OR user_id = $1)');
  });

  it('requires sale queries to filter current user', () => {
    expect(saleOwnershipWhere('$1')).toBe('user_id = $1');
  });

  it('does not allow logging zero-point products', () => {
    expect(isLoggableProduct({ point_value: 0 })).toBe(false);
    expect(isLoggableProduct({ point_value: 120 })).toBe(true);
  });
});
