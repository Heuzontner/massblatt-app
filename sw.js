// Offline: App-Dateien im Cache. Das KI-Modell cached transformers.js selbst.
const V = 'mb-1.9.1';
const FILES = ['./', 'index.html', 'app.js', 'db.js', 'ble.js', 'arrows.js', 'pdf.js', 'detect.js', 'pin.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'vendor/pdf-lib.min.js', 'vendor/fontkit.umd.min.js', 'vendor/NotoSans.woff',
  'vendor/ort-wasm-simd-threaded.asyncify.mjs', 'vendor/ort-wasm-simd-threaded.asyncify.wasm'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('mb-') && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.hostname === 'cdn.jsdelivr.net') { // KI-Bibliothek: einmal laden, dann aus dem Cache
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(n => { if (n.ok) { const cl = n.clone(); caches.open(V).then(c => c.put(e.request, cl)); } return n; })));
    return;
  }
  if (u.origin !== location.origin) return;
  // Netz zuerst (Updates), sonst Cache (offline)
  // no-cache: immer beim Server nachfragen, damit Updates sofort ankommen
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const cl = r.clone(); caches.open(V).then(c => c.put(e.request, cl)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
