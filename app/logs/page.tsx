import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { AppShell } from '@/components/AppShell';
import { PageCard } from '@/components/PageCard';
import { currentUser } from '@/lib/auth';
import { listSalesHistory, todaySaleDate } from '@/lib/sugi-db';
import { PRODUCT_CATEGORIES, type ProductCategory } from '@/lib/sugi-domain';

export const dynamic = 'force-dynamic';

function dateLabel(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(Date.UTC(year, month - 1, day)));
}

function monthLabel(month: string) {
  const [year, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'UTC', year: 'numeric', month: 'long' }).format(new Date(Date.UTC(year, m - 1, 1)));
}

function categoryTotals(logs: Array<{ category: string; quantity: number; total_points: number }>) {
  const totals = new Map<ProductCategory, { items: number; points: number }>(PRODUCT_CATEGORIES.map((category) => [category, { items: 0, points: 0 }]));
  for (const log of logs) {
    const category = PRODUCT_CATEGORIES.includes(log.category as ProductCategory) ? log.category as ProductCategory : 'ヘルスケア';
    const current = totals.get(category) ?? { items: 0, points: 0 };
    totals.set(category, { items: current.items + log.quantity, points: current.points + log.total_points });
  }
  return PRODUCT_CATEGORIES.map((category) => ({ category, ...(totals.get(category) ?? { items: 0, points: 0 }) }));
}

export default async function LogsPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const currentMonth = todaySaleDate().slice(0, 7);
  const logs = await listSalesHistory(user.id, 500, currentMonth);
  const logbookTotalPoints = logs.reduce((sum, log) => sum + log.total_points, 0);
  const logbookTotalItems = logs.reduce((sum, log) => sum + log.quantity, 0);
  const logbookCategoryTotals = categoryTotals(logs);

  const grouped = new Map<string, typeof logs>();
  for (const log of logs) {
    grouped.set(log.sold_date, [...(grouped.get(log.sold_date) ?? []), log]);
  }

  return (
    <AppShell>
      <AppHeader
        user={user}
        totalPoints={logbookTotalPoints}
        totalItems={logbookTotalItems}
        activePage="logs"
        summaryLabel="今月の記録"
        pointsScopeLabel="合計"
      />
      <PageCard
        title="今月の商品記録"
        description={`${monthLabel(currentMonth)}の記録だけを日付ごとに表示しています。追加・修正はホームまたは履歴から行ってください。`}
        className="full-log-card"
        aria-label="今月の商品記録（日付別）"
      >
        {logs.length === 0 ? (
          <div className="sales-empty-state">
            <strong>今月の記録はまだありません</strong>
            <span>商品を記録すると、ここに日付ごとに表示されます。</span>
          </div>
        ) : (
          <div className="full-log-list">
            <section className="category-total-panel" aria-label="月合計（カテゴリ別）">
              <div className="category-total-title">月合計（カテゴリ別）</div>
              <div className="category-total-grid">
                {logbookCategoryTotals.map((total) => (
                  <div className="category-total-chip" key={total.category}>
                    <strong>{total.category}</strong>
                    <span>{total.items}点 · {total.points}pt</span>
                  </div>
                ))}
              </div>
            </section>
            {[...grouped.entries()].map(([date, dayLogs]) => {
              const dayItems = dayLogs.reduce((sum, log) => sum + log.quantity, 0);
              const dayPoints = dayLogs.reduce((sum, log) => sum + log.total_points, 0);
              const dayCategoryTotals = categoryTotals(dayLogs);
              return (
                <section className="full-log-day" key={date}>
                  <div className="full-log-day-header">
                    <h2>{dateLabel(date)}</h2>
                    <span>{dayItems}点 · {dayPoints}pt</span>
                  </div>
                  <div className="day-category-total" aria-label={`${dateLabel(date)} カテゴリ別`}>
                    <span>カテゴリ別</span>
                    {dayCategoryTotals.map((total) => (
                      <strong key={total.category}>{total.category}: {total.points}pt</strong>
                    ))}
                  </div>
                  <div className="full-log-rows">
                    {dayLogs.map((log) => (
                      <article className="full-log-row" key={log.id}>
                        <div>
                          <strong>{log.product_name}</strong>
                          <span>1点あたり{log.points_per_item}pt</span>
                        </div>
                        <span>×{log.quantity} = {log.total_points}pt</span>
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </PageCard>
    </AppShell>
  );
}
