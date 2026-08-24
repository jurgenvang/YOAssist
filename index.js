/**
 * YOAssist — Worker met static assets.
 *
 * Één project doet nu alles: de statische app, de API en de geplande
 * synchronisatie. Requests waarvoor een bestand in public/ bestaat worden door
 * Cloudflare rechtstreeks bediend en bereiken deze code niet; al de rest komt
 * hier binnen, en dat is in de praktijk /api/*.
 */

import { identify, AuthError } from './lib/access.js';
import { json, fout } from './lib/http.js';
import { synchroniseer } from './lib/sync.js';
import { me, clubs, kiesClub, matches, zetBeschikbaarheid } from './routes/gebruiker.js';
import * as admin from './routes/admin/index.js';
import { diagnoseMatches } from './routes/admin/diagnose.js';

// ---------------------------------------------------------------------------
// Routetabel. beheer: true betekent dat de route alleen voor admins is.
// Die vlag staat hier, op één plaats, zodat geen enkele route ze kan vergeten.
// ---------------------------------------------------------------------------
const ROUTES = [
  { methode: 'GET',    pad: '/api/me',                 handler: me },
  { methode: 'GET',    pad: '/api/matches',            handler: matches },
  { methode: 'POST',   pad: '/api/availability',       handler: zetBeschikbaarheid },
  { methode: 'GET',    pad: '/api/clubs',              handler: clubs },
  { methode: 'POST',   pad: '/api/club',               handler: kiesClub },

  { methode: 'GET',    pad: '/api/admin/config',       handler: admin.config,          beheer: true },
  { methode: 'POST',   pad: '/api/admin/season',       handler: admin.season,          beheer: true },
  { methode: 'GET',    pad: '/api/admin/resolve-club', handler: admin.resolveClub,     beheer: true },
  { methode: 'POST',   pad: '/api/admin/clubs',        handler: admin.clubToevoegen,   beheer: true },
  { methode: 'PATCH',  pad: '/api/admin/clubs',        handler: admin.clubAanUit,      beheer: true },
  { methode: 'DELETE', pad: '/api/admin/clubs',        handler: admin.clubVerwijderen, beheer: true },
  { methode: 'POST',   pad: '/api/admin/teams',        handler: admin.teamsLaden,      beheer: true },
  { methode: 'PATCH',  pad: '/api/admin/teams',        handler: admin.teamVlaggen,     beheer: true },
  { methode: 'GET',    pad: '/api/admin/sync',         handler: admin.syncLogboek,     beheer: true },
  { methode: 'POST',   pad: '/api/admin/sync',         handler: admin.syncNu,          beheer: true },
  { methode: 'GET',    pad: '/api/admin/diagnose-matches', handler: diagnoseMatches,   beheer: true },
];

/** Zoekt de gebruiker op na een geslaagde identificatie. */
async function laadGebruiker(env, identiteit) {
  const rij = await env.DB.prepare(
    `SELECT u.email, u.voornaam, u.achternaam, u.is_admin, u.profiel, u.club_guid, u.actief,
            c.naam AS club_naam
       FROM users u
       LEFT JOIN clubs c ON c.guid = u.club_guid
      WHERE u.email = ?`,
  )
    .bind(identiteit.email)
    .first();

  if (!rij) {
    throw fout(
      403,
      'Niet in de ledenlijst',
      `${identiteit.email} raakt wel door Access maar staat niet in YOAssist.`,
    );
  }
  if (!rij.actief) {
    throw fout(403, 'Account niet actief', 'Neem contact op met een beheerder.');
  }

  return {
    email: rij.email,
    voornaam: rij.voornaam,
    achternaam: rij.achternaam,
    // Weergavenaam wordt hier samengesteld zodat de frontend er niets over hoeft
    // te weten. Sorteren gebeurt altijd op achternaam, voornaam.
    naam: `${rij.voornaam} ${rij.achternaam}`,
    isAdmin: rij.is_admin === 1,
    profiel: rij.profiel,
    clubGuid: rij.club_guid,
    clubNaam: rij.club_naam,
    via: identiteit.via,
  };
}

async function behandelApi(request, env, ctx, url) {
  const kandidaten = ROUTES.filter((r) => r.pad === url.pathname);

  if (kandidaten.length === 0) {
    return fout(404, 'Onbekend eindpunt', `${url.pathname} bestaat niet.`);
  }

  const route = kandidaten.find((r) => r.methode === request.method);
  if (!route) {
    const toegestaan = kandidaten.map((r) => r.methode).join(', ');
    return new Response(
      JSON.stringify({ error: 'Methode niet toegestaan', detail: `Toegestaan: ${toegestaan}` }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json', Allow: toegestaan, 'Cache-Control': 'no-store' },
      },
    );
  }

  let identiteit;
  try {
    identiteit = await identify(request, env, ctx);
  } catch (err) {
    if (err instanceof Response) return err;
    const boodschap = err instanceof AuthError ? err.message : 'authenticatie mislukt';
    return fout(401, 'Niet aangemeld', boodschap);
  }

  let user;
  try {
    user = await laadGebruiker(env, identiteit);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }

  if (route.beheer && !user.isAdmin) {
    return fout(403, 'Geen toegang', 'Deze actie is voorbehouden aan beheerders.');
  }

  try {
    return await route.handler({ request, env, ctx, url, user });
  } catch (err) {
    // leesJson en laadGebruiker gooien kant-en-klare Responses.
    if (err instanceof Response) return err;
    console.error(`[YOAssist] ${request.method} ${url.pathname}:`, err);
    return fout(500, 'Er ging iets mis', err.message);
  }
}

// ---------------------------------------------------------------------------
// Cron. Cloudflare draait in UTC en België wisselt tussen UTC+1 en UTC+2, dus
// een vaste UTC-lijst zou twee keer per jaar een uur verschuiven. We vuren op
// alle kandidaat-uren en beslissen hier of het in Brussel werkelijk 0, 6, 12 of
// 18 uur is. DST-bestendig, zonder tzdata-pakket.
// ---------------------------------------------------------------------------
const DOELUREN = [0, 6, 12, 18];

function brusselsUur(datum) {
  return Number(
    new Intl.DateTimeFormat('nl-BE', {
      timeZone: 'Europe/Brussels',
      hour: 'numeric',
      hour12: false,
    }).format(datum),
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return behandelApi(request, env, ctx, url);
    }

    // Vangnet. In de praktijk bedient Cloudflare de bestanden uit public/ al
    // vóór deze Worker draait; dit vangt alleen wat daar doorheen glipt.
    if (env.ASSETS) return env.ASSETS.fetch(request);

    return new Response('Niet gevonden', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    const uur = brusselsUur(new Date(event.scheduledTime));
    if (!DOELUREN.includes(uur)) return;

    ctx.waitUntil(
      synchroniseer(env.DB, 'cron')
        .then((r) =>
          console.log(
            `[YOAssist] sync ${r.status}: ${r.gevonden} gevonden, ${r.nieuw} nieuw, ` +
              `${r.gewijzigd} gewijzigd, ${r.verdwenen} verdwenen` +
              (r.boodschap ? ` — ${r.boodschap}` : ''),
          ),
        )
        .catch((err) => console.error('[YOAssist] sync mislukt:', err)),
    );
  },
};
