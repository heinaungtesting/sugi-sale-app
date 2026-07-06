import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('point update activity visibility source contract', () => {
  it('logs admin product, variant, and bulk point changes with visible pt summaries', () => {
    const productRoute = source('app/api/admin/products/route.ts');
    const variantRoute = source('app/api/admin/variants/route.ts');
    const bulkRoute = source('app/api/admin/points/route.ts');

    expect(productRoute).toContain('point_value}pt');
    expect(productRoute).toContain('admin_product_point_updated');

    expect(variantRoute).toContain('logActivity');
    expect(variantRoute).toContain('admin_variant_point_updated');
    expect(variantRoute).toContain('point_value}pt');

    expect(bulkRoute).toContain('logActivity');
    expect(bulkRoute).toContain('admin_bulk_points_updated');
    expect(bulkRoute).toContain('pt更新');
  });

  it('logs user-side sale point corrections so User activity immediately shows corrected points', () => {
    const salesPatchRoute = source('app/api/sales/[id]/route.ts');

    expect(salesPatchRoute).toContain('logActivity');
    expect(salesPatchRoute).toContain('sale_points_corrected');
    expect(salesPatchRoute).toContain('pointValue}pt');
  });
});
