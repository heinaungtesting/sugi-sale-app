import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const source = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('installable offline PWA', () => {
  it('registers a same-origin service worker from the root layout', () => {
    expect(existsSync(join(ROOT, 'components/PWAInstall.tsx'))).toBe(true);
    const component = source('components/PWAInstall.tsx');
    const layout = source('app/layout.tsx');

    expect(component).toContain("navigator.serviceWorker.register('/sw.js')");
    expect(component).toContain("navigator.serviceWorker.addEventListener('controllerchange'");
    expect(component).toContain("sessionStorage.getItem('sugi-sw-controller-reloaded')");
    expect(component).toContain('window.location.reload()');
    expect(component).toContain("window.addEventListener('beforeinstallprompt'");
    expect(component).toContain('prompt()');
    expect(layout).toContain("import PWAInstall from '@/components/PWAInstall'");
    expect(layout).toContain('<PWAInstall />');
  });

  it('ships an offline fallback and never caches API responses', () => {
    expect(existsSync(join(ROOT, 'public/sw.js'))).toBe(true);
    expect(existsSync(join(ROOT, 'app/offline/page.tsx'))).toBe(true);
    const worker = source('public/sw.js');

    expect(worker).toContain("const OFFLINE_URL = '/offline'");
    expect(worker).toContain("url.pathname.startsWith('/api/')");
    expect(worker).toContain('event.request.mode === \'navigate\'');
    expect(worker).toContain("caches.match(OFFLINE_URL)");
    expect(worker).toContain("url.pathname === '/'");
    expect(worker).toContain('response.status >= 500');
    expect(worker).toContain('controller.abort()');
    expect(worker).toContain('signal: controller.signal');
  });

  it('declares a stable install identity and root scope in the manifest', () => {
    const manifest = JSON.parse(source('public/manifest.json'));
    expect(manifest.id).toBe('/local');
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toBe('/local');
    expect(manifest.display).toBe('standalone');
  });

  it('provides Japanese install and iOS home-screen guidance', () => {
    const component = source('components/PWAInstall.tsx');
    expect(component).toContain('アプリをインストール');
    expect(component).toContain('ホーム画面に追加');
    expect(component).toContain('display-mode: standalone');
  });
});
