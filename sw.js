/*
 * sw.js — Service worker: guarda los archivos de la app para que abra sin señal.
 *
 * IMPORTANTE: cada vez que cambies CUALQUIER archivo de la app, subí el número de VERSION.
 * Al cambiar el nombre de la caché se descarga todo de nuevo y se borra la vieja (ver "activate").
 * Archivo nuevo en la app -> sumarlo a ARCHIVOS.
 *
 * Los datos (turnos, servicios) NO se guardan acá: viven en Supabase y se piden siempre.
 */
const VERSION = 'barber-turnos-v7';

// RUTAS RELATIVAS: en GitHub Pages la app está en /barber-turnos/, no en la raíz del dominio.
const ARCHIVOS = [
  './',
  './index.html',
  './panel.html',
  './css/styles.css',
  './js/config.js',
  './js/html.js',
  './js/fechas.js',
  './js/agenda.js',
  './js/telefono.js',
  './js/api.js',
  './js/reserva.js',
  './js/panel.js',
  './js/config-panel.js',
  './js/push.js',
  './vendor/supabase.js',
  './vendor/qrcode.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Si un solo archivo falla, el service worker no se instala (mejor eso que una app a medias).
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

// Borra solo las cachés viejas de ESTA app: el dominio (github.io) lo comparten otras apps
// y no hay que tocarles la caché.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(nombres
        .filter((n) => n.startsWith('barber-turnos-') && n !== VERSION)
        .map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Red primero, caché si no hay señal. cache:'no-cache' obliga a revisar con el servidor:
// GitHub Pages deja guardar los archivos ~10 minutos y una versión nueva tardaría en verse.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Nunca se cachea otro origen (Supabase: datos en vivo y con sesión). Ni se toca la petición.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((respuesta) => {
        if (respuesta.ok) {
          const copia = respuesta.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copia));
        }
        return respuesta;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./')))
  );
});

// ---------- Notificaciones push ----------
// El servidor (supabase/functions/notificar) manda {titulo, cuerpo, url}. Si el payload viene
// roto igual se muestra algo: una push sin notificación visible hace que el navegador la penalice.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { /* payload ilegible: se usa el texto por defecto */ }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Barber Turnos', {
    body: d.cuerpo || '',
    data: { url: d.url || './panel.html' },
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png'
  }));
});

// La url llega relativa ('./panel.html?d=...'): se resuelve contra el scope del service worker
// (no contra la página que esté abierta). Si ya hay una ventana del panel, se la reutiliza.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = new URL((e.notification.data && e.notification.data.url) || './panel.html', self.registration.scope).href;
  const panel = new URL('./panel.html', self.registration.scope).pathname;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      const abierta = ventanas.find((v) => new URL(v.url).pathname === panel);
      if (abierta) return abierta.navigate(destino).then((c) => (c || abierta).focus()).catch(() => abierta.focus());
      return self.clients.openWindow(destino);
    })
  );
});
