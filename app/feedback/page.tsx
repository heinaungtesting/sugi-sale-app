import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { AppShell } from '@/components/AppShell';
import { FeedbackForm } from '@/components/FeedbackForm';
import { PageCard } from '@/components/PageCard';
import { currentUser } from '@/lib/auth';
import { listOwnFeedback, markFeedbackPromptSeen } from '@/lib/sugi-feedback';

export const dynamic = 'force-dynamic';

export default async function FeedbackPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const feedback = await listOwnFeedback(user.id);
  await markFeedbackPromptSeen(user.id);

  return (
    <AppShell>
      <AppHeader user={user} totalPoints={0} totalItems={0} activePage="feedback" showMetrics={false} />
      <PageCard
        title="ご意見・ご要望"
        description="アプリで困ったことや、もっと使いやすくするためのアイデアを送ってください。"
        className="feedback-card"
        aria-label="ご意見・ご要望"
        action={user.role === 'admin' ? <a href="/admin/feedback">管理画面で確認</a> : undefined}
      >
        <FeedbackForm initialFeedback={feedback} />
      </PageCard>
    </AppShell>
  );
}
