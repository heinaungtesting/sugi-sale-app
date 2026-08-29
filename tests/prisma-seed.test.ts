import { describe, expect, it } from 'vitest';
import {
  formatCatalogSeedSummary,
  loadCatalogSeedPrisma,
  normalizeCatalog,
  seedCatalog,
  type CatalogSeedClient,
  type CatalogSeedTransaction,
  type CatalogSourceRow,
} from '../prisma/seed';

const row = (overrides: Partial<CatalogSourceRow> = {}): CatalogSourceRow => ({
  id: 1,
  product_name: ' Herbal Tea ',
  point_value: 120,
  category: 'ヘルスケア',
  scope: 'global',
  aliases: ['tea'],
  variant_id: 11,
  variant_label: ' 10 bags ',
  variant_display_shortcut: '10',
  variant_point_value: 120,
  variant_aliases: ['ten bags'],
  sale_count: 0,
  ...overrides,
});

class FakeCatalogPrisma implements CatalogSeedClient {
  readonly products = new Map<string, { id: bigint; productName: string; category: string; pointValue: number; nicknames: string[]; isActive: boolean; userId: bigint | null }>();
  readonly variants = new Map<string, { id: bigint; productId: bigint; variantLabel: string; displayShortcut: string | null; unitCount: number; pointValue: number; nicknames: string[]; isActive: boolean }>();
  transactions = 0;
  productUpserts = 0;
  variantUpserts = 0;
  private nextProductId = 1n;
  private nextVariantId = 1n;

  product = {
    findUnique: async ({ where }: { where: { productName: string } }) => this.products.get(where.productName) ?? null,
    upsert: async ({ where, create, update }: { where: { productName: string }; create: Omit<FakeCatalogPrisma['products'] extends Map<string, infer Value> ? Value : never, 'id'>; update: Partial<Omit<FakeCatalogPrisma['products'] extends Map<string, infer Value> ? Value : never, 'id'>> }) => {
      this.productUpserts += 1;
      const existing = this.products.get(where.productName);
      const value = existing
        ? { ...existing, ...update }
        : { id: this.nextProductId++, ...create };
      this.products.set(where.productName, value);
      return value;
    },
    count: async ({ where }: Parameters<CatalogSeedClient['product']['count']>[0]) => [...this.products.values()].filter((product) =>
      where.productName.in.includes(product.productName)
      && product.isActive === where.isActive
      && product.userId === where.userId,
    ).length,
  };

  productVariant = {
    findUnique: async ({ where }: { where: { productId_variantLabel: { productId: bigint; variantLabel: string } } }) =>
      this.variants.get(`${where.productId_variantLabel.productId}:${where.productId_variantLabel.variantLabel}`) ?? null,
    upsert: async ({ where, create, update }: { where: { productId_variantLabel: { productId: bigint; variantLabel: string } }; create: Omit<FakeCatalogPrisma['variants'] extends Map<string, infer Value> ? Value : never, 'id'>; update: Partial<Omit<FakeCatalogPrisma['variants'] extends Map<string, infer Value> ? Value : never, 'id'>> }) => {
      this.variantUpserts += 1;
      const key = `${where.productId_variantLabel.productId}:${where.productId_variantLabel.variantLabel}`;
      const existing = this.variants.get(key);
      const value = existing
        ? { ...existing, ...update }
        : { id: this.nextVariantId++, ...create };
      this.variants.set(key, value);
      return value;
    },
    count: async ({ where }: Parameters<CatalogSeedClient['productVariant']['count']>[0]) => [...this.variants.values()].filter((variant) =>
      variant.isActive === where.isActive
      && where.OR.some((candidate) => {
        const product = [...this.products.values()].find((item) => item.id === variant.productId);
        return candidate.productId === variant.productId
          && candidate.variantLabel === variant.variantLabel
          && product?.isActive === candidate.product.is.isActive
          && product?.userId === candidate.product.is.userId;
      }),
    ).length,
  };

  async $transaction<T>(callback: (transaction: CatalogSeedTransaction) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return callback(this);
  }
}

describe('catalog seed normalization', () => {
  it('normalizes catalog families and variants deterministically regardless of source order', () => {
    const source = [
      row({ id: 2, product_name: 'Herbal Tea', point_value: 80, aliases: ['mint', 'tea'], variant_id: 12, variant_label: '20 bags', variant_display_shortcut: '20', variant_point_value: 80, variant_aliases: ['twenty bags'] }),
      row({ id: 3, product_name: ' Vitamin C ', point_value: 30, aliases: ['vitamin'], variant_id: null, variant_label: null, variant_display_shortcut: null, variant_point_value: null, variant_aliases: [] }),
      row(),
    ];

    const normalized = normalizeCatalog(source);

    expect(normalizeCatalog([...source].reverse())).toEqual(normalized);
    expect(normalized.products).toEqual([
      {
        key: 'Herbal Tea',
        productName: 'Herbal Tea',
        category: 'ヘルスケア',
        pointValue: 80,
        nicknames: ['mint', 'tea'],
        variants: [
          { key: 'Herbal Tea\u000010 bags', variantLabel: '10 bags', displayShortcut: '10', pointValue: 120, nicknames: ['ten bags'] },
          { key: 'Herbal Tea\u000020 bags', variantLabel: '20 bags', displayShortcut: '20', pointValue: 80, nicknames: ['twenty bags'] },
        ],
      },
      {
        key: 'Vitamin C',
        productName: 'Vitamin C',
        category: 'ヘルスケア',
        pointValue: 30,
        nicknames: ['vitamin'],
        variants: [],
      },
    ]);
  });

  it('merges matching duplicate variants but rejects conflicting variants with the same logical key', () => {
    const duplicate = row({ aliases: ['tea', 'mint'], variant_aliases: ['ten bags', 'ten'] });
    const merged = normalizeCatalog([row(), duplicate]);

    expect(merged.products[0]?.nicknames).toEqual(['mint', 'tea']);
    expect(merged.products[0]?.variants[0]?.nicknames).toEqual(['ten', 'ten bags']);
    expect(() => normalizeCatalog([row(), row({ category: '化粧品' })])).toThrow('conflicting category');
    expect(() => normalizeCatalog([row(), row({ point_value: 125, variant_point_value: 125 })])).toThrow('conflicting variant');
  });

  it('fails closed when a source row is malformed or its variant fields are incomplete', () => {
    expect(() => normalizeCatalog({ rows: [] })).toThrow('catalog source must be an array');
    expect(() => normalizeCatalog([row({ scope: 'private' })])).toThrow('scope must be global');
    expect(() => normalizeCatalog([row({ variant_id: null })])).toThrow('variant fields must be all present or all null');
    expect(() => normalizeCatalog([row({ aliases: ['tea', 4] as unknown as string[] })])).toThrow('aliases must contain only strings');
    expect(() => normalizeCatalog([row({ product_name: 'Herbal\u0000Tea' })])).toThrow('must not contain U+0000');
  });
});

