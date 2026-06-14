import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { AdminClient } from '@/components/AdminClient';
import { currentUser } from '@/lib/auth';
import { listAdminProducts, listAdminUsers } from '@/lib/sugi-admin-db';
import { todaySummary } from '@/lib/sugi-db';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');
  const [today, users, products] = await Promise.all([todaySummary(user.id), listAdminUsers(), listAdminProducts()]);
  return (
    <main className="shell admin-shell">
      <AppHeader user={user} totalPoints={today.total_points} totalItems={today.total_items} />
      <AdminClient initialUsers={users as any} initialProducts={products as any} />
    </main>
  );
}
