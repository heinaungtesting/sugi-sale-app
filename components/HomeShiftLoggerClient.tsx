'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { PageCard } from '@/components/PageCard';
import { SearchProductLogger } from '@/components/SearchProductLogger';
import type { SearchableProduct, TodaySale } from '@/lib/sugi-domain';

type Language = 'en' | 'ja';

type Props = {
  user: { displayName: string; role?: string };
  products: SearchableProduct[];
  today: {
    total_points: number;
    total_items: number;
    recent: TodaySale[];
  };
};

const LANGUAGE_STORAGE_KEY = 'sugi-language';

const copy = {
  en: {
    recentTitle: 'Recent today',
    recentDescription: 'Latest logs. Fix mistakes here or open full history.',
    edit: 'History',
    emptyTitle: 'No sales yet',
    emptyHelp: 'Search a product above to log the first sale.',
    aria: 'Recent sales today',
    decrease: 'Decrease',
    increase: 'Increase',
    remove: 'Undo',
    fixPoints: 'Fix points',
    savePoints: 'Save points',
    pointPlaceholder: 'points',
    pointFixError: 'Could not update points',
  },
  ja: {
    recentTitle: '今日の記録',
    recentDescription: '直近の記録だけ。間違えたらここで修正できます。',
    edit: '履歴',
    emptyTitle: '今日の記録はまだありません',
    emptyHelp: '上の商品検索から最初の記録をしてください。',
    aria: '今日の販売記録',
    decrease: '減らす',
    increase: '増やす',
    remove: '取消',
    fixPoints: '点数修正',
    savePoints: '点数保存',
    pointPlaceholder: '点数',
    pointFixError: '点数を更新できませんでした',
  },
} satisfies Record<Language, Record<string, string>>;

export function HomeShiftLoggerClient({ user, products, today }: Props) {
  const router = useRouter();
  const [language, setLanguage] = useState<Language>('ja');
  const [pointEdits, setPointEdits] = useState<Record<number, string>>({});
  const [pointError, setPointError] = useState<string | null>(null);
  const t = copy[language];

  useEffect(() => {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'en' || saved === 'ja') setLanguage(saved);
  }, []);

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
  }

  async function changeRecentQty(id: number, delta: number) {
    const res = await fetch(`/api/sales/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta }),
    });
    if (res.ok) router.refresh();
  }

  async function deleteRecentSale(id: number) {
    const res = await fetch(`/api/sales/${id}`, { method: 'DELETE' });
    if (res.ok) router.refresh();
  }

  async function saveSalePoints(id: number, fallbackPoints: number) {
    const nextPoints = Number(pointEdits[id] || fallbackPoints);
    if (!Number.isFinite(nextPoints) || nextPoints <= 0) {
      setPointError(t.pointFixError);
      return;
    }
    const res = await fetch(`/api/sales/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ point_value: nextPoints }),
    });
    if (!res.ok) {
      setPointError(t.pointFixError);
      return;
    }
    setPointError(null);
    setPointEdits((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    router.refresh();
  }

  return (
    <>
      <AppHeader
        user={user}
        totalPoints={today.total_points}
        totalItems={today.total_items}
        language={language}
        onLanguageChange={changeLanguage}
        activePage="home"
      />
      <SearchProductLogger products={products} language={language} />
      <PageCard
        title={t.recentTitle}
        description={t.recentDescription}
        action={<a href="/sales">{t.edit}</a>}
        className="recent-card"
        aria-label={t.aria}
      >
        <div className="recent-list">
          {pointError && <div className="error">{pointError}</div>}
          {today.recent.length === 0 ? (
            <div className="recent-empty-state">
              <strong>{t.emptyTitle}</strong>
              <span>{t.emptyHelp}</span>
            </div>
          ) : today.recent.map((sale) => (
            <div className="recent-row recent-correction-row" key={sale.id}>
              <div>
                <strong>{sale.product_name}</strong>
                <span className="muted">×{sale.quantity} = {sale.total_points}pt</span>
                <div className="point-fix-inline">
                  <input
                    aria-label={`${t.fixPoints} ${sale.product_name}`}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="9999"
                    value={pointEdits[sale.id] ?? String(sale.points_per_item)}
                    onChange={(event) => setPointEdits((current) => ({ ...current, [sale.id]: event.target.value }))}
                    placeholder={t.pointPlaceholder}
                  />
                  <button type="button" onClick={() => saveSalePoints(sale.id, sale.points_per_item)}>{t.savePoints}</button>
                </div>
              </div>
              <div className="recent-actions">
                <button aria-label={`${t.decrease} ${sale.product_name}`} onClick={() => changeRecentQty(sale.id, -1)}>−</button>
                <button aria-label={`${t.increase} ${sale.product_name}`} onClick={() => changeRecentQty(sale.id, 1)}>+</button>
                <button className="danger-soft" onClick={() => deleteRecentSale(sale.id)}>{t.remove}</button>
              </div>
            </div>
          ))}
        </div>
      </PageCard>
    </>
  );
}
