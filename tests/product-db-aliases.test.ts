import { describe, expect, it } from 'vitest';
import { applyDefaultProductAliases, type SearchableProduct } from '../lib/sugi-domain';

const product = (name: string, aliases: string[] = []): SearchableProduct => ({
  id: 1,
  product_name: name,
  point_value: 120,
  category: 'test',
  scope: 'global',
  aliases,
});

describe('database-backed product aliases', () => {
  it('preserves nicknames loaded from the products database while adding default aliases', () => {
    const [fetas] = applyDefaultProductAliases([
      product('フェイタスゲル', ['feitas', 'fetias', 'pain gel']),
    ]);

    expect(fetas.aliases).toEqual(expect.arrayContaining(['feitas', 'fetias', 'pain gel']));
    expect(fetas.aliases).toEqual(expect.arrayContaining(['fetas', 'gel', 'フェイ']));
  });
});
