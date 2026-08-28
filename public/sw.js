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

  // Een melding tikken opent altijd Mijn berichten, niet de wedstrijd zelf.
  // Het bericht staat daar toch al met een samenvatting; op deze manier land
  // je altijd op hetzelfde vertrouwde scherm in plaats van soms hier, soms
  // daar, afhankelijk van welk soort bericht het toevallig was.
  const doel = '/?open=berichten';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((vensters) => {
      // Staat de app al open, breng die naar voren en laat de pagina zelf het
      // paneel openen — een tab herladen voelt trager aan dan een boodschap.
      for (const venster of vensters) {
        if ('focus' in venster) {
          venster.postMessage({ type: 'open-berichten' });
          return venster.focus();
        }
      }
      return self.clients.openWindow(doel);
    }),
  );
});
