'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Language = 'en' | 'ja';

type Props = {
  user: { displayName: string; role?: string };
  totalPoints: number;
  totalItems: number;
  backHref?: string;
  language?: Language;
  onLanguageChange?: (language: Language) => void;
};

const copy = {
  en: {
    loggedBy: 'Logged by',
    title: 'Shift logger',
    categories: '← Categories',
    logout: 'Logout',
    home: 'Home',
    calendar: 'Open calendar',
    admin: 'Admin',
    todayLogged: 'Today logged',
    items: 'items',
    points: 'Points',
    today: 'today',
    summaryAria: 'Today summary',
  },
  ja: {
    loggedBy: '記録者',
    title: 'シフト記録',
    categories: '← カテゴリー',
    logout: 'ログアウト',
    home: 'ホーム',
    calendar: 'カレンダー',
    admin: '管理',
    todayLogged: '今日の記録',
    items: '点',
    points: 'ポイント',
    today: '本日',
    summaryAria: '本日のサマリー',
  },
} satisfies Record<Language, Record<string, string>>;

export function AppHeader({ user, totalPoints, totalItems, backHref, language, onLanguageChange }: Props) {
  const router = useRouter();
  const [localLanguage, setLocalLanguage] = useState<Language>('en');
  const activeLanguage = language ?? localLanguage;
  const t = copy[activeLanguage];

  function switchLanguage(nextLanguage: Language) {
    setLocalLanguage(nextLanguage);
    onLanguageChange?.(nextLanguage);
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  return (
    <header className="header home-hero">
      <div className="header-row hero-top-row">
        <div>
          {backHref ? <a className="back" href={backHref}>{t.categories}</a> : <div className="hero-kicker">{t.loggedBy} {user.displayName}</div>}
          <h1>{t.title}</h1>
        </div>
        <div className="header-actions">
          <div className="language-toggle" aria-label="Language">
            <button
              className={activeLanguage === 'en' ? 'active' : ''}
              onClick={() => switchLanguage('en')}
              type="button"
            >
              English
            </button>
            <button
              className={activeLanguage === 'ja' ? 'active' : ''}
              onClick={() => switchLanguage('ja')}
              type="button"
            >
              日本語
            </button>
          </div>
          <button className="logout" onClick={logout}>{t.logout}</button>
        </div>
      </div>
      <nav className="nav hero-nav" aria-label="Main navigation">
        <a href="/" aria-current="page">{t.home}</a>
        <a href="/sales">{t.calendar}</a>
        {user.role === 'admin' && <a href="/admin">{t.admin}</a>}
      </nav>
      <div className="hero-metrics" aria-label={t.summaryAria}>
        <div className="hero-metric primary"><span>{t.todayLogged}</span><strong>{totalItems}</strong><small>{t.items}</small></div>
        <div className="hero-metric"><span>{t.points}</span><strong>{totalPoints}pt</strong><small>{t.today}</small></div>
      </div>
    </header>
  );
}
