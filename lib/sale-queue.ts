'use client';

// Persistent offline-aware sale log queue.
//
// Goals:
//  - A tap on a variant is registered instantly (optimistic UI) and never blocks on the
//    network. The tap is stored in an IndexedDB-backed queue and drained in the
//    background.
//  - Every queued entry carries a stable idempotency key. The server deduplicates by
//    (user_id, idempotency_key), so a retry that succeeds after a previous request
//    actually persisted never double-counts the sale.
//  - Transient failures retry with backoff and remain pending for later recovery.
//    Permanent request errors become `failed` so the user can correct them manually.
//  - Online/offline state is tracked via navigator.onLine + 'online'/'offline' events
//    plus a periodic /api/health probe. Multi-tab sync uses BroadcastChannel.
//
// This module is client-only. It must never be imported by server code.

import type { TodaySale } from './sugi-domain';
import { claimQueueRecord, finalizeQueueRecord, loadLegacyQueueRecords, loadQueueRecords, queueStorageBackend, saveQueueRecords } from '../infrastructure/queue/indexeddb-sale-queue-store';
import { reportQueueTelemetry } from '../infrastructure/queue/queue-telemetry';
import { csrfFetch } from './csrf-client';

const HEALTH_PATH = '/api/health';
const HEALTH_INTERVAL_MS = 30 * 1000;
const HEALTH_TIMEOUT_MS = 4000;
const REQUEST_TIMEOUT_MS = 10 * 1000;
const MAX_ATTEMPTS = 4;
const BACKOFF_MS: readonly number[] = [0, 1500, 4000, 9000];
const MAX_QUEUE_SIZE = 200;
const BROADCAST_CHANNEL = 'sugi-sale-queue-v1';
const BACKGROUND_SYNC_TAG = 'sugi-sale-queue-sync';
const QUEUE_LEASE_MS = 90 * 1000;
const PAGE_QUEUE_OWNER = `page-${newIdempotencyKey()}`;
// Re-kick the drain on a short interval if pending entries exist. Without this,
// a tap that hits a transient permanent error (e.g., one bad CSRF cookie) sits
// in `pending` until the user taps again. The browser's online event is not
// always reliable, especially on iPhone Safari.
const STALE_DRAIN_INTERVAL_MS = 5 * 1000;

export type QueueStatus = 'pending' | 'sending' | 'synced' | 'failed';

const PERMANENT_QUEUE_ERRORS = new Set([
  'invalid idempotency_key',
  'invalid product_id',
  'invalid variant_id',
  'quantity must be an integer between 1 and 99',
  'invalid sold_date',
  'queued sale owner mismatch',
  'product not found',
]);

/** Classify legacy failed records that do not yet carry an explicit retry flag. */
export function isRetryableStoredQueueError(error?: string): boolean {
  const normalized = String(error ?? '').trim().toLowerCase();
  if (!normalized) return true;
  const httpStatus = /^http_(\d{3})$/.exec(normalized);
  if (httpStatus) {
    const status = Number(httpStatus[1]);
    return status === 408 || status === 429 || status >= 500;
  }
  return !PERMANENT_QUEUE_ERRORS.has(normalized);
}

export type QueueEntry = {
  /** Stable UUID for the queued tap. Server uses (user_id, idempotency_key) to dedupe. */
  idempotencyKey: string;
  /** User authenticated when the tap occurred. Never replay under another account. */
  ownerUserId: number;
  productId: number;
  variantId?: number | null;
  /** Cached product metadata for optimistic UI; the server returns the canonical name. */
  productName: string;
  pointValue: number;
  pointsSnapshot: number;
  quantity: number;
  soldDate?: string | null;
  enqueuedAt: number;
  occurredAt: string;
  createdAt: string;
  attempts: number;
  lastError?: string;
  /** Persisted failure classification so hydration can safely resume transient work. */
  retryable?: boolean;
  status: QueueStatus;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  /** Set when the server has accepted the sale. */
  sale?: TodaySale & { today_total: number; today_items: number; idempotent_replay: boolean };
};

export type QueueSnapshot = {
  entries: QueueEntry[];
  online: boolean;
  draining: boolean;
  healthy: boolean;
  pendingCount: number;
  failedCount: number;
  storageBackend: 'loading' | 'indexeddb' | 'memory';
};

type Subscriber = (snapshot: QueueSnapshot) => void;

