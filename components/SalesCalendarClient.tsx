'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageCard } from '@/components/PageCard';
import { groupProductsIntoFamilies, rankProductsForSearch, type ProductFamily, type ProductVariant, type SearchableProduct } from '@/domain/products/search-ranking';
import { enqueueSale, getSnapshot, initSaleQueue, pruneSyncedToServerIds, subscribe, type QueueSnapshot } from '@/lib/sale-queue';
import { buildCalendarCells, monthAnchorDate } from '@/lib/sales-calendar';
import { mergeDisplayedSales } from '@/lib/sale-display';
import { csrfFetch } from '@/lib/csrf-client';

type MonthTotal = { sold_date: string; total_points: number; total_items: number };
type SaleLog = { id: number; product_name: string; quantity: number; total_points: number; points_per_item: number; _queueKey?: string };


type Props = {
  products: SearchableProduct[];
  initialMonth: string;
  initialDate: string;
  monthTotals: MonthTotal[];
  day: { total_points: number; total_items: number; logs: SaleLog[] };
};

const TAP_DEBOUNCE_MS = 250;
const ADD_FAMILY_PAGE_SIZE = 12;

function monthLabel(month: string) {
  const [year, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'UTC', year: 'numeric', month: 'long' }).format(new Date(Date.UTC(year, m - 1, 1)));
}
function fullDateLabel(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(Date.UTC(year, month - 1, day)));
}
function tokyoToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function shiftDate(date: string, delta: number) {
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return d.toISOString().slice(0, 10);
}

function variantDisplayLabel(variant: ProductVariant, family: ProductFamily) {
  if (family.variants.length === 1 && variant.label === '標準') return '追加';
  return variant.label;
}

