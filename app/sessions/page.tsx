import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { AppShell } from '@/components/AppShell';
import { ActiveDevicesClient } from '@/components/ActiveDevicesClient';
import { currentSessionClaims, currentUser } from '@/lib/auth';
import { listUserSessions } from '@/repositories/session-repository';

export const dynamic = 'force-dynamic';

export default async function SessionsPage() {
  const [user, claims] = await Promise.all([currentUser(), currentSessionClaims()]);
  if (!user || !claims) redirect('/login');
  const sessions = await listUserSessions(user.id, claims.jti);
  return (
    <AppShell>
      <AppHeader user={user} totalPoints={0} totalItems={0} activePage="sessions" showMetrics={false} />
      <ActiveDevicesClient initialSessions={sessions} />
    </AppShell>
  );
}
