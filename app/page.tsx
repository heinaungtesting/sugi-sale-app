import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { HomeShiftLoggerClient } from '@/components/HomeShiftLoggerClient';
import { currentUser } from '@/lib/auth';
import { listSearchableProducts, todaySummary } from '@/lib/sugi-db';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const [products, today] = await Promise.all([
    listSearchableProducts(user.id, '', 300),
    todaySummary(user.id),
  ]);

  return (
    <AppShell>
      <HomeShiftLoggerClient user={user} products={products} today={today} />
    </AppShell>
  );
}
