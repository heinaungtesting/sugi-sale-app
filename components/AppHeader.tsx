'use client';

import { useRouter } from 'next/navigation';

type Props = {
  user: { displayName: string };
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
    <header className="header">
      <div className="header-row">
        <div>
          {backHref ? <a className="back" href={backHref}>← Categories</a> : <div className="muted" style={{ color: 'rgba(255,255,255,.85)' }}>Logged by</div>}
          <div className="user-name">{user.displayName}</div>
        </div>
        <button className="logout" onClick={logout}>Logout</button>
      </div>
      <div className="stats">
        <div className="stat"><span>Today</span><strong>{totalPoints}pt</strong></div>
        <div className="stat"><span>Items</span><strong>{totalItems}</strong></div>
      </div>
    </header>
  );
}
