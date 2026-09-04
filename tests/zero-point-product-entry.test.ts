import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('zero-point product sale entry', () => {
  it('asks for and saves points before queueing a calendar sale', () => {
    const calendar = source('components/SalesCalendarClient.tsx');

    expect(calendar).toContain('if (variant.pointValue <= 0)');
    expect(calendar).toContain('setEditingVariant(variant)');
    expect(calendar).toContain("csrfFetch('/api/products'");
    expect(calendar).toContain("method: 'PATCH'");
    expect(calendar).toContain('point_value: points');
    expect(calendar).toContain('if (!response?.ok)');
    expect(calendar).toContain('addProductToSelectedDate(savedVariant, points)');
    expect(calendar).toContain('role="dialog"');
    expect(calendar).toContain('aria-modal="true"');
  });

  it('asks for and saves points before queueing a category sale', () => {
    const list = source('components/ProductTapList.tsx');

    expect(list).toContain('if (pointValueFor(product) <= 0)');
    expect(list).toContain('setEditingProduct(product)');
    expect(list).toContain("csrfFetch('/api/products'");
    expect(list).toContain("method: 'PATCH'");
    expect(list).toContain('point_value: points');
    expect(list).toContain('if (!response?.ok)');
    expect(list).toContain('log(savedProduct, points)');
    expect(list).toContain('role="dialog"');
    expect(list).toContain('aria-modal="true"');
  });

  it('keeps invalid point values out of both save-and-log paths', () => {
    for (const path of ['components/SalesCalendarClient.tsx', 'components/ProductTapList.tsx']) {
      const component = source(path);
      expect(component).toContain("normalize('NFKC').trim()");
      expect(component).toContain('!Number.isInteger(points) || points <= 0 || points > 9999');
    }
  });
});
