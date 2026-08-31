export type UserRole = 'admin' | 'user';

export type SessionUser = {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
};

export type Category = {
  name: string;
  count: number;
};

export const PRODUCT_CATEGORIES = ['ヘルスケア', '化粧品'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export type Product = {
  id: number;
  product_name: string;
  point_value: number;
  category: string;
  scope: 'global' | 'private';
};

export type SearchableProduct = Product & {
  aliases?: string[];
  sale_count?: number;
  search_score?: number;
  variant_id?: number | null;
  variant_label?: string | null;
  variant_display_shortcut?: string | null;
  variant_point_value?: number | null;
  variant_aliases?: string[];
  previous_point_value?: number | null;
};

export type ProductVariant = {
  productId: number;
  variantId?: number;
  label: string;
  productName: string;
  pointValue: number;
  previousPointValue?: number | null;
  saleCount: number;
};

export type ProductFamily = {
  name: string;
  aliases: string[];
  variants: ProductVariant[];
  saleCount: number;
};

export type TodaySale = {
  id: number;
  product_name: string;
  quantity: number;
  points_per_item: number;
  total_points: number;
};

export function normalizeProductCategory(value: string | null | undefined): ProductCategory {
 const normalized = (value ?? '').normalize('NFKC').trim().toLowerCase();
 if (
 normalized.includes('化粧') ||
 normalized.includes('cosmetic') ||
 normalized.includes('コスメ') ||
 normalized.includes('美容') ||
 normalized.includes('日焼け') ||
 normalized.includes('uv') ||
 normalized.includes('トーンアップ') ||
 normalized.includes('下地') ||
 normalized.includes('美白')
 ) {
 return '化粧品';
 }
 return 'ヘルスケア';
}

export function categoryLabel(value: string | null | undefined): ProductCategory {
 return normalizeProductCategory(value);
}

export function productVisibilityWhere(userPlaceholder: string): string {
  return `(user_id IS NULL OR user_id = ${userPlaceholder})`;
}

export function saleOwnershipWhere(userPlaceholder: string): string {
  return `user_id = ${userPlaceholder}`;
}

export function isLoggableProduct(product: Pick<Product, 'point_value'>): boolean {
  return Number(product.point_value) > 0;
}

export function normalizeProductQuery(input: string): string {
  return input.normalize('NFKC').trim().replace(/\s+/g, '').toLowerCase();
}

export const MAX_PRODUCT_SEARCH_CODE_POINTS = 128;
export const MAX_PRODUCT_SEARCH_TERM_CODE_POINTS = 32;
export const MAX_PRODUCT_SEARCH_TERMS = 8;

export type PreparedProductSearchQuery = {
  query: string;
  terms: string[];
};

export function prepareProductSearchQuery(input: string): PreparedProductSearchQuery | null {
  const whitespaceNormalized = input.trim().replace(/\s+/gu, ' ');
  if ([...whitespaceNormalized].length > MAX_PRODUCT_SEARCH_CODE_POINTS) return null;

  const rawTerms = whitespaceNormalized ? whitespaceNormalized.split(' ') : [];
  if (rawTerms.some((term) => [...term].length > MAX_PRODUCT_SEARCH_TERM_CODE_POINTS)) return null;

  const terms = [...new Set(rawTerms)];
  if (terms.length > MAX_PRODUCT_SEARCH_TERMS) return null;
  return { query: terms.join(' '), terms };
}

function candidateMatchScore(candidates: string[], normalizedTerm: string): number {
  if (candidates.some((value) => value === normalizedTerm)) return 1000;
  if (candidates.some((value) => value.startsWith(normalizedTerm))) return 800;
  if (candidates.some((value) => value.includes(normalizedTerm))) return 600;
  if (candidates.some((value) => normalizedTerm.includes(value) && value.length >= 2)) return 500;
  return 0;
}

function matchScore(product: SearchableProduct, query: string): number {
  const normalizedTerms = query.trim().split(/\s+/u).map(normalizeProductQuery).filter(Boolean);
  if (normalizedTerms.length === 0) return 1;
  const name = normalizeProductQuery(product.product_name);
  const aliases = (product.aliases ?? []).map(normalizeProductQuery);
  const variantCandidates = [
    product.variant_label,
    product.variant_display_shortcut,
    ...(product.variant_aliases ?? []),
  ].filter((value): value is string => Boolean(value)).map(normalizeProductQuery);
  const candidates = [name, ...aliases, ...variantCandidates];

  const termScores = normalizedTerms.map((term) => candidateMatchScore(candidates, term));
  if (termScores.every((score) => score > 0)) return Math.min(...termScores);
  const databaseScore = Number(product.search_score ?? 0);
  if (Number.isFinite(databaseScore) && databaseScore > 0) {
    return Math.min(499, 100 + databaseScore);
  }
  return 0;
}

export function rankProductsForSearch(products: SearchableProduct[], query: string, limit?: number): SearchableProduct[] {
  const normalizedQuery = normalizeProductQuery(query);
  const deduplicated = new Map<string, SearchableProduct>();
  for (const product of products) {
    const variantIdentity = normalizeProductQuery(product.variant_label ?? '');
    const identity = `${normalizeProductQuery(product.product_name)}:${variantIdentity}`;
    const current = deduplicated.get(identity);
    if (!current) {
      deduplicated.set(identity, product);
      continue;
    }

    const currentPoints = Number(current.variant_point_value ?? current.point_value);
    const candidatePoints = Number(product.variant_point_value ?? product.point_value);
    const currentHasPoints = currentPoints > 0;
    const candidateHasPoints = candidatePoints > 0;
    const candidateWins = candidateHasPoints !== currentHasPoints
      ? candidateHasPoints
      : candidatePoints !== currentPoints
        ? candidatePoints > currentPoints
        : (product.sale_count ?? 0) > (current.sale_count ?? 0);
    const winner = candidateWins ? product : current;
    const loser = candidateWins ? current : product;
    deduplicated.set(identity, {
      ...winner,
      aliases: [...new Set([...(winner.aliases ?? []), ...(loser.aliases ?? [])])],
      variant_aliases: [...new Set([...(winner.variant_aliases ?? []), ...(loser.variant_aliases ?? [])])],
      search_score: Math.max(winner.search_score ?? 0, loser.search_score ?? 0),
    });
  }

  const ranked = [...deduplicated.values()]
    .map((product) => ({ product, score: matchScore(product, query) }))
    .filter((entry) => !normalizedQuery || entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const salesDiff = (b.product.sale_count ?? 0) - (a.product.sale_count ?? 0);
      if (salesDiff !== 0) return salesDiff;
      const pointsDiff = b.product.point_value - a.product.point_value;
      if (pointsDiff !== 0) return pointsDiff;
      return a.product.product_name.localeCompare(b.product.product_name, 'ja');
    })
    .map((entry) => entry.product);
  return typeof limit === 'number' ? ranked.slice(0, limit) : ranked;
}

