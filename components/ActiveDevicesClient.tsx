'use client';

import { useState } from 'react';
import { csrfFetch } from '@/lib/csrf-client';
import type { SessionDevice } from '@/repositories/session-repository';

function date(value: string) {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function ActiveDevicesClient({ initialSessions }: { initialSessions: SessionDevice[] }) {
  const [sessions, setSessions] = useState(initialSessions);
  const [busy, setBusy] = useState(false);

  async function revoke(jti: string) {
    setBusy(true);
    const response = await csrfFetch('/api/sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jti }),
    });
    if (response.ok) setSessions((current) => current.filter((session) => session.jti !== jti));
    setBusy(false);
  }

  async function revokeOthers() {
    if (!window.confirm('現在の端末以外をすべてログアウトしますか？')) return;
    setBusy(true);
    const response = await csrfFetch('/api/sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'revoke_others' }),
    });
    if (response.ok) setSessions((current) => current.filter((session) => session.current));
    setBusy(false);
  }

  return (
    <section className="page-card devices-card">
      <div className="devices-heading">
        <div><span className="admin-kicker">Security</span><h1>アクティブな端末</h1></div>
        <button type="button" className="danger-soft" onClick={revokeOthers} disabled={busy || sessions.length <= 1}>他の端末をすべてログアウト</button>
      </div>
      <p className="muted">PINを変更すると、すべての端末が自動的にログアウトします。最大10セッションまで保持されます。</p>
      <div className="device-list">
        {sessions.map((session) => (
          <article className="device-row" key={session.jti}>
            <div>
              <strong>{session.device_label}{session.current ? '（この端末）' : ''}</strong>
              <span>最終使用: {date(session.last_used_at)}</span>
              <span>ログイン: {date(session.created_at)}</span>
            </div>
            {!session.current && <button type="button" onClick={() => revoke(session.jti)} disabled={busy}>ログアウト</button>}
          </article>
        ))}
      </div>
    </section>
  );
}
