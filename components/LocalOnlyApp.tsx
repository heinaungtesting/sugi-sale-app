'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import productCatalog from '@/data/local-product-catalog.json';
import {
  addCustomProduct,
  addLocalSale,
  clearAllLocalData,
  createLocalBackup,
  deleteCustomProduct,
  deleteLocalSale,
  getLocalProfile,
  listCustomProducts,
  listLocalSales,
  restoreLocalBackup,
  saveLocalProfile,
  updateCustomProduct,
  updateLocalSale,
} from '@/lib/local-only-db';
import {
  summarizeSales,
  tokyoDateKey,
  validateLocalBackup,
  type LocalCustomProduct,
  type LocalProfile,
  type LocalSale,
} from '@/lib/local-only-model';
import {
  groupProductsIntoFamilies,
  rankProductsForSearch,
  type ProductVariant,
  type SearchableProduct,
} from '@/domain/products/search-ranking';
import { triggerTapHaptic } from '@/lib/haptics';

type View = 'home' | 'history' | 'settings';
const staticCatalog = productCatalog as SearchableProduct[];
const TAP_DEBOUNCE_MS = 250;
const LOCAL_PRODUCT_PAGE_SIZE = 12;

function uuid(): string {
  return crypto.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function customCatalog(products: LocalCustomProduct[]): SearchableProduct[] {
  return products.map((product, index) => ({
    id: -100000 - index,
    product_name: product.productName,
    point_value: product.pointValue,
    category: 'ローカル商品',
    scope: 'private',
    aliases: product.aliases,
    sale_count: 0,
  }));
}

export function LocalOnlyApp() {
  const [profile, setProfile] = useState<LocalProfile | null | undefined>(undefined);
  const [sales, setSales] = useState<LocalSale[]>([]);
  const [customProducts, setCustomProducts] = useState<LocalCustomProduct[]>([]);
  const [view, setView] = useState<View>('home');
  const [query, setQuery] = useState('');
  const [visibleFamilyLimit, setVisibleFamilyLimit] = useState(LOCAL_PRODUCT_PAGE_SIZE);
  const [setupName, setSetupName] = useState('');
  const [productName, setProductName] = useState('');
  const [productPoints, setProductPoints] = useState('');
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [recentlyTapped, setRecentlyTapped] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const todayKey = tokyoDateKey();

  async function reloadLocalData() {
    const [nextProfile, nextSales, nextProducts] = await Promise.all([
      getLocalProfile(),
      listLocalSales(),
      listCustomProducts(),
    ]);
    setProfile(nextProfile);
    setSales(nextSales);
    setCustomProducts(nextProducts);
  }

  useEffect(() => {
    void reloadLocalData().catch(() => setNotice('端末内データを読み込めませんでした'));
    void navigator.storage?.persist?.();

    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.ready.then((registration) => {
        const urls = performance.getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => name.startsWith(location.origin))
          .map((name) => new URL(name).pathname);
        registration.active?.postMessage({ type: 'CACHE_APP_SHELL', urls: [...new Set(['/local', ...urls])] });
      });
    }
  }, []);

  const allProducts = useMemo(
    () => [...customCatalog(customProducts), ...staticCatalog],
    [customProducts],
  );
  const allFamilies = useMemo(() => {
    if (query.trim()) {
      const ranked = rankProductsForSearch(allProducts, query, allProducts.length);
      return groupProductsIntoFamilies(ranked, allProducts.length);
    }
    const localFamilies = groupProductsIntoFamilies(customCatalog(customProducts), allProducts.length);
    const bundledFamilies = groupProductsIntoFamilies(
      rankProductsForSearch(staticCatalog, '', staticCatalog.length),
      staticCatalog.length,
    );
    return [...localFamilies, ...bundledFamilies];
  }, [allProducts, customProducts, query]);
  const families = allFamilies.slice(0, visibleFamilyLimit);
  const hiddenFamilyCount = Math.max(0, allFamilies.length - families.length);
  const today = useMemo(() => summarizeSales(sales, todayKey), [sales, todayKey]);

  async function finishSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = setupName.normalize('NFKC').trim();
    if (!displayName) return;
    const next: LocalProfile = { id: 'local', displayName: displayName.slice(0, 80), createdAt: new Date().toISOString() };
    await saveLocalProfile(next);
    setProfile(next);
    setNotice(null);
  }

  async function logVariant(variant: ProductVariant) {
    const tapKey = `${variant.productId}:${variant.variantId ?? 'base'}`;
    if (recentlyTapped === tapKey) return;
    triggerTapHaptic();
    setRecentlyTapped(tapKey);
    window.setTimeout(() => setRecentlyTapped((current) => current === tapKey ? null : current), TAP_DEBOUNCE_MS);
    const now = new Date();
    const sale: LocalSale = {
      id: uuid(),
      productId: tapKey,
      productName: variant.productName,
      quantity: 1,
      pointsPerItem: variant.pointValue,
      createdAt: now.toISOString(),
      saleDate: tokyoDateKey(now),
    };
    await addLocalSale(sale);
    setSales((current) => [sale, ...current]);
    setNotice('端末内に保存しました');
    window.setTimeout(() => setNotice(null), 1200);
  }

  async function changeQuantity(sale: LocalSale, delta: number) {
    const quantity = sale.quantity + delta;
    if (quantity <= 0) {
      await removeSale(sale.id);
      return;
    }
    await updateLocalSale(sale.id, { quantity });
    setSales((current) => current.map((row) => row.id === sale.id ? { ...row, quantity } : row));
  }

  async function removeSale(id: string) {
    await deleteLocalSale(id);
    setSales((current) => current.filter((sale) => sale.id !== id));
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = productName.normalize('NFKC').trim();
    const points = Number(productPoints.normalize('NFKC'));
    if (!name || !Number.isFinite(points) || points <= 0) {
      setNotice('商品名と点数を確認してください');
      return;
    }
    const existing = editingProductId
      ? customProducts.find((product) => product.id === editingProductId)
      : undefined;
    const product: LocalCustomProduct = {
      id: existing?.id ?? uuid(),
      productName: name.slice(0, 120),
      pointValue: Math.round(points),
      aliases: existing?.aliases ?? [],
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    if (existing) {
      await updateCustomProduct(product);
      setCustomProducts((current) => current.map((item) => item.id === product.id ? product : item));
    } else {
      await addCustomProduct(product);
      setCustomProducts((current) => [product, ...current]);
    }
    setProductName('');
    setProductPoints('');
    setEditingProductId(null);
    setNotice(existing ? 'ローカル商品を更新しました' : 'ローカル商品を追加しました');
  }

  function beginProductEdit(product: LocalCustomProduct) {
    setEditingProductId(product.id);
    setProductName(product.productName);
    setProductPoints(String(product.pointValue));
    setNotice(null);
  }

  function cancelProductEdit() {
    setEditingProductId(null);
    setProductName('');
    setProductPoints('');
  }

  async function removeCustomProduct(product: LocalCustomProduct) {
    if (!window.confirm(`「${product.productName}」をこの端末から削除しますか？`)) return;
    await deleteCustomProduct(product.id);
    setCustomProducts((current) => current.filter((item) => item.id !== product.id));
    if (editingProductId === product.id) cancelProductEdit();
    setNotice('ローカル商品を削除しました');
  }

  async function exportBackup() {
    const backup = await createLocalBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sugi-local-backup-${todayKey}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(`バックアップを書き出しました（sugi-local-backup-${todayKey}.json）`);
  }

  async function importBackup(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const validated = validateLocalBackup(parsed);
      if (!validated.ok) throw new Error(validated.error);
      await restoreLocalBackup(validated.backup);
      await reloadLocalData();
      setNotice('バックアップを復元しました');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'バックアップを読み込めませんでした');
    } finally {
      setBusy(false);
    }
  }

  async function resetDeviceData() {
    if (!window.confirm('この端末のプロフィール・商品・販売記録をすべて削除しますか？')) return;
    await clearAllLocalData();
    setProfile(null);
    setSales([]);
    setCustomProducts([]);
    setView('home');
    setQuery('');
    cancelProductEdit();
    setNotice(null);
  }

  if (profile === undefined) {
    return <main className="local-loading" aria-busy="true">端末内データを読み込み中…</main>;
  }

  if (!profile) {
    return (
      <main className="local-onboarding">
        <section className="local-onboarding-card">
          <img src="/icon-192.png" width="92" height="92" alt="Sugi Local Logger" />
          <span className="local-only-badge">LOCAL ONLY</span>
          <h1>Sugi Local Logger</h1>
          <p>プロフィールと販売記録は、この端末内だけに保存されます。サーバーには送信しません。</p>
          <form onSubmit={finishSetup}>
            <label htmlFor="local-display-name">表示名</label>
            <input id="local-display-name" value={setupName} onChange={(event) => setSetupName(event.target.value)} maxLength={80} required autoFocus />
            <button type="submit">この端末で始める</button>
          </form>
          <small>ブラウザのデータを消すと記録も消えます。定期的にバックアップしてください。</small>
        </section>
      </main>
    );
  }

  const visibleSales = view === 'history' ? sales : today.sales.slice(0, 8);

  return (
    <main className="shell local-only-shell">
      <header className="local-header">
        <div className="local-header-top">
          <div><span className="local-only-badge">端末内のみ</span><strong>{profile.displayName}</strong></div>
          <span className="local-status">● ローカル保存</span>
        </div>
        <div className="local-metrics">
          <div className="local-metric"><span>今日の記録</span><strong>{today.totalItems}</strong><small>件</small></div>
          <div className="local-metric local-points-metric"><span>今日のポイント</span><strong>{today.totalPoints.toLocaleString()}</strong><small>pt</small></div>
        </div>
        <nav className="local-nav" aria-label="メインナビゲーション">
          <button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}>記録</button>
          <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>履歴</button>
          <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>設定</button>
        </nav>
      </header>

      {notice ? <div className="local-notice" role="status">{notice}</div> : null}

      {view === 'home' ? (
        <>
          <section className="local-search-card">
            <label htmlFor="local-product-search">商品検索</label>
            <input
              id="local-product-search"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleFamilyLimit(LOCAL_PRODUCT_PAGE_SIZE);
              }}
              placeholder="商品名・別名で検索"
              autoComplete="off"
            />
          </section>
          <section aria-label="商品一覧">
            <div className="section-heading-row"><div><h2>{query.trim() ? '検索結果' : '商品一覧'}</h2><p>タップするとすぐ端末内に記録します。</p></div></div>
            <div className="family-list mostly-used-list">
              {allFamilies.length > 0 ? (
                <div className="local-product-result-count" aria-live="polite">
                  全{allFamilies.length}件中 {families.length}件を表示
                </div>
              ) : null}
              {families.map((family) => (
                <section key={family.name} className="family-card cute-family-card" aria-label={family.name}>
                  <h3>{family.name}</h3>
                  <div className="variant-grid">
                    {family.variants.map((variant) => {
                      const key = `${variant.productId}:${variant.variantId ?? 'base'}`;
                      const label = family.variants.length === 1 && variant.label === '標準' ? '記録' : variant.label;
                      const isDebouncing = recentlyTapped === key;
                      return (
                        <button key={key} className="variant-button sale-tap-button" disabled={isDebouncing} aria-busy={isDebouncing} onClick={() => void logVariant(variant)}>
                          <span>{label}</span>
                          <small>{variant.pointValue.toLocaleString()}pt</small>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {hiddenFamilyCount > 0 ? (
                <button
                  type="button"
                  className="local-product-more"
                  onClick={() => setVisibleFamilyLimit((current) => current + LOCAL_PRODUCT_PAGE_SIZE)}
                >
                  もっと見る（残り{hiddenFamilyCount}件）
                </button>
              ) : null}
              {families.length === 0 ? (
                <div className="local-empty-search" role="status">
                  <strong>該当する商品がありません</strong>
                  <span>商品名を変えるか、設定からローカル商品を追加してください。</span>
                  <button type="button" onClick={() => {
                    setQuery('');
                    setVisibleFamilyLimit(LOCAL_PRODUCT_PAGE_SIZE);
                  }}>検索をクリア</button>
                </div>
              ) : null}
            </div>
          </section>
          <LocalSalesList sales={visibleSales} title="今日の直近記録" onChange={changeQuantity} onDelete={removeSale} />
        </>
      ) : null}

      {view === 'history' ? <LocalSalesList sales={visibleSales} title="すべての記録" onChange={changeQuantity} onDelete={removeSale} showDate /> : null}

      {view === 'settings' ? (
        <section className="local-settings">
          <h2>端末内データ</h2>
          <p className="local-privacy-note">販売記録・表示名・追加商品はIndexedDBに保存され、サーバーへ送信されません。ブラウザのデータを消すと記録も消えます。</p>
          <div className="local-backup-actions">
            <button type="button" onClick={() => void exportBackup()}>バックアップを書き出す</button>
            <label className="local-file-button">バックアップを読み込む<input type="file" accept="application/json" disabled={busy} onChange={(event) => void importBackup(event.target.files?.[0])} /></label>
          </div>
          <form className="local-product-form" onSubmit={createProduct}>
            <h3>{editingProductId ? 'ローカル商品を編集' : 'ローカル商品を追加'}</h3>
            <label htmlFor="local-product-name">商品名</label>
            <input id="local-product-name" name="productName" value={productName} onChange={(event) => setProductName(event.target.value)} required />
            <label htmlFor="local-product-points">点数</label>
            <input id="local-product-points" name="productPoints" type="number" inputMode="numeric" min="1" max="9999" value={productPoints} onChange={(event) => setProductPoints(event.target.value)} required />
            <div className="local-product-form-actions">
              <button type="submit">{editingProductId ? '変更を保存' : '商品を端末に追加'}</button>
              {editingProductId ? <button type="button" className="local-secondary" onClick={cancelProductEdit}>編集をやめる</button> : null}
            </div>
          </form>
          <section className="local-product-manager" aria-labelledby="local-products-title">
            <h3 id="local-products-title">追加した商品</h3>
            {customProducts.length === 0 ? <p className="muted">追加した商品はありません。</p> : (
              <div className="local-product-manager-list">
                {customProducts.map((product) => (
                  <div className="local-product-manager-row" key={product.id}>
                    <div><strong>{product.productName}</strong><span>{product.pointValue.toLocaleString()}pt</span></div>
                    <div>
                      <button type="button" onClick={() => beginProductEdit(product)}>編集</button>
                      <button type="button" className="danger-soft" onClick={() => void removeCustomProduct(product)}>削除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <button type="button" className="local-danger" onClick={() => void resetDeviceData()}>この端末のデータを全削除</button>
        </section>
      ) : null}
    </main>
  );
}

function LocalSalesList({ sales, title, onChange, onDelete, showDate = false }: {
  sales: LocalSale[];
  title: string;
  onChange: (sale: LocalSale, delta: number) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  showDate?: boolean;
}) {
  return (
    <section className="page-card local-sales-card">
      <h2>{title}</h2>
      {sales.length === 0 ? <p className="muted">記録はまだありません。</p> : (
        <div className="recent-list">
          {sales.map((sale) => (
            <div className="recent-row recent-correction-row" key={sale.id}>
              <div>
                <strong>{sale.productName}</strong>
                <span className="muted">×{sale.quantity}{showDate ? ` · ${sale.saleDate}` : ''}</span>
                <span className="local-sale-points">{(sale.pointsPerItem * sale.quantity).toLocaleString()}pt</span>
              </div>
              <div className="recent-actions">
                <button type="button" aria-label={`${sale.productName}を減らす`} onClick={() => void onChange(sale, -1)}>−</button>
                <button type="button" aria-label={`${sale.productName}を増やす`} onClick={() => void onChange(sale, 1)}>+</button>
                <button type="button" className="danger-soft" onClick={() => void onDelete(sale.id)}>取消</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