type QueueInput = {
  ownerUserId: number;
  productId: number;
  variantId?: number | null;
  productName: string;
  pointValue: number;
  quantity: number;
  soldDate?: string | null;
};

type PostResult =
  | { ok: true; sale: TodaySale & { today_total: number; today_items: number; idempotent_replay: boolean } }
  | { ok: false; error: string; permanent: boolean };

export type AcceptedSaleReceipt = {
  idempotency_key: string;
  sale: TodaySale & { today_total: number; today_items: number; idempotent_replay: boolean };
};

export function applyAcceptedSales(queueEntries: QueueEntry[], accepted: AcceptedSaleReceipt[]): number {
  const acceptedByKey = new Map(accepted.map((item) => [item.idempotency_key, item.sale]));
  let changed = 0;
  for (const entry of queueEntries) {
    const sale = acceptedByKey.get(entry.idempotencyKey);
    if (!sale) continue;
    if (entry.status !== 'synced' || Number(entry.sale?.id) !== Number(sale.id)) changed += 1;
    entry.status = 'synced';
    entry.sale = sale;
    entry.lastError = undefined;
    delete entry.retryable;
    delete entry.leaseOwner;
    delete entry.leaseExpiresAt;
  }
  return changed;
}

let entries: QueueEntry[] = [];
let online = true;
let draining = false;
let healthy = true;
let subscribers: Set<Subscriber> = new Set();
let bc: BroadcastChannel | null = null;
let drainTimer: ReturnType<typeof setTimeout> | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;
let staleDrainTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;
let cleanup: (() => void) | null = null;
let storageBackend: QueueSnapshot['storageBackend'] = 'loading';
let telemetryTimer: ReturnType<typeof setTimeout> | null = null;
let lastTelemetryKey = '';
let reconcilingServerReceipts = false;
let activeUserId: number | null = null;

function hasBrowser(): boolean {
  return typeof window !== 'undefined';
}

function tokyoSaleDate(epochMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochMs));
}

function normalizeRecords(parsed: unknown): QueueEntry[] {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((raw): raw is Partial<QueueEntry> & Pick<QueueEntry, 'idempotencyKey' | 'productId' | 'productName' | 'status'> => {
      const e = raw as Partial<QueueEntry>;
      return !!e
        && typeof e.idempotencyKey === 'string'
        && Number.isInteger(e.ownerUserId)
        && Number(e.ownerUserId) > 0
        && typeof e.productId === 'number'
        && typeof e.productName === 'string'
        && (e.status === 'pending' || e.status === 'sending' || e.status === 'synced' || e.status === 'failed');
    })
    .map((e) => {
      const enqueuedAt = Number.isFinite(e.enqueuedAt) ? Number(e.enqueuedAt) : Date.now();
      const restored: QueueEntry = {
        ...e,
        idempotencyKey: e.idempotencyKey,
        ownerUserId: Number(e.ownerUserId),
        productId: e.productId,
        variantId: e.variantId ?? null,
        productName: e.productName,
        pointValue: Number(e.pointValue ?? e.pointsSnapshot ?? 0),
        pointsSnapshot: Number(e.pointsSnapshot ?? e.pointValue ?? 0),
        quantity: Math.max(1, Number(e.quantity ?? 1)),
        enqueuedAt,
        soldDate: e.soldDate || tokyoSaleDate(enqueuedAt),
        occurredAt: e.occurredAt || new Date(enqueuedAt).toISOString(),
        createdAt: e.createdAt || new Date(enqueuedAt).toISOString(),
        attempts: Number(e.attempts ?? 0),
        status: e.status,
      };
      const leaseExpired = Number(restored.leaseExpiresAt ?? 0) <= Date.now();
      if (restored.status === 'sending' && leaseExpired) {
        return { ...restored, status: 'pending' as const, attempts: Math.max(0, restored.attempts - 1) };
      }
      const retryableFailure = restored.retryable === true
        || (restored.retryable === undefined && isRetryableStoredQueueError(restored.lastError));
      return restored.status === 'failed' && retryableFailure
        ? { ...restored, status: 'pending' as const, retryable: true }
        : restored;
    });
}

type RegistrationWithSync = ServiceWorkerRegistration & {
  sync?: { register(tag: string): Promise<void> };
};

