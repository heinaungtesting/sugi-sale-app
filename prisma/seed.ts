import catalogSource from '../data/local-product-catalog.json';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export type CatalogSourceRow = {
  id: number;
  product_name: string;
  point_value: number;
  category: string;
  scope: string;
  aliases: string[];
  variant_id: number | null;
  variant_label: string | null;
  variant_display_shortcut: string | null;
  variant_point_value: number | null;
  variant_aliases: string[];
  sale_count: number;
};

export type NormalizedCatalogVariant = {
  key: string;
  variantLabel: string;
  displayShortcut: string | null;
  pointValue: number;
  nicknames: string[];
};

export type NormalizedCatalogProduct = {
  key: string;
  productName: string;
  category: string;
  pointValue: number;
  nicknames: string[];
  variants: NormalizedCatalogVariant[];
};

export type NormalizedCatalog = {
  products: NormalizedCatalogProduct[];
};

type ProductData = {
  productName: string;
  category: string;
  pointValue: number;
  nicknames: string[];
  isActive: boolean;
  userId: bigint | null;
};

type StoredProduct = ProductData & { id: bigint };

type ProductVariantData = {
  productId: bigint;
  variantLabel: string;
  displayShortcut: string | null;
  unitCount: number;
  pointValue: number;
  nicknames: string[];
  isActive: boolean;
};

type StoredProductVariant = ProductVariantData & { id: bigint };

type CatalogProductCountArgs = {
  where: {
    productName: { in: string[] };
    isActive: true;
    userId: null;
  };
};

type CatalogVariantCountArgs = {
  where: {
    isActive: true;
    OR: Array<{
      productId: bigint;
      variantLabel: string;
      product: { is: { isActive: true; userId: null } };
    }>;
  };
};

export type CatalogSeedTransaction = {
  product: {
    findUnique(args: { where: { productName: string } }): Promise<StoredProduct | null>;
    upsert(args: { where: { productName: string }; create: ProductData; update: ProductData }): Promise<StoredProduct>;
  };
  productVariant: {
    findUnique(args: { where: { productId_variantLabel: { productId: bigint; variantLabel: string } } }): Promise<StoredProductVariant | null>;
    upsert(args: { where: { productId_variantLabel: { productId: bigint; variantLabel: string } }; create: ProductVariantData; update: ProductVariantData }): Promise<StoredProductVariant>;
  };
};

export type CatalogSeedClient = CatalogSeedTransaction & {
  $transaction<T>(callback: (transaction: CatalogSeedTransaction) => Promise<T>): Promise<T>;
  product: CatalogSeedTransaction['product'] & { count(args: CatalogProductCountArgs): Promise<number> };
  productVariant: CatalogSeedTransaction['productVariant'] & { count(args: CatalogVariantCountArgs): Promise<number> };
};

export type CatalogSeedSummary = {
  products: CatalogSeedCounts;
  variants: CatalogSeedCounts;
};

export type CatalogSeedCounts = {
  inserted: number;
  updated: number;
  skipped: number;
  total: number;
};

const sourceFields = [
  'id',
  'product_name',
  'point_value',
  'category',
  'scope',
  'aliases',
  'variant_id',
  'variant_label',
  'variant_display_shortcut',
  'variant_point_value',
  'variant_aliases',
  'sale_count',
] as const;

const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const normalizeText = (value: unknown, field: string, index: number) => {
  if (typeof value !== 'string') throw new Error(`catalog row ${index}: ${field} must be a string`);
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!normalized) throw new Error(`catalog row ${index}: ${field} must not be empty`);
  if (normalized.includes('\u0000')) throw new Error(`catalog row ${index}: ${field} must not contain U+0000`);
  return normalized;
};

const normalizeAliases = (value: unknown, field: string, index: number) => {
  if (!Array.isArray(value)) throw new Error(`catalog row ${index}: ${field} must be an array`);
  const aliases = value.map((alias) => {
    if (typeof alias !== 'string') throw new Error(`catalog row ${index}: ${field} must contain only strings`);
    return normalizeText(alias, field, index);
  });
  return [...new Set(aliases)].sort(compareText);
};

const requireNonNegativeInteger = (value: unknown, field: string, index: number) => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`catalog row ${index}: ${field} must be a non-negative integer`);
  }
  return value as number;
};

