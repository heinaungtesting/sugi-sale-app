'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { groupProductsIntoFamilies, rankProductsForSearch, type ProductFamily, type ProductVariant, type SearchableProduct } from '@/lib/sugi-domain';

type Language = 'en' | 'ja';

type Props = {
  products: SearchableProduct[];
  language: Language;
};

const copy = {
  en: {
    aria: 'Product search logger',
    searchLabel: 'Product search',
    searchPlaceholder: 'Type hibi, kuchi, fetas, pripink...',

    resultsTitle: 'Results',
    resultsHelp: 'Tap a variant to log ×1.',

    mostlyUsedTitle: 'Mostly used',
    noMatchTitle: 'No matching product',
    noMatchHelp: 'If this is a real recommended product, add it now with its points.',
    quickAddTitle: 'Quick add product',
    quickAddName: 'Product name',
    quickAddPoints: 'Points',
    quickAddButton: 'Create & log',
    quickAddError: 'Could not create product',
    resultCount: 'matches',
    searching: 'Searching...',
    error: 'Could not log product',
  },
  ja: {
    aria: '商品検索記録',
    searchLabel: '商品検索',
    searchPlaceholder: 'hibi、kuchi、fetas、pripink...',

    resultsTitle: '検索結果',
    resultsHelp: 'バリアントをタップすると×1で記録します。',

    mostlyUsedTitle: 'よく使う商品',
    noMatchTitle: '商品が見つかりません',
    noMatchHelp: 'おすすめした商品がDBにない場合、その場で点数を入れて追加できます。',
    quickAddTitle: '商品をクイック追加',
    quickAddName: '商品名',
    quickAddPoints: '点数',
    quickAddButton: '追加して記録',
    quickAddError: '商品を追加できませんでした',
    resultCount: '件',
    searching: '検索中...',
    error: '記録できませんでした',
  },
} satisfies Record<Language, Record<string, string>>;

function busyKeyFor(variant: ProductVariant) {
  return `${variant.productId}:${variant.variantId ?? 'base'}`;
}

function variantDisplayLabel(variant: ProductVariant, family: ProductFamily, language: Language) {
  if (family.variants.length === 1 && variant.label === '標準') return language === 'ja' ? '記録' : 'Log';
  return variant.label;
}

