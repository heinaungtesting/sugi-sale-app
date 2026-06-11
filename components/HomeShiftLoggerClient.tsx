'use client';

import { useState } from 'react';
import { AppHeader } from '@/components/AppHeader';
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

const copy = {
  en: {
    recentTitle: 'Recent today',
    recentDescription: 'Latest logged products for quick checking.',
    edit: 'Edit',
    emptyTitle: 'No sales yet',
    emptyHelp: 'Use Quick log or search above to start.',
    aria: 'Recent sales today',
  },
  ja: {
    recentTitle: '今日の記録',
    recentDescription: '直近で記録した商品を確認できます。',
    edit: '編集',
    emptyTitle: '今日の記録はまだありません',
    emptyHelp: 'すぐ記録または検索から始めてください。',
    aria: '今日の販売記録',
  },
} satisfies Record<Language, Record<string, string>>;

export function HomeShiftLoggerClient({ user, products, today }: Props) {
  const [language, setLanguage] = useState<Language>('en');
  const t = copy[language];

  return (
    <>
      <AppHeader
        user={user}
        totalPoints={today.total_points}
        totalItems={today.total_items}
        language={language}
        onLanguageChange={setLanguage}
      />
      <SearchProductLogger products={products} language={language} />
      <section className="recent-card" aria-label={t.aria}>
        <div className="section-heading-row">
          <div>
            <h2>{t.recentTitle}</h2>
            <p>{t.recentDescription}</p>
          </div>
          <a href="/sales">{t.edit}</a>
        </div>
        <div className="recent-list">
          {today.recent.length === 0 ? (
            <div className="recent-empty-state">
              <strong>{t.emptyTitle}</strong>
              <span>{t.emptyHelp}</span>
            </div>
          ) : today.recent.map((sale) => (
            <div className="recent-row" key={sale.id}>
              <strong>{sale.product_name}</strong>
              <span className="muted">×{sale.quantity} = {sale.total_points}pt</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
