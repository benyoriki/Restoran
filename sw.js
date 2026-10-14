/* Service worker — Ayam Kampung & Sambal Merintih
   Strategi: halaman/JS/CSS = network-first (selalu terbaru, cadangan offline dari cache);
   gambar/ikon = cache-first. Data pesanan ada di LocalStorage, tidak disentuh service worker. */
var VERSION = 'smr-v1';
var CORE = ['./', 'index.html', 'menu.html', 'order.html', 'login.html', 'admin.html', 'kitchen.html', 'manifest.webmanifest',
  'style.css', 'landing.css', 'responsive.css', 'dashboard.css', 'splash.css',
  'storage.js', 'app.js', 'qris.js', 'menu.js', 'cart.js', 'orders.js', 'dashboard.js', 'finance.js', 'reports.js', 'qr.js', 'settings.js', 'pwa.js',
  'vendor/lucide.min.js', 'vendor/qrcode.js',
  'assets/icon-192.png', 'assets/icon-512.png', 'assets/logo.png', 'assets/hero-photo.jpg', 'assets/favicon-32.png', 'og-image.jpg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.all(CORE.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('message', function (e) { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;               // font Google dll. tidak diintervensi
  var isImg = /\.(png|jpe?g|webp|svg|ico)$/i.test(url.pathname);
  if (isImg) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) { var cp = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, cp); }); return res; });
    }));
    return;
  }
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.status === 200) { var cp = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, cp); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()); });
  }));
});
