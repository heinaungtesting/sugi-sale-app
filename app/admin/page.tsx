import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { AdminClient } from '@/components/AdminClient';
import { currentUser } from '@/lib/auth';
import { listAdminProducts, listAdminUsers } from '@/lib/sugi-admin-db';
import { listAdminActivity } from '@/lib/sugi-activity';
import { todaySummary } from '@/lib/sugi-db';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');
  const [today, users, products, activity] = await Promise.all([todaySummary(user.id), listAdminUsers(), listAdminProducts(), listAdminActivity()]);
  return (
    <main className="shell admin-shell">
      <AppHeader user={user} totalPoints={today.total_points} totalItems={today.total_items} activePage="admin" />
      <img
        src="/cute/v2-admin-record-review.webp"
        alt=""
        aria-hidden="true"
        className="admin-hero-record-review"
      />
      <AdminClient initialUsers={users as any} initialProducts={products as any} initialActivity={activity as any} />
    </main>
  );
}
