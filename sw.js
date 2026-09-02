/* BoarDog – Service Worker (PWA, עבודה לא מקוונת) */
const CACHE = 'boardog-v8';
const ASSETS = [
  '.',
  'index.html',
  'owner.html',
  'assets/css/app.css',
  'assets/js/store.js',
  'assets/js/cloud.js',
  'assets/js/kennel.js',
  'assets/js/bot.js',
  'assets/js/report.js',
  'assets/js/app.js',
  'assets/js/owner.js',
  'assets/icon.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable.png',
  'manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // רק בקשות מאותו מקור מטופלות כאן; Supabase/Claude תמיד מהרשת
  if (new URL(req.url).origin !== self.location.origin) return;
  // network-first: תמיד הגרסה העדכנית כשיש רשת, נפילה למטמון כשאין
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req))
  );
});