async function registerBackgroundSync(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready as RegistrationWithSync;
    if (registration.sync) {
      await registration.sync.register('sugi-sale-queue-sync');
    } else {
      registration.active?.postMessage({ type: 'SYNC_SALES', tag: BACKGROUND_SYNC_TAG });
    }
  } catch {
    // Existing online/pageshow/health timers remain the fallback where Background
    // Sync is unavailable (notably current iOS Safari releases).
  }
}

function persist(): void {
  if (typeof window === 'undefined') return;
  void saveQueueRecords(entries, activeUserId).then(async (backend) => {
    if (storageBackend !== backend) {
      storageBackend = backend;
      emit();
    }
    if (entries.some((entry) => entry.status === 'pending' || entry.status === 'sending')) {
      await registerBackgroundSync();
    }
  });
}

function snapshot(): QueueSnapshot {
  let pendingCount = 0;
  let failedCount = 0;
  for (const e of entries) {
    if (e.status === 'pending' || e.status === 'sending') pendingCount += 1;
    else if (e.status === 'failed') failedCount += 1;
  }
  return {
    entries: entries.slice(),
    online,
    draining,
    healthy,
    pendingCount,
    failedCount,
    storageBackend,
  };
}

function reportQueueMetrics(snap: QueueSnapshot): void {
  const key = `${snap.pendingCount}:${snap.failedCount}:${snap.storageBackend}`;
  if (key === lastTelemetryKey || telemetryTimer) return;
  telemetryTimer = setTimeout(() => {
    telemetryTimer = null;
    lastTelemetryKey = key;
    reportQueueTelemetry(snap);
  }, 1000);
}

function emit(): void {
  const snap = snapshot();
  reportQueueMetrics(snap);
  for (const sub of subscribers) {
    try {
      sub(snap);
    } catch {
      // Subscriber errors should not break the queue.
    }
  }
  if (bc) {
    try {
      bc.postMessage({ type: 'snapshot', snapshot: snap });
    } catch {
      // BroadcastChannel postMessage can fail in some sandboxed contexts.
    }
  }
}

async function hydratePersistedQueue(): Promise<void> {
  storageBackend = await queueStorageBackend();
  const persisted = normalizeRecords(await loadQueueRecords())
    .filter((entry) => entry.ownerUserId === activeUserId);
  // IndexedDB is authoritative for matching keys because the Service Worker may
  // have advanced an entry to `synced` while the page was suspended.
  const persistedKeys = new Set(persisted.map((entry) => entry.idempotencyKey));
  entries = [
    ...persisted,
    ...entries.filter((entry) => !persistedKeys.has(entry.idempotencyKey)),
  ]
    .sort((a, b) => b.enqueuedAt - a.enqueuedAt)
    .slice(0, MAX_QUEUE_SIZE);
  persist();
  emit();
  if (online) scheduleDrain(0);
}

async function reconcileAcceptedEntries(): Promise<void> {
  if (reconcilingServerReceipts) return;
  const active = entries
    .filter((entry) => entry.ownerUserId === activeUserId && entry.status !== 'synced')
    .slice(0, 100);
  if (active.length === 0) return;
  reconcilingServerReceipts = true;
  try {
    const response = await csrfFetch('/api/sales/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotency_keys: active.map((entry) => entry.idempotencyKey) }),
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return;
    const body = await response.json() as { accepted?: AcceptedSaleReceipt[] };
    if (!Array.isArray(body.accepted) || applyAcceptedSales(entries, body.accepted) === 0) return;
    storageBackend = await saveQueueRecords(entries, activeUserId);
    emit();
  } catch {
    // Normal queue retries remain the fallback when receipt reconciliation fails.
  } finally {
    reconcilingServerReceipts = false;
  }
}

function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  // Math.random fallback is fine for client-side idempotency keys — we are not
  // generating secrets, just a stable identifier for a single user-action.
  return 'sugi-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
}

function scheduleDrain(delayMs: number): void {
  if (drainTimer) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }
  drainTimer = setTimeout(() => {
    drainTimer = null;
    void drain();
  }, Math.max(0, delayMs));
}