export function SearchProductLogger({ products, language }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [searchProducts, setSearchProducts] = useState<SearchableProduct[]>(products);
  const [isSearching, setIsSearching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [quickAddName, setQuickAddName] = useState('');
  const [quickAddPoints, setQuickAddPoints] = useState('');
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const t = copy[language];
  const normalizedQuery = query.trim();
  const hasQuery = normalizedQuery.length > 0;

  useEffect(() => {
    if (!hasQuery) {
      setSearchProducts(products);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    setIsSearching(true);
    fetch(`/api/products?q=${encodeURIComponent(normalizedQuery)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('search failed'))))
      .then((data: SearchableProduct[]) => setSearchProducts(data))
      .catch((error) => {
        if (error.name !== 'AbortError') setSearchProducts(products);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsSearching(false);
      });

    return () => controller.abort();
  }, [hasQuery, normalizedQuery, products]);

  useEffect(() => {
    setQuickAddName(normalizedQuery);
  }, [normalizedQuery]);

  const families = useMemo(() => {
    if (!hasQuery) return [];
    const ranked = rankProductsForSearch(searchProducts, normalizedQuery, 60);
    return groupProductsIntoFamilies(ranked, 20);
  }, [hasQuery, normalizedQuery, searchProducts]);

  const mostlyUsedFamilies = useMemo(() => {
    const rankedPopular = rankProductsForSearch(products, '', 300);
    return groupProductsIntoFamilies(rankedPopular, 30);
  }, [products]);

  async function log(variant: ProductVariant) {
    if (busyId) return;
    const busyKey = busyKeyFor(variant);
    setBusyId(busyKey);
    const res = await fetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: variant.productId, variant_id: variant.variantId, quantity: 1 }),
    });
    setBusyId(null);
    if (!res.ok) {
      setToast(t.error);
      return;
    }
    await res.json();
    setToast(null);
    router.refresh();
  }

  async function quickCreateAndLog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreatingProduct) return;
    const name = quickAddName.trim();
    const points = Number(quickAddPoints);
    if (!name || !Number.isFinite(points) || points <= 0) {
      setToast(t.quickAddError);
      return;
    }
    setIsCreatingProduct(true);
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_name: name, point_value: points, log: true }),
    });
    setIsCreatingProduct(false);
    if (!res.ok) {
      setToast(t.quickAddError);
      return;
    }
    const data = await res.json();
    setToast(null);
    setQuickAddPoints('');
    setQuery(name);
    setSearchProducts(await (await fetch(`/api/products?q=${encodeURIComponent(name)}`)).json());
    router.refresh();
  }

  return (
    <section className="search-panel shift-log-panel" aria-label={t.aria}>
      <div className="search-sticky-card page-card">
        <label className="search-label" htmlFor="product-search">{t.searchLabel}</label>
        <input
          id="product-search"
          className="search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.searchPlaceholder}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="search"
        />
        {hasQuery && (
          <div className="search-helper-row">
            <span className="result-count-pill">{isSearching ? t.searching : `${families.length}${language === 'ja' ? t.resultCount : ` ${t.resultCount}`}`}</span>
          </div>
        )}
      </div>

      {hasQuery ? (
        <>
          <div className="section-heading-row product-grid-heading">
            <div>
              <h2>{t.resultsTitle}</h2>
              <p>{t.resultsHelp}</p>
            </div>
          </div>
          <div className="family-list search-results">
            {families.length === 0 ? (
              <div className="recent-empty-state no-product-state quick-add-card">
                <strong>{t.noMatchTitle}</strong>
                <span>{t.noMatchHelp}</span>
                <form className="quick-add-form" onSubmit={quickCreateAndLog}>
                  <label>
                    {t.quickAddName}
                    <input
                      value={quickAddName}
                      onChange={(event) => setQuickAddName(event.target.value)}
                      maxLength={120}
                      required
                    />
                  </label>
                  <label>
                    {t.quickAddPoints}
                    <input
                      value={quickAddPoints}
                      onChange={(event) => setQuickAddPoints(event.target.value)}
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="9999"
                      placeholder="120"
                      required
                    />
                  </label>
                  <button type="submit" disabled={isCreatingProduct}>{t.quickAddButton}</button>
                </form>
              </div>
            ) : families.map((family) => (
              <section key={family.name} className="family-card" aria-label={family.name}>
                <h3>{family.name}</h3>
                <div className="variant-grid">
                  {family.variants.map((variant) => {
                    const busyKey = busyKeyFor(variant);
                    return (
                      <button
                        key={busyKey}
                        className="variant-button"
                        onClick={() => log(variant)}
                        disabled={busyId === busyKey}
                        title={variant.productName}
                      >
                        {variantDisplayLabel(variant, family, language)}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="section-heading-row product-grid-heading mostly-used-heading">
            <div>
              <h2>{t.mostlyUsedTitle}</h2>
            </div>
          </div>
          <div className="family-list mostly-used-list">
            {mostlyUsedFamilies.map((family) => (
              <section key={family.name} className="family-card" aria-label={family.name}>
                <h3>{family.name}</h3>
                <div className="variant-grid">
                  {family.variants.map((variant) => {
                    const busyKey = busyKeyFor(variant);
                    return (
                      <button
                        key={busyKey}
                        className="variant-button"
                        onClick={() => log(variant)}
                        disabled={busyId === busyKey}
                        title={variant.productName}
                      >
                        {variantDisplayLabel(variant, family, language)}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {toast && (
        <div className="toast">
          <div>{toast}</div>
        </div>
      )}
    </section>
  );
}
