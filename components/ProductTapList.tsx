'use client';

import { useState } from 'react';
import { enqueueSale } from '@/lib/sale-queue';

type Product = { id: number; product_name: string; point_value: number; category: string; scope: string };

const TAP_DEBOUNCE_MS = 250;

export function ProductTapList({ userId, products }: { userId: number; products: Product[] }) {
  const [recentlyTapped, setRecentlyTapped] = useState<number | null>(null);

  function log(product: Product) {
    if (recentlyTapped === product.id) return;
    setRecentlyTapped(product.id);
    setTimeout(() => {
      setRecentlyTapped((current) => (current === product.id ? null : current));
    }, TAP_DEBOUNCE_MS);
    enqueueSale({
      ownerUserId: userId,
      productId: product.id,
      variantId: null,
      productName: product.product_name,
      pointValue: product.point_value,
      quantity: 1,
    });
  }

  return (
    <div className="product-list">
      {products.map((product) => {
        const isDebouncing = recentlyTapped === product.id;
        return (
          <button
            key={product.id}
            className="product-row"
            onClick={() => log(product)}
            disabled={isDebouncing}
            aria-busy={isDebouncing}
          >
            <span>
              <strong>{product.product_name}</strong>
              <span className="muted">Tap to log ×1</span>
            </span>
            <span className="points">{product.point_value}pt</span>
          </button>
        );
      })}
    </div>
  );
}
