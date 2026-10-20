/* ขุนคลัง — service worker: เก็บไฟล์แอปไว้ในเครื่อง ให้เปิดได้แม้ไม่มีเน็ต
 * เปลี่ยน VERSION ทุกครั้งที่อัปเดตไฟล์แอป */
var VERSION = 'kk-v18';
var SHELL = ['./', 'index.html', 'styles.css', 'seed.js', 'core.js', 'mock-api.js', 'api.js', 'attach.js', 'export.js', 'importer.js',
  'accounts.js', 'app.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// ไฟล์ของแอป: ใช้เน็ตก่อน (ได้เวอร์ชันล่าสุด) ถ้าไม่มีเน็ตค่อยใช้ที่เก็บไว้
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    var copy = res.clone();
    caches.open(VERSION).then(function (c) { c.put(req, copy); });
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) { return hit || caches.match('index.html'); });
  }));
});
