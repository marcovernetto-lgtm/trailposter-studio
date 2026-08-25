const CACHE_NAME = 'trailposter-cache-v3';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // For HTML pages and JS scripts, always use Network First to avoid stale UI
  const url = new URL(event.request.url);
  const isDocumentOrScript = event.request.destination === 'document' || 
                             event.request.destination === 'script' || 
                             url.pathname === '/' || 
                             url.pathname.endsWith('.html') || 
                             url.pathname.endsWith('.js') || 
                             url.pathname.endsWith('.jsx');

  if (isDocumentOrScript || url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for external fonts and static images
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    })
  );
});
