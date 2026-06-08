import { describe, expect, it } from 'vitest';
import { applyDefaultProductAliases, type Product } from '../lib/sugi-domain';

const base = (name: string, point_value = 50): Product => ({
  id: point_value,
  product_name: name,
  point_value,
  category: 'test',
  scope: 'global',
});

describe('default Sugi product aliases', () => {
  it('adds Hein work shortcuts to matching products', () => {
    const [kuchi, hibi, fetas] = applyDefaultProductAliases([
      base('口内炎パッチ', 80),
      base('ヒビエイド35g', 100),
      base('フェイタスゲル', 120),
      base('フェイタスZα ジクサス', 0),
    ]);

    expect(kuchi.aliases).toContain('kuchi');
    expect(hibi.aliases).toEqual(expect.arrayContaining(['hibi35', 'hibi100']));
    expect(fetas.aliases).toEqual(expect.arrayContaining(['fetiasgel', 'fetas', 'gel']));
    expect(applyDefaultProductAliases([base('フェイタスZα ジクサス')])[0].aliases).toContain('fetas');
  });

  it('keeps unknown products searchable by name without fake aliases', () => {
    expect(applyDefaultProductAliases([base('未知の商品')])[0].aliases).toEqual([]);
  });
});
