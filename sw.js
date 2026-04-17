const CACHE_NAME = 'turnos-v2';
const ASSETS = ['./', './index.html', './css/styles.css', './js/store.js', './js/calendar.js', './js/events.js', './js/share.js', './js/app.js', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('cdn.jsdelivr.net')) return;
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});
