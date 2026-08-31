import { describe, expect, it } from 'vitest';
import { normalizeProductQuery, prepareProductSearchQuery, rankProductsForSearch, type SearchableProduct } from '../lib/sugi-domain';

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

  it('removes normalized duplicate rows and keeps the one with points', () => {
    const duplicates: SearchableProduct[] = [
      { id: 90, product_name: 'リポソーム ビタミンC', point_value: 0, category: 'ヘルスケア', scope: 'global', aliases: ['vc'], sale_count: 20 },
      { id: 91, product_name: 'リポソーム　ビタミンＣ', point_value: 250, category: 'ヘルスケア', scope: 'global', aliases: ['vc'], sale_count: 1 },
    ];

    const result = rankProductsForSearch(duplicates, 'vc');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 91, point_value: 250 });
  });

  it('finds a variant by its label even when that label is not duplicated in aliases', () => {
    const result = rankProductsForSearch([
      {
        id: 287,
        product_name: 'バンテリン サポーター',
        point_value: 0,
        category: 'ヘルスケア',
        scope: 'global',
        aliases: ['バンテリン'],
        variant_id: 339,
        variant_label: 'ひざ S',
        variant_display_shortcut: 'ひざ S',
        variant_point_value: 0,
        variant_aliases: ['S'],
      },
    ], 'ひざ S');

    expect(result.map((product) => product.variant_id)).toEqual([339]);
  });

  it('finds a variant from a combined family and variant query', () => {
    const result = rankProductsForSearch([
      {
        id: 306,
        product_name: '日本蜂寿',
        point_value: 0,
        category: 'ヘルスケア',
        scope: 'global',
        aliases: ['蜂寿'],
        variant_id: 401,
        variant_label: '粒',
        variant_display_shortcut: '粒',
        variant_point_value: 0,
        variant_aliases: ['粒'],
      },
    ], '日本蜂寿 粒');

    expect(result.map((product) => product.variant_id)).toEqual([401]);
  });

  it('keeps a Japanese typo match returned by the database search engine', () => {
    const result = rankProductsForSearch([
      {
        id: 500,
        product_name: 'フェイタスゲル',
        point_value: 120,
        category: '外用薬',
        scope: 'global',
        search_score: 2.5,
      },
    ], 'フェタスゲル');

    expect(result.map((product) => product.product_name)).toEqual(['フェイタスゲル']);
  });

  it('keeps exact Japanese matches ahead of fuzzy database matches', () => {
    const result = rankProductsForSearch([
      {
        id: 501,
        product_name: '日本蜂寿',
        point_value: 100,
        category: 'ヘルスケア',
        scope: 'global',
        search_score: 1,
      },
      {
        id: 502,
        product_name: '日本蜂蜜',
        point_value: 500,
        category: 'ヘルスケア',
        scope: 'global',
        search_score: 100,
      },
    ], '日本蜂寿');

    expect(result.map((product) => product.product_name)).toEqual(['日本蜂寿', '日本蜂蜜']);
  });

  it('keeps an exact family and variant match ahead of a popular fuzzy match', () => {
    const result = rankProductsForSearch([
      {
        id: 503,
        product_name: 'フェイタスゲル',
        point_value: 120,
        category: '外用薬',
        scope: 'global',
        variant_id: 1,
        variant_label: '50g',
        sale_count: 0,
        search_score: 1,
      },
      {
        id: 504,
        product_name: 'フェイタスゲル',
        point_value: 120,
        category: '外用薬',
        scope: 'global',
        variant_id: 2,
        variant_label: '55g',
        sale_count: 100,
        search_score: 100,
      },
    ], 'フェイタスゲル 50g');

    expect(result.map((product) => product.variant_label)).toEqual(['50g', '55g']);
  });

  it('deduplicates and bounds database search terms by Unicode code point', () => {
    expect(prepareProductSearchQuery('  日本蜂寿   粒 日本蜂寿 ')).toEqual({
      query: '日本蜂寿 粒',
      terms: ['日本蜂寿', '粒'],
    });
    expect(prepareProductSearchQuery(Array.from({ length: 9 }, (_, index) => `語${index}`).join(' '))).toBeNull();
    expect(prepareProductSearchQuery('あ'.repeat(33))).toBeNull();
    expect(prepareProductSearchQuery('あ'.repeat(129))).toBeNull();
  });
});
