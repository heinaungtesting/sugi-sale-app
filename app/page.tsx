import { redirect } from 'next/navigation';
import { HomeShiftLoggerClient } from '@/components/HomeShiftLoggerClient';
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
      <HomeShiftLoggerClient user={user} products={products} today={today} />
    </main>
  );
}
