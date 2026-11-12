// Offline: App-Dateien im Cache. Große, unveränderliche Bibliotheken liegen in einem eigenen Cache,
// damit ein Update nur die kleinen App-Dateien neu laden muss (schnelle Updates).
const V = 'mb-3.9.0';
const LIB = 'mblib-1';
const FILES = ['./', 'index.html', 'app.js', 'db.js', 'ble.js', 'arrows.js', 'pdf.js', 'detect.js', 'pin.js', 'dropbox.js', 'gcal.js', 'magnet.js', 'i18n.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png'];
const FONTS = ['space-grotesk-latin-600', 'space-grotesk-latin-700', 'ibm-plex-sans-latin-400', 'ibm-plex-sans-latin-500', 'ibm-plex-sans-latin-600', 'jetbrains-mono-latin-400', 'jetbrains-mono-latin-500'].map(f => `vendor/fonts/${f}-normal.woff2`);
const LIBFILES = ['vendor/pdf-lib.min.js', 'vendor/fontkit.umd.min.js', 'vendor/NotoSans.woff', 'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'vendor/qrcode.js', ...FONTS];
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
  // Anfragen mit ?t=… (z. B. pin.json) nie merken und offline nicht mit index.html beantworten
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    if (r.ok && !u.search) { const cl = r.clone(); caches.open(V).then(c => c.put(e.request, cl)); }
    return r;
  }).catch(() => u.search ? Response.error() : caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