async function postOnce(entry: QueueEntry): Promise<PostResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await csrfFetch('/api/sales', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Queue-Attempt': String(Math.max(1, entry.attempts)),
      },
      body: JSON.stringify({
        owner_user_id: entry.ownerUserId,
        product_id: entry.productId,
        variant_id: entry.variantId ?? undefined,
        quantity: entry.quantity,
        sold_date: entry.soldDate ?? undefined,
        idempotency_key: entry.idempotencyKey,
      }),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (res.ok) {
      const sale = (await res.json()) as TodaySale & { today_total: number; today_items: number; idempotent_replay: boolean };
      return { ok: true, sale };
    }
    let body: { error?: string } | null = null;
    try {
      body = (await res.json()) as { error?: string };
    } catch {
      body = null;
    }
    // Authentication/CSRF failures can recover after token refresh or login. Other
    // 4xx responses describe an invalid queued command and require user correction.
    const retryable = res.status === 401
      || res.status === 403
      || res.status === 408
      || res.status === 429
      || res.status >= 500;
    const permanent = res.status >= 400 && res.status < 500 && !retryable;
    return { ok: false, error: body?.error ?? `http_${res.status}`, permanent };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === 'AbortError') return { ok: false, error: 'timeout', permanent: false };
    return { ok: false, error: 'network', permanent: false };
  } finally {
    clearTimeout(timer);
  }
}

async function finalizeEntry(entry: QueueEntry, heldPersistentLease: boolean): Promise<void> {
  if (heldPersistentLease) {
    const finalized = await finalizeQueueRecord(entry, PAGE_QUEUE_OWNER).catch(() => null);
    if (finalized) {
      Object.assign(entry, finalized);
      if (entry.status === 'pending') void registerBackgroundSync();
      emit();
      return;
    }
    // Another worker may have taken an expired lease. Reload its authoritative
    // record and reconcile any server receipt instead of overwriting its work.
    await hydratePersistedQueue();
    await reconcileAcceptedEntries();
    return;
  }
  delete entry.leaseOwner;
  delete entry.leaseExpiresAt;
  persist();
  emit();
}

async function sendEntry(entry: QueueEntry): Promise<void> {
  if (entry.status === 'synced') return;
  if (entry.ownerUserId !== activeUserId) return;
  const claimed = await claimQueueRecord(
    entry.idempotencyKey,
    entry.ownerUserId,
    PAGE_QUEUE_OWNER,
    Date.now(),
    QUEUE_LEASE_MS,
  );
  if (!claimed) {
    if (storageBackend !== 'memory') return;
    entry.status = 'sending';
  } else {
    Object.assign(entry, claimed);
  }
  entry.attempts += 1;
  emit();
  persist();

  let lastError = 'unknown';
  let permanentFailure = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      if (!online) {
        lastError = 'offline';
        break;
      }
    }
    const result = await postOnce(entry);
    if (result.ok) {
      entry.sale = result.sale;
      entry.status = 'synced';
      entry.lastError = undefined;
      delete entry.retryable;
      await finalizeEntry(entry, claimed !== null);
      return;
    }
    lastError = result.error;
    if (result.permanent) {
      permanentFailure = true;
      break;
    }
  }
  entry.lastError = lastError;
  // Exhausting one retry pass must not make infrastructure failures terminal.
  // The periodic recovery drain will start another pass after connectivity returns.
  entry.retryable = !permanentFailure;
  entry.status = permanentFailure ? 'failed' : 'pending';
  await finalizeEntry(entry, claimed !== null);
}

async function drain(): Promise<void> {
  if (draining) return;
  if (!online) {
    // The browser has told us it is offline. Do not attempt sale POSTs here:
    // keep entries pending in IndexedDB and wait for the `online` event / health
    // probe. This is the core counter-safety behavior — taps are recorded locally,
    // but the app must not pretend an offline write reached the server.
    return;
  }
  const work = entries
    .filter((entry) => entry.ownerUserId === activeUserId && entry.status === 'pending')
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  if (work.length === 0) {
    return;
  }
  draining = true;
  emit();
  try {
    // Preserve tap order. Idempotency prevents duplicates, while one worker prevents
    // a later queued mutation from overtaking an earlier one.
    const concurrency = 1;
    let cursor = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (cursor < work.length) {
        const idx = cursor;
        cursor += 1;
        const entry = work[idx];
        if (!entry) break;
        if (entry.status !== 'pending') continue;
        await sendEntry(entry);
        if (!online && !healthy) break;
      }
    });
    await Promise.all(workers);
  } finally {
    draining = false;
    emit();
  }
}

