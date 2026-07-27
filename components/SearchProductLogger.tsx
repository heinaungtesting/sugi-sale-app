'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { groupProductsIntoFamilies, rankProductsForSearch, type ProductFamily, type ProductVariant, type SearchableProduct } from '@/domain/products/search-ranking';
import { enqueueSale, type QueueEntry } from '@/lib/sale-queue';
import { csrfFetch } from '@/lib/csrf-client';
import { triggerTapHaptic } from '@/lib/haptics';

type Language = 'en' | 'ja';

type Props = {
  userId: number;
  products: SearchableProduct[];
  language: Language;
  setTodaySummary: (sale: LoggedSaleResponse, queueKey: string) => void;
  onQuickAddCreated?: (sale: LoggedSaleResponse, queueKey: string) => void;
};

type LoggedSaleResponse = {
  id: number;
  product_name: string;
  quantity: number;
  points_per_item: number;
  total_points: number;
  today_total: number;
  today_items: number;
};

const copy = {
  en: {
    aria: 'Product search logger',
    searchLabel: 'Product search',
    searchPlaceholder: 'Type hibi, kuchi, fetas, pripink...',

    resultsTitle: 'Results',
    resultsHelp: 'Tap to log ×1. Long press to change points.',

    mostlyUsedTitle: 'Mostly used',
    longPressHelp: 'Long press a product to change its points.',
    pointEditTitle: 'Change points',
    assignPointsTitle: 'Set points before logging',
    assignPointsSave: 'Save & log',
    unassignedPoints: 'Points not set',
    pointEditSave: 'Save points',
    pointEditCancel: 'Cancel',
    pointEditError: 'Enter points from 1 to 9999.',
    pointEditSaveError: 'Could not update points.',
    pointEditSaved: 'Points updated',
    quickAddName: 'Product name',
    quickAddPoints: 'Points',
    quickAddButton: 'Create & log',
    quickAddError: 'Could not create product',
    resultCount: 'matches',
    searching: 'Searching...',
    error: 'Could not log product',
    tapAgain: 'Tap again',
  },
  ja: {
    aria: '商品検索記録',
    searchLabel: '商品検索',
    searchPlaceholder: 'hibi、kuchi、fetas、pripink...',

    resultsTitle: '検索結果',
    resultsHelp: 'タップで×1を記録。長押しで点数を変更できます。',

    mostlyUsedTitle: 'よく使う商品',
    longPressHelp: '商品を長押しすると点数を変更できます。',
    pointEditTitle: '点数を変更',
    assignPointsTitle: '記録前に点数を設定',
    assignPointsSave: '保存して記録',
    unassignedPoints: '点数未設定',
    pointEditSave: '点数保存',
    pointEditCancel: 'キャンセル',
    pointEditError: '1〜9999の点数を入力してください。',
    pointEditSaveError: '点数を更新できませんでした。',
    pointEditSaved: '点数を更新しました',
    quickAddName: '商品名',
    quickAddPoints: '点数',
    quickAddButton: '追加して記録',
    quickAddError: '商品を追加できませんでした',
    resultCount: '件',
    searching: '検索中...',
    error: '記録できませんでした',
    tapAgain: 'もう一度タップ',
  },
} satisfies Record<Language, Record<string, string>>;

// Short debounce window for the same variant button. This is a UX guard against
// stuck touch events firing twice — NOT a network wait. The actual write goes
// through the offline queue and never blocks the UI.
const TAP_DEBOUNCE_MS = 250;
const LONG_PRESS_MS = 550;

function busyKeyFor(variant: ProductVariant) {
  return `${variant.productId}:${variant.variantId ?? 'base'}`;
}

function variantDisplayLabel(variant: ProductVariant, family: ProductFamily, language: Language) {
  if (family.variants.length === 1 && variant.label === '標準') return language === 'ja' ? '記録' : 'Log';
  return variant.label;
}

function quickAddEnqueue(entry: QueueEntry, language: Language): { sale: LoggedSaleResponse; queueKey: string } {
  const tempId = -entry.enqueuedAt;
  return {
    queueKey: entry.idempotencyKey,
    sale: {
      id: tempId,
      product_name: entry.productName,
      quantity: entry.quantity,
      points_per_item: entry.pointValue,
      total_points: entry.pointValue * entry.quantity,
      today_total: 0,
      today_items: 0,
    },
  };
}

