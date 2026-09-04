'use client';

import { useState, type FormEvent } from 'react';
import { enqueueSale } from '@/lib/sale-queue';
import { csrfFetch } from '@/lib/csrf-client';
import { triggerTapHaptic } from '@/lib/haptics';

type Product = { id: number; product_name: string; point_value: number; category: string; scope: string };

const TAP_DEBOUNCE_MS = 250;

export function ProductTapList({ userId, products }: { userId: number; products: Product[] }) {
  const [recentlyTapped, setRecentlyTapped] = useState<number | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [pointEdit, setPointEdit] = useState('');
  const [pointEditError, setPointEditError] = useState<string | null>(null);
  const [isSavingPoints, setIsSavingPoints] = useState(false);
  const [pointOverrides, setPointOverrides] = useState<Record<number, number>>({});

  function pointValueFor(product: Product) {
    return pointOverrides[product.id] ?? product.point_value;
  }

  function closePointEditor() {
    if (isSavingPoints) return;
    setEditingProduct(null);
    setPointEdit('');
    setPointEditError(null);
  }

  async function saveProductPoints(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProduct || isSavingPoints) return;
    const points = Number(pointEdit.normalize('NFKC').trim());
    if (!Number.isInteger(points) || points <= 0 || points > 9999) {
      setPointEditError('1〜9999の点数を入力してください。');
      return;
    }

    setIsSavingPoints(true);
    setPointEditError(null);
    const response = await csrfFetch('/api/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: editingProduct.id,
        variant_id: null,
        point_value: points,
      }),
    }).catch(() => null);
    setIsSavingPoints(false);
    if (!response?.ok) {
      setPointEditError('点数を保存できませんでした。もう一度お試しください。');
      return;
    }

    const savedProduct = editingProduct;
    setPointOverrides((current) => ({ ...current, [savedProduct.id]: points }));
    setEditingProduct(null);
    setPointEdit('');
    log(savedProduct, points);
  }

  function handleProductClick(product: Product) {
    if (pointValueFor(product) <= 0) {
      setEditingProduct(product);
      setPointEdit('');
      setPointEditError(null);
      return;
    }
    log(product);
  }

  function log(product: Product, assignedPoints?: number) {
    if (recentlyTapped === product.id) return;
    triggerTapHaptic();
    setRecentlyTapped(product.id);
    setTimeout(() => {
      setRecentlyTapped((current) => (current === product.id ? null : current));
    }, TAP_DEBOUNCE_MS);
    enqueueSale({
      ownerUserId: userId,
      productId: product.id,
      variantId: null,
      productName: product.product_name,
      pointValue: assignedPoints ?? pointValueFor(product),
      quantity: 1,
    });
  }

  return (
    <>
      <div className="product-list">
        {products.map((product) => {
          const isDebouncing = recentlyTapped === product.id;
          return (
            <button
              key={product.id}
              className="product-row sale-tap-button"
              onClick={() => handleProductClick(product)}
              disabled={isDebouncing}
              aria-busy={isDebouncing}
            >
              <span>
                <strong>{product.product_name}</strong>
                <span className="muted">Tap to log ×1</span>
              </span>
              <span className="points">{pointValueFor(product) > 0 ? `${pointValueFor(product)}pt` : '点数未設定'}</span>
            </button>
          );
        })}
      </div>

      {editingProduct && (
        <div
          className="point-editor-overlay"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closePointEditor();
          }}
        >
          <form className="point-editor-card" role="dialog" aria-modal="true" aria-labelledby="category-point-editor-title" onSubmit={saveProductPoints}>
            <h2 id="category-point-editor-title">記録前に点数を設定</h2>
            <strong>{editingProduct.product_name}</strong>
            <label htmlFor="category-product-point-edit">点数</label>
            <input
              id="category-product-point-edit"
              value={pointEdit}
              onChange={(event) => setPointEdit(event.target.value)}
              type="text"
              inputMode="numeric"
              enterKeyHint="done"
              autoFocus
              maxLength={4}
              aria-invalid={Boolean(pointEditError)}
            />
            {pointEditError && <p className="point-editor-error" role="alert">{pointEditError}</p>}
            <div className="point-editor-actions">
              <button type="button" className="secondary" onClick={closePointEditor} disabled={isSavingPoints}>キャンセル</button>
              <button type="submit" disabled={isSavingPoints}>保存して記録</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