async function probeHealth(): Promise<void> {
  if (!hasBrowser()) return;
  // navigator.onLine is unreliable on iPhone Safari — a brief flap can leave us
  // stuck in the offline state until the user reloads the tab. Always trust a
  // successful server response over the browser's online flag.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  let ok = false;
  try {
    const res = await fetch(HEALTH_PATH, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
    ok = res.ok;
  } catch {
    ok = false;
  } finally {
    clearTimeout(timer);
  }
  healthy = ok;
  if (ok && !online) {
    // Server reachable while the browser still thinks it is offline: trust the
    // probe and re-enable the drain path so queued sales actually go through.
    online = true;
    emit();
    scheduleDrain(0);
    return;
  }
  if (!ok && typeof navigator !== 'undefined' && !navigator.onLine) {
    online = false;
    healthy = false;
  }
  // If we just regained health, kick the drain.
  if (healthy && online && !draining) scheduleDrain(0);
  emit();
}

function setOnline(next: boolean): void {
  if (online === next) return;
  online = next;
  if (!online) healthy = false;
  emit();
  if (online) scheduleDrain(0);
}

/** Initialise event listeners, load the persisted queue, and kick off the first drain. */
export function initSaleQueue(userId: number): () => void {
  if (typeof window === 'undefined') return () => undefined;
  if (!Number.isInteger(userId) || userId <= 0) return () => undefined;
  if (initialized && activeUserId !== userId) {
    cleanup?.();
    entries = [];
  }
  if (initialized) return cleanup ?? (() => undefined);
  activeUserId = userId;
  initialized = true;

  // One-time synchronous compatibility read for queues created before v1.4. Every
  // ongoing write uses IndexedDB; hydration removes the legacy key after migration.
  entries = normalizeRecords(loadLegacyQueueRecords())
    .filter((entry) => entry.ownerUserId === activeUserId);
  void hydratePersistedQueue().then(() => reconcileAcceptedEntries());
  online = typeof navigator === 'undefined' ? true : navigator.onLine;
  healthy = online;

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      bc = new BroadcastChannel(BROADCAST_CHANNEL);
      bc.onmessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; snapshot?: QueueSnapshot } | null;
        if (data?.type === 'snapshot' && data.snapshot) {
          const scopedEntries = data.snapshot.entries.filter((entry) => entry.ownerUserId === activeUserId);
          const scopedSnapshot = {
            ...data.snapshot,
            entries: scopedEntries,
            pendingCount: scopedEntries.filter((entry) => entry.status === 'pending' || entry.status === 'sending').length,
            failedCount: scopedEntries.filter((entry) => entry.status === 'failed').length,
          };
          for (const sub of subscribers) {
            try {
              sub(scopedSnapshot);
            } catch {
              // ignore
            }
          }
        }
      };
    } catch {
      bc = null;
    }
  }

  const onOnline = () => setOnline(true);
  const onOffline = () => setOnline(false);
  const onPageShow = () => {
    online = navigator.onLine;
    void probeHealth();
    scheduleDrain(250);
  };
  const onServiceWorkerMessage = (event: MessageEvent) => {
    if (event.data?.type === 'SALE_QUEUE_UPDATED') {
      void hydratePersistedQueue().then(() => reconcileAcceptedEntries());
    }
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('pageshow', onPageShow);
  navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage);

  healthTimer = setInterval(() => {
    void probeHealth();
  }, HEALTH_INTERVAL_MS);

  // Periodic safety net: if any queue entry is left in `pending` because it
  // hit a transient permanent error (e.g., a stale CSRF cookie that we could
  // not refresh), retry without waiting for the user to tap again. iPhone
  // Safari in particular drops the `online` event after a Wi-Fi flap, so the
  // queue can stay pending forever otherwise.
  staleDrainTimer = setInterval(() => {
    if (online && entries.some((e) => e.status === 'pending' || e.status === 'sending' || e.status === 'failed') && !draining) {
      // IndexedDB can remain stale after iOS background replay. Confirm exact
      // idempotency receipts with the server instead of blindly resending forever.
      void hydratePersistedQueue().then(() => reconcileAcceptedEntries());
    }
  }, STALE_DRAIN_INTERVAL_MS);

  // First health probe + drain.
  void probeHealth();
  if (online) scheduleDrain(500);

  cleanup = () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('pageshow', onPageShow);
    navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
    if (staleDrainTimer) {
      clearInterval(staleDrainTimer);
      staleDrainTimer = null;
    }
    if (drainTimer) {
      clearTimeout(drainTimer);
      drainTimer = null;
    }
    if (bc) {
      try {
        bc.close();
      } catch {
        // ignore
      }
      bc = null;
    }
    if (telemetryTimer) {
      clearTimeout(telemetryTimer);
      telemetryTimer = null;
    }
    initialized = false;
  };
  return cleanup;
}

