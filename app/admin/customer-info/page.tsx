import { redirect } from 'next/navigation';
import { AdminCustomerInfoClient } from '@/components/AdminCustomerInfoClient';
import { AppHeader } from '@/components/AppHeader';
import { AppShell } from '@/components/AppShell';
import { currentUser } from '@/lib/auth';
import { listReviewQueue } from '@/repositories/customer-info-repository';

export const dynamic = 'force-dynamic';

export default async function AdminCustomerInfoPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');
  return (
    <AppShell>
      <AppHeader user={user} totalPoints={0} totalItems={0} activePage="admin" showMetrics={false} />
      <AdminCustomerInfoClient initialQueue={await listReviewQueue()} />
    </AppShell>
  );
}
