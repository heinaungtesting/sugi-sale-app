import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pageSource = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8');
const searchLoggerSource = readFileSync(join(process.cwd(), 'components/SearchProductLogger.tsx'), 'utf8');
const appHeaderSource = readFileSync(join(process.cwd(), 'components/AppHeader.tsx'), 'utf8');
const globalsCss = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

describe('home page product logger layout', () => {
  it('does not render the old categories fallback UI on the main page', () => {
    expect(pageSource).not.toContain('Categories fallback');
    expect(pageSource).not.toContain('category-grid');
    expect(pageSource).not.toContain('/category/');
  });

  it('does not tell users to browse categories when no search result exists', () => {
    expect(searchLoggerSource).not.toContain('Try category browse below');
  });

  it('removes the generic shift title and highlights the active user name in the header', () => {
    expect(appHeaderSource).not.toContain('シフト記録');
    expect(appHeaderSource).not.toContain('Shift logger');
    expect(appHeaderSource).not.toContain('<h1>{t.title}</h1>');
    expect(appHeaderSource).toContain('user-name-highlight');
    expect(globalsCss).toContain('.user-name-highlight');
  });
});
