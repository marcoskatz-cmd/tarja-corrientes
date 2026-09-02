/**
 * Service worker: cachea el armazón de la app para que abra sin señal.
 *
 * A la API NO se le hace caché nunca: los datos siempre salen del servidor, y
 * lo que no se puede enviar queda en la cola de IndexedDB, no acá.
 */

const CACHE = 'tarja-v1';
const ARMAZON = [
  './',
  './index.html',
  './panel.html',
  './ayuda.html',
  './estilo.css',
  './api.js',
  './camara.js',
  './app.js',
  './panel.js',
  './manifest.json',
  './icono.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARMAZON)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname.indexOf('script.google.com') !== -1) return;

  // Red primero para tener siempre la última versión; caché como red de seguridad.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
