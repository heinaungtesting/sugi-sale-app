'use client';

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

const DB_NAME = 'sugi-sale-queue';
const DB_VERSION = 1;
const STORE_NAME = 'sales';
const LEGACY_KEY = 'sugi-sale-queue-v1';

type StoredQueueRecord = Record<string, unknown> & {
  idempotencyKey: string;
  status?: string;
  createdAt?: string;
  leaseOwner?: string;
  leaseExpiresAt?: number;
};

interface SaleQueueDb extends DBSchema {
  sales: {
    key: string;
    value: StoredQueueRecord;
    indexes: { status: string; createdAt: string };
  };
}

let dbPromise: Promise<IDBPDatabase<SaleQueueDb>> | null = null;

function isStoredQueueRecord(value: unknown): value is StoredQueueRecord {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { idempotencyKey?: unknown }).idempotencyKey === 'string';
}

export function shouldWriteQueueRecord(
  current: StoredQueueRecord | undefined,
  incoming: StoredQueueRecord,
  now: number,
): boolean {
  if (!current) return true;
  // `synced` is terminal. A delayed page persist must never regress the record
  // after the Service Worker has already received the canonical server sale.
  if (current.status === 'synced' && incoming.status !== 'synced') return false;
  const foreignActiveLease = Boolean(
    current.leaseOwner
    && Number(current.leaseExpiresAt ?? 0) > now
    && current.leaseOwner !== incoming.leaseOwner
  );
  return !foreignActiveLease;
}

export function loadLegacyQueueRecords(): StoredQueueRecord[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(LEGACY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isStoredQueueRecord) : [];
  } catch {
    return [];
  }
}

function openQueueDb(): Promise<IDBPDatabase<SaleQueueDb>> {
  if (!dbPromise) {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('indexeddb unavailable'));
    dbPromise = openDB<SaleQueueDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'idempotencyKey' });
          store.createIndex('status', 'status');
          store.createIndex('createdAt', 'createdAt');
        }
      },
      terminated() { dbPromise = null; },
    });
  }
  return dbPromise;
}

export async function loadQueueRecords(): Promise<unknown[]> {
  const legacy = loadLegacyQueueRecords();
  try {
    const db = await openQueueDb();
    const stored = await db.getAll(STORE_NAME);
    if (stored.length > 0) return stored;
    if (legacy.length > 0) {
      await saveQueueRecords(legacy);
      try { window.localStorage.removeItem(LEGACY_KEY); } catch { /* best effort */ }
      return legacy;
    }
    return [];
  } catch {
    return legacy;
  }
}

export async function saveQueueRecords(records: readonly unknown[]): Promise<'indexeddb' | 'memory'> {
  try {
    const db = await openQueueDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const existing = await tx.store.getAll();
    const incomingKeys = new Set<string>();
    const now = Date.now();
    for (const record of records) {
      if (!isStoredQueueRecord(record)) continue;
      incomingKeys.add(record.idempotencyKey);
      const current = existing.find((item) => item.idempotencyKey === record.idempotencyKey);
      if (shouldWriteQueueRecord(current, record, now)) await tx.store.put(record);
    }
    for (const current of existing) {
      const activelyLeased = current.leaseOwner && Number(current.leaseExpiresAt ?? 0) > now;
      if (!incomingKeys.has(current.idempotencyKey) && !activelyLeased) {
        await tx.store.delete(current.idempotencyKey);
      }
    }
    await tx.done;
    try { window.localStorage.removeItem(LEGACY_KEY); } catch { /* best effort */ }
    return 'indexeddb';
  } catch {
    return 'memory';
  }
}

export async function claimQueueRecord(
  idempotencyKey: string,
  owner: string,
  now: number,
  leaseMs: number,
): Promise<StoredQueueRecord | null> {
  try {
    const db = await openQueueDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const current = await tx.store.get(idempotencyKey);
    const leaseExpired = Number(current?.leaseExpiresAt ?? 0) <= now;
    const claimable = current?.status === 'pending'
      || (current?.status === 'sending' && leaseExpired);
    if (!current || !claimable) {
      await tx.done;
      return null;
    }
    const claimed: StoredQueueRecord = {
      ...current,
      status: 'sending',
      leaseOwner: owner,
      leaseExpiresAt: now + leaseMs,
    };
    await tx.store.put(claimed);
    await tx.done;
    return claimed;
  } catch {
    return null;
  }
}

export async function queueStorageBackend(): Promise<'indexeddb' | 'memory'> {
  try {
    await openQueueDb();
    return 'indexeddb';
  } catch {
    return 'memory';
  }
}
