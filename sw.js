const V = 'gs-walkout-v1';
const ASSETS = ['./', './index.html', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(V).then(x => x.put('./index.html', c)); return res; }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(r).then(hit => hit || fetch(r)));
});
