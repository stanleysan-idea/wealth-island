// Offline cache for the Home Screen app. Pages are network-first, so a new upload shows up on the next launch.
const CACHE = 'wealth-island-12f94dc72d';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png', './vendor/three.module.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).pathname.includes('/api/')) return;   // live prices never come from the cache
  // keep only real answers: behind Cloudflare Access an expired sign-in comes back as a redirect to the login page
  const put = res => { if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; };
  if (new URL(req.url).origin === location.origin) {   // network first, cached copy when offline
    e.respondWith(fetch(req).then(put).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
  } else {   // fonts and the Excel reader from the CDN: cache first (the page checks the Excel reader's hash either way)
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(put)));
  }
});
