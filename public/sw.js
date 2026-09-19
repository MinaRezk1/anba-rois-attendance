const CACHE_NAME = 'sec-boys-v3';
const BASE_URL = new URL('./', self.registration.scope).toString();
const ASSETS = [
  BASE_URL,
  new URL('index.html', BASE_URL).toString(),
  new URL('manifest.json', BASE_URL).toString(),
  new URL('icon.svg', BASE_URL).toString(),
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch((err) => {
      console.log('[SW] Initial cache warning:', err);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;
  if (
    url.includes('firestore.googleapis.com') ||
    url.includes('identitytoolkit.googleapis.com') ||
    url.includes('securetoken.googleapis.com') ||
    url.includes('/api/') ||
    url.includes('/ws') ||
    url.includes('localhost') ||
    url.includes('hot-update')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse || caches.match(BASE_URL));

      return cachedResponse || networkFetch;
    })
  );
});
