/**
 * Service worker del portal del jugador (`/c/[slug]/...`).
 *
 * Alcance deliberadamente chico: esto es lo que hace instalable la PWA
 * (ícono en el inicio, se abre sin barra del navegador) — NO es una capa de
 * caché de datos. La disponibilidad de canchas, el menú del buffet y los
 * torneos son datos vivos: cachearlos aunque sea un rato puede mostrarle al
 * jugador un horario como libre cuando ya no lo está, o un precio viejo.
 *
 * Por eso acá SOLO se cachea el cascarón estático (íconos) y se intercepta
 * ÚNICAMENTE la navegación (cargar una página), con estrategia
 * network-first: si hay red, siempre gana la red; el caché es nada más el
 * salvavidas para cuando el celular se queda sin señal. Cualquier otro
 * request (llamadas a la API, JS/CSS de Next) pasa de largo sin tocarlo.
 */
const CACHE = 'clubos-player-v1';
const PRECACHE_URLS = ['/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Solo GET, mismo origen, y solo navegación de página — todo lo demás
  // (fetch a la API, chunks de Next, POST de reservar/pagar) pasa de largo.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  if (request.mode !== 'navigate') return;

  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/'))),
  );
});
