import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('product point update sync source contract', () => {
  it('uses a shared catalog sync helper for admin product, admin variant, bulk, and user sale point corrections', () => {
    const adminDb = source('lib/sugi-admin-db.ts');
    const saleDb = source('lib/sugi-db.ts');
    const sync = source('lib/sugi-point-sync.ts');

    expect(adminDb).toContain('syncProductPointValue');
    expect(adminDb).toContain('syncVariantPointValue');
    expect(saleDb).toContain('syncProductPointValue');
    expect(saleDb).toContain('syncVariantPointValueBySaleName');

    expect(sync).toContain('export async function syncProductPointValue');
    expect(sync).toContain('export async function syncVariantPointValue');
    expect(sync).toContain('export async function syncVariantPointValueBySaleName');
  });

  it('syncs duplicate flat products and family variants by normalized product/variant names', () => {
    const sync = source('lib/sugi-point-sync.ts');

    expect(sync).toContain('regexp_replace(lower(product_name),');
    expect(sync).toContain("p.product_name || ' ' || pv.variant_label");
    expect(sync).toContain("p.product_name || ' ' || COALESCE(NULLIF(pv.display_shortcut, ''), pv.variant_label)");
    expect(sync).toContain('UPDATE products SET point_value = $1');
    expect(sync).toContain('UPDATE product_variants SET point_value = $1');
  });
});
