import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pageSource = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8');

describe('home page product logger layout', () => {
  it('does not render the old categories fallback UI on the main page', () => {
    expect(pageSource).not.toContain('Categories fallback');
    expect(pageSource).not.toContain('category-grid');
    expect(pageSource).not.toContain('/category/');
  });
});
