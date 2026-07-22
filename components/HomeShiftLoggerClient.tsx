'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { FeedbackWelcomePopup } from '@/components/FeedbackWelcomePopup';
import { NavigationChangePopup } from '@/components/NavigationChangePopup';
import { PageCard } from '@/components/PageCard';
import { SearchProductLogger } from '@/components/SearchProductLogger';
import type { SearchableProduct, TodaySale } from '@/lib/sugi-domain';
import { mergeDisplayedSales } from '@/lib/sale-display';
import {
  entriesForSaleDate,
  getSnapshot,
  initSaleQueue,
  pruneSyncedToServerIds,
  removeEntry,
  retryEntry,
  subscribe,
  type QueueEntry,
  type QueueSnapshot,
} from '@/lib/sale-queue';

type Language = 'en' | 'ja';

type Props = {
  user: { id: number; displayName: string; role?: string };
  products: SearchableProduct[];
  todayDate: string;
  today: {
    total_points: number;
    total_items: number;
    recent: TodaySale[];
  };
  showFeedbackPrompt: boolean;
  showNavigationPrompt: boolean;
};

type RecentRow = TodaySale & {
  _queueKey?: string;
  _queueStatus?: 'pending' | 'sending' | 'failed';
  _queueError?: string;
};

const LANGUAGE_STORAGE_KEY = 'sugi-language';
const LINLIN_WELCOME_USER_ID = 31;
const LINLIN_WELCOME_STORAGE_KEY = 'sugi-exclusive-welcome-user-31-v1';

const copy = {
  en: {
    recentTitle: 'Recent today',
    recentDescription: 'Latest logs. Fix mistakes here or open full history.',
    edit: 'History',
    emptyTitle: 'No sales yet',
    emptyHelp: 'Search a product above to log the first sale.',
    aria: 'Recent sales today',
    decrease: 'Decrease',
    increase: 'Increase',
    remove: 'Undo',
    fixPoints: 'Fix points',
    savePoints: 'Save points',
    pointPlaceholder: 'points',
    pointFixError: 'Could not update points',
    pendingBadge: '↻ syncing',
    failedBadge: 'failed',
    retryAria: 'Retry',
    dismissAria: 'Dismiss',
  },
  ja: {
    recentTitle: '今日の記録',
    recentDescription: '直近の記録だけ。間違えたらここで修正できます。',
    edit: '履歴',
    emptyTitle: '今日の記録はまだありません',
    emptyHelp: '上の商品検索から最初の記録をしてください。',
    aria: '今日の販売記録',
    decrease: '減らす',
    increase: '増やす',
    remove: '取消',
    fixPoints: '点数修正',
    savePoints: '点数保存',
    pointPlaceholder: '点数',
    pointFixError: '点数を更新できませんでした',
    pendingBadge: '↻ 同期中',
    failedBadge: '失敗',
    retryAria: '再送',
    dismissAria: '取り消し',
  },
} satisfies Record<Language, Record<string, string>>;