/** Subscribe to queue changes. Returns an unsubscribe function. */
export function subscribe(sub: Subscriber): () => void {
  subscribers.add(sub);
  sub(snapshot());
  return () => {
    subscribers.delete(sub);
  };
}

/** Read the current snapshot (synchronously). */
export function getSnapshot(): QueueSnapshot {
  return snapshot();
}

/** Keep a dated view from leaking older queue entries into today's UI. */
export function entriesForSaleDate(queueEntries: readonly QueueEntry[], soldDate: string): QueueEntry[] {
  return queueEntries.filter((entry) => entry.soldDate === soldDate);
}

/**
 * Enqueue a sale for background sync. Returns the optimistic queue entry, which
 * carries a temp id (negative integer) suitable for in-memory UI before the server
 * responds. The temp id is replaced by the canonical sale id once the queue entry
 * transitions to `synced`.
 */
export function enqueueSale(input: QueueInput): QueueEntry {
  const enqueuedAt = Date.now();
  const entry: QueueEntry = {
    idempotencyKey: newIdempotencyKey(),
    ownerUserId: input.ownerUserId,
    productId: input.productId,
    variantId: input.variantId ?? null,
    productName: input.productName,
    pointValue: Math.max(0, Number(input.pointValue) || 0),
    pointsSnapshot: Math.max(0, Number(input.pointValue) || 0),
    quantity: Math.max(1, Math.min(99, Math.floor(Number(input.quantity) || 1))),
    // Capture the business date at tap time. The queue may not reach the server until
    // after midnight, especially on iPhone Safari or an unstable store connection.
    soldDate: input.soldDate || tokyoSaleDate(enqueuedAt),
    enqueuedAt,
    occurredAt: new Date(enqueuedAt).toISOString(),
    createdAt: new Date(enqueuedAt).toISOString(),
    attempts: 0,
    status: 'pending',
  };
  // Prepend for newest-first UI display; drainers sort by enqueuedAt before replay.
  entries = [entry, ...entries].slice(0, MAX_QUEUE_SIZE);
  persist();
  emit();
  scheduleDrain(0);
  return entry;
}

/** Re-enqueue a previously failed entry for another retry pass. */
export function retryEntry(idempotencyKey: string): boolean {
  const entry = entries.find((e) => e.idempotencyKey === idempotencyKey);
  if (!entry) return false;
  if (entry.status !== 'failed') return false;
  entry.status = 'pending';
  entry.lastError = undefined;
  delete entry.retryable;
  persist();
  emit();
  scheduleDrain(0);
  return true;
}

/** Remove an entry from the queue (e.g. user manually undoes it). */
export function removeEntry(idempotencyKey: string): boolean {
  const before = entries.length;
  entries = entries.filter((e) => e.idempotencyKey !== idempotencyKey);
  if (entries.length === before) return false;
  persist();
  emit();
  return true;
}

/**
 * Drop all `synced` entries whose canonical sale id is present in the server-loaded
 * `today` payload. Call this from the home page after a router.refresh() to keep
 * the queue from growing unbounded.
 */
export function pruneSyncedToServerIds(serverIds: ReadonlySet<number>): number {
  let removed = 0;
  entries = entries.filter((e) => {
    if (e.status === 'synced' && e.sale && serverIds.has(Number(e.sale.id))) {
      removed += 1;
      return false;
    }
    return true;
  });
  if (removed > 0) {
    persist();
    emit();
  }
  return removed;
}

/** Test-only: reset module state. Not for production use. */
export function __resetForTests(): void {
  if (drainTimer) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
  if (staleDrainTimer) {
    clearInterval(staleDrainTimer);
    staleDrainTimer = null;
  }
  if (bc) {
    try {
      bc.close();
    } catch {
      // ignore
    }
    bc = null;
  }
  if (cleanup) {
    try {
      cleanup();
    } catch {
      // ignore
    }
  }
  entries = [];
  online = true;
  draining = false;
  healthy = true;
  subscribers = new Set();
  initialized = false;
  cleanup = null;
  storageBackend = 'loading';
  lastTelemetryKey = '';
  activeUserId = null;
}
