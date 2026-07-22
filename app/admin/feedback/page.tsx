import { redirect } from 'next/navigation';
import { AdminFeedbackClient } from '@/components/AdminFeedbackClient';
import { AppHeader } from '@/components/AppHeader';
import { AppShell } from '@/components/AppShell';
import { currentUser } from '@/lib/auth';
import { listAdminFeedback } from '@/lib/sugi-feedback';

export const dynamic = 'force-dynamic';

export default async function AdminFeedbackPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');
  return (
    <AppShell>
      <AppHeader user={user} totalPoints={0} totalItems={0} activePage="admin" showMetrics={false} />
      <AdminFeedbackClient initialFeedback={await listAdminFeedback()} />
    </AppShell>
  );
}