const DEFAULT_ALIAS_RULES: Array<{ pattern: RegExp; aliases: string[] }> = [
  { pattern: /口内炎|口内|こうない/i, aliases: ['kuchi', 'kuchinaien', 'こうない', '口内'] },
  { pattern: /ヒビエイド.*35|35.*ヒビエイド/i, aliases: ['hibi35', 'hibi100', 'hibi', 'ひび'] },
  { pattern: /ヒビエイド/i, aliases: ['hibi', 'hibi50', 'ひび'] },
  { pattern: /フェイタス/i, aliases: ['fetiasgel', 'fetas', 'gel', 'フェイ'] },
  { pattern: /UV.*トーン|トーン.*UV|プリ.*ピンク|ピンク/i, aliases: ['pripink', 'tone', 'uv', 'トーン'] },
];

export function defaultAliasesForProductName(productName: string): string[] {
  const aliases = new Set<string>();
  for (const rule of DEFAULT_ALIAS_RULES) {
    if (rule.pattern.test(productName)) {
      rule.aliases.forEach((alias) => aliases.add(alias));
    }
  }
  return [...aliases];
}

export function applyDefaultProductAliases(products: SearchableProduct[]): SearchableProduct[] {
  return products.map((product) => ({
    ...product,
    aliases: [...new Set([...(product.aliases ?? []), ...defaultAliasesForProductName(product.product_name)])],
  }));
}

function familyNameForProduct(productName: string): string {
  if (/フェイタス/i.test(productName)) return 'フェイタス';
  if (/ヒビエイド/i.test(productName)) return 'ヒビエイド';
  if (/口内炎|口内|こうない/i.test(productName)) return '口内炎パッチ';
  if (/UV.*トーン|トーン.*UV|プリ.*ピンク|ピンク|プリマヴィスタ/i.test(productName)) return 'プリマヴィスタ';
  return productName.trim();
}

function displayLabelForDbVariant(label: string): string {
  const normalized = label.normalize('NFKC').trim();
  const countMatch = normalized.match(/^(\d+)\s*(枚|錠|g|G|個|本|包|ml|mL)?$/);
  if (countMatch) return countMatch[1];
  if (/ゲル|ジェル|gel/i.test(normalized)) return 'gel';
  return normalized;
}

