'use client';

// Persistent offline-aware sale log queue.
//
// Goals:
//  - A tap on a variant is registered instantly (optimistic UI) and never blocks on the
//    network. The tap is stored in a localStorage-backed queue and drained in the
//    background.
//  - Every queued entry carries a stable idempotency key. The server deduplicates by
//    (user_id, idempotency_key), so a retry that succeeds after a previous request
//    actually persisted never double-counts the sale.
//  - Failures retry with exponential backoff, then mark the entry as `failed` so the
//    user can tap to retry manually. Permanent HTTP errors (4xx other than 408/429)
//    skip retries.
//  - Online/offline state is tracked via navigator.onLine + 'online'/'offline' events
//    plus a periodic /api/health probe. Multi-tab sync uses BroadcastChannel.
//
// This module is client-only. It must never be imported by server code.

import type { TodaySale } from './sugi-domain';

const QUEUE_STORAGE_KEY = 'sugi-sale-queue-v1';
const HEALTH_PATH = '/api/health';
const HEALTH_INTERVAL_MS = 30 * 1000;
const HEALTH_TIMEOUT_MS = 4000;
const REQUEST_TIMEOUT_MS = 10 * 1000;
const MAX_ATTEMPTS = 4;
const BACKOFF_MS: readonly number[] = [0, 1500, 4000, 9000];
const MAX_QUEUE_SIZE = 200;
const BROADCAST_CHANNEL = 'sugi-sale-queue-v1';

export type QueueStatus = 'pending' | 'sending' | 'synced' | 'failed';

export type QueueEntry = {
  /** Stable UUID for the queued tap. Server uses (user_id, idempotency_key) to dedupe. */
  idempotencyKey: string;
  productId: number;
  variantId?: number | null;
  /** Cached product metadata for optimistic UI; the server returns the canonical name. */
  productName: string;
  pointValue: number;
  quantity: number;
  soldDate?: string | null;
  enqueuedAt: number;
  attempts: number;
  lastError?: string;
  status: QueueStatus;
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
};

type Subscriber = (snapshot: QueueSnapshot) => void;

type QueueInput = {
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

let entries: QueueEntry[] = [];
let online = true;
let draining = false;
let healthy = true;
let subscribers: Set<Subscriber> = new Set();
let bc: BroadcastChannel | null = null;
let drainTimer: ReturnType<typeof setTimeout> | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;
let cleanup: (() => void) | null = null;

function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function load(): QueueEntry[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is QueueEntry =>
          !!e &&
          typeof e.idempotencyKey === 'string' &&
          typeof e.productId === 'number' &&
          typeof e.productName === 'string' &&
          (e.status === 'pending' || e.status === 'sending' || e.status === 'synced' || e.status === 'failed'),
      )
      // Anything mid-flight when the tab was killed is back to pending; we will retry.
      .map((e) => (e.status === 'sending' ? { ...e, status: 'pending' as const, attempts: Math.max(0, e.attempts - 1) } : e));
  } catch {
    return [];
  }
}

function persist(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or private mode. The in-memory queue still works for this session.
  }
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
  };
}

function emit(): void {
  const snap = snapshot();
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
    const res = await fetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
    // 4xx other than 408 (request timeout) and 429 (rate limit) are permanent.
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
    let body: { error?: string } | null = null;
    try {
      body = (await res.json()) as { error?: string };
    } catch {
      body = null;
    }
    return { ok: false, error: body?.error ?? `http_${res.status}`, permanent };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === 'AbortError') return { ok: false, error: 'timeout', permanent: false };
    return { ok: false, error: 'network', permanent: false };
  } finally {
    clearTimeout(timer);
  }
}

async function sendEntry(entry: QueueEntry): Promise<void> {
  if (entry.status === 'sending' || entry.status === 'synced') return;
  entry.status = 'sending';
  entry.attempts += 1;
  emit();
  persist();

  let lastError = 'unknown';
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
      persist();
      emit();
      return;
    }
    lastError = result.error;
    if (result.permanent) break;
  }
  entry.lastError = lastError;
  entry.status = entry.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
  persist();
  emit();
}

async function drain(): Promise<void> {
  if (draining) return;
  if (!online) {
    // Still try — fetch may succeed in some offline-ish states. But bail quickly
    // if we are explicitly offline to avoid burning the timeout.
    if (!healthy) return;
  }
  const work = entries.filter((e) => e.status === 'pending');
  if (work.length === 0) {
    return;
  }
  draining = true;
  emit();
  try {
    // Bounded concurrency: 2 in-flight at a time keeps the store snappy without
    // hammering the server when 30 sales were queued.
    const concurrency = 2;
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
  if (!hasStorage()) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(HEALTH_PATH, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
    healthy = res.ok;
  } catch {
    healthy = false;
  } finally {
    clearTimeout(timer);
  }
  // If we just regained health, kick the drain.
  if (healthy && online && !draining) scheduleDrain(0);
  emit();
}

function setOnline(next: boolean): void {
  if (online === next) return;
  online = next;
  emit();
  if (online) scheduleDrain(0);
}

/** Initialise event listeners, load the persisted queue, and kick off the first drain. */
export function initSaleQueue(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  if (initialized) return cleanup ?? (() => undefined);
  initialized = true;

  entries = load();
  online = typeof navigator === 'undefined' ? true : navigator.onLine;
  healthy = online;

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      bc = new BroadcastChannel(BROADCAST_CHANNEL);
      bc.onmessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; snapshot?: QueueSnapshot } | null;
        if (data?.type === 'snapshot' && data.snapshot) {
          for (const sub of subscribers) {
            try {
              sub(data.snapshot);
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
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('pageshow', onPageShow);

  healthTimer = setInterval(() => {
    void probeHealth();
  }, HEALTH_INTERVAL_MS);

  // First health probe + drain.
  void probeHealth();
  if (online) scheduleDrain(500);

  cleanup = () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('pageshow', onPageShow);
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
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

/**
 * Enqueue a sale for background sync. Returns the optimistic queue entry, which
 * carries a temp id (negative integer) suitable for in-memory UI before the server
 * responds. The temp id is replaced by the canonical sale id once the queue entry
 * transitions to `synced`.
 */
export function enqueueSale(input: QueueInput): QueueEntry {
  const entry: QueueEntry = {
    idempotencyKey: newIdempotencyKey(),
    productId: input.productId,
    variantId: input.variantId ?? null,
    productName: input.productName,
    pointValue: Math.max(0, Number(input.pointValue) || 0),
    quantity: Math.max(1, Math.min(99, Math.floor(Number(input.quantity) || 1))),
    soldDate: input.soldDate ?? null,
    enqueuedAt: Date.now(),
    attempts: 0,
    status: 'pending',
  };
  // Prepend and bound the size so a runaway loop cannot blow past localStorage.
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
}
