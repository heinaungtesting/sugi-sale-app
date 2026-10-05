import { redirect } from 'next/navigation';
import { AdminCustomerInfoClient } from '@/components/AdminCustomerInfoClient';
import { AppHeader } from '@/components/AppHeader';
import { AppShell } from '@/components/AppShell';
import { currentUser } from '@/lib/auth';
import { listReviewQueue } from '@/repositories/customer-info-repository';
import { getHermesSettings, publicHermesSettings } from '@/repositories/app-settings-repository';

export const dynamic = 'force-dynamic';

export default async function AdminCustomerInfoPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');
  const [queue, hermes] = await Promise.all([listReviewQueue(), getHermesSettings()]);
  return (
    <AppShell>
      <AppHeader user={user} totalPoints={0} totalItems={0} activePage="admin" showMetrics={false} />
      <AdminCustomerInfoClient initialQueue={queue} initialHermes={publicHermesSettings(hermes)} />
    </AppShell>
  );
}