export function HomeShiftLoggerClient({ user, products, todayDate, today, showFeedbackPrompt, showNavigationPrompt }: Props) {
  const router = useRouter();
  const [language, setLanguage] = useState<Language>('ja');
  const [serverToday, setServerToday] = useState(today);
  const [queueSnapshot, setQueueSnapshot] = useState<QueueSnapshot>(() => getSnapshot());
  const [pointEdits, setPointEdits] = useState<Record<number, string>>({});
  const [pointError, setPointError] = useState<string | null>(null);
  const [showLinlinWelcome, setShowLinlinWelcome] = useState(false);
  const t = copy[language];
  const seenQueueKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    const dispose = initSaleQueue();
    const unsub = subscribe((next) => setQueueSnapshot(next));
    setQueueSnapshot(getSnapshot());
    return () => {
      unsub();
      dispose();
    };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'en' || saved === 'ja') setLanguage(saved);
  }, []);

  useEffect(() => {
    if (user.id !== LINLIN_WELCOME_USER_ID) return;
    if (localStorage.getItem(LINLIN_WELCOME_STORAGE_KEY) === 'shown') return;
    localStorage.setItem(LINLIN_WELCOME_STORAGE_KEY, 'shown');
    setShowLinlinWelcome(true);
    const timer = window.setTimeout(() => setShowLinlinWelcome(false), 3000);
    return () => window.clearTimeout(timer);
  }, [user.id]);

  useEffect(() => {
    setServerToday(today);
  }, [today]);

  useEffect(() => {
    // Prune any synced queue entries that are now represented in the server's
    // authoritative `today.recent` list. Prevents the queue from growing across
    // navigations.
    const ids = new Set(serverToday.recent.map((r) => Number(r.id)));
    pruneSyncedToServerIds(ids);
  }, [serverToday]);

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
  }

  // Build the merged recent list + display totals from the server data + queue.
  const { recent: displayedRecent, totalPoints, totalItems } = useMemo(() => {
    const todayQueueEntries = entriesForSaleDate(queueSnapshot.entries, todayDate);
    const serverIdSet = new Set(serverToday.recent.map((r) => Number(r.id)));
    const temporaryQueueIds = new Set(todayQueueEntries.map((e) => -Number(e.enqueuedAt)));
    // Start with the server's recent list. Annotate any row that has a matching
    // synced queue entry. Filter out synthetic temp rows injected by setTodaySummary:
    // the queue snapshot renders those same taps with their correct queue status.
    const queueBySaleId = new Map<number, QueueEntry>();
    for (const e of todayQueueEntries) {
      if (e.sale) queueBySaleId.set(Number(e.sale.id), e);
    }
    const rows: RecentRow[] = serverToday.recent
      .filter((row) => !temporaryQueueIds.has(Number(row.id)))
      .map((row) => {
        const q = queueBySaleId.get(Number(row.id));
        if (q) {
          const queueStatus = q.status === 'pending' || q.status === 'sending' || q.status === 'failed' ? q.status : undefined;
          return { ...row, _queueKey: q.idempotencyKey, _queueStatus: queueStatus, _queueError: q.lastError };
        }
        return row;
      });

    // Append queue entries that are not yet represented in the server data.
    // pending/sending/failed show as optimistic rows; synced show as the real sale.
    let optimisticPoints = 0;
    let optimisticItems = 0;
    let syncedTodayPoints = serverToday.total_points;
    let syncedTodayItems = serverToday.total_items;
    for (const entry of todayQueueEntries) {
      const already = entry.sale ? serverIdSet.has(Number(entry.sale.id)) : false;
      if (already) continue;
      if (entry.status === 'synced' && entry.sale) {
        rows.unshift({
          id: Number(entry.sale.id),
          product_name: entry.sale.product_name,
          quantity: Number(entry.sale.quantity),
          points_per_item: Number(entry.sale.points_per_item),
          total_points: Number(entry.sale.total_points),
          _queueKey: entry.idempotencyKey,
          _queueStatus: undefined,
        });
        // A repeated tap now returns the same cumulative sale row. Use the largest
        // authoritative daily totals instead of summing cumulative responses.
        syncedTodayPoints = Math.max(syncedTodayPoints, Number(entry.sale.today_total));
        syncedTodayItems = Math.max(syncedTodayItems, Number(entry.sale.today_items));
      } else if (entry.status === 'pending' || entry.status === 'sending' || entry.status === 'failed') {
        const total = entry.pointValue * entry.quantity;
        const tempId = -entry.enqueuedAt;
        rows.unshift({
          id: tempId,
          product_name: entry.productName,
          quantity: entry.quantity,
          points_per_item: entry.pointValue,
          total_points: total,
          _queueKey: entry.idempotencyKey,
          _queueStatus: entry.status,
          _queueError: entry.lastError,
        });
        optimisticPoints += total;
        optimisticItems += entry.quantity;
      }
    }

    return {
      recent: mergeDisplayedSales(rows).slice(0, 8),
      totalPoints: syncedTodayPoints + optimisticPoints,
      totalItems: syncedTodayItems + optimisticItems,
    };
  }, [serverToday, queueSnapshot, todayDate]);

  const setTodaySummary = useCallback((sale: TodaySale & { today_total: number; today_items: number }, queueKey: string) => {
    if (seenQueueKeys.current.has(queueKey)) return;
    seenQueueKeys.current.add(queueKey);
    setServerToday((current) => ({
      total_points: current.total_points,
      total_items: current.total_items,
      recent: [sale, ...current.recent.filter((item) => item.id !== sale.id)].slice(0, 8),
    }));
  }, []);

  const onQuickAddCreated = useCallback((sale: TodaySale & { today_total: number; today_items: number }, queueKey: string) => {
    setTodaySummary(sale, queueKey);
  }, [setTodaySummary]);

  function handleRetry(key: string) {
    retryEntry(key);
  }

  function handleDismiss(key: string) {
    removeEntry(key);
  }

  async function changeRecentQty(id: number, delta: number) {
    const res = await fetch(`/api/sales/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta }),
    });
    if (res.ok) router.refresh();
  }

  async function deleteRecentSale(id: number, queueKey?: string) {
    setPointError(null);
    const res = await fetch(`/api/sales/${id}`, { method: 'DELETE' });
    if (res.ok || res.status === 404) {
      setServerToday((current) => {
        const removed = current.recent.find((item) => item.id === id);
        return {
          total_points: Math.max(0, current.total_points - Number(removed?.total_points ?? 0)),
          total_items: Math.max(0, current.total_items - Number(removed?.quantity ?? 0)),
          recent: current.recent.filter((item) => item.id !== id),
        };
      });
      if (queueKey) removeEntry(queueKey);
      router.refresh();
    }
  }

  async function saveSalePoints(id: number, fallbackPoints: number) {
    const rawPointEdit = pointEdits[id] || String(fallbackPoints);
    const normalizedPointEdit = rawPointEdit.normalize('NFKC').trim();
    const nextPoints = Number(normalizedPointEdit);
    if (!Number.isFinite(nextPoints) || nextPoints <= 0) {
      setPointError(t.pointFixError);
      return;
    }
    const res = await fetch(`/api/sales/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ point_value: nextPoints }),
    });
    if (!res.ok) {
      setPointError(t.pointFixError);
      return;
    }
    setPointError(null);
    setPointEdits((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    router.refresh();
  }

  return (
    <>
      <NavigationChangePopup initialOpen={showNavigationPrompt} />
      <FeedbackWelcomePopup initialOpen={showFeedbackPrompt} />
      {showLinlinWelcome && (
        <div className="exclusive-welcome-popup" role="status" aria-live="polite">
          <div className="exclusive-welcome-card">
            <span className="exclusive-welcome-badge">Exclusive</span>
            <strong>linlinさん、ようこそ</strong>
            <span>今日も一緒にスムーズに記録しましょう。</span>
          </div>
        </div>
      )}
      <AppHeader
        user={user}
        totalPoints={totalPoints}
        totalItems={totalItems}
        language={language}
        onLanguageChange={changeLanguage}
        activePage="home"
      />
      <SearchProductLogger products={products} language={language} setTodaySummary={setTodaySummary} onQuickAddCreated={onQuickAddCreated} />
      <PageCard
        title={t.recentTitle}
        description={t.recentDescription}
        action={<a href="/sales">{t.edit}</a>}
        className="recent-card"
        aria-label={t.aria}
      >
        <div className="recent-list">
          {pointError && <div className="error">{pointError}</div>}
          {displayedRecent.length === 0 ? (
            <div className="recent-empty-state cute-empty-state">
              <span className="empty-paw empty-paw-left" aria-hidden="true" />
              <span className="empty-paw empty-paw-right" aria-hidden="true" />
              <strong><span className="empty-sparkle" aria-hidden="true">✦</span>{t.emptyTitle}</strong>
              <span className="empty-divider" aria-hidden="true"><i /></span>
              <span>{t.emptyHelp}</span>
            </div>
          ) : displayedRecent.map((sale) => {
            const queueStatus = sale._queueStatus;
            const rowClass = queueStatus === 'pending' || queueStatus === 'sending'
              ? 'recent-row recent-correction-row recent-pending'
              : queueStatus === 'failed'
                ? 'recent-row recent-correction-row recent-failed'
                : 'recent-row recent-correction-row';
            return (
              <div className={rowClass} key={`${sale._queueKey ?? 'srv'}-${sale.id}`}>
                <div>
                  <strong>{sale.product_name}</strong>
                  <span className="muted">×{sale.quantity} = {sale.total_points}pt</span>
                  {queueStatus === 'pending' || queueStatus === 'sending' ? (
                    <span className="queue-badge queue-badge-pending" aria-live="polite">{t.pendingBadge}</span>
                  ) : null}
                  {queueStatus === 'failed' ? (
                    <span className="queue-badge queue-badge-failed" role="alert">{t.failedBadge}</span>
                  ) : null}
                  {!queueStatus && (
                    <div className="point-fix-inline">
                      <input
                        aria-label={`${t.fixPoints} ${sale.product_name}`}
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max="9999"
                        value={pointEdits[sale.id] ?? String(sale.points_per_item)}
                        onChange={(event) => setPointEdits((current) => ({ ...current, [sale.id]: event.target.value }))}
                        placeholder={t.pointPlaceholder}
                      />
                      <button type="button" onClick={() => saveSalePoints(sale.id, sale.points_per_item)}>{t.savePoints}</button>
                    </div>
                  )}
                </div>
                <div className="recent-actions">
                  {queueStatus === 'failed' && sale._queueKey ? (
                    <>
                      <button type="button" aria-label={`${t.retryAria} ${sale.product_name}`} onClick={() => handleRetry(sale._queueKey!)}>{language === 'ja' ? '再送' : 'Retry'}</button>
                      <button type="button" className="danger-soft" aria-label={`${t.dismissAria} ${sale.product_name}`} onClick={() => handleDismiss(sale._queueKey!)}>{t.remove}</button>
                    </>
                  ) : !queueStatus ? (
                    <>
                      <button aria-label={`${t.decrease} ${sale.product_name}`} onClick={() => changeRecentQty(sale.id, -1)}>−</button>
                      <button aria-label={`${t.increase} ${sale.product_name}`} onClick={() => changeRecentQty(sale.id, 1)}>+</button>
                      <button className="danger-soft" onClick={() => deleteRecentSale(sale.id, sale._queueKey)}>{t.remove}</button>
                    </>
                  ) : (
                    <span className="muted" aria-hidden="true">↻</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </PageCard>
    </>
  );
}
