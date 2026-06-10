import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { SalesCalendarClient } from '@/components/SalesCalendarClient';
import { currentUser } from '@/lib/auth';
import { listSearchableProducts, salesByDate, salesByMonth, todaySaleDate, todaySummary } from '@/lib/sugi-db';

export const dynamic = 'force-dynamic';

export default async function SalesPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const todayDate = todaySaleDate();
  const month = todayDate.slice(0, 7);
  const [products, today, monthTotals, day] = await Promise.all([
    listSearchableProducts(user.id, '', 100),
    todaySummary(user.id),
    salesByMonth(user.id, month),
    salesByDate(user.id, todayDate),
  ]);
  return (
    <main className="shell">
      <AppHeader user={user} totalPoints={today.total_points} totalItems={today.total_items} />
      <SalesCalendarClient products={products} initialMonth={month} initialDate={todayDate} monthTotals={monthTotals} day={day} />
    </main>
  );
}
