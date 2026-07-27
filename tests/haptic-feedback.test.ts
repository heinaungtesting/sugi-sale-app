import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { triggerTapHaptic } from '../lib/haptics';

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), 'utf8');
const originalNavigator = globalThis.navigator;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });
});

describe('product tap haptic feedback', () => {
  it('requests one crisp 50ms vibration when supported', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { vibrate },
    });

    triggerTapHaptic();

    expect(vibrate).toHaveBeenCalledOnce();
    expect(vibrate).toHaveBeenCalledWith([50]);
  });

  it('is a safe no-op when vibration is unavailable', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
    });

    expect(() => triggerTapHaptic()).not.toThrow();
  });

  it('does not break sale logging if the browser rejects vibration', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { vibrate: () => { throw new Error('blocked'); } },
    });

    expect(() => triggerTapHaptic()).not.toThrow();
  });
});

describe('sale buttons expose a 250ms visual lock', () => {
  it.each([
    'components/SearchProductLogger.tsx',
    'components/SalesCalendarClient.tsx',
    'components/ProductTapList.tsx',
    'components/LocalOnlyApp.tsx',
  ])('%s triggers haptics and exposes the debounce state', (path) => {
    const component = source(path);
    expect(component).toContain('triggerTapHaptic()');
    expect(component).toContain('aria-busy={isDebouncing}');
  });

  it('keeps the tapped button depressed and distinctly colored during debounce', () => {
    const css = source('app/globals.css');
    expect(css).toContain('.sale-tap-button[aria-busy="true"]');
    expect(css).toMatch(/\.sale-tap-button\[aria-busy="true"\][^{]*\{[^}]*transform:\s*scale\(\.94\)/s);
    expect(css).toMatch(/\.sale-tap-button\[aria-busy="true"\][^{]*\{[^}]*background:\s*#f0b85a/s);
  });
});
