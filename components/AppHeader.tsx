'use client';

import { useRouter } from 'next/navigation';

type Props = {
  user: { displayName: string; role?: string };
  totalPoints: number;
  totalItems: number;
  backHref?: string;
};

export function AppHeader({ user, totalPoints, totalItems, backHref }: Props) {
  const router = useRouter();
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }
  return (
    <header className="header home-hero">
      <div className="header-row hero-top-row">
        <div>
          {backHref ? <a className="back" href={backHref}>← Categories</a> : <div className="hero-kicker">Logged by {user.displayName}</div>}
          <h1>Shift logger</h1>
        </div>
        <button className="logout" onClick={logout}>Logout</button>
      </div>
      <nav className="nav hero-nav" aria-label="Main navigation">
        <a href="/" aria-current="page">Home</a>
        <a href="/sales">Open calendar</a>
        {user.role === 'admin' && <a href="/admin">Admin</a>}
      </nav>
      <div className="hero-metrics" aria-label="Today summary">
        <div className="hero-metric primary"><span>Today logged</span><strong>{totalItems}</strong><small>items</small></div>
        <div className="hero-metric"><span>Points</span><strong>{totalPoints}pt</strong><small>today</small></div>
      </div>
    </header>
  );
}
