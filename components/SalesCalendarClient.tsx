'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { groupProductsIntoFamilies, rankProductsForSearch, type ProductVariant, type SearchableProduct } from '@/lib/sugi-domain';

type MonthTotal = { sold_date: string; total_points: number; total_items: number };
type SaleLog = { id: number; product_name: string; quantity: number; total_points: number; points_per_item: number };

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

function tokyoToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function shiftMonth(month: string, delta: number) {
  const [year, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
function daysForMonth(month: string) {
  const [year, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, m - 1, 1));
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { blank: first.getUTCDay(), days: Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`) };
}

export function SalesCalendarClient({ products, initialMonth, initialDate, monthTotals, day }: Props) {
  const router = useRouter();
  const [month, setMonth] = useState(initialMonth);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [totals, setTotals] = useState(monthTotals);
  const [logs, setLogs] = useState(day.logs);
  const [summary, setSummary] = useState({ total_points: day.total_points, total_items: day.total_items });
  const [query, setQuery] = useState('');
  const totalByDate = useMemo(() => new Map(totals.map((t) => [t.sold_date, t])), [totals]);
  const calendar = daysForMonth(month);
  const families = useMemo(() => groupProductsIntoFamilies(rankProductsForSearch(products, query, query.trim() ? 60 : 80), query.trim() ? 20 : 10), [products, query]);

  async function loadDate(date: string) {
    setSelectedDate(date);
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
    if (res.ok) { await refreshSelected(); router.refresh(); }
  }
  async function deleteLog(id: number) {
    const res = await fetch(`/api/sales/${id}`, { method: 'DELETE' });
    if (res.ok) { await refreshSelected(); router.refresh(); }
  }
  async function changeQty(id: number, delta: number) {
    const res = await fetch(`/api/sales/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delta }) });
    if (res.ok) { await refreshSelected(); router.refresh(); }
  }

  const today = tokyoToday();
  return (
    <section className="sales-page">
      <div className="month-header">
        <button onClick={() => loadMonth(shiftMonth(month, -1))}>‹ Prev</button>
        <strong>{monthLabel(month)}</strong>
        <button onClick={() => { const m = today.slice(0, 7); loadMonth(m); loadDate(today); }}>Today</button>
        <button onClick={() => loadMonth(shiftMonth(month, 1))}>Next ›</button>
      </div>
      <div className="calendar-grid">
        <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
        {Array.from({ length: calendar.blank }).map((_, i) => <span key={`b${i}`} />)}
        {calendar.days.map((date) => {
          const total = totalByDate.get(date);
          return <button key={date} className={date === selectedDate ? 'day selected' : 'day'} onClick={() => loadDate(date)}><strong>{Number(date.slice(-2))}</strong>{total && <small>{total.total_points}pt</small>}</button>;
        })}
      </div>
      <h2 className="section-title">Selected: {selectedDate}</h2>
      <p className="muted">Total: {summary.total_points}pt / {summary.total_items} item</p>
      <div className="recent-list">
        {logs.length === 0 ? <p className="muted">No sales for this date.</p> : logs.map((log) => (
          <div className="recent-row sale-edit-row" key={log.id}>
            <div><strong>{log.product_name}</strong><span className="muted">×{log.quantity} = {log.total_points}pt</span></div>
            <div className="small-actions"><button onClick={() => changeQty(log.id, -1)}>−</button><button onClick={() => changeQty(log.id, 1)}>+</button><button onClick={() => deleteLog(log.id)}>Delete</button></div>
          </div>
        ))}
      </div>
      <div className="add-sale-panel">
        <h3>Add product to {selectedDate}</h3>
        <input className="search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search product" />
        <div className="family-list">
          {families.map((family) => <section key={family.name} className="family-card"><h3>{family.name}</h3><div className="variant-grid">{family.variants.map((variant) => <button key={`${variant.productId}:${variant.variantId ?? 'base'}`} className="variant-button" onClick={() => addVariant(variant)}>{variant.label}</button>)}</div></section>)}
        </div>
      </div>
    </section>
  );
}
