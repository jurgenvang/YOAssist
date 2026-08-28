import { json, fout } from '../lib/http.js';
import { instelling } from '../lib/http.js';

/**
 * Twee manieren om YOAssist van buitenaf te lezen.
 *
 * De JSON-route en de agendafeed zijn bewust apart, ondanks dat ze dezelfde
 * gegevens tonen: een agenda-app kan geen aangepaste header meesturen, dus
 * daar moet de beveiliging in de URL zelf zitten (een lange, willekeurige
 * sleutel). Een JSON-afnemer kan dat wel, dus daar hoort een gewone
 * Authorization-header — dezelfde soort geheim als RESEND_API_KEY, nooit in
 * een voor-de-hand-liggende plek zoals de URL.
 *
 * Beide zijn alleen-lezen. Er is hier geen enkel schrijfpad.
 */

/** Initiaal per voornaam + achternaam, bijvoorbeeld 'Ann Aerts' -> 'A.A.' */
function initialen(voornaam, achternaam) {
  const v = (voornaam ?? '').trim()[0] ?? '';
  const a = (achternaam ?? '').trim()[0] ?? '';
  return `${v}${v ? '.' : ''}${a}${a ? '.' : ''}`.toUpperCase() || '?';
}

async function naamFormaat(db) {
  return (await instelling(db, 'extern_namen', 'initialen')) === 'volledig' ? 'volledig' : 'initialen';
}

/**
 * De onderliggende query: komende wedstrijden van een club met wie er
 * aangeduid is. Gedeeld door de JSON-route en de agendafeed, zodat beide
 * altijd exact dezelfde stand tonen.
 */
async function komendeAanduidingen(db, { clubGuid = null, userEmail = null } = {}) {
  const vandaag = new Date().toISOString().slice(0, 10);

  const { results } = await db
    .prepare(
      `SELECT m.guid, m.datum, m.uur, m.thuis_naam, m.uit_naam, m.locatie, m.club_guid,
              c.naam AS club_naam,
              a.user_email, a.status, u.voornaam, u.achternaam
         FROM matches m
         JOIN clubs c ON c.guid = m.club_guid
         LEFT JOIN assignments a ON a.match_guid = m.guid AND a.status = 'toegewezen'
         LEFT JOIN users u ON u.email = a.user_email
        WHERE m.status = 'actief' AND m.scope = 1 AND m.datum >= ?
          ${clubGuid ? 'AND m.club_guid = ?' : ''}
        ORDER BY m.datum, m.uur, m.thuis_naam COLLATE NOCASE`,
    )
    .bind(...(clubGuid ? [vandaag, clubGuid] : [vandaag]))
    .all();

  const perWedstrijd = new Map();
  for (const r of results) {
    if (!perWedstrijd.has(r.guid)) {
      perWedstrijd.set(r.guid, {
        guid: r.guid, datum: r.datum, uur: r.uur, thuisNaam: r.thuis_naam,
        uitNaam: r.uit_naam, locatie: r.locatie, clubNaam: r.club_naam,
        officials: [],
      });
    }
    if (r.user_email) {
      perWedstrijd.get(r.guid).officials.push({
        email: r.user_email, voornaam: r.voornaam, achternaam: r.achternaam,
      });
    }
  }

  let wedstrijden = [...perWedstrijd.values()];
  if (userEmail) {
    wedstrijden = wedstrijden.filter((w) => w.officials.some((o) => o.email === userEmail));
  }
  return wedstrijden;
}

/**
 * GET /api/extern/aanduidingen
 *
 * Beveiligd met een sleutel in de Authorization-header, gecontroleerd tegen
 * de secret EXTERN_API_SLEUTEL. Geen Cloudflare Access hier: dit is bedoeld
 * voor een server-naar-server aanroep, niet voor een ingelogde persoon.
 */
export async function aanduidingen({ request, env }) {
  const header = request.headers.get('Authorization') ?? '';
  const opgegeven = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!env.EXTERN_API_SLEUTEL || opgegeven !== env.EXTERN_API_SLEUTEL) {
    return fout(401, 'Niet toegestaan', 'Ontbrekende of onjuiste sleutel.');
  }

  const formaat = await naamFormaat(env.DB);
  const wedstrijden = await komendeAanduidingen(env.DB);

  return json({
    aantal: wedstrijden.length,
    wedstrijden: wedstrijden.map((w) => ({
      guid: w.guid,
      datum: w.datum,
      uur: w.uur,
      wedstrijd: `${w.thuisNaam} - ${w.uitNaam}`,
      locatie: w.locatie,
      club: w.clubNaam,
      officials: w.officials.map((o) => formaat === 'volledig'
        ? `${o.voornaam} ${o.achternaam}`
        : initialen(o.voornaam, o.achternaam)),
    })),
  });
}

