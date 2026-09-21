const CACHE_NAME = 'sec-boys-v8-2026-09-21';
const BASE_URL = new URL('./', self.registration.scope).toString();
const ASSETS = [
  BASE_URL,
  new URL('index.html', BASE_URL).toString(),
  new URL('manifest.json', BASE_URL).toString(),
  new URL('icon.svg', BASE_URL).toString(),
  new URL('icon-192.png', BASE_URL).toString(),
  new URL('icon-512.png', BASE_URL).toString(),
];

const isBypassedRequest = (request) => {
  if (request.method !== 'GET') return true;

  const url = request.url;
  return (
    url.includes('firestore.googleapis.com') ||
    url.includes('identitytoolkit.googleapis.com') ||
    url.includes('securetoken.googleapis.com') ||
    url.includes('/api/') ||
    url.includes('/ws') ||
    url.includes('localhost') ||
    url.includes('hot-update')
  );
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .catch((err) => {
        console.log('[SW] Initial cache warning:', err);
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (isBypassedRequest(request)) return;

  // Always try the network first for navigations so new GitHub Pages
  // deployments are visible without waiting for a cache expiration.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(new Request(request, { cache: 'no-store' }))
        .then((networkResponse) => {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return networkResponse;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match(BASE_URL)))
    );
    return;
  }

  event.respondWith(
    fetch(new Request(request, { cache: 'no-store' }))
      .then((networkResponse) => {
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return networkResponse;
      })
      .catch(() => caches.match(request))
  );
});
