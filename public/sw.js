const CACHE_VERSION = 'sugi-pwa-v14';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;
const OFFLINE_URL = '/offline';
const LOCAL_URL = '/local';
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

    // An installed PWA can keep its old JavaScript alive after a worker update.
    // Reload open windows once so the user receives the newly deployed UI without
    // clearing IndexedDB, pending sale queues, or authentication state.
    // Let activation finish before navigating. Awaiting navigate() from inside
    // activate can deadlock because the navigation waits for activation itself.
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

self.addEventListener('message', (event) => {
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

  // API calls must always reach the server. Failed sale writes are handled by
  // the app's idempotent localStorage queue, never by HTTP response caching.
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