export function SalesCalendarClient({ products, initialMonth, initialDate, monthTotals, day }: Props) {
  const router = useRouter();
  const [month, setMonth] = useState(initialMonth);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [totals, setTotals] = useState(monthTotals);
  const [logs, setLogs] = useState(day.logs);
  const [summary, setSummary] = useState({ total_points: day.total_points, total_items: day.total_items });
  const [addQuery, setAddQuery] = useState('');
  const [visibleFamilyLimit, setVisibleFamilyLimit] = useState(ADD_FAMILY_PAGE_SIZE);
  const [recentlyTapped, setRecentlyTapped] = useState<string | null>(null);
  const [queueSnapshot, setQueueSnapshot] = useState<QueueSnapshot>(() => getSnapshot());
  const totalByDate = useMemo(() => new Map(totals.map((t) => [t.sold_date, t])), [totals]);
  const cells = useMemo(() => buildCalendarCells(month), [month]);
  const allAddFamilies = useMemo(() => {
    const query = addQuery.trim();
    if (!query) return [];
    const ranked = rankProductsForSearch(products, query, products.length);
    return groupProductsIntoFamilies(ranked, products.length);
  }, [addQuery, products]);
  const addFamilies = allAddFamilies.slice(0, visibleFamilyLimit);
  const hiddenFamilyCount = Math.max(0, allAddFamilies.length - addFamilies.length);

  useEffect(() => {
    const dispose = initSaleQueue();
    const unsub = subscribe((next) => setQueueSnapshot(next));
    setQueueSnapshot(getSnapshot());
    return () => {
      unsub();
      dispose();
    };
  }, []);

  useEffect(() => {
    // Once the server has the canonical record, drop the queue entry from the
    // optimistic logs list.
    const ids = new Set(logs.map((l) => Number(l.id)).filter((n) => n > 0));
    pruneSyncedToServerIds(ids);
  }, [logs]);

  // Merge queue entries for the selected date into the displayed log list.
  const displayedLogs = useMemo(() => {
    const serverIds = new Set(logs.map((l) => Number(l.id)));
    const merged: SaleLog[] = logs.map((l) => ({ ...l }));
    for (const entry of queueSnapshot.entries) {
      if (entry.soldDate !== selectedDate) continue;
      if (entry.status === 'synced' && entry.sale && serverIds.has(Number(entry.sale.id))) {
        continue;
      }
      if (entry.status === 'synced' && entry.sale) {
        merged.unshift({
          id: Number(entry.sale.id),
          product_name: entry.sale.product_name,
          quantity: Number(entry.sale.quantity),
          points_per_item: Number(entry.sale.points_per_item),
          total_points: Number(entry.sale.total_points),
          _queueKey: entry.idempotencyKey,
        });
      } else if (entry.status === 'pending' || entry.status === 'sending' || entry.status === 'failed') {
        merged.unshift({
          id: -entry.enqueuedAt,
          product_name: entry.productName,
          quantity: entry.quantity,
          points_per_item: entry.pointValue,
          total_points: entry.pointValue * entry.quantity,
          _queueKey: entry.idempotencyKey,
        });
      }
    }
    return mergeDisplayedSales(merged);
  }, [logs, queueSnapshot, selectedDate]);

  async function loadDate(date: string) {
    setSelectedDate(date);
    if (date.slice(0, 7) !== month) await loadMonth(date.slice(0, 7));
    const res = await fetch(`/api/sales/date?date=${date}`);
    if (!res.ok) return;
    const data = await res.json();
    setLogs(data.logs);
    setSummary({ total_points: data.total_points, total_items: data.total_items });
  }
  async function loadMonth(nextMonth: string) {
    setMonth(nextMonth);
    const res = await fetch(`/api/sales/month?month=${nextMonth}`);
    if (res.ok) setTotals(await res.json());
  }
  async function refreshSelected() {
    await loadDate(selectedDate);
    const res = await fetch(`/api/sales/month?month=${month}`);
    if (res.ok) setTotals(await res.json());
  }
  async function deleteLog(id: number) {
    const res = await csrfFetch(`/api/sales/${id}`, { method: 'DELETE' });
    if (res.ok) { await refreshSelected(); router.refresh(); }
  }
  async function changeQty(id: number, delta: number) {
    const res = await csrfFetch(`/api/sales/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delta }) });
    if (res.ok) { await refreshSelected(); router.refresh(); }
  }
  async function addProductToSelectedDate(variant: ProductVariant) {
    const busyKey = `${variant.productId}:${variant.variantId ?? 'base'}`;
    if (recentlyTapped === busyKey) return;
    setRecentlyTapped(busyKey);
    setTimeout(() => {
      setRecentlyTapped((current) => (current === busyKey ? null : current));
    }, TAP_DEBOUNCE_MS);
    enqueueSale({
      productId: variant.productId,
      variantId: variant.variantId ?? null,
      productName: variant.productName,
      pointValue: variant.pointValue,
      quantity: 1,
      soldDate: selectedDate,
    });
    setAddQuery('');
    setVisibleFamilyLimit(ADD_FAMILY_PAGE_SIZE);
    // Pull canonical data shortly after the queue likely lands; the optimistic row
    // gets replaced with the real one once the server response arrives via the
    // queue snapshot subscription.
    setTimeout(() => {
      void refreshSelected();
    }, 1500);
  }
  async function jumpTo(date: string) {
    await loadDate(date);
  }

  const today = tokyoToday();

  return (
    <section className="sales-page-v2">
      <PageCard className="sales-calendar-card" aria-label="月間カレンダー">
        <div className="sales-calendar-header">
          <button className="circle-button" aria-label="前の月" onClick={() => jumpTo(monthAnchorDate(month, -1))}>‹</button>
          <div className="month-title-block">
            <strong>{monthLabel(month)}</strong>
            <span>日付をタップして記録を確認</span>
          </div>
          <button className="circle-button" aria-label="次の月" onClick={() => jumpTo(monthAnchorDate(month, 1))}>›</button>
        </div>
        <div className="sales-weekdays" aria-hidden="true">
          <span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span>
        </div>
        <div className="sales-date-grid">
          {cells.map((cell) => {
            const total = totalByDate.get(cell.date);
            const isSelected = cell.date === selectedDate;
            const className = ['sales-day', !cell.inMonth ? 'muted-day' : '', isSelected ? 'selected-day-pill' : '', total ? 'has-sales' : ''].filter(Boolean).join(' ');
            return (
              <button key={cell.date} className={className} aria-pressed={isSelected} onClick={() => jumpTo(cell.date)}>
                <strong>{cell.day}</strong>
                {total && !isSelected && <span className="sales-day-dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </PageCard>

      <PageCard className="sales-detail-card" aria-label="選択日の記録">
        <div className="sales-detail-header">
          <div>
            <span className="detail-kicker">選択日</span>
            <h2>{fullDateLabel(selectedDate)}</h2>
            <p className="selected-day-total">{summary.total_items}点 · {summary.total_points}pt</p>
          </div>
          <div className="date-stepper">
            <button aria-label="前の日" onClick={() => jumpTo(shiftDate(selectedDate, -1))}>‹</button>
            <button onClick={() => jumpTo(today)}>今日</button>
            <button aria-label="次の日" onClick={() => jumpTo(shiftDate(selectedDate, 1))}>›</button>
          </div>
        </div>

        <div className="calendar-add-inline" aria-label="選択日に商品を追加">
          <label htmlFor="calendar-add-search">選択日に商品を追加</label>
          <input
            id="calendar-add-search"
            className="calendar-add-input"
            value={addQuery}
            onChange={(event) => {
              setAddQuery(event.target.value);
              setVisibleFamilyLimit(ADD_FAMILY_PAGE_SIZE);
            }}
            placeholder="商品検索"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {addQuery.trim() && (
            <div className="calendar-add-results">
              {allAddFamilies.length === 0 ? (
                <span className="muted">商品が見つかりません</span>
              ) : (
                <>
                  <div className="calendar-add-result-count" aria-live="polite">
                    全{allAddFamilies.length}件中 {addFamilies.length}件を表示
                  </div>
                  {addFamilies.map((family) => (
                    <section key={family.name} className="calendar-add-family" aria-label={`${family.name}を追加`}>
                      <strong>{family.name}</strong>
                      <div className="calendar-add-variants">
                        {family.variants.map((variant) => {
                          const busyKey = `${variant.productId}:${variant.variantId ?? 'base'}`;
                          const isDebouncing = recentlyTapped === busyKey;
                          return (
                            <button key={busyKey} onClick={() => addProductToSelectedDate(variant)} disabled={isDebouncing} title={variant.productName} aria-busy={isDebouncing}>
                              {variantDisplayLabel(variant, family)}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                  {hiddenFamilyCount > 0 && (
                    <button
                      type="button"
                      className="calendar-add-more"
                      onClick={() => setVisibleFamilyLimit((current) => current + ADD_FAMILY_PAGE_SIZE)}
                    >
                      もっと見る（残り{hiddenFamilyCount}件）
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="sales-log-scroll">
          {displayedLogs.length === 0 ? (
            <div className="sales-empty-state">
              <strong>記録はありません</strong>
              <span>別の日付を選ぶか、ここから商品を追加してください。</span>
            </div>
          ) : displayedLogs.map((log) => {
            const className = log._queueKey ? 'sales-log-card sales-log-pending' : 'sales-log-card';
            return (
              <article className={className} key={`${log._queueKey ?? 'srv'}-${log.id}`}>
                <div>
                  <strong>{log.product_name}</strong>
                  <span>×{log.quantity} = {log.total_points}pt</span>
                </div>
                <div className="small-actions sale-controls">
                  {log._queueKey ? (
                    <span className="muted" aria-hidden="true">↻</span>
                  ) : (
                    <>
                      <button aria-label={`${log.product_name}を減らす`} onClick={() => changeQty(log.id, -1)}>−</button>
                      <button aria-label={`${log.product_name}を増やす`} onClick={() => changeQty(log.id, 1)}>+</button>
                      <button className="danger-soft" onClick={() => deleteLog(log.id)}>削除</button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </PageCard>
    </section>
  );
}
