const CACHE = 'finanzas-calculadora-v28';
const APP_SHELL = ['./index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
const SHELL_URL = new URL('./index.html', self.registration.scope).href;
const ROOT_URL = new URL('./', self.registration.scope).href;

self.addEventListener('install', event => {
  const freshShell = APP_SHELL.map(path => new Request(new URL(path, self.registration.scope), { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(freshShell)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => (key.startsWith('finanzas-proto-') || key.startsWith('finanzas-calculadora-')) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const isAppDocument = request.mode === 'navigate' || url.pathname === new URL(SHELL_URL).pathname || url.pathname === new URL(ROOT_URL).pathname;

  event.respondWith((async () => {
    try {
      const response = await fetch(request, isAppDocument ? { cache: 'no-store' } : {});
      if (response.ok) {
        try {
          const cache = await caches.open(CACHE);
          await cache.put(isAppDocument ? SHELL_URL : request, response.clone());
        } catch (error) {
          console.warn('No se pudo guardar la copia sin conexión:', error);
        }
      }
      return response;
    } catch (error) {
      const cached = await caches.match(isAppDocument ? SHELL_URL : request, { cacheName: CACHE });
      if (cached) return cached;
      return Response.error();
    }
  })());
});
