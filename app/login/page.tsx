'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, pin }),
      });
      if (!res.ok) {
        setError('Wrong username or PIN');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.token) {
        document.cookie = `sugi_session=${data.token}; Path=/; Max-Age=2592000; SameSite=Lax`;
      }
      window.location.assign('/');
    } catch {
      setError('Network error. Open with http://168.144.35.24:3100/login and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <form className="login-card" onSubmit={submit}>
        <h1>Sugi Sale Logger</h1>
        <p className="muted">Login with your pre-made user ID and PIN.</p>
        <label className="field">
          <span>User ID</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus />
        </label>
        <label className="field">
          <span>PIN</span>
          <input value={pin} onChange={(e) => setPin(e.target.value)} type="password" inputMode="numeric" autoComplete="current-password" />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={loading}>{loading ? 'Logging in...' : 'Login'}</button>
      </form>
    </main>
  );
}
