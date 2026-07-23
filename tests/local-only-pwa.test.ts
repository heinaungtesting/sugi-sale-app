import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const source = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('local-only offline PWA contract', () => {
  it('ships a static local-only route backed by a client component', () => {
    expect(existsSync(join(ROOT, 'app/local/page.tsx'))).toBe(true);
    expect(existsSync(join(ROOT, 'components/LocalOnlyApp.tsx'))).toBe(true);
    const page = source('app/local/page.tsx');
    expect(page).toContain('<LocalOnlyApp />');
    expect(page).not.toContain('currentUser');
    expect(page).not.toContain('sugi-db');
  });

  it('stores profile, sales, and custom products only in IndexedDB', () => {
    expect(existsSync(join(ROOT, 'lib/local-only-db.ts'))).toBe(true);
    const db = source('lib/local-only-db.ts');
    expect(db).toContain("const DB_NAME = 'sugi-local-only-v1'");
    expect(db).toContain("createObjectStore('profile'");
    expect(db).toContain("createObjectStore('sales'");
    expect(db).toContain("createObjectStore('customProducts'");
    expect(db).toContain('indexedDB.open');
    expect(db).not.toContain('fetch(');
    expect(db).not.toContain('/api/');
  });

  it('never sends local user data to server APIs', () => {
    const app = source('components/LocalOnlyApp.tsx');
    expect(app).not.toContain('fetch(');
    expect(app).not.toContain('/api/');
    expect(app).not.toContain('sale-queue');
    expect(app).not.toContain('sendBeacon');
    expect(app).toContain('端末内だけに保存');
    expect(app).toContain('バックアップを書き出す');
    expect(app).toContain('バックアップを読み込む');
  });

  it('bundles the non-user product catalog instead of requesting it', () => {
    expect(existsSync(join(ROOT, 'data/local-product-catalog.json'))).toBe(true);
    const app = source('components/LocalOnlyApp.tsx');
    expect(app).toContain("import productCatalog from '@/data/local-product-catalog.json'");
    expect(app).not.toContain('/api/products');
  });

  it('keeps every bundled product reachable with progressive mobile disclosure', () => {
    const app = source('components/LocalOnlyApp.tsx');
    expect(app).toContain('LOCAL_PRODUCT_PAGE_SIZE = 12');
    expect(app).toContain('allFamilies');
    expect(app).toContain('visibleFamilyLimit');
    expect(app).toContain('allProducts.length');
    expect(app).toContain('もっと見る');
    expect(app).toContain('全{allFamilies.length}件中');
  });

  it('launches installed PWA into local-only mode and precaches it', () => {
    const manifest = JSON.parse(source('public/manifest.json'));
    const worker = source('public/sw.js');
    expect(manifest.id).toBe('/local');
    expect(manifest.start_url).toBe('/local');
    expect(manifest.scope).toBe('/');
    expect(worker).toContain("const CACHE_VERSION = 'sugi-pwa-v20'");
    expect(worker).toContain("setTimeout(() => {");
    expect(worker).toContain("self.clients.matchAll({ type: 'window' })");
    expect(worker).toContain('client.navigate(client.url)');
    expect(worker).toContain("const LOCAL_URL = '/local'");
    expect(worker).toContain('LOCAL_URL');
    expect(worker).toContain("event.data?.type === 'CACHE_APP_SHELL'");
  });

  it('does not depend on remote fonts or development cross-origin bypasses', () => {
    const css = source('app/globals.css');
    const config = source('next.config.ts');
    expect(css).not.toContain('fonts.googleapis.com');
    expect(config).toContain("allowedDevOrigins: ['herme-agents.tail71ac56.ts.net']");
  });

  it('displays point values for daily totals, product choices, and sale rows', () => {
    const app = source('components/LocalOnlyApp.tsx');
    expect(app).toContain('今日のポイント');
    expect(app).toContain('today.totalPoints.toLocaleString()');
    expect(app).toContain('variant.pointValue.toLocaleString()');
    expect(app).toContain('(sale.pointsPerItem * sale.quantity).toLocaleString()');
  });

  it('warns that clearing browser data deletes local records', () => {
    const app = source('components/LocalOnlyApp.tsx');
    expect(app).toContain('ブラウザのデータを消すと記録も消えます');
  });

  it('keeps local products visible and provides edit/delete management', () => {
    const app = source('components/LocalOnlyApp.tsx');
    const db = source('lib/local-only-db.ts');
    expect(app).toContain('const localFamilies = groupProductsIntoFamilies(customCatalog(customProducts), allProducts.length)');
    expect(app).toContain('return [...localFamilies, ...bundledFamilies]');
    expect(app).toContain('追加した商品');
    expect(app).toContain('ローカル商品を編集');
    expect(app).toContain('removeCustomProduct');
    expect(db).toContain('updateCustomProduct');
    expect(db).toContain('deleteCustomProduct');
  });

  it('includes the beta-test UX and accessibility fixes', () => {
    const app = source('components/LocalOnlyApp.tsx');
    const css = source('app/globals.css');
    expect(app).toContain('該当する商品がありません');
    expect(app).toContain('検索をクリア');
    expect(app).toContain('バックアップを書き出しました');
    expect(app).toContain('id="local-product-name" name="productName"');
    expect(app).toContain('id="local-product-points" name="productPoints"');
    expect(css).toContain('.local-nav button { min-height: 48px;');
    expect(css).toContain('--text-choco-soft: #765e47;');
  });
});
