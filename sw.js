const CACHE_NAME = 'turnos-v8';
const ASSETS = ['./', './index.html', './css/styles.css', './js/store.js', './js/calendar.js', './js/events.js', './js/share.js', './js/gcalendar.js', './js/app.js', './manifest.json'];

function shouldHandleFetch(request) {
  if (!request || request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return url.origin === self.location.origin;
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (!shouldHandleFetch(e.request)) return;

  e.respondWith((async () => {
    const cached = await caches.match(e.request);

    try {
      const response = await fetch(e.request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(e.request, response.clone());
      }
      return response;
    } catch {
      if (cached) return cached;

      if (e.request.mode === 'navigate') {
        const appShell = await caches.match('./index.html');
        if (appShell) return appShell;
      }

      return new Response('Offline', {
        status: 503,
        statusText: 'Offline',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