/**
 * GET /api/kalender/:sleutel.ics
 *
 * De sleutel zelf is de beveiliging: lang, willekeurig, per persoon. Geen
 * Access-check — een agenda-app kan zich niet aanmelden. Bewust enkel
 * bevestigde aanduidingen: een agenda hoort te tonen wat vaststaat.
 *
 * Wordt bij elke aanvraag opnieuw opgebouwd uit de actuele stand van de
 * databank. Wordt een aanduiding vrijgegeven of een wedstrijd verplaatst of
 * als verdwenen gemarkeerd, dan is dat bij de eerstvolgende ophaling van de
 * feed vanzelf verwerkt — er wordt niets apart bijgehouden.
 */
export async function kalender({ url, env }) {
  const sleutel = url.pathname.replace(/^\/api\/kalender\//, '').replace(/\.ics$/, '');
  if (!sleutel) return fout(400, 'Ongeldige aanvraag', 'Geen sleutel meegegeven.');

  const gebruiker = await env.DB
    .prepare('SELECT email, voornaam, achternaam FROM users WHERE agenda_sleutel = ? AND actief = 1')
    .bind(sleutel)
    .first();

  if (!gebruiker) return fout(404, 'Onbekende sleutel', 'Deze agendalink is niet (meer) geldig.');

  const wedstrijden = await komendeAanduidingen(env.DB, { userEmail: gebruiker.email });

  const regel = (s) => String(s ?? '')
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

  const naarUtc = (datum, uur) => {
    // jsDTCode-achtige aanpak: lokale Belgische tijd, hier simpel als UTC
    // weggeschreven. Een agenda-app toont dit met een tijdzoneverschil van
    // hooguit twee uur, wat voor een wedstrijduur ruim voldoende nauwkeurig is.
    const [u, m] = uur.split(':').map(Number);
    const d = new Date(`${datum}T00:00:00Z`);
    d.setUTCHours(u, m, 0, 0);
    return d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  };

  const events = wedstrijden.map((w) => {
    const begin = naarUtc(w.datum, w.uur);
    const eind = naarUtc(w.datum, w.uur);   // duur onbekend; begin = eind + 2u hieronder
    const eindDatum = new Date(begin.slice(0, 4) + '-' + begin.slice(4, 6) + '-' + begin.slice(6, 8)
      + 'T' + begin.slice(9, 11) + ':' + begin.slice(11, 13) + ':00Z');
    eindDatum.setUTCHours(eindDatum.getUTCHours() + 2);
    const eindStr = eindDatum.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

    return [
      'BEGIN:VEVENT',
      `UID:${w.guid}@yoassist.org`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART:${begin}`,
      `DTEND:${eindStr}`,
      `SUMMARY:${regel(`${w.thuisNaam} - ${w.uitNaam}`)}`,
      w.locatie ? `LOCATION:${regel(w.locatie)}` : null,
      `DESCRIPTION:${regel(w.clubNaam)}`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
    ].filter(Boolean).join('\r\n');
  });

  const inhoud = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//YOAssist//aanduidingen//NL',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${regel(`YOAssist — ${gebruiker.voornaam}`)}`,
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');

  return new Response(inhoud, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="yoassist.ics"',
      'Cache-Control': 'no-cache',
    },
  });
}

/**
 * POST /api/voorkeuren/agenda-sleutel
 *
 * Maakt de agendasleutel aan bij de eerste aanvraag, of geeft de bestaande
 * terug. Automatisch, geen tussenkomst van een beheerder nodig — net als
 * push-notificaties is dit een persoonlijke voorkeur zonder gevolgen voor
 * anderen.
 */
export async function maakAgendaSleutel({ env, user }) {
  const bestaand = await env.DB
    .prepare('SELECT agenda_sleutel FROM users WHERE email = ?')
    .bind(user.email)
    .first();

  const sleutel = bestaand?.agenda_sleutel || crypto.randomUUID().replace(/-/g, '');

  if (!bestaand?.agenda_sleutel) {
    await env.DB.prepare('UPDATE users SET agenda_sleutel = ? WHERE email = ?')
      .bind(sleutel, user.email).run();
  }

  return json({ sleutel, url: `/api/kalender/${sleutel}.ics` });
}

/**
 * POST /api/voorkeuren/agenda-sleutel/vernieuw
 *
 * Een nieuwe sleutel, de oude stopt daarmee te werken. Voor wie de link per
 * ongeluk doorstuurde.
 */
export async function vernieuwAgendaSleutel({ env, user }) {
  const sleutel = crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare('UPDATE users SET agenda_sleutel = ? WHERE email = ?')
    .bind(sleutel, user.email).run();
  return json({ sleutel, url: `/api/kalender/${sleutel}.ics` });
}
