'use client';

import { useState } from 'react';
import { csrfFetch } from '@/lib/csrf-client';

type Props = {
  initialOpen: boolean;
};

export function FeedbackWelcomePopup({ initialOpen }: Props) {
  const [open, setOpen] = useState(initialOpen);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function finish(destination?: string) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await csrfFetch('/api/feedback/prompt', { method: 'POST' });
      if (!response.ok) throw new Error('prompt update failed');
      if (destination) {
        window.location.assign(destination);
        return;
      }
      setOpen(false);
    } catch {
      // Keep the prompt eligible for a future login if persistence failed, but do
      // not trap the user in a modal during the current session.
      if (destination) window.location.assign(destination);
      else setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="feedback-popup-backdrop" role="presentation">
      <section className="feedback-popup" role="dialog" aria-modal="true" aria-labelledby="feedback-popup-title">
        <span className="feedback-popup-kicker">はじめてのご案内</span>
        <h2 id="feedback-popup-title">ご意見を聞かせてください</h2>
        <p>このアプリをもっと使いやすくするため、気づいたことを日本語で送れるページを追加しました。</p>
        <div className="feedback-mini-guide" aria-label="書き方ガイド">
          <strong>書き方ガイド</strong>
          <ol>
            <li>どの画面で困ったか</li>
            <li>何が起きたか</li>
            <li>どうなると使いやすいか</li>
          </ol>
        </div>
        <p className="feedback-privacy-note">お客様の氏名・電話番号などの個人情報は入力しないでください。</p>
        <div className="feedback-popup-actions">
          <button className="feedback-primary" type="button" disabled={busy} onClick={() => void finish('/feedback')}>ご意見を書く</button>
          <button className="feedback-secondary" type="button" disabled={busy} onClick={() => void finish()}>閉じる</button>
        </div>
        <small>この案内は一度だけ表示されます。</small>
      </section>
    </div>
  );
}
