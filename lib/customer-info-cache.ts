'use client';

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { useEffect, useState } from 'react';
import type { CustomerInfoCard, CustomerLanguage } from '@/domain/customer-info/customer-info';

// Published customer cards cached on the device so the card opens with no
// signal (FR offline). Cards are shared catalog content, not per-user data.

const DB_NAME = 'sugi-customer-info';
const DB_VERSION = 1;
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const CARD_LANGUAGE_STORAGE_KEY = 'sugi-customer-info-language';

export type CachedProductCards = { product_id: number; cards: Partial<Record<CustomerLanguage, CustomerInfoCard>> };

type BundleResponse = {
  version: number;
  products: CachedProductCards[];
  carded_product_ids: number[];
};

interface CustomerInfoDb extends DBSchema {
  cards: { key: number; value: CachedProductCards };
  meta: { key: string; value: { key: string; version: number; syncedAt: number } };
}

let dbPromise: Promise<IDBPDatabase<CustomerInfoDb>> | null = null;
let cardedIds = new Set<number>();
let lastSyncAt = 0;
let syncInFlight: Promise<void> | null = null;
let syncedThisSession = false;
const listeners = new Set<(ids: Set<number>) => void>();

function db() {
  if (!dbPromise) {
    dbPromise = openDB<CustomerInfoDb>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        database.createObjectStore('cards', { keyPath: 'product_id' });
        database.createObjectStore('meta', { keyPath: 'key' });
      },
    });
  }
  return dbPromise;
}

function publish(ids: Set<number>) {
  cardedIds = ids;
  for (const listener of listeners) listener(ids);
}

export async function getCachedCards(productId: number): Promise<CachedProductCards | undefined> {
  try {
    return await (await db()).get('cards', productId);
  } catch {
    return undefined;
  }
}

async function loadCachedIndex(): Promise<void> {
  try {
    const database = await db();
    const [keys, meta] = await Promise.all([database.getAllKeys('cards'), database.get('meta', 'bundle')]);
    lastSyncAt = meta?.syncedAt ?? 0;
    publish(new Set(keys.map(Number)));
  } catch {
    // IndexedDB unavailable (private mode): the card still opens online.
  }
}

/**
 * Pulls changed cards since the cached version. The first sync of each page
 * session is a full sync, so a device never trusts a stale version forever.
 */
export function syncCustomerInfo(options: { force?: boolean } = {}): Promise<void> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    try {
      const database = await db();
      const meta = await database.get('meta', 'bundle');
      const since = options.force || !syncedThisSession ? 0 : meta?.version ?? 0;
      const response = await fetch(`/api/customer-info/bundle?since=${since}`, { cache: 'no-store' });
      if (!response.ok) return;
      const bundle = await response.json() as BundleResponse;
      const keep = new Set(bundle.carded_product_ids);
      const tx = database.transaction(['cards', 'meta'], 'readwrite');
      const cards = tx.objectStore('cards');
      for (const key of await cards.getAllKeys()) {
        if (!keep.has(Number(key))) await cards.delete(key);
      }
      for (const product of bundle.products) await cards.put(product);
      const syncedAt = Date.now();
      await tx.objectStore('meta').put({ key: 'bundle', version: bundle.version, syncedAt });
      await tx.done;
      lastSyncAt = syncedAt;
      syncedThisSession = true;
      publish(keep);
    } catch {
      // Offline or server error: keep serving the cached cards.
    } finally {
      syncInFlight = null;
    }
  })();
  return syncInFlight;
}

let started = false;

function startSync() {
  if (started || typeof window === 'undefined') return;
  started = true;
  void loadCachedIndex().then(() => {
    if (navigator.onLine !== false) void syncCustomerInfo();
  });
  window.addEventListener('online', () => void syncCustomerInfo());
  window.setInterval(() => {
    if (navigator.onLine !== false && Date.now() - lastSyncAt >= SYNC_INTERVAL_MS) void syncCustomerInfo();
  }, 15 * 60 * 1000);
}

/** Product ids with a published card on this device; starts background sync once. */
export function useCustomerInfoIndex(): Set<number> {
  const [ids, setIds] = useState<Set<number>>(cardedIds);
  useEffect(() => {
    listeners.add(setIds);
    setIds(cardedIds);
    startSync();
    return () => {
      listeners.delete(setIds);
    };
  }, []);
  return ids;
}

export function readCardLanguage(): CustomerLanguage {
  try {
    return window.localStorage.getItem(CARD_LANGUAGE_STORAGE_KEY) === 'zh-Hans' ? 'zh-Hans' : 'en';
  } catch {
    return 'en';
  }
}

export function saveCardLanguage(language: CustomerLanguage) {
  try {
    window.localStorage.setItem(CARD_LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Storage blocked: the toggle still works for this card.
  }
}
