'use client';

import { useState, type FormEvent } from 'react';
import { csrfFetch } from '@/lib/csrf-client';
import { FEEDBACK_CATEGORIES, type FeedbackCategory, type UserFeedback } from '@/lib/sugi-feedback-types';

type Props = {
  initialFeedback: UserFeedback[];
};

function japaneseDate(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function FeedbackForm({ initialFeedback }: Props) {
  const [category, setCategory] = useState<FeedbackCategory>('改善案');
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState(initialFeedback);
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === 'sending') return;
    setStatus('sending');
    setError('');
    try {
      const response = await csrfFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, message }),
      });
      const body = await response.json().catch(() => ({})) as UserFeedback & { error?: string };
      if (!response.ok) throw new Error(body.error || '送信できませんでした');
      setFeedback((current) => [body, ...current].slice(0, 10));
      setMessage('');
      setStatus('success');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '送信できませんでした');
      setStatus('error');
    }
  }

  return (
    <div className="feedback-page-content">
      <section className="feedback-guide" aria-labelledby="feedback-guide-title">
        <h2 id="feedback-guide-title">書き方ガイド</h2>
        <p>次の3点があると、状況を正確に確認できます。</p>
        <ol>
          <li><strong>画面：</strong>ホーム、履歴、全記録など</li>
          <li><strong>状況：</strong>何を押したとき、何が起きたか</li>
          <li><strong>希望：</strong>どう変わると使いやすいか</li>
        </ol>
        <div className="feedback-example">
          <strong>記入例</strong>
          <span>「履歴画面で商品を探すとき、結果が多くて目的の商品を見つけにくいです。カテゴリーで絞り込めると使いやすいです。」</span>
        </div>
        <p className="feedback-privacy-note">お客様の氏名、電話番号、薬歴などの個人情報は入力しないでください。</p>
      </section>

      <form className="feedback-form" onSubmit={submit}>
        <label>
          ご意見の種類
          <select value={category} onChange={(event) => setCategory(event.target.value as FeedbackCategory)}>
            {FEEDBACK_CATEGORIES.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
        <label>
          内容
          <textarea
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              if (status !== 'sending') setStatus('idle');
            }}
            minLength={10}
            maxLength={1000}
            rows={8}
            required
            placeholder="困っている画面、起きたこと、希望する改善を書いてください。"
          />
        </label>
        <div className="feedback-character-count">{message.length} / 1000文字</div>
        {status === 'success' && <div className="feedback-success" role="status">送信しました。ご協力ありがとうございます。</div>}
        {status === 'error' && <div className="error" role="alert">{error}</div>}
        <button className="feedback-submit" type="submit" disabled={status === 'sending' || message.trim().length < 10}>
          {status === 'sending' ? '送信中…' : '送信する'}
        </button>
      </form>

      <section className="feedback-history" aria-labelledby="feedback-history-title">
        <h2 id="feedback-history-title">送信したご意見</h2>
        {feedback.length === 0 ? (
          <p className="muted">まだ送信したご意見はありません。</p>
        ) : (
          <div className="feedback-history-list">
            {feedback.map((item) => (
              <article key={item.id}>
                <div><strong>{item.category}</strong><span className={`feedback-status status-${item.status}`}>{item.status}</span></div>
                <p>{item.message}</p>
                <time dateTime={item.created_at}>{japaneseDate(item.created_at)}</time>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
