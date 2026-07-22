'use client';

const DB_NAME = 'sugi-sale-queue';
const DB_VERSION = 1;
const STORE_NAME = 'sales';
const LEGACY_KEY = 'sugi-sale-queue-v1';

let dbPromise: Promise<IDBDatabase> | null = null;

function legacyRecords(): unknown[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function openQueueDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'idempotencyKey' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb open failed'));
  });
  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('indexeddb transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('indexeddb transaction aborted'));
  });
}

export async function loadQueueRecords(): Promise<unknown[]> {
  const legacy = legacyRecords();
  try {
    const db = await openQueueDb();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const stored = await requestResult(transaction.objectStore(STORE_NAME).getAll());
    await transactionDone(transaction);
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

export async function saveQueueRecords(records: readonly unknown[]): Promise<'indexeddb' | 'localstorage' | 'memory'> {
  try {
    const db = await openQueueDb();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    for (const record of records) store.put(record);
    await transactionDone(transaction);
    try { window.localStorage.removeItem(LEGACY_KEY); } catch { /* best effort */ }
    return 'indexeddb';
  } catch {
    try {
      window.localStorage.setItem(LEGACY_KEY, JSON.stringify(records));
      return 'localstorage';
    } catch {
      return 'memory';
    }
  }
}

export async function queueStorageBackend(): Promise<'indexeddb' | 'localstorage' | 'memory'> {
  try {
    await openQueueDb();
    return 'indexeddb';
  } catch {
    try {
      const probe = `${LEGACY_KEY}-probe`;
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return 'localstorage';
    } catch {
      return 'memory';
    }
  }
}
