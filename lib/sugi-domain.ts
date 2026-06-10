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
  variant_id?: number | null;
  variant_label?: string | null;
  variant_point_value?: number | null;
  variant_aliases?: string[];
};

export type ProductVariant = {
  productId: number;
  variantId?: number;
  label: string;
  productName: string;
  pointValue: number;
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

export function categoryLabel(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed || 'その他';
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

function matchScore(product: SearchableProduct, normalizedQuery: string): number {
  if (!normalizedQuery) return 1;
  const name = normalizeProductQuery(product.product_name);
  const aliases = (product.aliases ?? []).map(normalizeProductQuery);
  const candidates = [name, ...aliases];

  if (candidates.some((value) => value === normalizedQuery)) return 1000;
  if (candidates.some((value) => value.startsWith(normalizedQuery))) return 800;
  if (candidates.some((value) => value.includes(normalizedQuery))) return 600;
  if (candidates.some((value) => normalizedQuery.includes(value) && value.length >= 2)) return 500;
  return 0;
}

export function rankProductsForSearch(products: SearchableProduct[], query: string, limit?: number): SearchableProduct[] {
  const normalizedQuery = normalizeProductQuery(query);
  const ranked = products
    .map((product) => ({ product, score: matchScore(product, normalizedQuery) }))
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

export function groupProductsIntoFamilies(products: SearchableProduct[], limit?: number): ProductFamily[] {
  const families = new Map<string, ProductFamily>();
  const familiesWithDbVariants = new Set(
    products
      .filter((product) => product.variant_id && Number(product.variant_point_value ?? product.point_value) > 0)
      .map((product) => familyNameForProduct(product.product_name))
  );

  for (const product of products) {
    const familyName = familyNameForProduct(product.product_name);
    if (!product.variant_id && familiesWithDbVariants.has(familyName)) continue;
    const pointValue = Number(product.variant_point_value ?? product.point_value);
    if (!isLoggableProduct({ point_value: pointValue })) continue;
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
    family.variants.push({
      productId: product.id,
      variantId: product.variant_id ? Number(product.variant_id) : undefined,
      label: product.variant_label ? displayLabelForDbVariant(product.variant_label) : variantLabelForProduct(product.product_name, familyName),
      productName: product.product_name,
      pointValue,
      saleCount,
    });
    families.set(familyName, family);
  }

  const sorted = [...families.values()]
    .map((family) => ({
      ...family,
      variants: family.variants.sort((a, b) => {
        const aNumber = Number(a.label);
        const bNumber = Number(b.label);
        const aIsNumber = Number.isFinite(aNumber);
        const bIsNumber = Number.isFinite(bNumber);
        if (aIsNumber && bIsNumber && aNumber !== bNumber) return aNumber - bNumber;
        if (aIsNumber !== bIsNumber) return aIsNumber ? -1 : 1;
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
