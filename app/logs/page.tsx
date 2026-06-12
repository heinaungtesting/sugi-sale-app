import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { AppShell } from '@/components/AppShell';
import { PageCard } from '@/components/PageCard';
import { currentUser } from '@/lib/auth';
import { listSalesHistory, todaySaleDate, todaySummary } from '@/lib/sugi-db';

export const dynamic = 'force-dynamic';

function dateLabel(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(Date.UTC(year, month - 1, day)));
}

function monthLabel(month: string) {
  const [year, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'UTC', year: 'numeric', month: 'long' }).format(new Date(Date.UTC(year, m - 1, 1)));
}

export default async function LogsPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const currentMonth = todaySaleDate().slice(0, 7);
  const [today, logs] = await Promise.all([
    todaySummary(user.id),
    listSalesHistory(user.id, 500, currentMonth),
  ]);

  const grouped = new Map<string, typeof logs>();
  for (const log of logs) {
    grouped.set(log.sold_date, [...(grouped.get(log.sold_date) ?? []), log]);
  }

  return (
    <AppShell>
      <AppHeader user={user} totalPoints={today.total_points} totalItems={today.total_items} activePage="logs" />
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
            {[...grouped.entries()].map(([date, dayLogs]) => {
              const dayItems = dayLogs.reduce((sum, log) => sum + log.quantity, 0);
              const dayPoints = dayLogs.reduce((sum, log) => sum + log.total_points, 0);
              return (
                <section className="full-log-day" key={date}>
                  <div className="full-log-day-header">
                    <h2>{dateLabel(date)}</h2>
                    <span>{dayItems}点 · {dayPoints}pt</span>
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
