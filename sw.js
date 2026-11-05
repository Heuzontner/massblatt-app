// Offline: App-Dateien im Cache. Große, unveränderliche Bibliotheken liegen in einem eigenen Cache,
// damit ein Update nur die kleinen App-Dateien neu laden muss (schnelle Updates).
const V = 'mb-2.2.3';
const LIB = 'mblib-1';
const FILES = ['./', 'index.html', 'app.js', 'db.js', 'ble.js', 'arrows.js', 'pdf.js', 'detect.js', 'pin.js', 'dropbox.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png'];
const LIBFILES = ['vendor/pdf-lib.min.js', 'vendor/fontkit.umd.min.js', 'vendor/NotoSans.woff', 'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs'];
const isLib = u => u.hostname === 'cdn.jsdelivr.net' || u.pathname.includes('/vendor/');

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await c.addAll(FILES.map(f => new Request(f, { cache: 'no-cache' })));
    // Bibliotheken nur laden, wenn noch nicht vorhanden – blockiert das Update nicht
    caches.open(LIB).then(async l => { for (const f of LIBFILES) if (!(await l.match(f))) l.add(f).catch(() => { }); });
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => (k.startsWith('mb-') && k !== V) || (k.startsWith('mblib-') && k !== LIB)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (isLib(u) && (u.origin === location.origin || u.hostname === 'cdn.jsdelivr.net')) {
    // Bibliotheken: aus dem Cache, sonst laden und merken
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(n => {
      if (n.ok) { const cl = n.clone(); caches.open(LIB).then(c => c.put(e.request, cl)); }
      return n;
    })));
    return;
  }
  if (u.origin !== location.origin) return;
  // App-Dateien: immer beim Server nachfragen (Updates), offline aus dem Cache
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const cl = r.clone(); caches.open(V).then(c => c.put(e.request, cl)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
