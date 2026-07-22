import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { HomeShiftLoggerClient } from '@/components/HomeShiftLoggerClient';
import { currentUser } from '@/lib/auth';
import { shouldShowFeedbackPrompt } from '@/lib/sugi-feedback';
import { shouldShowNavigationPrompt } from '@/lib/sugi-navigation-notice';
import { listSearchableProducts, todaySaleDate, todaySummary } from '@/lib/sugi-db';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const [products, today, showFeedbackPrompt, showNavigationPrompt] = await Promise.all([
    listSearchableProducts(user.id, '', 300),
    todaySummary(user.id),
    shouldShowFeedbackPrompt(user.id),
    shouldShowNavigationPrompt(user.id),
  ]);

  return (
    <AppShell>
      <HomeShiftLoggerClient
        user={user}
        products={products}
        todayDate={todaySaleDate()}
        today={today}
        showNavigationPrompt={showNavigationPrompt}
        showFeedbackPrompt={!showNavigationPrompt && showFeedbackPrompt}
      />
    </AppShell>
  );
}
