'use client';

import { useState } from 'react';
import { csrfFetch } from '@/lib/csrf-client';
import { FEEDBACK_STATUSES, type AdminFeedback, type FeedbackStatus } from '@/lib/sugi-feedback-types';

export function AdminFeedbackClient({ initialFeedback }: { initialFeedback: AdminFeedback[] }) {
  const [feedback, setFeedback] = useState(initialFeedback);
  const [filter, setFilter] = useState<'all' | FeedbackStatus>('all');
  const visible = filter === 'all' ? feedback : feedback.filter((item) => item.status === filter);

  async function changeStatus(id: number, status: FeedbackStatus) {
    const response = await csrfFetch('/api/admin/feedback', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    if (!response.ok) return;
    const updated = await response.json() as AdminFeedback;
    setFeedback((current) => current.map((item) => item.id === id ? updated : item));
  }

  return (
    <section className="admin-card admin-panel-card admin-feedback-panel">
      <div className="admin-section-header">
        <div><span className="admin-kicker">User feedback</span><h2>ご意見一覧</h2></div>
        <label className="admin-feedback-filter">表示
          <select value={filter} onChange={(event) => setFilter(event.target.value as 'all' | FeedbackStatus)}>
            <option value="all">すべて</option>
            {FEEDBACK_STATUSES.map((status) => <option value={status} key={status}>{status}</option>)}
          </select>
        </label>
      </div>
      {visible.length === 0 ? <p className="muted">該当するご意見はありません。</p> : (
        <div className="admin-feedback-list">
          {visible.map((item) => (
            <article key={item.id}>
              <div className="admin-feedback-meta">
                <strong>{item.display_name} <small>({item.username})</small></strong>
                <span>{item.category}</span>
              </div>
              <p>{item.message}</p>
              <div className="admin-feedback-actions">
                <time>{new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.created_at))}</time>
                <select aria-label={`${item.display_name}のフィードバック状態`} value={item.status} onChange={(event) => void changeStatus(item.id, event.target.value as FeedbackStatus)}>
                  {FEEDBACK_STATUSES.map((status) => <option value={status} key={status}>{status}</option>)}
                </select>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
