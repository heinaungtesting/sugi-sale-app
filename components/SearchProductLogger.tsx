'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { groupProductsIntoFamilies, rankProductsForSearch, type ProductVariant, type SearchableProduct } from '@/lib/sugi-domain';

type Props = {
  products: SearchableProduct[];
};

export function SearchProductLogger({ products }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const families = useMemo(() => {
    const ranked = rankProductsForSearch(products, query, query.trim() ? 60 : 80);
    return groupProductsIntoFamilies(ranked, query.trim() ? 20 : 12);
  }, [products, query]);

  async function log(variant: ProductVariant) {
    if (busyId) return;
    setBusyId(variant.productId);
    const res = await fetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: variant.productId, quantity: 1 }),
    });
    setBusyId(null);
    if (!res.ok) {
      setToast('記録できませんでした');
      return;
    }
    const data = await res.json();
    setToast(`${data.product_name}を記録しました`);
    router.refresh();
  }

  async function undo() {
    const res = await fetch('/api/sales/latest', { method: 'DELETE' });
    if (res.ok) {
      setToast('直前を取り消しました');
      router.refresh();
    }
  }

  return (
    <section className="search-panel" aria-label="Product search logger">
      <label className="search-label" htmlFor="product-search">Search product</label>
      <input
        id="product-search"
        className="search-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="hibi, kuchi, fetas, 口内, フェイ..."
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        inputMode="search"
      />

      {!query.trim() && <p className="muted quick-hint">Frequent product groups first. Tap a variant to log.</p>}

      <div className="family-list search-results">
        {families.length === 0 ? (
          <p className="muted">No matching product. Check spelling or add this product from the admin dashboard.</p>
        ) : families.map((family) => (
          <section key={family.name} className="family-card" aria-label={family.name}>
            <h3>{family.name}</h3>
            <div className="variant-grid">
              {family.variants.map((variant) => (
                <button
                  key={variant.productId}
                  className="variant-button"
                  onClick={() => log(variant)}
                  disabled={busyId === variant.productId}
                  title={variant.productName}
                >
                  {variant.label}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {toast && (
        <div className="toast">
          <div>{toast}</div>
          <button onClick={undo}>直前を取り消す</button>
        </div>
      )}
    </section>
  );
}