function variantLabelForProduct(productName: string, familyName: string): string {
  const normalized = productName.normalize('NFKC');
  const sizeMatch = normalized.match(/(\d+)\s*(枚|g|G|個|本|錠|包|ml|mL)/);
  if (sizeMatch) return `${sizeMatch[1]}${sizeMatch[2].toLowerCase() === 'g' ? 'g' : sizeMatch[2]}`;
  if (/ゲル|ジェル|gel/i.test(normalized)) return 'ジェル';
  if (/ローション/i.test(normalized)) return 'ローション';
  if (/クリーム/i.test(normalized)) return 'クリーム';
  if (/パッチ/i.test(normalized)) return 'パッチ';
  if (/ピンク/i.test(normalized)) return 'ピンク';
  if (/ベージュ/i.test(normalized)) return 'ベージュ';
  const withoutFamily = normalized.replace(familyName, '').replace(/Zα|ジクサス|α/gi, '').trim();
  return withoutFamily || '標準';
}

function variantSortKey(label: string): number {
  const normalized = label.normalize('NFKC').trim();
  if (/gel|ゲル|ジェル/i.test(normalized)) return 90;
  const number = Number(normalized.match(/\d+/)?.[0] ?? Number.NaN);
  if (!Number.isFinite(number)) return 500;
  if (/大.*温|温.*大/.test(normalized)) return 200 + number;
  if (/温/.test(normalized)) return 100 + number;
  return number;
}

export function groupProductsIntoFamilies(products: SearchableProduct[], limit?: number): ProductFamily[] {
  const families = new Map<string, ProductFamily>();
  const familiesWithDbVariants = new Set(
    products
      .filter((product) => product.variant_id)
      .map((product) => familyNameForProduct(product.product_name))
  );

  for (const product of products) {
    const familyName = familyNameForProduct(product.product_name);
    if (!product.variant_id && familiesWithDbVariants.has(familyName)) continue;
    const pointValue = Number(product.variant_point_value ?? product.point_value);
    const family = families.get(familyName) ?? {
      name: familyName,
      aliases: [],
      variants: [],
      saleCount: 0,
    };
    const aliases = new Set([...family.aliases, ...(product.aliases ?? [])]);
    (product.variant_aliases ?? []).forEach((alias) => aliases.add(alias));
    const saleCount = product.sale_count ?? 0;
    family.aliases = [...aliases];
    family.saleCount = Math.max(family.saleCount, saleCount);
    // Dedupe variants by (productId, variantId). Defensive guard against
    // duplicate rows arriving from upstream (e.g. self-LEFT-JOIN, search
    // refresh races). Without this, the same variant could be pushed twice
    // and render as duplicate cards on the home page.
    const variantKey = `${product.id}:${product.variant_id ?? 'base'}`;
    if (family.variants.some((v) => `${v.productId}:${v.variantId ?? 'base'}` === variantKey)) continue;
    const candidate: ProductVariant = {
      productId: product.id,
      variantId: product.variant_id ? Number(product.variant_id) : undefined,
      label: product.variant_display_shortcut?.trim() || (product.variant_label ? displayLabelForDbVariant(product.variant_label) : variantLabelForProduct(product.product_name, familyName)),
      productName: product.product_name,
      pointValue,
      previousPointValue: product.previous_point_value ?? null,
      saleCount,
    };
    const duplicateIndex = family.variants.findIndex((variant) => normalizeProductQuery(variant.label) === normalizeProductQuery(candidate.label));
    if (duplicateIndex >= 0) {
      const current = family.variants[duplicateIndex];
      const candidateWins = (candidate.pointValue > 0) !== (current.pointValue > 0)
        ? candidate.pointValue > 0
        : candidate.pointValue !== current.pointValue
          ? candidate.pointValue > current.pointValue
          : candidate.saleCount > current.saleCount;
      if (candidateWins) family.variants[duplicateIndex] = candidate;
    } else {
      family.variants.push(candidate);
    }
    families.set(familyName, family);
  }

  const sorted = [...families.values()]
    .map((family) => ({
      ...family,
      variants: family.variants.sort((a, b) => {
        const aKey = variantSortKey(a.label);
        const bKey = variantSortKey(b.label);
        if (aKey !== bKey) return aKey - bKey;
        return a.productId - b.productId;
      }),
    }))
    .sort((a, b) => {
      const salesDiff = b.saleCount - a.saleCount;
      if (salesDiff !== 0) return salesDiff;
      return 0;
    });

  return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
}
