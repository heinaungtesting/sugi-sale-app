import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = () => readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

describe('sales UI visual consistency', () => {
  it('uses one teal product layer instead of mixing separate page systems', () => {
    const source = css();
    expect(source).not.toMatch(/#(?:8b5cf6|3b82f6|7c3aed|c026d3|2563eb|4f46e5|eef2ff|dbeafe)/i);
    expect(source).toMatch(/--sales-accent:/);
    expect(source).toContain('.page-card');
  });

  it('removes metric-chip dashboard noise from the calendar page', () => {
    const source = css();
    expect(source).not.toContain('summary-chip');
    expect(source).not.toContain('sales-summary-strip');
  });

  it('does not mix Quick add copy with Add product copy', () => {
    const client = readFileSync(join(process.cwd(), 'components/SalesCalendarClient.tsx'), 'utf8');
    expect(client).not.toContain('Quick add');
    expect(client).not.toContain('+ Add product');
  });
});
