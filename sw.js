// Офлайн-кэш приложения (всё, кроме ИИ-мастера, работает без интернета)
const CACHE = 'dnd-master-v16';
const ASSETS = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/data.js', 'js/rules.js', 'js/dice.js', 'js/character.js', 'js/dm.js', 'js/offline.js', 'js/adventures.js', 'js/adventures2.js', 'js/adventures3.js',
  'js/vendor/anthropic-sdk.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];
self.addEventListener('install', (e) => {
  // cache: 'reload' — берём свежие файлы с сервера, а не из кэша браузера
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'api.anthropic.com') return;
  // Сначала сеть с проверкой свежести (no-cache), при офлайне — сохранённая копия
  e.respondWith(
    fetch(url.origin === location.origin ? new Request(e.request, { cache: 'no-cache' }) : e.request).then((res) => {
      if (res.ok && (url.origin === location.origin)) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
