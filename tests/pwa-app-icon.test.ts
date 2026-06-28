import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PUBLIC = join(process.cwd(), 'public');

describe('pwa app icon roll-out', () => {
  it('ships all standard PWA + apple + favicon icon assets', () => {
    const required = [
      'icon.png',           // master 512
      'icon-192.png',       // PWA standard
      'icon-512.png',       // PWA standard + maskable
      'apple-touch-icon.png', // iOS 180
      'favicon-32.png',     // browser tab
      'favicon-16.png',     // browser tab
    ];
    for (const f of required) {
      const path = join(PUBLIC, f);
      expect(existsSync(path), `missing icon: ${f}`).toBe(true);
      const size = statSync(path).size;
      expect(size, `${f} suspiciously small (${size}B)`).toBeGreaterThan(200);
    }
  });

  it('declares the 192 + 512 icons in manifest.json with maskable purpose', () => {
    const manifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.json'), 'utf8'));
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    const sizes = manifest.icons.map((i: any) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    // PWA install on Android wants at least one maskable icon
    const hasMaskable = manifest.icons.some((i: any) =>
      (i.purpose ?? '').includes('maskable')
    );
    expect(hasMaskable, 'manifest should declare at least one maskable icon').toBe(true);
  });

  it('links icons from the Next.js layout via metadata.icons', () => {
    const layout = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8');
    expect(layout).toContain("'/icon-192.png'");
    expect(layout).toContain("'/apple-touch-icon.png'");
    expect(layout).toContain("'/favicon-32.png'");
  });
});