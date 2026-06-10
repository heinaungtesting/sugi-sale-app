'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { groupProductsIntoFamilies, rankProductsForSearch, type ProductVariant, type SearchableProduct } from '@/lib/sugi-domain';

type MonthTotal = { sold_date: string; total_points: number; total_items: number };
type SaleLog = { id: number; product_name: string; quantity: number; total_points: number; points_per_item: number };
type CalendarCell = { date: string; day: number; inMonth: boolean };

type Props = {
  products: SearchableProduct[];
  initialMonth: string;
  initialDate: string;
  monthTotals: MonthTotal[];
  day: { total_points: number; total_items: number; logs: SaleLog[] };
};

function monthLabel(month: string) {
  const [year, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, m - 1, 1)));
}
function fullDateLabel(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, day)));
}
function tokyoToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function shiftMonth(month: string, delta: number) {
  const [year, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
function shiftDate(date: string, delta: number) {
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return d.toISOString().slice(0, 10);
}
function calendarCells(month: string): CalendarCell[] {
  const [year, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, m - 1, 1));
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - first.getUTCDay());
  return Array.from({ length: 35 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    return { date, day: d.getUTCDate(), inMonth: date.startsWith(month) };
  });
}

export function SalesCalendarClient({ products, initialMonth, initialDate, monthTotals, day }: Props) {
  const router = useRouter();
  const [month, setMonth] = useState(initialMonth);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [totals, setTotals] = useState(monthTotals);
  const [logs, setLogs] = useState(day.logs);
  const [summary, setSummary] = useState({ total_points: day.total_points, total_items: day.total_items });
  const [query, setQuery] = useState('');
  const [showAddProduct, setShowAddProduct] = useState(false);
  const totalByDate = useMemo(() => new Map(totals.map((t) => [t.sold_date, t])), [totals]);
  const cells = useMemo(() => calendarCells(month), [month]);
  const families = useMemo(() => groupProductsIntoFamilies(rankProductsForSearch(products, query, query.trim() ? 60 : 80), query.trim() ? 20 : 10), [products, query]);

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
  async function addVariant(variant: ProductVariant) {
    const res = await fetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: variant.productId, variant_id: variant.variantId, quantity: 1, sold_date: selectedDate }),
    });
    if (res.ok) {
      await refreshSelected();
      setShowAddProduct(false);
      setQuery('');
      router.refresh();
    }
  }
  async function deleteLog(id: number) {
    const res = await fetch(`/api/sales/${id}`, { method: 'DELETE' });
    if (res.ok) { await refreshSelected(); router.refresh(); }
  }
  async function changeQty(id: number, delta: number) {
    const res = await fetch(`/api/sales/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delta }) });
    if (res.ok) { await refreshSelected(); router.refresh(); }
  }
  async function jumpTo(date: string) {
    await loadDate(date);
  }

  const today = tokyoToday();
  const monthPointTotal = totals.reduce((sum, total) => sum + total.total_points, 0);
  const monthItemTotal = totals.reduce((sum, total) => sum + total.total_items, 0);
  const monthActiveDays = totals.length;

  return (
    <section className="sales-page-v2">
      <section className="sales-calendar-card" aria-label="Monthly calendar">
        <div className="sales-calendar-header">
          <button className="circle-button" aria-label="Previous month" onClick={() => loadMonth(shiftMonth(month, -1))}>‹</button>
          <div className="month-title-block">
            <strong>{monthLabel(month)}</strong>
            <span>{monthActiveDays} active day{monthActiveDays === 1 ? '' : 's'}</span>
          </div>
          <button className="circle-button" aria-label="Next month" onClick={() => loadMonth(shiftMonth(month, 1))}>›</button>
        </div>
        <div className="sales-summary-strip" aria-label="Month summary">
          <div className="summary-chip primary"><span>Month</span><strong>{monthPointTotal}pt</strong></div>
          <div className="summary-chip"><span>Items</span><strong>{monthItemTotal}</strong></div>
          <div className="summary-chip"><span>Days</span><strong>{monthActiveDays}</strong></div>
        </div>
        <div className="sales-weekdays" aria-hidden="true">
          <span>SUN</span><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span>
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
      </section>

      <section className="sales-detail-card" aria-label="Selected date sales">
        <div className="sales-detail-header">
          <div>
            <span className="detail-kicker">Selected date</span>
            <h2>{fullDateLabel(selectedDate)}</h2>
          </div>
          <div className="date-stepper">
            <button onClick={() => jumpTo(shiftDate(selectedDate, -1))}>‹</button>
            <button onClick={() => jumpTo(today)}>Today</button>
            <button onClick={() => jumpTo(shiftDate(selectedDate, 1))}>›</button>
          </div>
        </div>

        <div className="sales-summary-strip day-strip" aria-label="Selected day summary">
          <div className="summary-chip primary"><span>Points</span><strong>{summary.total_points}pt</strong></div>
          <div className="summary-chip"><span>Items</span><strong>{summary.total_items}</strong></div>
          <div className="summary-chip"><span>Logs</span><strong>{logs.length}</strong></div>
        </div>

        <div className="sales-log-scroll">
          {logs.length === 0 ? (
            <div className="sales-empty-state">
              <strong>No products logged yet</strong>
              <span>Use Quick add below to log this date.</span>
            </div>
          ) : logs.map((log) => (
            <article className="sales-log-card" key={log.id}>
              <div>
                <strong>{log.product_name}</strong>
                <span>×{log.quantity} = {log.total_points}pt</span>
              </div>
              <div className="small-actions sale-controls">
                <button aria-label={`Decrease ${log.product_name}`} onClick={() => changeQty(log.id, -1)}>−</button>
                <button aria-label={`Increase ${log.product_name}`} onClick={() => changeQty(log.id, 1)}>+</button>
                <button className="danger-soft" onClick={() => deleteLog(log.id)}>Remove</button>
              </div>
            </article>
          ))}
        </div>

        <button className="add-product-toggle" aria-expanded={showAddProduct} onClick={() => setShowAddProduct((value) => !value)}>{showAddProduct ? 'Close Quick add' : '+ Quick add'}</button>

        {showAddProduct && (
          <div className="sales-add-drawer" aria-label={`Add product to ${selectedDate}`}>
            <div className="sales-add-heading">
              <h3>Quick add</h3>
              <span>Tap a variant to log ×1</span>
            </div>
            <input className="search-input sales-search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search product or shortcut" autoFocus />
            <div className="sales-product-scroll">
              {families.map((family) => (
                <section key={family.name} className="family-card sales-family-card">
                  <h3>{family.name}</h3>
                  <div className="variant-grid">
                    {family.variants.map((variant) => <button key={`${variant.productId}:${variant.variantId ?? 'base'}`} className="variant-button" onClick={() => addVariant(variant)}>{variant.label}</button>)}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
      </section>
    </section>
  );
}
