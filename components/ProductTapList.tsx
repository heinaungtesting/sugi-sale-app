'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Product = { id: number; product_name: string; point_value: number; category: string; scope: string };

export function ProductTapList({ products }: { products: Product[] }) {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function log(product: Product) {
    if (busyId) return;
    setBusyId(product.id);
    const res = await fetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: product.id, quantity: 1 }),
    });
    setBusyId(null);
    if (!res.ok) {
      setToast('Could not log sale');
      return;
    }
    const data = await res.json();
    setToast(`✅ ${data.product_name} +${data.total_points}pt / Today ${data.today_total}pt`);
    router.refresh();
  }

  async function undo() {
    const res = await fetch('/api/sales/latest', { method: 'DELETE' });
    if (res.ok) {
      setToast('↩️ Undone');
      router.refresh();
    }
  }

  return (
    <>
      <div className="product-list">
        {products.map((product) => (
          <button key={product.id} className="product-row" onClick={() => log(product)} disabled={busyId === product.id}>
            <span>
              <strong>{product.product_name}</strong>
              <span className="muted">Tap to log ×1</span>
            </span>
            <span className="points">{product.point_value}pt</span>
          </button>
        ))}
      </div>
      {toast && (
        <div className="toast">
          <div>{toast}</div>
          <button onClick={undo}>Undo latest</button>
        </div>
      )}
    </>
  );
}
