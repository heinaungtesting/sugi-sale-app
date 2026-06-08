import { describe, expect, it } from 'vitest';
import { normalizeProductQuery, rankProductsForSearch, type SearchableProduct } from '../lib/sugi-domain';

const products: SearchableProduct[] = [
  { id: 1, product_name: '口内炎パッチ', point_value: 80, category: '医薬品', scope: 'global', aliases: ['kuchi', 'kuchinaien', 'こうない'], sale_count: 8 },
  { id: 2, product_name: 'ヒビエイド', point_value: 50, category: '医薬品', scope: 'global', aliases: ['hibi', 'hibi50', 'ひび'], sale_count: 4 },
  { id: 3, product_name: 'ヒビエイド35g', point_value: 100, category: '医薬品', scope: 'global', aliases: ['hibi35', 'hibi100'], sale_count: 2 },
  { id: 4, product_name: 'フェイタスゲル', point_value: 120, category: '外用薬', scope: 'global', aliases: ['fetiasgel', 'fetas', 'gel'], sale_count: 3 },
  { id: 5, product_name: 'UVトーンアップ ピンク', point_value: 200, category: '化粧品', scope: 'global', aliases: ['pripink', 'tone', 'uv'], sale_count: 1 },
];

describe('product search ranking', () => {
  it('normalizes Japanese/Latin input for fast mobile search', () => {
    expect(normalizeProductQuery('  ＨｉＢｉ３５  ')).toBe('hibi35');
    expect(normalizeProductQuery(' ヒビ エイド ')).toBe('ヒビエイド');
  });

  it('puts exact shortcut matches before broader shortcut matches', () => {
    const result = rankProductsForSearch(products, 'hibi35');
    expect(result.map((p) => p.product_name).slice(0, 2)).toEqual(['ヒビエイド35g', 'ヒビエイド']);
  });

  it('matches romaji aliases and Japanese product fragments', () => {
    expect(rankProductsForSearch(products, 'kuchi')[0].product_name).toBe('口内炎パッチ');
    expect(rankProductsForSearch(products, 'フェイ')[0].product_name).toBe('フェイタスゲル');
  });

  it('returns frequent products when query is empty', () => {
    const result = rankProductsForSearch(products, '');
    expect(result.map((p) => p.product_name).slice(0, 3)).toEqual(['口内炎パッチ', 'ヒビエイド', 'フェイタスゲル']);
  });

  it('uses higher point value as tie breaker after match quality and frequency', () => {
    const result = rankProductsForSearch(products, 'uv');
    expect(result[0].product_name).toBe('UVトーンアップ ピンク');
  });
});
