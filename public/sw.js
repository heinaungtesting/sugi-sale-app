const CACHE_VERSION = 'sugi-pwa-v20';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;
const OFFLINE_URL = '/offline';
const LOCAL_URL = '/local';
const SALE_QUEUE_DB = 'sugi-sale-queue';
const SALE_QUEUE_STORE = 'sales';
const SALE_SYNC_TAG = 'sugi-sale-queue-sync';
const SALE_QUEUE_LEASE_MS = 90 * 1000;
const SALE_QUEUE_OWNER = 'service-worker';
const PRECACHE = [
  OFFLINE_URL,
  LOCAL_URL,
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('sugi-pwa-') && ![STATIC_CACHE, PAGE_CACHE].includes(key))
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
    try {
      const db = await openSaleQueueDb();
      await reconcileAcceptedQueue(db);
      await notifyQueueClients();
    } catch {
      // The page queue remains the fallback when activation reconciliation fails.
    }
    setTimeout(() => {
      void self.clients.matchAll({ type: 'window' }).then((windows) =>
        Promise.all(windows.map((client) => client.navigate(client.url))),
      );
    }, 0);
  })());
});

async function networkFirstPage(request, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response.status >= 500) throw new Error(`Server unavailable: ${response.status}`);
    if (response.ok && !response.redirected && (url.pathname === '/' || url.pathname === LOCAL_URL)) {
      const cache = await caches.open(PAGE_CACHE);
      await cache.put(url.pathname, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(
      url.pathname === '/' || url.pathname === LOCAL_URL ? url.pathname : request,
    )) || (await caches.match(OFFLINE_URL));
  } finally {
    clearTimeout(timeout);
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

function openSaleQueueDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SALE_QUEUE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SALE_QUEUE_STORE)) {
        const store = db.createObjectStore(SALE_QUEUE_STORE, { keyPath: 'idempotencyKey' });
        store.createIndex('status', 'status');
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('sale queue database unavailable'));
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('sale queue request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('sale queue transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('sale queue transaction aborted'));
  });
}

async function readSaleQueue(db) {
  const transaction = db.transaction(SALE_QUEUE_STORE, 'readonly');
  const records = await idbRequest(transaction.objectStore(SALE_QUEUE_STORE).getAll());
  await transactionDone(transaction);
  return records;
}

async function writeSaleQueueEntry(db, entry) {
  const transaction = db.transaction(SALE_QUEUE_STORE, 'readwrite');
  transaction.objectStore(SALE_QUEUE_STORE).put(entry);
  await transactionDone(transaction);
}

async function claimNextSaleQueueEntry(db) {
  const now = Date.now();
  const transaction = db.transaction(SALE_QUEUE_STORE, 'readwrite');
  const store = transaction.objectStore(SALE_QUEUE_STORE);
  const entries = await idbRequest(store.getAll());
  const entry = entries
    .filter((entry) => entry.status === 'pending'
      || (entry.status === 'sending' && entry.leaseExpiresAt <= now))
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt)[0];
  if (!entry) {
    await transactionDone(transaction);
    return null;
  }
  entry.status = 'sending';
  entry.leaseOwner = SALE_QUEUE_OWNER;
  entry.leaseExpiresAt = now + SALE_QUEUE_LEASE_MS;
  store.put(entry);
  await transactionDone(transaction);
  return entry;
}

async function reconcileAcceptedQueue(db) {
  const records = await readSaleQueue(db);
  const active = records
    .filter((entry) => entry.status !== 'synced' && typeof entry.idempotencyKey === 'string')
    .slice(0, 100);
  if (active.length === 0) return 0;

  const response = await fetch('/api/sales/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotency_keys: active.map((entry) => entry.idempotencyKey) }),
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) return 0;
  const body = await response.json();
  const acceptedByKey = new Map(
    Array.isArray(body.accepted)
      ? body.accepted.map((accepted) => [accepted.idempotency_key, accepted])
      : [],
  );
  let changed = 0;
  for (const entry of active) {
    const accepted = acceptedByKey.get(entry.idempotencyKey);
    if (!accepted?.sale) continue;
    entry.status = 'synced';
    entry.sale = accepted.sale;
    delete entry.lastError;
    delete entry.leaseOwner;
    delete entry.leaseExpiresAt;
    await writeSaleQueueEntry(db, entry);
    changed += 1;
  }
  return changed;
}

async function notifyQueueClients() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) client.postMessage({ type: 'SALE_QUEUE_UPDATED' });
}

async function replaySaleQueue() {
  const db = await openSaleQueueDb();
  await reconcileAcceptedQueue(db);
  while (true) {
    const entry = await claimNextSaleQueueEntry(db);
    if (!entry) break;
    entry.attempts = Number(entry.attempts || 0) + 1;
    await writeSaleQueueEntry(db, entry);
    try {
      const response = await fetch('/api/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Queue-Attempt': String(entry.attempts),
        },
        body: JSON.stringify({
          product_id: entry.productId,
          variant_id: entry.variantId ?? undefined,
          quantity: entry.quantity,
          sold_date: entry.soldDate ?? undefined,
          idempotency_key: entry.idempotencyKey,
        }),
        credentials: 'include',
        cache: 'no-store',
      });

      if (response.ok) {
        entry.sale = await response.json();
        entry.status = 'synced';
        delete entry.lastError;
        delete entry.leaseOwner;
        delete entry.leaseExpiresAt;
        await writeSaleQueueEntry(db, entry);
        continue;
      }

      let body = null;
      try { body = await response.json(); } catch { /* non-JSON error */ }
      entry.lastError = body?.error || `http_${response.status}`;
      const transient = response.status === 408 || response.status === 429 || response.status >= 500;
      entry.status = transient || response.status === 401 || response.status === 403 ? 'pending' : 'failed';
      delete entry.leaseOwner;
      delete entry.leaseExpiresAt;
      await writeSaleQueueEntry(db, entry);
      if (entry.status === 'pending') throw new Error(entry.lastError);
    } catch (error) {
      if (entry.status === 'sending') {
        entry.status = 'pending';
        entry.lastError = error instanceof Error ? error.message : 'network';
      }
      delete entry.leaseOwner;
      delete entry.leaseExpiresAt;
      await writeSaleQueueEntry(db, entry);
      await notifyQueueClients();
      throw error;
    }
  }
  await notifyQueueClients();
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'sugi-sale-queue-sync') event.waitUntil(replaySaleQueue());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SYNC_SALES') {
    event.waitUntil(replaySaleQueue().catch(() => undefined));
    return;
  }
  if (event.data?.type === 'CACHE_APP_SHELL' && Array.isArray(event.data.urls)) {
    const urls = event.data.urls
      .map((value) => {
        try { return new URL(String(value), self.location.origin); } catch { return null; }
      })
      .filter((url) => url && url.origin === self.location.origin && !url.pathname.startsWith('/api/'))
      .map((url) => `${url.pathname}${url.search}`);
    event.waitUntil(
      caches.open(STATIC_CACHE).then(async (cache) => {
        await Promise.allSettled([...new Set(urls)].map((url) => cache.add(url)));
      }),
    );
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API calls always reach the server. Failed writes stay in the idempotent IndexedDB queue.
  if (url.pathname.startsWith('/api/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstPage(event.request, url));
    return;
  }

  if (
    url.pathname.startsWith('/_next/static/')
    || ['style', 'script', 'font', 'image'].includes(event.request.destination)
  ) {
    event.respondWith(cacheFirst(event.request));
  }
});
