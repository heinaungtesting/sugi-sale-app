import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const seedSource = readFileSync(join(process.cwd(), 'scripts/seed-fetias-products.ts'), 'utf8');

describe('Fetias product seed data', () => {
  it('seeds known loggable patch variants with their confirmed point values', () => {
    expect(seedSource).toContain("product_name: 'フェイタスZα ジクサス 7枚'");
    expect(seedSource).toContain('point_value: 80');
    expect(seedSource).toContain("product_name: 'フェイタスZα ジクサス 14枚'");
    expect(seedSource).toContain('point_value: 120');
  });
});
