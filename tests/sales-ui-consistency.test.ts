import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = () => readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

describe('sales UI visual consistency', () => {
  it('uses one sales accent family instead of mixing purple and teal systems', () => {
    const salesCss = css().split('/* Sales page v2: reference-style mobile calendar */')[1] ?? '';
    expect(salesCss).not.toMatch(/#(?:8b5cf6|3b82f6|7c3aed|c026d3|2563eb|4f46e5|eef2ff|dbeafe)/i);
    expect(salesCss).toMatch(/--sales-accent:/);
  });

  it('keeps all metric chips visually equal instead of one oversized filled chip', () => {
    const salesCss = css().split('/* Sales page v2: reference-style mobile calendar */')[1] ?? '';
    expect(salesCss).not.toMatch(/\.summary-chip\.primary\s*{[^}]*linear-gradient/s);
    expect(salesCss).not.toMatch(/\.summary-chip\.primary\s*{[^}]*inset/s);
    expect(salesCss).toMatch(/\.summary-chip\.primary\s*{[^}]*background:\s*var\(--sales-chip-bg\)/s);
  });

  it('does not mix Quick add copy with Add product copy', () => {
    const client = readFileSync(join(process.cwd(), 'components/SalesCalendarClient.tsx'), 'utf8');
    expect(client).toContain('+ Add product');
    expect(client).not.toContain('Quick add');
  });
});
