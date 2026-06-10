import { redirect } from 'next/navigation';
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
    listSearchableProducts(user.id, '', 100),
    salesByMonth(user.id, month),
    salesByDate(user.id, todayDate),
  ]);
  return (
    <main className="sales-shell">
      <header className="sales-topbar">
        <div>
          <p className="sales-eyebrow">Sugi Logger</p>
          <h1>Sales</h1>
        </div>
        <nav className="sales-nav" aria-label="Sales navigation">
          <a href="/">Home</a>
          <a href="/sales" aria-current="page">Sales</a>
          {user.role === 'admin' && <a href="/admin">Admin</a>}
        </nav>
      </header>
      <SalesCalendarClient products={products} initialMonth={month} initialDate={todayDate} monthTotals={monthTotals} day={day} />
    </main>
  );
}
