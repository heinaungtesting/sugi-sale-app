import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

describe('mobile sale logger product grid CSS', () => {
  it('renders product family cards as a compact two-column grid', () => {
    expect(css).toContain('.family-list');
    expect(css).toMatch(/\.family-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
    expect(css).toMatch(/\.family-card\s*\{[^}]*padding:\s*10px/s);
    expect(css).toMatch(/\.family-card h3\s*\{[^}]*font-size:\s*15px/s);
  });

  it('keeps variant shortcuts smaller but still finger touchable', () => {
    expect(css).toMatch(/\.variant-button\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/\.variant-button\s*\{[^}]*font-size:\s*16px/s);
    expect(css).toMatch(/\.variant-grid\s*\{[^}]*gap:\s*6px/s);
  });
});
