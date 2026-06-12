'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageCard } from '@/components/PageCard';
import { groupProductsIntoFamilies, rankProductsForSearch, type ProductFamily, type ProductVariant, type SearchableProduct } from '@/lib/sugi-domain';

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
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'UTC', year: 'numeric', month: 'long' }).format(new Date(Date.UTC(year, m - 1, 1)));
}
function fullDateLabel(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(Date.UTC(year, month - 1, day)));
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const totalByDate = useMemo(() => new Map(totals.map((t) => [t.sold_date, t])), [totals]);
  const cells = useMemo(() => calendarCells(month), [month]);
  const addFamilies = useMemo(() => {
    const query = addQuery.trim();
    if (!query) return [];
    const ranked = rankProductsForSearch(products, query, 40);
    return groupProductsIntoFamilies(ranked, 8);
  }, [addQuery, products]);

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
    const res = await fetch(`/api/sales/${id}`, { method: 'DELETE' });
    if (res.ok) { await refreshSelected(); router.refresh(); }
  }
  async function changeQty(id: number, delta: number) {
    const res = await fetch(`/api/sales/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delta }) });
    if (res.ok) { await refreshSelected(); router.refresh(); }
  }
  async function addProductToSelectedDate(variant: ProductVariant) {
    const busyKey = `${variant.productId}:${variant.variantId ?? 'base'}`;
    setBusyId(busyKey);
    const res = await fetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: variant.productId, variant_id: variant.variantId, quantity: 1, sold_date: selectedDate }),
    });
    setBusyId(null);
    if (res.ok) {
      setAddQuery('');
      await refreshSelected();
      router.refresh();
    }
  }
  async function jumpTo(date: string) {
    await loadDate(date);
  }

  const today = tokyoToday();

  return (
    <section className="sales-page-v2">
      <PageCard className="sales-calendar-card" aria-label="月間カレンダー">
        <div className="sales-calendar-header">
          <button className="circle-button" aria-label="前の月" onClick={() => loadMonth(shiftMonth(month, -1))}>‹</button>
          <div className="month-title-block">
            <strong>{monthLabel(month)}</strong>
            <span>日付をタップして記録を確認</span>
          </div>
          <button className="circle-button" aria-label="次の月" onClick={() => loadMonth(shiftMonth(month, 1))}>›</button>
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
            onChange={(event) => setAddQuery(event.target.value)}
            placeholder="商品検索"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {addQuery.trim() && (
            <div className="calendar-add-results">
              {addFamilies.length === 0 ? (
                <span className="muted">商品が見つかりません</span>
              ) : addFamilies.map((family) => (
                <section key={family.name} className="calendar-add-family" aria-label={`${family.name}を追加`}>
                  <strong>{family.name}</strong>
                  <div className="calendar-add-variants">
                    {family.variants.map((variant) => {
                      const busyKey = `${variant.productId}:${variant.variantId ?? 'base'}`;
                      return (
                        <button key={busyKey} onClick={() => addProductToSelectedDate(variant)} disabled={busyId === busyKey} title={variant.productName}>
                          {variantDisplayLabel(variant, family)}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="sales-log-scroll">
          {logs.length === 0 ? (
            <div className="sales-empty-state">
              <strong>記録はありません</strong>
              <span>別の日付を選ぶか、ここから商品を追加してください。</span>
            </div>
          ) : logs.map((log) => (
            <article className="sales-log-card" key={log.id}>
              <div>
                <strong>{log.product_name}</strong>
                <span>×{log.quantity} = {log.total_points}pt</span>
              </div>
              <div className="small-actions sale-controls">
                <button aria-label={`${log.product_name}を減らす`} onClick={() => changeQty(log.id, -1)}>−</button>
                <button aria-label={`${log.product_name}を増やす`} onClick={() => changeQty(log.id, 1)}>+</button>
                <button className="danger-soft" onClick={() => deleteLog(log.id)}>削除</button>
              </div>
            </article>
          ))}
        </div>
      </PageCard>
    </section>
  );
}
