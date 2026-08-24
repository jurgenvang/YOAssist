import { synchroniseer } from '../functions/_lib/sync.js';

/**
 * Cron-Worker voor YOAssist.
 *
 * Cloudflare draait cron in UTC. België wisselt tussen UTC+1 en UTC+2, dus een
 * vaste UTC-lijst zou twee keer per jaar een uur verschuiven. Daarom vuren we
 * op alle kandidaat-uren en beslist de Worker zelf of het in Brussel werkelijk
 * 6, 12, 18 of 0 uur is. Dat is DST-bestendig zonder tzdata-pakket.
 *
 * Met ?force=1 op de fetch-route kun je een run manueel uitlokken tijdens het
 * opzetten; die route is beveiligd met CRON_SECRET.
 */

const DOELUREN = [0, 6, 12, 18];

function brusselsUur(nu = new Date()) {
  const fmt = new Intl.DateTimeFormat('nl-BE', {
    timeZone: 'Europe/Brussels',
    hour: 'numeric',
    hour12: false,
  });
  return Number(fmt.format(nu));
}

export default {
  async scheduled(event, env, ctx) {
    const uur = brusselsUur(new Date(event.scheduledTime));

    if (!DOELUREN.includes(uur)) {
      // Dit tijdstip hoort bij een ander seizoen van de zomertijd. Niets doen.
      return;
    }

    ctx.waitUntil(
      synchroniseer(env.DB, 'cron')
        .then((rapport) => {
          console.log(
            `[YOAssist] sync ${rapport.status}: ${rapport.gevonden} gevonden, ` +
              `${rapport.nieuw} nieuw, ${rapport.gewijzigd} gewijzigd, ${rapport.verdwenen} verdwenen` +
              (rapport.boodschap ? ` — ${rapport.boodschap}` : ''),
          );
        })
        .catch((err) => console.error('[YOAssist] sync mislukt:', err)),
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.searchParams.get('force') !== '1') {
      return new Response('YOAssist cron worker', { status: 200 });
    }

    const geheim = request.headers.get('X-Cron-Secret');
    if (!env.CRON_SECRET || geheim !== env.CRON_SECRET) {
      return new Response('Niet toegestaan', { status: 403 });
    }

    const rapport = await synchroniseer(env.DB, 'handmatig');
    return Response.json(rapport);
  },
};
