/**
 * Service worker voor YOAssist.
 *
 * Doet één ding: pushberichten tonen en de app openen als erop geklikt wordt.
 * Bewust geen caching — een aanduidingenlijst die uit een cache komt is
 * erger dan een lijst die even niet laadt.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let gegevens = { titel: 'YOAssist', tekst: '', url: '/' };

  try {
    if (event.data) gegevens = { ...gegevens, ...event.data.json() };
  } catch {
    // Geen leesbare inhoud: toch iets tonen, want de browser eist een melding
    // na een push. Zwijgen kost het abonnement.
    gegevens.tekst = 'Er is iets gewijzigd in YOAssist.';
  }

  event.waitUntil(
    self.registration.showNotification(gegevens.titel, {
      body: gegevens.tekst,
      tag: gegevens.tag ?? 'yoassist',
      data: { url: gegevens.url },
      requireInteraction: false,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const doel = event.notification.data?.url ?? '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((vensters) => {
      // Staat de app al open, breng die naar voren in plaats van een tweede
      // tabblad te openen.
      for (const venster of vensters) {
        if ('focus' in venster) return venster.focus();
      }
      return self.clients.openWindow(doel);
    }),
  );
});
