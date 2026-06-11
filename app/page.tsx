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
      <section className="recent-card" aria-label="Recent sales today">
        <div className="section-heading-row">
          <div>
            <h2>Recent today</h2>
            <p>Latest logged products for quick checking.</p>
          </div>
          <a href="/sales">Edit</a>
        </div>
        <div className="recent-list">
          {today.recent.length === 0 ? (
            <div className="recent-empty-state">
              <strong>No sales yet</strong>
              <span>Use Quick log or search above to start.</span>
            </div>
          ) : today.recent.map((sale) => (
            <div className="recent-row" key={sale.id}>
              <strong>{sale.product_name}</strong>
              <span className="muted">×{sale.quantity} = {sale.total_points}pt</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
