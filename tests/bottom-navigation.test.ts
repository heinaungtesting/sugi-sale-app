import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('mobile bottom navigation', () => {
  it('renders the main navigation outside the visual header as a bottom tab bar', () => {
    const header = source('components/AppHeader.tsx');
    expect(header).toContain('className="nav bottom-nav"');
    expect(header).not.toContain('className="nav hero-nav"');
    expect(header).toContain('aria-current={activePage ===');
    expect(header.indexOf('</header>')).toBeLessThan(header.indexOf('className="nav bottom-nav"'));
  });

  it('fixes the tabs to the bottom and reserves iPhone safe-area space', () => {
    const css = source('app/globals.css');
    expect(css).toMatch(/\.nav\.bottom-nav\s*{[^}]*position:\s*fixed/s);
    expect(css).toMatch(/\.nav\.bottom-nav\s*{[^}]*bottom:\s*0/s);
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('body:has(.bottom-nav) .shell');
    expect(css).toMatch(/\.nav\.bottom-nav a\s*{[^}]*min-height:\s*58px/s);
    expect(css).toContain('.nav.bottom-nav a:focus-visible');
  });

  it('uses a lively floating-dock treatment without sacrificing reduced-motion support', () => {
    const css = source('app/globals.css');
    expect(css).toContain('.nav.bottom-nav::before');
    expect(css).toContain('.nav.bottom-nav a[aria-current="page"] .nav-pet');
    expect(css).toContain('@keyframes bottom-nav-pet-bob');
    expect(css).toContain('translateY(-4px)');
    expect(css).toContain('border-radius: 24px');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
