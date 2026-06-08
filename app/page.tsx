import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { SearchProductLogger } from '@/components/SearchProductLogger';
import { currentUser } from '@/lib/auth';
import { listSearchableProducts, todaySummary } from '@/lib/sugi-db';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const [products, today] = await Promise.all([
    listSearchableProducts(user.id, '', 80),
    todaySummary(user.id),
  ]);

  return (
    <main className="shell">
      <AppHeader user={user} totalPoints={today.total_points} totalItems={today.total_items} />
      <SearchProductLogger products={products} />
      <h2 className="section-title">Recent today</h2>
      <div className="recent-list">
        {today.recent.length === 0 ? <p className="muted">No sales yet.</p> : today.recent.map((sale) => (
          <div className="recent-row" key={sale.id}>
            <strong>{sale.product_name}</strong>
            <span className="muted">×{sale.quantity} = {sale.total_points}pt</span>
          </div>
        ))}
      </div>
    </main>
  );
}
