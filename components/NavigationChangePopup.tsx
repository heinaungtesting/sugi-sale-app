'use client';

import { useState } from 'react';
import { csrfFetch } from '@/lib/csrf-client';

type Props = {
  initialOpen: boolean;
};

export function NavigationChangePopup({ initialOpen }: Props) {
  const [open, setOpen] = useState(initialOpen);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function finish() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await csrfFetch('/api/navigation/prompt', { method: 'POST' });
      if (!response.ok) throw new Error('navigation prompt update failed');
    } catch {
      // Do not trap the user if persistence temporarily fails. The announcement
      // remains eligible for a later login so it cannot be silently lost.
    } finally {
      setOpen(false);
      setBusy(false);
    }
  }

  return (
    <div className="feedback-popup-backdrop" role="presentation">
      <section className="feedback-popup navigation-change-popup" role="dialog" aria-modal="true" aria-labelledby="navigation-change-title">
        <span className="feedback-popup-kicker">新しい操作方法</span>
        <h2 id="navigation-change-title">メニューを画面下に移動しました</h2>
        <p>片手でも使いやすいように、ホーム・履歴・全記録・ご意見のメニューが画面下に固定されました。</p>
        <div className="navigation-change-preview" aria-label="新しい画面下メニュー">
          <span><i className="nav-pet dog" aria-hidden="true" />ホーム</span>
          <span><i className="nav-pet cat gray" aria-hidden="true" />履歴</span>
          <span><i className="nav-pet dog gold" aria-hidden="true" />全記録</span>
          <span><i className="nav-pet cat orange" aria-hidden="true" />ご意見</span>
        </div>
        <p className="navigation-change-tip">どの画面でも、下のメニューからすぐに移動できます。</p>
        <div className="feedback-popup-actions navigation-change-actions">
          <button className="feedback-primary" type="button" disabled={busy} onClick={() => void finish()}>わかりました</button>
        </div>
        <small>この案内は一度だけ表示されます。</small>
      </section>
    </div>
  );
}