export function SearchProductLogger({ userId, products, language, setTodaySummary, onQuickAddCreated }: Props) {
  const [query, setQuery] = useState('');
  const [searchProducts, setSearchProducts] = useState<SearchableProduct[]>(products);
  const [isSearching, setIsSearching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [recentlyTapped, setRecentlyTapped] = useState<string | null>(null);
  const [quickAddName, setQuickAddName] = useState('');
  const [quickAddPoints, setQuickAddPoints] = useState('');
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [pointEdit, setPointEdit] = useState('');
  const [pointEditError, setPointEditError] = useState<string | null>(null);
  const [isSavingPoints, setIsSavingPoints] = useState(false);
  const [logAfterPointSave, setLogAfterPointSave] = useState(false);
  const [pointOverrides, setPointOverrides] = useState<Record<string, number>>({});
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);
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

  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  const families = useMemo(() => {
    if (!hasQuery) return [];
    const ranked = rankProductsForSearch(searchProducts, normalizedQuery, 60);
    return groupProductsIntoFamilies(ranked, 20);
  }, [hasQuery, normalizedQuery, searchProducts]);

  const mostlyUsedFamilies = useMemo(() => {
    const rankedPopular = rankProductsForSearch(products, '', 300);
    return groupProductsIntoFamilies(rankedPopular, 30);
  }, [products]);

  function pointValueFor(variant: ProductVariant) {
    return pointOverrides[busyKeyFor(variant)] ?? variant.pointValue;
  }

  function cancelLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  }

  function startLongPress(variant: ProductVariant) {
    cancelLongPress();
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setLogAfterPointSave(false);
      setEditingVariant(variant);
      setPointEdit(String(pointValueFor(variant)));
      setPointEditError(null);
      navigator.vibrate?.(30);
    }, LONG_PRESS_MS);
  }

  function closePointEditor() {
    if (isSavingPoints) return;
    longPressTriggered.current = false;
    setLogAfterPointSave(false);
    setEditingVariant(null);
    setPointEditError(null);
  }

  async function saveVariantPoints(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingVariant || isSavingPoints) return;
    const normalized = pointEdit.normalize('NFKC').trim();
    const points = Number(normalized);
    if (!Number.isInteger(points) || points <= 0 || points > 9999) {
      setPointEditError(t.pointEditError);
      return;
    }

    setIsSavingPoints(true);
    setPointEditError(null);
    const response = await csrfFetch('/api/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: editingVariant.productId,
        variant_id: editingVariant.variantId ?? null,
        point_value: points,
      }),
    }).catch(() => null);
    setIsSavingPoints(false);
    if (!response?.ok) {
      setPointEditError(t.pointEditSaveError);
      return;
    }

    const savedVariant = editingVariant;
    const shouldLog = logAfterPointSave;
    setPointOverrides((current) => ({ ...current, [busyKeyFor(savedVariant)]: points }));
    longPressTriggered.current = false;
    setLogAfterPointSave(false);
    setEditingVariant(null);
    if (shouldLog) log(savedVariant, points);
    else setToast(t.pointEditSaved);
  }

  function handleVariantClick(variant: ProductVariant) {
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    if (pointValueFor(variant) <= 0) {
      setLogAfterPointSave(true);
      setEditingVariant(variant);
      setPointEdit('');
      setPointEditError(null);
      return;
    }
    log(variant);
  }

  function log(variant: ProductVariant, assignedPoints?: number) {
    const busyKey = busyKeyFor(variant);
    if (recentlyTapped === busyKey) return;
    triggerTapHaptic();
    setRecentlyTapped(busyKey);
    setTimeout(() => {
      setRecentlyTapped((current) => (current === busyKey ? null : current));
    }, TAP_DEBOUNCE_MS);
    const entry = enqueueSale({
      ownerUserId: userId,
      productId: variant.productId,
      variantId: variant.variantId ?? null,
      productName: variant.productName,
      pointValue: assignedPoints ?? pointValueFor(variant),
      quantity: 1,
    });
    const { sale, queueKey } = quickAddEnqueue(entry, language);
    setTodaySummary(sale, queueKey);
    setToast(null);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.querySelector<HTMLInputElement>('#product-search');
    input?.blur();
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

    // Enqueue an optimistic entry first so the tap is instant and the queue handles
    // slow networks / retries. The /api/products call below resolves the product_id,
    // then a follow-up fetch with the same idempotency_key replays safely if it lands
    // out of order. For now we resolve the product id first, then enqueue — this keeps
    // the optimistic sale data accurate and prevents a duplicate quick-add row from
    // racing the log.
    const res = await csrfFetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_name: name,
        point_value: points,
        log: true,
      }),
    });
    setIsCreatingProduct(false);
    if (!res.ok) {
      setToast(t.quickAddError);
      return;
    }
    const data = await res.json() as { product?: { id: number; product_name: string; point_value: number }; sale?: LoggedSaleResponse & { idempotent_replay?: boolean } };
    if (data.sale) {
      // Replay path: the quick-add already logged, and we just received the canonical
      // sale. Inject it into the recent list with a synthetic queue key so the parent
      // knows to merge it (and so a future prune by id works).
      onQuickAddCreated?.(data.sale, `qa-${data.sale.id}`);
    }
    setToast(null);
    setQuickAddPoints('');
    setQuery(name);
    try {
      const refreshed = await fetch(`/api/products?q=${encodeURIComponent(name)}`);
      if (refreshed.ok) setSearchProducts(await refreshed.json());
    } catch {
      // ignore — best effort search refresh
    }
  }

  return (
    <section className="search-panel shift-log-panel" aria-label={t.aria}>
      <div className="search-sticky-card page-card">
        <form className="search-form" onSubmit={submitSearch}>
          <label className="search-label" htmlFor="product-search"><span className="paw-icon" aria-hidden="true" />{t.searchLabel}</label>
          <div className="search-input-wrap">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input
              id="product-search"
              className="search-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.searchPlaceholder}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="search"
            />
            <span className="search-peek-cat" aria-hidden="true" />
          </div>
        </form>
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
            {families.map((family, index) => (
              <section key={family.name} className={`family-card cute-family-card ${index < 2 ? 'featured-family-card' : ''}`.trim()} aria-label={family.name}>
                <h3>{family.name}</h3>
                <div className="variant-grid">
                  {family.variants.map((variant) => {
                    const busyKey = busyKeyFor(variant);
                    const isDebouncing = recentlyTapped === busyKey;
                    return (
                      <button
                        key={busyKey}
                        className="variant-button sale-tap-button"
                        onPointerDown={() => startLongPress(variant)}
                        onPointerUp={cancelLongPress}
                        onPointerLeave={cancelLongPress}
                        onPointerCancel={cancelLongPress}
                        onContextMenu={(event) => event.preventDefault()}
                        onClick={() => handleVariantClick(variant)}
                        disabled={isDebouncing}
                        title={`${variant.productName} — ${t.longPressHelp}`}
                        aria-busy={isDebouncing}
                      >
                        <span className="variant-label">{variantDisplayLabel(variant, family, language)}</span>
                        <small className="variant-points">{pointValueFor(variant) > 0 ? `${pointValueFor(variant)}pt` : t.unassignedPoints}</small>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
            {!isSearching && families.length === 0 && (
              <form className="quick-add-card quick-add-form" onSubmit={quickCreateAndLog}>
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
            )}
          </div>
        </>
      ) : (
        <>
          <div className="section-heading-row product-grid-heading mostly-used-heading">
            <div>
              <h2><span className="paw-icon" aria-hidden="true" />{t.mostlyUsedTitle}</h2>
              <p>{t.longPressHelp}</p>
            </div>
          </div>
          <div className="family-list mostly-used-list">
            {mostlyUsedFamilies.map((family, index) => (
              <section key={family.name} className={`family-card cute-family-card ${index < 2 ? 'featured-family-card' : ''}`.trim()} aria-label={family.name}>
                <h3>{family.name}</h3>
                <div className="variant-grid">
                  {family.variants.map((variant) => {
                    const busyKey = busyKeyFor(variant);
                    const isDebouncing = recentlyTapped === busyKey;
                    return (
                      <button
                        key={busyKey}
                        className="variant-button sale-tap-button"
                        onPointerDown={() => startLongPress(variant)}
                        onPointerUp={cancelLongPress}
                        onPointerLeave={cancelLongPress}
                        onPointerCancel={cancelLongPress}
                        onContextMenu={(event) => event.preventDefault()}
                        onClick={() => handleVariantClick(variant)}
                        disabled={isDebouncing}
                        title={`${variant.productName} — ${t.longPressHelp}`}
                        aria-busy={isDebouncing}
                      >
                        <span className="variant-label">{variantDisplayLabel(variant, family, language)}</span>
                        <small className="variant-points">{pointValueFor(variant) > 0 ? `${pointValueFor(variant)}pt` : t.unassignedPoints}</small>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {editingVariant && (
        <div
          className="point-editor-overlay"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closePointEditor();
          }}
        >
          <form className="point-editor-card" role="dialog" aria-modal="true" aria-labelledby="point-editor-title" onSubmit={saveVariantPoints}>
            <h2 id="point-editor-title">{logAfterPointSave ? t.assignPointsTitle : t.pointEditTitle}</h2>
            <strong>{editingVariant.productName}</strong>
            <label htmlFor="variant-point-edit">{t.quickAddPoints}</label>
            <input
              id="variant-point-edit"
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
              <button type="button" className="secondary" onClick={closePointEditor} disabled={isSavingPoints}>{t.pointEditCancel}</button>
              <button type="submit" disabled={isSavingPoints}>{logAfterPointSave ? t.assignPointsSave : t.pointEditSave}</button>
            </div>
          </form>
        </div>
      )}

      {toast && (
        <div className={`toast ${t.quickAddError === toast ? 'toast-error' : 'toast-success'}`}>
          <div>{toast}</div>
        </div>
      )}
    </section>
  );
}
