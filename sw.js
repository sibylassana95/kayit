// Service worker Kayit : met l'app en cache pour qu'elle marche hors ligne.
// Il ne fait aucune requête vers un autre site.
const CACHE = 'kayit-v1.1.8';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'js/app.js', 'js/db.js', 'js/qr.js',
  'vendor/jsQR.js', 'vendor/qrcode.js',
  'fonts/space-grotesk-latin-400-normal.woff2', 'fonts/space-grotesk-latin-500-normal.woff2', 'fonts/space-grotesk-latin-700-normal.woff2',
  'fonts/jetbrains-mono-latin-400-normal.woff2', 'fonts/jetbrains-mono-latin-500-normal.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
