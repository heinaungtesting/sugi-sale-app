'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { groupProductsIntoFamilies, rankProductsForSearch, type ProductVariant, type SearchableProduct } from '@/lib/sugi-domain';

type Language = 'en' | 'ja';

type Props = {
  products: SearchableProduct[];
  language: Language;
};

const copy = {
  en: {
    aria: 'Product search logger',
    quickAria: 'Quick log favorites',
    quickTitle: 'Quick log',
    quickHelp: 'Most-used variants for one-tap logging.',
    searchLabel: 'Search product',
    searchPlaceholder: 'Search product or shortcut',
    hint: 'Try hibi, kuchi, fetas, pripink. Tap a variant to log ×1.',
    resultsTitle: 'Search results',
    productsTitle: 'All products',
    resultsHelp: 'Filtered by shortcut/name.',
    productsHelp: 'Frequent product groups first.',
    noMatchTitle: 'No matching product',
    noMatchHelp: 'Check spelling or add it from Admin.',
    error: 'Could not log product',
    undo: 'Undo latest',
    loggedSuffix: ' logged',
  },
  ja: {
    aria: '商品検索記録',
    quickAria: 'すぐ記録のお気に入り',
    quickTitle: 'すぐ記録',
    quickHelp: 'よく使う商品をワンタップで記録できます。',
    searchLabel: '商品検索',
    searchPlaceholder: '商品名またはショートカットで検索',
    hint: 'hibi、kuchi、fetas、pripink など。バリアントをタップすると×1で記録します。',
    resultsTitle: '検索結果',
    productsTitle: '全商品',
    resultsHelp: 'ショートカット・商品名で絞り込み中。',
    productsHelp: 'よく記録する商品を上に表示しています。',
    noMatchTitle: '商品が見つかりません',
    noMatchHelp: 'スペルを確認するか、Adminから追加してください。',
    error: '記録できませんでした',
    undo: '直前を取り消す',
    loggedSuffix: 'を記録しました',
  },
} satisfies Record<Language, Record<string, string>>;

function busyKeyFor(variant: ProductVariant) {
  return `${variant.productId}:${variant.variantId ?? 'base'}`;
}

export function SearchProductLogger({ products, language }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [lastLogged, setLastLogged] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const t = copy[language];

  const baseFamilies = useMemo(() => {
    const ranked = rankProductsForSearch(products, '', 80);
    return groupProductsIntoFamilies(ranked, 12);
  }, [products]);

  const topVariants = useMemo(() => (
    baseFamilies
      .flatMap((family) => family.variants.slice(0, 2).map((variant) => ({ familyName: family.name, variant })))
      .slice(0, 6)
  ), [baseFamilies]);

  const families = useMemo(() => {
    if (!query.trim()) return baseFamilies;
    const ranked = rankProductsForSearch(products, query, 60);
    return groupProductsIntoFamilies(ranked, 20);
  }, [baseFamilies, products, query]);

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
    setLastLogged(true);
    setToast(language === 'ja' ? `${data.product_name}${t.loggedSuffix}` : `${data.product_name}${t.loggedSuffix}`);
    router.refresh();
  }

  async function undo() {
    const res = await fetch('/api/sales/latest', { method: 'DELETE' });
    if (res.ok) {
      setLastLogged(false);
      setToast(null);
      router.refresh();
    }
  }

  return (
    <section className="search-panel shift-log-panel" aria-label={t.aria}>
      <div className="quick-log-card" aria-label={t.quickAria}>
        <div className="section-heading-row">
          <div>
            <h2>{t.quickTitle}</h2>
            <p>{t.quickHelp}</p>
          </div>
        </div>
        <div className="quick-log-strip">
          {topVariants.map(({ familyName, variant }) => {
            const busyKey = busyKeyFor(variant);
            return (
              <button
                key={`quick:${busyKey}`}
                className="quick-log-button"
                onClick={() => log(variant)}
                disabled={busyId === busyKey}
                title={variant.productName}
              >
                <span>{familyName}</span>
                <strong>{variant.label}</strong>
              </button>
            );
          })}
        </div>
      </div>

      <div className="search-sticky-card">
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
        {!query.trim() && <p className="muted quick-hint">{t.hint}</p>}
      </div>

      <div className="section-heading-row product-grid-heading">
        <div>
          <h2>{query.trim() ? t.resultsTitle : t.productsTitle}</h2>
          <p>{query.trim() ? t.resultsHelp : t.productsHelp}</p>
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
                    {variant.label}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {toast && (
        <div className="toast">
          <div>{toast}</div>
          {lastLogged && <button onClick={undo}>{t.undo}</button>}
        </div>
      )}
    </section>
  );
}
