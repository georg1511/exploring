// Offline shell: app files network-first, map tiles cache-first (for areas you have seen)
const CACHE = 'exploring-v4';
const SHELL = ['./', 'index.html', 'css/styles.css', 'js/app.js', 'js/api.js', 'js/geo.js', 'js/planner.js', 'js/store.js', 'js/sport.js', 'js/icons.js', 'js/game.js', 'manifest.webmanifest', 'icons/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== 'tiles').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin || url.hostname === 'unpkg.com' || url.hostname.endsWith('gstatic.com') || url.hostname === 'fonts.googleapis.com') {
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
    }).catch(() => caches.match(e.request)));
  } else if (url.hostname === 'tile.openstreetmap.org' || url.hostname === 'server.arcgisonline.com' || url.hostname.endsWith('tile.opentopomap.org') || url.hostname.endsWith('tile-cyclosm.openstreetmap.fr')) {
    e.respondWith(caches.open('tiles').then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
  }
});