const parseCatalogRow = (value: unknown, index: number): CatalogSourceRow => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`catalog row ${index}: must be an object`);
  }
  const row = value as Record<string, unknown>;
  const fields = Object.keys(row).sort(compareText);
  if (fields.length !== sourceFields.length || fields.some((field, fieldIndex) => field !== [...sourceFields].sort(compareText)[fieldIndex])) {
    throw new Error(`catalog row ${index}: has an unexpected shape`);
  }

  const variantFieldsAreNull = row.variant_id === null
    && row.variant_label === null
    && row.variant_display_shortcut === null
    && row.variant_point_value === null;
  const variantFieldsArePresent = row.variant_id !== null
    && row.variant_label !== null
    && row.variant_display_shortcut !== null
    && row.variant_point_value !== null;
  if (!variantFieldsAreNull && !variantFieldsArePresent) {
    throw new Error(`catalog row ${index}: variant fields must be all present or all null`);
  }
  if (row.scope !== 'global') throw new Error(`catalog row ${index}: scope must be global`);

  const parsed: CatalogSourceRow = {
    id: requireNonNegativeInteger(row.id, 'id', index),
    product_name: normalizeText(row.product_name, 'product_name', index),
    point_value: requireNonNegativeInteger(row.point_value, 'point_value', index),
    category: normalizeText(row.category, 'category', index),
    scope: 'global',
    aliases: normalizeAliases(row.aliases, 'aliases', index),
    variant_id: variantFieldsAreNull ? null : requireNonNegativeInteger(row.variant_id, 'variant_id', index),
    variant_label: variantFieldsAreNull ? null : normalizeText(row.variant_label, 'variant_label', index),
    variant_display_shortcut: variantFieldsAreNull ? null : normalizeText(row.variant_display_shortcut, 'variant_display_shortcut', index),
    variant_point_value: variantFieldsAreNull ? null : requireNonNegativeInteger(row.variant_point_value, 'variant_point_value', index),
    variant_aliases: normalizeAliases(row.variant_aliases, 'variant_aliases', index),
    sale_count: requireNonNegativeInteger(row.sale_count, 'sale_count', index),
  };

  if (parsed.variant_point_value !== null && parsed.variant_point_value !== parsed.point_value) {
    throw new Error(`catalog row ${index}: variant_point_value must equal point_value`);
  }
  return parsed;
};

export const normalizeCatalog = (source: unknown): NormalizedCatalog => {
  if (!Array.isArray(source)) throw new Error('catalog source must be an array');

  const families = new Map<string, {
    category: string;
    pointValues: number[];
    aliases: Set<string>;
    variants: Map<string, NormalizedCatalogVariant>;
  }>();

  source.map(parseCatalogRow).forEach((row) => {
    const productName = row.product_name;
    const family = families.get(productName);
    if (family && family.category !== row.category) {
      throw new Error(`conflicting category for product ${productName}`);
    }
    const nextFamily = family ?? {
      category: row.category,
      pointValues: [],
      aliases: new Set<string>(),
      variants: new Map<string, NormalizedCatalogVariant>(),
    };
    row.aliases.forEach((alias) => nextFamily.aliases.add(alias));
    nextFamily.pointValues.push(row.point_value);

    if (row.variant_label !== null && row.variant_display_shortcut !== null && row.variant_point_value !== null) {
      const key = `${productName}\u0000${row.variant_label}`;
      const candidate: NormalizedCatalogVariant = {
        key,
        variantLabel: row.variant_label,
        displayShortcut: row.variant_display_shortcut,
        pointValue: row.variant_point_value,
        nicknames: row.variant_aliases,
      };
      const existing = nextFamily.variants.get(key);
      if (existing && (existing.displayShortcut !== candidate.displayShortcut || existing.pointValue !== candidate.pointValue)) {
        throw new Error(`conflicting variant ${key}`);
      }
      if (existing) {
        existing.nicknames = [...new Set([...existing.nicknames, ...candidate.nicknames])].sort(compareText);
      } else {
        nextFamily.variants.set(key, candidate);
      }
    }
    families.set(productName, nextFamily);
  });

  return {
    products: [...families.entries()]
      .map(([productName, family]) => ({
        key: productName,
        productName,
        category: family.category,
        pointValue: Math.min(...family.pointValues),
        nicknames: [...family.aliases].sort(compareText),
        variants: [...family.variants.values()].sort((left, right) => compareText(left.variantLabel, right.variantLabel)),
      }))
      .sort((left, right) => compareText(left.productName, right.productName)),
  };
};

