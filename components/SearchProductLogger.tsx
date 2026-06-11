'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { groupProductsIntoFamilies, rankProductsForSearch, type ProductVariant, type SearchableProduct } from '@/lib/sugi-domain';

type Props = {
  products: SearchableProduct[];
};

function busyKeyFor(variant: ProductVariant) {
  return `${variant.productId}:${variant.variantId ?? 'base'}`;
}

export function SearchProductLogger({ products }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [lastLogged, setLastLogged] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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
      setToast('記録できませんでした');
      return;
    }
    const data = await res.json();
    setLastLogged(true);
    setToast(`${data.product_name}を記録しました`);
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
    <section className="search-panel shift-log-panel" aria-label="Product search logger">
      <div className="quick-log-card" aria-label="Quick log favorites">
        <div className="section-heading-row">
          <div>
            <h2>Quick log</h2>
            <p>Most-used variants for one-tap logging.</p>
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
        <label className="search-label" htmlFor="product-search">Search product</label>
        <input
          id="product-search"
          className="search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search product or shortcut"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="search"
        />
        {!query.trim() && <p className="muted quick-hint">Try hibi, kuchi, fetas, pripink. Tap a variant to log ×1.</p>}
      </div>

      <div className="section-heading-row product-grid-heading">
        <div>
          <h2>{query.trim() ? 'Search results' : 'All products'}</h2>
          <p>{query.trim() ? 'Filtered by shortcut/name.' : 'Frequent product groups first.'}</p>
        </div>
      </div>

      <div className="family-list search-results">
        {families.length === 0 ? (
          <div className="recent-empty-state no-product-state">
            <strong>No matching product</strong>
            <span>Check spelling or add it from Admin.</span>
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
          {lastLogged && <button onClick={undo}>直前を取り消す</button>}
        </div>
      )}
    </section>
  );
}
