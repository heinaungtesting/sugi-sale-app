import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { AppShell } from '@/components/AppShell';
import { SalesCalendarClient } from '@/components/SalesCalendarClient';
import { currentUser } from '@/lib/auth';
import { listSearchableProducts, salesByDate, salesByMonth, todaySaleDate } from '@/lib/sugi-db';

export const dynamic = 'force-dynamic';

export default async function SalesPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const todayDate = todaySaleDate();
  const month = todayDate.slice(0, 7);
  const [products, monthTotals, day] = await Promise.all([
    listSearchableProducts(user.id, '', 300),
    salesByMonth(user.id, month),
    salesByDate(user.id, todayDate),
  ]);
  return (
    <AppShell>
      <AppHeader user={user} totalPoints={day.total_points} totalItems={day.total_items} activePage="sales" />
      <SalesCalendarClient products={products} initialMonth={month} initialDate={todayDate} monthTotals={monthTotals} day={day} />
    </AppShell>
  );
}