const sameStrings = (left: string[], right: string[]) => left.length === right.length && left.every((value, index) => value === right[index]);

const sameProduct = (existing: StoredProduct, next: ProductData) =>
  existing.productName === next.productName
  && existing.category === next.category
  && existing.pointValue === next.pointValue
  && existing.isActive === next.isActive
  && existing.userId === next.userId
  && sameStrings(existing.nicknames, next.nicknames);

const sameVariant = (existing: StoredProductVariant, next: ProductVariantData) =>
  existing.productId === next.productId
  && existing.variantLabel === next.variantLabel
  && existing.displayShortcut === next.displayShortcut
  && existing.unitCount === next.unitCount
  && existing.pointValue === next.pointValue
  && existing.isActive === next.isActive
  && sameStrings(existing.nicknames, next.nicknames);

const newCounts = (): CatalogSeedCounts => ({ inserted: 0, updated: 0, skipped: 0, total: 0 });

const recordWrite = (counts: CatalogSeedCounts, existing: unknown, unchanged: boolean) => {
  if (!existing) counts.inserted += 1;
  else if (unchanged) counts.skipped += 1;
  else counts.updated += 1;
};

export const seedCatalog = async (prisma: CatalogSeedClient, catalog: NormalizedCatalog): Promise<CatalogSeedSummary> => {
  const products = newCounts();
  const variants = newCounts();
  const expectedVariantKeys: Array<{ productId: bigint; variantLabel: string }> = [];

  for (const family of catalog.products) {
    await prisma.$transaction(async (transaction) => {
      const productData: ProductData = {
        productName: family.productName,
        category: family.category,
        pointValue: family.pointValue,
        nicknames: family.nicknames,
        isActive: true,
        userId: null,
      };
      const existingProduct = await transaction.product.findUnique({ where: { productName: family.key } });
      if (existingProduct && existingProduct.userId !== null) {
        throw new Error(`catalog product is not global: ${family.key}`);
      }
      const product = !existingProduct || !sameProduct(existingProduct, productData)
        ? await transaction.product.upsert({
          where: { productName: family.key },
          create: productData,
          update: productData,
        })
        : existingProduct;
      recordWrite(products, existingProduct, !!existingProduct && sameProduct(existingProduct, productData));

      for (const variant of family.variants) {
        expectedVariantKeys.push({ productId: product.id, variantLabel: variant.variantLabel });
        const variantData: ProductVariantData = {
          productId: product.id,
          variantLabel: variant.variantLabel,
          displayShortcut: variant.displayShortcut,
          unitCount: 1,
          pointValue: variant.pointValue,
          nicknames: variant.nicknames,
          isActive: true,
        };
        const where = { productId_variantLabel: { productId: product.id, variantLabel: variant.variantLabel } };
        const existingVariant = await transaction.productVariant.findUnique({ where });
        if (!existingVariant || !sameVariant(existingVariant, variantData)) {
          await transaction.productVariant.upsert({ where, create: variantData, update: variantData });
        }
        recordWrite(variants, existingVariant, !!existingVariant && sameVariant(existingVariant, variantData));
      }
    });
  }

  const productWhere: CatalogProductCountArgs['where'] = {
    productName: { in: catalog.products.map((product) => product.productName) },
    isActive: true,
    userId: null,
  };
  products.total = await prisma.product.count({ where: productWhere });
  variants.total = await prisma.productVariant.count({
    where: {
      isActive: true,
      OR: expectedVariantKeys.map((variant) => ({
        productId: variant.productId,
        variantLabel: variant.variantLabel,
        product: {
          is: {
            isActive: true,
            userId: null,
          },
        },
      })),
    },
  });
  return { products, variants };
};

export const formatCatalogSeedSummary = (summary: CatalogSeedSummary) =>
  `catalog seed products inserted=${summary.products.inserted} updated=${summary.products.updated} skipped=${summary.products.skipped} total=${summary.products.total}\n`
  + `catalog seed variants inserted=${summary.variants.inserted} updated=${summary.variants.updated} skipped=${summary.variants.skipped} total=${summary.variants.total}`;

const main = async () => {
  const { prisma } = await import('../lib/prisma');
  try {
    const summary = await seedCatalog(prisma, normalizeCatalog(catalogSource));
    console.log(formatCatalogSeedSummary(summary));
  } finally {
    await prisma.$disconnect();
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => {
    console.error('catalog seed failed');
    process.exitCode = 1;
  });
}