describe('catalog seed execution', () => {
  it('loads dotenv quietly before importing Prisma', async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const order: string[] = [];
    delete process.env.DATABASE_URL;

    try {
      const module = await loadCatalogSeedPrisma(
        (options) => {
          expect(options).toEqual({ quiet: true });
          order.push('environment');
          process.env.DATABASE_URL = 'postgresql://seed-test.invalid/sugi';
        },
        async () => {
          if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL was not loaded first');
          order.push('prisma');
          return { prisma: 'loaded-after-environment' };
        },
      );

      expect(module).toEqual({ prisma: 'loaded-after-environment' });
      expect(order).toEqual(['environment', 'prisma']);
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('uses stable logical upsert keys and is idempotent without deleting unrelated rows', async () => {
    const catalog = normalizeCatalog([
      row(),
      row({ id: 2, product_name: 'Herbal Tea', point_value: 80, aliases: ['mint'], variant_id: 12, variant_label: '20 bags', variant_display_shortcut: '20', variant_point_value: 80, variant_aliases: ['twenty bags'] }),
      row({ id: 3, product_name: 'Vitamin C', point_value: 30, aliases: ['vitamin'], variant_id: null, variant_label: null, variant_display_shortcut: null, variant_point_value: null, variant_aliases: [] }),
    ]);
    const prisma = new FakeCatalogPrisma();
    prisma.products.set('Unrelated product', { id: 90n, productName: 'Unrelated product', category: 'Other', pointValue: 1, nicknames: [], isActive: true, userId: null });
    prisma.products.set('Inactive unrelated product', { id: 91n, productName: 'Inactive unrelated product', category: 'Other', pointValue: 1, nicknames: [], isActive: false, userId: null });
    prisma.variants.set('90:unrelated', { id: 90n, productId: 90n, variantLabel: 'unrelated', displayShortcut: null, unitCount: 1, pointValue: 1, nicknames: [], isActive: true });
    prisma.variants.set('91:inactive', { id: 91n, productId: 91n, variantLabel: 'inactive', displayShortcut: null, unitCount: 1, pointValue: 1, nicknames: [], isActive: false });

    const first = await seedCatalog(prisma, catalog);
    const firstProductUpserts = prisma.productUpserts;
    const firstVariantUpserts = prisma.variantUpserts;
    const second = await seedCatalog(prisma, catalog);

    expect(catalog.products.map((product) => [product.key, ...product.variants.map((variant) => variant.key)])).toEqual([
      ['Herbal Tea', 'Herbal Tea\u000010 bags', 'Herbal Tea\u000020 bags'],
      ['Vitamin C'],
    ]);
    expect(first).toEqual({ products: { inserted: 2, updated: 0, skipped: 0, total: 2 }, variants: { inserted: 2, updated: 0, skipped: 0, total: 2 } });
    expect(second).toEqual({ products: { inserted: 0, updated: 0, skipped: 2, total: 2 }, variants: { inserted: 0, updated: 0, skipped: 2, total: 2 } });
    expect(prisma.productUpserts).toBe(firstProductUpserts);
    expect(prisma.variantUpserts).toBe(firstVariantUpserts);
    expect(prisma.transactions).toBe(4);
    expect(prisma.products.has('Unrelated product')).toBe(true);
  });

  it('rejects a catalog key that collides with a user-owned product', async () => {
    const prisma = new FakeCatalogPrisma();
    prisma.products.set('Herbal Tea', { id: 55n, productName: 'Herbal Tea', category: 'ヘルスケア', pointValue: 120, nicknames: ['tea'], isActive: true, userId: 9n });

    await expect(seedCatalog(prisma, normalizeCatalog([row()]))).rejects.toThrow('catalog product is not global');
    expect(prisma.productUpserts).toBe(0);
  });

  it('formats only aggregate seed counts and totals', () => {
    expect(formatCatalogSeedSummary({
      products: { inserted: 2, updated: 1, skipped: 0, total: 3 },
      variants: { inserted: 4, updated: 0, skipped: 1, total: 5 },
    })).toBe('catalog seed products inserted=2 updated=1 skipped=0 total=3\ncatalog seed variants inserted=4 updated=0 skipped=1 total=5');
  });
});
