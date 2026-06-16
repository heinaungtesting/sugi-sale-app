'use client';

import { useEffect, useState } from 'react';
import { getSnapshot, initSaleQueue, subscribe, type QueueSnapshot } from '@/lib/sale-queue';

type Language = 'en' | 'ja';

type Props = {
  language?: Language;
};

const copy = {
  en: {
    online: 'Online',
    offline: 'Offline',
    syncing: 'Syncing',
    pending: (n: number) => `${n} pending`,
    failed: (n: number) => `${n} failed`,
  },
  ja: {
    online: 'オンライン',
    offline: 'オフライン',
    syncing: '同期中',
    pending: (n: number) => `保留 ${n}件`,
    failed: (n: number) => `失敗 ${n}件`,
  },
} satisfies Record<Language, Record<string, unknown>>;

function classify(snap: QueueSnapshot): 'online' | 'offline' | 'syncing' {
  if (!snap.online) return 'offline';
  if (snap.draining || snap.pendingCount > 0) return 'syncing';
  if (!snap.healthy) return 'syncing';
  return 'online';
}

function labelFor(state: 'online' | 'offline' | 'syncing', snap: QueueSnapshot, t: typeof copy.en): string {
  if (state === 'offline') return snap.pendingCount > 0 ? `${t.offline} · ${t.pending(snap.pendingCount)}` : t.offline;
  if (state === 'syncing') return snap.pendingCount > 0 ? `${t.syncing} ${snap.pendingCount}件` : t.syncing;
  if (snap.failedCount > 0) return t.failed(snap.failedCount);
  return t.online;
}

export function ConnectivityIndicator({ language = 'ja' }: Props) {
  const [snap, setSnap] = useState<QueueSnapshot | null>(null);
  const t = copy[language];

  useEffect(() => {
    const dispose = initSaleQueue();
    const unsub = subscribe((next) => setSnap(next));
    // If the queue has not been initialised yet (SSR/early paint), getSnapshot still
    // returns a valid empty snapshot so the pill can render.
    setSnap((current) => current ?? getSnapshot());
    return () => {
      unsub();
      dispose();
    };
  }, []);

  const state: 'online' | 'offline' | 'syncing' = snap ? classify(snap) : 'online';
  const label = snap ? labelFor(state, snap, t) : t.online;

  return (
    <div
      className={`connectivity-pill connectivity-${state}`}
      role="status"
      aria-live="polite"
      aria-label={label}
      data-state={state}
      data-pending={snap?.pendingCount ?? 0}
      data-failed={snap?.failedCount ?? 0}
    >
      <span className="connectivity-dot" aria-hidden="true" />
      <span className="connectivity-label">{label}</span>
    </div>
  );
}
