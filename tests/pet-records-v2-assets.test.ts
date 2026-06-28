import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ASSETS_DIR = join(process.cwd(), 'public/cute');

const V2_HEADS = [
  'v2-head-dog-excited.webp',
  'v2-head-dog-grumpy.webp',
  'v2-head-dog-thumbsup.webp',
  'v2-head-dog-eating.webp',
  'v2-head-dog-sleeping.webp',
  'v2-head-dog-singing.webp',
  'v2-head-dog-surprise.webp',
  'v2-head-dog-confused.webp',
  'v2-head-cat-dizzy.webp',
  'v2-head-cat-crying.webp',
  'v2-head-cat-highfive.webp',
  'v2-head-cat-drinking.webp',
  'v2-head-cat-winking.webp',
  'v2-head-cat-grinning.webp',
  'v2-head-cat-pensive.webp',
  'v2-head-cat-fish.webp',
];

const V2_CLUSTERS = [
  'v2-playtime-yarn-cat.webp',
  'v2-playtime-bone-dog.webp',
  'v2-admin-record-review.webp',
  'v2-admin-approved.webp',
  'v2-accessories.webp',
  'v2-flowers.webp',
  'v2-record-items.webp',
  'v2-paws-light.webp',
  'v2-paws-brown.webp',
  'v2-treats.webp',
];

describe('pet-records v2 asset roll-out', () => {
  it('ships all 12 v2 expressive head icons + 4 v2 pose clusters + 6 v2 details clusters', () => {
    for (const filename of [...V2_HEADS, ...V2_CLUSTERS]) {
      const path = join(ASSETS_DIR, filename);
      expect(existsSync(path), `missing asset: ${filename}`).toBe(true);
      const size = statSync(path).size;
      // Decorative assets should not be tiny placeholders.
      expect(size, `asset suspiciously small: ${filename} (${size}B)`).toBeGreaterThan(800);
    }
  });

  it('routes v2 assets through globals.css at expected decorative surfaces', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    // nav-pet icons now use v1 individual icons (cleaner)
    expect(css).toContain("url('/cute/v1-icon-tan-dog.webp')");
    expect(css).toContain("url('/cute/v1-icon-gray-cat.webp')");
    // metric-mascot uses v2 head icons
    expect(css).toContain("url('/cute/v2-head-dog-excited.webp')");
    expect(css).toContain("url('/cute/v2-head-cat-dizzy.webp')");
    // search peek uses playtime yarn-cat
    expect(css).toContain("url('/cute/v2-playtime-yarn-cat.webp')");
    // login dressing uses playtime bone-dog
    expect(css).toContain("url('/cute/v2-playtime-bone-dog.webp')");
    // admin page (not css) uses admin-record-review
    expect(css).toContain("url('/cute/v2-playtime-bone-dog.webp')");
    // toast success/fail use head icons
    expect(css).toContain("url('/cute/v2-head-dog-thumbsup.webp')");
    expect(css).toContain("url('/cute/v2-head-dog-grumpy.webp')");
    // empty-state paws
    expect(css).toContain("url('/cute/v2-paws-light.webp')");
    expect(css).toContain("url('/cute/v2-paws-brown.webp')");
    // flowers + treats decoration
    expect(css).toContain("url('/cute/v2-flowers.webp')");
    expect(css).toContain("url('/cute/v2-treats.webp')");
  });

  it('does not point nav-pet or metric-mascot at the old broken assets', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    // The old dog-icon.webp and cat-icon.webp were badly cropped head-icon thumbnails.
    // They should no longer be referenced from any layout rule that drives a visible mascot.
    const banned = ['/cute/dog-icon.webp', '/cute/cat-icon.webp', '/cute/search-cat.webp',
                    '/cute/stat-dog.webp', '/cute/stat-cat.webp'];
    for (const b of banned) {
      expect(css, `stale asset reference: ${b}`).not.toContain(`url('${b}')`);
    }
  });

  it('points admin page hero at v2-admin-record-review.webp', () => {
    const adminPage = readFileSync(join(process.cwd(), 'app/admin/page.tsx'), 'utf8');
    expect(adminPage).toContain('v2-admin-record-review.webp');
    expect(adminPage).toContain('admin-hero-record-review');
  });

  it('tags SearchProductLogger toast with success/error class for icon swap', () => {
    const logger = readFileSync(join(process.cwd(), 'components/SearchProductLogger.tsx'), 'utf8');
    expect(logger).toContain('toast-error');
    expect(logger).toContain('toast-success');
    expect(logger).toContain('t.quickAddError === toast');
  });

  it('keeps decorative assets pointer-events:none so taps still register on buttons', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    // At minimum the new v2 additions should explicitly opt out of pointer events.
    expect(css).toMatch(/search-peek-cat[\s\S]*?pointer-events:\s*none/);
    // The login decoration also opts out.
    expect(css).toMatch(/\.login-card::after\s*{[^}]*pointer-events:\s*none/s);
  });
});