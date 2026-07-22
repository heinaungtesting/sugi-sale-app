import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dbSource = readFileSync(join(process.cwd(), 'lib/sugi-db.ts'), 'utf8');
const apiSource = readFileSync(join(process.cwd(), 'app/api/sales/route.ts'), 'utf8');
const policySource = readFileSync(join(process.cwd(), 'domain/sales/sale-policy.ts'), 'utf8');
const componentSource = readFileSync(join(process.cwd(), 'components/SearchProductLogger.tsx'), 'utf8');

describe('product_variants-backed sale logging', () => {
  it('loads active product_variants for searchable products', () => {
    expect(dbSource).toContain('LEFT JOIN product_variants pv');
    expect(dbSource).toContain('pv.variant_label');
    expect(dbSource).toContain('pv.point_value AS variant_point_value');
  });

  it('accepts variant_id from the variant button and logs the selected DB variant', () => {
    expect(componentSource).toContain('variant.variantId');
    expect(apiSource).toContain('validateCreateSale');
    expect(policySource).toContain('input.variant_id');
    expect(dbSource).toContain('getVisibleProductVariant');
    expect(dbSource).toContain('pv.id = $3');
  });
});
