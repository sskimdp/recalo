const CACHE = 'recalo-v9';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './logic.js', './sync.js', './firebase-config.js', './manifest.webmanifest', './icon.svg', './apple-touch-icon.png', './icon-32.png', './icon-48.png', './icon-64.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))));
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  // Drop caches left over from previous versions, or they pile up in the browser.
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name !== CACHE && (name.startsWith('recalo-') || name.startsWith('cardflow-'))).map((name) => caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
