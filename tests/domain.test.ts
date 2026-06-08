import { describe, expect, it } from 'vitest';
import { categoryLabel, productVisibilityWhere, saleOwnershipWhere, isLoggableProduct } from '../lib/sugi-domain';

describe('sugi domain helpers', () => {
  it('labels empty product categories as その他', () => {
    expect(categoryLabel(null)).toBe('その他');
    expect(categoryLabel('')).toBe('その他');
    expect(categoryLabel('  ')).toBe('その他');
    expect(categoryLabel('栄養剤')).toBe('栄養剤');
  });

  it('uses shared-or-owned product visibility, never another user private product', () => {
    expect(productVisibilityWhere('$1')).toBe('(user_id IS NULL OR user_id = $1)');
  });

  it('requires sale queries to filter current user', () => {
    expect(saleOwnershipWhere('$1')).toBe('user_id = $1');
  });

  it('does not allow logging zero-point products', () => {
    expect(isLoggableProduct({ id: 1, product_name: '0pt', point_value: 0, category: 'x', scope: 'global' })).toBe(false);
    expect(isLoggableProduct({ id: 2, product_name: '120pt', point_value: 120, category: 'x', scope: 'global' })).toBe(true);
  });
});
