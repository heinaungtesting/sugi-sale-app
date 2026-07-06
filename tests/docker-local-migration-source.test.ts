import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Docker local migration bootstrap', () => {
  const migrateSource = readFileSync(join(process.cwd(), 'scripts/migrate.ts'), 'utf8');

  it('creates the base Sugi tables before campaign tables reference them', () => {
    const productsCreate = migrateSource.indexOf('CREATE TABLE IF NOT EXISTS products');
    const variantsCreate = migrateSource.indexOf('CREATE TABLE IF NOT EXISTS product_variants');
    const salesCreate = migrateSource.indexOf('CREATE TABLE IF NOT EXISTS sales_logs');
    const campaignItemsCreate = migrateSource.indexOf('CREATE TABLE IF NOT EXISTS sugi_point_campaign_items');

    expect(productsCreate).toBeGreaterThan(-1);
    expect(variantsCreate).toBeGreaterThan(productsCreate);
    expect(salesCreate).toBeGreaterThan(variantsCreate);
    expect(campaignItemsCreate).toBeGreaterThan(salesCreate);
  });

  it('keeps computed sale totals for quantity and point edits', () => {
    expect(migrateSource).toContain('total_points INTEGER GENERATED ALWAYS AS (quantity * points_per_item) STORED');
  });
});
