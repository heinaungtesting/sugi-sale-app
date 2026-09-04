import { AppShell } from '@/components/AppShell';
import { PageCard } from '@/components/PageCard';

export default function Loading() {
  return (
    <AppShell>
      <PageCard>
        <div role="status" aria-live="polite" aria-busy="true">
          <strong>読み込み中…</strong>
          <p>画面を準備しています。</p>
        </div>
      </PageCard>
    </AppShell>
  );
}
