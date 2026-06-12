'use client';

import { useEffect, useMemo, useState } from 'react';
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
    mostlyUsedHelp: 'Your top 30 products are ready below the search bar.',
    noMatchTitle: 'No matching product',
    noMatchHelp: 'Check spelling or add it from Admin.',
    resultCount: 'matches',
    searching: 'Searching...',
    error: 'Could not log product',
    undo: 'Undo latest',
    repeat: '+1 more',
    loggedSuffix: ' logged',
  },
  ja: {
    aria: '商品検索記録',
    searchLabel: '商品検索',
    searchPlaceholder: 'hibi、kuchi、fetas、pripink...',

    resultsTitle: '検索結果',
    resultsHelp: 'バリアントをタップすると×1で記録します。',

    mostlyUsedTitle: 'よく使う商品',
    mostlyUsedHelp: 'よく使う30件を検索バーの下に表示しています。',
    noMatchTitle: '商品が見つかりません',
    noMatchHelp: 'スペルを確認するか、管理から追加してください。',
    resultCount: '件',
    searching: '検索中...',
    error: '記録できませんでした',
    undo: '直前を取り消す',
    repeat: 'もう1個',
    loggedSuffix: 'を記録しました',
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
  const [lastLogged, setLastLogged] = useState<ProductVariant | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
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
    const data = await res.json();
    setLastLogged(variant);
    setToast(`${data.product_name}${t.loggedSuffix}`);
    router.refresh();
  }

  async function undo() {
    const res = await fetch('/api/sales/latest', { method: 'DELETE' });
    if (res.ok) {
      setLastLogged(null);
      setToast(null);
      router.refresh();
    }
  }

  async function repeatLatest() {
    if (lastLogged) await log(lastLogged);
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
              <div className="recent-empty-state no-product-state">
                <strong>{t.noMatchTitle}</strong>
                <span>{t.noMatchHelp}</span>
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
              <p>{t.mostlyUsedHelp}</p>
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
          <div className="toast-actions">
            {lastLogged && <button onClick={undo}>{t.undo}</button>}
            {lastLogged && <button onClick={repeatLatest}>{t.repeat}</button>}
          </div>
        </div>
      )}
    </section>
  );
}
